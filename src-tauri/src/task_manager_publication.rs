use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{mpsc, Arc, Mutex},
};

#[cfg(target_os = "windows")]
use rcgen::{CertificateParams, KeyPair};
#[cfg(target_os = "windows")]
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};
#[cfg(target_os = "windows")]
use std::fs;
#[cfg(target_os = "windows")]
use std::io::{self, Cursor, Read, Write};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::TryLockError;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "windows")]
use tauri::{Emitter, Manager};
#[cfg(target_os = "windows")]
use tungstenite::{
    accept_with_config, protocol::WebSocketConfig, Error as WebSocketError, Message, WebSocket,
};

#[cfg(target_os = "windows")]
const MAX_HTTP_REQUEST_BYTES: usize = 2 * 1024 * 1024;
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
const MAX_PUBLICATION_PENDING_DEVICES: usize = 256;
#[cfg(target_os = "windows")]
const PUBLICATION_CHANGED_PATH_LIMIT: usize = 32;
#[cfg(target_os = "windows")]
const PUBLICATION_CHANGED_PATH_MAX_BYTES: usize = 512;
#[cfg(target_os = "windows")]
const PUBLICATION_LATENCY_BUCKETS_MS: [u64; 6] = [50, 100, 250, 500, 1_000, 5_000];
const PASSWORD_HASH_ITERATIONS: u32 = 210_000;
const TASK_MANAGER_PUBLICATION_PATH: &str = "/task-manager";
const PUBLISHED_VAULT_ALIAS: &str = "published-vault";
const DEFAULT_PUBLICATION_CLIENT_LIMIT: usize = 64;
#[cfg(target_os = "windows")]
const TASK_MANAGER_SHARED_METADATA_FILE: &str = ".notia-task-manager.json";
#[cfg(target_os = "windows")]
const PUBLICATION_CERTIFICATE_VERSION: &str = "2";
#[cfg(target_os = "windows")]
const PUBLICATION_HOST_MUTATION_WAIT: Duration = Duration::from_secs(30);

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
    #[serde(rename = "vaultPath")]
    vault_path: String,
    theme: String,
    #[serde(rename = "passwordHash")]
    password_hash: String,
    #[serde(rename = "approvedDevices", default)]
    approved_devices: Vec<PublishedDevice>,
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
    model: String,
    #[serde(default)]
    think: Value,
    #[serde(default)]
    messages: Vec<crate::services::ai_service::AiChatMessage>,
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
    base_revision: Option<u64>,
    command: String,
    args: Value,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublicationMutationCommand {
    WriteLibraryFile,
    AppendTaskComment,
    CreateLibraryEntry,
    LibraryEntryOperation,
    BeginBatch,
    EndBatch,
    UpdatePublicationSettings,
}

#[cfg(target_os = "windows")]
impl PublicationMutationCommand {
    fn parse(command: &str) -> Option<Self> {
        match command {
            "write_library_file" => Some(Self::WriteLibraryFile),
            "append_task_comment" => Some(Self::AppendTaskComment),
            "create_library_entry" => Some(Self::CreateLibraryEntry),
            "library_entry_operation" => Some(Self::LibraryEntryOperation),
            "begin_task_manager_publication_batch" => Some(Self::BeginBatch),
            "end_task_manager_publication_batch" => Some(Self::EndBatch),
            "update_task_manager_publication_settings" => Some(Self::UpdatePublicationSettings),
            _ => None,
        }
    }

    fn requires_current_revision(self) -> bool {
        !matches!(self, Self::BeginBatch | Self::EndBatch)
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationWriteMutationArgs {
    payload: PublicationWriteMutationPayload,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationWriteMutationPayload {
    file_path: String,
    content: String,
    expected_revision: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationCommentMutationArgs {
    payload: PublicationCommentMutationPayload,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationCommentMutationPayload {
    file_path: String,
    comment: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationCreateEntryMutationArgs {
    payload: PublicationCreateEntryMutationPayload,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationCreateEntryMutationPayload {
    directory_path: String,
    name: String,
    kind: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationEntryOperationMutationArgs {
    payload: PublicationEntryOperationMutationPayload,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublicationEntryOperationMutationPayload {
    action: String,
    target_path: Option<String>,
    new_name: Option<String>,
    source_path: Option<String>,
    target_directory_path: Option<String>,
    mode: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
struct PublicationSettingsMutationArgs {
    settings: Value,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
struct PublicationSettingsPayloadMutationArgs {
    payload: PublicationSettingsPayload,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
struct PublicationSettingsPayload {
    settings: Value,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PublicationSettingsMutationShape {
    Direct(PublicationSettingsMutationArgs),
    Nested(PublicationSettingsPayloadMutationArgs),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PublishedDevice {
    id: String,
    name: String,
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
}

#[cfg(target_os = "windows")]
impl PublicationMutationBatch {
    fn record(
        &mut self,
        changed_paths: Vec<String>,
        operation_id: Option<&str>,
        actor_id: Option<&str>,
    ) {
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
    approved_devices: HashSet<String>,
    pending_devices: HashMap<String, String>,
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
    rate_limit_windows: HashMap<String, VecDeque<Instant>>,
    #[cfg(target_os = "windows")]
    app_handle: Option<tauri::AppHandle>,
    #[cfg(target_os = "windows")]
    assets: Option<Arc<tauri::AssetResolver<tauri::Wry>>>,
}

#[tauri::command]
pub fn hash_task_manager_publication_password(password: String) -> Result<String, String> {
    validate_publication_password(&password)?;
    let mut salt = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    Ok(format_password_hash(password.as_bytes(), &salt))
}

#[tauri::command]
pub fn publish_task_manager_boards(
    app: tauri::AppHandle,
    state: tauri::State<'_, TaskManagerPublicationState>,
    mut payload: TaskManagerPublicationPayload,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, payload);
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
        if !is_valid_password_hash(&payload.password_hash) {
            return Err("Configurá una contraseña válida para publicar.".to_string());
        }
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
            guard.approved_devices =
                guard
                    .payload
                    .as_ref()
                    .map_or_else(HashSet::new, |publication| {
                        publication
                            .approved_devices
                            .iter()
                            .map(|device| device.id.clone())
                            .collect()
                    });
            guard.pending_devices.clear();
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

#[tauri::command]
pub fn open_task_manager_publication(
    state: tauri::State<'_, TaskManagerPublicationState>,
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

#[tauri::command]
pub fn get_task_manager_publication_url(
    state: tauri::State<'_, TaskManagerPublicationState>,
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

#[tauri::command]
pub fn get_task_manager_publication_status(
    state: tauri::State<'_, TaskManagerPublicationState>,
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

#[tauri::command]
pub fn set_task_manager_publication_recovery(
    state: tauri::State<'_, TaskManagerPublicationState>,
    required: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, required);
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo actualizar el estado de recuperación de la publicación.")?;
        if required && guard.payload.is_none() {
            return Err("No hay una publicación activa para marcar en recuperación.".to_string());
        }
        guard.recovery_required = required;
        Ok(())
    }
}

#[tauri::command]
pub fn list_pending_task_manager_publication_devices(
    state: tauri::State<'_, TaskManagerPublicationState>,
) -> Result<Vec<PublishedDevice>, String> {
    Ok(state
        .inner
        .lock()
        .map_err(|_| "No se pudo consultar los dispositivos.")?
        .pending_devices
        .iter()
        .map(|(id, name)| PublishedDevice {
            id: id.clone(),
            name: name.clone(),
        })
        .collect())
}
#[tauri::command]
pub fn approve_task_manager_publication_device(
    state: tauri::State<'_, TaskManagerPublicationState>,
    device_id: String,
) -> Result<PublishedDevice, String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "No se pudo aprobar el dispositivo.")?;
    let name = guard
        .pending_devices
        .remove(&device_id)
        .ok_or_else(|| "El dispositivo ya no está pendiente.".to_string())?;
    guard.approved_devices.insert(device_id.clone());
    Ok(PublishedDevice {
        id: device_id,
        name,
    })
}

#[tauri::command]
pub fn revoke_task_manager_publication_device(
    state: tauri::State<'_, TaskManagerPublicationState>,
    device_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mutation_lock = state
        .inner
        .lock()
        .map_err(|_| "No se pudo serializar la revocación.".to_string())?
        .mutation_lock
        .clone();
    #[cfg(target_os = "windows")]
    let _mutation_guard = mutation_lock
        .lock()
        .map_err(|_| "No se pudo serializar la revocación.".to_string())?;
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "No se pudo revocar el dispositivo.")?;
    if !guard.approved_devices.remove(&device_id) {
        return Err("El dispositivo ya no tiene acceso.".to_string());
    }
    guard
        .authenticated_sessions
        .retain(|_, session_device_id| session_device_id != &device_id);
    #[cfg(target_os = "windows")]
    close_websocket_subscribers_for_device(&mut guard, &device_id, "access-revoked");
    #[cfg(target_os = "windows")]
    cancel_publication_ai_streams_for_device(&mut guard, &device_id);
    Ok(())
}

#[tauri::command]
pub fn stop_task_manager_publication(
    state: tauri::State<'_, TaskManagerPublicationState>,
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

#[tauri::command]
pub fn begin_task_manager_publication_batch(
    state: tauri::State<'_, TaskManagerPublicationState>,
) -> Result<bool, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        return Ok(false);
    }
    #[cfg(target_os = "windows")]
    {
        let mutation_lock = state
            .inner
            .lock()
            .map_err(|_| "No se pudo serializar el lote de Task Manager.".to_string())?
            .mutation_lock
            .clone();
        let _mutation_guard = mutation_lock
            .lock()
            .map_err(|_| "No se pudo serializar el lote de Task Manager.".to_string())?;
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo iniciar el lote de Task Manager.")?;
        if guard.payload.is_none() {
            return Ok(false);
        }
        if guard.host_mutation_active {
            return Err("Ya existe una operación local de Task Manager en curso.".to_string());
        }
        if !guard.mutation_batches.is_empty() {
            return Err("Ya existe una operación remota de Task Manager en curso.".to_string());
        }
        guard.host_mutation_active = true;
        guard.host_mutation_batch = PublicationMutationBatch::default();
        Ok(true)
    }
}

#[tauri::command]
pub fn end_task_manager_publication_batch(
    state: tauri::State<'_, TaskManagerPublicationState>,
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

#[tauri::command]
pub fn notify_task_manager_publication_changed(
    state: tauri::State<'_, TaskManagerPublicationState>,
    vault_path: String,
    settings: Option<Value>,
    changed_paths: Option<Vec<String>>,
    operation_id: Option<String>,
    actor_id: Option<String>,
) -> Result<Option<TaskManagerPublicationCursor>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            state,
            vault_path,
            settings,
            changed_paths,
            operation_id,
            actor_id,
        );
        return Ok(None);
    }
    #[cfg(target_os = "windows")]
    {
        let operation_id = operation_id.filter(|value| is_safe_publication_operation_id(value));
        let actor_id = actor_id.filter(|value| value == "host");
        let mutation_lock = state
            .inner
            .lock()
            .map_err(|_| "No se pudo serializar la notificación.".to_string())?
            .mutation_lock
            .clone();
        let _mutation_guard = mutation_lock
            .lock()
            .map_err(|_| "No se pudo serializar la notificación.".to_string())?;
        let is_published_vault = {
            let mut guard = state
                .inner
                .lock()
                .map_err(|_| "No se pudo notificar el cambio de Task Manager.")?;
            let is_published_vault = guard
                .payload
                .as_ref()
                .is_some_and(|publication| publication.vault_path == vault_path);
            if is_published_vault {
                if let Some(settings) = settings {
                    let Some(publication) = guard.payload.clone() else {
                        return Err("No se pudo actualizar la publicación.".to_string());
                    };
                    let settings = sanitize_publication_settings(settings, &publication)?;
                    let settings =
                        merge_shared_publication_settings(settings, &publication.settings)?;
                    if let Some(publication) = guard.payload.as_mut() {
                        publication.settings = settings;
                    }
                }
            }
            is_published_vault
        };
        if is_published_vault {
            let changed_paths = state
                .inner
                .lock()
                .ok()
                .and_then(|guard| guard.payload.clone())
                .map(|publication| {
                    sanitize_host_changed_paths(
                        changed_paths.as_deref().unwrap_or_default(),
                        &publication,
                    )
                })
                .unwrap_or_default();
            notify_publication_changed(
                &state.inner,
                &vault_path,
                changed_paths,
                operation_id.as_deref(),
                actor_id.as_deref(),
                None,
            );
            let cursor = state
                .inner
                .lock()
                .ok()
                .map(|guard| TaskManagerPublicationCursor {
                    publication_epoch: guard.publication_epoch.clone(),
                    sequence: guard.sequence,
                    revision: guard.revision,
                });
            return Ok(cursor);
        }
        Ok(None)
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
                Some(serde_json::json!({
                    "name": name,
                    "color": color,
                    "activityHoursPerDay": activity_hours,
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
fn persist_publication_shared_metadata(
    publication: &TaskManagerPublicationPayload,
    settings: &Value,
) -> Result<(), String> {
    let shared_metadata = serde_json::json!({
        "version": 1,
        "boards": settings
            .get("boards")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
        "groups": settings
            .get("groups")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    });
    let content = serde_json::to_vec_pretty(&shared_metadata)
        .map_err(|_| "Los settings compartidos son inválidos.".to_string())?;
    if content.len() > 256 * 1024 {
        return Err("Los settings compartidos superan el tamaño permitido.".to_string());
    }

    let roots = task_roots(publication);
    let task_root = roots
        .iter()
        .find(|root| std::path::Path::new(root).exists())
        .or_else(|| roots.first())
        .ok_or_else(|| "No se encontró la raíz de Task Manager.".to_string())?;
    let target = std::path::PathBuf::from(task_root).join(TASK_MANAGER_SHARED_METADATA_FILE);
    if fs::read(&target)
        .ok()
        .is_some_and(|current| current == content)
    {
        return Ok(());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "No se pudo resolver el metadata compartido.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "No se pudo preparar el metadata compartido.".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(TASK_MANAGER_SHARED_METADATA_FILE);
    let temporary = parent.join(format!(".{file_name}.notia-tmp-{}", uuid::Uuid::new_v4()));
    let write_result = (|| -> io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&content)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &target)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map_err(|_| "No se pudo guardar el metadata compartido.".to_string())
}

#[cfg(target_os = "windows")]
fn publication_tls_config(app: &tauri::AppHandle) -> Result<Arc<ServerConfig>, String> {
    let certificate_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "No se pudo resolver el directorio del certificado HTTPS.")?
        .join("task-manager-publication");
    fs::create_dir_all(&certificate_directory)
        .map_err(|_| "No se pudo preparar el directorio del certificado HTTPS.")?;

    let certificate_path = certificate_directory.join("certificate.der");
    let private_key_path = certificate_directory.join("private-key.der");
    let certificate_version_path = certificate_directory.join("version");
    let (certificate, private_key) = match (
        fs::read(&certificate_path),
        fs::read(&private_key_path),
        fs::read_to_string(&certificate_version_path),
    ) {
        (Ok(certificate), Ok(private_key), Ok(version))
            if version.trim() == PUBLICATION_CERTIFICATE_VERSION =>
        {
            (certificate, private_key)
        }
        _ => create_publication_certificate(
            &certificate_path,
            &private_key_path,
            &certificate_version_path,
        )?,
    };

    ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate)],
            PrivateKeyDer::Pkcs8(private_key.into()),
        )
        .map(Arc::new)
        .map_err(|_| "No se pudo cargar el certificado HTTPS de la publicación.".to_string())
}

#[cfg(target_os = "windows")]
fn create_publication_certificate(
    certificate_path: &std::path::Path,
    private_key_path: &std::path::Path,
    certificate_version_path: &std::path::Path,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let key_pair = KeyPair::generate()
        .map_err(|_| "No se pudo crear la clave privada HTTPS de la publicación.")?;
    let certificate = CertificateParams::new(publication_certificate_subject_names())
        .map_err(|_| "No se pudo preparar el certificado HTTPS de la publicación.")?
        .self_signed(&key_pair)
        .map_err(|_| "No se pudo crear el certificado HTTPS de la publicación.")?;
    let certificate_der = certificate.der().to_vec();
    let private_key_der = key_pair.serialize_der();
    fs::write(certificate_path, &certificate_der)
        .map_err(|_| "No se pudo guardar el certificado HTTPS de la publicación.")?;
    fs::write(private_key_path, &private_key_der)
        .map_err(|_| "No se pudo guardar la clave HTTPS de la publicación.")?;
    fs::write(certificate_version_path, PUBLICATION_CERTIFICATE_VERSION)
        .map_err(|_| "No se pudo guardar la versión del certificado HTTPS.")?;
    Ok((certificate_der, private_key_der))
}

#[cfg(target_os = "windows")]
fn publication_certificate_subject_names() -> Vec<String> {
    let mut names = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    if let Ok(adapters) = ipconfig::get_adapters() {
        names.extend(
            adapters
                .iter()
                .flat_map(|adapter| adapter.ip_addresses())
                .filter(|address| address.is_ipv4())
                .map(ToString::to_string),
        );
    }
    names.sort_unstable();
    names.dedup();
    names
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
fn serve_http_redirect(mut stream: std::net::TcpStream) {
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
    let Some(host) = request_host(&request) else {
        let _ = stream.write_all(&text_response(
            "400 Bad Request",
            "Abrí esta publicación mediante HTTPS.",
        ));
        return;
    };
    if !is_safe_publication_redirect_host(&host) {
        let _ = stream.write_all(&text_response(
            "400 Bad Request",
            "El host de la publicacion no es valido.",
        ));
        return;
    }
    let status = if method == "GET" || method == "HEAD" {
        "308 Permanent Redirect"
    } else {
        "426 Upgrade Required"
    };
    let location = format!("Location: https://{host}{path}");
    let response = response_with_headers(
        status,
        "text/plain; charset=utf-8",
        "Usá HTTPS.".as_bytes(),
        &[&location],
    );
    let _ = stream.write_all(&response);
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
                && request_session_token(&request).is_some_and(|session| {
                    guard
                        .authenticated_sessions
                        .get(session)
                        .is_some_and(|device_id| guard.approved_devices.contains(device_id))
                })
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
            request_session_token(&request).is_some_and(|session| {
                guard
                    .authenticated_sessions
                    .get(session)
                    .is_some_and(|device_id| guard.approved_devices.contains(device_id))
            }),
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
        ("POST", path) if path == format!("{base}/device") => Some((120, "device")),
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
                    json_error("No se pudo consultar el estado de la publicaciÃ³n.")
                }),
            Err(_) => json_error("No se pudo consultar el estado de la publicaciÃ³n."),
        }
    } else if method == "GET" && (path == base || path == format!("{base}/")) {
        serve_login_page()
    } else if method == "POST" && path == format!("{base}/device") {
        serve_device_registration(http_body(&request), &runtime)
    } else if method == "POST" && path == format!("{base}/login") {
        serve_login(
            http_body(&request),
            request_header_value(&request, "x-notia-device-id"),
            &publication.password_hash,
            &runtime,
            base,
        )
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
            build_publication_bootstrap(&publication, &runtime),
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
fn build_publication_bootstrap(
    publication: &TaskManagerPublicationPayload,
    runtime: &Arc<Mutex<PublicationRuntime>>,
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
    serde_json::json!({
        "vaultPath": PUBLISHED_VAULT_ALIAS,
        "taskRootAtVault": publication.task_root_at_vault,
        "theme": publication.theme,
        "publicationEpoch": publication_epoch,
        "revision": revision,
        "sequence": sequence,
        "settings": build_publication_client_settings(publication),
        "aiPreferences": {
            "ollamaUrl": "https://127.0.0.1:1",
            "apiKey": "",
            "selectedModel": publication.ai_preferences.selected_model,
            "thinkingEnabled": publication.ai_preferences.thinking_enabled,
            "thinkingLevel": publication.ai_preferences.thinking_level,
        }
    })
}

#[cfg(target_os = "windows")]
fn read_http_request<S: Read>(stream: &mut S) -> Result<Vec<u8>, &'static str> {
    let mut request = Vec::with_capacity(8192);
    let mut buffer = [0_u8; 8192];
    let mut expected_size = None;
    loop {
        let read = stream.read(&mut buffer).map_err(|_| "400 Bad Request")?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.len() > MAX_HTTP_REQUEST_BYTES {
            return Err("413 Payload Too Large");
        }
        if expected_size.is_none() {
            if let Some(header_end) = find_header_end(&request) {
                expected_size = Some(header_end + 4 + parse_content_length(&request[..header_end]));
            }
        }
        if expected_size.is_some_and(|size| request.len() >= size) {
            break;
        }
    }
    Ok(request)
}

fn validate_publication_password(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if !(8..=256).contains(&length) {
        return Err("La contraseña debe tener entre 8 y 256 caracteres.".to_string());
    }
    Ok(())
}

fn format_password_hash(password: &[u8], salt: &[u8]) -> String {
    let derived = pbkdf2_hmac_sha256(password, salt, PASSWORD_HASH_ITERATIONS);
    format!(
        "$notia-pbkdf2-sha256$v=1$i={PASSWORD_HASH_ITERATIONS}${}${}",
        encode_hex(salt),
        encode_hex(&derived)
    )
}

fn is_valid_password_hash(encoded: &str) -> bool {
    parse_password_hash(encoded).is_some()
}

fn password_matches_hash(password: &[u8], encoded: &str) -> bool {
    let Some((salt, expected)) = parse_password_hash(encoded) else {
        return false;
    };
    let actual = pbkdf2_hmac_sha256(password, &salt, PASSWORD_HASH_ITERATIONS);
    actual
        .iter()
        .zip(expected.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn parse_password_hash(encoded: &str) -> Option<(Vec<u8>, [u8; 32])> {
    let parts = encoded.split('$').collect::<Vec<_>>();
    if parts.len() != 6
        || !parts[0].is_empty()
        || parts[1] != "notia-pbkdf2-sha256"
        || parts[2] != "v=1"
        || parts[3] != format!("i={PASSWORD_HASH_ITERATIONS}")
    {
        return None;
    }
    let salt = decode_hex(parts[4])?;
    let derived = decode_hex(parts[5])?;
    if salt.len() != 16 || derived.len() != 32 {
        return None;
    }
    Some((salt, derived.try_into().ok()?))
}

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut first_input = Vec::with_capacity(salt.len() + 4);
    first_input.extend_from_slice(salt);
    first_input.extend_from_slice(&1_u32.to_be_bytes());

    let mut current = hmac_sha256(password, &first_input);
    let mut derived = current;
    for _ in 1..iterations {
        current = hmac_sha256(password, &current);
        for (target, value) in derived.iter_mut().zip(current.iter()) {
            *target ^= value;
        }
    }
    derived
}

fn hmac_sha256(key: &[u8], value: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut normalized_key = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        normalized_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= normalized_key[index];
        outer_pad[index] ^= normalized_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(value);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(target_os = "windows")]
fn safe_publication_actor_id(device_id: &str) -> String {
    let digest = Sha256::digest(device_id.as_bytes());
    format!("device-{}", encode_hex(&digest[..6]))
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(target_os = "windows")]
fn serve_login_page() -> Vec<u8> {
    const LOGIN_HTML: &str = r#"<!doctype html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notia · Task Manager</title><style>
:root{font-family:Manrope,"Segoe UI",sans-serif;color:#f8f8f2;background:#282a36;color-scheme:dark}*{box-sizing:border-box}
body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#3a3452,#21222c 62%)}
main{width:min(420px,100%);padding:30px;border:1px solid #44475a;border-radius:16px;background:#282a36;box-shadow:0 22px 60px #0008}
h1{margin:0 0 8px;font-size:24px}p{margin:0 0 22px;color:#a6accd;line-height:1.5}label{display:grid;gap:8px;font-size:13px;font-weight:700}
input,button{width:100%;min-height:48px;border-radius:10px;font:inherit}input{padding:0 13px;border:1px solid #6272a4;background:#21222c;color:#f8f8f2;outline:none}
input:focus{border-color:#8be9fd;box-shadow:0 0 0 3px #8be9fd33}button{margin-top:16px;border:0;background:#bd93f9;color:#181927;font-weight:800;cursor:pointer}
button:disabled{opacity:.65;cursor:wait}#error{min-height:20px;margin:12px 0 0;color:#ff6b7c;font-size:13px}.remember{display:flex;align-items:center;gap:9px;margin-top:14px;font-weight:500}.remember input{width:18px;min-height:18px;padding:0;accent-color:#bd93f9}
</style></head><body><main><h1>Task Manager</h1><p>Ingresá la contraseña configurada en Notia para acceder a los tableros publicados.</p>
<form id="login"><label>Contraseña<input id="password" type="password" minlength="8" maxlength="256" autocomplete="current-password" required autofocus></label>
<label class="remember"><input id="remember" type="checkbox">Recordar contraseña en este dispositivo</label>
<button id="submit" type="submit">Acceder</button><div id="error" role="alert" aria-live="polite"></div></form></main>
<script>
const form=document.getElementById('login'),password=document.getElementById('password'),remember=document.getElementById('remember'),button=document.getElementById('submit'),error=document.getElementById('error');
const base=location.pathname.replace(/\/+$/,'');
const deviceId=localStorage.getItem('notia-task-manager-device-id')||crypto.randomUUID().replaceAll('-','');localStorage.setItem('notia-task-manager-device-id',deviceId);
const passwordDatabase='notia-task-manager-passwords',passwordKey='password',encryptionKey='encryption-key';
function openPasswordDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(passwordDatabase,1);request.onupgradeneeded=()=>{const database=request.result;database.createObjectStore('passwords');database.createObjectStore('keys')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function getStoredValue(database,store,key){return new Promise((resolve,reject)=>{const request=database.transaction(store,'readonly').objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function putStoredValue(database,store,key,value){return new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readwrite');transaction.objectStore(store).put(value,key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error)})}
function deleteStoredValue(database,store,key){return new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readwrite');transaction.objectStore(store).delete(key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error)})}
function bytesToBase64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)))}function base64ToBytes(value){return Uint8Array.from(atob(value),character=>character.charCodeAt(0))}
async function getEncryptionKey(database){let key=await getStoredValue(database,'keys',encryptionKey);if(key)return key;key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await putStoredValue(database,'keys',encryptionKey,key);return key}
async function loadRememberedPassword(){const database=await openPasswordDatabase(),stored=await getStoredValue(database,'passwords',passwordKey);if(!stored)return null;const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(stored.iv)},await getEncryptionKey(database),base64ToBytes(stored.ciphertext));return new TextDecoder().decode(decrypted)}
async function saveRememberedPassword(value){const database=await openPasswordDatabase(),iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await getEncryptionKey(database),new TextEncoder().encode(value));await putStoredValue(database,'passwords',passwordKey,{iv:bytesToBase64(iv),ciphertext:bytesToBase64(encrypted)})}
async function clearRememberedPassword(){const database=await openPasswordDatabase();await deleteStoredValue(database,'passwords',passwordKey)}
void loadRememberedPassword().then((value)=>{if(value){password.value=value;remember.checked=true}}).catch(()=>{remember.checked=false});
form.addEventListener('submit',async(event)=>{event.preventDefault();event.stopImmediatePropagation();button.disabled=true;error.textContent='';try{const response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json','x-notia-device-id':deviceId},body:JSON.stringify({password:password.value})});const body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo iniciar sesion.');if(remember.checked)await saveRememberedPassword(password.value);else await clearRememberedPassword();location.assign(base+'/app');}catch(reason){error.textContent=reason instanceof Error?reason.message:'No se pudo iniciar sesion.';password.select();button.disabled=false;}},true);
async function register(){try{const response=await fetch(base+'/device',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId,deviceName:navigator.userAgent.slice(0,80)})});const body=await response.json();if(body.approved){password.disabled=false;button.disabled=false;error.textContent='Dispositivo autorizado. Ingresá la contraseña.';return true;}password.disabled=true;button.disabled=true;error.textContent='Esperando autorización desde Notia en la PC anfitriona.';}catch{password.disabled=true;button.disabled=true;error.textContent='No se pudo confirmar la autorización con Notia.';}return false;}void (async()=>{while(!await register())await new Promise((resolve)=>setTimeout(resolve,2000));})();
</script></body></html>"#;
    response("200 OK", "text/html; charset=utf-8", LOGIN_HTML.as_bytes())
}

#[cfg(target_os = "windows")]
fn serve_device_registration(body: &[u8], runtime: &Arc<Mutex<PublicationRuntime>>) -> Vec<u8> {
    let input = serde_json::from_slice::<Value>(body).ok();
    let device_id = input
        .as_ref()
        .and_then(|value| value.get("deviceId"))
        .and_then(Value::as_str);
    let name = input
        .as_ref()
        .and_then(|value| value.get("deviceName"))
        .and_then(Value::as_str);
    let Some((device_id, name)) = device_id.zip(name).filter(|(id, name)| {
        id.len() >= 16
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            && !name.trim().is_empty()
    }) else {
        return json_error("Dispositivo inválido.");
    };
    if !allow_publication_rate(
        runtime,
        format!("device-registration:{device_id}"),
        6,
        Duration::from_secs(60),
    ) {
        return publication_rate_limited_response(
            "Demasiadas solicitudes de registro para este dispositivo.",
        );
    }
    let approved = runtime.lock().ok().is_some_and(|mut guard| {
        if guard.approved_devices.contains(device_id) {
            true
        } else if !guard.pending_devices.contains_key(device_id)
            && guard.pending_devices.len() >= MAX_PUBLICATION_PENDING_DEVICES
        {
            false
        } else {
            guard.pending_devices.insert(
                device_id.to_string(),
                name.trim().chars().take(80).collect(),
            );
            false
        }
    });
    let pending_at_capacity = runtime.lock().ok().is_some_and(|guard| {
        !guard.approved_devices.contains(device_id)
            && guard.pending_devices.len() >= MAX_PUBLICATION_PENDING_DEVICES
            && !guard.pending_devices.contains_key(device_id)
    });
    if pending_at_capacity {
        return publication_rate_limited_response(
            "La publicación alcanzó su capacidad de solicitudes pendientes.",
        );
    }
    json_response("200 OK", serde_json::json!({ "approved": approved }))
}

#[cfg(target_os = "windows")]
fn serve_login(
    body: &[u8],
    device_id: Option<String>,
    expected_hash: &str,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    publication_path: &str,
) -> Vec<u8> {
    let Some(device_id) = device_id.filter(|id| {
        runtime
            .lock()
            .ok()
            .is_some_and(|guard| guard.approved_devices.contains(id))
    }) else {
        return json_response(
            "403 Forbidden",
            serde_json::json!({ "error": "Esperá la autorización del dispositivo desde Notia." }),
        );
    };
    if !allow_publication_rate(
        runtime,
        format!("login:{device_id}"),
        10,
        Duration::from_secs(60),
    ) {
        return publication_rate_limited_response(
            "Demasiados intentos de inicio de sesión. Esperá antes de volver a intentar.",
        );
    }
    let password = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("password")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    let Some(password) = password else {
        return json_error("Ingresá la contraseña.");
    };
    if validate_publication_password(&password).is_err() {
        return json_error("Contraseña incorrecta.");
    }
    let verified = password_matches_hash(password.as_bytes(), expected_hash);
    if !verified {
        return json_error("Contraseña incorrecta.");
    }

    let at_capacity = runtime.lock().ok().is_some_and(|guard| {
        guard.payload.as_ref().is_some_and(|publication| {
            guard.authenticated_sessions.len() >= publication_client_limit(publication)
        })
    });
    if at_capacity {
        return json_response_with_headers(
            "429 Too Many Requests",
            serde_json::json!({
                "error": "La publicación alcanzó su capacidad máxima de sesiones.",
                "retryable": true,
            }),
            &["Retry-After: 30"],
        );
    }

    let session = generate_session_token();
    let inserted = runtime.lock().ok().is_some_and(|mut guard| {
        let hash_is_current = guard
            .payload
            .as_ref()
            .is_some_and(|payload| payload.password_hash == expected_hash);
        if !hash_is_current {
            return false;
        }
        if guard.payload.as_ref().is_some_and(|publication| {
            guard.authenticated_sessions.len() >= publication_client_limit(publication)
        }) {
            return false;
        }
        if !guard.approved_devices.contains(&device_id) {
            return false;
        }
        guard
            .authenticated_sessions
            .insert(session.clone(), device_id);
        true
    });
    if !inserted {
        let at_capacity = runtime.lock().ok().is_some_and(|guard| {
            guard.payload.as_ref().is_some_and(|publication| {
                guard.authenticated_sessions.len() >= publication_client_limit(publication)
            })
        });
        if at_capacity {
            return json_response_with_headers(
                "429 Too Many Requests",
                serde_json::json!({
                    "error": "La publicación alcanzó su capacidad máxima de sesiones.",
                    "retryable": true,
                }),
                &["Retry-After: 30"],
            );
        }
        return json_error("La publicación cambió. Volvé a intentarlo.");
    }

    let cookie = format!(
        "Set-Cookie: notia_task_session={session}; Secure; HttpOnly; SameSite=Strict; Path={publication_path}; Max-Age=43200"
    );
    json_response_with_headers(
        "200 OK",
        serde_json::json!({ "ok": true }),
        &[cookie.as_str()],
    )
}

#[cfg(target_os = "windows")]
fn request_session_token(request: &[u8]) -> Option<&str> {
    let header_end = find_header_end(request)?;
    let headers = std::str::from_utf8(&request[..header_end]).ok()?;
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if !name.eq_ignore_ascii_case("cookie") {
            return None;
        }
        value.split(';').find_map(|cookie| {
            let (cookie_name, cookie_value) = cookie.trim().split_once('=')?;
            (cookie_name == "notia_task_session").then_some(cookie_value)
        })
    })
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
    if let Some(command) = request.get("command").and_then(Value::as_str) {
        let payload = request
            .get("args")
            .and_then(|args| args.get("payload"))
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(response) = serve_publication_ai_command(command, &payload, &publication) {
            return response;
        }
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
            let device_id = guard.authenticated_sessions.get(session_id)?;
            if !guard.approved_devices.contains(device_id) {
                return None;
            }
            guard.payload.clone()
        });
        let Some(current_publication) = current_publication else {
            return json_error("La sesión ya no está autorizada.");
        };
        execute_publication_invoke_unlocked(request, runtime, &current_publication, session_id)
    } else {
        execute_publication_invoke(request, runtime, &publication)
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
    runtime.lock().ok().and_then(|guard| {
        let device_id = guard.authenticated_sessions.get(session_id)?;
        if !guard.approved_devices.contains(device_id) {
            return None;
        }
        guard.payload.clone()
    })
}

#[cfg(target_os = "windows")]
fn execute_publication_invoke(
    request: Value,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    publication: &TaskManagerPublicationPayload,
) -> Result<(Value, bool), String> {
    let command = request
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| "Operación inválida.".to_string())?;
    if is_mutating_publication_command(command) {
        let mutation_lock = runtime
            .lock()
            .map_err(|_| "No se pudo serializar la mutación.".to_string())?
            .mutation_lock
            .clone();
        let _mutation_guard = mutation_lock
            .lock()
            .map_err(|_| "No se pudo serializar la mutación.".to_string())?;
        return execute_publication_invoke_unlocked(request, runtime, publication, None);
    }
    execute_publication_invoke_unlocked(request, runtime, publication, None)
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
    if command == "begin_task_manager_publication_batch" {
        let session_id =
            session_id.ok_or_else(|| "La sesión WebSocket es obligatoria.".to_string())?;
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
        if guard.mutation_batches.contains_key(session_id) {
            return Err("Ya existe una operación agrupada para esta sesión.".to_string());
        }
        guard
            .mutation_batches
            .insert(session_id.to_string(), PublicationMutationBatch::default());
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
                    .and_then(|guard| guard.authenticated_sessions.get(session_id).cloned())
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
    if command == "update_task_manager_publication_settings" {
        let settings = request
            .get("args")
            .and_then(|args| args.get("settings"))
            .or_else(|| {
                request
                    .get("args")
                    .and_then(|args| args.get("payload"))
                    .and_then(|payload| payload.get("settings"))
            })
            .cloned()
            .ok_or_else(|| "Faltan los settings de publicación.".to_string())?;
        let settings = sanitize_publication_settings(settings, publication)?;
        let settings = merge_shared_publication_settings(settings, &publication.settings)?;
        if serde_json::to_vec(&settings)
            .map_err(|_| "Los settings de publicación son inválidos.".to_string())?
            .len()
            > 256 * 1024
        {
            return Err("Los settings de publicación superan el tamaño permitido.".to_string());
        }
        let settings_changed = publication.settings != settings;
        if settings_changed {
            persist_publication_shared_metadata(publication, &settings)?;
        }
        let mut guard = runtime
            .lock()
            .map_err(|_| "No se pudieron actualizar los settings publicados.".to_string())?;
        let Some(active_publication) = guard.payload.as_ref() else {
            return Err("La publicación no está disponible.".to_string());
        };
        if active_publication.vault_path != publication.vault_path {
            return Err("La publicación cambió. Volvé a intentarlo.".to_string());
        }
        guard
            .payload
            .as_mut()
            .ok_or_else(|| "La publicación no está disponible.".to_string())?
            .settings = settings.clone();
        let client_settings = guard
            .payload
            .as_ref()
            .map(build_publication_client_settings)
            .ok_or_else(|| "La publicación no está disponible.".to_string())?;
        return Ok((
            serde_json::json!({
                "ok": true,
                "changed": settings_changed,
                "error": null,
                "settings": client_settings,
            }),
            settings_changed,
        ));
    }
    let mut payload = request
        .get("args")
        .and_then(|args| args.get("payload"))
        .cloned()
        .unwrap_or(Value::Null);
    if !matches!(
        command,
        "list_desktop_ai_models" | "run_desktop_ai_tool_chat"
    ) {
        internalize_publication_paths(&mut payload, publication);
    }
    if command == "append_task_comment" {
        return execute_publication_comment_append(&payload, publication);
    }
    if let Some(result) = virtual_publication_result(command, &payload, publication) {
        return Ok((result, false));
    }
    if matches!(
        command,
        "list_desktop_ai_models" | "run_desktop_ai_tool_chat"
    ) {
        return Err("Las operaciones de IA usan el transporte de streaming HTTP.".to_string());
    }
    if !authorize_publication_command(command, &payload, publication) {
        return Err("La URL solo puede acceder a los tableros publicados.".to_string());
    }
    validate_publication_filesystem_paths(&payload, publication)?;
    let result = crate::filesystem::commands::execute_desktop_filesystem_command(command, payload)?;
    let changed = is_mutating_publication_command(command)
        && result.get("ok").and_then(Value::as_bool).unwrap_or(true);
    let result = sanitize_publication_result(command, result);
    let result = filter_publication_result(command, result, publication);
    Ok((publicize_publication_paths(result, publication), changed))
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

    validate_typed_publication_mutation_args(command, args)?;

    match command {
        PublicationMutationCommand::BeginBatch | PublicationMutationCommand::EndBatch => {
            if args.as_object().is_some_and(|object| object.is_empty()) {
                Ok(())
            } else {
                Err("El lote publicado no acepta argumentos adicionales.".to_string())
            }
        }
        PublicationMutationCommand::UpdatePublicationSettings => {
            let settings = args
                .get("settings")
                .or_else(|| {
                    args.get("payload")
                        .and_then(|payload| payload.get("settings"))
                })
                .filter(|value| value.is_object())
                .ok_or_else(|| "La mutación de settings requiere un objeto válido.".to_string())?;
            let size = serde_json::to_vec(settings)
                .map_err(|_| "Los settings publicados son inválidos.".to_string())?
                .len();
            if size > 256 * 1024 {
                return Err("Los settings publicados superan el tamaño permitido.".to_string());
            }
            Ok(())
        }
        PublicationMutationCommand::WriteLibraryFile => {
            let payload = required_publication_mutation_payload(args)?;
            require_publication_string(payload, "filePath", 2_048)?;
            require_publication_text(payload, "content", MAX_PUBLICATION_WS_MESSAGE_BYTES)?;
            validate_optional_publication_string(payload, "expectedRevision", 128)
        }
        PublicationMutationCommand::AppendTaskComment => {
            let payload = required_publication_mutation_payload(args)?;
            require_publication_string(payload, "filePath", 2_048)?;
            require_publication_text(payload, "comment", 10_000)
        }
        PublicationMutationCommand::CreateLibraryEntry => {
            let payload = required_publication_mutation_payload(args)?;
            require_publication_string(payload, "directoryPath", 2_048)?;
            require_publication_string(payload, "name", 255)?;
            require_publication_string(payload, "kind", 32)
        }
        PublicationMutationCommand::LibraryEntryOperation => {
            let payload = required_publication_mutation_payload(args)?;
            require_publication_string(payload, "action", 32)
        }
    }
}

#[cfg(target_os = "windows")]
fn validate_typed_publication_mutation_args(
    command: PublicationMutationCommand,
    args: &Value,
) -> Result<(), String> {
    let invalid = || "Los argumentos de la mutación publicada son inválidos.".to_string();
    match command {
        PublicationMutationCommand::BeginBatch | PublicationMutationCommand::EndBatch => Ok(()),
        PublicationMutationCommand::WriteLibraryFile => {
            let typed = serde_json::from_value::<PublicationWriteMutationArgs>(args.clone())
                .map_err(|_| invalid())?;
            let _ = (
                typed.payload.file_path,
                typed.payload.content,
                typed.payload.expected_revision,
            );
            Ok(())
        }
        PublicationMutationCommand::AppendTaskComment => {
            let typed = serde_json::from_value::<PublicationCommentMutationArgs>(args.clone())
                .map_err(|_| invalid())?;
            let _ = (typed.payload.file_path, typed.payload.comment);
            Ok(())
        }
        PublicationMutationCommand::CreateLibraryEntry => {
            let typed = serde_json::from_value::<PublicationCreateEntryMutationArgs>(args.clone())
                .map_err(|_| invalid())?;
            let _ = (
                typed.payload.directory_path,
                typed.payload.name,
                typed.payload.kind,
            );
            Ok(())
        }
        PublicationMutationCommand::LibraryEntryOperation => {
            let typed =
                serde_json::from_value::<PublicationEntryOperationMutationArgs>(args.clone())
                    .map_err(|_| invalid())?;
            let _ = (
                typed.payload.action,
                typed.payload.target_path,
                typed.payload.new_name,
                typed.payload.source_path,
                typed.payload.target_directory_path,
                typed.payload.mode,
            );
            Ok(())
        }
        PublicationMutationCommand::UpdatePublicationSettings => {
            let typed = serde_json::from_value::<PublicationSettingsMutationShape>(args.clone())
                .map_err(|_| invalid())?;
            match typed {
                PublicationSettingsMutationShape::Direct(value) => {
                    let _ = value.settings;
                }
                PublicationSettingsMutationShape::Nested(value) => {
                    let _ = value.payload.settings;
                }
            }
            Ok(())
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
fn validate_optional_publication_string(
    payload: &serde_json::Map<String, Value>,
    key: &str,
    max_length: usize,
) -> Result<(), String> {
    let Some(value) = payload.get(key) else {
        return Ok(());
    };
    let value = value
        .as_str()
        .filter(|value| value.len() <= max_length && !value.chars().any(char::is_control))
        .ok_or_else(|| "La mutación publicada contiene un campo inválido.".to_string())?;
    if value.is_empty() {
        return Err("La mutación publicada contiene un campo inválido.".to_string());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn safe_publication_command_error(command: &str) -> &'static str {
    match command {
        "read_library_file" | "read_markdown_files" => "No se pudo leer el contenido publicado.",
        "write_library_file" => "No se pudo guardar el contenido publicado.",
        "create_library_entry" => "No se pudo crear la entrada publicada.",
        "library_entry_operation" => "No se pudo actualizar la entrada publicada.",
        "append_task_comment" => "No se pudo agregar el comentario publicado.",
        "update_task_manager_publication_settings" => {
            "No se pudo actualizar la configuración publicada."
        }
        _ => "No se pudo completar la operación publicada.",
    }
}

#[cfg(target_os = "windows")]
fn sanitize_publication_result(command: &str, mut result: Value) -> Value {
    let Some(object) = result.as_object_mut() else {
        return result;
    };
    if object.get("ok").and_then(Value::as_bool) == Some(false)
        && object.get("error").is_some_and(|error| !error.is_null())
    {
        object.insert(
            "error".to_string(),
            Value::String(safe_publication_command_error(command).to_string()),
        );
    }
    result
}

#[cfg(target_os = "windows")]
fn execute_publication_comment_append(
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Result<(Value, bool), String> {
    let file_path = payload
        .get("filePath")
        .and_then(Value::as_str)
        .map(normalize_path)
        .ok_or_else(|| "Falta el archivo de la tarea.".to_string())?;
    let comment = payload
        .get("comment")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|comment| !comment.is_empty() && comment.chars().count() <= 10_000)
        .ok_or_else(|| "El comentario no es válido.".to_string())?;
    if !authorize_publication_command(
        "append_task_comment",
        &serde_json::json!({ "filePath": file_path }),
        publication,
    ) {
        return Err("El comentario está fuera del alcance publicado.".to_string());
    }

    validate_publication_filesystem_paths(
        &serde_json::json!({ "filePath": file_path }),
        publication,
    )?;

    let current = crate::filesystem::desktop::read_library_file(&file_path);
    if !current.ok {
        return Err("No se pudo leer la tarea publicada.".to_string());
    }
    let timestamp = unix_timestamp_millis();
    let comment_block = format!("## Comentario - {timestamp}\n{comment}\n");
    let next_content = if current.content.trim().is_empty() {
        comment_block
    } else {
        format!("{}\n\n{comment_block}", current.content.trim_end())
    };
    let write_result = crate::filesystem::desktop::write_library_file(
        &file_path,
        &next_content,
        current.revision.as_deref(),
    );
    let changed = write_result.ok;
    let result = serde_json::to_value(write_result)
        .map_err(|_| "No se pudo serializar el resultado del comentario.".to_string())?;
    Ok((publicize_publication_paths(result, publication), changed))
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
fn is_websocket_upgrade(request: &[u8]) -> bool {
    let Some(upgrade) = request_header_value(request, "upgrade") else {
        return false;
    };
    let Some(connection) = request_header_value(request, "connection") else {
        return false;
    };
    let Some(version) = request_header_value(request, "sec-websocket-version") else {
        return false;
    };
    request_header_value(request, "sec-websocket-key").is_some()
        && upgrade.eq_ignore_ascii_case("websocket")
        && connection
            .split(',')
            .any(|value| value.trim().eq_ignore_ascii_case("upgrade"))
        && version.trim() == "13"
        && request_origin_is_expected(request)
}

#[cfg(target_os = "windows")]
fn request_origin_is_expected(request: &[u8]) -> bool {
    let Some(origin) = request_header_value(request, "origin") else {
        return false;
    };
    request_host(request).is_some_and(|host| {
        origin
            .trim_end_matches('/')
            .eq_ignore_ascii_case(&format!("https://{host}"))
    })
}

#[cfg(target_os = "windows")]
struct PrefixedStream<S> {
    prefix: Cursor<Vec<u8>>,
    stream: S,
}

#[cfg(target_os = "windows")]
impl<S> PrefixedStream<S> {
    fn new(prefix: Vec<u8>, stream: S) -> Self {
        Self {
            prefix: Cursor::new(prefix),
            stream,
        }
    }
}

#[cfg(target_os = "windows")]
impl<S: Read> Read for PrefixedStream<S> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.prefix.read(buffer)?;
        if read > 0 {
            return Ok(read);
        }
        self.stream.read(buffer)
    }
}

#[cfg(target_os = "windows")]
impl<S: Write> Write for PrefixedStream<S> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.stream.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

#[cfg(target_os = "windows")]
fn websocket_timeout(error: &WebSocketError) -> bool {
    matches!(
        error,
        WebSocketError::Io(io_error)
            if matches!(io_error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut)
    )
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
    let Ok(mut guard) = runtime.lock() else {
        return false;
    };
    const MAX_RATE_LIMIT_BUCKETS: usize = 1024;
    if !guard.rate_limit_windows.contains_key(&bucket_key)
        && guard.rate_limit_windows.len() >= MAX_RATE_LIMIT_BUCKETS
    {
        return false;
    }
    let now = Instant::now();
    let bucket = guard.rate_limit_windows.entry(bucket_key).or_default();
    while bucket
        .front()
        .is_some_and(|timestamp| now.duration_since(*timestamp) >= window)
    {
        bucket.pop_front();
    }
    if bucket.len() >= limit {
        return false;
    }
    bucket.push_back(now);
    true
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
    let Some(device_id) = guard.authenticated_sessions.get(session_id).cloned() else {
        return Err("La sesión ya no está autorizada.".to_string());
    };
    if !guard.approved_devices.contains(&device_id) || guard.payload.is_none() {
        return Err("El dispositivo ya no tiene acceso.".to_string());
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
    let base_revision = typed_mutation.base_revision;
    let command_kind = PublicationMutationCommand::parse(&command);
    let invalid_mutation_args = command_kind
        .and_then(|kind| validate_publication_mutation_args(kind, &mutation_args).err());
    let operation_cache_key = format!("{session_id}:{operation_id}");
    let rate_limited = !operation_id.is_empty()
        && !allow_publication_rate(
            runtime,
            format!("mutation:{session_id}"),
            60,
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
        let authorized = runtime.lock().ok().is_some_and(|guard| {
            guard
                .authenticated_sessions
                .get(session_id)
                .is_some_and(|device_id| guard.approved_devices.contains(device_id))
        });
        if !authorized || publication.is_none() {
            return false;
        }
        let cached = runtime
            .lock()
            .ok()
            .and_then(|guard| guard.completed_mutations.get(&operation_cache_key).cloned());
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
            let (current_revision, conflicting_operation_id, conflicting_actor_id) = runtime
                .lock()
                .ok()
                .map(|guard| {
                    (
                        guard.revision,
                        guard.last_operation_id.clone(),
                        guard.last_actor_id.clone(),
                    )
                })
                .unwrap_or_default();
            let requires_current_revision =
                command_kind.is_some_and(PublicationMutationCommand::requires_current_revision);
            if requires_current_revision && base_revision != Some(current_revision) {
                if let Ok(mut guard) = runtime.lock() {
                    guard.metrics.conflicts = guard.metrics.conflicts.saturating_add(1);
                    guard.metrics.mutation_errors = guard.metrics.mutation_errors.saturating_add(1);
                }
                let response = serde_json::json!({
                    "type": "ack",
                    "protocolVersion": PUBLICATION_PROTOCOL_VERSION,
                    "publicationEpoch": current_publication_epoch(runtime),
                    "messageId": message_id,
                    "operationId": operation_id.clone(),
                    "ok": false,
                    "outcome": "failed",
                    "retryable": false,
                    "revision": current_revision,
                    "error": "CONFLICT: el estado publicado cambió desde la ultima lectura.",
                    "conflict": {
                        "kind": "revision",
                        "expectedRevision": base_revision,
                        "currentRevision": current_revision,
                        "operationId": conflicting_operation_id,
                        "actorId": conflicting_actor_id,
                    },
                });
                return socket.lock().ok().is_some_and(|mut guard| {
                    send_websocket_json_recorded(&mut guard, runtime, response).is_ok()
                });
            }
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
                        .and_then(|guard| guard.authenticated_sessions.get(session_id).cloned())
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
                            operation_cache_key,
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
                    if ok
                        && matches!(
                            command.as_str(),
                            "begin_task_manager_publication_batch"
                                | "end_task_manager_publication_batch"
                        )
                    {
                        if let Ok(mut guard) = runtime.lock() {
                            guard.completed_mutations.insert(
                                operation_cache_key,
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
    let mutation_lock = match runtime.lock() {
        Ok(guard) => Arc::clone(&guard.mutation_lock),
        Err(_) => return,
    };
    let Ok(_mutation_guard) = mutation_lock.lock() else {
        return;
    };
    let batch = runtime.lock().ok().and_then(|mut guard| {
        guard.websocket_subscribers.remove(&subscriber_id);
        guard.mutation_batches.remove(session_id)
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
                .cloned()
                .map(|device_id| safe_publication_actor_id(&device_id))
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
    let device_id = guard.authenticated_sessions.get(session_id)?.clone();
    if !guard.approved_devices.contains(&device_id) || guard.payload.is_none() {
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
fn serve_publication_ai_command(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Option<Vec<u8>> {
    let settings = crate::services::ai_service::AiHttpSettings {
        ollama_url: publication.ai_preferences.ollama_url.clone(),
        api_key: publication.ai_preferences.api_key.clone(),
    };
    match command {
        "list_desktop_ai_models" => Some(
            match tauri::async_runtime::block_on(crate::services::ai_service::list_ollama_models(
                &settings,
            )) {
                Ok(result) => json_response("200 OK", serde_json::json!({ "result": result })),
                Err(_) => json_error("No se pudo consultar los modelos de IA publicados."),
            },
        ),
        "run_desktop_ai_tool_chat" => {
            let messages = payload.get("messages").cloned().unwrap_or(Value::Null);
            let tools = payload.get("tools").cloned().unwrap_or(Value::Null);
            let think = payload.get("think").cloned().unwrap_or(Value::Bool(false));
            let requested_model = payload
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let model = if publication.ai_preferences.selected_model.trim().is_empty() {
                requested_model
            } else {
                publication.ai_preferences.selected_model.as_str()
            };
            let timeout_seconds = payload
                .get("timeoutSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(600);
            if !(1..=600).contains(&timeout_seconds) {
                return Some(json_error("El tiempo de espera de IA no es válido."));
            }
            Some(
                match tauri::async_runtime::block_on(
                    crate::services::ai_service::run_ollama_tool_chat(
                        &settings,
                        model,
                        &messages,
                        &tools,
                        &think,
                        timeout_seconds,
                    ),
                ) {
                    Ok(result) => json_response("200 OK", serde_json::json!({ "result": result })),
                    Err(_) => json_error("No se pudo ejecutar la operación de IA publicada."),
                },
            )
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn serve_publication_ai_stream<S: Write>(
    stream: &mut S,
    body: &[u8],
    publication: &TaskManagerPublicationPayload,
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
    let model = if publication.ai_preferences.selected_model.trim().is_empty() {
        request.model.as_str()
    } else {
        publication.ai_preferences.selected_model.as_str()
    };
    let settings = crate::services::ai_service::AiHttpSettings {
        ollama_url: publication.ai_preferences.ollama_url.clone(),
        api_key: publication.ai_preferences.api_key.clone(),
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

    let mut client_disconnected = false;
    let result = tauri::async_runtime::block_on(
        crate::services::ai_service::stream_ollama_chat_with_cancellation(
            &settings,
            model,
            &request.messages,
            &request.think,
            Arc::clone(&cancellation),
            |delta| {
                let event = match delta {
                    crate::services::ai_service::AiChatStreamDelta::Thinking(delta) => {
                        serde_json::json!({ "type": "thinking", "delta": delta })
                    }
                    crate::services::ai_service::AiChatStreamDelta::Content(delta) => {
                        serde_json::json!({ "type": "delta", "delta": delta })
                    }
                };
                write_chunked_json_line(stream, &event).map_err(|_| {
                    client_disconnected = true;
                    "El cliente cerró el stream de IA publicado.".to_string()
                })
            },
        ),
    );
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
    let final_event = match result {
        Ok(answer) => serde_json::json!({ "type": "done", "answer": answer }),
        Err(_) => serde_json::json!({
            "type": "error",
            "message": "No se pudo completar el stream de IA publicado.",
        }),
    };
    let _ = write_chunked_json_line(stream, &final_event);
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
fn virtual_publication_result(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Option<Value> {
    let path = filesystem_paths(payload).into_iter().next()?;
    if is_virtual_publication_directory(&path, publication) {
        return match command {
            "path_exists" => Some(serde_json::json!({ "exists": true })),
            "is_directory_path" => Some(serde_json::json!({ "isDirectory": true })),
            _ => None,
        };
    }
    if !is_virtual_publication_file(&path, publication) {
        return None;
    }
    match command {
        "read_library_file" | "write_library_file"
            if is_publication_pomodoro_file(&path, publication) =>
        {
            None
        }
        "read_library_file" => {
            Some(serde_json::json!({ "ok": true, "content": "", "error": null }))
        }
        "write_library_file" => Some(serde_json::json!({ "ok": true, "error": null })),
        "path_exists" => Some(serde_json::json!({ "exists": true })),
        "is_directory_path" => Some(serde_json::json!({ "isDirectory": false })),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn is_virtual_publication_directory(
    path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    if selected_board_names(publication)
        .iter()
        .any(|name| name == "default")
    {
        return false;
    }
    task_roots(publication)
        .iter()
        .any(|root| path == format!("{root}/default") || path == format!("{root}/default/subtasks"))
}

#[cfg(target_os = "windows")]
fn is_virtual_publication_file(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    let Some(file_name) = std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
    else {
        return false;
    };
    let normalized_name = file_name.to_lowercase();
    task_roots(publication).iter().any(|root| {
        path.starts_with(&format!("{root}/"))
            && (normalized_name.starts_with("taskindex")
                || normalized_name.ends_with("taskindex.md"))
    })
}

#[cfg(target_os = "windows")]
fn authorize_command(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    const COMMANDS: &[&str] = &[
        "read_library_tree",
        "read_markdown_files",
        "read_library_file",
        "write_library_file",
        "append_task_comment",
        "path_exists",
        "is_directory_path",
        "create_library_entry",
        "library_entry_operation",
    ];
    if !COMMANDS.contains(&command) {
        return false;
    }
    let paths = filesystem_paths(payload);
    if paths.iter().any(|path| path.contains("..")) {
        return false;
    }
    if paths
        .iter()
        .any(|path| is_task_manager_shared_metadata_path(path, publication))
    {
        return false;
    }
    if paths
        .iter()
        .any(|path| !is_contained_in_publication_vault(path, publication))
    {
        return false;
    }
    if matches!(command, "read_markdown_files" | "read_library_tree") {
        return paths.iter().all(|path| is_tasks_root(path, publication));
    }
    paths.iter().all(|path| {
        is_tasks_root(path, publication)
            || is_selected_board_path(path, publication)
            || is_authorized_archived_path(path, publication)
            || (command == "create_library_entry" && is_publication_vault_root(path, publication))
    })
}

#[cfg(target_os = "windows")]
fn authorize_publication_command(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    if !authorize_command(command, payload, publication) {
        return false;
    }

    match command {
        "write_library_file" => filesystem_paths(payload).first().is_some_and(|path| {
            is_authorized_task_file(path, publication)
                || is_publication_pomodoro_file(path, publication)
        }),
        "append_task_comment" => filesystem_paths(payload)
            .first()
            .is_some_and(|path| is_authorized_task_file(path, publication)),
        "create_library_entry" => authorize_publication_entry_creation(payload, publication),
        "library_entry_operation" => authorize_publication_entry_operation(payload, publication),
        _ => true,
    }
}

#[cfg(target_os = "windows")]
fn authorize_publication_entry_creation(
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    let Some(kind) = payload.get("kind").and_then(Value::as_str) else {
        return false;
    };
    let Some(directory_path) = payload
        .get("directoryPath")
        .and_then(Value::as_str)
        .map(normalize_path)
    else {
        return false;
    };
    let Some(name) = payload.get("name").and_then(Value::as_str) else {
        return false;
    };
    let name = name.trim();
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }

    let candidate = normalize_path(&format!("{directory_path}/{name}"));
    match kind {
        "folder" => is_allowed_task_workspace_directory(&candidate, publication),
        "note" => {
            let normalized_name = if name.to_lowercase().ends_with(".md") {
                name.to_string()
            } else {
                format!("{name}.md")
            };
            let candidate = normalize_path(&format!("{directory_path}/{normalized_name}"));
            is_authorized_task_file_creation(&candidate, &directory_path, publication)
                || is_authorized_system_file_creation(&candidate, &directory_path, publication)
        }
        // Mermaid and arbitrary library entries are not part of the published Task Manager
        // write surface. Keeping this bridge limited also prevents using it as a file manager.
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn authorize_publication_entry_operation(
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    let Some(action) = payload.get("action").and_then(Value::as_str) else {
        return false;
    };

    match action {
        "delete" => payload
            .get("targetPath")
            .and_then(Value::as_str)
            .map(normalize_path)
            .is_some_and(|path| is_authorized_task_file(&path, publication)),
        "rename" => {
            let Some(target_path) = payload
                .get("targetPath")
                .and_then(Value::as_str)
                .map(normalize_path)
            else {
                return false;
            };
            let Some(new_name) = payload.get("newName").and_then(Value::as_str) else {
                return false;
            };
            let new_name = new_name.trim();
            !new_name.is_empty()
                && new_name.to_lowercase().ends_with(".md")
                && !new_name.contains('/')
                && !new_name.contains('\\')
                && !new_name.contains("..")
                && is_authorized_task_file(&target_path, publication)
                && !is_reserved_task_file(&normalize_path(&format!(
                    "{}/{}",
                    std::path::Path::new(&target_path)
                        .parent()
                        .and_then(std::path::Path::to_str)
                        .unwrap_or_default(),
                    new_name
                )))
        }
        "paste" => {
            let Some(source_path) = payload
                .get("sourcePath")
                .and_then(Value::as_str)
                .map(normalize_path)
            else {
                return false;
            };
            let Some(target_directory_path) = payload
                .get("targetDirectoryPath")
                .and_then(Value::as_str)
                .map(normalize_path)
            else {
                return false;
            };
            payload.get("mode").and_then(Value::as_str) == Some("move")
                && is_authorized_task_file(&source_path, publication)
                && is_allowed_task_destination_directory(&target_directory_path, publication)
        }
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn is_authorized_task_file(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    let normalized_path = normalize_path(path);
    normalized_path.ends_with(".md")
        && !is_reserved_task_file(&normalized_path)
        && (is_active_task_file_path(&normalized_path, publication)
            || is_authorized_archived_path(&normalized_path, publication))
}

#[cfg(target_os = "windows")]
fn is_active_task_file_path(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    selected_board_roots(publication).iter().any(|root| {
        let Some(relative_path) = path.strip_prefix(&format!("{root}/")) else {
            return false;
        };
        !relative_path.is_empty()
            && (relative_path.split('/').count() == 1 || relative_path.starts_with("subtasks/"))
    })
}

#[cfg(target_os = "windows")]
fn is_authorized_task_file_creation(
    candidate: &str,
    directory_path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    !is_reserved_task_file(candidate)
        && selected_board_roots(publication)
            .iter()
            .any(|root| directory_path == root || directory_path == format!("{root}/subtasks"))
        && candidate.ends_with(".md")
}

#[cfg(target_os = "windows")]
fn is_authorized_system_file_creation(
    candidate: &str,
    directory_path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    let Some(file_name) = std::path::Path::new(candidate)
        .file_name()
        .and_then(|name| name.to_str())
    else {
        return false;
    };
    let normalized_name = file_name.to_lowercase();
    let is_task_root = task_roots(publication)
        .iter()
        .any(|root| directory_path == root);
    let is_archive_root = task_roots(publication).iter().any(|root| {
        [
            format!("{root}/finished"),
            format!("{root}/cancelled"),
            format!("{root}/completadas"),
        ]
        .iter()
        .any(|archive_root| directory_path == archive_root)
    });
    let is_selected_board = selected_board_roots(publication)
        .iter()
        .any(|root| directory_path == root);

    normalized_name == "pomodoro.md" && is_task_root
        || (normalized_name.starts_with("taskindex") || normalized_name.ends_with("taskindex.md"))
            && (is_task_root || is_archive_root || is_selected_board)
}

#[cfg(target_os = "windows")]
fn is_allowed_task_workspace_directory(
    candidate: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    task_roots(publication).iter().any(|root| {
        candidate == *root
            || candidate == format!("{root}/finished")
            || candidate == format!("{root}/cancelled")
            || candidate == format!("{root}/completadas")
            || candidate == format!("{root}/finished/subtasks")
            || candidate == format!("{root}/cancelled/subtasks")
            || candidate == format!("{root}/completadas/subtasks")
    }) || selected_board_roots(publication)
        .iter()
        .any(|root| candidate == root || candidate == format!("{root}/subtasks"))
}

#[cfg(target_os = "windows")]
fn is_allowed_task_destination_directory(
    path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    is_allowed_task_workspace_directory(path, publication)
        || task_roots(publication).iter().any(|root| path == *root)
}

#[cfg(target_os = "windows")]
fn is_reserved_task_file(path: &str) -> bool {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            let normalized_name = name.to_lowercase();
            normalized_name == "pomodoro.md"
                || normalized_name == TASK_MANAGER_SHARED_METADATA_FILE
                || normalized_name.starts_with("taskindex")
                || normalized_name.ends_with("taskindex.md")
        })
}

#[cfg(target_os = "windows")]
fn is_task_manager_shared_metadata_path(
    path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    task_roots(publication)
        .iter()
        .any(|root| path == format!("{root}/{TASK_MANAGER_SHARED_METADATA_FILE}"))
}

#[cfg(target_os = "windows")]
fn is_publication_pomodoro_file(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    task_roots(publication)
        .iter()
        .any(|root| path == format!("{root}/pomodoro.md"))
}

#[cfg(target_os = "windows")]
fn is_publication_vault_root(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    normalize_path(path) == normalize_path(&publication.vault_path)
}

#[cfg(target_os = "windows")]
fn is_contained_in_publication_vault(
    path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    let normalized_vault = normalize_path(&publication.vault_path);
    let normalized_candidate = normalize_path(path);
    let lexically_contained =
        path_is_within_case_insensitive(&normalized_candidate, &normalized_vault);
    let Ok(vault) = std::fs::canonicalize(&publication.vault_path) else {
        return lexically_contained;
    };
    let candidate = std::path::Path::new(path);
    let canonical_candidate = if candidate.exists() {
        std::fs::canonicalize(candidate).ok()
    } else {
        candidate
            .parent()
            .and_then(|parent| std::fs::canonicalize(parent).ok())
            .and_then(|parent| candidate.file_name().map(|name| parent.join(name)))
    };
    let Some(canonical_candidate) = canonical_candidate else {
        return lexically_contained;
    };
    path_is_within_case_insensitive(
        &canonical_candidate.to_string_lossy(),
        &vault.to_string_lossy(),
    )
}

#[cfg(target_os = "windows")]
fn validate_publication_filesystem_paths(
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Result<(), String> {
    let vault = fs::canonicalize(&publication.vault_path)
        .map_err(|_| "El vault publicado ya no está disponible.".to_string())?;
    let paths = filesystem_paths(payload);
    if paths.is_empty() {
        return Err("La operación publicada no contiene una ruta válida.".to_string());
    }

    for path in paths {
        if !is_contained_in_publication_vault(&path, publication) {
            return Err("La ruta está fuera del vault publicado.".to_string());
        }
        let canonical_path = canonicalize_publication_candidate(std::path::Path::new(&path))
            .ok_or_else(|| "La ruta publicada no se puede resolver de forma segura.".to_string())?;
        if !path_is_within_case_insensitive(
            &canonical_path.to_string_lossy(),
            &vault.to_string_lossy(),
        ) {
            return Err("La ruta está fuera del vault publicado.".to_string());
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn canonicalize_publication_candidate(path: &std::path::Path) -> Option<std::path::PathBuf> {
    if fs::symlink_metadata(path)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_symlink())
    {
        return None;
    }
    if path.exists() {
        return fs::canonicalize(path).ok();
    }

    let mut missing_components = Vec::new();
    let mut ancestor = path.to_path_buf();
    while !ancestor.exists() {
        missing_components.push(ancestor.file_name()?.to_os_string());
        if !ancestor.pop() {
            return None;
        }
    }
    if fs::symlink_metadata(&ancestor)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_symlink())
    {
        return None;
    }

    let mut canonical_path = fs::canonicalize(ancestor).ok()?;
    while let Some(component) = missing_components.pop() {
        canonical_path.push(component);
    }
    Some(canonical_path)
}

#[cfg(target_os = "windows")]
fn path_is_within_case_insensitive(candidate: &str, root: &str) -> bool {
    let normalized_candidate = normalize_path(candidate);
    let normalized_root = normalize_path(root);
    if normalized_candidate
        .split('/')
        .any(|segment| segment == "..")
    {
        return false;
    }
    normalized_candidate == normalized_root
        || normalized_candidate.starts_with(&format!("{normalized_root}/"))
}

#[cfg(target_os = "windows")]
fn filesystem_paths(payload: &Value) -> Vec<String> {
    const KEYS: &[&str] = &[
        "directoryPath",
        "filePath",
        "path",
        "targetPath",
        "sourcePath",
        "targetDirectoryPath",
    ];
    let Some(object) = payload.as_object() else {
        return Vec::new();
    };
    KEYS.iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .map(normalize_path)
        .collect()
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
    path.to_string()
}

#[cfg(target_os = "windows")]
fn publicize_publication_paths(
    mut value: Value,
    publication: &TaskManagerPublicationPayload,
) -> Value {
    match &mut value {
        Value::Array(items) => items.iter_mut().for_each(|item| {
            let replacement = publicize_publication_paths(item.take(), publication);
            *item = replacement;
        }),
        Value::Object(object) => {
            for (key, item) in object.iter_mut() {
                if PUBLICATION_PATH_KEYS.contains(&key.as_str()) {
                    if let Some(path) = item.as_str() {
                        *item = Value::String(publicize_publication_path(path, publication));
                    }
                }
                let replacement = publicize_publication_paths(item.take(), publication);
                *item = replacement;
            }
        }
        _ => {}
    }
    value
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
fn sanitize_host_changed_paths(
    paths: &[String],
    publication: &TaskManagerPublicationPayload,
) -> Vec<String> {
    if paths.len() > PUBLICATION_CHANGED_PATH_LIMIT {
        return Vec::new();
    }
    let mut sanitized = Vec::new();
    for path in paths {
        if sanitized.len() >= PUBLICATION_CHANGED_PATH_LIMIT {
            break;
        }
        let Some(internal_path) = internalize_host_changed_path(path, publication) else {
            continue;
        };
        let public_path = publicize_publication_path(&internal_path, publication);
        if public_path.len() > PUBLICATION_CHANGED_PATH_MAX_BYTES
            || (!public_path.eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS)
                && !public_path
                    .get(..PUBLISHED_VAULT_ALIAS.len() + 1)
                    .is_some_and(|prefix| {
                        prefix[..PUBLISHED_VAULT_ALIAS.len()]
                            .eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS)
                            && prefix.ends_with('/')
                    }))
            || sanitized
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(&public_path))
        {
            continue;
        }
        sanitized.push(public_path);
    }
    sanitized
}

#[cfg(target_os = "windows")]
fn internalize_host_changed_path(
    path: &str,
    publication: &TaskManagerPublicationPayload,
) -> Option<String> {
    let path = path.trim();
    if path.is_empty()
        || path.len() > PUBLICATION_CHANGED_PATH_MAX_BYTES
        || path.chars().any(char::is_control)
        || path.contains("..")
    {
        return None;
    }

    let normalized = path.replace('\\', "/").trim_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }
    let vault = publication.vault_path.replace('\\', "/");
    let vault = vault.trim_end_matches('/');
    let candidate = if normalized.eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS)
        || normalized
            .get(..PUBLISHED_VAULT_ALIAS.len() + 1)
            .is_some_and(|prefix| {
                prefix[..PUBLISHED_VAULT_ALIAS.len()].eq_ignore_ascii_case(PUBLISHED_VAULT_ALIAS)
                    && prefix.ends_with('/')
            }) {
        internalize_publication_path(&normalized, publication)
    } else if std::path::Path::new(&normalized).is_absolute() {
        normalized.clone()
    } else {
        let root_folder = ["task-mannager", "task-manager"].iter().find(|root| {
            normalized.eq_ignore_ascii_case(root)
                || normalized.get(..root.len() + 1).is_some_and(|prefix| {
                    prefix[..root.len()].eq_ignore_ascii_case(root) && prefix.ends_with('/')
                })
        })?;
        let vault_name = std::path::Path::new(vault)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if vault_name.eq_ignore_ascii_case(root_folder) {
            let suffix = normalized
                .get(root_folder.len()..)
                .unwrap_or_default()
                .trim_start_matches('/');
            if suffix.is_empty() {
                vault.to_string()
            } else {
                format!("{vault}/{suffix}")
            }
        } else {
            format!("{vault}/{normalized}")
        }
    };

    if !is_contained_in_publication_vault(&candidate, publication) {
        return None;
    }

    let normalized_candidate = normalize_path(&candidate);
    let is_visible = is_selected_board_path(&normalized_candidate, publication)
        || is_publication_pomodoro_file(&normalized_candidate, publication)
        || (is_virtual_publication_file(&normalized_candidate, publication)
            && (is_tasks_root(&normalized_candidate, publication)
                || is_selected_board_path(&normalized_candidate, publication)))
        || is_authorized_archived_path(&normalized_candidate, publication);
    is_visible.then_some(candidate)
}

#[cfg(target_os = "windows")]
fn filter_publication_result(
    command: &str,
    result: Value,
    publication: &TaskManagerPublicationPayload,
) -> Value {
    if command == "read_library_tree" {
        return match result {
            Value::Array(nodes) => Value::Array(
                nodes
                    .into_iter()
                    .filter_map(|node| filter_publication_tree_node(node, publication))
                    .collect(),
            ),
            other => other,
        };
    }
    if command != "read_markdown_files" {
        return result;
    }
    match result {
        Value::Array(documents) => Value::Array(
            documents
                .into_iter()
                .filter(|document| {
                    let path = document
                        .get("path")
                        .and_then(Value::as_str)
                        .map(normalize_path)
                        .unwrap_or_default();
                    is_selected_board_path(&path, publication)
                        || document
                            .get("content")
                            .and_then(Value::as_str)
                            .is_some_and(|content| content_has_selected_board(content, publication))
                })
                .collect(),
        ),
        other => other,
    }
}

#[cfg(target_os = "windows")]
fn filter_publication_tree_node(
    mut node: Value,
    publication: &TaskManagerPublicationPayload,
) -> Option<Value> {
    let path = node
        .get("path")
        .and_then(Value::as_str)
        .map(normalize_path)?;
    let is_root = is_tasks_root(&path, publication);
    let is_selected = is_selected_board_path(&path, publication);
    if !is_root && !is_selected {
        return None;
    }
    if let Some(children) = node.get_mut("children").and_then(Value::as_array_mut) {
        let filtered = std::mem::take(children)
            .into_iter()
            .filter_map(|child| filter_publication_tree_node(child, publication))
            .collect();
        *children = filtered;
    }
    Some(node)
}

#[cfg(target_os = "windows")]
fn is_tasks_root(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    task_roots(publication).iter().any(|root| path == root)
}

#[cfg(target_os = "windows")]
fn is_selected_board_path(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    selected_board_roots(publication)
        .iter()
        .any(|root| path == root || path.starts_with(&format!("{root}/")))
}

#[cfg(target_os = "windows")]
fn is_authorized_archived_path(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    let is_archive = task_roots(publication).iter().any(|root| {
        [
            format!("{root}/finished"),
            format!("{root}/cancelled"),
            format!("{root}/completadas"),
        ]
        .iter()
        .any(|archive_root| path == archive_root || path.starts_with(&format!("{archive_root}/")))
    });
    if !is_archive {
        return false;
    }
    if std::path::Path::new(path).is_dir() {
        return true;
    }
    std::fs::read_to_string(path)
        .ok()
        .is_some_and(|content| content_has_selected_board(&content, publication))
}

#[cfg(target_os = "windows")]
fn content_has_selected_board(content: &str, publication: &TaskManagerPublicationPayload) -> bool {
    let selected = selected_board_names(publication);
    frontmatter_board_name(content).is_some_and(|board| selected.contains(&board))
}

#[cfg(target_os = "windows")]
fn frontmatter_board_name(content: &str) -> Option<String> {
    let mut lines = content.trim_start_matches('\u{feff}').lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            return None;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("tablero") {
            let board = value.trim().trim_matches(['\'', '"']).trim().to_lowercase();
            return (!board.is_empty()).then_some(board);
        }
    }
    None
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

#[cfg(target_os = "windows")]
fn selected_board_roots(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    task_roots(publication)
        .into_iter()
        .flat_map(|root| {
            selected_board_names(publication)
                .into_iter()
                .map(move |board| format!("{root}/{board}"))
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn serve_publication_index(assets: &tauri::AssetResolver<tauri::Wry>) -> Vec<u8> {
    let Some(asset) = assets.get("public-task-manager.html".to_string()) else {
        return text_response(
            "503 Service Unavailable",
            "Los recursos de Task Manager no están disponibles.",
        );
    };
    let html = String::from_utf8_lossy(asset.bytes()).replace(
        "/assets/",
        &format!("{TASK_MANAGER_PUBLICATION_PATH}/assets/"),
    );
    response("200 OK", "text/html; charset=utf-8", html.as_bytes())
}

#[cfg(target_os = "windows")]
fn serve_asset(assets: &tauri::AssetResolver<tauri::Wry>, relative_path: &str) -> Vec<u8> {
    if relative_path.contains("..") {
        return text_response("404 Not Found", "No existe.");
    }
    match assets.get(relative_path.to_string()) {
        Some(asset) => response("200 OK", asset.mime_type(), asset.bytes()),
        None => text_response("404 Not Found", "No existe."),
    }
}

#[cfg(target_os = "windows")]
fn is_usable_publication_ipv4(address: std::net::IpAddr) -> bool {
    let std::net::IpAddr::V4(address) = address else {
        return false;
    };
    !address.is_loopback() && !address.is_unspecified() && !address.is_link_local()
}

#[cfg(target_os = "windows")]
fn local_network_ip() -> String {
    let routed_address = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|address| address.ip())
        .ok()
        .filter(|address| is_usable_publication_ipv4(*address));
    if let Some(address) = routed_address {
        return address.to_string();
    }

    if let Ok(adapters) = ipconfig::get_adapters() {
        if let Some(address) = adapters
            .iter()
            .flat_map(|adapter| adapter.ip_addresses())
            .copied()
            .find(|address| is_usable_publication_ipv4(*address))
        {
            return address.to_string();
        }
    }

    "127.0.0.1".to_string()
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

#[cfg(target_os = "windows")]
fn request_line_parts(request: &[u8]) -> Option<(&str, String)> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let line = std::str::from_utf8(&request[..line_end]).ok()?;
    let mut parts = line.split_whitespace();
    Some((parts.next()?, parts.next()?.split('?').next()?.to_string()))
}

#[cfg(target_os = "windows")]
fn request_host(request: &[u8]) -> Option<String> {
    let header_end = find_header_end(request)?;
    let headers = std::str::from_utf8(&request[..header_end]).ok()?;
    let host = headers.lines().skip(1).find_map(|line| {
        line.split_once(':')
            .and_then(|(name, value)| name.eq_ignore_ascii_case("host").then(|| value.trim()))
    })?;
    (!host.is_empty()
        && host.len() <= 255
        && host.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | ':' | '[' | ']' | '-')
        }))
    .then(|| host.to_string())
}

#[cfg(target_os = "windows")]
fn is_safe_publication_redirect_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let host_without_port = if host.starts_with('[') {
        let Some(closing_bracket) = host.find(']') else {
            return false;
        };
        let remainder = &host[closing_bracket + 1..];
        if !remainder.is_empty() {
            let Some(port) = remainder.strip_prefix(':') else {
                return false;
            };
            if port.parse::<u16>().is_err() {
                return false;
            }
        }
        &host[1..closing_bracket]
    } else if host.matches(':').count() == 1 {
        let Some((host_without_port, port)) = host.split_once(':') else {
            return false;
        };
        if port.parse::<u16>().is_err() {
            return false;
        }
        host_without_port
    } else {
        if host.contains(':') {
            return false;
        }
        host
    };

    host_without_port.eq_ignore_ascii_case("localhost")
        || host_without_port.parse::<std::net::IpAddr>().is_ok()
}

#[cfg(target_os = "windows")]
fn request_header_value(request: &[u8], header_name: &str) -> Option<String> {
    let header_end = find_header_end(request)?;
    std::str::from_utf8(&request[..header_end])
        .ok()?
        .lines()
        .skip(1)
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case(header_name)
                    .then(|| value.trim().to_string())
            })
        })
}

#[cfg(target_os = "windows")]
fn find_header_end(request: &[u8]) -> Option<usize> {
    request.windows(4).position(|window| window == b"\r\n\r\n")
}

#[cfg(target_os = "windows")]
fn parse_content_length(headers: &[u8]) -> usize {
    String::from_utf8_lossy(headers)
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
        })
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn http_body(request: &[u8]) -> &[u8] {
    find_header_end(request)
        .map(|index| &request[index + 4..])
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn json_response(status: &str, value: Value) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    response(status, "application/json; charset=utf-8", &body)
}

#[cfg(target_os = "windows")]
fn json_response_with_headers(status: &str, value: Value, headers: &[&str]) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    response_with_headers(status, "application/json; charset=utf-8", &body, headers)
}

#[cfg(target_os = "windows")]
fn json_error(message: &str) -> Vec<u8> {
    json_response("400 Bad Request", serde_json::json!({ "error": message }))
}

#[cfg(target_os = "windows")]
fn text_response(status: &str, message: &str) -> Vec<u8> {
    response(status, "text/plain; charset=utf-8", message.as_bytes())
}

#[cfg(target_os = "windows")]
fn response(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    response_with_headers(status, content_type, body, &[])
}

#[cfg(target_os = "windows")]
fn response_with_headers(
    status: &str,
    content_type: &str,
    body: &[u8],
    extra_headers: &[&str],
) -> Vec<u8> {
    let extra_headers = if extra_headers.is_empty() {
        String::new()
    } else {
        format!("{}\r\n", extra_headers.join("\r\n"))
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n{extra_headers}Connection: close\r\n\r\n",
        body.len()
    );
    let mut output = header.into_bytes();
    output.extend_from_slice(body);
    output
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn idle_websocket_receives_consecutive_host_and_remote_batch_changes() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            publication_epoch: "test-epoch".to_string(),
            approved_devices: HashSet::from(["device".to_string()]),
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
                        "command": "begin_task_manager_publication_batch", "args": {}
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
                        "command": "end_task_manager_publication_batch", "args": {}
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
            vault_path: "C:/Vault".to_string(),
            theme: "dark".to_string(),
            password_hash: hash_task_manager_publication_password("contraseña-segura".to_string())
                .expect("password hash"),
            approved_devices: Vec::new(),
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
    fn filters_documents_outside_published_boards() {
        let result = filter_publication_result(
            "read_markdown_files",
            serde_json::json!([
                { "path": "C:/Vault/task-mannager/equipo/visible.md", "content": "---\ntablero: equipo\n---" },
                { "path": "C:/Vault/task-mannager/privado/oculta.md", "content": "---\ntablero: privado\n---" },
                { "path": "C:/Vault/task-mannager/finished/visible.md", "content": "---\ntablero: equipo\n---" },
                { "path": "C:/Vault/task-mannager/finished/oculta.md", "content": "---\ntablero: privado\n---" },
                { "path": "C:/Vault/task-mannager/cancelled/sin-tablero.md", "content": "---\nestado: Cancelada\n---\n\ntablero: equipo" }
            ]),
            &publication(),
        );

        let documents = result.as_array().expect("filtered document array");
        assert_eq!(documents.len(), 2);
        assert!(documents.iter().all(|document| {
            document["path"]
                .as_str()
                .is_some_and(|path| !path.contains("privado"))
        }));
    }

    #[test]
    fn filters_private_boards_from_published_tree_results() {
        let result = filter_publication_result(
            "read_library_tree",
            serde_json::json!([
                {
                    "path": "C:/Vault/task-mannager",
                    "name": "task-mannager",
                    "type": "directory",
                    "children": [
                        {
                            "path": "C:/Vault/task-mannager/equipo",
                            "name": "equipo",
                            "type": "directory",
                            "children": []
                        },
                        {
                            "path": "C:/Vault/task-mannager/privado",
                            "name": "privado",
                            "type": "directory",
                            "children": []
                        }
                    ]
                }
            ]),
            &publication(),
        );

        let serialized = result.to_string();
        assert!(serialized.contains("equipo"));
        assert!(!serialized.contains("privado"));
    }

    #[test]
    fn virtualizes_shared_indexes_needed_during_initialization() {
        let result = virtual_publication_result(
            "read_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/taskIndex.md" }),
            &publication(),
        );

        assert_eq!(
            result,
            Some(serde_json::json!({ "ok": true, "content": "", "error": null }))
        );
    }

    #[test]
    fn keeps_pomodoro_log_as_a_real_shared_file() {
        let publication = publication();
        let payload = serde_json::json!({
            "filePath": "C:/Vault/task-mannager/pomodoro.md",
            "content": "registro",
        });

        assert_eq!(
            virtual_publication_result("read_library_file", &payload, &publication),
            None
        );
        assert!(authorize_publication_command(
            "write_library_file",
            &payload,
            &publication,
        ));
    }

    #[test]
    fn publication_paths_use_an_opaque_alias_in_browser_results() {
        let publication = publication();
        assert_eq!(
            internalize_publication_path("published-vault/task-mannager/equipo.md", &publication),
            "C:/Vault/task-mannager/equipo.md"
        );
        assert_eq!(
            publicize_publication_path("C:/Vault/task-mannager/equipo.md", &publication),
            "published-vault/task-mannager/equipo.md"
        );

        let result = publicize_publication_paths(
            serde_json::json!({
                "path": "C:/Vault/task-mannager/equipo.md",
                "content": "No se debe tocar C:/Vault dentro del contenido."
            }),
            &publication,
        );
        assert_eq!(result["path"], "published-vault/task-mannager/equipo.md");
        assert_eq!(
            result["content"],
            "No se debe tocar C:/Vault dentro del contenido."
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
        let bootstrap = build_publication_bootstrap(&publication, &runtime);
        let serialized = serde_json::to_string(&bootstrap).expect("bootstrap json");

        assert_eq!(bootstrap["vaultPath"], PUBLISHED_VAULT_ALIAS);
        assert!(!serialized.contains("C:/Vault"));
        assert!(!serialized.contains("C:/private"));
        assert!(!serialized.contains("secret-api-key"));
        assert_eq!(bootstrap["settings"]["activeVaultPath"], Value::Null);
        assert_eq!(
            bootstrap["settings"]["pomodoro"]["selectedTaskPath"],
            Value::Null
        );
        assert_eq!(bootstrap["settings"]["pomodoro"]["runState"], "idle");
        assert_eq!(bootstrap["aiPreferences"]["apiKey"], "");
        assert_eq!(
            bootstrap["aiPreferences"]["ollamaUrl"],
            "https://127.0.0.1:1"
        );
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
    fn publication_ip_selection_rejects_loopback_and_link_local_addresses() {
        assert!(!is_usable_publication_ipv4(
            "127.0.0.1".parse().expect("loopback address")
        ));
        assert!(!is_usable_publication_ipv4(
            "169.254.10.20".parse().expect("link-local address")
        ));
        assert!(is_usable_publication_ipv4(
            "192.168.1.42".parse().expect("LAN address")
        ));
        assert!(!is_usable_publication_ipv4(
            "::1".parse().expect("IPv6 loopback address")
        ));
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
    fn persists_shared_publication_metadata_under_the_task_manager_root() {
        let directory = std::env::temp_dir().join(format!(
            "notia-task-manager-shared-metadata-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(directory.join("task-mannager")).expect("metadata test directory");
        let mut publication = publication();
        publication.vault_path = directory.to_string_lossy().into_owned();
        let settings = serde_json::json!({
            "activeVaultPath": null,
            "boards": [{ "name": "equipo", "color": "#abcdef", "activityHoursPerDay": 8 }],
            "groups": [{ "name": "Nuevo", "color": "#123456", "board": "equipo" }],
        });

        persist_publication_shared_metadata(&publication, &settings)
            .expect("persist shared metadata");

        let metadata_path = directory
            .join("task-mannager")
            .join(TASK_MANAGER_SHARED_METADATA_FILE);
        let metadata: Value =
            serde_json::from_slice(&fs::read(metadata_path).expect("metadata file"))
                .expect("metadata json");
        assert_eq!(metadata["version"], 1);
        assert_eq!(metadata["boards"][0]["name"], "equipo");
        assert_eq!(metadata["groups"][0]["name"], "Nuevo");
        fs::remove_dir_all(directory).expect("remove metadata test directory");
    }

    #[test]
    fn sanitizes_shared_publication_settings() {
        let sanitized = sanitize_publication_settings(
            serde_json::json!({
                "boards": [
                    { "name": " EQUIPO ", "color": "red; background:url(https://attacker)", "activityHoursPerDay": 99 },
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
        assert_eq!(sanitized["groups"].as_array().map(Vec::len), Some(1));
        assert_eq!(sanitized["groups"][0]["name"], "Visible");
    }

    #[test]
    fn authorizes_selected_task_and_rejects_private_task() {
        let published = authorize_command(
            "write_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/equipo/ticket.md" }),
            &publication(),
        );
        let private = authorize_command(
            "write_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/privado/ticket.md" }),
            &publication(),
        );

        assert!(published);
        assert!(!private);
    }

    #[test]
    fn restricts_published_mutations_to_task_manager_entities() {
        let publication = publication();
        let board_root = "C:/Vault/task-mannager/equipo";

        assert!(!authorize_publication_command(
            "library_entry_operation",
            &serde_json::json!({
                "action": "delete",
                "targetPath": board_root,
            }),
            &publication,
        ));
        assert!(!authorize_publication_command(
            "create_library_entry",
            &serde_json::json!({
                "directoryPath": board_root,
                "name": "diagrama",
                "kind": "mermaid",
            }),
            &publication,
        ));
        assert!(!authorize_publication_command(
            "create_library_entry",
            &serde_json::json!({
                "directoryPath": board_root,
                "name": "otra-carpeta",
                "kind": "folder",
            }),
            &publication,
        ));
        assert!(!authorize_publication_command(
            "write_library_file",
            &serde_json::json!({
                "filePath": "C:/Vault/task-mannager/equipo/taskIndex.md",
                "content": "no",
            }),
            &publication,
        ));
        assert!(!authorize_publication_command(
            "append_task_comment",
            &serde_json::json!({
                "filePath": "C:/Vault/task-mannager/pomodoro.md",
            }),
            &publication,
        ));
        assert!(authorize_publication_command(
            "create_library_entry",
            &serde_json::json!({
                "directoryPath": board_root,
                "name": "nueva tarea",
                "kind": "note",
            }),
            &publication,
        ));
        assert!(authorize_publication_command(
            "write_library_file",
            &serde_json::json!({
                "filePath": "C:/Vault/task-mannager/equipo/ticket.md",
                "content": "contenido",
            }),
            &publication,
        ));
        assert!(authorize_publication_command(
            "library_entry_operation",
            &serde_json::json!({
                "action": "paste",
                "sourcePath": "C:/Vault/task-mannager/equipo/ticket.md",
                "targetDirectoryPath": board_root,
                "mode": "move",
            }),
            &publication,
        ));
    }

    #[test]
    fn applies_route_authorization_to_every_published_filesystem_command() {
        let publication = publication();
        let cases = [
            (
                "read_library_tree",
                serde_json::json!({ "directoryPath": "C:/Vault/task-mannager" }),
            ),
            (
                "read_markdown_files",
                serde_json::json!({ "directoryPath": "C:/Vault/task-mannager" }),
            ),
            (
                "read_library_file",
                serde_json::json!({ "filePath": "C:/Vault/task-mannager/equipo/ticket.md" }),
            ),
            (
                "write_library_file",
                serde_json::json!({ "filePath": "C:/Vault/task-mannager/equipo/ticket.md" }),
            ),
            (
                "append_task_comment",
                serde_json::json!({ "filePath": "C:/Vault/task-mannager/equipo/ticket.md" }),
            ),
            (
                "path_exists",
                serde_json::json!({ "path": "C:/Vault/task-mannager/equipo" }),
            ),
            (
                "is_directory_path",
                serde_json::json!({ "path": "C:/Vault/task-mannager/equipo" }),
            ),
            (
                "create_library_entry",
                serde_json::json!({ "directoryPath": "C:/Vault/task-mannager/equipo" }),
            ),
            (
                "library_entry_operation",
                serde_json::json!({ "targetPath": "C:/Vault/task-mannager/equipo/ticket.md" }),
            ),
        ];

        for (command, payload) in cases {
            assert!(
                authorize_command(command, &payload, &publication),
                "{command}"
            );
        }
        assert!(!authorize_command(
            "write_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/privado/ticket.md" }),
            &publication,
        ));
        assert!(!authorize_command(
            "read_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/otro/privado.md" }),
            &publication,
        ));
    }

    #[test]
    fn path_containment_is_case_insensitive_without_accepting_prefix_collisions() {
        assert!(path_is_within_case_insensitive(
            "c:/vault/task-mannager/equipo/ticket.md",
            "C:/Vault",
        ));
        assert!(path_is_within_case_insensitive("C:/Vault", "c:/vault"));
        assert!(!path_is_within_case_insensitive(
            "C:/VaultX/task-mannager/equipo/ticket.md",
            "C:/Vault",
        ));
        assert!(!path_is_within_case_insensitive(
            "C:/Vault/../outside.md",
            "C:/Vault",
        ));
    }

    #[test]
    fn hashes_and_verifies_publication_passwords() {
        let password = "clave-segura-123";
        let hash = hash_task_manager_publication_password(password.to_string())
            .expect("PBKDF2 password hash");

        assert_ne!(hash, password);
        assert!(hash.starts_with("$notia-pbkdf2-sha256$"));
        assert!(password_matches_hash(password.as_bytes(), &hash));
        assert!(!password_matches_hash(b"incorrecta", &hash));
    }

    #[test]
    fn pbkdf2_matches_the_sha256_reference_vector() {
        assert_eq!(
            encode_hex(&pbkdf2_hmac_sha256(b"password", b"salt", 1)),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
        assert_eq!(
            encode_hex(&pbkdf2_hmac_sha256(b"password", b"salt", 2)),
            "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
        );
    }

    #[test]
    fn rejects_short_publication_passwords() {
        assert!(hash_task_manager_publication_password("corta".to_string()).is_err());
    }

    #[test]
    fn creates_a_tls_certificate_accepted_by_rustls() {
        let directory = std::env::temp_dir().join(format!(
            "notia-task-manager-publication-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).expect("certificate test directory");
        let certificate_path = directory.join("certificate.der");
        let private_key_path = directory.join("private-key.der");
        let certificate_version_path = directory.join("version");
        let (certificate, private_key) = create_publication_certificate(
            &certificate_path,
            &private_key_path,
            &certificate_version_path,
        )
        .expect("self-signed certificate");

        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(certificate)],
                PrivateKeyDer::Pkcs8(private_key.into()),
            );

        assert!(config.is_ok());
        assert_eq!(
            fs::read_to_string(&certificate_version_path)
                .expect("certificate version")
                .trim(),
            PUBLICATION_CERTIFICATE_VERSION
        );
        fs::remove_dir_all(&directory).expect("remove certificate test directory");
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
    fn login_creates_an_http_only_session_only_for_the_correct_password() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            approved_devices: HashSet::from(["device-identifier-1234".to_string()]),
            ..PublicationRuntime::default()
        }));

        let rejected = serve_login(
            br#"{"password":"incorrecta"}"#,
            Some("device-identifier-1234".to_string()),
            &publication.password_hash,
            &runtime,
            TASK_MANAGER_PUBLICATION_PATH,
        );
        assert!(String::from_utf8_lossy(&rejected).starts_with("HTTP/1.1 400"));
        assert!(runtime
            .lock()
            .expect("runtime")
            .authenticated_sessions
            .is_empty());

        let accepted = serve_login(
            r#"{"password":"contraseña-segura"}"#.as_bytes(),
            Some("device-identifier-1234".to_string()),
            &publication.password_hash,
            &runtime,
            TASK_MANAGER_PUBLICATION_PATH,
        );
        let response = String::from_utf8_lossy(&accepted);
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.contains("Secure; HttpOnly; SameSite=Strict; Path=/task-manager"));
        assert_eq!(
            runtime
                .lock()
                .expect("runtime")
                .authenticated_sessions
                .len(),
            1
        );
    }

    #[test]
    fn login_capacity_rejects_the_next_session_without_clearing_existing_sessions() {
        let password_hash = hash_task_manager_publication_password("password-segura".to_string())
            .expect("password hash");
        let mut publication = publication();
        publication.password_hash = password_hash.clone();
        publication.max_clients = 2;
        let max_clients = publication.max_clients;
        let mut authenticated_sessions = HashMap::new();
        let mut approved_devices = HashSet::new();
        for index in 0..max_clients {
            let device_id = format!("device-{index}");
            approved_devices.insert(device_id.clone());
            authenticated_sessions.insert(format!("session-{index}"), device_id);
        }
        approved_devices.insert("device-new".to_string());
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication),
            approved_devices,
            authenticated_sessions,
            ..PublicationRuntime::default()
        }));

        let response = serve_login(
            br#"{"password":"password-segura"}"#,
            Some("device-new".to_string()),
            &password_hash,
            &runtime,
            TASK_MANAGER_PUBLICATION_PATH,
        );

        assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 429"));
        assert_eq!(
            runtime
                .lock()
                .expect("runtime")
                .authenticated_sessions
                .len(),
            max_clients
        );
    }

    #[test]
    fn http_invoke_revalidation_requires_the_current_session_and_publication() {
        let mut publication = publication();
        publication.approved_devices = vec![PublishedDevice {
            id: "device-1".to_string(),
            name: "Cliente 1".to_string(),
        }];
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            approved_devices: HashSet::from(["device-1".to_string()]),
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
            .approved_devices
            .clear();
        assert!(current_authenticated_publication(&runtime, "session-1").is_none());

        runtime
            .lock()
            .expect("revalidation runtime")
            .approved_devices
            .insert("device-1".to_string());
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
            approved_devices: HashSet::from(["device-one".to_string()]),
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
    fn http_ai_stream_registration_is_bound_to_the_authenticated_device() {
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication()),
            approved_devices: HashSet::from(["device-approved".to_string()]),
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
        assert!(register_publication_ai_stream(&runtime, "session-revoked").is_none());
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
            approved_devices: HashSet::from(["device-one".to_string(), "device-two".to_string()]),
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
            "command": "write_library_file",
            "args": {
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/ticket.md",
                    "content": "contenido"
                }
            }
        }))
        .expect("mutate fixture");
        assert_eq!(mutation.message_type, "mutate");
        assert_eq!(
            PublicationMutationCommand::parse(&mutation.command),
            Some(PublicationMutationCommand::WriteLibraryFile)
        );
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::WriteLibraryFile,
            &mutation.args,
        )
        .is_ok());

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
    fn publication_latency_p95_uses_bounded_histogram_buckets() {
        assert_eq!(calculate_publication_latency_p95(&[0; 6], 0), None);
        assert_eq!(
            calculate_publication_latency_p95(&[95, 0, 0, 0, 0, 5], 100),
            Some(50)
        );
        assert_eq!(
            calculate_publication_latency_p95(&[94, 0, 0, 0, 0, 6], 100),
            Some(5_001)
        );
    }

    #[test]
    fn appends_a_task_comment_inside_the_publication_scope() {
        let directory = std::env::temp_dir().join(format!(
            "notia-task-manager-comment-test-{}",
            uuid::Uuid::new_v4()
        ));
        let task_directory = directory.join("task-mannager").join("equipo");
        fs::create_dir_all(&task_directory).expect("task directory");
        let task_path = task_directory.join("ticket.md");
        fs::write(&task_path, "---\ntablero: equipo\n---\n\nContenido").expect("task content");

        let mut publication = publication();
        publication.vault_path = directory.to_string_lossy().into_owned();
        let result = execute_publication_comment_append(
            &serde_json::json!({
                "filePath": task_path.to_string_lossy(),
                "comment": "Comentario concurrente",
            }),
            &publication,
        )
        .expect("append comment");

        assert!(result.1);
        let content = fs::read_to_string(&task_path).expect("updated task");
        assert!(content.contains("Contenido"));
        assert!(content.contains("## Comentario - "));
        assert!(content.contains("Comentario concurrente"));
        fs::remove_dir_all(&directory).expect("remove test directory");
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
    fn host_changed_paths_are_limited_to_the_published_scope() {
        let publication = publication();
        let paths = sanitize_host_changed_paths(
            &[
                "task-mannager/equipo/demo.md".to_string(),
                "task-mannager/privado/secret.md".to_string(),
                "C:/VaultX/equipo/leak.md".to_string(),
                "task-mannager/pomodoro.md".to_string(),
            ],
            &publication,
        );

        assert_eq!(
            paths,
            vec![
                "published-vault/task-mannager/equipo/demo.md".to_string(),
                "published-vault/task-mannager/pomodoro.md".to_string(),
            ]
        );
    }

    #[test]
    fn supports_a_vault_that_is_itself_the_task_manager_root() {
        let mut publication = publication();
        publication.vault_path = "C:/Vault/task-mannager".to_string();
        let paths = sanitize_host_changed_paths(
            &["task-mannager/equipo/demo.md".to_string()],
            &publication,
        );

        assert_eq!(task_roots(&publication), vec!["c:/vault/task-mannager"]);
        assert_eq!(paths, vec!["published-vault/equipo/demo.md".to_string()]);
    }

    #[test]
    fn publication_filesystem_errors_are_safe_and_categorized() {
        let result = sanitize_publication_result(
            "write_library_file",
            serde_json::json!({
                "ok": false,
                "error": "Access denied: C:/Users/private/vault/task-mannager/secret.md"
            }),
        );

        assert_eq!(
            result["error"],
            "No se pudo guardar el contenido publicado."
        );
        assert!(!result.to_string().contains("C:/Users/private/vault"));
    }

    #[test]
    fn resolves_existing_and_new_paths_only_inside_the_canonical_vault() {
        let directory = std::env::temp_dir().join(format!(
            "notia-task-manager-containment-test-{}",
            uuid::Uuid::new_v4()
        ));
        let task_directory = directory.join("task-mannager").join("equipo");
        fs::create_dir_all(&task_directory).expect("containment test directory");
        let existing_path = task_directory.join("ticket.md");
        fs::write(&existing_path, "contenido").expect("existing task");
        let outside_path = directory
            .parent()
            .expect("temporary parent")
            .join(format!("notia-outside-{}.md", uuid::Uuid::new_v4()));
        fs::write(&outside_path, "outside").expect("outside file");

        let mut publication = publication();
        publication.vault_path = directory.to_string_lossy().into_owned();
        assert!(validate_publication_filesystem_paths(
            &serde_json::json!({ "filePath": existing_path }),
            &publication,
        )
        .is_ok());
        assert!(validate_publication_filesystem_paths(
            &serde_json::json!({ "filePath": task_directory.join("new.md") }),
            &publication,
        )
        .is_ok());
        assert!(validate_publication_filesystem_paths(
            &serde_json::json!({ "filePath": outside_path }),
            &publication,
        )
        .is_err());

        fs::remove_file(outside_path).expect("remove outside file");
        fs::remove_dir_all(directory).expect("remove containment test directory");
    }

    #[test]
    fn rejects_a_symlinked_ancestor_inside_the_published_vault() {
        use std::os::windows::fs::symlink_dir;

        let directory = std::env::temp_dir().join(format!(
            "notia-task-manager-symlink-test-{}",
            uuid::Uuid::new_v4()
        ));
        let task_directory = directory.join("task-mannager").join("equipo");
        let outside_directory = directory.join("outside");
        fs::create_dir_all(&task_directory).expect("symlink task directory");
        fs::create_dir_all(&outside_directory).expect("symlink outside directory");
        let symlink_path = task_directory.join("linked");
        if symlink_dir(&outside_directory, &symlink_path).is_err() {
            fs::remove_dir_all(&directory).expect("remove skipped symlink test");
            return;
        }

        let mut publication = publication();
        publication.vault_path = directory.to_string_lossy().into_owned();
        assert!(validate_publication_filesystem_paths(
            &serde_json::json!({
                "filePath": symlink_path.join("escape.md")
            }),
            &publication,
        )
        .is_err());

        fs::remove_dir(&symlink_path).expect("remove symlink");
        fs::remove_dir_all(&directory).expect("remove symlink test directory");
    }

    #[test]
    fn validates_typed_publication_mutation_payloads_before_execution() {
        assert!(is_safe_publication_operation_id("operation-123"));
        assert!(!is_safe_publication_operation_id("operation with spaces"));
        assert!(!is_safe_publication_operation_id("operation\n123"));
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::WriteLibraryFile,
            &serde_json::json!({
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/ticket.md",
                    "content": "contenido",
                    "expectedRevision": "sha256:abc"
                }
            }),
        )
        .is_ok());
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::WriteLibraryFile,
            &serde_json::json!({
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/ticket.md"
                }
            }),
        )
        .is_err());
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::AppendTaskComment,
            &serde_json::json!({
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/ticket.md",
                    "comment": "comentario"
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
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::UpdatePublicationSettings,
            &serde_json::json!({
                "settings": {
                    "boards": [],
                    "groups": []
                }
            }),
        )
        .is_ok());
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
        let oversized_comment = "x".repeat(10_001);
        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::AppendTaskComment,
            &serde_json::json!({
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/ticket.md",
                    "comment": oversized_comment,
                }
            }),
        )
        .is_err());

        assert!(validate_publication_mutation_args(
            PublicationMutationCommand::WriteLibraryFile,
            &serde_json::json!({
                "payload": {
                    "filePath": "published-vault/task-mannager/equipo/ticket.md",
                    "content": "contenido\u{0000}no valido",
                }
            }),
        )
        .is_err());

        assert!(!authorize_command(
            "write_library_file",
            &serde_json::json!({
                "filePath": "C:/Vault/task-mannager/equipo/../privado/secret.md",
                "content": "no debe escribirse",
            }),
            &publication(),
        ));
        assert!(!authorize_command(
            "write_library_file",
            &serde_json::json!({
                "filePath": "C:/Vault/task-mannager/equipo/taskIndex.md",
                "content": "no debe sobrescribirse",
            }),
            &publication(),
        ));
    }
}
