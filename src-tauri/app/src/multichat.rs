//! Multichat rooms.
//!
//! The backend keeps each room (dynamic, agents, context, messages and round
//! state), picks the speakers of every round, streams each agent's answer
//! and decides when the automatic rounds stop. The interface opens a room,
//! sends the person's messages and renders the events and the room view.

use std::collections::HashMap;
use std::sync::Mutex;

use notia_backend_core::multichat::{
    self, agent_speaker_id, MultichatAgent, MultichatMessageDto, DYNAMICS_DIRECTORY,
};
use notia_backend_core::{ai_settings, RequestControl};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::host::{AppHandle, Emitter, Manager};

use crate::backend::{BackendError, BackendErrorCode};
use crate::backend_ollama::OllamaTransport;
use crate::services::ai_service::{AiChatMessage, AiChatStreamDelta};

const MULTICHAT_EVENT: &str = "multichat-event";
const MAX_ROOMS: usize = 16;
const MAX_CONTEXT_CHARS: usize = 20_000;
const MAX_MESSAGE_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoundStateDto {
    /// `empty`, `agent-turn`, `waiting-user`, `agent-no-response`,
    /// `error` or `cancelled`.
    status: &'static str,
    automatic_rounds: u32,
    automatic_round_limit: u32,
    active_agent_id: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct Room {
    library_id: String,
    dynamic_file: String,
    dynamic_name: String,
    dynamic: String,
    agents: Vec<MultichatAgent>,
    context: String,
    messages: Vec<MultichatMessageDto>,
    round: RoundStateDto,
    cancelled: bool,
}

#[derive(Default)]
pub(crate) struct MultichatState {
    rooms: Mutex<HashMap<String, Room>>,
    controls: Mutex<HashMap<String, RequestControl>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NamedFileDto {
    file_name: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoomViewDto {
    room_id: String,
    library_id: String,
    dynamic: NamedFileDto,
    agents: Vec<NamedFileDto>,
    context_content: String,
    messages: Vec<MultichatMessageDto>,
    round: RoundStateDto,
    cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentOptionDto {
    file_name: String,
    name: String,
    /// The file can be read and is not empty.
    valid: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MultichatCatalogDto {
    dynamics: Vec<AgentOptionDto>,
    agents: Vec<AgentOptionDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
enum MultichatEvent {
    /// The room changed: messages, round state or the active agent.
    Room { room: RoomViewDto },
    AgentStart { agent_id: String, agent_name: String },
    Thinking { agent_id: String, delta: String },
    Delta { agent_id: String, delta: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MultichatEventPayload {
    room_id: String,
    #[serde(flatten)]
    event: MultichatEvent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogPayload {
    library_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRoomPayload {
    library_id: String,
    dynamic_file: String,
    agent_files: Vec<String>,
    #[serde(default)]
    context: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendPayload {
    room_id: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoomPayload {
    room_id: String,
}

fn internal() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación de Multichat.", true)
}

fn cancelled_error() -> BackendError {
    BackendError::new(BackendErrorCode::Cancelled, "La ronda fue cancelada.", false)
}

fn stem(file_name: &str) -> String {
    file_name.strip_suffix(".md").or_else(|| file_name.strip_suffix(".MD")).unwrap_or(file_name).to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// Markdown body of a library file without its frontmatter, if it exists.
fn read_body(app: &AppHandle, library_id: &str, logical_path: &str) -> Result<Option<String>, BackendError> {
    let content = crate::library_documents::with_documents(app, library_id, |documents| documents.read(logical_path))?;
    Ok(content.map(|source| notia_backend_core::prompt::strip_frontmatter(&source).trim().to_string()))
}

/// Prompt of an agent file; `default.md` is the embedded default prompt.
fn agent_prompt(app: &AppHandle, library_id: &str, file_name: &str) -> Result<String, BackendError> {
    if file_name.eq_ignore_ascii_case(notia_backend_core::agent_workspace::DEFAULT_PROMPT_FILE) {
        return Ok(crate::backend::DEFAULT_AGENT_PROMPT.to_string());
    }
    read_body(app, library_id, &format!("{}/{file_name}", notia_backend_core::agent_workspace::PROMPTS_DIRECTORY))?
        .filter(|prompt| !prompt.is_empty())
        .ok_or_else(|| BackendError::invalid_input("El prompt seleccionado está vacío."))
}

fn view(room_id: &str, room: &Room) -> RoomViewDto {
    RoomViewDto {
        room_id: room_id.to_string(),
        library_id: room.library_id.clone(),
        dynamic: NamedFileDto { file_name: room.dynamic_file.clone(), name: room.dynamic_name.clone() },
        agents: room
            .agents
            .iter()
            .map(|agent| NamedFileDto { file_name: agent.file_name.clone(), name: agent.name.clone() })
            .collect(),
        context_content: room.context.clone(),
        messages: room.messages.clone(),
        round: room.round.clone(),
        cancelled: room.cancelled,
    }
}

fn emit(app: &AppHandle, room_id: &str, event: MultichatEvent) {
    let _ = app.emit(MULTICHAT_EVENT, MultichatEventPayload { room_id: room_id.to_string(), event });
}

fn catalog(app: &AppHandle, library_id: &str) -> Result<MultichatCatalogDto, BackendError> {
    // Creates `.agent/`, its prompts and the dynamics folder when missing.
    crate::agent_workspace::ensure_workspace(app, library_id)?;
    let prefix = format!("{DYNAMICS_DIRECTORY}/");
    let mut dynamics = crate::library_documents::inventory_paths(app, library_id, DYNAMICS_DIRECTORY)?
        .into_iter()
        .filter_map(|path| path.strip_prefix(&prefix).map(str::to_string))
        .filter(|name| multichat::is_valid_markdown_file_name(name))
        .map(|file_name| AgentOptionDto {
            valid: read_body(app, library_id, &format!("{DYNAMICS_DIRECTORY}/{file_name}"))
                .ok()
                .flatten()
                .is_some_and(|body| !body.is_empty()),
            name: stem(&file_name),
            file_name,
        })
        .collect::<Vec<_>>();
    dynamics.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    let agents = crate::agent_workspace::list_prompts(app, library_id)?
        .prompts
        .into_iter()
        .map(|prompt| AgentOptionDto {
            valid: agent_prompt(app, library_id, &prompt.file_name).is_ok(),
            file_name: prompt.file_name,
            name: prompt.name,
        })
        .collect();
    Ok(MultichatCatalogDto { dynamics, agents })
}

fn open_room(app: &AppHandle, payload: OpenRoomPayload) -> Result<RoomViewDto, BackendError> {
    let library_id = payload.library_id;
    if !multichat::is_valid_markdown_file_name(&payload.dynamic_file) {
        return Err(BackendError::invalid_input("Seleccioná una dinámica válida."));
    }
    if payload.agent_files.len() < multichat::MIN_AGENTS || payload.agent_files.len() > multichat::MAX_AGENTS {
        return Err(BackendError::invalid_input("Seleccioná entre uno y seis agentes."));
    }
    let context = payload.context.trim().to_string();
    if context.chars().count() > MAX_CONTEXT_CHARS {
        return Err(BackendError::invalid_input("El contexto de la sala es demasiado largo."));
    }
    let dynamic = read_body(app, &library_id, &format!("{DYNAMICS_DIRECTORY}/{}", payload.dynamic_file))?
        .ok_or_else(|| BackendError::invalid_input("No se pudo leer la dinámica seleccionada."))?;
    if dynamic.is_empty() {
        return Err(BackendError::invalid_input("La dinámica seleccionada está vacía."));
    }
    let agents = payload
        .agent_files
        .iter()
        .map(|file_name| {
            if !multichat::is_valid_markdown_file_name(file_name) {
                return Err(BackendError::invalid_input("El prompt seleccionado no es válido."));
            }
            Ok(MultichatAgent {
                prompt: agent_prompt(app, &library_id, file_name)?,
                name: stem(file_name),
                file_name: file_name.clone(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    multichat::validate_agents(&agents)?;
    let mut random = || rand::thread_rng().gen::<f64>();
    let room = Room {
        library_id,
        dynamic_name: stem(&payload.dynamic_file),
        dynamic_file: payload.dynamic_file,
        dynamic,
        agents,
        context,
        messages: Vec::new(),
        round: RoundStateDto {
            status: "empty",
            automatic_rounds: 0,
            automatic_round_limit: multichat::automatic_round_limit(&mut random),
            active_agent_id: None,
            error: None,
        },
        cancelled: false,
    };
    let room_id = uuid::Uuid::new_v4().to_string();
    let state = app.state::<MultichatState>();
    let mut rooms = state.rooms.lock().map_err(|_| internal())?;
    if rooms.len() >= MAX_ROOMS {
        if let Some(oldest) = rooms.keys().next().cloned() {
            rooms.remove(&oldest);
        }
    }
    let result = view(&room_id, &room);
    rooms.insert(room_id, room);
    Ok(result)
}

/// Streams one agent's answer.
fn agent_answer(
    app: &AppHandle,
    room_id: &str,
    room: &Room,
    agent: &MultichatAgent,
    control: &RequestControl,
) -> Result<String, BackendError> {
    let (http, model, think) = crate::backend_runtime::library_ai_provider(app, &room.library_id)?;
    // A thinking level only applies to models that take levels.
    let think = match think {
        Value::String(level) if ai_settings::supports_thinking_levels(&model) => Value::String(level),
        Value::String(_) => Value::Bool(true),
        other => other,
    };
    let history = multichat::visible_history(&room.messages);
    let instruction = multichat::agent_instruction(&room.dynamic, agent, &room.context, history);
    let message = |role: &str, content: String| AiChatMessage {
        role: role.to_string(),
        content,
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_name: None,
    };
    let mut messages = vec![message("system", ai_settings::TRANSCRIPT_SYSTEM_PROMPT.to_string())];
    messages.extend(
        multichat::provider_history(history)
            .into_iter()
            .map(|(is_user, content)| message(if is_user { "user" } else { "assistant" }, content)),
    );
    messages.push(message("user", format!("Pedido del usuario:\n{}", instruction.trim())));
    let agent_id = agent_speaker_id(agent);
    crate::backend_ollama::platform_ollama_transport(app).stream_chat(
        &http,
        &model,
        &messages,
        &think,
        control,
        &mut |delta| {
            let event = match delta {
                AiChatStreamDelta::Thinking(delta) => MultichatEvent::Thinking { agent_id: agent_id.clone(), delta },
                AiChatStreamDelta::Content(delta) => MultichatEvent::Delta { agent_id: agent_id.clone(), delta },
            };
            emit(app, room_id, event);
            Ok(())
        },
    )
}

/// Runs the rounds that follow a message of the person.
fn run_rounds(app: &AppHandle, room_id: &str, room: &mut Room, control: &RequestControl) -> Result<(), BackendError> {
    let mut random = || rand::thread_rng().gen::<f64>();
    let mut participants = multichat::select_participants(&room.agents, &room.dynamic, &mut random);
    let mut automatic_rounds = 0;
    while !participants.is_empty() && automatic_rounds < room.round.automatic_round_limit {
        let mut replies = 0;
        let mut silent_agent = None;
        for index in participants {
            control.check().map_err(|_| cancelled_error())?;
            let agent = room.agents[index].clone();
            let agent_id = agent_speaker_id(&agent);
            room.round.status = "agent-turn";
            room.round.active_agent_id = Some(agent_id.clone());
            emit(app, room_id, MultichatEvent::AgentStart { agent_id: agent_id.clone(), agent_name: agent.name.clone() });
            emit(app, room_id, MultichatEvent::Room { room: view(room_id, room) });
            let answer = agent_answer(app, room_id, room, &agent, control)?;
            control.check().map_err(|_| cancelled_error())?;
            room.round.active_agent_id = None;
            let content = answer.trim();
            if content.is_empty() {
                room.round.error = Some(format!("{} no devolvió una respuesta.", agent.name));
                silent_agent = Some(agent.name);
            } else {
                room.messages.push(MultichatMessageDto {
                    id: uuid::Uuid::new_v4().to_string(),
                    speaker_id: agent_id,
                    speaker_name: agent.name,
                    content: content.chars().take(MAX_MESSAGE_CHARS).collect(),
                    created_at: now_ms(),
                });
                replies += 1;
            }
            emit(app, room_id, MultichatEvent::Room { room: view(room_id, room) });
        }
        if replies == 0 {
            room.round.status = "agent-no-response";
            room.round.active_agent_id = None;
            room.round.error = Some("Un agente no devolvió una respuesta.".to_string());
            return Ok(());
        }
        automatic_rounds += 1;
        room.round.automatic_rounds = automatic_rounds;
        room.round.active_agent_id = None;
        room.round.status = if silent_agent.is_some() { "agent-no-response" } else { "waiting-user" };
        room.round.error = silent_agent.as_ref().map(|name| format!("{name} no devolvió una respuesta."));
        emit(app, room_id, MultichatEvent::Room { room: view(room_id, room) });
        // A dynamic can ask for automatic turns, but every chain is capped.
        if silent_agent.is_some()
            || !multichat::dynamic_allows_automatic_turns(&room.dynamic)
            || automatic_rounds >= room.round.automatic_round_limit
        {
            return Ok(());
        }
        participants = multichat::select_participants(&room.agents, &room.dynamic, &mut random);
    }
    Ok(())
}

fn send(app: &AppHandle, payload: SendPayload) -> Result<RoomViewDto, BackendError> {
    let content = payload.content.trim().to_string();
    if content.is_empty() || content.chars().count() > MAX_MESSAGE_CHARS {
        return Err(BackendError::invalid_input("El mensaje no es válido."));
    }
    let state = app.state::<MultichatState>();
    let mut room = state
        .rooms
        .lock()
        .map_err(|_| internal())?
        .get(&payload.room_id)
        .cloned()
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La sala ya no existe.", false))?;
    let control = RequestControl::new(None);
    state.controls.lock().map_err(|_| internal())?.insert(payload.room_id.clone(), control.clone());
    room.messages.push(MultichatMessageDto {
        id: uuid::Uuid::new_v4().to_string(),
        speaker_id: "user".to_string(),
        speaker_name: "Usuario".to_string(),
        content,
        created_at: now_ms(),
    });
    room.cancelled = false;
    room.round.status = "agent-turn";
    room.round.automatic_rounds = 0;
    room.round.error = None;
    emit(app, &payload.room_id, MultichatEvent::Room { room: view(&payload.room_id, &room) });
    if let Err(error) = run_rounds(app, &payload.room_id, &mut room, &control) {
        let cancelled = control.check().is_err() || error.code == BackendErrorCode::Cancelled;
        room.cancelled = cancelled;
        room.round.status = if cancelled { "cancelled" } else { "error" };
        room.round.active_agent_id = None;
        room.round.error = (!cancelled).then(|| error.message.clone());
    }
    if let Ok(mut controls) = state.controls.lock() {
        controls.remove(&payload.room_id);
    }
    let result = view(&payload.room_id, &room);
    if let Ok(mut rooms) = state.rooms.lock() {
        if rooms.contains_key(&payload.room_id) {
            rooms.insert(payload.room_id.clone(), room);
        }
    }
    emit(app, &payload.room_id, MultichatEvent::Room { room: result.clone() });
    Ok(result)
}

fn blocking_error() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "La operación de Multichat se interrumpió.", true)
}

/// Dynamics and agents available in the library.
pub(crate) async fn multichat_catalog(app: AppHandle, payload: CatalogPayload) -> Result<MultichatCatalogDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || catalog(&app, &payload.library_id))
        .await
        .map_err(|_| blocking_error())?
}

pub(crate) async fn multichat_open(app: AppHandle, payload: OpenRoomPayload) -> Result<RoomViewDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || open_room(&app, payload))
        .await
        .map_err(|_| blocking_error())?
}

/// Adds the person's message and runs the agents' rounds, streaming
/// `multichat-event`.
pub(crate) async fn multichat_send(app: AppHandle, payload: SendPayload) -> Result<RoomViewDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || send(&app, payload))
        .await
        .map_err(|_| blocking_error())?
}

/// A room of the library as context for the side chat.
pub(crate) fn room_chat_context(app: &AppHandle, library_id: &str, room_id: &str) -> Option<String> {
    let state = app.state::<MultichatState>();
    let rooms = state.rooms.lock().ok()?;
    let room = rooms.get(room_id).filter(|room| room.library_id == library_id)?;
    let agent_names = room.agents.iter().map(|agent| agent.name.clone()).collect::<Vec<_>>();
    Some(multichat::room_chat_context(&room.dynamic_name, &agent_names, &room.context, &room.messages))
}

pub(crate) fn multichat_cancel(app: AppHandle, payload: RoomPayload) {
    if let Ok(controls) = app.state::<MultichatState>().controls.lock() {
        if let Some(control) = controls.get(&payload.room_id) {
            control.cancel();
        }
    }
}

pub(crate) fn multichat_close(app: AppHandle, payload: RoomPayload) {
    multichat_cancel(app.clone(), RoomPayload { room_id: payload.room_id.clone() });
    if let Ok(mut rooms) = app.state::<MultichatState>().rooms.lock() {
        rooms.remove(&payload.room_id);
    }
}
