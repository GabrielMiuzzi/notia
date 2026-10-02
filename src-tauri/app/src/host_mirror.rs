//! The copy a «Con copia» client keeps of its host's library.
//!
//! - **Online**, every command runs on the host and this copy follows it:
//!   a sync starts in the background as soon as a session with the host
//!   opens, and the monitor of `host_client` repeats it every few seconds
//!   (`sync_in_background`), with the rules of `mirror_sync` and the
//!   commands of `host_sync`. The window never waits for it.
//! - **Offline**, the window works on the copy as a library of this device
//!   (`enter_offline_copy`): notes and files can change, the database is a
//!   read-only snapshot, and the AI and speech recognition are local. A
//!   ready copy opens at once when the host does not answer (`copy_ready`).
//! - **Back online**, the next sync reconciles both sides: the last
//!   modified file wins, whatever device changed it. What changed on this
//!   device travels first, so the host shows it as soon as possible.
//!
//! Where the copy lives (`CopyStore`): on Windows and Linux in the app data
//! folder (`mirror/<library>/<name>`); on Android in a folder the person
//! chooses (a SAF tree), because Android libraries are SAF folders. The
//! record of the last sync stays in the app data folder, and a mark in the
//! copy (`.notia/notia-copy.json`) keeps another library from mixing in.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::backend::connection::ClientKind;
use crate::backend::mirror_sync::{plan, FileStamp, SyncAction, SyncBase};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Emitter, Manager};
use crate::host_sync::{
    delete_synced, synced_files, synced_target, write_synced, DatabaseSnapshot, SyncFile, SyncManifest,
    MAX_SYNC_UPLOAD_BYTES,
};

/// Event of the interface after each sync of the copy.
pub(crate) const COPY_EVENT: &str = "notia:copy-sync";
const DIRECTORY: &str = "mirror";
const CURRENT_FILE: &str = "current.json";
/// Mark of a copy, with the host library it belongs to.
const MARK_PATH: &str = ".notia/notia-copy.json";
const DATABASE_PATH: &str = ".notia/notia.db";
/// How often a changed database of the host is copied again. The copy only
/// serves offline, and the host's database changes every minute (its
/// scheduled actions renew a lease): copying it on every change moved the
/// whole file over the network and, on Android, through SAF.
const DATABASE_REFRESH: std::time::Duration = std::time::Duration::from_secs(10 * 60);

#[derive(Default)]
pub(crate) struct MirrorState {
    sync: tokio::sync::Mutex<()>,
    /// A sync of `sync_in_background` runs.
    background: AtomicBool,
    /// The running sync moves files or the database (not only compares).
    transferring: AtomicBool,
    /// When this run last copied the host's database.
    database_copied_at: Mutex<Option<std::time::Instant>>,
    offline: AtomicBool,
    /// The copy was listed since this device last worked offline: on
    /// Android, where listing a SAF folder is slow, later syncs trust the
    /// record (only the sync writes the copy while online).
    scanned: AtomicBool,
    last: Mutex<Option<CopyStatus>>,
}

/// The copy the window works on offline: its database opens read-only
/// (`database`).
enum ReadOnlyCopy {
    #[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
    Folder(PathBuf),
    #[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(dead_code))]
    Saf(String),
}

static READ_ONLY_COPY: Mutex<Option<ReadOnlyCopy>> = Mutex::new(None);

/// Whether the database of the library at `library_path` is the snapshot
/// of an offline copy (Windows and Linux).
#[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
pub(crate) fn database_is_read_only(library_path: &str) -> bool {
    match READ_ONLY_COPY.lock().ok().as_deref() {
        Some(Some(ReadOnlyCopy::Folder(root))) => std::fs::canonicalize(library_path).is_ok_and(|path| &path == root),
        _ => false,
    }
}

/// Whether the database of the SAF library `tree_uri` is the snapshot of an
/// offline copy (Android).
#[cfg_attr(not(any(target_os = "android", target_os = "ios")), allow(dead_code))]
pub(crate) fn database_uri_is_read_only(tree_uri: &str) -> bool {
    matches!(READ_ONLY_COPY.lock().ok().as_deref(), Some(Some(ReadOnlyCopy::Saf(uri))) if uri == tree_uri)
}

/// Record of the copy of one library of the host.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyRecord {
    /// Folder of the copy (Windows and Linux).
    #[serde(default)]
    folder: Option<PathBuf>,
    /// SAF folder of the copy (Android); another folder starts over.
    #[serde(default)]
    folder_uri: Option<String>,
    #[serde(default)]
    files: BTreeMap<String, SyncBase>,
    #[serde(default)]
    database_ms: Option<i64>,
    /// The library of this device the copy opens as offline.
    #[serde(default)]
    local_library_id: Option<String>,
    /// The library selected on this device before working offline.
    #[serde(default)]
    previous_selection: Option<String>,
}

/// The host library this device copies, kept for starting offline.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentCopy {
    host_address: String,
    library_id: String,
    library_name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyMark {
    host_library_id: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyStatus {
    downloaded: usize,
    uploaded: usize,
    deleted: usize,
    /// Files that did not travel (too large, or the host did not give them).
    skipped: Vec<String>,
    at_ms: i64,
    error: Option<String>,
}

fn storage(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Storage, message, true)
}

fn unavailable(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Unsupported, message, false)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

fn directory(app: &AppHandle) -> Result<PathBuf, BackendError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(DIRECTORY))
        .map_err(|_| storage("No se encontró la carpeta de datos de Notia."))
}

/// A name that is safe as a single folder name.
fn folder_name(text: &str, fallback: &str) -> String {
    let name: String = text
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .chars()
        .take(80)
        .collect();
    if name.is_empty() { fallback.to_string() } else { name }
}

fn record_path(app: &AppHandle, library_id: &str) -> Result<PathBuf, BackendError> {
    Ok(directory(app)?.join(format!("{}.json", folder_name(library_id, "biblioteca"))))
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), BackendError> {
    let failed = || storage("No se pudo guardar el estado de la copia.");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| failed())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|_| failed())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(|_| failed())?;
    std::fs::rename(&temporary, path).map_err(|_| failed())
}

fn state(app: &AppHandle) -> Option<crate::host::State<'static, MirrorState>> {
    app.try_state::<MirrorState>()
}

/// Whether the window works on the copy, without the host.
pub(crate) fn is_offline(app: &AppHandle) -> bool {
    state(app).is_some_and(|state| state.offline.load(Ordering::SeqCst))
}

/// Whether this device keeps a copy of its host's library.
pub(crate) fn keeps_copy(app: &AppHandle) -> bool {
    crate::connection::client_host(app).is_some_and(|(_, kind, _)| kind == ClientKind::Copy)
}

/// The last sync, for Settings and the window.
pub(crate) fn last_status(app: &AppHandle) -> Option<CopyStatus> {
    state(app).and_then(|state| state.last.lock().ok().and_then(|last| last.clone()))
}

/// Whether a sync is moving files or the database right now.
pub(crate) fn is_transferring(app: &AppHandle) -> bool {
    state(app).is_some_and(|state| state.transferring.load(Ordering::SeqCst))
}

/// The error of the last sync, when it failed.
pub(crate) fn last_error(app: &AppHandle) -> Option<String> {
    last_status(app).and_then(|status| status.error)
}

/// Whether this device has a copy of its host's library that opens without
/// the host: synced at least once with the saved host, with its database.
pub(crate) fn copy_ready(app: &AppHandle) -> bool {
    if !keeps_copy(app) {
        return false;
    }
    let Ok(directory) = directory(app) else {
        return false;
    };
    let current: CurrentCopy = read_json(&directory.join(CURRENT_FILE));
    if current.library_id.is_empty() || current.host_address != crate::connection::settings(app).host_address {
        return false;
    }
    let Ok(record_file) = record_path(app, &current.library_id) else {
        return false;
    };
    let record: CopyRecord = read_json(&record_file);
    record.database_ms.is_some() && copy_folder_exists(app, &record)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn copy_folder_exists(_app: &AppHandle, record: &CopyRecord) -> bool {
    record.folder.as_ref().is_some_and(|folder| folder.is_dir())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn copy_folder_exists(app: &AppHandle, record: &CopyRecord) -> bool {
    crate::connection::settings(app).copy_folder.is_some_and(|folder| record.folder_uri.as_deref() == Some(folder.uri.as_str()))
}

// ---------- Where the copy lives ----------

/// The folder of the copy and how its files are read and written.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
enum CopyStore {
    /// A folder of the app data (Windows and Linux), by canonical path.
    Folder(PathBuf),
    /// The SAF folder the person chose (Android). Its tree URI is kept as
    /// received; files resolve to their own document URIs.
    Saf(String),
}

fn copy_read_error() -> BackendError {
    storage("No se pudo leer un archivo de la copia.")
}

fn copy_write_error() -> BackendError {
    storage("No se pudo guardar un archivo en la copia.")
}

impl CopyStore {
    /// Files of the copy that travel, with their size and time.
    fn list(&self, app: &AppHandle) -> Result<BTreeMap<String, FileStamp>, BackendError> {
        match self {
            Self::Folder(root) => Ok(synced_files(root)?.into_iter().map(|file| (file.path, file.stamp)).collect()),
            Self::Saf(tree_uri) => saf::list(app, tree_uri),
        }
    }

    fn read(&self, app: &AppHandle, path: &str) -> Result<Vec<u8>, BackendError> {
        match self {
            Self::Folder(root) => std::fs::read(synced_target(root, path)?).map_err(|_| copy_read_error()),
            Self::Saf(tree_uri) => saf::read(app, tree_uri, path)?.ok_or_else(copy_read_error),
        }
    }

    /// Writes a file that travels; the folder keeps the host's time.
    fn write(&self, app: &AppHandle, path: &str, bytes: &[u8], modified_ms: i64) -> Result<(), BackendError> {
        match self {
            Self::Folder(root) => write_synced(&synced_target(root, path)?, bytes, modified_ms).map(|_| ()),
            Self::Saf(tree_uri) => {
                crate::host_sync::check_synced_path(path)?;
                saf::write(app, tree_uri, path, bytes)
            }
        }
    }

    fn delete(&self, app: &AppHandle, path: &str) -> Result<(), BackendError> {
        match self {
            Self::Folder(root) => delete_synced(root, &synced_target(root, path)?),
            Self::Saf(tree_uri) => {
                crate::host_sync::check_synced_path(path)?;
                saf::delete(app, tree_uri, path)
            }
        }
    }

    /// Replaces the database with the host's snapshot.
    fn write_database(&self, app: &AppHandle, bytes: &[u8]) -> Result<(), BackendError> {
        match self {
            Self::Folder(root) => {
                let notia = root.join(".notia");
                let temporary = notia.join(format!(".notia-sync-{}.tmp", uuid::Uuid::new_v4()));
                std::fs::write(&temporary, bytes).map_err(|_| storage("No se pudo guardar la copia de la base de datos."))?;
                for stale in ["notia.db-wal", "notia.db-shm"] {
                    let _ = std::fs::remove_file(notia.join(stale));
                }
                std::fs::rename(&temporary, notia.join("notia.db")).map_err(|_| {
                    let _ = std::fs::remove_file(&temporary);
                    storage("No se pudo guardar la copia de la base de datos.")
                })
            }
            Self::Saf(tree_uri) => saf::write(app, tree_uri, DATABASE_PATH, bytes).map(|_| saf::database_replaced(app)),
        }
    }

    /// The host library the copy belongs to, when marked.
    fn mark(&self, app: &AppHandle) -> Option<String> {
        let bytes = match self {
            Self::Folder(root) => std::fs::read(root.join(".notia").join("notia-copy.json")).ok()?,
            Self::Saf(tree_uri) => saf::read(app, tree_uri, MARK_PATH).ok()??,
        };
        let mark: CopyMark = serde_json::from_slice(&bytes).ok()?;
        (!mark.host_library_id.is_empty()).then_some(mark.host_library_id)
    }

    fn write_mark(&self, app: &AppHandle, host_library_id: &str) -> Result<(), BackendError> {
        let text = serde_json::to_vec(&CopyMark { host_library_id: host_library_id.to_string() }).map_err(|_| copy_write_error())?;
        match self {
            Self::Folder(root) => std::fs::write(root.join(".notia").join("notia-copy.json"), text).map_err(|_| copy_write_error()),
            Self::Saf(tree_uri) => saf::write(app, tree_uri, MARK_PATH, &text),
        }
    }

    /// The folder changed: what shows it again reads it fresh.
    fn changed(&self, app: &AppHandle) {
        if let Self::Saf(tree_uri) = self {
            saf::changed(app, tree_uri);
        }
    }
}

/// The copy's folder for this device, starting the record over when the
/// person chose another folder.
fn copy_store(app: &AppHandle, record: &mut CopyRecord, library_id: &str, library_name: &str) -> Result<CopyStore, BackendError> {
    if cfg!(target_os = "android") {
        let folder = crate::connection::settings(app)
            .copy_folder
            .ok_or_else(|| unavailable("Elegí la carpeta de la copia en Configuraciones → General."))?;
        if record.folder_uri.as_deref() != Some(folder.uri.as_str()) {
            *record = CopyRecord { folder_uri: Some(folder.uri.clone()), ..CopyRecord::default() };
        }
        return Ok(CopyStore::Saf(folder.uri));
    }
    let folder = match &record.folder {
        Some(folder) => folder.clone(),
        None => directory(app)?.join(folder_name(library_id, "biblioteca")).join(folder_name(library_name, "Biblioteca")),
    };
    std::fs::create_dir_all(folder.join(".notia")).map_err(|_| storage("No se pudo crear la carpeta de la copia."))?;
    let root = std::fs::canonicalize(&folder).map_err(|_| storage("No se pudo abrir la carpeta de la copia."))?;
    record.folder = Some(folder);
    Ok(CopyStore::Folder(root))
}

// ---------- Sync ----------

/// Brings the copy and the host's library in line (see the module).
pub(crate) async fn sync(app: &AppHandle) -> Result<CopyStatus, BackendError> {
    if !keeps_copy(app) {
        return Err(unavailable("Este equipo no guarda una copia de la biblioteca del host."));
    }
    if is_offline(app) {
        return Err(unavailable("La copia se sincroniza cuando vuelve la conexión con el host."));
    }
    let state = state(app).ok_or_else(|| unavailable("La copia no está disponible."))?;
    let _guard = state.sync.lock().await;
    let (library_id, library_name) = crate::host_client::served_library(app)
        .ok_or_else(|| unavailable("Todavía no se sabe qué biblioteca comparte el host."))?;
    let result = sync_library(app, &state, &library_id, &library_name).await;
    state.transferring.store(false, Ordering::SeqCst);
    let status = match &result {
        Ok(status) => status.clone(),
        Err(error) => CopyStatus { at_ms: now_ms(), error: Some(error.message.clone()), ..CopyStatus::default() },
    };
    if let Ok(mut last) = state.last.lock() {
        *last = Some(status.clone());
    }
    let _ = app.emit(COPY_EVENT, &status);
    crate::client_status::refresh(app);
    result
}

/// Starts a sync on its own thread, unless one already runs: the window
/// and the monitor of the host never wait for it.
pub(crate) fn sync_in_background(app: &AppHandle) {
    if !keeps_copy(app) || is_offline(app) {
        return;
    }
    let Some(state) = state(app) else {
        return;
    };
    if state.background.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("notia-copy-sync".into()).spawn(move || {
        if let Err(error) = crate::host::async_runtime::block_on(sync(&app)) {
            log::warn!("[notia:copy] the copy did not sync: {}", error.message);
        }
        if let Some(state) = self::state(&app) {
            state.background.store(false, Ordering::SeqCst);
        }
    });
    if spawned.is_err() {
        state.background.store(false, Ordering::SeqCst);
        log::error!("[notia:copy] the sync of the copy did not start");
    }
}

async fn sync_library(app: &AppHandle, state: &MirrorState, library_id: &str, library_name: &str) -> Result<CopyStatus, BackendError> {
    let payload = json!({ "payload": { "libraryId": library_id } });
    let manifest: SyncManifest = crate::host_client::call_host(app, "host_sync_manifest", payload.clone()).await?;
    let record_file = record_path(app, library_id)?;
    let mut record: CopyRecord = read_json(&record_file);
    let store = copy_store(app, &mut record, library_id, library_name)?;
    let mark = store.mark(app);
    if mark.as_deref().is_some_and(|mark| mark != library_id) {
        return Err(unavailable("La carpeta de la copia tiene la copia de otra biblioteca: elegí otra en Configuraciones → General."));
    }

    // The copy is listed when this device may have changed it (desktop
    // always; Android after starting or working offline).
    let scan = cfg!(not(target_os = "android")) || !state.scanned.load(Ordering::SeqCst);
    let local: BTreeMap<String, FileStamp> = if scan {
        store.list(app)?
    } else {
        record.files.iter().map(|(path, base)| (path.clone(), base.local)).collect()
    };
    let remote: BTreeMap<String, FileStamp> = manifest.files.iter().map(|file| (file.path.clone(), file.stamp)).collect();
    let paths: BTreeSet<String> = record.files.keys().chain(local.keys()).chain(remote.keys()).cloned().collect();

    // What changed on this device travels first: the window, already on
    // the host, shows the offline work as soon as possible. Then the
    // database (the copy opens offline only with it: the sign-in reads the
    // Owner from it) and last what the host changed.
    let mut plans: Vec<(String, SyncAction)> = paths
        .into_iter()
        .map(|path| {
            let action = plan(record.files.get(&path), local.get(&path), remote.get(&path));
            (path, action)
        })
        .filter(|(_, action)| *action != SyncAction::Keep)
        .collect();
    plans.sort_by_key(|(_, action)| !is_outgoing(*action));
    let database_due = record.database_ms.is_none()
        || state
            .database_copied_at
            .lock()
            .ok()
            .and_then(|copied| *copied)
            .is_none_or(|copied| copied.elapsed() >= DATABASE_REFRESH);
    let database_changed = database_due && manifest.database.map(|database| database.modified_ms) != record.database_ms;
    if !plans.is_empty() || database_changed {
        state.transferring.store(true, Ordering::SeqCst);
        crate::client_status::refresh(app);
    }
    let (outgoing, incoming) = plans.split_at(plans.partition_point(|(_, action)| is_outgoing(*action)));

    let mut pass = Pass {
        app,
        store: &store,
        library_id,
        host_root: &manifest.root,
        local: &local,
        remote: &remote,
        record: &mut record,
        status: CopyStatus::default(),
        downloaded: Vec::new(),
        failure: None,
    };
    pass.run(outgoing).await;
    if pass.failure.is_none() && database_changed {
        match copy_database(app, &store, &payload).await {
            Ok(modified_ms) => {
                pass.record.database_ms = modified_ms;
                if let Ok(mut copied) = state.database_copied_at.lock() {
                    *copied = Some(std::time::Instant::now());
                }
            }
            Err(error) => pass.failure = Some(error),
        }
    }
    pass.run(incoming).await;
    let Pass { mut status, downloaded, mut failure, .. } = pass;

    // What the copy's folder says about the files just written.
    if !downloaded.is_empty() {
        if let Ok(after) = store.list(app) {
            for path in &downloaded {
                if let (Some(stamp), Some(base)) = (after.get(path), record.files.get_mut(path)) {
                    base.local = *stamp;
                }
            }
        }
    }

    if failure.is_none() && mark.is_none() {
        if let Err(error) = store.write_mark(app, library_id) {
            failure = Some(error);
        }
    }
    if status.downloaded + status.deleted > 0 {
        store.changed(app);
    }
    // What was done stays recorded even when the connection dropped.
    write_json(&record_file, &record)?;
    if let Some(error) = failure {
        return Err(error);
    }
    let current = CurrentCopy {
        host_address: crate::connection::settings(app).host_address,
        library_id: library_id.to_string(),
        library_name: library_name.to_string(),
    };
    write_json(&directory(app)?.join(CURRENT_FILE), &current)?;
    state.scanned.store(true, Ordering::SeqCst);
    status.at_ms = now_ms();
    Ok(status)
}

/// Whether `error` means the host stopped answering (the sync stops) rather
/// than one file failing (it is skipped).
fn connection_lost(error: &BackendError) -> bool {
    matches!(error.code, BackendErrorCode::ProviderUnavailable | BackendErrorCode::Unauthorized | BackendErrorCode::Forbidden)
}

/// Whether `action` takes a change of this device to the host.
fn is_outgoing(action: SyncAction) -> bool {
    matches!(action, SyncAction::Upload | SyncAction::DeleteRemote)
}

/// One run over the files of a sync, recording what travelled.
struct Pass<'a> {
    app: &'a AppHandle,
    store: &'a CopyStore,
    library_id: &'a str,
    host_root: &'a str,
    local: &'a BTreeMap<String, FileStamp>,
    remote: &'a BTreeMap<String, FileStamp>,
    record: &'a mut CopyRecord,
    status: CopyStatus,
    /// Files written in the copy, whose folder stamps are read afterwards.
    downloaded: Vec<String>,
    /// Why the sync stopped (the host stopped answering).
    failure: Option<BackendError>,
}

impl Pass<'_> {
    async fn run(&mut self, plans: &[(String, SyncAction)]) {
        for (path, action) in plans {
            if self.failure.is_some() {
                return;
            }
            let (local, remote) = (self.local.get(path), self.remote.get(path));
            let applied = apply(self.app, self.store, self.library_id, self.host_root, path, *action, local, remote, &mut self.status).await;
            match applied {
                Ok(Outcome::Base(next)) => {
                    if *action == SyncAction::Download {
                        self.downloaded.push(path.clone());
                    }
                    self.record.files.insert(path.clone(), next);
                }
                Ok(Outcome::Drop) => {
                    self.record.files.remove(path);
                }
                Ok(Outcome::Unchanged) => {}
                // Without the host the sync stops; a file that cannot travel
                // is skipped, and the next sync tries it again.
                Err(error) if connection_lost(&error) => self.failure = Some(error),
                Err(error) => {
                    log::error!("[notia:copy] a file of the copy did not sync: {}", error.message);
                    self.status.skipped.push(path.clone());
                }
            }
        }
    }
}

/// What one action leaves in the record of the file.
enum Outcome {
    Base(SyncBase),
    Drop,
    /// Nothing changed, or the file did not travel: the next sync tries again.
    Unchanged,
}

#[allow(clippy::too_many_arguments)]
async fn apply(
    app: &AppHandle,
    store: &CopyStore,
    library_id: &str,
    host_root: &str,
    path: &str,
    action: SyncAction,
    local: Option<&FileStamp>,
    remote: Option<&FileStamp>,
    status: &mut CopyStatus,
) -> Result<Outcome, BackendError> {
    let base = |remote: FileStamp, local: FileStamp| Outcome::Base(SyncBase { remote, local });
    match (action, local, remote) {
        (SyncAction::Adopt, Some(local), Some(remote)) => Ok(base(*remote, *local)),
        (SyncAction::Download, _, Some(remote)) => {
            let Some((_, bytes)) = crate::host_client::fetch_file(app, &format!("{host_root}/{path}")).await else {
                status.skipped.push(path.to_string());
                return Ok(Outcome::Unchanged);
            };
            store.write(app, path, &bytes, remote.modified_ms)?;
            status.downloaded += 1;
            // The folder's own stamp replaces this one after the sync.
            Ok(base(*remote, *remote))
        }
        (SyncAction::Upload, Some(local), _) => {
            if local.size > MAX_SYNC_UPLOAD_BYTES {
                status.skipped.push(path.to_string());
                return Ok(Outcome::Unchanged);
            }
            let bytes = store.read(app, path)?;
            let payload = json!({ "payload": {
                "libraryId": library_id,
                "path": path,
                "contentBase64": base64::engine::general_purpose::STANDARD.encode(bytes),
                "modifiedMs": local.modified_ms,
            }});
            let written: SyncFile = crate::host_client::call_host(app, "host_sync_write", payload).await?;
            status.uploaded += 1;
            Ok(base(written.stamp, *local))
        }
        (SyncAction::DeleteLocal, _, _) => {
            store.delete(app, path)?;
            status.deleted += 1;
            Ok(Outcome::Drop)
        }
        (SyncAction::DeleteRemote, _, _) => {
            let payload = json!({ "payload": { "libraryId": library_id, "path": path } });
            crate::host_client::call_host::<serde_json::Value>(app, "host_sync_delete", payload).await?;
            status.deleted += 1;
            Ok(Outcome::Drop)
        }
        (SyncAction::Forget, _, _) => Ok(Outcome::Drop),
        _ => Ok(Outcome::Unchanged),
    }
}

async fn copy_database(app: &AppHandle, store: &CopyStore, payload: &serde_json::Value) -> Result<Option<i64>, BackendError> {
    let snapshot: Option<DatabaseSnapshot> = crate::host_client::call_host(app, "host_sync_database", payload.clone()).await?;
    let Some(snapshot) = snapshot else {
        return Ok(None);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(snapshot.content_base64.as_bytes())
        .map_err(|_| storage("La copia de la base de datos no es válida."))?;
    store.write_database(app, &bytes)?;
    Ok(Some(snapshot.modified_ms))
}

// ---------- The SAF folder of the copy (Android) ----------

#[cfg(target_os = "android")]
mod saf {
    use std::collections::BTreeMap;

    use crate::backend::mirror_sync::{is_synced_path, FileStamp};
    use crate::backend::{BackendError, BackendErrorCode, LogicalPathDto};
    use crate::host::{AppHandle, Manager};
    use crate::mobile_directory_picker::{self as picker, AndroidDirectoryPickerState};

    fn failed(message: impl Into<String>) -> BackendError {
        BackendError::new(BackendErrorCode::Storage, message, true)
    }

    fn picker_state(app: &AppHandle) -> &'static AndroidDirectoryPickerState {
        app.state::<AndroidDirectoryPickerState>().inner()
    }

    fn segments(path: &str) -> Result<Vec<String>, BackendError> {
        let logical = LogicalPathDto::new(path)?;
        Ok(logical.as_str().split('/').map(str::to_owned).collect())
    }

    /// The document URI of a file of the copy, when it exists.
    fn document(app: &AppHandle, tree_uri: &str, path: &str) -> Result<Option<String>, BackendError> {
        LogicalPathDto::new(path)?;
        let lookup = format!("{}/{path}", tree_uri.trim_end_matches('/'));
        Ok(crate::filesystem::android_saf::resolve_document_uri(picker_state(app), &lookup, Some(tree_uri)))
    }

    pub(super) fn list(app: &AppHandle, tree_uri: &str) -> Result<BTreeMap<String, FileStamp>, BackendError> {
        let entries = picker::read_android_flat_entries(picker_state(app), tree_uri)
            .map_err(|_| failed("No se pudo leer la carpeta de la copia; volvé a elegirla en Configuraciones → General."))?;
        let prefix = format!("{}/", tree_uri.trim_end_matches('/'));
        Ok(entries
            .into_iter()
            .filter(|entry| entry.node_type == "file")
            .filter_map(|entry| {
                let path = entry.path.strip_prefix(&prefix)?.to_string();
                (is_synced_path(&path) && LogicalPathDto::new(&path).is_ok()).then(|| {
                    let stamp = FileStamp { size: entry.size.unwrap_or_default(), modified_ms: entry.last_modified.unwrap_or_default() };
                    (path, stamp)
                })
            })
            .collect())
    }

    pub(super) fn read(app: &AppHandle, tree_uri: &str, path: &str) -> Result<Option<Vec<u8>>, BackendError> {
        let Some(uri) = document(app, tree_uri, path)? else {
            return Ok(None);
        };
        picker::read_android_content_bytes(picker_state(app), &uri)
            .map(|(_, bytes)| Some(bytes))
            .map_err(|_| failed("No se pudo leer un archivo de la copia."))
    }

    /// Creates the file (and its folders) when missing and writes it.
    pub(super) fn write(app: &AppHandle, tree_uri: &str, path: &str, bytes: &[u8]) -> Result<(), BackendError> {
        let state = picker_state(app);
        let uri = picker::create_android_path_entry(state, tree_uri, &segments(path)?, "file", None)
            .map_err(|_| failed("No se pudo crear un archivo en la copia."))?;
        picker::write_android_content_bytes(state, &uri, bytes).map_err(|_| failed("No se pudo guardar un archivo en la copia."))?;
        picker::put_android_path_lru(state, format!("{}/{path}", tree_uri.trim_end_matches('/')), uri);
        Ok(())
    }

    pub(super) fn delete(app: &AppHandle, tree_uri: &str, path: &str) -> Result<(), BackendError> {
        let Some(uri) = document(app, tree_uri, path)? else {
            return Ok(());
        };
        picker::delete_android_tree_entry(picker_state(app), &uri).map_err(|_| failed("No se pudo borrar un archivo de la copia."))?;
        picker::invalidate_android_path_lru(picker_state(app), &format!("{}/{path}", tree_uri.trim_end_matches('/')));
        Ok(())
    }

    /// The temporary copies of SQLite are made again from the new snapshot.
    pub(super) fn database_replaced(app: &AppHandle) {
        crate::database::discard_mobile_database_copies(app);
    }

    pub(super) fn changed(app: &AppHandle, tree_uri: &str) {
        picker::invalidate_tree_cache(picker_state(app), tree_uri);
        picker::mark_tree_mutated(picker_state(app), tree_uri);
    }

    /// The person picks the folder of the copy. It must be empty, or an
    /// earlier copy: other files would travel to the host as new ones.
    pub(super) fn pick_folder(app: &AppHandle) -> Result<crate::backend::connection::CopyFolder, BackendError> {
        let picked = picker::pick_android_directory_tree(app.state(), app.state(), None).map_err(failed)?;
        let uri = picked.uri.ok_or_else(|| failed("El selector no devolvió una carpeta."))?;
        let entries = picker::read_android_flat_entries(picker_state(app), &uri)
            .map_err(|_| failed("No se pudo leer la carpeta elegida."))?;
        let prefix = format!("{}/", uri.trim_end_matches('/'));
        let marked = entries.iter().any(|entry| entry.path.strip_prefix(&prefix) == Some(super::MARK_PATH));
        let has_files = entries.iter().any(|entry| {
            let path = entry.path.strip_prefix(&prefix).unwrap_or(&entry.path);
            path != ".notia" && !path.starts_with(".notia/")
        });
        if has_files && !marked {
            return Err(BackendError::invalid_input(
                "Elegí una carpeta vacía para la copia: lo que tenga se subiría al host como archivos nuevos.",
            ));
        }
        let name = crate::backend::library_tree::library_display_name(&uri);
        Ok(crate::backend::connection::CopyFolder { uri, name })
    }
}

#[cfg(not(target_os = "android"))]
mod saf {
    use std::collections::BTreeMap;

    use crate::backend::mirror_sync::FileStamp;
    use crate::backend::BackendError;
    use crate::host::AppHandle;

    fn unavailable() -> BackendError {
        super::unavailable("La carpeta SAF de la copia solo existe en Android.")
    }

    pub(super) fn list(_app: &AppHandle, _tree_uri: &str) -> Result<BTreeMap<String, FileStamp>, BackendError> {
        Err(unavailable())
    }

    pub(super) fn read(_app: &AppHandle, _tree_uri: &str, _path: &str) -> Result<Option<Vec<u8>>, BackendError> {
        Err(unavailable())
    }

    pub(super) fn write(_app: &AppHandle, _tree_uri: &str, _path: &str, _bytes: &[u8]) -> Result<(), BackendError> {
        Err(unavailable())
    }

    pub(super) fn delete(_app: &AppHandle, _tree_uri: &str, _path: &str) -> Result<(), BackendError> {
        Err(unavailable())
    }

    pub(super) fn database_replaced(_app: &AppHandle) {}

    pub(super) fn changed(_app: &AppHandle, _tree_uri: &str) {}
}

/// Android: the person picks the folder of the copy (Configuraciones →
/// General). Windows and Linux keep it in the app data folder.
pub(crate) async fn pick_copy_folder(app: AppHandle) -> Result<(), BackendError> {
    #[cfg(target_os = "android")]
    {
        let picker_app = app.clone();
        let folder = crate::host::async_runtime::spawn_blocking(move || saf::pick_folder(&picker_app))
            .await
            .map_err(|_| storage("No se pudo abrir el selector de carpetas."))??;
        let mut settings = crate::connection::settings(&app);
        settings.copy_folder = Some(folder);
        crate::connection::store(&app, &settings)?;
        // The new folder is listed on the next sync.
        if let Some(state) = state(&app) {
            state.scanned.store(false, Ordering::SeqCst);
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(unavailable("En este equipo la copia se guarda sola en la carpeta de datos de Notia."))
    }
}

// ---------- Offline ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfflineCopy {
    library_id: String,
    library_name: String,
}

/// Opens the copy as a library of this device while the host does not
/// answer: the window works on it until the connection comes back.
pub(crate) fn enter_offline_copy(app: &AppHandle) -> Result<OfflineCopy, BackendError> {
    if !keeps_copy(app) {
        return Err(unavailable("Este equipo no guarda una copia de la biblioteca del host."));
    }
    let never_synced = || {
        BackendError::new(
            BackendErrorCode::NotFound,
            "Todavía no hay una copia de la biblioteca en este equipo: conectate al host al menos una vez.",
            true,
        )
    };
    let current: CurrentCopy = read_json(&directory(app)?.join(CURRENT_FILE));
    if current.library_id.is_empty() || current.host_address != crate::connection::settings(app).host_address {
        return Err(never_synced());
    }
    let record_file = record_path(app, &current.library_id)?;
    let mut record: CopyRecord = read_json(&record_file);
    if record.database_ms.is_none() {
        return Err(BackendError::new(
            BackendErrorCode::NotFound,
            "La copia de este equipo todavía no tiene la base de datos de la biblioteca: conectate al host para completarla.",
            true,
        ));
    }
    let (library, read_only) = open_copy_library(app, &record).ok_or_else(never_synced)??;
    let previous = crate::library_catalog::select_library(app, Some(&library.id))?;
    if previous.as_deref() != Some(library.id.as_str()) {
        record.previous_selection = previous;
    }
    record.local_library_id = Some(library.id.clone());
    write_json(&record_file, &record)?;
    if let Ok(mut copy) = READ_ONLY_COPY.lock() {
        *copy = Some(read_only);
    }
    if let Some(state) = state(app) {
        state.offline.store(true, Ordering::SeqCst);
    }
    crate::client_status::refresh(app);
    Ok(OfflineCopy { library_id: library.id, library_name: current.library_name })
}

/// The copy as a library of this device (added to the catalog), or `None`
/// when this device has not synced it yet.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_copy_library(
    app: &AppHandle,
    record: &CopyRecord,
) -> Option<Result<(crate::library_catalog::CatalogLibrary, ReadOnlyCopy), BackendError>> {
    let folder = record.folder.clone().filter(|folder| folder.is_dir())?;
    Some(crate::library_catalog::add_desktop_library(app, &folder).map(|library| {
        (library, ReadOnlyCopy::Folder(std::fs::canonicalize(&folder).unwrap_or(folder)))
    }))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn open_copy_library(
    app: &AppHandle,
    record: &CopyRecord,
) -> Option<Result<(crate::library_catalog::CatalogLibrary, ReadOnlyCopy), BackendError>> {
    let folder = crate::connection::settings(app).copy_folder?;
    if record.folder_uri.as_deref() != Some(folder.uri.as_str()) || record.database_ms.is_none() && record.files.is_empty() {
        return None;
    }
    Some(crate::library_catalog::add_android_library(app, &folder.uri).map(|library| (library, ReadOnlyCopy::Saf(folder.uri))))
}

/// The host answers again: the window goes back to it and the next sync
/// reconciles what changed meanwhile.
pub(crate) fn leave_offline_copy(app: &AppHandle) -> Result<(), BackendError> {
    let Some(state) = state(app) else {
        return Ok(());
    };
    if !state.offline.swap(false, Ordering::SeqCst) {
        return Ok(());
    }
    // What changed offline is found by listing the copy again.
    state.scanned.store(false, Ordering::SeqCst);
    if let Ok(mut copy) = READ_ONLY_COPY.lock() {
        *copy = None;
    }
    crate::client_status::refresh(app);
    let current: CurrentCopy = read_json(&directory(app)?.join(CURRENT_FILE));
    if current.library_id.is_empty() {
        return Ok(());
    }
    let record_file = record_path(app, &current.library_id)?;
    let mut record: CopyRecord = read_json(&record_file);
    if let Some(previous) = record.previous_selection.take() {
        let _ = crate::library_catalog::select_library(app, Some(&previous));
        write_json(&record_file, &record)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(folder_name("Mi: Biblioteca/2026", "x"), "Mi Biblioteca2026");
        assert_eq!(folder_name("..", "Biblioteca"), "Biblioteca");
        assert_eq!(folder_name("  ", "Biblioteca"), "Biblioteca");
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn the_copy_follows_the_host_and_keeps_the_last_modified_file() {
        use crate::backend::connection::{ConnectionSettings, RunMode};
        use crate::host::{AppPaths, HostPorts};

        let root = std::env::temp_dir().join(format!("notia-copy-{}", uuid::Uuid::new_v4()));
        let (host, port, stop, library_id) = crate::host_client::test_host::start(&root);
        let library = root.join("Biblioteca");
        std::fs::create_dir_all(library.join("Notas")).expect("notes");
        let write = |path: &Path, text: &str, modified_ms: i64| {
            std::fs::write(path, text).expect("write");
            let file = std::fs::OpenOptions::new().write(true).open(path).expect("open");
            file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_millis(modified_ms as u64)).expect("time");
        };
        let base_ms = 1_750_000_000_000_i64;
        write(&library.join("Notas/a.md"), "uno", base_ms);
        write(&library.join("b.md"), "dos", base_ms);

        let client = crate::create_app(AppPaths::new(Some(root.join("client")), None), HostPorts::default());
        let settings = ConnectionSettings { mode: RunMode::Client, host_address: format!("127.0.0.1:{port}"), ..ConnectionSettings::default() };
        crate::connection::store(&client, &settings).expect("settings");

        crate::host::async_runtime::block_on(async {
            crate::host_client::auth_login(&client, &library_id, "owner", "contraseña-1", false, false).await.expect("login");
            let first = sync(&client).await.expect("first sync");
            assert!(first.downloaded >= 2, "{first:?}");
        });
        let copy = directory(&client).expect("directory").join(folder_name(&library_id, "x")).join("Biblioteca");
        assert_eq!(std::fs::read_to_string(copy.join("Notas/a.md")).expect("a"), "uno");
        assert!(copy.join(".notia/notia.db").is_file(), "the database snapshot is kept");

        // Offline: the copy edits a.md and adds c.md; the host edits b.md.
        write(&copy.join("Notas/a.md"), "uno en la copia", base_ms + 10_000);
        write(&copy.join("c.md"), "nuevo", base_ms + 10_000);
        write(&library.join("b.md"), "dos en el host", base_ms + 20_000);
        // Offline, the copy's configuration changes a setting and turns
        // Telegram on (sealed with the library's key, as the copy does).
        let unlocked = crate::config_vault::unlocked(&host, &library_id).expect("unlocked host");
        let offline_config = serde_json::json!({
            "version": 1,
            "panelDesplegable": { "refreshIntervalMs": 60_000 },
            "telegram": { "enabled": true, "botToken": "1:abc" },
        });
        let sealed = crate::config_crypto::seal_config(&unlocked.key, &unlocked.wrapped, &offline_config.to_string()).expect("seal");
        let config_path = copy.join(".notia/notiaConfig.json");
        write(&config_path, &crate::backend::config_envelope::serialize_envelope(&sealed).expect("envelope"), base_ms + 10_000);
        crate::host::async_runtime::block_on(async {
            let status = sync(&client).await.expect("reconcile");
            assert_eq!((status.uploaded, status.downloaded), (3, 1), "{status:?}");
        });
        let host_config = crate::library_config::read_library_config(&host, &library_id).expect("read").expect("config");
        assert_eq!(host_config["panelDesplegable"]["refreshIntervalMs"], 60_000);
        assert_ne!(host_config["telegram"]["enabled"], true, "a copy never turns Telegram on");
        assert_eq!(std::fs::read_to_string(library.join("Notas/a.md")).expect("host a"), "uno en la copia");
        assert_eq!(std::fs::read_to_string(library.join("c.md")).expect("host c"), "nuevo");
        assert_eq!(std::fs::read_to_string(copy.join("b.md")).expect("copy b"), "dos en el host");

        // Both edit a.md: the last modified wins, whatever side.
        write(&copy.join("Notas/a.md"), "copia vieja", base_ms + 30_000);
        write(&library.join("Notas/a.md"), "host nuevo", base_ms + 40_000);
        // A deletion on the host reaches the copy.
        std::fs::remove_file(library.join("b.md")).expect("delete");
        crate::host::async_runtime::block_on(async { sync(&client).await.expect("conflict") });
        assert_eq!(std::fs::read_to_string(copy.join("Notas/a.md")).expect("copy a"), "host nuevo");
        assert!(!copy.join("b.md").exists());

        write(&copy.join("Notas/a.md"), "copia más nueva", base_ms + 60_000);
        write(&library.join("Notas/a.md"), "host anterior", base_ms + 50_000);
        crate::host::async_runtime::block_on(async { sync(&client).await.expect("conflict") });
        assert_eq!(std::fs::read_to_string(library.join("Notas/a.md")).expect("host a"), "copia más nueva");

        // The copy is marked with its library; another library's copy is refused.
        let mark = copy.join(".notia").join("notia-copy.json");
        assert!(std::fs::read_to_string(&mark).expect("mark").contains(&library_id));
        std::fs::write(&mark, r#"{"hostLibraryId":"otra"}"#).expect("other mark");
        let refused = crate::host::async_runtime::block_on(sync(&client));
        assert!(refused.is_err_and(|error| error.message.contains("otra biblioteca")));

        stop.store(true, Ordering::SeqCst);
        drop(host);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn without_the_host_the_copy_opens_and_the_owner_signs_in() {
        use crate::backend::connection::{ConnectionSettings, RunMode};
        use crate::host::{AppPaths, HostPorts};

        let root = std::env::temp_dir().join(format!("notia-offline-{}", uuid::Uuid::new_v4()));
        let (host, port, stop, library_id) = crate::host_client::test_host::start(&root);
        std::fs::write(root.join("Biblioteca").join("nota.md"), "hola").expect("note");
        let client = crate::create_app(AppPaths::new(Some(root.join("client")), None), HostPorts::default());
        client.manage(crate::mobile_directory_picker::AndroidDirectoryPickerState::empty());
        let settings = ConnectionSettings { mode: RunMode::Client, host_address: format!("127.0.0.1:{port}"), ..ConnectionSettings::default() };
        crate::connection::store(&client, &settings).expect("settings");
        crate::host::async_runtime::block_on(async {
            crate::host_client::auth_login(&client, &library_id, "owner", "contraseña-1", false, false).await.expect("login");
            sync(&client).await.expect("sync");
        });

        // The host closes: the window opens the copy without waiting for it.
        stop.store(true, Ordering::SeqCst);
        drop(host);
        assert!(copy_ready(&client));
        let started = std::time::Instant::now();
        let opened = crate::host::async_runtime::block_on(crate::connection::client_open(client.clone())).expect("open");
        assert_eq!(serde_json::to_value(&opened).expect("json")["opening"], "copy");
        assert!(started.elapsed() <= crate::host_client::HEALTH_TIMEOUT + std::time::Duration::from_secs(2));
        assert!(is_offline(&client));
        let offline = enter_offline_copy(&client).expect("offline copy");
        assert!(!crate::host_client::uses_host(&client));
        let status = |library_id: &str| {
            let payload = serde_json::from_value(json!({ "libraryId": library_id })).expect("payload");
            serde_json::to_value(crate::app_auth::app_auth_status(&client, payload).expect("status")).expect("json")
        };
        assert_eq!(status(&offline.library_id)["state"], "locked");
        let login = serde_json::from_value(json!({
            "libraryId": offline.library_id, "username": "owner", "password": "contraseña-1",
        }))
        .expect("login payload");
        let signed_in = serde_json::to_value(crate::app_auth::app_auth_login(&client, login).expect("local sign-in")).expect("json");
        assert_eq!(signed_in["state"], "unlocked");
        assert!(crate::library_config::read_library_config(&client, &offline.library_id).is_ok());

        leave_offline_copy(&client).expect("back");
        let _ = std::fs::remove_dir_all(&root);
    }
}
