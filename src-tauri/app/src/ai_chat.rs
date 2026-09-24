//! Turns of the app chats: the sidebar and main chat, questions about the
//! Meeting transcript and questions of a published Task Manager that the
//! host answers.
//!
//! A turn reads the chat, picks the messages the agent sees, runs the agent,
//! asks the interface for the clarifications, confirmations and plans the
//! agent needs, saves the turn and schedules the chat title and long-term
//! memories. The interface sends the message and the visible workspace,
//! renders the streamed events and answers the questions it is asked.

use std::collections::{HashMap, VecDeque};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Emitter, Manager};

use crate::backend::ai_settings::AiSettingsInput;
use crate::backend::chat_history::{ChatRole, StoredChatAttachment, StoredChatDocument, StoredChatMessage};
use crate::backend::chat_turn::{self, ContextSelection, TurnMode, WorkspaceInput};
use crate::backend::{
    AgentRequest, AgentResponse, BackendActor, BackendError, BackendErrorCode, BackendEvent, BackendRequest,
    BackendRequestContext, BackendRequestEnvelope, BackendResponse, CancelRequest, ClarificationAnswer,
    ConfirmationDecision, GetOperationRequest, MutationPreview, OperationToken, PendingInteraction, PlanDecision,
    PlanStepStatus, ProtocolVersion, ResumeDecision, ResumeRequest, UndoOperationRequest, OWNER_LIBRARY_USER_ID,
};
use crate::backend_runtime::{execute_backend_request, BackendRuntimeState};
use crate::library_registry::LibraryBindingRegistry;

/// A question of the agent the interface must answer.
pub(crate) const INTERACTION_EVENT: &str = "ai-chat-interaction";
/// The AI title of a new chat was saved.
pub(crate) const TITLE_EVENT: &str = "ai-chat-title";
/// How long a question waits for the person before the turn is cancelled.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Questions one turn may ask before it is considered stuck.
const MAX_INTERACTIONS: usize = 4;
/// Changed operations of this session that the interface may undo.
const MAX_UNDOABLE_OPERATIONS: usize = 50;

#[derive(Debug, Clone)]
struct RequestIdentity {
    context: BackendRequestContext,
    idempotency_key: String,
}

struct ActiveTurn {
    identity: RequestIdentity,
    /// Present while a question waits for the person.
    answer: Option<mpsc::Sender<InteractionAnswer>>,
    cancelled: bool,
}

#[derive(Default)]
pub(crate) struct AiChatState {
    turns: Mutex<HashMap<String, ActiveTurn>>,
    undoable: Mutex<VecDeque<(String, RequestIdentity)>>,
}

/// Chat the turn belongs to.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum ChatTarget {
    /// A chat file of the library, by the path the interface holds.
    Saved { path: String },
    /// A chat the interface keeps without a file.
    Ephemeral { document: StoredChatDocument },
    /// Previous messages of a conversation without settings (Meeting, published boards).
    Transient {
        #[serde(default)]
        messages: Vec<StoredChatMessage>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatSendPayload {
    library_id: String,
    /// Chosen by the interface to follow the turn's events.
    request_id: String,
    mode: TurnMode,
    /// Provider preferences in use, for a library without saved AI settings.
    #[serde(default)]
    settings: Option<AiSettingsInput>,
    /// Scope of the chat (`library`, `document`, `task-manager`, `graph`, `finance`).
    #[serde(default)]
    scope: String,
    message: String,
    /// Temporary context of the turn: the active room or view, or the Meeting transcript.
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    attachments: Vec<StoredChatAttachment>,
    /// Custom prompt file under `.agent/promps`.
    #[serde(default)]
    prompt_name: Option<String>,
    /// The person asked to undo this AI change.
    #[serde(default)]
    undo_operation_id: Option<String>,
    #[serde(default)]
    workspace: Option<WorkspaceInput>,
    #[serde(default)]
    selection: ContextSelection,
    /// Library user of a published Task Manager asking through the host.
    #[serde(default)]
    library_user_id: Option<String>,
    /// Multichat room open beside the chat; its conversation is the context.
    #[serde(default)]
    multichat_room_id: Option<String>,
    chat: ChatTarget,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatTurnOutcome {
    answer: String,
    /// The agent changed library data (the open note may need a reload).
    data_changed: bool,
    /// The chat after the turn, when the turn belongs to one.
    #[serde(skip_serializing_if = "Option::is_none")]
    document: Option<StoredChatDocument>,
    /// The AI change this turn undid.
    #[serde(skip_serializing_if = "Option::is_none")]
    undone_operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanStepDto {
    id: String,
    label: String,
    status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum InteractionDto {
    Clarification { question: String, choices: Vec<String> },
    Confirmation { preview: MutationPreview },
    Plan { title: String, steps: Vec<PlanStepDto> },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InteractionEvent {
    request_id: String,
    interaction: InteractionDto,
}

/// The person's answer to a question of the agent.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum InteractionAnswer {
    Clarification { answer: String },
    Confirmation {
        accepted: bool,
        #[serde(default)]
        hunk_ids: Vec<String>,
    },
    Plan {
        accepted: bool,
        /// Steps kept by the person; all of them when absent.
        #[serde(default)]
        step_ids: Option<Vec<String>>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAnswerPayload {
    request_id: String,
    answer: InteractionAnswer,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatCancelPayload {
    request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TitleEvent {
    library_id: String,
    path: String,
    title: String,
}

fn internal(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, message, true)
}

fn cancelled() -> BackendError {
    BackendError::new(BackendErrorCode::Cancelled, "Consulta cancelada.", false)
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or_default()
}

fn envelope(request: BackendRequest) -> BackendRequestEnvelope {
    BackendRequestEnvelope { protocol_version: ProtocolVersion::default(), request }
}

fn execute(app: &AppHandle, runtime: &BackendRuntimeState, request: BackendRequest) -> Result<BackendResponse, BackendError> {
    let registry = app.state::<LibraryBindingRegistry>();
    Ok(execute_backend_request(app, envelope(request), runtime, registry.inner())?.response)
}

fn interaction_dto(interaction: &PendingInteraction) -> InteractionDto {
    match interaction {
        PendingInteraction::Clarification(request) => InteractionDto::Clarification {
            question: request.question.clone(),
            choices: request.options.iter().map(|option| option.label.clone()).collect(),
        },
        PendingInteraction::Confirmation(request) => InteractionDto::Confirmation { preview: request.preview.clone() },
        PendingInteraction::Plan(plan) => InteractionDto::Plan {
            title: plan.title.clone(),
            steps: plan
                .steps
                .iter()
                .map(|step| PlanStepDto {
                    id: step.id.clone(),
                    label: step.label.clone(),
                    status: match step.status {
                        PlanStepStatus::Completed => "completed",
                        PlanStepStatus::Blocked => "blocked",
                        _ => "pending",
                    },
                })
                .collect(),
        },
    }
}

/// The decision the runtime resumes with; `None` when the answer does not
/// match the question.
fn decision(interaction: &PendingInteraction, operation: &OperationToken, answer: InteractionAnswer) -> Option<ResumeDecision> {
    match (interaction, answer) {
        (PendingInteraction::Clarification(request), InteractionAnswer::Clarification { answer }) => {
            let option_id = request.options.iter().find(|option| option.label == answer).map(|option| option.id.clone());
            Some(ResumeDecision::Clarification(ClarificationAnswer {
                clarification_id: request.clarification_id.clone(),
                operation: operation.clone(),
                answer,
                option_id,
            }))
        }
        (PendingInteraction::Confirmation(_), InteractionAnswer::Confirmation { accepted, hunk_ids }) => {
            Some(ResumeDecision::Confirmation(ConfirmationDecision {
                operation_id: operation.operation_id.clone(),
                accepted,
                hunk_ids,
            }))
        }
        (PendingInteraction::Plan(plan), InteractionAnswer::Plan { accepted, step_ids }) => Some(ResumeDecision::Plan(PlanDecision {
            plan_id: plan.plan_id.clone(),
            generation: plan.generation,
            accepted,
            step_ids: step_ids.unwrap_or_else(|| plan.steps.iter().map(|step| step.id.clone()).collect()),
        })),
        _ => None,
    }
}

/// Shows a question of the agent and waits for the person's answer.
fn ask(
    app: &AppHandle,
    state: &AiChatState,
    request_id: &str,
    interaction: &PendingInteraction,
    operation: &OperationToken,
) -> Option<ResumeDecision> {
    let (sender, receiver) = mpsc::channel();
    {
        let mut turns = state.turns.lock().ok()?;
        let turn = turns.get_mut(request_id)?;
        if turn.cancelled {
            return None;
        }
        turn.answer = Some(sender);
    }
    let event = InteractionEvent { request_id: request_id.to_string(), interaction: interaction_dto(interaction) };
    let answer = if app.emit(INTERACTION_EVENT, event).is_ok() { receiver.recv_timeout(ANSWER_TIMEOUT).ok() } else { None };
    if let Ok(mut turns) = state.turns.lock() {
        if let Some(turn) = turns.get_mut(request_id) {
            turn.answer = None;
        }
    }
    decision(interaction, operation, answer?)
}

fn cancel_request(app: &AppHandle, runtime: &BackendRuntimeState, identity: &RequestIdentity, operation: Option<OperationToken>) {
    let _ = execute(
        app,
        runtime,
        BackendRequest::Cancel(CancelRequest {
            context: identity.context.clone(),
            idempotency_key: identity.idempotency_key.clone(),
            request_id: identity.context.request_id.clone(),
            operation,
        }),
    );
}

/// Runs the agent until it answers, resuming after each question.
fn run_agent(
    app: &AppHandle,
    state: &AiChatState,
    runtime: &BackendRuntimeState,
    identity: &RequestIdentity,
    mut request: BackendRequest,
) -> Result<AgentResponse, BackendError> {
    for _ in 0..=MAX_INTERACTIONS {
        match execute(app, runtime, request)? {
            BackendResponse::Result { response } => return Ok(response),
            BackendResponse::Error { error, .. } => return Err(error),
            BackendResponse::Cancelled { .. } => return Err(cancelled()),
            BackendResponse::Operation { status } | BackendResponse::Resumed { status, .. } => {
                if let Some(response) = status.response {
                    return Ok(response);
                }
                let (Some(operation), Some(interaction)) = (status.operation, status.interaction) else {
                    break;
                };
                let Some(decision) = ask(app, state, &identity.context.request_id, &interaction, &operation) else {
                    cancel_request(app, runtime, identity, Some(operation));
                    return Err(cancelled());
                };
                request = BackendRequest::Resume(ResumeRequest {
                    context: identity.context.clone(),
                    idempotency_key: identity.idempotency_key.clone(),
                    request_id: identity.context.request_id.clone(),
                    operation,
                    last_event_sequence: status.last_event_sequence,
                    decision,
                });
            }
            _ => break,
        }
    }
    Err(internal("El runtime backend no devolvió una respuesta final."))
}

/// Remembers the changes of a finished request so a later turn can undo them.
fn remember_undoable(state: &AiChatState, runtime: &BackendRuntimeState, identity: &RequestIdentity) {
    let Ok(events) = runtime.request_events(&identity.context, 0) else {
        return;
    };
    let Ok(mut undoable) = state.undoable.lock() else {
        return;
    };
    for event in events {
        if let BackendEvent::ToolCompleted { ok: true, changed: Some(true), operation_id: Some(operation_id), .. } = event.event {
            undoable.retain(|(known, _)| known != &operation_id);
            undoable.push_back((operation_id, identity.clone()));
        }
    }
    while undoable.len() > MAX_UNDOABLE_OPERATIONS {
        undoable.pop_front();
    }
}

/// Undoes an AI change of this session. The runtime re-reads the stored
/// operation, checks the document revision and restores the previous state.
/// Returns the path of the restored document.
fn undo(app: &AppHandle, state: &AiChatState, runtime: &BackendRuntimeState, operation_id: &str) -> Result<Option<String>, BackendError> {
    let identity = state
        .undoable
        .lock()
        .map_err(|_| internal("No se pudo deshacer el cambio."))?
        .iter()
        .find(|(known, _)| known == operation_id)
        .map(|(_, identity)| identity.clone())
        .ok_or_else(|| BackendError::invalid_input("La operación ya no está disponible para deshacer en esta sesión."))?;
    let status = execute(
        app,
        runtime,
        BackendRequest::GetOperation(GetOperationRequest {
            context: identity.context.clone(),
            idempotency_key: identity.idempotency_key.clone(),
            request_id: identity.context.request_id.clone(),
            operation: None,
            last_event_sequence: 0,
        }),
    )?;
    let operation = match status {
        BackendResponse::Operation { status } => status.operation,
        _ => None,
    }
    .filter(|operation| operation.operation_id == operation_id)
    .ok_or_else(|| BackendError::invalid_input("La operación ya no es la última de su solicitud y no puede deshacerse."))?;
    let response = execute(
        app,
        runtime,
        BackendRequest::Undo(UndoOperationRequest {
            context: identity.context.clone(),
            idempotency_key: identity.idempotency_key.clone(),
            request_id: identity.context.request_id.clone(),
            operation,
        }),
    )?;
    match response {
        BackendResponse::Undo { result } => {
            if let Ok(mut undoable) = state.undoable.lock() {
                undoable.retain(|(known, _)| known != operation_id);
            }
            if let Some(error) = result.result.error {
                return Err(error);
            }
            Ok(result
                .result
                .data
                .as_ref()
                .and_then(|data| data.get("path"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string))
        }
        BackendResponse::Error { error, .. } => Err(error),
        _ => Err(internal("No se pudo deshacer el cambio.")),
    }
}

/// Workspace of a turn: the one the interface sent, or the fixed view of a
/// Meeting or published question.
fn workspace_of(mode: TurnMode, workspace: Option<WorkspaceInput>) -> Result<WorkspaceInput, BackendError> {
    let fixed = |view: &str, scope: &str| WorkspaceInput {
        snapshot_version: 1,
        view: view.to_string(),
        scope: scope.to_string(),
        active_document: None,
        open_tabs: Vec::new(),
        selection: None,
        captured_at: now_millis(),
    };
    match (mode, workspace) {
        (TurnMode::Chat, Some(workspace)) => Ok(workspace),
        (TurnMode::Chat, None) => Err(BackendError::invalid_input(
            "La solicitud de IA necesita una biblioteca activa y un contexto válido para ejecutarse en el backend.",
        )),
        (TurnMode::Meeting, _) => Ok(fixed("meeting", "library")),
        (TurnMode::Published, _) => Ok(fixed("task-manager", "published")),
    }
}

/// Names a new chat and learns long-term memories after the turn, without
/// delaying the answer.
fn schedule_background_tasks(
    app: &AppHandle,
    library_id: &str,
    title: Option<(String, String)>,
    learn: Option<(String, String, Vec<StoredChatMessage>)>,
) {
    if title.is_none() && learn.is_none() {
        return;
    }
    let app = app.clone();
    let library_id = library_id.to_string();
    std::thread::spawn(move || {
        if let Some((logical_path, prompt)) = title {
            match crate::agent_knowledge::title_chat(&app, &library_id, &logical_path, &prompt) {
                Ok(Some(title)) => {
                    let path = crate::library_session::visible_path(&app, &library_id, &logical_path);
                    let _ = app.emit(TITLE_EVENT, TitleEvent { library_id: library_id.clone(), path, title });
                }
                Ok(None) => {}
                Err(error) => log::warn!("[notia:chat] no se pudo titular el chat: {}", error.message),
            }
        }
        if let Some((prompt, reply, previous)) = learn {
            let previous = previous
                .iter()
                .map(|message| crate::backend::agent_knowledge::TurnMessage {
                    role: match message.role {
                        ChatRole::User => "user",
                        ChatRole::Assistant => "assistant",
                    },
                    content: &message.content,
                })
                .collect::<Vec<_>>();
            if let Err(error) = crate::agent_knowledge::learn_from_turn(&app, &library_id, &prompt, &reply, &previous) {
                log::warn!("[notia:chat] no se pudieron guardar memorias: {}", error.message);
            }
        }
    });
}

fn send(app: &AppHandle, payload: ChatSendPayload) -> Result<ChatTurnOutcome, BackendError> {
    let message = payload.message.trim().to_string();
    if message.is_empty() {
        return Err(BackendError::invalid_input("El mensaje no puede estar vacío."));
    }
    let library_id = payload.library_id.clone();
    let runtime = app.state::<BackendRuntimeState>().inner().clone();
    if let Some(settings) = &payload.settings {
        runtime.configure_fallback(&settings.normalize())?;
    }

    // The chat and the messages the agent sees.
    let (chat, logical_path, history) = match payload.chat {
        ChatTarget::Saved { path } => {
            let logical_path = crate::chat_history::chat_logical_path(app, &library_id, &path)?;
            let document = crate::chat_history::load(app, &library_id, &logical_path, chat_turn::DEFAULT_CHAT_TITLE)?;
            let history = chat_turn::memory_window(&document).to_vec();
            (Some(document), Some(logical_path), history)
        }
        ChatTarget::Ephemeral { document } => {
            let history = chat_turn::memory_window(&document).to_vec();
            (Some(document), None, history)
        }
        ChatTarget::Transient { messages } => (None, None, chat_turn::transient_window(&messages).to_vec()),
    };

    let workspace = workspace_of(payload.mode, payload.workspace)?;
    let (channel, scope, persistence_policy) = chat_turn::turn_route(payload.mode, &payload.scope, Some(&workspace.view));
    let library_user_id = match payload.mode {
        TurnMode::Published => payload
            .library_user_id
            .filter(|user| !user.trim().is_empty())
            .ok_or_else(|| BackendError::invalid_input("La consulta publicada necesita un usuario de la biblioteca."))?,
        TurnMode::Chat | TurnMode::Meeting => OWNER_LIBRARY_USER_ID.to_string(),
    };
    let identity = RequestIdentity {
        idempotency_key: format!("{library_id}:{}", payload.request_id),
        context: BackendRequestContext {
            request_id: payload.request_id.clone(),
            library_id: library_id.clone(),
            actor: BackendActor { library_user_id, external_identity: None },
            channel,
            scope,
            persistence_policy,
        },
    };
    identity.context.validate()?;

    let state = app.state::<AiChatState>();
    {
        let mut turns = state.turns.lock().map_err(|_| internal("No se pudo iniciar la consulta."))?;
        if turns.contains_key(&payload.request_id) {
            return Err(BackendError::invalid_input("La consulta ya está en curso."));
        }
        turns.insert(payload.request_id.clone(), ActiveTurn { identity: identity.clone(), answer: None, cancelled: false });
    }
    let result = match payload.undo_operation_id.as_deref() {
        Some(operation_id) => undo(app, &state, &runtime, operation_id).map(|path| (chat_turn::undo_answer(path.as_deref()), true)),
        None => {
            let room_context = payload
                .multichat_room_id
                .as_deref()
                .and_then(|room_id| crate::multichat::room_chat_context(app, &library_id, room_id));
            let context = room_context.as_deref().or(payload.context.as_deref());
            let prompt = chat_turn::turn_prompt(payload.mode, &message, context);
            let request = BackendRequest::Run(AgentRequest {
                context: identity.context.clone(),
                messages: chat_turn::turn_messages(&history, &prompt, &payload.attachments),
                snapshot: Some(chat_turn::workspace_snapshot(&workspace, &library_id)),
                tools: Vec::new(),
                attachments: Vec::new(),
                idempotency_key: identity.idempotency_key.clone(),
                prompt_name: payload.prompt_name.clone(),
            });
            let response = run_agent(app, &state, &runtime, &identity, request);
            remember_undoable(&state, &runtime, &identity);
            response.map(|response| {
                let changed = response.changed || response.tool_results.iter().any(|result| result.ok && result.changed);
                (response.response.markdown, changed)
            })
        }
    };
    if let Ok(mut turns) = state.turns.lock() {
        turns.remove(&payload.request_id);
    }
    let (answer, data_changed) = result?;

    // Save the turn in its chat.
    let document = match chat {
        Some(mut document) => {
            let previous_title = document.title.clone();
            let previous_messages = document.messages.clone();
            chat_turn::apply_turn_context(&mut document, &payload.selection);
            document.title = chat_turn::persisted_title(&previous_title, !previous_messages.is_empty(), &message);
            document.messages.push(StoredChatMessage { role: ChatRole::User, content: message.clone(), attachments: payload.attachments });
            document.messages.push(StoredChatMessage { role: ChatRole::Assistant, content: answer.clone(), attachments: Vec::new() });
            if let Some(logical_path) = &logical_path {
                if document.title != previous_title {
                    crate::chat_history::save_chat(app, &library_id, logical_path, &document)?;
                } else {
                    crate::chat_history::append_turn(app, &library_id, logical_path, &document)?;
                }
            }
            let title = logical_path.filter(|_| previous_messages.is_empty()).map(|path| (path, message.clone()));
            let learn = document
                .long_term_memory_enabled
                .then(|| (message.clone(), answer.clone(), previous_messages));
            schedule_background_tasks(app, &library_id, title, learn);
            Some(document)
        }
        None => None,
    };
    Ok(ChatTurnOutcome {
        answer,
        data_changed,
        document,
        undone_operation_id: payload.undo_operation_id,
    })
}

/// Runs one chat turn; it returns when the agent answered and the turn was saved.
pub(crate) async fn ai_chat_send(app: AppHandle, payload: ChatSendPayload) -> Result<ChatTurnOutcome, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || send(&app, payload))
        .await
        .map_err(|_| internal("La consulta terminó de forma inesperada."))?
}

/// The person's answer to the question the turn is waiting on.
pub(crate) fn ai_chat_answer(state: crate::host::State<'_, AiChatState>, payload: ChatAnswerPayload) -> Result<(), BackendError> {
    let sender = state
        .turns
        .lock()
        .map_err(|_| internal("No se pudo responder la consulta."))?
        .get_mut(&payload.request_id)
        .and_then(|turn| turn.answer.take())
        .ok_or_else(|| BackendError::new(BackendErrorCode::Conflict, "La consulta ya no espera una respuesta.", false))?;
    sender
        .send(payload.answer)
        .map_err(|_| BackendError::new(BackendErrorCode::Conflict, "La consulta ya no espera una respuesta.", false))
}

/// Cancels a turn: the question it waits on, or the running agent.
pub(crate) async fn ai_chat_cancel(app: AppHandle, payload: ChatCancelPayload) -> Result<(), BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let state = app.state::<AiChatState>();
        let identity = {
            let mut turns = state.turns.lock().map_err(|_| internal("No se pudo cancelar la consulta."))?;
            let Some(turn) = turns.get_mut(&payload.request_id) else {
                return Ok(());
            };
            turn.cancelled = true;
            // Dropping the pending answer lets the turn cancel its question.
            if turn.answer.take().is_some() {
                return Ok(());
            }
            turn.identity.clone()
        };
        let runtime = app.state::<BackendRuntimeState>().inner().clone();
        cancel_request(&app, &runtime, &identity, None);
        Ok(())
    })
    .await
    .map_err(|_| internal("No se pudo cancelar la consulta."))?
}
