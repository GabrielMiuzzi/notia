use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{mpsc, Arc, Mutex},
};

#[cfg(target_os = "windows")]
use crate::server::http::{
    http_body, is_websocket_upgrade, json_error, json_response, json_response_with_headers,
    read_http_request, request_cookie, request_line_parts, request_origin_is_expected, response,
    serve_http_redirect, text_response, websocket_timeout, PrefixedStream,
};
#[cfg(target_os = "windows")]
use crate::server::network::local_network_ip;
#[cfg(target_os = "windows")]
use rustls::{ServerConfig, ServerConnection, StreamOwned};
#[cfg(target_os = "windows")]
use std::io::{self, Read, Write};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::TryLockError;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "windows")]
use crate::host::{Emitter, Manager};
#[cfg(target_os = "windows")]
use tungstenite::{
    accept_with_config, protocol::WebSocketConfig, Error as WebSocketError, Message, WebSocket,
};

#[cfg(target_os = "windows")]
const MAX_PUBLICATION_WS_MESSAGE_BYTES: usize = 2 * 1024 * 1024;
#[cfg(target_os = "windows")]
const PUBLICATION_PROTOCOL_VERSION: u16 = 1;
#[cfg(target_os = "windows")]
const PUBLICATION_CHANGE_HISTORY_LIMIT: usize = 256;
#[cfg(target_os = "windows")]
const PUBLICATION_WS_QUEUE_LIMIT: usize = 64;
#[cfg(target_os = "windows")]
const MAX_PUBLICATION_AUTHENTICATED_SESSIONS: usize = 64;
#[cfg(target_os = "windows")]
const MAX_PUBLICATION_CONNECTIONS: usize = 128;
#[cfg(target_os = "windows")]
const PUBLICATION_CHANGED_PATH_LIMIT: usize = 32;
#[cfg(target_os = "windows")]
const PUBLICATION_LATENCY_BUCKETS_MS: [u64; 6] = [50, 100, 250, 500, 1_000, 5_000];
const TASK_MANAGER_PUBLICATION_PATH: &str = "/task-manager";
const PUBLISHED_VAULT_ALIAS: &str = "published-vault";
#[cfg(target_os = "windows")]
const PUBLISHED_AI_HOST_REQUEST_EVENT: &str = "notia-task-manager-publication-ai-request";
const DEFAULT_PUBLICATION_CLIENT_LIMIT: usize = 64;
#[cfg(target_os = "windows")]
const PUBLICATION_SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);

#[cfg(target_os = "windows")]
const PUBLICATION_HOST_MUTATION_WAIT: Duration = Duration::from_secs(30);
#[cfg(target_os = "windows")]
const PUBLICATION_BATCH_RECONNECT_GRACE: Duration = Duration::from_secs(20);

#[cfg(target_os = "windows")]
fn publication_client_limit(publication: &TaskManagerPublicationPayload) -> usize {
    publication
        .max_clients
        .clamp(1, MAX_PUBLICATION_AUTHENTICATED_SESSIONS)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedTask {
    title: String,
    detail: String,
    state: String,
    start_date: String,
    end_date: String,
    group: String,
    priority: String,
    dedicated_hours: f64,
    estimated_hours: f64,
    deviation_hours: f64,
    parent_task_name: String,
    order: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PublishedGroup {
    name: String,
    color: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PublishedBoard {
    name: String,
    color: String,
    groups: Vec<PublishedGroup>,
    tasks: Vec<PublishedTask>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TaskManagerPublicationPayload {
    #[serde(rename = "libraryId", default)]
    library_id: Option<String>,
    #[serde(rename = "vaultPath")]
    vault_path: String,
    theme: String,
    #[serde(rename = "maxClients", default = "default_publication_client_limit")]
    max_clients: usize,
    #[serde(rename = "taskRootAtVault", default)]
    task_root_at_vault: bool,
    port: u16,
    #[serde(rename = "aiPreferences")]
    ai_preferences: PublishedAiPreferences,
    settings: Value,
    boards: Vec<PublishedBoard>,
}

fn default_publication_client_limit() -> usize {
    DEFAULT_PUBLICATION_CLIENT_LIMIT
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishedAiPreferences {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    selected_model: String,
    thinking_enabled: bool,
    thinking_level: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedAiStreamRequest {
    prompt: String,
    #[serde(default)]
    previous_messages: Vec<PublishedAiChatMessage>,
    #[serde(default)]
    task_manager_scope_key: Option<String>,
    #[serde(default)]
    scope_paths: Vec<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublishedAiChatMessage {
    role: String,
    content: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationHelloFrame {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: u16,
    message_id: String,
    publication_epoch: Option<String>,
    last_sequence: Option<u64>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationCancelFrame {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: u16,
    message_id: String,
    operation_id: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationMutateFrame {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: u16,
    message_id: String,
    operation_id: String,
    command: String,
    args: Value,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublicationMutationCommand {
    TaskManagerWriteTicketSource,
    TaskManagerBoardExecute,
    TaskManagerPomodoro,
    BeginBatch,
    EndBatch,
}

#[cfg(target_os = "windows")]
impl PublicationMutationCommand {
    fn parse(command: &str) -> Option<Self> {
        match command {
            "task_manager_write_ticket_source" => Some(Self::TaskManagerWriteTicketSource),
            "task_manager_board_execute" => Some(Self::TaskManagerBoardExecute),
            "task_manager_pomodoro" => Some(Self::TaskManagerPomodoro),
            "begin_task_manager_publication_batch" => Some(Self::BeginBatch),
            "end_task_manager_publication_batch" => Some(Self::EndBatch),
            _ => None,
        }
    }

}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct PublicationChange {
    publication_epoch: String,
    sequence: u64,
    revision: u64,
    vault_path: String,
    message_id: String,
    operation_id: Option<String>,
    actor_id: Option<String>,
    settings: Option<Value>,
    changed_paths: Vec<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct PublicationSocketEvent {
    payload: Value,
    close_after_send: bool,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct PublicationSocketSubscriber {
    device_id: String,
    sender: mpsc::SyncSender<PublicationSocketEvent>,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct PublicationAiStream {
    device_id: String,
    cancellation: Arc<AtomicBool>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct PublicationMutationAck {
    result: Value,
    sequence: u64,
    revision: u64,
    changed: bool,
    changed_paths: Vec<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct PublicationMutationBatch {
    changed: bool,
    changed_paths: Vec<String>,
    operation_id: Option<String>,
    actor_id: Option<String>,
    activity_generation: u64,
}

#[cfg(target_os = "windows")]
impl PublicationMutationBatch {
    fn record(
        &mut self,
        changed_paths: Vec<String>,
        operation_id: Option<&str>,
        actor_id: Option<&str>,
    ) {
        self.activity_generation = self.activity_generation.saturating_add(1);
        self.changed = true;
        for path in changed_paths {
            if !self
                .changed_paths
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&path))
            {
                self.changed_paths.push(path);
            }
        }
        if self.changed_paths.len() > PUBLICATION_CHANGED_PATH_LIMIT {
            self.changed_paths.clear();
        }
        self.operation_id = operation_id
            .map(str::to_owned)
            .or(self.operation_id.clone());
        self.actor_id = actor_id.map(str::to_owned).or(self.actor_id.clone());
    }
}

#[derive(Clone, Default)]
pub struct TaskManagerPublicationState {
    inner: Arc<Mutex<PublicationRuntime>>,
}

#[cfg(target_os = "windows")]
fn encode_authenticated_session(user_id: &str) -> String {
    let expires_at = SystemTime::now()
        .checked_add(PUBLICATION_SESSION_TTL)
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(u64::MAX);
    format!("{user_id}\0{expires_at}")
}

fn authenticated_session_user(value: &str) -> &str {
    value
        .split_once('\0')
        .map(|(user, _)| user)
        .unwrap_or(value)
}

#[cfg(target_os = "windows")]
fn authenticated_session_expired(value: &str) -> bool {
    let Some((_, expires_at)) = value.split_once('\0') else {
        // Test fixtures and sessions created by older in-memory versions have
        // no timestamp. They remain valid until the normal revocation path.
        return false;
    };
    expires_at.parse::<u64>().ok().is_some_and(|seconds| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(true, |now| now.as_secs() >= seconds)
    })
}

#[cfg(target_os = "windows")]
fn authenticated_session_active(runtime: &PublicationRuntime, session_id: &str) -> bool {
    runtime
        .authenticated_sessions
        .get(session_id)
        .is_some_and(|value| !authenticated_session_expired(value))
}

#[cfg(target_os = "windows")]
fn prune_expired_authenticated_sessions(runtime_state: &Arc<Mutex<PublicationRuntime>>) {
    if let Ok(mut runtime) = runtime_state.lock() {
        let expired_users: HashSet<String> = runtime
            .authenticated_sessions
            .values()
            .filter(|value| authenticated_session_expired(value))
            .map(|value| authenticated_session_user(value).to_string())
            .collect();
        if expired_users.is_empty() {
            return;
        }
        runtime
            .authenticated_sessions
            .retain(|_, value| !expired_users.contains(authenticated_session_user(value)));
        for user_id in expired_users {
            cancel_publication_ai_streams_for_device(&mut runtime, &user_id);
            cancel_published_ai_host_requests_for_user(&mut runtime, &user_id);
            close_websocket_subscribers_for_device(&mut runtime, &user_id, "session-expired");
        }
    }
}

pub fn revoke_library_user_sessions(state: &TaskManagerPublicationState, user_id: &str) {
    if let Ok(mut runtime) = state.inner.lock() {
        runtime
            .authenticated_sessions
            .retain(|_, session_user_id| authenticated_session_user(session_user_id) != user_id);
        #[cfg(target_os = "windows")]
        {
            cancel_publication_ai_streams_for_device(&mut runtime, user_id);
            cancel_published_ai_host_requests_for_user(&mut runtime, user_id);
            close_websocket_subscribers_for_device(&mut runtime, user_id, "session-revoked");
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct PublicationMetrics {
    websocket_frames_received: u64,
    websocket_frames_sent: u64,
    websocket_bytes_received: u64,
    websocket_bytes_sent: u64,
    dropped_events: u64,
    resync_required: u64,
    conflicts: u64,
    mutations_applied: u64,
    mutation_errors: u64,
    ai_stream_cancellations: u64,
    last_change_at_unix_ms: Option<u64>,
    mutation_latency_buckets: [u64; 6],
    mutation_latency_samples: u64,
    mutation_latency_last_ms: Option<u64>,
    mutation_latency_p95_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerPublicationStatus {
    active: bool,
    authenticated_sessions: usize,
    websocket_sessions: usize,
    max_authenticated_sessions: usize,
    max_websocket_sessions: usize,
    publication_epoch: String,
    revision: u64,
    sequence: u64,
    last_operation_id: Option<String>,
    last_actor_id: Option<String>,
    websocket_frames_received: u64,
    websocket_frames_sent: u64,
    websocket_bytes_received: u64,
    websocket_bytes_sent: u64,
    dropped_events: u64,
    resync_required: u64,
    conflicts: u64,
    mutations_applied: u64,
    mutation_errors: u64,
    ai_stream_cancellations: u64,
    last_change_at_unix_ms: Option<u64>,
    mutation_latency_samples: u64,
    mutation_latency_last_ms: Option<u64>,
    mutation_latency_p95_ms: Option<u64>,
    recovery_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerPublicationCursor {
    publication_epoch: String,
    sequence: u64,
    revision: u64,
}

#[derive(Default)]
struct PublicationRuntime {
    port: Option<u16>,
    payload: Option<TaskManagerPublicationPayload>,
    server_started: bool,
    authenticated_sessions: HashMap<String, String>,
    #[cfg(target_os = "windows")]
    publication_epoch: String,
    #[cfg(target_os = "windows")]
    revision: u64,
    #[cfg(target_os = "windows")]
    sequence: u64,
    #[cfg(target_os = "windows")]
    change_history: VecDeque<PublicationChange>,
    #[cfg(target_os = "windows")]
    websocket_subscribers: HashMap<u64, PublicationSocketSubscriber>,
    #[cfg(target_os = "windows")]
    next_websocket_subscriber_id: u64,
    #[cfg(target_os = "windows")]
    active_ai_streams: HashMap<u64, PublicationAiStream>,
    #[cfg(target_os = "windows")]
    published_ai_requests: HashMap<String, (String, mpsc::Sender<Value>)>,
    #[cfg(target_os = "windows")]
    next_ai_stream_id: u64,
    #[cfg(target_os = "windows")]
    completed_mutations: HashMap<String, PublicationMutationAck>,
    #[cfg(target_os = "windows")]
    mutation_lock: Arc<Mutex<()>>,
    #[cfg(target_os = "windows")]
    active_connections: usize,
    #[cfg(target_os = "windows")]
    host_mutation_active: bool,
    #[cfg(target_os = "windows")]
    host_mutation_batch: PublicationMutationBatch,
    #[cfg(target_os = "windows")]
    recovery_required: bool,
    #[cfg(target_os = "windows")]
    metrics: PublicationMetrics,
    #[cfg(target_os = "windows")]
    last_operation_id: Option<String>,
    #[cfg(target_os = "windows")]
    last_actor_id: Option<String>,
    #[cfg(target_os = "windows")]
    mutation_batches: HashMap<String, PublicationMutationBatch>,
    #[cfg(target_os = "windows")]
    rate_limit_windows: crate::server::rate::RateWindows,
    #[cfg(target_os = "windows")]
    app_handle: Option<crate::host::AppHandle>,
    #[cfg(target_os = "windows")]
    assets: Option<Arc<crate::host::AssetResolver<crate::host::Wry>>>,
}

#[cfg(target_os = "windows")]
pub fn publish_task_manager_ai_stream_event(
    state: crate::host::State<'_, TaskManagerPublicationState>,
    request_id: String,
    event: Value,
) -> Result<(), String> {
    if request_id.trim().is_empty() {
        return Err("La solicitud de IA publicada no es válida.".to_string());
    }
    let sender = state
        .inner
        .lock()
        .map_err(|_| "No se pudo comunicar con la publicación.")?
        .published_ai_requests
        .get(&request_id)
        .map(|(_, sender)| sender.clone())
        .ok_or_else(|| "La solicitud de IA publicada ya no está disponible.".to_string())?;
    sender
        .send(event)
        .map_err(|_| "El stream de IA publicado ya no está disponible.".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn publish_task_manager_ai_stream_event(
    _state: crate::host::State<'_, TaskManagerPublicationState>,
    _request_id: String,
    _event: Value,
) -> Result<(), String> {
    Err("El streaming de IA publicada solo está disponible en Windows.".to_string())
}

pub fn publish_task_manager_boards(
    app: crate::host::AppHandle,
    state: crate::host::State<'_, TaskManagerPublicationState>,
    registry: crate::host::State<'_, crate::library_registry::LibraryBindingRegistry>,
    mut payload: TaskManagerPublicationPayload,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, registry, payload);
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        if payload.boards.is_empty() {
            return Err("Seleccioná al menos un tablero para publicar.".to_string());
        }
        if payload.vault_path.trim().is_empty() {
            return Err("No hay una biblioteca activa para publicar.".to_string());
        }
        let library_id = payload
            .library_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La publicación requiere la identidad de la biblioteca.".to_string())?;
        crate::library_users::authorize_task_manager_user(
            &app,
            &registry,
            library_id,
            "user-owner",
        )
        .map_err(|error| error.message)?;
        if payload.port < 1024 {
            return Err("Elegí un puerto entre 1024 y 65535.".to_string());
        }
        payload.task_root_at_vault = std::path::Path::new(&payload.vault_path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.eq_ignore_ascii_case("task-mannager")
                    || name.eq_ignore_ascii_case("task-manager")
            });
        let requested_port = payload.port;
        let runtime = state.inner.clone();
        let tls_config = publication_tls_config(&app)?;
        let mutation_lock = runtime
            .lock()
            .map_err(|_| "No se pudo serializar la publicación.".to_string())?
            .mutation_lock
            .clone();
        let _mutation_guard = mutation_lock
            .lock()
            .map_err(|_| "No se pudo serializar la publicación.".to_string())?;
        let should_start = {
            let mut guard = runtime
                .lock()
                .map_err(|_| "No se pudo actualizar la publicación.")?;
            close_publication_websocket_subscribers(&mut guard, "publication-reconfigured", false);
            guard.assets = Some(Arc::new(app.asset_resolver()));
            guard.payload = Some(payload);
            guard.authenticated_sessions.clear();
            guard.publication_epoch = generate_session_token();
            guard.revision = 0;
            guard.sequence = 0;
            guard.change_history.clear();
            guard.completed_mutations.clear();
            guard.rate_limit_windows.clear();
            guard.metrics = PublicationMetrics::default();
            guard.last_operation_id = None;
            guard.last_actor_id = None;
            guard.host_mutation_active = false;
            guard.host_mutation_batch = PublicationMutationBatch::default();
            guard.recovery_required = false;
            guard.mutation_batches.clear();
            guard.app_handle = Some(app.clone());
            let should_start = !guard.server_started;
            guard.server_started = true;
            should_start
        };
        let port = if should_start {
            match start_publication_server(runtime.clone(), tls_config, requested_port) {
                Ok(port) => port,
                Err(error) => {
                    if let Ok(mut guard) = runtime.lock() {
                        guard.server_started = false;
                        guard.port = None;
                    }
                    return Err(error);
                }
            }
        } else {
            publication_port(&runtime)?
        };
        Ok(publication_url(port))
    }
}

pub fn open_task_manager_publication(
    state: crate::host::State<'_, TaskManagerPublicationState>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo abrir la publicación.")?;
        let port = guard
            .port
            .ok_or_else(|| "Primero publicá al menos un tablero.".to_string())?;
        if guard.payload.is_none() {
            return Err("Primero publicá al menos un tablero.".to_string());
        }
        let url = format!("https://127.0.0.1:{port}{TASK_MANAGER_PUBLICATION_PATH}");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|_| "No se pudo abrir el navegador predeterminado.")?;
        Ok(())
    }
}

pub fn get_task_manager_publication_url(
    state: crate::host::State<'_, TaskManagerPublicationState>,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo consultar la publicación.")?;
        let port = guard
            .port
            .filter(|_| guard.payload.is_some())
            .ok_or_else(|| "No hay tableros publicados.".to_string())?;
        Ok(publication_url(port))
    }
}

pub fn get_task_manager_publication_status(
    state: crate::host::State<'_, TaskManagerPublicationState>,
) -> Result<TaskManagerPublicationStatus, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Ok(TaskManagerPublicationStatus {
            active: false,
            authenticated_sessions: 0,
            websocket_sessions: 0,
            max_authenticated_sessions: 0,
            max_websocket_sessions: 0,
            publication_epoch: String::new(),
            revision: 0,
            sequence: 0,
            last_operation_id: None,
            last_actor_id: None,
            websocket_frames_received: 0,
            websocket_frames_sent: 0,
            websocket_bytes_received: 0,
            websocket_bytes_sent: 0,
            dropped_events: 0,
            resync_required: 0,
            conflicts: 0,
            mutations_applied: 0,
            mutation_errors: 0,
            ai_stream_cancellations: 0,
            last_change_at_unix_ms: None,
            mutation_latency_samples: 0,
            mutation_latency_last_ms: None,
            mutation_latency_p95_ms: None,
            recovery_required: false,
        })
    }
    #[cfg(target_os = "windows")]
    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo consultar el estado de la publicación.")?;
        Ok(publication_status_from_runtime(&guard))
    }
}

#[cfg(target_os = "windows")]
fn publication_status_from_runtime(guard: &PublicationRuntime) -> TaskManagerPublicationStatus {
    TaskManagerPublicationStatus {
        active: guard.payload.is_some() && guard.server_started,
        authenticated_sessions: guard.authenticated_sessions.len(),
        websocket_sessions: guard.websocket_subscribers.len(),
        max_authenticated_sessions: guard
            .payload
            .as_ref()
            .map(publication_client_limit)
            .unwrap_or(DEFAULT_PUBLICATION_CLIENT_LIMIT),
        max_websocket_sessions: guard
            .payload
            .as_ref()
            .map(publication_client_limit)
            .unwrap_or(DEFAULT_PUBLICATION_CLIENT_LIMIT),
        publication_epoch: guard.publication_epoch.clone(),
        revision: guard.revision,
        sequence: guard.sequence,
        last_operation_id: guard.last_operation_id.clone(),
        last_actor_id: guard.last_actor_id.clone(),
        websocket_frames_received: guard.metrics.websocket_frames_received,
        websocket_frames_sent: guard.metrics.websocket_frames_sent,
        websocket_bytes_received: guard.metrics.websocket_bytes_received,
        websocket_bytes_sent: guard.metrics.websocket_bytes_sent,
        dropped_events: guard.metrics.dropped_events,
        resync_required: guard.metrics.resync_required,
        conflicts: guard.metrics.conflicts,
        mutations_applied: guard.metrics.mutations_applied,
        mutation_errors: guard.metrics.mutation_errors,
        ai_stream_cancellations: guard.metrics.ai_stream_cancellations,
        last_change_at_unix_ms: guard.metrics.last_change_at_unix_ms,
        mutation_latency_samples: guard.metrics.mutation_latency_samples,
        mutation_latency_last_ms: guard.metrics.mutation_latency_last_ms,
        mutation_latency_p95_ms: guard.metrics.mutation_latency_p95_ms,
        recovery_required: guard.recovery_required,
    }
}

pub fn stop_task_manager_publication(
    state: crate::host::State<'_, TaskManagerPublicationState>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let mutation_lock = state
            .inner
            .lock()
            .map_err(|_| "No se pudo serializar la detención.".to_string())?
            .mutation_lock
            .clone();
        let _mutation_guard = mutation_lock
            .lock()
            .map_err(|_| "No se pudo serializar la detención.".to_string())?;
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo detener la publicación.")?;
        close_publication_websocket_subscribers(&mut guard, "publication-stopped", true);
        guard.payload = None;
        guard.host_mutation_active = false;
        guard.host_mutation_batch = PublicationMutationBatch::default();
        guard.recovery_required = false;
        guard.authenticated_sessions.clear();
        guard.rate_limit_windows.clear();
        guard.mutation_batches.clear();
        Ok(())
    }
}

pub async fn begin_task_manager_publication_batch(
    state: crate::host::State<'_, TaskManagerPublicationState>,
) -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        return Ok(false);
    }
    #[cfg(target_os = "windows")]
    {
        let runtime = Arc::clone(&state.inner);
        crate::host::async_runtime::spawn_blocking(move || begin_host_publication_batch(&runtime))
            .await
            .map_err(|_| "No se pudo esperar el turno de la operación local.".to_string())?
    }
}

#[cfg(target_os = "windows")]
fn begin_host_publication_batch(runtime: &Arc<Mutex<PublicationRuntime>>) -> Result<bool, String> {
    let mutation_lock = runtime
        .lock()
        .map_err(|_| "No se pudo serializar el lote de Task Manager.".to_string())?
        .mutation_lock
        .clone();
    let deadline = Instant::now() + PUBLICATION_HOST_MUTATION_WAIT;
    loop {
        if Instant::now() >= deadline {
            return Err("Otra sesión está terminando una operación. Volvé a intentar.".to_string());
        }
        let mutation_guard = match mutation_lock.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            Err(TryLockError::Poisoned(_)) => {
                return Err("No se pudo serializar el lote de Task Manager.".to_string())
            }
        };
        let mut guard = runtime
            .lock()
            .map_err(|_| "No se pudo iniciar el lote de Task Manager.")?;
        if guard.payload.is_none() {
            return Ok(false);
        }
        if guard.host_mutation_active {
            return Err("Ya existe una operación local de Task Manager en curso.".to_string());
        }
        if guard.mutation_batches.is_empty() {
            guard.host_mutation_active = true;
            guard.host_mutation_batch = PublicationMutationBatch::default();
            drop(guard);
            drop(mutation_guard);
            return Ok(true);
        }
        drop(guard);
        drop(mutation_guard);
        std::thread::sleep(Duration::from_millis(10));
    }
}

pub fn end_task_manager_publication_batch(
    state: crate::host::State<'_, TaskManagerPublicationState>,
) -> Result<Option<TaskManagerPublicationCursor>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        return Ok(None);
    }
    #[cfg(target_os = "windows")]
    {
        let mutation_lock = state
            .inner
            .lock()
            .map_err(|_| "No se pudo serializar el cierre del lote.".to_string())?
            .mutation_lock
            .clone();
        let _mutation_guard = mutation_lock
            .lock()
            .map_err(|_| "No se pudo serializar el cierre del lote.".to_string())?;
        let (vault_path, batch) = {
            let mut guard = state
                .inner
                .lock()
                .map_err(|_| "No se pudo cerrar el lote de Task Manager.")?;
            if !guard.host_mutation_active {
                return Ok(None);
            }
            let vault_path = guard
                .payload
                .as_ref()
                .map(|publication| publication.vault_path.clone());
            let batch = std::mem::take(&mut guard.host_mutation_batch);
            guard.host_mutation_active = false;
            (vault_path, batch)
        };

        if let Some(vault_path) = vault_path {
            if batch.changed {
                notify_publication_changed(
                    &state.inner,
                    &vault_path,
                    batch.changed_paths,
                    batch.operation_id.as_deref(),
                    batch.actor_id.as_deref(),
                    None,
                );
            }
        }

        let guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo consultar el cursor del lote de Task Manager.")?;
        Ok(guard
            .payload
            .as_ref()
            .map(|_| TaskManagerPublicationCursor {
                publication_epoch: guard.publication_epoch.clone(),
                sequence: guard.sequence,
                revision: guard.revision,
            }))
    }
}

/// Whether the running publication serves this library.
pub(crate) fn is_publishing_library(state: &TaskManagerPublicationState, library_id: &str) -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, library_id);
        false
    }
    #[cfg(target_os = "windows")]
    {
        state.inner.lock().is_ok_and(|guard| {
            guard
                .payload
                .as_ref()
                .is_some_and(|publication| publication.library_id.as_deref() == Some(library_id))
        })
    }
}

/// Announces a Task Manager change made by the host to the published
/// clients of the same library, refreshing the published board settings
/// first. Clients reload the full snapshot.
pub(crate) fn announce_host_change(
    state: &TaskManagerPublicationState,
    library_id: &str,
    settings: Option<Value>,
) {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, library_id, settings);
    }
    #[cfg(target_os = "windows")]
    {
        let vault_path = {
            let Ok(mut guard) = state.inner.lock() else {
                return;
            };
            let Some(publication) = guard.payload.clone() else {
                return;
            };
            if publication.library_id.as_deref() != Some(library_id) {
                return;
            }
            let settings = settings.and_then(|settings| {
                sanitize_publication_settings(settings, &publication)
                    .and_then(|settings| merge_shared_publication_settings(settings, &publication.settings))
                    .ok()
            });
            if let (Some(settings), Some(active)) = (settings, guard.payload.as_mut()) {
                active.settings = settings;
            }
            publication.vault_path
        };
        notify_publication_changed(&state.inner, &vault_path, Vec::new(), None, Some("host"), None);
    }
}

#[cfg(target_os = "windows")]
fn sanitize_publication_settings(
    mut settings: Value,
    publication: &TaskManagerPublicationPayload,
) -> Result<Value, String> {
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "Los settings de publicación son inválidos.".to_string())?;
    let allowed_boards = publication
        .boards
        .iter()
        .map(|board| board.name.to_lowercase())
        .collect::<HashSet<_>>();
    if let Some(Value::Array(boards)) = object.get_mut("boards") {
        let mut seen = HashSet::new();
        *boards = boards
            .iter()
            .filter_map(|board| {
                let name = board
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| is_safe_publication_name(name, 120))
                    .map(str::to_lowercase)?;
                if !allowed_boards.contains(&name) || !seen.insert(name.clone()) {
                    return None;
                }
                let color = board
                    .get("color")
                    .and_then(Value::as_str)
                    .filter(|color| is_safe_publication_color(color))
                    .unwrap_or("#2e6db0");
                let activity_hours = board
                    .get("activityHoursPerDay")
                    .and_then(Value::as_f64)
                    .filter(|hours| hours.is_finite())
                    .map(|hours| hours.clamp(0.0, 24.0))
                    .unwrap_or(24.0);
                let contexto = board
                    .get("contexto")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|context| is_safe_publication_context(context))
                    .unwrap_or("#Personal");
                Some(serde_json::json!({
                    "name": name,
                    "color": color,
                    "activityHoursPerDay": activity_hours,
                    "contexto": contexto,
                }))
            })
            .take(64)
            .collect();
    }
    if let Some(Value::Array(groups)) = object.get_mut("groups") {
        let mut seen = HashSet::new();
        *groups = groups
            .iter()
            .filter_map(|group| {
                let name = group
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| is_safe_publication_name(name, 180))?
                    .to_string();
                let board = group
                    .get("board")
                    .and_then(Value::as_str)
                    .unwrap_or("default")
                    .trim()
                    .to_lowercase();
                if !allowed_boards.contains(&board) {
                    return None;
                }
                let key = format!("{board}::{name}");
                if !seen.insert(key) {
                    return None;
                }
                let color = group
                    .get("color")
                    .and_then(Value::as_str)
                    .filter(|color| is_safe_publication_color(color))
                    .unwrap_or("#2e6db0");
                Some(serde_json::json!({
                    "name": name,
                    "color": color,
                    "board": board,
                }))
            })
            .take(512)
            .collect();
    }
    Ok(settings)
}

#[cfg(target_os = "windows")]
fn is_safe_publication_name(value: &str, max_length: usize) -> bool {
    !value.is_empty()
        && value.chars().count() <= max_length
        && !value.chars().any(|character| character.is_control())
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains('<')
        && !value.contains('>')
        && !value.contains('"')
        && !value.contains('&')
}

#[cfg(target_os = "windows")]
fn is_safe_publication_context(value: &str) -> bool {
    value.len() <= 120
        && value.starts_with('#')
        && !value[1..].is_empty()
        && !value[1..].contains('#')
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

#[cfg(target_os = "windows")]
fn is_safe_publication_color(value: &str) -> bool {
    let value = value.trim();
    matches!(value.len(), 4 | 7 | 9)
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

#[cfg(target_os = "windows")]
fn merge_shared_publication_settings(candidate: Value, current: &Value) -> Result<Value, String> {
    let candidate = candidate
        .as_object()
        .ok_or_else(|| "Los settings de publicacion son invalidos.".to_string())?;
    let current = current
        .as_object()
        .ok_or_else(|| "Los settings actuales de publicacion son invalidos.".to_string())?;
    let mut merged = serde_json::Map::new();
    for key in ["boards", "groups"] {
        if let Some(value) = candidate.get(key).or_else(|| current.get(key)) {
            merged.insert(key.to_string(), value.clone());
        }
    }
    merged.insert("activeVaultPath".to_string(), Value::Null);
    Ok(Value::Object(merged))
}

#[cfg(target_os = "windows")]
fn publication_tls_config(app: &crate::host::AppHandle) -> Result<Arc<ServerConfig>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "No se pudo resolver el directorio del certificado HTTPS.")?
        .join("task-manager-publication");
    crate::server::tls::server_config(&directory)
}

#[cfg(target_os = "windows")]
fn start_publication_server(
    runtime: Arc<Mutex<PublicationRuntime>>,
    tls_config: Arc<ServerConfig>,
    requested_port: u16,
) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("0.0.0.0", requested_port)).map_err(|_| {
        let recommended_port = std::net::TcpListener::bind("0.0.0.0:0")
            .ok()
            .and_then(|listener| listener.local_addr().ok().map(|address| address.port()))
            .unwrap_or(52471);
        format!("El puerto {requested_port} no está disponible. Puerto libre recomendado: {recommended_port}.")
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| "No se pudo determinar el puerto.")?
        .port();
    runtime
        .lock()
        .map_err(|_| "No se pudo iniciar la publicación.")?
        .port = Some(port);
    std::thread::Builder::new()
        .name("notia-task-manager-publication".to_string())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let peer_address = stream
                    .peer_addr()
                    .ok()
                    .map(|address| address.ip().to_string());
                let runtime = runtime.clone();
                let accepted = runtime.lock().ok().is_some_and(|mut guard| {
                    if guard.active_connections >= MAX_PUBLICATION_CONNECTIONS {
                        return false;
                    }
                    guard.active_connections += 1;
                    true
                });
                if !accepted {
                    continue;
                }
                let tls_config = tls_config.clone();
                let connection_runtime = runtime.clone();
                let spawned = std::thread::Builder::new()
                    .name("notia-task-manager-https".to_string())
                    .spawn(move || {
                        let _slot = PublicationConnectionSlot {
                            runtime: connection_runtime.clone(),
                        };
                        serve_publication_connection(
                            stream,
                            connection_runtime,
                            tls_config,
                            peer_address,
                        );
                    });
                if spawned.is_err() {
                    if let Ok(mut guard) = runtime.lock() {
                        guard.active_connections = guard.active_connections.saturating_sub(1);
                    }
                }
            }
        })
        .map_err(|_| "No se pudo iniciar el servidor de publicación.")?;
    Ok(port)
}

#[cfg(target_os = "windows")]
struct PublicationConnectionSlot {
    runtime: Arc<Mutex<PublicationRuntime>>,
}

#[cfg(target_os = "windows")]
impl Drop for PublicationConnectionSlot {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.runtime.lock() {
            guard.active_connections = guard.active_connections.saturating_sub(1);
        }
    }
}

#[cfg(target_os = "windows")]
fn serve_publication_connection(
    stream: std::net::TcpStream,
    runtime: Arc<Mutex<PublicationRuntime>>,
    tls_config: Arc<ServerConfig>,
    peer_address: Option<String>,
) {
    prune_expired_authenticated_sessions(&runtime);
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
    let mut first_byte = [0_u8; 1];
    let is_tls = matches!(stream.peek(&mut first_byte), Ok(1)) && first_byte[0] == 22;
    if !is_tls {
        serve_http_redirect(stream);
        return;
    }
    let connection = match ServerConnection::new(tls_config) {
        Ok(connection) => connection,
        Err(_) => return,
    };
    serve_request(
        StreamOwned::new(connection, stream),
        runtime,
        peer_address.as_deref(),
    );
}

#[cfg(target_os = "windows")]
fn serve_request<S: Read + Write + Send + 'static>(
    mut stream: S,
    runtime: Arc<Mutex<PublicationRuntime>>,
    peer_address: Option<&str>,
) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(status) => {
            let _ = stream.write_all(&text_response(status, "Solicitud HTTP inválida."));
            return;
        }
    };
    let Some((method, path)) = request_line_parts(&request) else {
        let _ = stream.write_all(&text_response("400 Bad Request", "Solicitud inválida."));
        return;
    };
    if method == "GET" && path == "/favicon.ico" {
        let _ = stream.write_all(&response("204 No Content", "image/x-icon", &[]));
        return;
    }
    let base = TASK_MANAGER_PUBLICATION_PATH;
    if method == "GET" && path == format!("{base}/ws") {
        if !is_websocket_upgrade(&request) {
            let _ = stream.write_all(&text_response(
                "426 Upgrade Required",
                "Esta ruta requiere una conexión WebSocket.",
            ));
            return;
        }
        let authenticated = runtime.lock().ok().is_some_and(|guard| {
            guard.payload.is_some()
                && request_session_token(&request)
                    .is_some_and(|session| authenticated_session_active(&guard, session))
        });
        if !authenticated {
            let _ = stream.write_all(&text_response(
                "401 Unauthorized",
                "Ingresá la contraseña para acceder.",
            ));
            return;
        }
        if !allow_publication_rate(
            &runtime,
            format!("websocket-ip:{}", peer_address.unwrap_or("unknown")),
            120,
            Duration::from_secs(60),
        ) {
            let response = publication_rate_limited_response(
                "Demasiadas conexiones WebSocket desde esta dirección. Esperá antes de volver a intentar.",
            );
            let _ = stream.write_all(&response);
            return;
        }
        let Some(session_id) = request_session_token(&request).map(str::to_owned) else {
            let _ = stream.write_all(&text_response("401 Unauthorized", "Sesión inválida."));
            return;
        };
        serve_publication_websocket(PrefixedStream::new(request, stream), runtime, session_id);
        return;
    }
    let snapshot = runtime.lock().ok().and_then(|guard| {
        Some((
            guard.payload.clone()?,
            Arc::clone(guard.assets.as_ref()?),
            request_session_token(&request)
                .is_some_and(|session| authenticated_session_active(&guard, session)),
        ))
    });
    let Some((publication, assets, authenticated)) = snapshot else {
        let _ = stream.write_all(&text_response(
            "404 Not Found",
            "Publicación no disponible.",
        ));
        return;
    };
    if authenticated && method == "POST" && !request_origin_is_expected(&request) {
        let response = text_response("403 Forbidden", "Origen no autorizado.");
        let _ = stream.write_all(&response);
        return;
    }
    let ip_rate_limit = match (method, path.as_str()) {
        ("POST", path) if path == format!("{base}/login") => Some((30, "login")),
        ("POST", path) if path == format!("{base}/ai/stream") => Some((60, "ai")),
        ("POST", path) if path == format!("{base}/invoke") => Some((240, "invoke")),
        ("GET", path) if path == format!("{base}/status") => Some((120, "status")),
        _ => None,
    };
    if let Some((limit, bucket)) = ip_rate_limit {
        if !allow_publication_rate(
            &runtime,
            format!("{bucket}-ip:{}", peer_address.unwrap_or("unknown")),
            limit,
            Duration::from_secs(60),
        ) {
            let response = publication_rate_limited_response(
                "Demasiadas solicitudes desde esta dirección. Esperá antes de volver a intentar.",
            );
            let _ = stream.write_all(&response);
            return;
        }
    }
    let session_rate_key = request_session_token(&request)
        .map(|session| session.to_string())
        .unwrap_or_else(|| "anonymous".to_string());
    if authenticated
        && method == "POST"
        && path == format!("{base}/ai/stream")
        && !allow_publication_rate(
            &runtime,
            format!("ai-stream:{session_rate_key}"),
            12,
            Duration::from_secs(60),
        )
    {
        let response = publication_rate_limited_response(
            "Demasiadas solicitudes de streaming de IA. Esperá antes de volver a intentar.",
        );
        let _ = stream.write_all(&response);
        return;
    }
    if authenticated && method == "POST" && path == format!("{base}/ai/stream") {
        let Some(session_id) = request_session_token(&request) else {
            let _ = stream.write_all(&text_response("401 Unauthorized", "Sesión inválida."));
            return;
        };
        let Some(current_publication) = current_authenticated_publication(&runtime, session_id)
        else {
            let _ = stream.write_all(&text_response(
                "401 Unauthorized",
                "La sesión ya no está autorizada.",
            ));
            return;
        };
        serve_publication_ai_stream(
            &mut stream,
            http_body(&request),
            &current_publication,
            &runtime,
            session_id,
        );
        return;
    }
    let response = if authenticated
        && method == "GET"
        && path == format!("{base}/bootstrap")
        && !allow_publication_rate(
            &runtime,
            format!("bootstrap:{session_rate_key}"),
            120,
            Duration::from_secs(60),
        ) {
        publication_rate_limited_response(
            "Demasiadas solicitudes de sincronización. Esperá antes de volver a intentar.",
        )
    } else if authenticated
        && method == "POST"
        && path == format!("{base}/invoke")
        && !allow_publication_rate(
            &runtime,
            format!("invoke:{session_rate_key}"),
            120,
            Duration::from_secs(60),
        )
    {
        publication_rate_limited_response(
            "Demasiadas operaciones pendientes. Esperá antes de volver a intentar.",
        )
    } else if authenticated && method == "GET" && path == format!("{base}/status") {
        match runtime.lock() {
            Ok(guard) => serde_json::to_value(publication_status_from_runtime(&guard))
                .map(|status| json_response("200 OK", status))
                .unwrap_or_else(|_| {
                    json_error("No se pudo consultar el estado de la publicación.")
                }),
            Err(_) => json_error("No se pudo consultar el estado de la publicación."),
        }
    } else if method == "GET" && (path == base || path == format!("{base}/")) {
        serve_library_user_login_page()
    } else if method == "POST" && path == format!("{base}/login") {
        serve_library_user_login(http_body(&request), &runtime, &publication.vault_path, base)
    } else if !authenticated {
        json_response(
            "401 Unauthorized",
            serde_json::json!({ "error": "Ingresá la contraseña para acceder." }),
        )
    } else if method == "GET" && path == format!("{base}/app") {
        serve_publication_index(assets.as_ref())
    } else if method == "GET" && path == format!("{base}/bootstrap") {
        json_response(
            "200 OK",
            build_publication_bootstrap(&publication, &runtime, request_session_token(&request)),
        )
    } else if method == "POST" && path == format!("{base}/invoke") {
        serve_invoke(
            http_body(&request),
            &runtime,
            request_session_token(&request),
        )
    } else if method == "GET" && path.starts_with(&format!("{base}/assets/")) {
        serve_asset(
            assets.as_ref(),
            path.trim_start_matches(&format!("{base}/")),
        )
    } else {
        text_response("404 Not Found", "No existe.")
    };
    let _ = stream.write_all(&response);
}

#[cfg(target_os = "windows")]
fn build_publication_client_settings(publication: &TaskManagerPublicationPayload) -> Value {
    let sanitized = sanitize_publication_settings(publication.settings.clone(), publication)
        .unwrap_or_else(|_| serde_json::json!({}));
    let boards = sanitized
        .get("boards")
        .filter(|value| value.is_array())
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let groups = sanitized
        .get("groups")
        .filter(|value| value.is_array())
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let board_names = boards
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(str::to_lowercase)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let active_tab = sanitized
        .get("activeTab")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| board_names.contains(&name.to_lowercase()))
        .map(str::to_lowercase)
        .or_else(|| {
            boards
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("name"))
                .and_then(Value::as_str)
                .map(str::to_lowercase)
        })
        .unwrap_or_else(|| "default".to_string());

    // Only shared board/group metadata crosses the publication boundary. The
    // timer and selection are deliberately reset per browser and never carry
    // local vault paths from the host payload.
    serde_json::json!({
        "activeVaultPath": null,
        "boards": boards,
        "groups": groups,
        "pomodoro": {
            "phase": "work",
            "runState": "idle",
            "remainingSeconds": 0,
            "endTimestamp": null,
            "completedWorkCycles": 0,
            "selectedTaskPath": null,
            "isDeviationActive": false,
            "deviationStartedAt": null,
            "deviationBaseRemainingSeconds": 0,
            "phaseDeviationSeconds": 0,
            "durations": {
                "workMinutes": 25,
                "shortBreakMinutes": 5,
                "longBreakMinutes": 15,
            },
        },
        "activeTab": active_tab,
    })
}

#[cfg(target_os = "windows")]
fn publication_task_manager_board_ids(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    publication
        .settings
        .get("boards")
        .and_then(Value::as_array)
        .map(|boards| {
            boards
                .iter()
                .filter_map(|board| board.get("name").and_then(Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn build_publication_bootstrap(
    publication: &TaskManagerPublicationPayload,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: Option<&str>,
) -> Value {
    let (publication_epoch, revision, sequence) = runtime
        .lock()
        .ok()
        .map(|guard| {
            (
                guard.publication_epoch.clone(),
                guard.revision,
                guard.sequence,
            )
        })
        .unwrap_or_else(|| (String::new(), 0, 0));
    let library_user_id = session_id.and_then(|session| {
        runtime.lock().ok().and_then(|guard| {
            guard
                .authenticated_sessions
                .get(session)
                .map(|value| authenticated_session_user(value).to_string())
        })
    });
    serde_json::json!({
        "libraryId": publication.library_id,
        "libraryUserId": library_user_id,
        "vaultPath": PUBLISHED_VAULT_ALIAS,
        "taskRootAtVault": publication.task_root_at_vault,
        "taskRootFolder": publication_task_root_folder(publication),
        "theme": publication.theme,
        "publicationEpoch": publication_epoch,
        "revision": revision,
        "sequence": sequence,
        "settings": build_publication_client_settings(publication),
    })
}

#[cfg(target_os = "windows")]
fn publication_task_root_folder(publication: &TaskManagerPublicationPayload) -> String {
    if publication.task_root_at_vault {
        return std::path::Path::new(&publication.vault_path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| {
                name.eq_ignore_ascii_case("task-mannager")
                    || name.eq_ignore_ascii_case("task-manager")
            })
            .unwrap_or("task-mannager")
            .to_lowercase();
    }

    task_roots(publication)
        .into_iter()
        .find(|root| std::path::Path::new(root).is_dir())
        .and_then(|root| {
            std::path::Path::new(&root)
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_lowercase)
        })
        .unwrap_or_else(|| "task-mannager".to_string())
}

fn validate_publication_password(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if !(8..=256).contains(&length) {
        return Err("La contraseña debe tener entre 8 y 256 caracteres.".to_string());
    }
    Ok(())
}

fn validate_publication_username(username: &str) -> Result<(), String> {
    let length = username.chars().count();
    if !(1..=64).contains(&length) || username.trim() != username {
        return Err("El usuario no es válido.".to_string());
    }
    Ok(())
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(target_os = "windows")]
fn safe_publication_actor_id(device_id: &str) -> String {
    let digest = Sha256::digest(device_id.as_bytes());
    format!("device-{}", encode_hex(&digest[..6]))
}

#[cfg(target_os = "windows")]
fn serve_library_user_login_page() -> Vec<u8> {
    const LOGIN_HTML: &str = r#"<!doctype html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notia · Task Manager</title><style>:root{font-family:Manrope,"Segoe UI",sans-serif;color:#f8f8f2;background:#282a36;color-scheme:dark}*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#3a3452,#21222c 62%)}main{width:min(420px,100%);padding:30px;border:1px solid #44475a;border-radius:16px;background:#282a36;box-shadow:0 22px 60px #0008}h1{margin:0 0 8px;font-size:24px}p{margin:0 0 22px;color:#a6accd;line-height:1.5}label{display:grid;gap:8px;margin-top:14px;font-size:13px;font-weight:700}input,button{width:100%;min-height:48px;border-radius:10px;font:inherit}input{padding:0 13px;border:1px solid #6272a4;background:#21222c;color:#f8f8f2;outline:none}input:focus{border-color:#8be9fd;box-shadow:0 0 0 3px #8be9fd33}button{margin-top:16px;border:0;background:#bd93f9;color:#181927;font-weight:800;cursor:pointer}button:disabled{opacity:.65;cursor:wait}#error{min-height:20px;margin:12px 0 0;color:#ff6b7c;font-size:13px}</style></head><body><main><h1>Task Manager</h1><p>Ingresá el usuario y la contraseña configurados en Notia.</p><form id="login" aria-describedby="error"><label for="username">Usuario<input id="username" type="text" maxlength="64" autocomplete="username" required autofocus></label><label for="password">Contraseña<input id="password" type="password" minlength="8" maxlength="256" autocomplete="current-password" required></label><button id="submit" type="submit" aria-busy="false">Acceder</button><div id="error" role="alert" aria-live="polite"></div></form></main><script>const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error'),password=document.getElementById('password');const base=location.pathname.replace(/\/+$/,'');form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Ingresando…';error.textContent='';try{const response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value.trim(),password:password.value})});const body=await response.json();if(!response.ok)throw new Error(response.status===401?'Credenciales incorrectas.':body.error||'No se pudo iniciar sesión.');location.assign(base+'/app')}catch(reason){error.textContent=reason instanceof Error?reason.message:'No se pudo iniciar sesión. Verificá que Notia esté abierta y reintentá.';password.select();button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Acceder'}},true)</script></body></html>"#;
    response("200 OK", "text/html; charset=utf-8", LOGIN_HTML.as_bytes())
}

#[cfg(target_os = "windows")]
fn serve_library_user_login(
    body: &[u8],
    runtime: &Arc<Mutex<PublicationRuntime>>,
    library_path: &str,
    publication_path: &str,
) -> Vec<u8> {
    let session_key = "library-user-login";
    if !allow_publication_rate(
        runtime,
        session_key.to_string(),
        10,
        Duration::from_secs(60),
    ) {
        return publication_rate_limited_response(
            "Demasiados intentos de inicio de sesión. Esperá antes de volver a intentar.",
        );
    }
    let Some(input) = serde_json::from_slice::<Value>(body).ok() else {
        return json_error("Credenciales incorrectas.");
    };
    let Some(username) = input.get("username").and_then(Value::as_str) else {
        return json_error("Credenciales incorrectas.");
    };
    let Some(password) = input.get("password").and_then(Value::as_str) else {
        return json_error("Credenciales incorrectas.");
    };
    if validate_publication_username(username).is_err()
        || validate_publication_password(password).is_err()
    {
        return json_error("Credenciales incorrectas.");
    }
    let Some(user_id) =
        crate::library_users::authenticate_library_user(library_path, username, password)
    else {
        return json_error("Credenciales incorrectas.");
    };
    let at_capacity = runtime.lock().ok().is_some_and(|guard| {
        guard.payload.as_ref().is_some_and(|publication| {
            guard.authenticated_sessions.len() >= publication_client_limit(publication)
        })
    });
    if at_capacity {
        return json_response_with_headers(
            "429 Too Many Requests",
            serde_json::json!({ "error": "La publicación alcanzó su capacidad máxima de sesiones.", "retryable": true }),
            &["Retry-After: 30"],
        );
    }
    let session = generate_session_token();
    let inserted = runtime.lock().ok().is_some_and(|mut guard| {
        if guard.payload.as_ref().is_some_and(|publication| {
            guard.authenticated_sessions.len() >= publication_client_limit(publication)
        }) {
            return false;
        }
        guard
            .authenticated_sessions
            .insert(session.clone(), encode_authenticated_session(&user_id));
        true
    });
    if !inserted {
        return json_error("La publicación cambió. Volvé a intentarlo.");
    }
    let cookie = format!("Set-Cookie: notia_task_session={session}; Secure; HttpOnly; SameSite=Strict; Path={publication_path}; Max-Age=43200");
    json_response_with_headers(
        "200 OK",
        serde_json::json!({ "ok": true }),
        &[cookie.as_str()],
    )
}

#[cfg(target_os = "windows")]
fn request_session_token(request: &[u8]) -> Option<&str> {
    request_cookie(request, "notia_task_session")
}

#[cfg(target_os = "windows")]
fn serve_invoke(
    body: &[u8],
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: Option<&str>,
) -> Vec<u8> {
    let request: Value = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(_) => return json_error("Solicitud inválida."),
    };
    let Some(publication) =
        session_id.and_then(|session| current_authenticated_publication(runtime, session))
    else {
        return json_error("La sesión ya no está autorizada.");
    };
    if request
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(is_mutating_publication_command)
    {
        return json_response(
            "426 Upgrade Required",
            serde_json::json!({
                "error": "Las mutaciones de Task Manager requieren WebSocket.",
                "code": "WEBSOCKET_REQUIRED",
            }),
        );
    }
    let command_name = request
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let result = if is_mutating_publication_command(&command_name) {
        let mutation_lock = runtime.lock().ok().map(|guard| guard.mutation_lock.clone());
        let Some(mutation_lock) = mutation_lock else {
            return json_error("No se pudo serializar la mutación.");
        };
        let Ok(_mutation_guard) = mutation_lock.lock() else {
            return json_error("No se pudo serializar la mutación.");
        };
        let current_publication = runtime.lock().ok().and_then(|guard| {
            let session_id = session_id?;
            guard.authenticated_sessions.get(session_id)?;
            guard.payload.clone()
        });
        let Some(current_publication) = current_publication else {
            return json_error("La sesión ya no está autorizada.");
        };
        execute_publication_invoke_unlocked(request, runtime, &current_publication, session_id)
    } else {
        execute_publication_invoke_unlocked(request, runtime, &publication, session_id)
    };
    match result {
        Ok((result, changed)) => {
            if changed {
                notify_publication_changed(
                    runtime,
                    &publication.vault_path,
                    Vec::new(),
                    None,
                    None,
                    None,
                );
            }
            json_response("200 OK", serde_json::json!({ "result": result }))
        }
        Err(_) => json_error(safe_publication_command_error(&command_name)),
    }
}

#[cfg(target_os = "windows")]
fn current_authenticated_publication(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: &str,
) -> Option<TaskManagerPublicationPayload> {
    let mut guard = runtime.lock().ok()?;
    let value = guard.authenticated_sessions.get(session_id)?.clone();
    if authenticated_session_expired(&value) {
        guard.authenticated_sessions.remove(session_id);
        return None;
    }
    guard.payload.clone()
}

/// A disabled or deleted library user loses access on the next request: the
/// session is dropped instead of living until its TTL expires.
#[cfg(target_os = "windows")]
fn ensure_publication_session_user_authorized(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    publication: &TaskManagerPublicationPayload,
    session_id: &str,
) -> Result<(), String> {
    let Some(library_id) = publication
        .library_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(());
    };
    let (app_handle, library_user_id) = {
        let guard = runtime
            .lock()
            .map_err(|_| "No se pudo validar la sesión publicada.".to_string())?;
        let Some(app_handle) = guard.app_handle.clone() else {
            return Ok(());
        };
        let Some(user) = guard
            .authenticated_sessions
            .get(session_id)
            .map(|value| authenticated_session_user(value).to_string())
        else {
            return Err("La sesión ya no está autorizada.".to_string());
        };
        (app_handle, user)
    };
    let registry = app_handle.state::<crate::library_registry::LibraryBindingRegistry>();
    if crate::library_users::authorize_task_manager_user(
        &app_handle,
        &registry,
        library_id,
        &library_user_id,
    )
    .is_err()
    {
        if let Ok(mut guard) = runtime.lock() {
            guard.authenticated_sessions.remove(session_id);
        }
        return Err("La sesión ya no está autorizada.".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn execute_publication_invoke_unlocked(
    request: Value,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    publication: &TaskManagerPublicationPayload,
    session_id: Option<&str>,
) -> Result<(Value, bool), String> {
    let command = request
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| "Operación inválida.".to_string())?;
    if let Some(session_id) = session_id {
        ensure_publication_session_user_authorized(runtime, publication, session_id)?;
    }
    if crate::registry::is_published_command(command) {
        let app_handle = runtime
            .lock()
            .map_err(|_| "No se pudo acceder al runtime de publicación.".to_string())?
            .app_handle
            .clone()
            .ok_or_else(|| "El backend publicado no está disponible.".to_string())?;
        let library_id = publication
            .library_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La publicación no tiene una biblioteca autorizada.".to_string())?;
        let session_id =
            session_id.ok_or_else(|| "La sesión publicada es obligatoria.".to_string())?;
        let library_user_id = runtime
            .lock()
            .map_err(|_| "No se pudo validar la sesión publicada.".to_string())?
            .authenticated_sessions
            .get(session_id)
            .map(|value| authenticated_session_user(value).to_string())
            .ok_or_else(|| "La sesión ya no está autorizada.".to_string())?;
        // The registry decides what a published user may run and applies the
        // user and the published boards to the use case.
        let scope = crate::registry::PublishedScope {
            library_id: library_id.to_string(),
            library_user_id,
            board_ids: publication_task_manager_board_ids(publication),
        };
        let empty = serde_json::json!({});
        let args = request.get("args").unwrap_or(&empty);
        return crate::registry::dispatch_published(&app_handle, &scope, command, args)
            .unwrap_or_else(|| Err(crate::backend::BackendError::invalid_input("Operación no disponible.")))
            .map_err(|error| error.message);
    }
    if command == "begin_task_manager_publication_batch" {
        let session_id =
            session_id.ok_or_else(|| "La sesión WebSocket es obligatoria.".to_string())?;
        let operation_id = request
            .get("operationId")
            .and_then(Value::as_str)
            .ok_or_else(|| "La operación agrupada requiere operationId.".to_string())?;
        let mut guard = runtime
            .lock()
            .map_err(|_| "No se pudo iniciar la operación agrupada.".to_string())?;
        if guard.host_mutation_active {
            return Err("El host está ejecutando una operación de Task Manager.".to_string());
        }
        if guard
            .mutation_batches
            .keys()
            .any(|owner| owner != session_id)
        {
            return Err("Ya existe otra operación remota de Task Manager en curso.".to_string());
        }
        if let Some(active_batch) = guard.mutation_batches.get(session_id) {
            if active_batch.operation_id.as_deref() == Some(operation_id) {
                return Ok((serde_json::json!({ "ok": true, "changed": false }), false));
            }
            return Err("Ya existe una operación agrupada para esta sesión.".to_string());
        }
        guard.mutation_batches.insert(
            session_id.to_string(),
            PublicationMutationBatch {
                operation_id: Some(operation_id.to_string()),
                ..PublicationMutationBatch::default()
            },
        );
        return Ok((serde_json::json!({ "ok": true, "changed": false }), false));
    }
    if command == "end_task_manager_publication_batch" {
        let session_id =
            session_id.ok_or_else(|| "La sesión WebSocket es obligatoria.".to_string())?;
        let batch = runtime
            .lock()
            .map_err(|_| "No se pudo cerrar la operación agrupada.".to_string())?
            .mutation_batches
            .remove(session_id)
            .ok_or_else(|| "No existe una operación agrupada activa.".to_string())?;
        if batch.changed {
            let actor_id = batch.actor_id.or_else(|| {
                runtime
                    .lock()
                    .ok()
                    .and_then(|guard| {
                        guard
                            .authenticated_sessions
                            .get(session_id)
                            .map(|value| authenticated_session_user(value).to_string())
                    })
                    .map(|device_id| safe_publication_actor_id(&device_id))
            });
            let operation_id = request
                .get("operationId")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or(batch.operation_id);
            notify_publication_changed(
                runtime,
                &publication.vault_path,
                batch.changed_paths,
                operation_id.as_deref(),
                actor_id.as_deref(),
                None,
            );
        }
        return Ok((
            serde_json::json!({ "ok": true, "changed": batch.changed }),
            false,
        ));
    }
    Err("La URL solo puede acceder a los tableros publicados.".to_string())
}

#[cfg(target_os = "windows")]
fn is_mutating_publication_command(command: &str) -> bool {
    PublicationMutationCommand::parse(command).is_some()
}

#[cfg(target_os = "windows")]
fn validate_publication_mutation_args(
    command: PublicationMutationCommand,
    args: &Value,
) -> Result<(), String> {
    if !args.is_object() {
        return Err("Los argumentos de la mutación publicada son inválidos.".to_string());
    }

    match command {
        PublicationMutationCommand::BeginBatch | PublicationMutationCommand::EndBatch => {
            if args.as_object().is_some_and(|object| object.is_empty()) {
                Ok(())
            } else {
                Err("El lote publicado no acepta argumentos adicionales.".to_string())
            }
        }
        PublicationMutationCommand::TaskManagerWriteTicketSource => {
            let payload = required_publication_mutation_payload(args)?;
            require_publication_string(payload, "logicalPath", 2_048)?;
            require_publication_text(payload, "content", MAX_PUBLICATION_WS_MESSAGE_BYTES)?;
            require_publication_string(payload, "expectedRevision", 128)
        }
        PublicationMutationCommand::TaskManagerBoardExecute => {
            let payload = required_publication_mutation_payload(args)?;
            payload
                .get("intent")
                .filter(|intent| intent.is_object())
                .map(|_| ())
                .ok_or_else(|| "La operación publicada no es válida.".to_string())
        }
        PublicationMutationCommand::TaskManagerPomodoro => {
            let payload = required_publication_mutation_payload(args)?;
            require_publication_string(payload, "localDate", 10)?;
            require_publication_string(payload, "localTime", 5)?;
            payload
                .get("action")
                .filter(|action| action.is_object())
                .map(|_| ())
                .ok_or_else(|| "El pomodoro publicado no es válido.".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
fn required_publication_mutation_payload(
    args: &Value,
) -> Result<&serde_json::Map<String, Value>, String> {
    args.get("payload")
        .and_then(Value::as_object)
        .ok_or_else(|| "La mutación publicada requiere un payload válido.".to_string())
}

#[cfg(target_os = "windows")]
fn require_publication_string(
    payload: &serde_json::Map<String, Value>,
    key: &str,
    max_length: usize,
) -> Result<(), String> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= max_length)
        .ok_or_else(|| "La mutación publicada contiene un campo inválido.".to_string())?;
    if value.chars().any(char::is_control) {
        return Err("La mutación publicada contiene caracteres inválidos.".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn require_publication_text(
    payload: &serde_json::Map<String, Value>,
    key: &str,
    max_length: usize,
) -> Result<(), String> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= max_length)
        .ok_or_else(|| "La mutación publicada contiene un campo inválido.".to_string())?;
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("La mutación publicada contiene caracteres inválidos.".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn safe_publication_command_error(command: &str) -> &'static str {
    match command {
        "read_library_file" | "read_markdown_files" => "No se pudo leer el contenido publicado.",
        "update_task_manager_publication_settings" => {
            "No se pudo actualizar la configuración publicada."
        }
        _ => "No se pudo completar la operación publicada.",
    }
}

#[cfg(target_os = "windows")]
fn publication_change_socket_payload(event: &PublicationChange) -> Value {
    let mut payload = serde_json::json!({
        "type": "changed",
        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
        "publicationEpoch": event.publication_epoch,
        "sequence": event.sequence,
        "revision": event.revision,
        "messageId": event.message_id,
        "settings": event.settings.clone(),
    });
    if let Some(operation_id) = &event.operation_id {
        payload["operationId"] = Value::String(operation_id.clone());
    }
    if let Some(actor_id) = &event.actor_id {
        payload["actorId"] = Value::String(actor_id.clone());
    }
    if !event.changed_paths.is_empty() {
        payload["changedPaths"] = serde_json::json!(event.changed_paths);
    }
    payload
}

#[cfg(target_os = "windows")]
fn publication_changed_paths(
    request: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Vec<String> {
    let mut payload = request
        .get("args")
        .and_then(|args| args.get("payload"))
        .cloned()
        .unwrap_or(Value::Null);
    internalize_publication_paths(&mut payload, publication);

    let mut paths = Vec::new();
    collect_publication_changed_paths(&payload, publication, &mut paths);
    if paths.len() > PUBLICATION_CHANGED_PATH_LIMIT {
        Vec::new()
    } else {
        paths
    }
}

#[cfg(target_os = "windows")]
fn collect_publication_changed_paths(
    value: &Value,
    publication: &TaskManagerPublicationPayload,
    paths: &mut Vec<String>,
) {
    if paths.len() > PUBLICATION_CHANGED_PATH_LIMIT {
        return;
    }
    match value {
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_publication_changed_paths(item, publication, paths)),
        Value::Object(object) => {
            for (key, item) in object {
                if PUBLICATION_PATH_KEYS.contains(&key.as_str()) {
                    if let Some(path) = item.as_str() {
                        let public_path = publicize_publication_path(path, publication);
                        let is_public_path = public_path
                            .eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS)
                            || public_path
                                .get(..PUBLISHED_VAULT_ALIAS.len() + 1)
                                .is_some_and(|prefix| {
                                    prefix[..PUBLISHED_VAULT_ALIAS.len()]
                                        .eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS)
                                        && prefix.ends_with('/')
                                });
                        if is_public_path
                            && public_path.len() <= 512
                            && !paths
                                .iter()
                                .any(|existing| existing.eq_ignore_ascii_case(&public_path))
                        {
                            paths.push(public_path);
                        }
                    }
                }
                collect_publication_changed_paths(item, publication, paths);
                if paths.len() > PUBLICATION_CHANGED_PATH_LIMIT {
                    return;
                }
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
fn notify_publication_changed(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    vault_path: &str,
    changed_paths: Vec<String>,
    operation_id: Option<&str>,
    actor_id: Option<&str>,
    batch_session: Option<&str>,
) {
    let (app_handle, event, settings) = match runtime.lock() {
        Ok(mut guard) => {
            let Some((publication_vault_path, publication_settings)) =
                guard.payload.as_ref().map(|publication| {
                    (
                        publication.vault_path.clone(),
                        build_publication_client_settings(publication),
                    )
                })
            else {
                return;
            };
            if publication_vault_path != vault_path {
                return;
            }
            if let Some(session_id) = batch_session {
                if let Some(batch) = guard.mutation_batches.get_mut(session_id) {
                    batch.record(changed_paths, operation_id, actor_id);
                    return;
                }
            }
            if guard.host_mutation_active && batch_session.is_none() {
                guard
                    .host_mutation_batch
                    .record(changed_paths, operation_id, actor_id);
                return;
            }
            if batch_session.is_none() {
                // Watcher notifications can arrive while the remote owner is
                // between writes. Keep them behind that same commit boundary.
                if let Some(batch) = guard.mutation_batches.values_mut().next() {
                    batch.record(changed_paths, None, None);
                    return;
                }
            }
            let settings = Some(publication_settings);
            guard.revision = guard.revision.saturating_add(1);
            guard.sequence = guard.sequence.saturating_add(1);
            guard.metrics.last_change_at_unix_ms = Some(unix_timestamp_millis());
            let event = PublicationChange {
                publication_epoch: guard.publication_epoch.clone(),
                sequence: guard.sequence,
                revision: guard.revision,
                vault_path: vault_path.to_string(),
                message_id: generate_session_token(),
                operation_id: operation_id.map(str::to_owned),
                actor_id: actor_id.map(str::to_owned),
                settings: settings.clone(),
                changed_paths,
            };
            guard.last_operation_id = event.operation_id.clone();
            guard.last_actor_id = event.actor_id.clone();
            guard.change_history.push_back(event.clone());
            while guard.change_history.len() > PUBLICATION_CHANGE_HISTORY_LIMIT {
                guard.change_history.pop_front();
            }
            let payload = publication_change_socket_payload(&event);
            let message = PublicationSocketEvent {
                payload,
                close_after_send: false,
            };
            let mut dropped_events = 0_u64;
            guard.websocket_subscribers.retain(|_, subscriber| {
                if subscriber.sender.try_send(message.clone()).is_ok() {
                    true
                } else {
                    dropped_events = dropped_events.saturating_add(1);
                    false
                }
            });
            guard.metrics.dropped_events =
                guard.metrics.dropped_events.saturating_add(dropped_events);
            (guard.app_handle.clone(), event, settings)
        }
        Err(_) => return,
    };
    if let Some(app_handle) = app_handle {
        let _ = app_handle.emit(
            "task-manager-publication-changed",
            serde_json::json!({
                "vaultPath": event.vault_path,
                "publicationEpoch": event.publication_epoch,
                "sequence": event.sequence,
                "revision": event.revision,
                "operationId": event.operation_id,
                "actorId": event.actor_id,
                "changedPaths": event.changed_paths,
                "settings": settings,
            }),
        );
    }
}

#[cfg(target_os = "windows")]
fn publication_protocol_message(message_type: &str, message_id: String) -> Value {
    serde_json::json!({
        "type": message_type,
        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
        "messageId": message_id,
    })
}

#[cfg(target_os = "windows")]
fn current_publication_epoch(runtime: &Arc<Mutex<PublicationRuntime>>) -> String {
    runtime
        .lock()
        .ok()
        .map(|guard| guard.publication_epoch.clone())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn allow_publication_rate(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    bucket_key: String,
    limit: usize,
    window: Duration,
) -> bool {
    runtime
        .lock()
        .is_ok_and(|mut guard| guard.rate_limit_windows.allow(bucket_key, limit, window))
}

#[cfg(target_os = "windows")]
fn publication_rate_limited_response(message: &str) -> Vec<u8> {
    json_response_with_headers(
        "429 Too Many Requests",
        serde_json::json!({
            "error": message,
            "retryable": true,
        }),
        &["Retry-After: 30"],
    )
}

#[cfg(target_os = "windows")]
fn register_websocket_subscriber(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: &str,
    hello: &Value,
) -> Result<(u64, mpsc::Receiver<PublicationSocketEvent>, Vec<Value>), String> {
    let typed_hello = serde_json::from_value::<PublicationHelloFrame>(hello.clone())
        .map_err(|_| "El mensaje hello es inválido.".to_string())?;
    if typed_hello.message_type != "hello"
        || typed_hello.protocol_version != PUBLICATION_PROTOCOL_VERSION
        || typed_hello.message_id.trim().is_empty()
        || typed_hello.message_id.len() > 128
    {
        return Err("El mensaje hello es inválido.".to_string());
    }
    let last_epoch = typed_hello
        .publication_epoch
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let last_sequence = typed_hello.last_sequence;
    let (sender, receiver) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
    let mut guard = runtime
        .lock()
        .map_err(|_| "No se pudo registrar la sesión WebSocket.".to_string())?;
    if !authenticated_session_active(&guard, session_id) {
        return Err("La sesión ya no está autorizada.".to_string());
    }
    let Some(device_id) = guard
        .authenticated_sessions
        .get(session_id)
        .map(|value| authenticated_session_user(value).to_string())
    else {
        return Err("La sesión ya no está autorizada.".to_string());
    };
    if guard.payload.is_none() {
        return Err("La publicación ya no está disponible.".to_string());
    }
    let websocket_limit = guard
        .payload
        .as_ref()
        .map(publication_client_limit)
        .unwrap_or(DEFAULT_PUBLICATION_CLIENT_LIMIT);
    if guard.websocket_subscribers.len() >= websocket_limit {
        return Err(
            "La publicación alcanzó su capacidad máxima de conexiones WebSocket.".to_string(),
        );
    }
    let epoch_matches = last_epoch.is_none_or(|epoch| epoch == guard.publication_epoch);
    let history_is_complete = last_sequence.is_none_or(|sequence| {
        sequence >= guard.sequence
            || guard
                .change_history
                .front()
                .is_none_or(|first| first.sequence <= sequence.saturating_add(1))
    });
    let needs_resync = !epoch_matches || !history_is_complete;
    if needs_resync {
        guard.metrics.resync_required = guard.metrics.resync_required.saturating_add(1);
    }
    let replay = if needs_resync {
        Vec::new()
    } else {
        let cursor = last_sequence.unwrap_or(guard.sequence);
        guard
            .change_history
            .iter()
            .filter(|event| event.sequence > cursor)
            .map(publication_change_socket_payload)
            .collect()
    };
    let subscriber_id = guard.next_websocket_subscriber_id;
    guard.next_websocket_subscriber_id = guard.next_websocket_subscriber_id.saturating_add(1);
    guard.websocket_subscribers.insert(
        subscriber_id,
        PublicationSocketSubscriber { device_id, sender },
    );
    let mut messages = Vec::new();
    if needs_resync {
        messages.push(serde_json::json!({
            "type": "resync-required",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "publicationEpoch": guard.publication_epoch,
            "sequence": guard.sequence,
            "revision": guard.revision,
            "messageId": generate_session_token(),
            "reason": "El cursor de cambios ya no está disponible.",
        }));
    }
    let mut welcome = publication_protocol_message("welcome", generate_session_token());
    welcome["publicationEpoch"] = Value::String(guard.publication_epoch.clone());
    welcome["revision"] = Value::from(guard.revision);
    welcome["sequence"] = Value::from(guard.sequence);
    welcome["replay"] = Value::Array(replay);
    messages.push(welcome);
    Ok((subscriber_id, receiver, messages))
}

#[cfg(target_os = "windows")]
fn send_websocket_json<S: Read + Write>(
    socket: &mut WebSocket<S>,
    payload: Value,
) -> Result<(), Box<WebSocketError>> {
    let serialized = serde_json::to_string(&payload).map_err(|error| {
        Box::new(WebSocketError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            error.to_string(),
        )))
    })?;
    socket.send(Message::Text(serialized)).map_err(Box::new)
}

#[cfg(target_os = "windows")]
fn send_websocket_json_recorded<S: Read + Write>(
    socket: &mut WebSocket<S>,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    payload: Value,
) -> Result<(), Box<WebSocketError>> {
    let wire_bytes = serde_json::to_vec(&payload).map_or(0, |serialized| serialized.len());
    let result = send_websocket_json(socket, payload);
    if result.is_ok() {
        if let Ok(mut guard) = runtime.lock() {
            guard.metrics.websocket_frames_sent =
                guard.metrics.websocket_frames_sent.saturating_add(1);
            guard.metrics.websocket_bytes_sent = guard
                .metrics
                .websocket_bytes_sent
                .saturating_add(wire_bytes as u64);
        }
    }
    result
}

#[cfg(target_os = "windows")]
fn serialized_json_size(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(0, |serialized| serialized.len())
}

#[cfg(target_os = "windows")]
fn unix_timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            duration.as_millis().min(u128::from(u64::MAX)) as u64
        })
}

#[cfg(target_os = "windows")]
fn calculate_publication_latency_p95(buckets: &[u64; 6], samples: u64) -> Option<u64> {
    if samples == 0 {
        return None;
    }

    let target = samples.saturating_mul(95).saturating_add(99) / 100;
    let mut cumulative = 0_u64;
    for (index, count) in buckets.iter().enumerate() {
        cumulative = cumulative.saturating_add(*count);
        if cumulative >= target {
            return PUBLICATION_LATENCY_BUCKETS_MS.get(index).copied();
        }
    }
    PUBLICATION_LATENCY_BUCKETS_MS
        .last()
        .copied()
        .map(|value| value.saturating_add(1))
}

#[cfg(target_os = "windows")]
fn record_publication_mutation_latency(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    started_at: Instant,
) {
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let Ok(mut guard) = runtime.lock() else {
        return;
    };
    let metrics = &mut guard.metrics;
    metrics.mutation_latency_samples = metrics.mutation_latency_samples.saturating_add(1);
    metrics.mutation_latency_last_ms = Some(elapsed_ms);
    if let Some(index) = PUBLICATION_LATENCY_BUCKETS_MS
        .iter()
        .position(|limit| elapsed_ms <= *limit)
    {
        metrics.mutation_latency_buckets[index] =
            metrics.mutation_latency_buckets[index].saturating_add(1);
    }
    metrics.mutation_latency_p95_ms = calculate_publication_latency_p95(
        &metrics.mutation_latency_buckets,
        metrics.mutation_latency_samples,
    );
}

#[cfg(target_os = "windows")]
struct PublicationMutationLatency {
    runtime: Arc<Mutex<PublicationRuntime>>,
    started_at: Instant,
}

#[cfg(target_os = "windows")]
impl PublicationMutationLatency {
    fn start(runtime: &Arc<Mutex<PublicationRuntime>>) -> Self {
        Self {
            runtime: Arc::clone(runtime),
            started_at: Instant::now(),
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for PublicationMutationLatency {
    fn drop(&mut self) {
        record_publication_mutation_latency(&self.runtime, self.started_at);
    }
}

#[cfg(target_os = "windows")]
fn parse_websocket_text(message: Message) -> Result<Option<Value>, String> {
    let text = match message {
        Message::Text(text) => text,
        Message::Binary(_) => {
            return Err("El protocolo WebSocket requiere mensajes JSON de texto.".to_string())
        }
        Message::Close(_) => return Ok(None),
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => return Ok(Some(Value::Null)),
    };
    if text.len() > MAX_PUBLICATION_WS_MESSAGE_BYTES {
        return Err("El mensaje WebSocket supera el tamaño permitido.".to_string());
    }
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|_| "Mensaje WebSocket inválido.".to_string())
}

#[cfg(target_os = "windows")]
fn serve_publication_websocket<S>(
    stream: PrefixedStream<S>,
    runtime: Arc<Mutex<PublicationRuntime>>,
    session_id: String,
) where
    S: Read + Write + Send + 'static,
{
    let socket_config = WebSocketConfig {
        max_message_size: Some(MAX_PUBLICATION_WS_MESSAGE_BYTES),
        max_frame_size: Some(MAX_PUBLICATION_WS_MESSAGE_BYTES),
        ..WebSocketConfig::default()
    };
    let mut socket = match accept_with_config(stream, Some(socket_config)) {
        Ok(socket) => socket,
        Err(_) => return,
    };
    let hello_deadline = Instant::now() + Duration::from_secs(10);
    let hello = loop {
        if Instant::now() >= hello_deadline {
            return;
        }
        match socket.read() {
            Ok(message) => match parse_websocket_text(message) {
                Ok(Some(value)) if value.is_null() => continue,
                Ok(Some(value)) => break value,
                Ok(None) | Err(_) => return,
            },
            Err(error) if websocket_timeout(&error) => continue,
            Err(_) => return,
        }
    };
    if hello.get("type").and_then(Value::as_str) != Some("hello") {
        let _ = send_websocket_json_recorded(
            &mut socket,
            &runtime,
            serde_json::json!({
                "type": "error",
                "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                "publicationEpoch": current_publication_epoch(&runtime),
                "messageId": generate_session_token(),
                "error": "El primer mensaje debe ser hello.",
            }),
        );
        return;
    }
    let (subscriber_id, receiver, initial_messages) =
        match register_websocket_subscriber(&runtime, &session_id, &hello) {
            Ok(result) => result,
            Err(error) => {
                let _ = send_websocket_json_recorded(
                    &mut socket,
                    &runtime,
                    serde_json::json!({
                        "type": "error",
                        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                        "publicationEpoch": current_publication_epoch(&runtime),
                        "messageId": generate_session_token(),
                        "error": error,
                    }),
                );
                return;
            }
        };
    for message in initial_messages {
        if send_websocket_json_recorded(&mut socket, &runtime, message).is_err() {
            unregister_websocket_subscriber(&runtime, subscriber_id, &session_id);
            return;
        }
    }

    let socket = Arc::new(Mutex::new(socket));
    // One owner alternates outgoing events and bounded reads. A competing
    // reader thread can otherwise repeatedly reacquire the socket mutex and
    // starve broadcasts while the peer is idle.
    let mut last_ping = Instant::now();
    'connection: loop {
        for _ in 0..PUBLICATION_WS_QUEUE_LIMIT {
            match receiver.try_recv() {
                Ok(event) => {
                    let sent = socket.lock().ok().is_some_and(|mut guard| {
                        send_websocket_json_recorded(&mut guard, &runtime, event.payload).is_ok()
                    });
                    if !sent || event.close_after_send {
                        break 'connection;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => break 'connection,
            }
        }
        if last_ping.elapsed() >= Duration::from_secs(25) {
            let sent = socket
                .lock()
                .ok()
                .is_some_and(|mut guard| guard.send(Message::Ping(Vec::new())).is_ok());
            if !sent {
                break;
            }
            last_ping = Instant::now();
        }
        let message = match socket.lock() {
            Ok(mut guard) => guard.read(),
            Err(_) => break,
        };
        let message = match message {
            Ok(message) => message,
            Err(error) if websocket_timeout(&error) => continue,
            Err(_) => break,
        };
        let value = match parse_websocket_text(message) {
            Ok(Some(value)) if value.is_null() => continue,
            Ok(Some(value)) => value,
            Ok(None) | Err(_) => break,
        };
        let session_active = runtime
            .lock()
            .ok()
            .is_some_and(|guard| authenticated_session_active(&guard, &session_id));
        if !session_active {
            let _ = socket.lock().ok().and_then(|mut guard| {
                send_websocket_json_recorded(
                    &mut guard,
                    &runtime,
                    serde_json::json!({
                        "type": "session-expired",
                        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                        "publicationEpoch": current_publication_epoch(&runtime),
                        "messageId": generate_session_token(),
                        "reason": "La sesión publicada expiró.",
                    }),
                )
                .ok()
            });
            break;
        }
        let received_bytes = serialized_json_size(&value);
        if let Ok(mut guard) = runtime.lock() {
            guard.metrics.websocket_frames_received =
                guard.metrics.websocket_frames_received.saturating_add(1);
            guard.metrics.websocket_bytes_received = guard
                .metrics
                .websocket_bytes_received
                .saturating_add(received_bytes as u64);
        }
        match value.get("type").and_then(Value::as_str) {
            Some("ping") => {
                let response = serde_json::json!({
                    "type": "pong",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(&runtime),
                    "messageId": generate_session_token(),
                });
                if socket.lock().ok().is_none_or(|mut guard| {
                    send_websocket_json_recorded(&mut guard, &runtime, response).is_err()
                }) {
                    break;
                }
            }
            Some("mutate") => {
                if !serve_publication_websocket_mutation(&socket, &runtime, &session_id, value) {
                    break;
                }
            }
            Some("cancel") => {
                if !serve_publication_websocket_cancellation(&socket, &runtime, value) {
                    break;
                }
            }
            Some("close") => break,
            Some("hello") => {
                let response = serde_json::json!({
                    "type": "error",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(&runtime),
                    "messageId": generate_session_token(),
                    "error": "La sesión WebSocket ya está inicializada.",
                });
                if socket.lock().ok().is_none_or(|mut guard| {
                    send_websocket_json_recorded(&mut guard, &runtime, response).is_err()
                }) {
                    break;
                }
            }
            _ => {
                let response = serde_json::json!({
                    "type": "error",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(&runtime),
                    "messageId": generate_session_token(),
                    "error": "Mensaje WebSocket no reconocido.",
                });
                if socket.lock().ok().is_none_or(|mut guard| {
                    send_websocket_json_recorded(&mut guard, &runtime, response).is_err()
                }) {
                    break;
                }
            }
        }
    }
    if let Ok(mut guard) = socket.lock() {
        let _ = guard.close(None);
    }
    unregister_websocket_subscriber(&runtime, subscriber_id, &session_id);
}

#[cfg(target_os = "windows")]
fn serve_publication_websocket_mutation<S>(
    socket: &Arc<Mutex<WebSocket<S>>>,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: &str,
    request: Value,
) -> bool
where
    S: Read + Write,
{
    let typed_mutation = match serde_json::from_value::<PublicationMutateFrame>(request.clone()) {
        Ok(mutation) => mutation,
        Err(_) => return false,
    };
    if typed_mutation.message_type != "mutate"
        || typed_mutation.protocol_version != PUBLICATION_PROTOCOL_VERSION
        || !is_safe_publication_operation_id(&typed_mutation.message_id)
        || !is_safe_publication_operation_id(&typed_mutation.operation_id)
        || typed_mutation.command.len() > 80
        || !typed_mutation.args.is_object()
    {
        return false;
    }
    let _latency = PublicationMutationLatency::start(runtime);
    let message_id = typed_mutation.message_id;
    let operation_id = typed_mutation.operation_id;
    let command = typed_mutation.command;
    let mutation_args = typed_mutation.args;
    let command_kind = PublicationMutationCommand::parse(&command);
    let invalid_mutation_args = command_kind
        .and_then(|kind| validate_publication_mutation_args(kind, &mutation_args).err());
    // `operation_id` correlates every command in a logical batch, so it is not
    // unique per write. `message_id` is stable across transport retries and
    // distinguishes begin/write/end (and multiple writes) within that batch.
    let mutation_cache_key = publication_mutation_cache_key(session_id, &message_id);
    let rate_limited = !operation_id.is_empty()
        && !allow_publication_rate(
            runtime,
            format!("mutation:{session_id}"),
            240,
            Duration::from_secs(60),
        );
    let response = if command_kind.is_none() {
        serde_json::json!({
            "type": "ack",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "publicationEpoch": current_publication_epoch(runtime),
            "messageId": message_id,
            "operationId": operation_id,
            "ok": false,
            "outcome": "failed",
            "error": "El WebSocket solo admite mutaciones de Task Manager.",
        })
    } else if operation_id.is_empty() {
        serde_json::json!({
            "type": "ack",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "publicationEpoch": current_publication_epoch(runtime),
            "messageId": message_id,
            "ok": false,
            "outcome": "failed",
            "error": "La mutación requiere operationId.",
        })
    } else if let Some(error) = invalid_mutation_args {
        if let Ok(mut guard) = runtime.lock() {
            guard.metrics.mutation_errors = guard.metrics.mutation_errors.saturating_add(1);
        }
        serde_json::json!({
            "type": "ack",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "publicationEpoch": current_publication_epoch(runtime),
            "messageId": message_id,
            "operationId": operation_id,
            "ok": false,
            "outcome": "failed",
            "retryable": false,
            "error": error,
        })
    } else {
        let mutation_lock = runtime.lock().ok().map(|guard| guard.mutation_lock.clone());
        let Some(mutation_lock) = mutation_lock else {
            return false;
        };
        let _mutation_guard = match acquire_publication_mutation_lock(
            &mutation_lock,
            runtime,
            socket,
            Some(session_id),
            &operation_id,
        ) {
            Ok(guard) => guard,
            Err(PublicationMutationLockError::Cancelled) => return true,
            Err(PublicationMutationLockError::Disconnected) => return false,
            Err(PublicationMutationLockError::TimedOut) => {
                if let Ok(mut guard) = runtime.lock() {
                    guard.metrics.mutation_errors = guard.metrics.mutation_errors.saturating_add(1);
                }
                let response = serde_json::json!({
                    "type": "ack",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(runtime),
                    "messageId": message_id,
                    "operationId": operation_id,
                    "ok": false,
                    "outcome": "unknown",
                    "retryable": true,
                    "error": "El host está ocupado. La operación no fue confirmada; volvé a intentar.",
                });
                return socket.lock().ok().is_some_and(|mut guard| {
                    send_websocket_json_recorded(&mut guard, runtime, response).is_ok()
                });
            }
        };
        let publication = runtime.lock().ok().and_then(|guard| guard.payload.clone());
        let authorized = runtime
            .lock()
            .ok()
            .is_some_and(|guard| authenticated_session_active(&guard, session_id));
        if !authorized || publication.is_none() {
            return false;
        }
        if let Ok(mut guard) = runtime.lock() {
            if let Some(batch) = guard.mutation_batches.get_mut(session_id) {
                batch.activity_generation = batch.activity_generation.saturating_add(1);
            }
        }
        let cached = runtime
            .lock()
            .ok()
            .and_then(|guard| guard.completed_mutations.get(&mutation_cache_key).cloned());
        if let Some(cached) = cached {
            serde_json::json!({
                "type": "ack",
                "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                "publicationEpoch": current_publication_epoch(runtime),
                "messageId": message_id,
                "operationId": operation_id,
                "ok": true,
                "outcome": "applied",
                "result": cached.result,
                "changed": cached.changed,
                "changedPaths": cached.changed_paths,
                "sequence": cached.sequence,
                "revision": cached.revision,
                "deduplicated": true,
            })
        } else if rate_limited {
            if let Ok(mut guard) = runtime.lock() {
                guard.metrics.mutation_errors = guard.metrics.mutation_errors.saturating_add(1);
            }
            serde_json::json!({
                "type": "ack",
                "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                "publicationEpoch": current_publication_epoch(runtime),
                "messageId": message_id,
                "operationId": operation_id,
                "ok": false,
                "outcome": "failed",
                "retryable": true,
                "error": "Demasiadas mutaciones pendientes. Esperá antes de volver a intentar.",
            })
        } else {
            let Some(publication) = publication else {
                return false;
            };
            let changed_paths = publication_changed_paths(&request, &publication);
            let result = execute_publication_invoke_unlocked(
                serde_json::json!({
                    "command": command.as_str(),
                    "args": mutation_args,
                    "operationId": operation_id,
                }),
                runtime,
                &publication,
                Some(session_id),
            );
            match result {
                Ok((result, true)) => {
                    if let Ok(mut guard) = runtime.lock() {
                        guard.metrics.mutations_applied =
                            guard.metrics.mutations_applied.saturating_add(1);
                    }
                    let actor_id = runtime
                        .lock()
                        .ok()
                        .and_then(|guard| {
                            guard
                                .authenticated_sessions
                                .get(session_id)
                                .map(|value| authenticated_session_user(value).to_string())
                        })
                        .map(|device_id| safe_publication_actor_id(&device_id));
                    notify_publication_changed(
                        runtime,
                        &publication.vault_path,
                        changed_paths.clone(),
                        Some(operation_id.as_str()),
                        actor_id.as_deref(),
                        Some(session_id),
                    );
                    let (sequence, revision) = runtime
                        .lock()
                        .ok()
                        .map(|guard| (guard.sequence, guard.revision))
                        .unwrap_or((0, 0));
                    if let Ok(mut guard) = runtime.lock() {
                        guard.completed_mutations.insert(
                            mutation_cache_key,
                            PublicationMutationAck {
                                result: result.clone(),
                                sequence,
                                revision,
                                changed: true,
                                changed_paths: changed_paths.clone(),
                            },
                        );
                        if guard.completed_mutations.len() > PUBLICATION_CHANGE_HISTORY_LIMIT {
                            if let Some(oldest) = guard.completed_mutations.keys().next().cloned() {
                                guard.completed_mutations.remove(&oldest);
                            }
                        }
                    }
                    serde_json::json!({
                        "type": "ack",
                        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                        "publicationEpoch": current_publication_epoch(runtime),
                        "messageId": message_id,
                        "operationId": operation_id,
                        "ok": true,
                        "outcome": "applied",
                        "result": result,
                        "changed": true,
                        "changedPaths": changed_paths,
                        "sequence": sequence,
                        "revision": revision,
                    })
                }
                Ok((result, false)) => {
                    let changed = result
                        .get("changed")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let ok = result.get("ok").and_then(Value::as_bool).unwrap_or(true);
                    let (sequence, revision) = runtime
                        .lock()
                        .ok()
                        .map(|guard| (guard.sequence, guard.revision))
                        .unwrap_or((0, 0));
                    // Begin is idempotent against the live batch itself. It is
                    // deliberately not cached: disconnect cleanup removes an
                    // unfinished batch, so a reconnect must execute begin again.
                    if ok && command == "end_task_manager_publication_batch" {
                        if let Ok(mut guard) = runtime.lock() {
                            guard.completed_mutations.insert(
                                mutation_cache_key,
                                PublicationMutationAck {
                                    result: result.clone(),
                                    sequence,
                                    revision,
                                    changed,
                                    changed_paths: Vec::new(),
                                },
                            );
                            if guard.completed_mutations.len() > PUBLICATION_CHANGE_HISTORY_LIMIT {
                                if let Some(oldest) =
                                    guard.completed_mutations.keys().next().cloned()
                                {
                                    guard.completed_mutations.remove(&oldest);
                                }
                            }
                        }
                    }
                    serde_json::json!({
                        "type": "ack",
                        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                        "publicationEpoch": current_publication_epoch(runtime),
                        "messageId": message_id,
                        "operationId": operation_id,
                        "ok": ok,
                        "outcome": if ok { "applied" } else { "failed" },
                        "changed": changed,
                        "changedPaths": [],
                        "sequence": sequence,
                        "revision": revision,
                        "error": result.get("error").cloned(),
                        "retryable": result
                            .get("retryable")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        "conflict": result.get("conflict").cloned(),
                        "result": result,
                    })
                }
                Err(_) => {
                    if let Ok(mut guard) = runtime.lock() {
                        guard.metrics.mutation_errors =
                            guard.metrics.mutation_errors.saturating_add(1);
                    }
                    serde_json::json!({
                        "type": "ack",
                        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                        "publicationEpoch": current_publication_epoch(runtime),
                        "messageId": message_id,
                        "operationId": operation_id,
                        "ok": false,
                        "outcome": "failed",
                        "changed": false,
                        "changedPaths": [],
                        "error": safe_publication_command_error(command.as_str()),
                    })
                }
            }
        }
    };
    socket.lock().ok().is_some_and(|mut guard| {
        send_websocket_json_recorded(&mut guard, runtime, response).is_ok()
    })
}

#[cfg(target_os = "windows")]
fn publication_mutation_cache_key(session_id: &str, message_id: &str) -> String {
    format!("{session_id}:{message_id}")
}

#[cfg(target_os = "windows")]
fn serve_publication_websocket_cancellation<S>(
    socket: &Arc<Mutex<WebSocket<S>>>,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    request: Value,
) -> bool
where
    S: Read + Write,
{
    let typed_cancellation = match serde_json::from_value::<PublicationCancelFrame>(request) {
        Ok(cancellation) => cancellation,
        Err(_) => return false,
    };
    if typed_cancellation.message_type != "cancel"
        || typed_cancellation.protocol_version != PUBLICATION_PROTOCOL_VERSION
        || !is_safe_publication_operation_id(&typed_cancellation.message_id)
        || !is_safe_publication_operation_id(&typed_cancellation.operation_id)
    {
        return false;
    }
    let response = serde_json::json!({
        "type": "ack",
        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
        "publicationEpoch": current_publication_epoch(runtime),
        "messageId": typed_cancellation.message_id,
        "operationId": typed_cancellation.operation_id,
        "ok": false,
        "outcome": "unknown",
        "retryable": false,
        "cancelled": false,
        "error": "La mutacion ya no estaba en cola y su resultado no puede cancelarse.",
    });
    socket.lock().ok().is_some_and(|mut guard| {
        send_websocket_json_recorded(&mut guard, runtime, response).is_ok()
    })
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublicationMutationControlResult {
    Continue,
    Cancelled,
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublicationMutationLockError {
    Cancelled,
    Disconnected,
    TimedOut,
}

#[cfg(target_os = "windows")]
fn wait_for_publication_mutation_control<S>(
    socket: &mut WebSocket<S>,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    operation_id: &str,
) -> PublicationMutationControlResult
where
    S: Read + Write,
{
    let message = match socket.read() {
        Ok(message) => message,
        Err(error) if websocket_timeout(&error) => {
            return PublicationMutationControlResult::Continue
        }
        Err(_) => return PublicationMutationControlResult::Disconnected,
    };
    let value = match parse_websocket_text(message) {
        Ok(Some(value)) if value.is_null() => return PublicationMutationControlResult::Continue,
        Ok(Some(value)) => value,
        Ok(None) | Err(_) => return PublicationMutationControlResult::Disconnected,
    };
    let received_bytes = serialized_json_size(&value);
    if let Ok(mut guard) = runtime.lock() {
        guard.metrics.websocket_frames_received =
            guard.metrics.websocket_frames_received.saturating_add(1);
        guard.metrics.websocket_bytes_received = guard
            .metrics
            .websocket_bytes_received
            .saturating_add(received_bytes as u64);
    }
    match value.get("type").and_then(Value::as_str) {
        Some("ping") => {
            let response = serde_json::json!({
                "type": "pong",
                "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                "publicationEpoch": current_publication_epoch(runtime),
                "messageId": generate_session_token(),
            });
            if send_websocket_json_recorded(socket, runtime, response).is_err() {
                PublicationMutationControlResult::Disconnected
            } else {
                PublicationMutationControlResult::Continue
            }
        }
        Some("cancel") => {
            let typed_cancellation = match serde_json::from_value::<PublicationCancelFrame>(value) {
                Ok(cancellation) => cancellation,
                Err(_) => return PublicationMutationControlResult::Disconnected,
            };
            let valid = typed_cancellation.message_type == "cancel"
                && typed_cancellation.protocol_version == PUBLICATION_PROTOCOL_VERSION
                && is_safe_publication_operation_id(&typed_cancellation.message_id)
                && is_safe_publication_operation_id(&typed_cancellation.operation_id);
            if !valid {
                return PublicationMutationControlResult::Disconnected;
            }
            let operation_matches = typed_cancellation.operation_id == operation_id;
            let response = if operation_matches {
                serde_json::json!({
                    "type": "ack",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(runtime),
                    "messageId": typed_cancellation.message_id,
                    "operationId": typed_cancellation.operation_id,
                    "ok": false,
                    "outcome": "failed",
                    "retryable": false,
                    "cancelled": true,
                    "changed": false,
                    "error": "La mutacion fue cancelada antes de ejecutarse.",
                })
            } else {
                serde_json::json!({
                    "type": "ack",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(runtime),
                    "messageId": typed_cancellation.message_id,
                    "operationId": typed_cancellation.operation_id,
                    "ok": false,
                    "outcome": "failed",
                    "retryable": false,
                    "cancelled": false,
                    "changed": false,
                    "error": "La cancelacion no coincide con la mutacion en cola.",
                })
            };
            if send_websocket_json_recorded(socket, runtime, response).is_err() {
                return PublicationMutationControlResult::Disconnected;
            }
            if operation_matches {
                PublicationMutationControlResult::Cancelled
            } else {
                PublicationMutationControlResult::Continue
            }
        }
        Some("close") => PublicationMutationControlResult::Disconnected,
        _ => PublicationMutationControlResult::Disconnected,
    }
}

#[cfg(target_os = "windows")]
fn acquire_publication_mutation_lock<'a, S>(
    mutation_lock: &'a Arc<Mutex<()>>,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    socket: &Arc<Mutex<WebSocket<S>>>,
    session_id: Option<&str>,
    operation_id: &str,
) -> Result<std::sync::MutexGuard<'a, ()>, PublicationMutationLockError>
where
    S: Read + Write,
{
    let deadline = Instant::now() + PUBLICATION_HOST_MUTATION_WAIT;
    loop {
        if Instant::now() >= deadline {
            return Err(PublicationMutationLockError::TimedOut);
        }
        let mutation_guard = match mutation_lock.try_lock() {
            Ok(guard) => guard,
            Err(TryLockError::WouldBlock) => {
                let control = socket
                    .lock()
                    .ok()
                    .map(|mut guard| {
                        wait_for_publication_mutation_control(&mut guard, runtime, operation_id)
                    })
                    .unwrap_or(PublicationMutationControlResult::Disconnected);
                match control {
                    PublicationMutationControlResult::Continue => continue,
                    PublicationMutationControlResult::Cancelled => {
                        return Err(PublicationMutationLockError::Cancelled)
                    }
                    PublicationMutationControlResult::Disconnected => {
                        return Err(PublicationMutationLockError::Disconnected)
                    }
                }
            }
            Err(TryLockError::Poisoned(_)) => {
                return Err(PublicationMutationLockError::Disconnected)
            }
        };
        let runtime_state = match runtime.lock() {
            Ok(guard) => (
                guard.host_mutation_active,
                guard
                    .mutation_batches
                    .keys()
                    .any(|owner| Some(owner.as_str()) != session_id),
            ),
            Err(_) => return Err(PublicationMutationLockError::Disconnected),
        };
        let (host_mutation_active, another_remote_batch_active) = runtime_state;
        if !host_mutation_active && !another_remote_batch_active {
            return Ok(mutation_guard);
        }
        drop(mutation_guard);
        let control = socket
            .lock()
            .ok()
            .map(|mut guard| {
                wait_for_publication_mutation_control(&mut guard, runtime, operation_id)
            })
            .unwrap_or(PublicationMutationControlResult::Disconnected);
        match control {
            PublicationMutationControlResult::Continue => {}
            PublicationMutationControlResult::Cancelled => {
                return Err(PublicationMutationLockError::Cancelled)
            }
            PublicationMutationControlResult::Disconnected => {
                return Err(PublicationMutationLockError::Disconnected)
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn unregister_websocket_subscriber(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    subscriber_id: u64,
    session_id: &str,
) {
    let abandoned_batch = runtime.lock().ok().and_then(|mut guard| {
        guard.websocket_subscribers.remove(&subscriber_id);
        guard
            .mutation_batches
            .get(session_id)
            .map(|batch| (batch.operation_id.clone(), batch.activity_generation))
    });
    let Some((operation_id, activity_generation)) = abandoned_batch else {
        return;
    };
    let cleanup_runtime = Arc::clone(runtime);
    let cleanup_session_id = session_id.to_string();
    let fallback_operation_id = operation_id.clone();
    if std::thread::Builder::new()
        .name("notia-publication-batch-cleanup".to_string())
        .spawn(move || {
            std::thread::sleep(PUBLICATION_BATCH_RECONNECT_GRACE);
            finalize_abandoned_publication_batch(
                &cleanup_runtime,
                &cleanup_session_id,
                operation_id.as_deref(),
                activity_generation,
            );
        })
        .is_err()
    {
        log::warn!("[notia:task-manager] no se pudo programar el cleanup de un batch remoto");
        finalize_abandoned_publication_batch(
            runtime,
            session_id,
            fallback_operation_id.as_deref(),
            activity_generation,
        );
    }
}

#[cfg(target_os = "windows")]
fn finalize_abandoned_publication_batch(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: &str,
    operation_id: Option<&str>,
    activity_generation: u64,
) {
    let mutation_lock = match runtime.lock() {
        Ok(guard) => Arc::clone(&guard.mutation_lock),
        Err(_) => return,
    };
    let Ok(_mutation_guard) = mutation_lock.lock() else {
        return;
    };
    let batch = runtime.lock().ok().and_then(|mut guard| {
        let unchanged = guard.mutation_batches.get(session_id).is_some_and(|batch| {
            batch.operation_id.as_deref() == operation_id
                && batch.activity_generation == activity_generation
        });
        unchanged
            .then(|| guard.mutation_batches.remove(session_id))
            .flatten()
    });
    let Some(batch) = batch.filter(|batch| batch.changed) else {
        return;
    };
    let Some((vault_path, actor_id)) = runtime.lock().ok().and_then(|guard| {
        let vault_path = guard.payload.as_ref()?.vault_path.clone();
        let actor_id = batch.actor_id.clone().or_else(|| {
            guard
                .authenticated_sessions
                .get(session_id)
                .map(|value| safe_publication_actor_id(authenticated_session_user(value)))
        });
        Some((vault_path, actor_id))
    }) else {
        return;
    };
    notify_publication_changed(
        runtime,
        &vault_path,
        batch.changed_paths,
        batch.operation_id.as_deref(),
        actor_id.as_deref(),
        None,
    );
}

#[cfg(target_os = "windows")]
fn close_websocket_subscribers_for_device(
    guard: &mut PublicationRuntime,
    device_id: &str,
    message_type: &str,
) {
    let payload = serde_json::json!({
        "type": message_type,
        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
        "publicationEpoch": guard.publication_epoch,
        "messageId": generate_session_token(),
        "reason": "El acceso de este dispositivo fue revocado.",
    });
    let event = PublicationSocketEvent {
        payload,
        close_after_send: true,
    };
    guard.websocket_subscribers.retain(|_, subscriber| {
        if subscriber.device_id != device_id {
            return true;
        }
        let _ = subscriber.sender.try_send(event.clone());
        false
    });
}

#[cfg(target_os = "windows")]
fn cancel_publication_ai_streams_for_device(guard: &mut PublicationRuntime, device_id: &str) {
    for stream in guard.active_ai_streams.values() {
        if stream.device_id == device_id {
            stream.cancellation.store(true, Ordering::Release);
        }
    }
}

#[cfg(target_os = "windows")]
fn cancel_all_publication_ai_streams(guard: &mut PublicationRuntime) {
    for stream in guard.active_ai_streams.values() {
        stream.cancellation.store(true, Ordering::Release);
    }
}

#[cfg(target_os = "windows")]
fn close_publication_websocket_subscribers(
    guard: &mut PublicationRuntime,
    message_type: &str,
    clear_sessions: bool,
) {
    cancel_all_publication_ai_streams(guard);
    cancel_published_ai_host_requests(guard);
    let payload = serde_json::json!({
        "type": message_type,
        "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
        "publicationEpoch": guard.publication_epoch,
        "messageId": generate_session_token(),
        "reason": "La publicación ya no está disponible.",
    });
    let event = PublicationSocketEvent {
        payload,
        close_after_send: true,
    };
    let subscribers = std::mem::take(&mut guard.websocket_subscribers);
    for subscriber in subscribers.into_values() {
        let _ = subscriber.sender.try_send(event.clone());
    }
    if clear_sessions {
        guard.authenticated_sessions.clear();
    }
}

#[cfg(target_os = "windows")]
fn register_publication_ai_stream(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: &str,
) -> Option<(u64, Arc<AtomicBool>)> {
    let mut guard = runtime.lock().ok()?;
    let device_id = guard
        .authenticated_sessions
        .get(session_id)
        .map(|value| authenticated_session_user(value).to_string())?;
    if guard.payload.is_none() {
        return None;
    }
    let stream_id = guard.next_ai_stream_id;
    guard.next_ai_stream_id = guard.next_ai_stream_id.saturating_add(1);
    let cancellation = Arc::new(AtomicBool::new(false));
    guard.active_ai_streams.insert(
        stream_id,
        PublicationAiStream {
            device_id,
            cancellation: Arc::clone(&cancellation),
        },
    );
    Some((stream_id, cancellation))
}

#[cfg(target_os = "windows")]
fn unregister_publication_ai_stream(runtime: &Arc<Mutex<PublicationRuntime>>, stream_id: u64) {
    if let Ok(mut guard) = runtime.lock() {
        guard.active_ai_streams.remove(&stream_id);
    }
}

#[cfg(target_os = "windows")]
fn register_published_ai_host_request(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    request_id: &str,
    request: &PublishedAiStreamRequest,
    session_id: &str,
) -> Result<mpsc::Receiver<Value>, String> {
    let (sender, receiver) = mpsc::channel();
    let (app_handle, vault_path, library_user_id, published_board_names) = {
        let mut guard = runtime
            .lock()
            .map_err(|_| "No se pudo iniciar el chat de IA publicado.".to_string())?;
        if !guard
            .authenticated_sessions
            .get(session_id)
            .is_some_and(|value| !authenticated_session_expired(value))
        {
            return Err("La sesión publicada ya no está autorizada.".to_string());
        }
        let app_handle = guard
            .app_handle
            .clone()
            .ok_or_else(|| "La app host no está disponible.".to_string())?;
        let vault_path = guard
            .payload
            .as_ref()
            .map(|publication| publication.vault_path.clone())
            .ok_or_else(|| "La publicación ya no está disponible.".to_string())?;
        let library_user_id = guard
            .authenticated_sessions
            .get(session_id)
            .map(|value| authenticated_session_user(value).to_string())
            .ok_or_else(|| "La sesión publicada ya no está autorizada.".to_string())?;
        guard
            .published_ai_requests
            .insert(request_id.to_string(), (library_user_id.clone(), sender));
        let published_board_names = guard
            .payload
            .as_ref()
            .map(selected_board_names)
            .unwrap_or_default();
        (
            app_handle,
            vault_path,
            library_user_id,
            published_board_names,
        )
    };

    let event = serde_json::json!({
        "requestId": request_id,
        "vaultPath": vault_path,
        "libraryUserId": library_user_id,
        "prompt": request.prompt,
        "previousMessages": request.previous_messages,
        "taskManagerScopeKey": request.task_manager_scope_key,
        "scopePaths": request.scope_paths,
        "publishedBoardNames": published_board_names,
    });
    if let Err(error) = app_handle.emit(PUBLISHED_AI_HOST_REQUEST_EVENT, event) {
        unregister_published_ai_host_request(runtime, request_id);
        return Err(format!("No se pudo contactar a la app host: {error}"));
    }
    Ok(receiver)
}

#[cfg(target_os = "windows")]
fn unregister_published_ai_host_request(
    runtime: &Arc<Mutex<PublicationRuntime>>,
    request_id: &str,
) {
    if let Ok(mut guard) = runtime.lock() {
        guard.published_ai_requests.remove(request_id);
    }
}

#[cfg(target_os = "windows")]
fn cancel_published_ai_host_requests(guard: &mut PublicationRuntime) {
    let cancellation = serde_json::json!({
        "type": "error",
        "message": "La publicación ya no está disponible.",
    });
    for (_, sender) in guard.published_ai_requests.values() {
        let _ = sender.send(cancellation.clone());
    }
    guard.published_ai_requests.clear();
}

#[cfg(target_os = "windows")]
fn cancel_published_ai_host_requests_for_user(guard: &mut PublicationRuntime, user_id: &str) {
    let cancellation = serde_json::json!({
        "type": "error",
        "message": "La sesión de IA publicada ya no está autorizada.",
    });
    guard
        .published_ai_requests
        .retain(|_, (request_user_id, sender)| {
            if request_user_id != user_id {
                return true;
            }
            let _ = sender.send(cancellation.clone());
            false
        });
}

#[cfg(target_os = "windows")]
fn serve_publication_ai_stream<S: Write>(
    stream: &mut S,
    body: &[u8],
    _publication: &TaskManagerPublicationPayload,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    session_id: &str,
) {
    let request = match serde_json::from_slice::<PublishedAiStreamRequest>(body) {
        Ok(request) => request,
        Err(_) => {
            let _ = stream.write_all(&json_error("Solicitud de streaming inválida."));
            return;
        }
    };
    let Some((stream_id, cancellation)) = register_publication_ai_stream(runtime, session_id)
    else {
        let _ = stream.write_all(&text_response(
            "401 Unauthorized",
            "La sesión ya no está autorizada.",
        ));
        return;
    };
    let headers = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: application/x-ndjson; charset=utf-8\r\n",
        "Transfer-Encoding: chunked\r\n",
        "Cache-Control: no-store, no-transform\r\n",
        "X-Content-Type-Options: nosniff\r\n",
        "Connection: close\r\n\r\n"
    );
    if stream.write_all(headers.as_bytes()).is_err() || stream.flush().is_err() {
        unregister_publication_ai_stream(runtime, stream_id);
        return;
    }

    let request_id = generate_session_token();
    let receiver =
        match register_published_ai_host_request(runtime, &request_id, &request, session_id) {
            Ok(receiver) => receiver,
            Err(error) => {
                let event = serde_json::json!({ "type": "error", "message": error });
                let _ = write_chunked_json_line(stream, &event);
                let _ = stream.write_all(b"0\r\n\r\n");
                let _ = stream.flush();
                unregister_publication_ai_stream(runtime, stream_id);
                return;
            }
        };
    let mut client_disconnected = false;
    let mut completed = false;
    let mut host_error: Option<String> = None;
    while !cancellation.load(Ordering::Acquire) {
        match receiver.recv_timeout(Duration::from_millis(500)) {
            Ok(event) => {
                let event_type = event.get("type").and_then(Value::as_str);
                if !matches!(
                    event_type,
                    Some("thinking" | "delta" | "plan" | "done" | "error")
                ) {
                    host_error = Some("La app host devolvió un evento de IA inválido.".to_string());
                    break;
                }
                if write_chunked_json_line(stream, &event).is_err() {
                    client_disconnected = true;
                    break;
                }
                if matches!(event_type, Some("done" | "error")) {
                    completed = true;
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                host_error = Some("La app host cerró la solicitud de IA publicada.".to_string());
                break;
            }
        }
    }
    unregister_published_ai_host_request(runtime, &request_id);
    unregister_publication_ai_stream(runtime, stream_id);
    if cancellation.load(Ordering::Acquire) && !client_disconnected {
        if let Ok(mut guard) = runtime.lock() {
            guard.metrics.ai_stream_cancellations =
                guard.metrics.ai_stream_cancellations.saturating_add(1);
        }
        return;
    }
    if client_disconnected {
        if let Ok(mut guard) = runtime.lock() {
            guard.metrics.ai_stream_cancellations =
                guard.metrics.ai_stream_cancellations.saturating_add(1);
        }
        return;
    }
    if !completed && !client_disconnected {
        let error = host_error
            .unwrap_or_else(|| "La app host no respondió al chat de IA publicado.".to_string());
        let final_event = serde_json::json!({ "type": "error", "message": error });
        let _ = write_chunked_json_line(stream, &final_event);
    }
    let _ = stream.write_all(b"0\r\n\r\n");
    let _ = stream.flush();
}

#[cfg(target_os = "windows")]
fn write_chunked_json_line<S: Write>(stream: &mut S, value: &Value) -> std::io::Result<()> {
    let mut body = serde_json::to_vec(value).unwrap_or_else(|_| {
        b"{\"type\":\"error\",\"message\":\"No se pudo serializar el stream.\"}".to_vec()
    });
    body.push(b'\n');
    write!(stream, "{:X}\r\n", body.len())?;
    stream.write_all(&body)?;
    stream.write_all(b"\r\n")?;
    stream.flush()
}

#[cfg(target_os = "windows")]
const PUBLICATION_PATH_KEYS: &[&str] = &[
    "vaultPath",
    "directoryPath",
    "filePath",
    "path",
    "targetPath",
    "sourcePath",
    "targetDirectoryPath",
];

#[cfg(target_os = "windows")]
fn internalize_publication_paths(value: &mut Value, publication: &TaskManagerPublicationPayload) {
    match value {
        Value::Array(items) => items
            .iter_mut()
            .for_each(|item| internalize_publication_paths(item, publication)),
        Value::Object(object) => {
            for (key, item) in object.iter_mut() {
                if PUBLICATION_PATH_KEYS.contains(&key.as_str()) {
                    if let Some(path) = item.as_str() {
                        *item = Value::String(internalize_publication_path(path, publication));
                    }
                }
                internalize_publication_paths(item, publication);
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
fn internalize_publication_path(path: &str, publication: &TaskManagerPublicationPayload) -> String {
    let normalized_path = path.replace('\\', "/");
    let alias_with_separator = format!("{PUBLISHED_VAULT_ALIAS}/");
    if normalized_path.eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS) {
        return publication.vault_path.clone();
    }
    if normalized_path
        .get(..alias_with_separator.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(&alias_with_separator))
    {
        return format!(
            "{}/{}",
            publication.vault_path.trim_end_matches(['/', '\\']),
            &normalized_path[alias_with_separator.len()..]
        );
    }

    // Task Manager keeps logical paths relative to its workspace in the
    // browser snapshot. Accept that representation at the publication
    // boundary too, while the authorization layer still restricts the
    // resulting absolute path to the published boards.
    if !std::path::Path::new(&normalized_path).is_absolute() {
        let vault = publication.vault_path.trim_end_matches(['/', '\\']);
        let normalized = normalized_path.trim_matches('/');
        if publication.task_root_at_vault {
            let root_folder = std::path::Path::new(vault)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("task-mannager");
            let root_prefix = format!("{root_folder}/");
            if normalized
                .get(..root_prefix.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(&root_prefix))
            {
                return format!("{vault}/{}", &normalized[root_prefix.len()..]);
            }
        }
        return format!("{vault}/{normalized}");
    }
    path.to_string()
}

#[cfg(target_os = "windows")]
fn publicize_publication_path(path: &str, publication: &TaskManagerPublicationPayload) -> String {
    let candidate = path.replace('\\', "/");
    let vault = publication.vault_path.replace('\\', "/");
    let vault = vault.trim_end_matches('/');
    if candidate.eq_ignore_ascii_case(vault) {
        return PUBLISHED_VAULT_ALIAS.to_string();
    }
    if candidate.len() > vault.len()
        && candidate.as_bytes().get(vault.len()) == Some(&b'/')
        && candidate
            .get(..vault.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(vault))
    {
        return format!("{PUBLISHED_VAULT_ALIAS}/{}", &candidate[vault.len() + 1..]);
    }
    path.to_string()
}

#[cfg(target_os = "windows")]
fn selected_board_names(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    publication
        .boards
        .iter()
        .map(|board| board.name.trim().to_lowercase())
        .collect()
}

#[cfg(target_os = "windows")]
fn task_roots(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    let vault = normalize_path(&publication.vault_path);
    let vault_name = std::path::Path::new(&vault)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if vault_name.eq_ignore_ascii_case("task-mannager")
        || vault_name.eq_ignore_ascii_case("task-manager")
    {
        return vec![vault];
    }
    vec![
        format!("{vault}/task-mannager"),
        format!("{vault}/task-manager"),
    ]
}

/// A frontend file of the publication with its media type. Release builds
/// serve the assets embedded at compile time. Debug builds read the current
/// `dist/` on disk (kept up to date by the development script), so the
/// published page never shows an older design than the app.
#[cfg(target_os = "windows")]
fn publication_asset(
    assets: &crate::host::AssetResolver<crate::host::Wry>,
    relative_path: &str,
) -> Option<(Vec<u8>, String)> {
    #[cfg(debug_assertions)]
    {
        let path = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/.."))
            .join("..")
            .join("dist")
            .join(relative_path);
        if let Ok(bytes) = std::fs::read(&path) {
            return Some((bytes, development_mime_type(relative_path).to_string()));
        }
    }
    assets
        .get(relative_path.to_string())
        .map(|asset| (asset.bytes().to_vec(), asset.mime_type().to_string()))
}

#[cfg(all(target_os = "windows", debug_assertions))]
fn development_mime_type(relative_path: &str) -> &'static str {
    match relative_path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[cfg(target_os = "windows")]
fn serve_publication_index(assets: &crate::host::AssetResolver<crate::host::Wry>) -> Vec<u8> {
    let Some((bytes, _)) = publication_asset(assets, "public-task-manager.html") else {
        return text_response(
            "503 Service Unavailable",
            "Los recursos de Task Manager no están disponibles.",
        );
    };
    let html = String::from_utf8_lossy(&bytes).replace(
        "/assets/",
        &format!("{TASK_MANAGER_PUBLICATION_PATH}/assets/"),
    );
    response("200 OK", "text/html; charset=utf-8", html.as_bytes())
}

#[cfg(target_os = "windows")]
fn serve_asset(assets: &crate::host::AssetResolver<crate::host::Wry>, relative_path: &str) -> Vec<u8> {
    if relative_path.contains("..") {
        return text_response("404 Not Found", "No existe.");
    }
    match publication_asset(assets, relative_path) {
        Some((bytes, mime_type)) => response("200 OK", &mime_type, &bytes),
        None => text_response("404 Not Found", "No existe."),
    }
}


#[cfg(target_os = "windows")]
fn publication_url(port: u16) -> String {
    format!(
        "https://{}:{port}{TASK_MANAGER_PUBLICATION_PATH}",
        local_network_ip()
    )
}

#[cfg(target_os = "windows")]
fn publication_port(runtime: &Arc<Mutex<PublicationRuntime>>) -> Result<u16, String> {
    runtime
        .lock()
        .map_err(|_| "No se pudo consultar la publicación.")?
        .port
        .ok_or_else(|| "La publicación no está disponible.".to_string())
}

#[cfg(target_os = "windows")]
fn generate_session_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(target_os = "windows")]
fn is_safe_publication_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
}

#[cfg(target_os = "windows")]
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::fs;
    use crate::server::http::{is_safe_redirect_host as is_safe_publication_redirect_host, *};

    #[test]
    fn idle_websocket_receives_consecutive_host_and_remote_batch_changes() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            publication_epoch: "test-epoch".to_string(),
            authenticated_sessions: HashMap::from([("session".to_string(), "device".to_string())]),
            ..PublicationRuntime::default()
        }));
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listen");
        let address = listener.local_addr().expect("address");
        let server_runtime = Arc::clone(&runtime);
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            stream
                .set_read_timeout(Some(Duration::from_millis(50)))
                .expect("read timeout");
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .expect("write timeout");
            serve_publication_websocket(
                PrefixedStream::new(Vec::new(), stream),
                server_runtime,
                "session".to_string(),
            );
        });
        let stream = std::net::TcpStream::connect(address).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("client timeout");
        let (mut client, _) =
            tungstenite::client(format!("ws://{address}/task-manager/ws"), stream)
                .expect("handshake");
        send_websocket_json(
            &mut client,
            serde_json::json!({
                "type": "hello", "protocolVersion": 1, "messageId": "hello",
                "publicationEpoch": "test-epoch", "lastSequence": 0
            }),
        )
        .expect("hello");
        let welcome = parse_websocket_text(client.read().expect("welcome"))
            .expect("JSON")
            .expect("frame");
        assert_eq!(welcome["type"], "welcome");

        for sequence in 1..=12 {
            let publication = publication();
            if sequence % 2 == 0 {
                execute_publication_invoke_unlocked(
                    serde_json::json!({
                        "command": "begin_task_manager_publication_batch", "args": {},
                        "operationId": format!("operation-{sequence}")
                    }),
                    &runtime,
                    &publication,
                    Some("session"),
                )
                .expect("begin");
                for name in ["order.md", "ticket.md"] {
                    notify_publication_changed(
                        &runtime,
                        "C:/Vault",
                        vec![format!("published-vault/task-mannager/equipo/{name}")],
                        None,
                        None,
                        Some("session"),
                    );
                }
                notify_publication_changed(
                    &runtime,
                    "C:/Vault",
                    Vec::new(),
                    None,
                    Some("host"),
                    None,
                );
                assert_eq!(runtime.lock().expect("runtime").sequence, sequence - 1);
                execute_publication_invoke_unlocked(
                    serde_json::json!({
                        "command": "end_task_manager_publication_batch", "args": {},
                        "operationId": format!("operation-{sequence}")
                    }),
                    &runtime,
                    &publication,
                    Some("session"),
                )
                .expect("end");
            } else {
                notify_publication_changed(
                    &runtime,
                    "C:/Vault",
                    vec!["published-vault/task-mannager/equipo/ticket.md".to_string()],
                    None,
                    Some("host"),
                    None,
                );
            }
            // No client message is sent to wake the server's reader.
            let change =
                parse_websocket_text(client.read().expect("next broadcast before timeout"))
                    .expect("JSON")
                    .expect("frame");
            assert_eq!(change["type"], "changed");
            assert_eq!(change["sequence"], sequence);
            assert_eq!(change["revision"], sequence);
        }
        client.close(None).expect("close");
        drop(client);
        server.join().expect("server exit");
        assert!(runtime
            .lock()
            .expect("runtime")
            .websocket_subscribers
            .is_empty());
    }

    fn publication() -> TaskManagerPublicationPayload {
        TaskManagerPublicationPayload {
            library_id: Some("library-1".to_string()),
            vault_path: "C:/Vault".to_string(),
            theme: "dark".to_string(),
            max_clients: DEFAULT_PUBLICATION_CLIENT_LIMIT,
            task_root_at_vault: false,
            port: 52471,
            ai_preferences: PublishedAiPreferences {
                ollama_url: "https://ollama.example".to_string(),
                api_key: String::new(),
                selected_model: "qwen3".to_string(),
                thinking_enabled: true,
                thinking_level: "medium".to_string(),
            },
            settings: serde_json::json!({
                "activeVaultPath": null,
                "activeTab": "equipo",
                "boards": [{ "name": "equipo", "color": "#123456" }],
                "groups": [],
            }),
            boards: vec![PublishedBoard {
                name: "equipo".to_string(),
                color: "#123456".to_string(),
                groups: Vec::new(),
                tasks: Vec::new(),
            }],
        }
    }

    #[test]
    fn writes_ai_stream_events_as_http_chunks() {
        let mut output = Vec::new();
        write_chunked_json_line(
            &mut output,
            &serde_json::json!({ "type": "delta", "delta": "Hola" }),
        )
        .expect("stream chunk");

        let text = String::from_utf8(output).expect("utf8 chunk");
        let (size, remainder) = text.split_once("\r\n").expect("chunk size");
        let (body, ending) = remainder.split_once("\r\n").expect("chunk ending");
        assert_eq!(
            usize::from_str_radix(size, 16).expect("hex size"),
            body.len()
        );
        assert_eq!(ending, "");
        assert_eq!(
            serde_json::from_str::<Value>(body.trim()).expect("json body"),
            serde_json::json!({ "type": "delta", "delta": "Hola" })
        );
    }

    #[test]
    fn publication_bootstrap_contains_no_host_path_or_ai_credential() {
        let mut publication = publication();
        publication.ai_preferences.api_key = "secret-api-key".to_string();
        publication.settings["activeVaultPath"] = serde_json::json!("C:/private/vault");
        publication.settings["pomodoro"] = serde_json::json!({
            "selectedTaskPath": "C:/private/vault/task-mannager/equipo/secret.md",
            "runState": "running",
        });

        let runtime = Arc::new(Mutex::new(PublicationRuntime::default()));
        let bootstrap = build_publication_bootstrap(&publication, &runtime, None);
        let serialized = serde_json::to_string(&bootstrap).expect("bootstrap json");

        assert_eq!(bootstrap["vaultPath"], PUBLISHED_VAULT_ALIAS);
        assert_eq!(bootstrap["taskRootFolder"], "task-mannager");
        assert!(!serialized.contains("C:/Vault"));
        assert!(!serialized.contains("C:/private"));
        assert!(!serialized.contains("secret-api-key"));
        assert_eq!(bootstrap["settings"]["activeVaultPath"], Value::Null);
        assert_eq!(
            bootstrap["settings"]["pomodoro"]["selectedTaskPath"],
            Value::Null
        );
        assert_eq!(bootstrap["settings"]["pomodoro"]["runState"], "idle");
        assert!(bootstrap.get("aiPreferences").is_none());
    }

    #[test]
    fn publication_status_contains_only_aggregated_diagnostics() {
        let mut runtime = PublicationRuntime {
            payload: Some(publication()),
            server_started: true,
            ..PublicationRuntime::default()
        };
        runtime
            .authenticated_sessions
            .insert("session-1".to_string(), "device-1".to_string());
        runtime.metrics.websocket_frames_received = 3;
        runtime.metrics.websocket_bytes_received = 128;
        runtime.metrics.mutations_applied = 1;

        let status = publication_status_from_runtime(&runtime);
        let value = serde_json::to_value(status).expect("publication status json");
        let serialized = serde_json::to_string(&value).expect("publication status string");

        assert_eq!(value["active"], true);
        assert_eq!(value["authenticatedSessions"], 1);
        assert_eq!(value["websocketFramesReceived"], 3);
        assert_eq!(value["websocketBytesReceived"], 128);
        assert_eq!(value["mutationsApplied"], 1);
        assert!(!serialized.contains("vaultPath"));
        assert!(!serialized.contains("passwordHash"));
        assert!(!serialized.contains("C:/Vault"));
    }

    #[test]
    fn publication_changed_events_use_the_same_safe_settings_boundary() {
        let mut publication = publication();
        publication.settings["activeVaultPath"] = serde_json::json!("C:/private/vault");
        publication.settings["pomodoro"] = serde_json::json!({
            "selectedTaskPath": "C:/private/vault/task-mannager/equipo/secret.md",
            "runState": "running",
        });
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication),
            ..PublicationRuntime::default()
        }));

        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/visible.md".to_string()],
            Some("operation-safe-settings"),
            Some("host"),
            None,
        );

        let guard = runtime.lock().expect("safe event runtime");
        let settings = guard.change_history[0]
            .settings
            .as_ref()
            .expect("event settings");
        let serialized = serde_json::to_string(settings).expect("event settings json");
        assert!(!serialized.contains("C:/private"));
        assert_eq!(settings["activeVaultPath"], Value::Null);
        assert_eq!(settings["pomodoro"]["selectedTaskPath"], Value::Null);
        assert_eq!(settings["pomodoro"]["runState"], "idle");
    }

    #[test]
    fn publication_settings_merge_only_shared_metadata() {
        let publication = publication();
        let merged = merge_shared_publication_settings(
            serde_json::json!({
                "activeVaultPath": "C:/private",
                "activeTab": "otro",
                "boards": [{ "name": "equipo", "color": "#abcdef" }],
                "groups": [{ "name": "Nuevo", "board": "equipo" }],
            }),
            &publication.settings,
        )
        .expect("shared settings merge");

        assert_eq!(merged["activeVaultPath"], Value::Null);
        assert_eq!(merged["activeTab"], Value::Null);
        assert_eq!(merged["boards"][0]["color"], "#abcdef");
        assert_eq!(merged["groups"][0]["name"], "Nuevo");
    }

    #[test]
    fn sanitizes_shared_publication_settings() {
        let sanitized = sanitize_publication_settings(
            serde_json::json!({
                "boards": [
                    { "name": " EQUIPO ", "color": "red; background:url(https://attacker)", "activityHoursPerDay": 99, "contexto": "#Laboral" },
                    { "name": "privado", "color": "#fff" }
                ],
                "groups": [
                    { "name": "Visible", "board": "equipo", "color": "#abcdef" },
                    { "name": "Invisible", "board": "privado", "color": "#fff" },
                    { "name": "<script>", "board": "equipo", "color": "#fff" }
                ],
                "activeVaultPath": "C:/private",
            }),
            &publication(),
        )
        .expect("sanitized publication settings");

        assert_eq!(sanitized["boards"][0]["name"], "equipo");
        assert_eq!(sanitized["boards"][0]["color"], "#2e6db0");
        assert_eq!(sanitized["boards"][0]["activityHoursPerDay"], 24.0);
        assert_eq!(sanitized["boards"][0]["contexto"], "#Laboral");
        assert_eq!(sanitized["groups"].as_array().map(Vec::len), Some(1));
        assert_eq!(sanitized["groups"][0]["name"], "Visible");
    }

    #[test]
    fn reads_only_a_safe_host_header_for_https_redirects() {
        let request = b"GET /task-manager HTTP/1.1\r\nHost: 100.81.158.210:61522\r\n\r\n";
        assert_eq!(
            request_host(request).as_deref(),
            Some("100.81.158.210:61522")
        );

        let unsafe_request = b"GET / HTTP/1.1\r\nHost: bad host\r\n\r\n";
        assert_eq!(request_host(unsafe_request), None);
        assert!(is_safe_publication_redirect_host("100.81.158.210:61522"));
        assert!(is_safe_publication_redirect_host("[::1]:61522"));
        assert!(!is_safe_publication_redirect_host("example.com:61522"));
    }

    #[test]
    fn authenticated_requests_require_the_expected_https_origin() {
        let valid = b"POST /task-manager/invoke HTTP/1.1\r\nHost: 192.168.1.10:52471\r\nOrigin: https://192.168.1.10:52471\r\n\r\n";
        assert!(request_origin_is_expected(valid));

        let missing = b"POST /task-manager/invoke HTTP/1.1\r\nHost: 192.168.1.10:52471\r\n\r\n";
        assert!(!request_origin_is_expected(missing));

        let wrong = b"POST /task-manager/invoke HTTP/1.1\r\nHost: 192.168.1.10:52471\r\nOrigin: https://attacker.example\r\n\r\n";
        assert!(!request_origin_is_expected(wrong));
    }

    #[test]
    fn websocket_upgrade_requires_the_expected_https_origin() {
        let valid = b"GET /task-manager/ws HTTP/1.1\r\nHost: 192.168.1.10:52471\r\nOrigin: https://192.168.1.10:52471\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        assert!(is_websocket_upgrade(valid));

        let wrong = b"GET /task-manager/ws HTTP/1.1\r\nHost: 192.168.1.10:52471\r\nOrigin: https://attacker.example\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        assert!(!is_websocket_upgrade(wrong));
    }

    #[test]
    fn http_invoke_revalidation_requires_the_current_session_and_publication() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            authenticated_sessions: HashMap::from([(
                "session-1".to_string(),
                "device-1".to_string(),
            )]),
            ..PublicationRuntime::default()
        }));

        assert!(current_authenticated_publication(&runtime, "session-1").is_some());
        assert!(current_authenticated_publication(&runtime, "missing-session").is_none());

        runtime
            .lock()
            .expect("revalidation runtime")
            .authenticated_sessions
            .clear();
        assert!(current_authenticated_publication(&runtime, "session-1").is_none());

        runtime
            .lock()
            .expect("revalidation runtime")
            .authenticated_sessions
            .insert("session-1".to_string(), "device-1".to_string());
        runtime.lock().expect("revalidation runtime").payload = None;
        assert!(current_authenticated_publication(&runtime, "session-1").is_none());
    }

    #[test]
    fn remote_batch_cannot_start_while_the_host_batch_is_active() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            host_mutation_active: true,
            ..PublicationRuntime::default()
        }));

        let result = execute_publication_invoke_unlocked(
            serde_json::json!({
                "command": "begin_task_manager_publication_batch",
                "args": {},
                "operationId": "remote-batch-1",
            }),
            &runtime,
            &publication,
            Some("session-1"),
        );

        assert_eq!(
            result,
            Err("El host está ejecutando una operación de Task Manager.".to_string())
        );
        assert!(runtime
            .lock()
            .expect("batch overlap runtime")
            .mutation_batches
            .is_empty());
    }

    #[test]
    fn websocket_changed_payload_does_not_expose_the_vault_path() {
        let event = PublicationChange {
            publication_epoch: "epoch-1".to_string(),
            sequence: 3,
            revision: 3,
            vault_path: "C:/Users/private/vault".to_string(),
            message_id: "message-1".to_string(),
            operation_id: None,
            actor_id: None,
            settings: None,
            changed_paths: vec!["published-vault/task-mannager/equipo/demo.md".to_string()],
        };

        let payload = publication_change_socket_payload(&event);

        assert_eq!(payload.get("type").and_then(Value::as_str), Some("changed"));
        assert!(payload.get("vaultPath").is_none());
        assert_eq!(
            payload["changedPaths"],
            serde_json::json!(["published-vault/task-mannager/equipo/demo.md"])
        );
        assert_eq!(event.vault_path, "C:/Users/private/vault");
    }

    #[test]
    fn publication_batches_coalesce_paths_until_the_batch_closes() {
        let mut mutation_batches = HashMap::new();
        mutation_batches.insert("session-1".to_string(), PublicationMutationBatch::default());
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            mutation_batches,
            ..PublicationRuntime::default()
        }));

        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/one.md".to_string()],
            Some("operation-1"),
            Some("device-aaaaaa"),
            Some("session-1"),
        );
        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/two.md".to_string()],
            Some("operation-2"),
            Some("device-bbbbbb"),
            Some("session-1"),
        );

        {
            let guard = runtime.lock().expect("runtime");
            assert_eq!(guard.revision, 0);
            let batch = guard.mutation_batches.get("session-1").expect("batch");
            assert!(batch.changed);
            assert_eq!(batch.changed_paths.len(), 2);
        }

        let batch = runtime
            .lock()
            .expect("runtime")
            .mutation_batches
            .remove("session-1")
            .expect("batch");
        notify_publication_changed(
            &runtime,
            "C:/Vault",
            batch.changed_paths,
            batch.operation_id.as_deref(),
            batch.actor_id.as_deref(),
            None,
        );

        let guard = runtime.lock().expect("runtime");
        assert_eq!(guard.revision, 1);
        assert_eq!(guard.sequence, 1);
        assert_eq!(guard.change_history.len(), 1);
        assert_eq!(
            guard.change_history[0].actor_id.as_deref(),
            Some("device-bbbbbb")
        );
    }

    #[test]
    fn host_publication_batch_defers_the_event_until_all_files_are_ready() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            host_mutation_active: true,
            ..PublicationRuntime::default()
        }));

        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/one.md".to_string()],
            Some("host-operation-1"),
            Some("host"),
            None,
        );
        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/two.md".to_string()],
            Some("host-operation-1"),
            Some("host"),
            None,
        );

        {
            let guard = runtime.lock().expect("runtime");
            assert_eq!(guard.revision, 0);
            assert!(guard.host_mutation_batch.changed);
            assert_eq!(guard.host_mutation_batch.changed_paths.len(), 2);
        }

        let batch = {
            let mut guard = runtime.lock().expect("runtime");
            guard.host_mutation_active = false;
            std::mem::take(&mut guard.host_mutation_batch)
        };
        notify_publication_changed(
            &runtime,
            "C:/Vault",
            batch.changed_paths,
            batch.operation_id.as_deref(),
            batch.actor_id.as_deref(),
            None,
        );

        let guard = runtime.lock().expect("runtime");
        assert_eq!(guard.revision, 1);
        assert_eq!(guard.sequence, 1);
        assert_eq!(guard.change_history.len(), 1);
        assert_eq!(
            guard.change_history[0].operation_id.as_deref(),
            Some("host-operation-1")
        );
        assert_eq!(guard.change_history[0].changed_paths.len(), 2);
    }

    #[test]
    fn failed_publication_mutation_does_not_emit_a_changed_revision() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            ..PublicationRuntime::default()
        }));

        let result = execute_publication_invoke_unlocked(
            serde_json::json!({
                "command": "write_library_file",
                "args": {
                    "payload": {
                        "filePath": "C:/Vault/task-mannager/equipo/missing-task.md",
                        "content": "contenido"
                    }
                },
                "operationId": "failed-write-1"
            }),
            &runtime,
            &publication,
            None,
        );

        assert!(result.is_err() || result.as_ref().is_ok_and(|(_, changed)| !changed));
        let guard = runtime.lock().expect("failed mutation runtime");
        assert_eq!(guard.revision, 0);
        assert_eq!(guard.sequence, 0);
        assert!(guard.change_history.is_empty());
    }

    #[test]
    fn publication_changes_keep_monotonic_cursors_and_unique_message_ids() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            ..PublicationRuntime::default()
        }));

        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/one.md".to_string()],
            Some("operation-1"),
            Some("device-aaaaaa"),
            None,
        );
        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/two.md".to_string()],
            Some("operation-2"),
            Some("device-bbbbbb"),
            None,
        );

        let guard = runtime.lock().expect("runtime");
        assert_eq!(guard.revision, 2);
        assert_eq!(guard.sequence, 2);
        assert_eq!(
            guard
                .change_history
                .iter()
                .map(|change| (change.sequence, change.revision))
                .collect::<Vec<_>>(),
            vec![(1, 1), (2, 2)]
        );
        assert_ne!(
            guard.change_history[0].message_id,
            guard.change_history[1].message_id
        );
        assert!(guard
            .change_history
            .iter()
            .all(|change| change.publication_epoch == guard.publication_epoch));
    }

    #[test]
    fn all_authenticated_subscribers_receive_the_same_revision_once() {
        let (sender_one, receiver_one) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let (sender_two, receiver_two) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let mut subscribers = HashMap::new();
        subscribers.insert(
            1,
            PublicationSocketSubscriber {
                device_id: "device-one".to_string(),
                sender: sender_one,
            },
        );
        subscribers.insert(
            2,
            PublicationSocketSubscriber {
                device_id: "device-two".to_string(),
                sender: sender_two,
            },
        );
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            websocket_subscribers: subscribers,
            ..PublicationRuntime::default()
        }));

        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/ticket.md".to_string()],
            Some("operation-1"),
            Some("device-aaaaaa"),
            None,
        );

        let event_one = receiver_one.try_recv().expect("first subscriber event");
        let event_two = receiver_two.try_recv().expect("second subscriber event");
        assert_eq!(event_one.payload["sequence"], event_two.payload["sequence"]);
        assert_eq!(event_one.payload["revision"], event_two.payload["revision"]);
        assert_eq!(
            event_one.payload["messageId"],
            event_two.payload["messageId"]
        );
        assert_eq!(
            event_one.payload["changedPaths"],
            event_two.payload["changedPaths"]
        );
        assert!(receiver_one.try_recv().is_err());
        assert!(receiver_two.try_recv().is_err());
    }

    #[test]
    fn removes_a_slow_subscriber_instead_of_growing_memory() {
        let (sender, receiver) = mpsc::sync_channel(0);
        let mut subscribers = HashMap::new();
        subscribers.insert(
            1,
            PublicationSocketSubscriber {
                device_id: "device-slow".to_string(),
                sender,
            },
        );
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            websocket_subscribers: subscribers,
            ..PublicationRuntime::default()
        }));

        notify_publication_changed(
            &runtime,
            "C:/Vault",
            vec!["published-vault/task-mannager/equipo/ticket.md".to_string()],
            Some("operation-1"),
            Some("device-slow"),
            None,
        );

        let guard = runtime.lock().expect("runtime");
        assert!(guard.websocket_subscribers.is_empty());
        assert_eq!(guard.metrics.dropped_events, 1);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn revoking_a_device_closes_only_its_websocket_subscribers() {
        let (sender_one, receiver_one) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let (sender_two, receiver_two) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let mut subscribers = HashMap::new();
        subscribers.insert(
            1,
            PublicationSocketSubscriber {
                device_id: "device-one".to_string(),
                sender: sender_one,
            },
        );
        subscribers.insert(
            2,
            PublicationSocketSubscriber {
                device_id: "device-two".to_string(),
                sender: sender_two,
            },
        );
        let mut runtime = PublicationRuntime {
            payload: Some(publication()),
            websocket_subscribers: subscribers,
            ..PublicationRuntime::default()
        };

        close_websocket_subscribers_for_device(&mut runtime, "device-one", "access-revoked");

        assert_eq!(runtime.websocket_subscribers.len(), 1);
        let revoked = receiver_one.try_recv().expect("revocation event");
        assert_eq!(revoked.payload["type"], "access-revoked");
        assert!(revoked.close_after_send);
        assert!(receiver_two.try_recv().is_err());
    }

    #[test]
    fn websocket_handshake_replays_available_history_and_requests_resync_when_needed() {
        let mut publication_runtime = PublicationRuntime {
            payload: Some(publication()),
            authenticated_sessions: HashMap::from([(
                "session-1".to_string(),
                "device-one".to_string(),
            )]),
            publication_epoch: "epoch-1".to_string(),
            sequence: 3,
            revision: 3,
            ..PublicationRuntime::default()
        };
        for sequence in 1..=3 {
            publication_runtime
                .change_history
                .push_back(PublicationChange {
                    publication_epoch: "epoch-1".to_string(),
                    sequence,
                    revision: sequence,
                    vault_path: "C:/Vault".to_string(),
                    message_id: format!("message-{sequence}"),
                    operation_id: Some(format!("operation-{sequence}")),
                    actor_id: Some("device-one".to_string()),
                    settings: None,
                    changed_paths: Vec::new(),
                });
        }
        let runtime = Arc::new(Mutex::new(publication_runtime));

        let (_, receiver, replay_messages) = register_websocket_subscriber(
            &runtime,
            "session-1",
            &serde_json::json!({
                "type": "hello",
                "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                "messageId": "hello-1",
                "publicationEpoch": "epoch-1",
                "lastSequence": 1,
            }),
        )
        .expect("websocket registration");
        assert_eq!(replay_messages.len(), 1);
        assert_eq!(replay_messages[0]["type"], "welcome");
        assert_eq!(
            replay_messages[0]["replay"].as_array().map(Vec::len),
            Some(2)
        );
        assert!(receiver.try_recv().is_err());

        let stale_hello = serde_json::json!({
            "type": "hello",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "messageId": "hello-2",
            "publicationEpoch": "epoch-1",
            "lastSequence": 0,
        });
        {
            let mut guard = runtime.lock().expect("runtime");
            guard.websocket_subscribers.clear();
            guard.change_history.pop_front();
        }
        let (_, _, resync_messages) =
            register_websocket_subscriber(&runtime, "session-1", &stale_hello)
                .expect("websocket resync registration");
        assert_eq!(resync_messages.len(), 2);
        assert_eq!(resync_messages[0]["type"], "resync-required");
        assert_eq!(resync_messages[1]["type"], "welcome");
        assert_eq!(
            resync_messages[1]["replay"].as_array().map(Vec::len),
            Some(0)
        );
    }

    #[test]
    fn stopping_publication_closes_all_streams_and_sessions() {
        let (sender, receiver) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let mut runtime = PublicationRuntime {
            payload: Some(publication()),
            authenticated_sessions: HashMap::from([(
                "session-1".to_string(),
                "device-one".to_string(),
            )]),
            websocket_subscribers: HashMap::from([(
                1,
                PublicationSocketSubscriber {
                    device_id: "device-one".to_string(),
                    sender,
                },
            )]),
            ..PublicationRuntime::default()
        };

        close_publication_websocket_subscribers(&mut runtime, "publication-stopped", true);

        assert!(runtime.websocket_subscribers.is_empty());
        assert!(runtime.authenticated_sessions.is_empty());
        let stopped = receiver.try_recv().expect("stop event");
        assert_eq!(stopped.payload["type"], "publication-stopped");
        assert!(stopped.close_after_send);
    }

    #[test]
    fn reconfiguring_publication_closes_all_websockets_before_new_epoch() {
        let (sender, receiver) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let mut runtime = PublicationRuntime {
            payload: Some(publication()),
            authenticated_sessions: HashMap::from([(
                "session-1".to_string(),
                "device-one".to_string(),
            )]),
            websocket_subscribers: HashMap::from([(
                1,
                PublicationSocketSubscriber {
                    device_id: "device-one".to_string(),
                    sender,
                },
            )]),
            ..PublicationRuntime::default()
        };

        close_publication_websocket_subscribers(&mut runtime, "publication-reconfigured", false);

        assert!(runtime.websocket_subscribers.is_empty());
        assert_eq!(runtime.authenticated_sessions.len(), 1);
        let reconfigured = receiver.try_recv().expect("reconfigure event");
        assert_eq!(reconfigured.payload["type"], "publication-reconfigured");
        assert!(reconfigured.close_after_send);
    }

    #[test]
    fn revoking_a_device_cancels_only_its_http_ai_streams() {
        let revoked_stream = Arc::new(AtomicBool::new(false));
        let retained_stream = Arc::new(AtomicBool::new(false));
        let mut runtime = PublicationRuntime {
            active_ai_streams: HashMap::from([
                (
                    1,
                    PublicationAiStream {
                        device_id: "device-revoked".to_string(),
                        cancellation: Arc::clone(&revoked_stream),
                    },
                ),
                (
                    2,
                    PublicationAiStream {
                        device_id: "device-retained".to_string(),
                        cancellation: Arc::clone(&retained_stream),
                    },
                ),
            ]),
            ..PublicationRuntime::default()
        };

        cancel_publication_ai_streams_for_device(&mut runtime, "device-revoked");

        assert!(revoked_stream.load(Ordering::Acquire));
        assert!(!retained_stream.load(Ordering::Acquire));
    }

    #[test]
    fn http_ai_stream_registration_requires_an_authenticated_session() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            authenticated_sessions: HashMap::from([
                (
                    "session-approved".to_string(),
                    "device-approved".to_string(),
                ),
                ("session-revoked".to_string(), "device-revoked".to_string()),
            ]),
            ..PublicationRuntime::default()
        }));

        let (stream_id, cancellation) =
            register_publication_ai_stream(&runtime, "session-approved")
                .expect("approved AI stream registration");
        assert!(!cancellation.load(Ordering::Acquire));
        assert!(register_publication_ai_stream(&runtime, "missing-session").is_none());
        unregister_publication_ai_stream(&runtime, stream_id);
        assert!(runtime
            .lock()
            .expect("AI stream runtime")
            .active_ai_streams
            .is_empty());
    }

    #[test]
    fn a_second_remote_batch_is_rejected_while_one_is_active() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            mutation_batches: HashMap::from([(
                "session-remote".to_string(),
                PublicationMutationBatch::default(),
            )]),
            ..PublicationRuntime::default()
        }));

        let guard = runtime.lock().expect("overlap runtime");
        assert!(!guard.mutation_batches.is_empty());
        assert!(!guard.host_mutation_active);
        drop(guard);

        let result = execute_publication_invoke_unlocked(
            serde_json::json!({
                "command": "begin_task_manager_publication_batch",
                "args": {},
                "operationId": "remote-batch-2",
            }),
            &runtime,
            &publication,
            Some("session-remote-2"),
        );
        assert_eq!(
            result,
            Err("Ya existe otra operación remota de Task Manager en curso.".to_string())
        );
    }

    #[test]
    fn retrying_remote_begin_is_idempotent_only_for_the_same_operation() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            ..PublicationRuntime::default()
        }));
        let begin = |operation_id: &str| {
            execute_publication_invoke_unlocked(
                serde_json::json!({
                    "command": "begin_task_manager_publication_batch",
                    "args": {},
                    "operationId": operation_id,
                }),
                &runtime,
                &publication,
                Some("session-remote"),
            )
        };

        assert!(begin("move-ticket-1").is_ok());
        assert!(begin("move-ticket-1").is_ok());
        assert_eq!(
            begin("move-ticket-2"),
            Err("Ya existe una operación agrupada para esta sesión.".to_string())
        );

        runtime
            .lock()
            .expect("disconnect cleanup")
            .mutation_batches
            .remove("session-remote");
        assert!(begin("move-ticket-1").is_ok());
    }

    #[test]
    fn host_waits_for_a_remote_batch_to_finish_instead_of_rejecting_the_action() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            mutation_batches: HashMap::from([(
                "session-remote".to_string(),
                PublicationMutationBatch {
                    operation_id: Some("guest-edit".to_string()),
                    ..PublicationMutationBatch::default()
                },
            )]),
            ..PublicationRuntime::default()
        }));
        let finishing_runtime = Arc::clone(&runtime);
        let finisher = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            finishing_runtime
                .lock()
                .expect("remote batch finish")
                .mutation_batches
                .remove("session-remote");
        });

        assert_eq!(begin_host_publication_batch(&runtime), Ok(true));
        finisher.join().expect("batch finisher");
        assert!(runtime.lock().expect("host batch").host_mutation_active);
    }

    #[test]
    fn abandoned_remote_batch_is_released_but_resumed_activity_is_preserved() {
        let mut abandoned = PublicationMutationBatch {
            operation_id: Some("guest-edit".to_string()),
            ..PublicationMutationBatch::default()
        };
        abandoned.record(
            vec!["published-vault/task-mannager/equipo/ticket.md".to_string()],
            Some("guest-edit"),
            Some("guest-device"),
        );
        let abandoned_generation = abandoned.activity_generation;
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            mutation_batches: HashMap::from([("session-remote".to_string(), abandoned)]),
            ..PublicationRuntime::default()
        }));

        finalize_abandoned_publication_batch(
            &runtime,
            "session-remote",
            Some("guest-edit"),
            abandoned_generation,
        );
        {
            let guard = runtime.lock().expect("released batch");
            assert!(guard.mutation_batches.is_empty());
            assert_eq!(guard.revision, 1);
            assert_eq!(guard.sequence, 1);
        }

        let resumed = PublicationMutationBatch {
            operation_id: Some("guest-edit-2".to_string()),
            activity_generation: 2,
            ..PublicationMutationBatch::default()
        };
        runtime
            .lock()
            .expect("resumed batch insert")
            .mutation_batches
            .insert("session-remote".to_string(), resumed);
        finalize_abandoned_publication_batch(&runtime, "session-remote", Some("guest-edit-2"), 1);
        assert!(runtime
            .lock()
            .expect("resumed batch")
            .mutation_batches
            .contains_key("session-remote"));
    }

    #[test]
    fn websocket_capacity_rejects_only_the_new_subscriber() {
        let (sender, _receiver) = mpsc::sync_channel(PUBLICATION_WS_QUEUE_LIMIT);
        let mut publication = publication();
        publication.max_clients = 1;
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication),
            authenticated_sessions: HashMap::from([
                ("session-one".to_string(), "device-one".to_string()),
                ("session-two".to_string(), "device-two".to_string()),
            ]),
            websocket_subscribers: HashMap::from([(
                1,
                PublicationSocketSubscriber {
                    device_id: "device-one".to_string(),
                    sender,
                },
            )]),
            ..PublicationRuntime::default()
        }));

        let result = register_websocket_subscriber(
            &runtime,
            "session-two",
            &serde_json::json!({
                "type": "hello",
                "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                "messageId": "hello-two",
                "publicationEpoch": "",
                "lastSequence": 0,
            }),
        );

        assert!(result.is_err());
        let guard = runtime.lock().expect("runtime");
        assert_eq!(guard.websocket_subscribers.len(), 1);
        assert_eq!(guard.authenticated_sessions.len(), 2);
    }

    #[test]
    fn protocol_fixtures_keep_versioned_wire_shapes_and_safe_terminal_messages() {
        let hello = serde_json::from_value::<PublicationHelloFrame>(serde_json::json!({
            "type": "hello",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "messageId": "hello-1",
            "publicationEpoch": "epoch-1",
            "lastSequence": 4,
        }))
        .expect("hello fixture");
        assert_eq!(hello.message_type, "hello");
        assert_eq!(hello.last_sequence, Some(4));

        let mutation = serde_json::from_value::<PublicationMutateFrame>(serde_json::json!({
            "type": "mutate",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "messageId": "message-1",
            "operationId": "operation-1",
            "baseRevision": 4,
            "command": "task_manager_write_ticket_source",
            "args": {
                "payload": {
                    "logicalPath": "task-mannager/equipo/ticket.md",
                    "content": "contenido",
                    "expectedRevision": "sha256:abc"
                }
            }
        }))
        .expect("mutate fixture");
        assert_eq!(mutation.message_type, "mutate");
        assert_eq!(
            PublicationMutationCommand::parse(&mutation.command),
            Some(PublicationMutationCommand::TaskManagerWriteTicketSource)
        );
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::TaskManagerWriteTicketSource,
            &mutation.args,
        )
        .is_ok());
        for raw_command in [
            "write_library_file",
            "append_task_comment",
            "create_library_entry",
            "library_entry_operation",
        ] {
            assert_eq!(PublicationMutationCommand::parse(raw_command), None);
        }

        let cancellation = serde_json::from_value::<PublicationCancelFrame>(serde_json::json!({
            "type": "cancel",
            "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
            "messageId": "cancel-1",
            "operationId": "operation-1",
        }))
        .expect("cancel fixture");
        assert_eq!(cancellation.message_type, "cancel");
        assert_eq!(cancellation.operation_id, "operation-1");

        for message_type in [
            "welcome",
            "ack",
            "changed",
            "resync-required",
            "access-revoked",
            "publication-stopped",
            "publication-reconfigured",
            "ping",
            "pong",
        ] {
            let frame = publication_protocol_message(message_type, "message-1".to_string());
            assert_eq!(frame["type"], message_type);
            assert_eq!(frame["protocolVersion"], PUBLICATION_PROTOCOL_VERSION);
            assert_eq!(frame["messageId"], "message-1");
            assert!(!frame.to_string().contains("C:/"));
        }
    }

    #[test]
    fn mutation_deduplication_distinguishes_commands_in_the_same_operation() {
        let begin_key = publication_mutation_cache_key("session-1", "message-begin");
        let write_key = publication_mutation_cache_key("session-1", "message-write");
        let end_key = publication_mutation_cache_key("session-1", "message-end");

        assert_ne!(begin_key, write_key);
        assert_ne!(write_key, end_key);
        assert_eq!(
            write_key,
            publication_mutation_cache_key("session-1", "message-write")
        );
        assert_ne!(
            write_key,
            publication_mutation_cache_key("session-2", "message-write")
        );
    }

    #[test]
    fn publication_latency_p95_uses_bounded_histogram_buckets() {
        assert_eq!(calculate_publication_latency_p95(&[0; 6], 0), None);
        assert_eq!(
            calculate_publication_latency_p95(&[95, 0, 0, 0, 0, 5], 100),
            Some(50)
        );
        assert_eq!(
            calculate_publication_latency_p95(&[94, 0, 0, 0, 0, 6], 100),
            Some(5_000)
        );
        // Samples slower than the last bucket are counted but not bucketed.
        assert_eq!(
            calculate_publication_latency_p95(&[94, 0, 0, 0, 0, 0], 100),
            Some(5_001)
        );
    }

    #[test]
    fn every_published_mutation_is_a_registry_command_or_a_protocol_command() {
        // Protocol commands belong to the publication; the rest of its
        // mutations are registry commands a published user may run.
        for command in ["begin_task_manager_publication_batch", "end_task_manager_publication_batch"] {
            assert!(PublicationMutationCommand::parse(command).is_some(), "{command}");
            assert!(!crate::registry::is_published_command(command), "{command}");
        }
        for command in [
            "task_manager_write_ticket_source",
            "task_manager_board_execute",
            "task_manager_pomodoro",
        ] {
            assert!(PublicationMutationCommand::parse(command).is_some(), "{command}");
            assert!(crate::registry::is_published_command(command), "{command}");
        }
        for command in ["task_manager_board_view", "task_manager_read_ticket_source"] {
            assert!(PublicationMutationCommand::parse(command).is_none(), "{command}");
            assert!(crate::registry::is_published_command(command), "{command}");
        }
        assert!(PublicationMutationCommand::parse("update_task_manager_publication_settings").is_none());
    }

    #[test]
    fn publication_actor_id_is_short_and_not_the_device_token() {
        let actor_id = safe_publication_actor_id("device-secret-token");

        assert_eq!(actor_id.len(), 19);
        assert!(actor_id.starts_with("device-"));
        assert_ne!(actor_id, "device-secret-token");
        assert_eq!(actor_id, safe_publication_actor_id("device-secret-token"));
    }

    #[test]
    fn changed_paths_are_public_aliases_and_never_host_paths() {
        let publication = publication();
        let request = serde_json::json!({
            "args": {
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/demo.md",
                    "sourcePath": "C:/Users/private/other.md"
                }
            }
        });

        let paths = publication_changed_paths(&request, &publication);

        assert_eq!(
            paths,
            vec!["published-vault/task-mannager/equipo/demo.md".to_string()]
        );
        assert!(paths.iter().all(|path| !path.contains("C:/")));
    }

    #[test]
    fn supports_a_vault_that_is_itself_the_task_manager_root() {
        let mut publication = publication();
        publication.vault_path = "C:/Vault/task-mannager".to_string();

        assert_eq!(task_roots(&publication), vec!["c:/vault/task-mannager"]);
    }

    #[test]
    fn validates_typed_publication_mutation_payloads_before_execution() {
        assert!(is_safe_publication_operation_id("operation-123"));
        assert!(!is_safe_publication_operation_id("operation with spaces"));
        assert!(!is_safe_publication_operation_id("operation\n123"));
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::TaskManagerWriteTicketSource,
            &serde_json::json!({
                "payload": {
                    "logicalPath": "task-mannager/equipo/ticket.md",
                    "content": "contenido",
                    "expectedRevision": "sha256:abc"
                }
            }),
        )
        .is_ok());
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::TaskManagerWriteTicketSource,
            &serde_json::json!({
                "payload": {
                    "logicalPath": "task-mannager/equipo/ticket.md",
                    "content": "contenido"
                }
            }),
        )
        .is_err());
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::TaskManagerPomodoro,
            &serde_json::json!({
                "payload": {
                    "localDate": "2026-09-22",
                    "localTime": "10:05",
                    "action": { "type": "start" }
                }
            }),
        )
        .is_ok());
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::BeginBatch,
            &serde_json::json!({}),
        )
        .is_ok());
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::BeginBatch,
            &serde_json::json!({ "payload": {} }),
        )
        .is_err());
    }

    #[test]
    fn rate_limits_are_bounded_per_bucket_and_reject_the_next_request() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime::default()));

        assert!(allow_publication_rate(
            &runtime,
            "test-client".to_string(),
            2,
            Duration::from_secs(60),
        ));
        assert!(allow_publication_rate(
            &runtime,
            "test-client".to_string(),
            2,
            Duration::from_secs(60),
        ));
        assert!(!allow_publication_rate(
            &runtime,
            "test-client".to_string(),
            2,
            Duration::from_secs(60),
        ));
        assert_eq!(
            runtime
                .lock()
                .expect("rate limit runtime")
                .rate_limit_windows
                .len(),
            1
        );
    }

    #[test]
    fn rejects_oversized_or_malformed_publication_mutations_before_filesystem_access() {
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::TaskManagerPomodoro,
            &serde_json::json!({
                "payload": {
                    "localDate": "2026-09-22-extra",
                    "localTime": "10:05",
                    "action": {}
                }
            }),
        )
        .is_err());

        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::TaskManagerWriteTicketSource,
            &serde_json::json!({
                "payload": {
                    "logicalPath": "task-mannager/equipo/ticket.md",
                    "content": "contenido\u{0000}no valido",
                    "expectedRevision": "sha256:abc"
                }
            }),
        )
        .is_err());
        // Generic filesystem writes are not publication commands at all.
        assert!(!crate::registry::is_published_command("write_library_file"));
    }

    #[test]
    fn library_user_sessions_have_server_side_expiration_and_stable_identity() {
        let encoded = encode_authenticated_session("user-1");
        assert_eq!(authenticated_session_user(&encoded), "user-1");
        assert!(!authenticated_session_expired(&encoded));

        let expired = format!(
            "user-1\0{}",
            UNIX_EPOCH.elapsed().unwrap().as_secs().saturating_sub(1)
        );
        assert_eq!(authenticated_session_user(&expired), "user-1");
        assert!(authenticated_session_expired(&expired));
    }
}
