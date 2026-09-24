use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use notia_backend_core::pomodoro::{PomodoroAction, PomodoroState};
use notia_backend_core::{
    BackendError, BackendErrorCode, PersistentTaskManager, PomodoroEvent, TaskBoardIntent, TaskBoardViewDto, TaskContextSearchRequest, TaskManagerContextDto, TaskManagerMutationPort, TaskManagerReadPort, TaskManagerSnapshotReadDto, TaskManagerSnapshotStore, TaskMutationApplyRequestDto, TaskMutationDto, TaskMutationRequestDto, TaskTicketListRequest, TaskTicketReadRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::host::{AppHandle, Emitter, Manager, State};

use crate::library_registry::LibraryBindingRegistry;
use crate::library_users::authorize_task_manager_user;
use crate::task_manager_store::MarkdownTaskManagerStore;

#[derive(Default)]
pub(crate) struct TaskManagerBackendState {
    managers: Mutex<HashMap<String, Arc<PersistentTaskManager>>>,
    /// One commit lock per library, shared by every user's manager, so two
    /// users of the same library never interleave writes to its workspace.
    commit_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

const MAX_OPEN_TASK_MANAGERS: usize = 64;

/// Backend-only entry point used by the canonical agent runtime.  It keeps the
/// existing command surface intact while ensuring Task Manager reads use the
/// same authorization and persistent Markdown store as the UI commands.
pub(crate) fn execute_backend_read_tool(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value, BackendError> {
    let manager = manager(app, state, registry, library_id, library_user_id)?;
    let context = TaskManagerContextDto::new(library_id, library_user_id)?;
    let mut object = arguments.as_object().cloned().unwrap_or_default();
    object.insert("context".to_string(), serde_json::to_value(&context).map_err(|_| {
        BackendError::new(BackendErrorCode::Internal, "No se pudo preparar el contexto de Task Manager.", true)
    })?);
    let payload = Value::Object(object);
    let decode = |value: &Value| {
        serde_json::from_value::<TaskTicketListRequest>(value.clone()).map_err(|_| {
            BackendError::invalid_input("Los parámetros de lectura de Task Manager no son válidos.")
        })
    };

    match name {
        "search_task_tickets" | "read_all_task_tickets" => {
            let mut request = decode(&payload)?;
            if name == "read_all_task_tickets" {
                request.query.clear();
                request.include_archived = true;
            }
            serde_json::to_value(manager.list_tickets(&request)?).map_err(|_| {
                BackendError::new(BackendErrorCode::Internal, "No se pudo serializar la lectura de Task Manager.", true)
            })
        }
        "read_task_tickets" => {
            let include_archived = arguments
                .get("includeArchived")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let tickets = notia_backend_core::ticket_ids_to_read(arguments)?
                .into_iter()
                .map(|ticket_id| {
                    manager.read_ticket(&TaskTicketReadRequest {
                        context: context.clone(),
                        ticket_id,
                        include_archived,
                        subtask_offset: 0,
                        subtask_limit: notia_backend_core::MAX_TASK_RESULTS,
                        comment_offset: 0,
                        comment_limit: notia_backend_core::MAX_TASK_RESULTS,
                    })
                })
                .collect::<Result<Vec<_>, BackendError>>()?;
            serde_json::to_value(json!({ "tickets": tickets })).map_err(|_| {
                BackendError::new(BackendErrorCode::Internal, "No se pudo serializar el ticket.", true)
            })
        }
        "search_task_context" => {
            let request = serde_json::from_value::<TaskContextSearchRequest>(payload).map_err(|_| {
                BackendError::invalid_input("Los parámetros de búsqueda de Task Manager no son válidos.")
            })?;
            serde_json::to_value(manager.search_context(&request)?).map_err(|_| {
                BackendError::new(BackendErrorCode::Internal, "No se pudo serializar la búsqueda de Task Manager.", true)
            })
        }
        "get_task_manager_options" => {
            let board_id = arguments.get("boardId").and_then(Value::as_str);
            serde_json::to_value(manager.get_options(&context, board_id)?).map_err(|_| {
                BackendError::new(BackendErrorCode::Internal, "No se pudo serializar las opciones de Task Manager.", true)
            })
        }
        "get_task_board_summary" => {
            let board_id = arguments.get("boardId").and_then(Value::as_str).ok_or_else(|| {
                BackendError::invalid_input("La consulta necesita boardId.")
            })?;
            serde_json::to_value(manager.board_summary(&context, board_id)?).map_err(|_| {
                BackendError::new(BackendErrorCode::Internal, "No se pudo serializar el resumen del tablero.", true)
            })
        }
        _ => Err(BackendError::new(
            BackendErrorCode::Unsupported,
            "La lectura de Task Manager no está disponible.",
            false,
        )),
    }
}

/// Applies a Task Manager tool only after the agent runtime has resumed the
/// confirmed operation.  The preview is created immediately before apply so
/// the persistent store still enforces revision and idempotency checks.
pub(crate) fn execute_backend_mutation_tool(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    operation_id: &str,
    name: &str,
    arguments: &Value,
) -> Result<Value, BackendError> {
    let manager = manager(app, state, registry, library_id, library_user_id)?;
    let context = TaskManagerContextDto::new(library_id, library_user_id)?;
    let preview_request = TaskMutationRequestDto {
        context: context.clone(),
        operation_id: operation_id.to_string(),
        idempotency_key: operation_id.to_string(),
        mutation: notia_backend_core::task_mutation_from_tool(
            name,
            arguments,
            &mut || uuid::Uuid::new_v4().to_string(),
            unix_now_ms(),
        )?,
    };
    let preview = manager.preview_mutation(&preview_request)?;
    let receipt = manager.apply_mutation(&TaskMutationApplyRequestDto {
        context,
        operation_id: preview.operation_id.clone(),
        idempotency_key: preview.idempotency_key.clone(),
        confirmed: true,
    })?;
    Ok(json!({ "tool": name, "preview": preview, "receipt": receipt }))
}

fn unix_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn manager(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
) -> Result<Arc<PersistentTaskManager>, BackendError> {
    authorize_task_manager_user(app, registry, library_id, library_user_id)?;
    open_manager(app, state, registry, library_id, library_user_id)
}

/// Markdown store of a library, sharing the library's commit lock.
fn library_store(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
) -> Result<MarkdownTaskManagerStore, BackendError> {
    let commit_lock = state
        .commit_locks
        .lock()
        .map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo acceder al runtime de Task Manager.",
                true,
            )
        })?
        .entry(library_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone();
    Ok(
        MarkdownTaskManagerStore::new(library_id.to_string(), registry.clone(), commit_lock)
            .with_app(app.clone()),
    )
}

fn is_digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid_local_date(value: &str) -> bool {
    let parts = value.split('-').collect::<Vec<_>>();
    parts.len() == 3
        && parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts.iter().all(|part| is_digits(part))
        && matches!(parts[1].parse::<u8>(), Ok(1..=12))
        && matches!(parts[2].parse::<u8>(), Ok(1..=31))
}

fn valid_local_time(value: &str) -> bool {
    let parts = value.split(':').collect::<Vec<_>>();
    parts.len() == 2
        && parts.iter().all(|part| part.len() == 2 && is_digits(part))
        && matches!(parts[0].parse::<u8>(), Ok(0..=23))
        && matches!(parts[1].parse::<u8>(), Ok(0..=59))
}

fn append_pomodoro_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    local_date: &str,
    local_time: &str,
    entry: &notia_backend_core::pomodoro_log::PomodoroEntryInput,
) -> Result<(), BackendError> {
    manager(app, state, registry, &context.library_id, &context.library_user_id)?;
    if !valid_local_date(local_date) || !valid_local_time(local_time) {
        return Err(BackendError::invalid_input("La fecha del pomodoro no es válida."));
    }
    library_store(app, state, registry, &context.library_id)?.update_pomodoro_log(|content| {
        notia_backend_core::pomodoro_log::append_pomodoro_entry(content, local_date, local_time, entry)
            .map(Some)
    })?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PomodoroDeletePayload {
    pub context: TaskManagerContextPayload,
    pub entry_id: String,
}

pub(crate) fn task_manager_delete_pomodoro(
    app: AppHandle,
    payload: PomodoroDeletePayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<bool, BackendError> {
    let context = payload.context.into_core()?;
    manager(&app, &state, &registry, &context.library_id, &context.library_user_id)?;
    let deleted = library_store(&app, &state, &registry, &context.library_id)?.update_pomodoro_log(|content| {
        Ok(notia_backend_core::pomodoro_log::delete_pomodoro_entry(content, &payload.entry_id))
    })?;
    if deleted {
        announce_task_manager_change(&app, &context.library_id);
    }
    Ok(deleted)
}

/// Board view of the library. Published sessions never read the Pomodoro
/// history, which mixes every board.
fn board_view_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    include_pomodoro: bool,
) -> Result<TaskBoardViewDto, BackendError> {
    let manager = manager(app, state, registry, &context.library_id, &context.library_user_id)?;
    let snapshot = manager.read_snapshot(context)?;
    let pomodoro_entries = if include_pomodoro {
        library_store(app, state, registry, &context.library_id)?.pomodoro_entries()?
    } else {
        Vec::new()
    };
    Ok(notia_backend_core::project_board_view(&snapshot, pomodoro_entries))
}

pub(crate) fn task_manager_board_view(
    app: AppHandle,
    payload: TaskManagerContextPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskBoardViewDto, BackendError> {
    let context = payload.into_core()?;
    let mut view = board_view_in(&app, &state, &registry, &context, true)?;
    notia_backend_core::show_board_paths(&mut view, |logical| {
        crate::library_session::visible_path(&app, &context.library_id, logical)
    });
    Ok(view)
}

/// Previews and applies each mutation as its own confirmed operation, so
/// the store keeps enforcing revisions and idempotency.
fn apply_mutations(
    manager: &PersistentTaskManager,
    context: &TaskManagerContextDto,
    mutations: Vec<TaskMutationDto>,
) -> Result<bool, BackendError> {
    let mut changed = false;
    for mutation in mutations {
        let operation_id = uuid::Uuid::new_v4().to_string();
        let preview = manager.preview_mutation(&TaskMutationRequestDto {
            context: context.clone(),
            operation_id: operation_id.clone(),
            idempotency_key: operation_id,
            mutation,
        })?;
        let receipt = manager.apply_mutation(&TaskMutationApplyRequestDto {
            context: context.clone(),
            operation_id: preview.operation_id,
            idempotency_key: preview.idempotency_key,
            confirmed: true,
        })?;
        changed |= receipt.changed;
    }
    Ok(changed)
}

fn read_envelope(
    manager: &PersistentTaskManager,
    context: &TaskManagerContextDto,
) -> Result<TaskManagerSnapshotReadDto, BackendError> {
    TaskManagerSnapshotReadDto::from_snapshot(context.clone(), manager.read_snapshot(context)?)
}

fn board_execute_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    intent: &TaskBoardIntent,
) -> Result<bool, BackendError> {
    let manager = manager(app, state, registry, &context.library_id, &context.library_user_id)?;
    let read = read_envelope(&manager, context)?;
    let mutations = notia_backend_core::resolve_board_intent(
        &read,
        intent,
        &mut || uuid::Uuid::new_v4().to_string(),
        unix_now_ms(),
    )?;
    apply_mutations(&manager, context, mutations)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskBoardExecutePayload {
    pub context: TaskManagerContextPayload,
    pub intent: TaskBoardIntent,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskBoardExecuteDto {
    changed: bool,
}

/// Runs what the person did on the board.
pub(crate) async fn task_manager_board_execute(
    app: AppHandle,
    payload: TaskBoardExecutePayload,
) -> Result<TaskBoardExecuteDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let context = payload.context.into_core()?;
        let state = app.state::<TaskManagerBackendState>();
        let registry = app.state::<LibraryBindingRegistry>();
        let changed = board_execute_in(&app, &state, &registry, &context, &payload.intent)?;
        if changed {
            announce_task_manager_change(&app, &context.library_id);
        }
        Ok(TaskBoardExecuteDto { changed })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación de Task Manager.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PomodoroCommandPayload {
    pub context: TaskManagerContextPayload,
    /// Local calendar date and time of the device (`YYYY-MM-DD`, `HH:MM`).
    pub local_date: String,
    pub local_time: String,
    pub action: PomodoroAction,
    /// Timer older versions kept in the WebView; adopted when none is stored.
    #[serde(default)]
    pub legacy_state: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PomodoroCommandDto {
    state: PomodoroState,
    /// The event changed the log or the task hours.
    changed: bool,
    /// The timer moved but its event could not be logged.
    #[serde(skip_serializing_if = "Option::is_none")]
    record_error: Option<String>,
}

/// Serializes every timer read-modify-write of this process.
static POMODORO_LOCK: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));

/// File of the timer of one library user.
fn pomodoro_file(app: &AppHandle, context: &TaskManagerContextDto) -> Result<std::path::PathBuf, BackendError> {
    let safe = |value: &str| value.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| BackendError::new(BackendErrorCode::Storage, "No se pudo abrir el temporizador.", true))?
        .join("task-manager")
        .join("pomodoro");
    Ok(directory.join(format!("{}-{}.json", safe(&context.library_id), safe(&context.library_user_id))))
}

/// Logs a Pomodoro event and adds the worked and deviated hours to the task
/// that was selected when it happened.
fn record_pomodoro_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    (local_date, local_time): (&str, &str),
    event: &PomodoroEvent,
    timer: &PomodoroState,
) -> Result<bool, BackendError> {
    let manager = manager(app, state, registry, &context.library_id, &context.library_user_id)?;
    let read = read_envelope(&manager, context)?;
    let ticket = notia_backend_core::pomodoro_ticket(&read, timer.selected_task_path.as_deref());
    let plan = notia_backend_core::plan_pomodoro_record(
        event,
        &timer.durations,
        ticket.map(|ticket| ticket.summary.title.as_str()),
    )?;
    for entry in &plan.entries {
        append_pomodoro_in(app, state, registry, context, local_date, local_time, entry)?;
    }
    let hours = ticket.and_then(|ticket| notia_backend_core::pomodoro_hours_update(ticket, &plan));
    let hours_changed = apply_mutations(&manager, context, hours.into_iter().collect())?;
    Ok(!plan.entries.is_empty() || hours_changed)
}

/// Runs an action of the user's timer, stores it and logs its event.
fn pomodoro_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    payload: &PomodoroCommandPayload,
) -> Result<PomodoroCommandDto, BackendError> {
    let _guard = POMODORO_LOCK.lock().map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo usar el temporizador.", true))?;
    let file = pomodoro_file(app, context)?;
    let stored = std::fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let adopted = stored.is_none();
    let current = stored
        .or_else(|| payload.legacy_state.clone())
        .map(|value| notia_backend_core::pomodoro::normalize_state(&value))
        .unwrap_or_else(notia_backend_core::pomodoro::default_state);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis() as i64)
        .unwrap_or_default();
    let transition = notia_backend_core::pomodoro::apply(&current, payload.action.clone(), now_ms);
    let mut next = transition.state;
    let (mut changed, mut record_error) = (false, None);
    if let Some((event, timer)) = &transition.event {
        match record_pomodoro_in(app, state, registry, context, (&payload.local_date, &payload.local_time), event, timer) {
            Ok(recorded) => {
                changed = recorded;
                // The deviation of the finished phases was charged to them.
                if matches!(event, PomodoroEvent::PhasesCompleted { .. }) {
                    next.phase_deviation_seconds = 0;
                }
            }
            Err(error) => record_error = Some(error.message),
        }
    }
    if adopted || next != current {
        if let Some(directory) = file.parent() {
            std::fs::create_dir_all(directory)
                .map_err(|_| BackendError::new(BackendErrorCode::Storage, "No se pudo guardar el temporizador.", true))?;
        }
        let text = serde_json::to_string(&next).map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo guardar el temporizador.", true))?;
        let temporary = file.with_extension("json.tmp");
        std::fs::write(&temporary, text)
            .and_then(|_| std::fs::rename(&temporary, &file))
            .map_err(|_| BackendError::new(BackendErrorCode::Storage, "No se pudo guardar el temporizador.", true))?;
    }
    Ok(PomodoroCommandDto { state: next, changed, record_error })
}

/// Runs an action of the Pomodoro timer of the user.
pub(crate) async fn task_manager_pomodoro(
    app: AppHandle,
    payload: PomodoroCommandPayload,
) -> Result<PomodoroCommandDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let context = payload.context.clone().into_core()?;
        let state = app.state::<TaskManagerBackendState>();
        let registry = app.state::<LibraryBindingRegistry>();
        let result = pomodoro_in(&app, &state, &registry, &context, &payload)?;
        if result.changed {
            announce_task_manager_change(&app, &context.library_id);
        }
        Ok(result)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo usar el temporizador.", true))?
}

/// Tells the open interfaces and the publication that the library's Task
/// Manager changed. Published clients reload the full snapshot.
pub(crate) fn announce_task_manager_change(app: &AppHandle, library_id: &str) {
    let _ = app.emit(
        TASK_MANAGER_CHANGED_EVENT,
        json!({ "libraryId": library_id }),
    );
    crate::task_manager_publication_source::announce_store_change(app, library_id);
}

pub(crate) const TASK_MANAGER_CHANGED_EVENT: &str = "task-manager-changed";

/// Owner of the local application, as the Task Manager board knows it.
const LOCAL_OWNER: &str = "user-owner";

fn owner_context(library_id: &str) -> Result<TaskManagerContextDto, BackendError> {
    TaskManagerContextPayload {
        library_id: library_id.to_string(),
        library_user_id: LOCAL_OWNER.to_string(),
        active_board_id: None,
        allowed_board_ids: Vec::new(),
    }
    .into_core()
}

/// Names of the boards of a library, for the owner.
pub(crate) fn owner_board_names(app: &AppHandle, library_id: &str) -> Result<Vec<String>, BackendError> {
    let context = owner_context(library_id)?;
    let state = app.state::<TaskManagerBackendState>();
    let registry = app.state::<LibraryBindingRegistry>();
    let manager = manager(app, &state, &registry, &context.library_id, &context.library_user_id)?;
    Ok(manager.read_snapshot(&context)?.boards.into_iter().map(|board| board.name).collect())
}

/// Creates pending tasks (title and detail) in the first group of `board`,
/// as the owner. Returns how many were created.
pub(crate) fn create_owner_tasks(
    app: &AppHandle,
    library_id: &str,
    board: &str,
    tasks: &[(String, String)],
) -> Result<usize, BackendError> {
    let context = owner_context(library_id)?;
    let state = app.state::<TaskManagerBackendState>();
    let registry = app.state::<LibraryBindingRegistry>();
    let mut created = 0;
    for (title, detail) in tasks {
        let intent = TaskBoardIntent::CreateTask {
            board: board.to_string(),
            title: title.clone(),
            detail: detail.clone(),
            group: String::new(),
            priority: None,
            state: notia_backend_core::task_manager_tools::TaskState::Pending,
            parent_task_name: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            estimated_hours: 0.0,
        };
        if board_execute_in(app, &state, &registry, &context, &intent)? {
            created += 1;
        }
    }
    if created > 0 {
        announce_task_manager_change(app, library_id);
    }
    Ok(created)
}

/// Context of the Task Manager board a library note lives in. Notes inside
/// a board carry the board's context and the editor locks it.
pub(crate) fn board_context_of_document(app: &AppHandle, library_id: &str, logical_path: &str) -> Option<String> {
    let mut segments = logical_path.split('/');
    let root = segments.next()?;
    if !root.eq_ignore_ascii_case("task-mannager") && !root.eq_ignore_ascii_case("task-manager") {
        return None;
    }
    let board = segments.next()?.to_lowercase();
    segments.next()?;
    let state = app.state::<TaskManagerBackendState>();
    let registry = app.state::<LibraryBindingRegistry>();
    let manager = manager(app, &state, &registry, library_id, LOCAL_OWNER).ok()?;
    let context = TaskManagerContextDto::new(library_id, LOCAL_OWNER).ok()?;
    let snapshot = manager.read_snapshot(&context).ok()?;
    snapshot
        .boards
        .iter()
        .find(|candidate| candidate.name.to_lowercase() == board || candidate.board_id.to_lowercase() == board)
        .map(|candidate| {
            candidate
                .context
                .clone()
                .unwrap_or_else(|| notia_backend_core::task_manager_ui::DEFAULT_CONTEXT_TAG.to_string())
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TicketSourcePayload {
    pub context: TaskManagerContextPayload,
    pub logical_path: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub expected_revision: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TicketSourceDto {
    content: String,
    revision: String,
}

/// Only paths of tickets the user can see are accepted as source targets.
fn authorized_ticket_path(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    logical_path: &str,
) -> Result<(), BackendError> {
    let manager = manager(app, state, registry, &context.library_id, &context.library_user_id)?;
    let snapshot = manager.read_snapshot(context)?;
    if snapshot
        .tickets
        .iter()
        .any(|ticket| ticket.summary.logical_path == logical_path)
    {
        Ok(())
    } else {
        Err(BackendError::new(
            BackendErrorCode::NotFound,
            "La tarea no existe o no está disponible.",
            false,
        ))
    }
}

pub(crate) fn task_manager_read_ticket_source(
    app: AppHandle,
    payload: TicketSourcePayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TicketSourceDto, BackendError> {
    let context = payload.context.into_core()?;
    read_ticket_source_in(&app, &state, &registry, &context, &payload.logical_path)
}

fn read_ticket_source_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    logical_path: &str,
) -> Result<TicketSourceDto, BackendError> {
    authorized_ticket_path(app, state, registry, context, logical_path)?;
    let (content, revision) =
        library_store(app, state, registry, &context.library_id)?.read_ticket_source(logical_path)?;
    Ok(TicketSourceDto { content, revision })
}

pub(crate) fn task_manager_write_ticket_source(
    app: AppHandle,
    payload: TicketSourcePayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TicketSourceDto, BackendError> {
    let context = payload.context.into_core()?;
    let content = payload
        .content
        .ok_or_else(|| BackendError::invalid_input("Falta el contenido de la tarea."))?;
    let expected_revision = payload
        .expected_revision
        .ok_or_else(|| BackendError::invalid_input("Falta la revisión leída de la tarea."))?;
    let source = write_ticket_source_in(
        &app,
        &state,
        &registry,
        &context,
        &payload.logical_path,
        content,
        &expected_revision,
    )?;
    announce_task_manager_change(&app, &context.library_id);
    Ok(source)
}

fn write_ticket_source_in(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    context: &TaskManagerContextDto,
    logical_path: &str,
    content: String,
    expected_revision: &str,
) -> Result<TicketSourceDto, BackendError> {
    authorized_ticket_path(app, state, registry, context, logical_path)?;
    let revision = library_store(app, state, registry, &context.library_id)?
        .write_ticket_source(logical_path, &content, expected_revision)?;
    Ok(TicketSourceDto { content, revision })
}

/// Task Manager commands a published session may run besides snapshot and
/// preview/apply. Identity and board scope come from the server session,
/// never from the browser. Returns the result and whether it changed state.
pub(crate) fn task_manager_execute_for_publication(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    allowed_board_ids: Vec<String>,
    command: &str,
    args: &Value,
) -> Result<(Value, bool), BackendError> {
    let context = TaskManagerContextDto {
        library_id: library_id.to_string(),
        library_user_id: library_user_id.to_string(),
        active_board_id: None,
        allowed_board_ids,
    };
    context.validate()?;
    let payload = args.get("payload").unwrap_or(args);
    let text = |key: &str| {
        payload
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| BackendError::invalid_input("Faltan datos de la operación publicada."))
    };
    match command {
        "task_manager_read_ticket_source" => {
            let source = read_ticket_source_in(app, state, registry, &context, &text("logicalPath")?)?;
            Ok((json!(source), false))
        }
        "task_manager_write_ticket_source" => {
            let source = write_ticket_source_in(
                app,
                state,
                registry,
                &context,
                &text("logicalPath")?,
                text("content")?,
                &text("expectedRevision")?,
            )?;
            Ok((json!(source), true))
        }
        "task_manager_board_view" => {
            let mut view = board_view_in(app, state, registry, &context, false)?;
            // A published client never sees where the library lives.
            notia_backend_core::show_board_paths(&mut view, |logical| format!("published-vault/{logical}"));
            Ok((json!(view), false))
        }
        "task_manager_board_execute" => {
            let intent = serde_json::from_value::<TaskBoardIntent>(
                payload.get("intent").cloned().unwrap_or(Value::Null),
            )
            .map_err(|_| BackendError::invalid_input("La operación publicada no es válida."))?;
            let changed = board_execute_in(app, state, registry, &context, &intent)?;
            Ok((json!({ "changed": changed }), changed))
        }
        "task_manager_pomodoro" => {
            let mut command = serde_json::from_value::<PomodoroCommandPayload>(payload.clone())
                .map_err(|_| BackendError::invalid_input("El pomodoro publicado no es válido."))?;
            // Identity and board scope come from the session, not the body.
            command.context = TaskManagerContextPayload {
                library_id: context.library_id.clone(),
                library_user_id: context.library_user_id.clone(),
                active_board_id: None,
                allowed_board_ids: context.allowed_board_ids.clone(),
            };
            let result = pomodoro_in(app, state, registry, &context, &command)?;
            let changed = result.changed;
            Ok((json!(result), changed))
        }
        _ => Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La operación no está disponible en la publicación.",
            false,
        )),
    }
}

fn open_manager(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
) -> Result<Arc<PersistentTaskManager>, BackendError> {
    let key = format!("{library_id}\0{library_user_id}");
    let mut managers = state.managers.lock().map_err(|_| {
        BackendError::new(
            BackendErrorCode::Internal,
            "No se pudo acceder al runtime de Task Manager.",
            true,
        )
    })?;
    if let Some(manager) = managers.get(&key) {
        return Ok(manager.clone());
    }
    let store: Arc<dyn TaskManagerSnapshotStore> =
        Arc::new(library_store(app, state, registry, library_id)?);
    let manager = Arc::new(PersistentTaskManager::open(library_id, store)?);
    manager.ensure_user(library_user_id)?;
    managers.insert(key.clone(), manager.clone());
    while managers.len() > MAX_OPEN_TASK_MANAGERS {
        let eviction_key = managers
            .keys()
            .find(|candidate| candidate.as_str() != key.as_str())
            .cloned();
        let Some(eviction_key) = eviction_key else { break; };
        managers.remove(&eviction_key);
    }
    Ok(manager)
}

pub(crate) fn task_manager_snapshot_for_publication(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    allowed_board_ids: Vec<String>,
) -> Result<TaskManagerSnapshotReadDto, BackendError> {
    let context = TaskManagerContextDto {
        library_id: library_id.to_string(),
        library_user_id: library_user_id.to_string(),
        active_board_id: None,
        allowed_board_ids,
    };
    context.validate()?;
    let manager = manager(app, state, registry, library_id, library_user_id)?;
    TaskManagerSnapshotReadDto::from_snapshot(context.clone(), manager.read_snapshot(&context)?)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskManagerContextPayload {
    pub library_id: String,
    pub library_user_id: String,
    #[serde(default)]
    pub active_board_id: Option<String>,
    #[serde(default)]
    pub allowed_board_ids: Vec<String>,
}

impl TaskManagerContextPayload {
    fn into_core(self) -> Result<TaskManagerContextDto, BackendError> {
        let context = TaskManagerContextDto {
            library_id: self.library_id,
            library_user_id: self.library_user_id,
            active_board_id: self.active_board_id,
            allowed_board_ids: self.allowed_board_ids,
        };
        context.validate()?;
        Ok(context)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notia_backend_core::{InMemoryTaskManager, TaskManagerStoreCommit};

    fn commit_for(
        snapshot: notia_backend_core::TaskManagerLibrarySnapshotDto,
    ) -> TaskManagerStoreCommit {
        TaskManagerStoreCommit {
            library_id: snapshot.library_id.clone(),
            snapshot,
            routes: Vec::new(),
            revisions: Vec::new(),
            operation: notia_backend_core::TaskManagerAppliedOperationDto {
                library_id: "library-test".to_string(),
                library_user_id: "user-owner".to_string(),
                operation_id: "operation-test".to_string(),
                idempotency_key: "idempotency-test".to_string(),
                affected_ids: Vec::new(),
            },
        }
    }

    #[test]
    fn persists_and_reloads_atomically_and_rejects_stale_generation() {
        let root =
            std::env::temp_dir().join(format!("notia-task-manager-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("test root");
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-test", &root)
            .expect("binding");
        let store = MarkdownTaskManagerStore::new(
            "library-test".to_string(),
            registry,
            Arc::new(Mutex::new(())),
        );

        let memory = InMemoryTaskManager::new();
        memory.add_library("library-test").expect("library");
        memory.add_user("library-test", "user-owner").expect("user");
        let snapshot = memory
            .export_snapshot()
            .expect("snapshot")
            .libraries
            .into_iter()
            .next()
            .expect("library snapshot");
        store
            .commit(&commit_for(snapshot.clone()))
            .expect("first commit");
        let loaded = store.load("library-test").expect("load").expect("state");
        assert_eq!(loaded.generation, snapshot.generation);
        assert!(loaded.tickets.is_empty());

        let mut stale = snapshot;
        stale.generation = stale.generation.saturating_add(2);
        let error = store
            .commit(&commit_for(stale))
            .expect_err("stale generation");
        assert_eq!(error.code, BackendErrorCode::Conflict);

        let _ = std::fs::remove_dir_all(root);
    }
}
