use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use notia_backend_core::{
    BackendError, BackendErrorCode, BoundedPage, PersistentTaskManager, TaskBoardDto,
    TaskBoardSummaryDto, TaskContextHitDto, TaskContextSearchRequest, TaskGroupDto,
    TaskManagerContextDto, TaskManagerListRequest, TaskManagerMutationPort, TaskManagerOptionsDto,
    TaskManagerReadPort, TaskManagerSnapshotReadDto, TaskManagerSnapshotStore,
    TaskMutationApplyRequestDto, TaskMutationPreviewDto, TaskMutationReceiptDto,
    TaskMutationRequestDto, TaskTicketListRequest, TaskTicketReadDto, TaskTicketReadRequest,
    TaskTicketSummaryDto,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

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

#[tauri::command]
pub(crate) fn task_manager_pomodoro_entries(
    app: AppHandle,
    payload: TaskManagerContextPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<Vec<notia_backend_core::pomodoro_log::PomodoroEntryDto>, BackendError> {
    let context = payload.into_core()?;
    manager(&app, &state, &registry, &context.library_id, &context.library_user_id)?;
    library_store(&app, &state, &registry, &context.library_id)?.pomodoro_entries()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PomodoroAppendPayload {
    pub context: TaskManagerContextPayload,
    /// Local calendar date and time of the client (`YYYY-MM-DD`, `HH:MM`):
    /// the log is read by people in their own time zone.
    pub local_date: String,
    pub local_time: String,
    pub entry: notia_backend_core::pomodoro_log::PomodoroEntryInput,
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

/// Appends a Pomodoro row with the client's local date and time.
#[tauri::command]
pub(crate) fn task_manager_append_pomodoro(
    app: AppHandle,
    payload: PomodoroAppendPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<(), BackendError> {
    let context = payload.context.into_core()?;
    append_pomodoro_in(
        &app,
        &state,
        &registry,
        &context,
        &payload.local_date,
        &payload.local_time,
        &payload.entry,
    )
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

#[tauri::command]
pub(crate) fn task_manager_delete_pomodoro(
    app: AppHandle,
    payload: PomodoroDeletePayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<bool, BackendError> {
    let context = payload.context.into_core()?;
    manager(&app, &state, &registry, &context.library_id, &context.library_user_id)?;
    library_store(&app, &state, &registry, &context.library_id)?.update_pomodoro_log(|content| {
        Ok(notia_backend_core::pomodoro_log::delete_pomodoro_entry(content, &payload.entry_id))
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

#[tauri::command]
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

#[tauri::command]
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
    write_ticket_source_in(
        &app,
        &state,
        &registry,
        &context,
        &payload.logical_path,
        content,
        &expected_revision,
    )
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
        // The Pomodoro log mixes every board: published sessions may add
        // their own rows but never read or delete the shared history.
        "task_manager_pomodoro_entries" => Ok((json!([]), false)),
        "task_manager_append_pomodoro" => {
            let entry = serde_json::from_value::<notia_backend_core::pomodoro_log::PomodoroEntryInput>(
                payload.get("entry").cloned().unwrap_or(Value::Null),
            )
            .map_err(|_| BackendError::invalid_input("El pomodoro publicado no es válido."))?;
            append_pomodoro_in(
                app,
                state,
                registry,
                &context,
                &text("localDate")?,
                &text("localTime")?,
                &entry,
            )?;
            Ok((json!({ "ok": true }), true))
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

pub(crate) fn task_manager_preview_for_publication(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    allowed_board_ids: Vec<String>,
    mut request: TaskMutationRequestDto,
) -> Result<TaskMutationPreviewDto, BackendError> {
    request.context = TaskManagerContextDto {
        library_id: library_id.to_string(),
        library_user_id: library_user_id.to_string(),
        active_board_id: None,
        allowed_board_ids,
    };
    request.validate()?;
    manager(app, state, registry, library_id, library_user_id)?.preview_mutation(&request)
}

pub(crate) fn task_manager_apply_for_publication(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    allowed_board_ids: Vec<String>,
    mut request: TaskMutationApplyRequestDto,
) -> Result<TaskMutationReceiptDto, BackendError> {
    request.context = TaskManagerContextDto {
        library_id: library_id.to_string(),
        library_user_id: library_user_id.to_string(),
        active_board_id: None,
        allowed_board_ids,
    };
    manager(app, state, registry, library_id, library_user_id)?.apply_mutation(&request)
}

#[derive(Debug, Deserialize)]
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

#[tauri::command]
pub(crate) fn task_manager_snapshot(
    app: AppHandle,
    payload: TaskManagerContextPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskManagerSnapshotReadDto, BackendError> {
    let context = payload.into_core()?;
    let manager = manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?;
    TaskManagerSnapshotReadDto::from_snapshot(context.clone(), manager.read_snapshot(&context)?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskManagerReadOptionsPayload {
    pub context: TaskManagerContextPayload,
    #[serde(default)]
    pub board_id: Option<String>,
}

#[tauri::command]
pub(crate) fn task_manager_list_boards(
    app: AppHandle,
    payload: TaskManagerContextPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<BoundedPage<TaskBoardDto>, BackendError> {
    let context = payload.into_core()?;
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .list_boards(&TaskManagerListRequest {
        context,
        board_id: None,
        offset: 0,
        limit: notia_backend_core::MAX_TASK_RESULTS,
    })
}

#[tauri::command]
pub(crate) fn task_manager_list_groups(
    app: AppHandle,
    payload: TaskManagerReadOptionsPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<BoundedPage<TaskGroupDto>, BackendError> {
    let context = payload.context.into_core()?;
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .list_groups(&TaskManagerListRequest {
        context,
        board_id: payload.board_id,
        offset: 0,
        limit: notia_backend_core::MAX_TASK_RESULTS,
    })
}

#[tauri::command]
pub(crate) fn task_manager_list_tickets(
    app: AppHandle,
    request: TaskTicketListRequest,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<BoundedPage<TaskTicketSummaryDto>, BackendError> {
    let context = request.context.clone();
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .list_tickets(&request)
}

#[tauri::command]
pub(crate) fn task_manager_read_ticket(
    app: AppHandle,
    request: TaskTicketReadRequest,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskTicketReadDto, BackendError> {
    let context = request.context.clone();
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .read_ticket(&request)
}

#[tauri::command]
pub(crate) fn task_manager_search_context(
    app: AppHandle,
    request: TaskContextSearchRequest,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<BoundedPage<TaskContextHitDto>, BackendError> {
    let context = request.context.clone();
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .search_context(&request)
}

#[tauri::command]
pub(crate) fn task_manager_get_options(
    app: AppHandle,
    payload: TaskManagerReadOptionsPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskManagerOptionsDto, BackendError> {
    let context = payload.context.into_core()?;
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .get_options(&context, payload.board_id.as_deref())
}

#[derive(Debug, Deserialize)]
pub(crate) struct TaskManagerBoardSummaryPayload {
    pub context: TaskManagerContextPayload,
    pub board_id: String,
}

#[tauri::command]
pub(crate) fn task_manager_board_summary(
    app: AppHandle,
    payload: TaskManagerBoardSummaryPayload,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskBoardSummaryDto, BackendError> {
    let context = payload.context.into_core()?;
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .board_summary(&context, &payload.board_id)
}

#[tauri::command]
pub(crate) fn task_manager_preview_mutation(
    app: AppHandle,
    request: TaskMutationRequestDto,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskMutationPreviewDto, BackendError> {
    let context = request.context.clone();
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .preview_mutation(&request)
}

#[tauri::command]
pub(crate) fn task_manager_apply_mutation(
    app: AppHandle,
    request: TaskMutationApplyRequestDto,
    state: State<'_, TaskManagerBackendState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<TaskMutationReceiptDto, BackendError> {
    let context = request.context.clone();
    manager(
        &app,
        &state,
        &registry,
        &context.library_id,
        &context.library_user_id,
    )?
    .apply_mutation(&request)
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
