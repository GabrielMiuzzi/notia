//! Markdown-backed Task Manager persistence.
//!
//! The task manager core owns the DTOs and the mutation protocol.  This module
//! owns the mapping between those DTOs and the Markdown workspace.  No JSON
//! snapshot is used as an authority: the workspace is re-read for every open
//! and a commit changes only the Markdown files/indexes affected by it.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use notia_backend_core::{
    BackendError, BackendErrorCode, TaskBoardDto, TaskCommentDto, TaskDocumentRouteDto,
    TaskEntityRevisionDto, TaskGroupDto, TaskManagerConfigDto, TaskManagerLibrarySnapshotDto,
    TaskManagerSnapshotDto, TaskManagerSnapshotStore, TaskManagerStoreCommit, TaskPriority,
    TaskState, TaskTicketDto, TaskTicketSummaryDto, MAX_TASK_COMMENTS, MAX_TASK_DATE_CHARS,
    MAX_TASK_HOURS, MAX_TASK_ORDER, MAX_TASK_REFERENCE_CHARS, MAX_TASK_RELATED_REFERENCES,
    MAX_TASK_SNAPSHOT_BYTES, MAX_TASK_TICKETS,
};
use sha2::{Digest, Sha256};

use std::rc::Rc;

use chrono::TimeZone as _;

use crate::task_manager_fs::{self as task_fs, TaskFileSystem};
use crate::library_registry::{LibraryBindingRegistry, LibraryBindingRoot};

const PRIMARY_ROOT: &str = "task-mannager";
const MODERN_ROOT: &str = "task-manager";
const MODERN_ACTIVE: &str = "tasks";
const FINISHED: &str = "finished";
const CANCELLED: &str = "cancelled";
const LEGACY_FINISHED: &str = "completadas";
const SUBTASKS: &str = "subTasks";
const MAX_FILES: usize = 2_500;
const MAX_FILE_CHARS: usize = 512_000;
const MAX_TOTAL_CHARS: usize = MAX_TASK_SNAPSHOT_BYTES / 2;
const SHARED_METADATA_FILE: &str = ".notia-task-manager.json";
const POMODORO_LOG_FILE: &str = "pomodoro.md";
const MAX_SHARED_METADATA_BYTES: usize = 256 * 1024;
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone)]
struct Workspace {
    library_root: PathBuf,
    root: PathBuf,
    active: PathBuf,
    finished: PathBuf,
    cancelled: PathBuf,
}

#[derive(Debug, Clone)]
struct ParsedDocument {
    path: PathBuf,
    logical_path: String,
    content: String,
    frontmatter: BTreeMap<String, YamlValue>,
    body: String,
}

#[derive(Debug, Clone, PartialEq)]
enum YamlValue {
    String(String),
    Number(f64),
    Bool(bool),
    Array(Vec<String>),
}

#[derive(Debug, Clone)]
struct RawTicket {
    document: ParsedDocument,
    ticket_id: String,
    title: String,
    parent_reference: String,
    board_id: String,
    group_id: Option<String>,
    state: TaskState,
    priority: TaskPriority,
    revision: u64,
    content: String,
    tags: Vec<String>,
    dependencies: Vec<String>,
    checklist: Vec<String>,
    start_date: String,
    end_date: String,
    dynamic_end_date: bool,
    dedicated_hours: f64,
    estimated_hours: f64,
    deviation_hours: f64,
    order: f64,
    context: Option<String>,
    related_documents: Vec<String>,
    related_tasks: Vec<String>,
    comments: Vec<TaskCommentDto>,
}

#[derive(Debug, Clone)]
struct LoadedWorkspace {
    workspace: Workspace,
    snapshot: TaskManagerLibrarySnapshotDto,
    documents: HashMap<String, ParsedDocument>,
    /// Display names by user id, for comment headings.
    user_names: Arc<HashMap<String, String>>,
}

#[derive(Debug, Clone)]
struct FileChange {
    path: PathBuf,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}

/// Real store used by the Tauri commands.  The mutex serializes all commits
/// for one library; reads still validate the binding on every operation.
pub(crate) struct MarkdownTaskManagerStore {
    library_id: String,
    registry: LibraryBindingRegistry,
    commit_lock: Arc<Mutex<()>>,
    /// Needed to reach SAF on Android; desktop stores work without it.
    app: Option<crate::host::AppHandle>,
    /// Library user names, read once per store: renames show up when the
    /// store is opened again.
    user_names: Mutex<Option<Arc<HashMap<String, String>>>>,
}

impl MarkdownTaskManagerStore {
    pub(crate) fn new(
        library_id: String,
        registry: LibraryBindingRegistry,
        commit_lock: Arc<Mutex<()>>,
    ) -> Self {
        Self {
            library_id,
            registry,
            commit_lock,
            app: None,
            user_names: Mutex::new(None),
        }
    }

    pub(crate) fn with_app(mut self, app: crate::host::AppHandle) -> Self {
        self.app = Some(app);
        self
    }

    /// Root path the store works under plus the storage backing it: the
    /// canonical desktop root, or a virtual root mapped onto the SAF tree.
    fn storage(&self) -> Result<(PathBuf, Rc<dyn TaskFileSystem>), BackendError> {
        let binding = self.registry.lookup(&self.library_id)?;
        match binding.root {
            Some(LibraryBindingRoot::Desktop { canonical_root }) => {
                Ok((canonical_root, task_fs::desktop()))
            }
            Some(LibraryBindingRoot::Android { tree_uri }) => {
                #[cfg(target_os = "android")]
                {
                    let app = self.app.clone().ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::ProviderUnavailable,
                            "El adaptador SAF de Task Manager no está disponible.",
                            true,
                        )
                    })?;
                    let file_system: Rc<dyn TaskFileSystem> = Rc::new(
                        task_fs::SafTaskFileSystem::new(app, tree_uri.as_str().to_string()),
                    );
                    Ok((PathBuf::from(task_fs::SAF_VIRTUAL_ROOT), file_system))
                }
                #[cfg(not(target_os = "android"))]
                {
                    let _ = tree_uri;
                    Err(BackendError::new(
                        BackendErrorCode::ProviderUnavailable,
                        "Las bibliotecas SAF solo están disponibles en Android.",
                        false,
                    ))
                }
            }
            None => Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La biblioteca fue revocada.",
                true,
            )),
        }
    }

    fn library_root(&self) -> Result<PathBuf, BackendError> {
        self.storage().map(|(root, _)| root)
    }

    /// Runs a store operation with the storage of the library binding.
    fn with_storage<R>(
        &self,
        operation: impl FnOnce() -> Result<R, BackendError>,
    ) -> Result<R, BackendError> {
        let (_, file_system) = self.storage()?;
        task_fs::scoped(file_system, operation)
    }

    fn pomodoro_path(&self) -> Result<PathBuf, BackendError> {
        let root = self.library_root()?;
        let workspace = resolve_workspace(&root)?.unwrap_or_else(|| default_workspace(root));
        Ok(workspace.root.join(POMODORO_LOG_FILE))
    }

    /// Entries of the Pomodoro log (`pomodoro.md`); empty when missing.
    pub(crate) fn pomodoro_entries(
        &self,
    ) -> Result<Vec<notia_backend_core::pomodoro_log::PomodoroEntryDto>, BackendError> {
        self.with_storage(|| {
            let path = self.pomodoro_path()?;
            Ok(task_fs::read_to_string(&path)
                .map(|content| notia_backend_core::pomodoro_log::read_pomodoro_entries(&content))
                .unwrap_or_default())
        })
    }

    /// Rewrites the Pomodoro log with `update`, guarded by the revision of
    /// the content it read and verified after writing. `Ok(false)` when
    /// `update` makes no change.
    pub(crate) fn update_pomodoro_log(
        &self,
        update: impl FnOnce(&str) -> Result<Option<String>, BackendError>,
    ) -> Result<bool, BackendError> {
        let _guard = self.commit_lock.lock().map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo bloquear el store de Task Manager.",
                true,
            )
        })?;
        self.with_storage(|| {
            let path = self.pomodoro_path()?;
            let current = task_fs::read(&path);
            let text = current
                .as_deref()
                .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
                .unwrap_or_default();
            if text.chars().count() > MAX_FILE_CHARS {
                return Err(BackendError::invalid_input(
                    "El registro Pomodoro supera el límite de tamaño.",
                ));
            }
            let Some(next) = update(&text)? else {
                return Ok(false);
            };
            let written = match current.as_deref() {
                Some(bytes) => task_fs::write_text(&path, &next, Some(&content_revision_bytes(bytes))),
                None => {
                    if let Some(parent) = path.parent() {
                        task_fs::create_dir_all(parent).map_err(|_| {
                            BackendError::new(
                                BackendErrorCode::Storage,
                                "No se pudo preparar el registro Pomodoro.",
                                true,
                            )
                        })?;
                    }
                    task_fs::create_text(&path, &next)
                }
            };
            if !written || task_fs::read(&path).as_deref() != Some(next.as_bytes()) {
                return Err(BackendError::new(
                    BackendErrorCode::Conflict,
                    "El registro Pomodoro cambió durante la escritura; reintentá.",
                    true,
                ));
            }
            Ok(true)
        })
    }

    fn ticket_file(&self, logical_path: &str) -> Result<PathBuf, BackendError> {
        let root = self.library_root()?;
        let workspace = resolve_workspace(&root)?.ok_or_else(|| {
            BackendError::new(BackendErrorCode::NotFound, "El workspace de Task Manager no existe.", false)
        })?;
        resolve_route_path(&workspace, logical_path)
    }

    /// Raw Markdown of a ticket file and its platform revision.
    pub(crate) fn read_ticket_source(&self, logical_path: &str) -> Result<(String, String), BackendError> {
        self.with_storage(|| {
            let path = self.ticket_file(logical_path)?;
            let bytes = task_fs::read(&path).ok_or_else(|| {
                BackendError::new(BackendErrorCode::NotFound, "La tarea ya no existe.", true)
            })?;
            let revision = content_revision_bytes(&bytes);
            Ok((String::from_utf8_lossy(&bytes).into_owned(), revision))
        })
    }

    /// Replaces a ticket file edited as raw Markdown. The write is guarded by
    /// the revision the editor read, keeps the ticket identity (`id`) and is
    /// verified by read-back; the next access reloads the snapshot from disk.
    pub(crate) fn write_ticket_source(
        &self,
        logical_path: &str,
        content: &str,
        expected_revision: &str,
    ) -> Result<String, BackendError> {
        if content.chars().count() > MAX_FILE_CHARS {
            return Err(BackendError::invalid_input("La tarea supera el límite de tamaño."));
        }
        let _guard = self.commit_lock.lock().map_err(|_| {
            BackendError::new(BackendErrorCode::Internal, "No se pudo bloquear el store de Task Manager.", true)
        })?;
        self.with_storage(|| {
            let path = self.ticket_file(logical_path)?;
            let current = task_fs::read(&path).ok_or_else(|| {
                BackendError::new(BackendErrorCode::NotFound, "La tarea ya no existe.", true)
            })?;
            if content_revision_bytes(&current) != expected_revision {
                return Err(BackendError::new(
                    BackendErrorCode::Conflict,
                    "La tarea cambió desde que se abrió el editor.",
                    true,
                ));
            }
            let (old_fields, _) = parse_frontmatter(&String::from_utf8_lossy(&current));
            let (new_fields, _) = parse_frontmatter(content);
            if let Some(old_id) = field_string(&old_fields, "id").filter(|id| !id.trim().is_empty()) {
                if field_string(&new_fields, "id").as_deref() != Some(old_id.as_str()) {
                    return Err(BackendError::invalid_input(
                        "El campo id de la tarea no se puede modificar.",
                    ));
                }
            }
            if !task_fs::write_text(&path, content, Some(expected_revision))
                || task_fs::read(&path).as_deref() != Some(content.as_bytes())
            {
                return Err(BackendError::new(
                    BackendErrorCode::Storage,
                    "No se pudo guardar la tarea.",
                    true,
                ));
            }
            Ok(content_revision_bytes(content.as_bytes()))
        })
    }

    /// Hash of path, size and modification time of every Markdown file in
    /// the desktop workspace. SAF exposes no cheap metadata: `None` there.
    fn desktop_change_token(&self) -> Result<Option<String>, BackendError> {
        let binding = self.registry.lookup(&self.library_id)?;
        let Some(LibraryBindingRoot::Desktop { canonical_root }) = binding.root else {
            return Ok(None);
        };
        let Some(workspace) = resolve_workspace(&canonical_root)? else {
            return Ok(Some("empty".to_string()));
        };
        let mut paths = Vec::new();
        collect_markdown_paths(&workspace.root, &mut paths)?;
        paths.push(workspace.root.join(SHARED_METADATA_FILE));
        paths.sort();
        let mut hasher = Sha256::new();
        for path in paths {
            hasher.update(path.to_string_lossy().as_bytes());
            if let Ok(metadata) = std::fs::metadata(&path) {
                hasher.update(metadata.len().to_le_bytes());
                if let Ok(modified) = metadata.modified() {
                    if let Ok(elapsed) = modified.duration_since(std::time::UNIX_EPOCH) {
                        hasher.update(elapsed.as_nanos().to_le_bytes());
                    }
                }
            }
        }
        Ok(Some(format!("{:x}", hasher.finalize())))
    }

    fn user_names(&self) -> Arc<HashMap<String, String>> {
        let Ok(mut cached) = self.user_names.lock() else {
            return Arc::default();
        };
        if let Some(names) = cached.as_ref() {
            return names.clone();
        }
        let Some(app) = self.app.as_ref() else {
            return Arc::default();
        };
        let names = Arc::new(crate::library_users::library_user_names(
            app,
            &self.registry,
            &self.library_id,
        ));
        *cached = Some(names.clone());
        names
    }

    fn load_workspace(&self) -> Result<Option<LoadedWorkspace>, BackendError> {
        let root = self.library_root()?;
        let Some(workspace) = resolve_workspace(&root)? else {
            return Ok(None);
        };
        let files = read_bounded_markdown_files(&workspace)?;
        let mut documents = HashMap::new();
        for document in files {
            documents.insert(document.logical_path.clone(), document);
        }
        let user_names = self.user_names();
        let snapshot = hydrate_snapshot(&self.library_id, &workspace, &documents, &user_names)?;
        Ok(Some(LoadedWorkspace {
            workspace,
            snapshot,
            documents,
            user_names,
        }))
    }

    fn commit_markdown(
        &self,
        request: &TaskManagerStoreCommit,
    ) -> Result<Vec<TaskDocumentRouteDto>, BackendError> {
        validate_commit_identity(&self.library_id, request)?;
        TaskManagerSnapshotDto {
            version: notia_backend_core::TASK_MANAGER_SNAPSHOT_VERSION,
            libraries: vec![request.snapshot.clone()],
        }
        .validate()?;
        if request.routes.len() > MAX_FILES || request.revisions.len() > MAX_FILES {
            return Err(BackendError::invalid_input(
                "El commit de Task Manager supera el límite de entidades.",
            ));
        }

        let _guard = self.commit_lock.lock().map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo bloquear el store de Task Manager.",
                true,
            )
        })?;
        let loaded = self.load_workspace()?;
        validate_generation(
            loaded.as_ref().map(|value| &value.snapshot),
            &request.snapshot,
        )?;
        validate_requested_revisions(
            loaded.as_ref().map(|value| &value.snapshot),
            &request.revisions,
        )?;

        let root = self.library_root()?;
        let loaded = loaded.unwrap_or_else(|| LoadedWorkspace {
            workspace: default_workspace(root.clone()),
            snapshot: empty_snapshot(&self.library_id),
            documents: HashMap::new(),
            user_names: self.user_names(),
        });
        let workspace = loaded.workspace.clone();
        ensure_workspace_directories(&workspace)?;
        let (changes, committed) = build_file_changes(&loaded, request)?;
        apply_file_changes(&changes)?;
        verify_file_changes(&changes)?;
        Ok(committed_routes(&committed))
    }
}

impl TaskManagerSnapshotStore for MarkdownTaskManagerStore {
    fn load(
        &self,
        library_id: &str,
    ) -> Result<Option<TaskManagerLibrarySnapshotDto>, BackendError> {
        if library_id != self.library_id {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "El store no pertenece a la biblioteca solicitada.",
                false,
            ));
        }
        self.with_storage(|| {
            self.load_workspace()
                .map(|loaded| loaded.map(|value| value.snapshot))
        })
    }

    fn commit(
        &self,
        request: &TaskManagerStoreCommit,
    ) -> Result<Vec<TaskDocumentRouteDto>, BackendError> {
        self.with_storage(|| self.commit_markdown(request))
    }

    fn change_token(&self, library_id: &str) -> Result<Option<String>, BackendError> {
        if library_id != self.library_id {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "El store no pertenece a la biblioteca solicitada.",
                false,
            ));
        }
        self.desktop_change_token()
    }
}

fn resolve_workspace(library_root: &Path) -> Result<Option<Workspace>, BackendError> {
    let candidates = [
        library_root.join(MODERN_ROOT),
        library_root.join(PRIMARY_ROOT),
        library_root.to_path_buf(),
    ];
    for root in candidates {
        if !task_fs::is_dir(&root) {
            continue;
        }
        let name = root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        let modern_layout =
            name.eq_ignore_ascii_case(MODERN_ROOT) && task_fs::is_dir(&root.join(MODERN_ACTIVE));
        let finished_name = if task_fs::is_dir(&root.join(FINISHED)) || !task_fs::is_dir(&root.join(LEGACY_FINISHED))
        {
            FINISHED
        } else {
            LEGACY_FINISHED
        };
        let active = if modern_layout {
            root.join(MODERN_ACTIVE)
        } else {
            root.clone()
        };
        let is_task_root = name.eq_ignore_ascii_case(PRIMARY_ROOT)
            || name.eq_ignore_ascii_case(MODERN_ROOT)
            || task_fs::is_dir(&root.join(FINISHED))
            || task_fs::is_dir(&root.join(LEGACY_FINISHED))
            || task_fs::is_dir(&root.join(CANCELLED));
        if !is_task_root && root != library_root {
            continue;
        }
        if root == library_root
            && !name.eq_ignore_ascii_case(PRIMARY_ROOT)
            && !name.eq_ignore_ascii_case(MODERN_ROOT)
        {
            return Ok(None);
        }
        return Ok(Some(Workspace {
            library_root: library_root.to_path_buf(),
            root: root.clone(),
            active,
            finished: root.join(finished_name),
            cancelled: root.join(CANCELLED),
        }));
    }
    Ok(None)
}

fn default_workspace(library_root: PathBuf) -> Workspace {
    let root = library_root.join(MODERN_ROOT);
    Workspace {
        library_root,
        active: root.join(MODERN_ACTIVE),
        finished: root.join(FINISHED),
        cancelled: root.join(CANCELLED),
        root,
    }
}

fn ensure_workspace_directories(workspace: &Workspace) -> Result<(), BackendError> {
    for directory in [
        &workspace.root,
        &workspace.active,
        &workspace.finished,
        &workspace.cancelled,
        &workspace.finished.join(SUBTASKS),
        &workspace.cancelled.join(SUBTASKS),
    ] {
        task_fs::create_dir_all(directory).map_err(|_| {
            BackendError::new(
                BackendErrorCode::Storage,
                "No se pudo preparar el workspace de Task Manager.",
                true,
            )
        })?;
    }
    Ok(())
}

fn read_bounded_markdown_files(workspace: &Workspace) -> Result<Vec<ParsedDocument>, BackendError> {
    let mut paths = Vec::new();
    for directory in [
        &workspace.root,
        &workspace.active,
        &workspace.finished,
        &workspace.cancelled,
    ] {
        collect_markdown_paths(directory, &mut paths)?;
    }
    paths.sort();
    paths.dedup();
    if paths.len() > MAX_FILES {
        return Err(BackendError::invalid_input(
            "El workspace de Task Manager supera el límite de archivos.",
        ));
    }
    let mut total_chars = 0usize;
    let mut documents = Vec::with_capacity(paths.len());
    for path in paths {
        let content = task_fs::read_to_string(&path).ok_or_else(|| {
            BackendError::new(
                BackendErrorCode::Storage,
                "No se pudo leer un archivo Markdown de Task Manager.",
                true,
            )
        })?;
        let chars = content.chars().count();
        if chars > MAX_FILE_CHARS || total_chars.saturating_add(chars) > MAX_TOTAL_CHARS {
            return Err(BackendError::invalid_input(
                "El workspace de Task Manager supera el límite de lectura.",
            ));
        }
        total_chars = total_chars.saturating_add(chars);
        let logical_path = logical_path(&workspace.library_root, &path)?;
        let (frontmatter, body) = parse_frontmatter(&content);
        documents.push(ParsedDocument {
            path,
            logical_path,
            content,
            frontmatter,
            body,
        });
    }
    Ok(documents)
}

fn collect_markdown_paths(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), BackendError> {
    if !task_fs::is_dir(directory) {
        return Ok(());
    }
    let entries = task_fs::list_dir(directory).map_err(|_| {
        BackendError::new(
            BackendErrorCode::Storage,
            "No se pudo enumerar el workspace de Task Manager.",
            true,
        )
    })?;
    for (path, kind) in entries {
        match kind {
            task_fs::EntryKind::Directory => collect_markdown_paths(&path, output)?,
            task_fs::EntryKind::File
                if path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md")) =>
            {
                output.push(path)
            }
            _ => {}
        }
        if output.len() > MAX_FILES {
            return Err(BackendError::invalid_input(
                "El workspace de Task Manager supera el límite de archivos.",
            ));
        }
    }
    Ok(())
}

fn is_reserved_document(path: &Path) -> bool {
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    lower == "pomodoro"
        || lower == "taskindex"
        || lower == "taskindexfinished"
        || lower == "taskindexcancelled"
        || lower.ends_with("taskindex")
}

fn hydrate_snapshot(
    library_id: &str,
    workspace: &Workspace,
    documents: &HashMap<String, ParsedDocument>,
    user_names: &HashMap<String, String>,
) -> Result<TaskManagerLibrarySnapshotDto, BackendError> {
    let mut raw_tickets = Vec::new();
    let mut ticket_ids = HashSet::new();
    // Sorted so that duplicate ids are resolved the same way on every load.
    let mut ordered = documents.values().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.logical_path.cmp(&right.logical_path));
    for document in ordered {
        if !is_ticket_document(&document.path, workspace) {
            continue;
        }
        let Some(title_value) = field_string(&document.frontmatter, "tarea") else {
            continue;
        };
        let title = if title_value.trim().is_empty() {
            basename(&document.path)
        } else {
            title_value.trim().to_string()
        };
        let mut ticket_id = field_string(&document.frontmatter, "id")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| deterministic_id("ticket", &document.logical_path));
        if !ticket_ids.insert(ticket_id.clone()) {
            // A copied task file keeps the original id; the copy gets an id
            // derived from its own path instead of hiding the workspace.
            ticket_id = deterministic_id("ticket", &document.logical_path);
            if !ticket_ids.insert(ticket_id.clone()) {
                continue;
            }
            log::warn!("[notia:task-manager] un ticket con id duplicado recibió un id derivado de su ruta");
        }
        let board_id = field_string(&document.frontmatter, "tablero")
            .filter(|value| !value.trim().is_empty())
            .map(|value| normalize_name(&value))
            .unwrap_or_else(|| board_from_path(&document.path, workspace));
        let group_id = field_string(&document.frontmatter, "equipo")
            .filter(|value| !value.trim().is_empty())
            .map(|value| normalize_name(&value));
        let state = parse_state(field_string(&document.frontmatter, "estado").as_deref());
        let priority = parse_priority(field_string(&document.frontmatter, "prioridad").as_deref());
        let (content, comments) = split_comments(
            &document.body,
            library_id,
            &ticket_id,
            &document.logical_path,
            user_names,
        )?;
        let raw = RawTicket {
            revision: field_u64(&document.frontmatter, "revision")
                .unwrap_or_else(|| stable_revision("ticket", &document.content)),
            parent_reference: normalize_parent_reference(
                field_string(&document.frontmatter, "parent")
                    .as_deref()
                    .unwrap_or_default(),
            ),
            ticket_id,
            title,
            board_id,
            group_id,
            state,
            priority,
            content: if content.trim().is_empty() {
                field_string(&document.frontmatter, "detalle").unwrap_or_default()
            } else {
                content
            },
            tags: field_strings(&document.frontmatter, "tags"),
            dependencies: field_strings(&document.frontmatter, "dependencies"),
            checklist: field_strings(&document.frontmatter, "checklist"),
            start_date: frontmatter_string(
                &document.frontmatter,
                "fechaInicio",
                MAX_TASK_DATE_CHARS,
            ),
            end_date: frontmatter_string(&document.frontmatter, "fechaFin", MAX_TASK_DATE_CHARS),
            dynamic_end_date: frontmatter_bool(&document.frontmatter, "fechaFinDinamica", true),
            dedicated_hours: frontmatter_number(
                &document.frontmatter,
                "dedicado",
                0.0,
                MAX_TASK_HOURS,
            ),
            estimated_hours: frontmatter_number(
                &document.frontmatter,
                "estimacion",
                0.0,
                MAX_TASK_HOURS,
            ),
            deviation_hours: frontmatter_number(
                &document.frontmatter,
                "desvio",
                0.0,
                MAX_TASK_HOURS,
            ),
            order: frontmatter_number(&document.frontmatter, "order", 999_999.0, MAX_TASK_ORDER),
            context: field_string(&document.frontmatter, "contexto")
                .filter(|value| !value.trim().is_empty()),
            related_documents: frontmatter_references(&document.frontmatter, "relatedDocuments"),
            related_tasks: frontmatter_references(&document.frontmatter, "relatedTasks"),
            comments,
            document: document.clone(),
        };
        raw_tickets.push(raw);
    }
    if raw_tickets.len() > MAX_TASK_TICKETS {
        return Err(BackendError::invalid_input(
            "La biblioteca supera el límite de tickets.",
        ));
    }

    let mut by_name = HashMap::new();
    for ticket in &raw_tickets {
        by_name.insert(ticket.title.to_ascii_lowercase(), ticket.ticket_id.clone());
        by_name.insert(
            basename(&ticket.document.path).to_ascii_lowercase(),
            ticket.ticket_id.clone(),
        );
    }
    let metadata = read_board_metadata(workspace, documents)?;
    let mut tickets = Vec::with_capacity(raw_tickets.len());
    let mut comments = Vec::new();
    for raw in raw_tickets {
        let parent_ticket_id = if raw.parent_reference.is_empty() {
            None
        } else {
            by_name
                .get(&raw.parent_reference.to_ascii_lowercase())
                .cloned()
        };
        tickets.push(TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: library_id.to_string(),
                ticket_id: raw.ticket_id.clone(),
                board_id: raw.board_id.clone(),
                group_id: resolve_group_reference(
                    &metadata,
                    &raw.board_id,
                    raw.group_id.as_deref(),
                ),
                title: raw.title.clone(),
                state: raw.state,
                priority: raw.priority,
                parent_ticket_id,
                detail_preview: notia_backend_core::ticket_detail_preview(&raw.content, &raw.comments),
                revision: raw.revision,
                logical_path: raw.document.logical_path.clone(),
            },
            content: raw.content,
            tags: raw.tags,
            dependencies: raw.dependencies,
            checklist: raw.checklist,
            start_date: raw.start_date,
            end_date: raw.end_date,
            dynamic_end_date: raw.dynamic_end_date,
            dedicated_hours: raw.dedicated_hours,
            estimated_hours: raw.estimated_hours,
            deviation_hours: raw.deviation_hours,
            order: raw.order,
            context: raw.context,
            related_documents: raw.related_documents,
            related_tasks: raw.related_tasks,
        });
        comments.extend(raw.comments);
    }
    detach_invalid_parents(&mut tickets);
    validate_parent_relationships(&tickets)?;
    if comments.len() > MAX_TASK_TICKETS.saturating_mul(MAX_TASK_COMMENTS) {
        return Err(BackendError::invalid_input(
            "La biblioteca supera el límite de comentarios.",
        ));
    }

    let ticket_boards = tickets.iter().map(|ticket| ticket.summary.board_id.clone());
    let mut board_names = BTreeSet::from(["default".to_string()]);
    board_names.extend(ticket_boards);
    board_names.extend(metadata.keys().cloned());
    let mut boards = Vec::new();
    let mut groups = Vec::new();
    let mut activity_hours_per_day = BTreeMap::new();
    for board_id in board_names {
        let value = metadata.get(&board_id);
        let board_revision = value
            .map(|item| item.revision)
            .unwrap_or_else(|| stable_revision("board", &board_id));
        let color = value
            .map(|item| item.color.clone())
            .unwrap_or_else(|| "#2e6db0".to_string());
        let context = value.and_then(|item| item.context.clone());
        let activity = value.map(|item| item.activity_hours).unwrap_or(24.0);
        boards.push(TaskBoardDto {
            library_id: library_id.to_string(),
            board_id: board_id.clone(),
            name: board_id.clone(),
            color,
            context,
            revision: board_revision,
        });
        activity_hours_per_day.insert(board_id.clone(), activity);
        if let Some(value) = value {
            for group in &value.groups {
                groups.push(TaskGroupDto {
                    library_id: library_id.to_string(),
                    group_id: group.id.clone(),
                    board_id: board_id.clone(),
                    name: group.name.clone(),
                    color: group.color.clone(),
                    revision: group.revision,
                    order: group.order,
                });
            }
        }
    }
    boards.sort_by(|left, right| left.board_id.cmp(&right.board_id));
    groups.sort_by(|left, right| {
        left.board_id
            .cmp(&right.board_id)
            .then_with(|| left.order.cmp(&right.order))
            .then_with(|| left.group_id.cmp(&right.group_id))
    });
    tickets.sort_by(|left, right| left.summary.ticket_id.cmp(&right.summary.ticket_id));
    comments.sort_by(|left, right| {
        left.ticket_id
            .cmp(&right.ticket_id)
            .then_with(|| left.comment_id.cmp(&right.comment_id))
    });
    let generation = read_generation(workspace, documents).unwrap_or(1);
    // Comment authors must be known users of the snapshot.
    let users = comments
        .iter()
        .map(|comment| comment.author_user_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(TaskManagerLibrarySnapshotDto {
        library_id: library_id.to_string(),
        users,
        boards,
        groups,
        tickets,
        comments,
        generation,
        config: TaskManagerConfigDto {
            activity_hours_per_day,
        },
    })
}

#[derive(Debug, Clone)]
struct BoardMetadata {
    color: String,
    context: Option<String>,
    activity_hours: f64,
    revision: u64,
    groups: Vec<GroupMetadata>,
}

#[derive(Debug, Clone)]
struct GroupMetadata {
    id: String,
    name: String,
    color: String,
    revision: u64,
    order: u32,
}

fn read_board_metadata(
    workspace: &Workspace,
    documents: &HashMap<String, ParsedDocument>,
) -> Result<BTreeMap<String, BoardMetadata>, BackendError> {
    let mut result = BTreeMap::new();
    for board in board_names_from_documents(workspace, documents) {
        let path = board_index_path(workspace, &board);
        let logical = logical_path(&workspace.library_root, &path)?;
        let Some(document) = documents.get(&logical) else {
            result.insert(board, default_board_metadata());
            continue;
        };
        let mut groups = Vec::new();
        for (order, encoded) in field_strings(&document.frontmatter, "groups")
            .into_iter()
            .enumerate()
        {
            let parts = encoded.split('|').collect::<Vec<_>>();
            let name = parts.first().map(|value| value.trim()).unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let color = parts.get(1).copied().unwrap_or("#2e6db0");
            let revision = parts
                .get(2)
                .and_then(|value| value.parse().ok())
                .unwrap_or_else(|| stable_revision("group", &format!("{board}:{name}")));
            let id = parts
                .get(3)
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string())
                .unwrap_or_else(|| deterministic_id("group", &format!("{board}:{name}")));
            groups.push(GroupMetadata {
                id,
                name: name.to_string(),
                color: color.to_string(),
                revision,
                order: order as u32,
            });
        }
        result.insert(
            board.clone(),
            BoardMetadata {
                color: field_string(&document.frontmatter, "color")
                    .unwrap_or_else(|| "#2e6db0".to_string()),
                context: field_string(&document.frontmatter, "contexto"),
                activity_hours: field_number(&document.frontmatter, "activityHoursPerDay")
                    .unwrap_or(24.0)
                    .clamp(0.0, 24.0),
                revision: field_u64(&document.frontmatter, "revision")
                    .unwrap_or_else(|| stable_revision("board", &board)),
                groups,
            },
        );
    }
    if let Some(content) = task_fs::read(&workspace.root.join(SHARED_METADATA_FILE)) {
        if content.len() <= MAX_SHARED_METADATA_BYTES {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&content) {
                merge_shared_metadata(&mut result, &value);
            }
        }
    }
    Ok(result)
}

fn merge_shared_metadata(
    metadata: &mut BTreeMap<String, BoardMetadata>,
    value: &serde_json::Value,
) {
    if let Some(boards) = value.get("boards").and_then(serde_json::Value::as_array) {
        for board in boards {
            let Some(name) = board.get("name").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let board_id = normalize_name(name);
            if board_id.is_empty() {
                continue;
            }
            let entry = metadata
                .entry(board_id.clone())
                .or_insert_with(default_board_metadata);
            if let Some(color) = board.get("color").and_then(serde_json::Value::as_str) {
                entry.color = color.to_string();
            }
            if let Some(activity) = board
                .get("activityHoursPerDay")
                .and_then(serde_json::Value::as_f64)
            {
                entry.activity_hours = activity.clamp(0.0, 24.0);
            }
        }
    }
    let Some(groups) = value.get("groups").and_then(serde_json::Value::as_array) else {
        return;
    };
    for group in groups {
        let Some(name) = group
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        else {
            continue;
        };
        let board_id = group
            .get("board")
            .and_then(serde_json::Value::as_str)
            .map(normalize_name)
            .filter(|board| !board.is_empty())
            .unwrap_or_else(|| "default".to_string());
        let entry = metadata
            .entry(board_id.clone())
            .or_insert_with(default_board_metadata);
        if entry
            .groups
            .iter()
            .any(|candidate| normalize_name(&candidate.name) == normalize_name(name))
        {
            continue;
        }
        let color = group
            .get("color")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("#2e6db0");
        let order = entry.groups.len() as u32;
        entry.groups.push(GroupMetadata {
            id: deterministic_id("group", &format!("{board_id}:{name}")),
            name: name.to_string(),
            color: color.to_string(),
            revision: stable_revision("group", &format!("{board_id}:{name}")),
            order,
        });
    }
}

fn resolve_group_reference(
    metadata: &BTreeMap<String, BoardMetadata>,
    board_id: &str,
    reference: Option<&str>,
) -> Option<String> {
    let reference = reference?.trim();
    let board = metadata.get(board_id)?;
    board
        .groups
        .iter()
        .find(|group| {
            group.id == reference
                || normalize_name(&group.id) == normalize_name(reference)
                || normalize_name(&group.name) == normalize_name(reference)
        })
        .map(|group| group.id.clone())
}

fn default_board_metadata() -> BoardMetadata {
    BoardMetadata {
        color: "#2e6db0".to_string(),
        context: Some("#Personal".to_string()),
        activity_hours: 24.0,
        revision: 1,
        groups: Vec::new(),
    }
}

fn board_names_from_documents(
    workspace: &Workspace,
    documents: &HashMap<String, ParsedDocument>,
) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for document in documents.values() {
        let stem = document
            .path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if stem.to_ascii_lowercase().ends_with("taskindex") && stem.len() > "taskindex".len() {
            names.insert(normalize_name(&stem[..stem.len() - "taskindex".len()]));
            continue;
        }
        if !is_ticket_document(&document.path, workspace) {
            continue;
        }
        if let Some(board) = field_string(&document.frontmatter, "tablero") {
            if !board.trim().is_empty() {
                names.insert(normalize_name(&board));
            }
        } else {
            names.insert(board_from_path(&document.path, workspace));
        }
    }
    names
}

fn board_index_path(workspace: &Workspace, board: &str) -> PathBuf {
    // Board names come from hand-editable frontmatter: a separator or drive
    // prefix must not turn the index into a path outside the workspace.
    workspace
        .active
        .join(format!("{}TaskIndex.md", safe_filename(board)))
}

fn read_generation(
    workspace: &Workspace,
    documents: &HashMap<String, ParsedDocument>,
) -> Option<u64> {
    let path = workspace.root.join("taskIndex.md");
    logical_path(&workspace.library_root, &path)
        .ok()
        .and_then(|logical| documents.get(&logical))
        .and_then(|document| field_u64(&document.frontmatter, "generation"))
}

fn is_ticket_document(path: &Path, workspace: &Workspace) -> bool {
    if is_reserved_document(path) {
        return false;
    }
    let in_active = path.starts_with(&workspace.active);
    let in_finished = path.starts_with(&workspace.finished);
    let in_cancelled = path.starts_with(&workspace.cancelled);
    (in_active || in_finished || in_cancelled)
        && path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("md"))
}

fn board_from_path(path: &Path, workspace: &Workspace) -> String {
    let base = if path.starts_with(&workspace.active) {
        &workspace.active
    } else if path.starts_with(&workspace.finished) {
        &workspace.finished
    } else {
        &workspace.cancelled
    };
    path.strip_prefix(base)
        .ok()
        .and_then(|relative| relative.components().next())
        .and_then(|component| component.as_os_str().to_str())
        .filter(|name| !name.eq_ignore_ascii_case(SUBTASKS))
        .map(normalize_name)
        .unwrap_or_else(|| "default".to_string())
}

const COMMENT_HEADING: &str = "## Comentario - ";
const COMMENT_TIME_FORMAT: &str = "%d/%m/%Y %H:%M";
const OWNER_USER_ID: &str = "user-owner";

/// Heading of a comment as people read it in the ticket:
/// `## Comentario - DD/MM/YYYY HH:MM - Autor`, in local time.
fn comment_heading(comment: &TaskCommentDto, user_names: &HashMap<String, String>) -> String {
    let time = chrono::Local
        .timestamp_millis_opt(comment.created_at_unix_ms)
        .single()
        .map(|value| value.format(COMMENT_TIME_FORMAT).to_string())
        .unwrap_or_else(|| format_iso_timestamp(comment.created_at_unix_ms));
    let author = user_names
        .get(&comment.author_user_id)
        .unwrap_or(&comment.author_user_id);
    let author = author.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("{COMMENT_HEADING}{time} - {author}")
}

/// Time and author of a `DD/MM/YYYY HH:MM[ - Autor]` heading; `None` when the
/// heading is not a comment written by Notia.
fn parse_comment_heading(
    heading: &str,
    user_names: &HashMap<String, String>,
) -> Option<(i64, String)> {
    let time = heading.get(..16)?;
    let created_at = chrono::NaiveDateTime::parse_from_str(time, COMMENT_TIME_FORMAT)
        .ok()
        .and_then(|value| chrono::Local.from_local_datetime(&value).earliest())?
        .timestamp_millis();
    let rest = heading[16..].trim();
    let author = match rest.strip_prefix('-').map(str::trim) {
        None if rest.is_empty() => OWNER_USER_ID.to_string(),
        None => return None,
        Some(name) => user_names
            .iter()
            .find(|(id, display)| display.eq_ignore_ascii_case(name) || id.as_str() == name)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| OWNER_USER_ID.to_string()),
    };
    Some((created_at, author))
}

fn split_comments(
    body: &str,
    library_id: &str,
    ticket_id: &str,
    logical_path: &str,
    user_names: &HashMap<String, String>,
) -> Result<(String, Vec<TaskCommentDto>), BackendError> {
    let mut base_lines = Vec::new();
    let mut comments = Vec::new();
    let lines = body.lines().collect::<Vec<_>>();
    let mut index = 0;
    let mut ordinal = 0usize;
    while index < lines.len() {
        let Some(heading) = lines[index].strip_prefix(COMMENT_HEADING).map(str::trim) else {
            base_lines.push(lines[index]);
            index += 1;
            continue;
        };
        let start = index;
        index += 1;
        // Comments written by earlier versions carry a metadata block.
        let mut metadata = BTreeMap::new();
        let mut has_metadata_block = false;
        if lines.get(index).map(|line| line.trim()) == Some("---") {
            let mut metadata_lines = Vec::new();
            let mut cursor = index + 1;
            while cursor < lines.len() && lines[cursor].trim() != "---" {
                metadata_lines.push(lines[cursor]);
                cursor += 1;
            }
            if cursor >= lines.len() {
                base_lines.extend(&lines[start..]);
                break;
            }
            metadata = parse_yaml_lines(&metadata_lines);
            has_metadata_block = true;
            index = cursor + 1;
        }
        let parsed_heading = parse_comment_heading(heading, user_names);
        // The block marks a legacy comment even when it carries no fields; a
        // plain heading with neither block nor author/date is ticket text.
        if !has_metadata_block && parsed_heading.is_none() {
            base_lines.push(lines[start]);
            continue;
        }
        let body_start = index;
        while index < lines.len() && !lines[index].starts_with(COMMENT_HEADING) {
            index += 1;
        }
        let comment_body = lines[body_start..index].join("\n").trim().to_string();
        let seed = format!("{ticket_id}:{ordinal}:{heading}:{comment_body}");
        let comment_id = field_string(&metadata, "id")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| deterministic_id("comment", &seed));
        let author = field_string(&metadata, "author")
            .or_else(|| parsed_heading.as_ref().map(|(_, author)| author.clone()))
            .unwrap_or_else(|| OWNER_USER_ID.to_string());
        let created_at = field_string(&metadata, "created_at")
            .and_then(|value| parse_timestamp_millis(&value))
            .or_else(|| parsed_heading.as_ref().map(|(time, _)| *time))
            .unwrap_or_else(|| stable_revision("comment-time", &seed) as i64);
        let revision =
            field_u64(&metadata, "revision").unwrap_or_else(|| stable_revision("comment", &seed));
        comments.push(TaskCommentDto {
            library_id: library_id.to_string(),
            comment_id,
            ticket_id: ticket_id.to_string(),
            author_user_id: author,
            body: comment_body,
            created_at_unix_ms: created_at,
            revision,
            logical_path: logical_path.to_string(),
        });
        ordinal += 1;
    }
    Ok((base_lines.join("\n").trim().to_string(), comments))
}

/// Where the commit wrote each ticket, and each comment, which lives in the
/// file of its ticket.
fn committed_routes(snapshot: &TaskManagerLibrarySnapshotDto) -> Vec<TaskDocumentRouteDto> {
    let ticket_paths = snapshot
        .tickets
        .iter()
        .map(|ticket| (ticket.summary.ticket_id.as_str(), ticket.summary.logical_path.as_str()))
        .collect::<HashMap<_, _>>();
    let tickets = snapshot.tickets.iter().map(|ticket| TaskDocumentRouteDto {
        entity_type: "ticket".to_string(),
        entity_id: ticket.summary.ticket_id.clone(),
        logical_path: ticket.summary.logical_path.clone(),
    });
    let comments = snapshot.comments.iter().filter_map(|comment| {
        ticket_paths.get(comment.ticket_id.as_str()).map(|path| TaskDocumentRouteDto {
            entity_type: "comment".to_string(),
            entity_id: comment.comment_id.clone(),
            logical_path: (*path).to_string(),
        })
    });
    tickets.chain(comments).collect()
}

/// The file changes of a commit and the snapshot with the path of every
/// ticket as written.
fn build_file_changes(
    loaded: &LoadedWorkspace,
    request: &TaskManagerStoreCommit,
) -> Result<(Vec<FileChange>, TaskManagerLibrarySnapshotDto), BackendError> {
    let before = &loaded.snapshot;
    let after = &request.snapshot;
    validate_snapshot_relationships(after)?;
    let old_by_id = before
        .tickets
        .iter()
        .map(|ticket| (&ticket.summary.ticket_id, ticket))
        .collect::<HashMap<_, _>>();
    let next_by_id = after
        .tickets
        .iter()
        .map(|ticket| (&ticket.summary.ticket_id, ticket))
        .collect::<HashMap<_, _>>();
    let routes = route_map(&request.routes)?;
    let mut changes = Vec::new();
    let mut affected_paths = BTreeSet::new();
    let mut effective_snapshot = after.clone();

    for old in before
        .tickets
        .iter()
        .filter(|ticket| !next_by_id.contains_key(&ticket.summary.ticket_id))
    {
        let path = resolve_route_path(&loaded.workspace, &old.summary.logical_path)?;
        add_change(&mut changes, &path, None)?;
        affected_paths.insert(path);
    }

    for next in &after.tickets {
        let old = old_by_id.get(&next.summary.ticket_id).copied();
        let old_path = old.and_then(|ticket| {
            resolve_route_path(&loaded.workspace, &ticket.summary.logical_path).ok()
        });
        let route = routes
            .get(&next.summary.ticket_id)
            .cloned()
            .filter(|value| !value.is_empty());
        let state_changed = old.is_none_or(|ticket| ticket.summary.state != next.summary.state);
        let path = choose_ticket_path(
            &loaded.workspace,
            next,
            old_path.as_deref(),
            route.as_deref(),
            state_changed,
        )?;
        let moved = old_path.as_deref().is_some_and(|old_path| old_path != path);
        // A new or moved ticket never takes over an existing file.
        let path = if moved || old_path.is_none() {
            available_ticket_path(path, &changes)
        } else {
            path
        };
        let existing = old_path.as_ref().and_then(|path| task_fs::read(path));
        let old_content = old_path.as_ref().and_then(|path| {
            logical_path(&loaded.workspace.library_root, path)
                .ok()
                .and_then(|logical| loaded.documents.get(&logical))
        });
        let content = render_ticket(next, after, old_content, &path, &loaded.user_names)?;
        if let Some(indexed) = effective_snapshot
            .tickets
            .iter_mut()
            .find(|ticket| ticket.summary.ticket_id == next.summary.ticket_id)
        {
            indexed.summary.logical_path = logical_path(&loaded.workspace.library_root, &path)?;
        }
        if moved {
            // The destination is a different file: its current content (none,
            // see `available_ticket_path`) is what the commit must find there.
            add_change(&mut changes, &path, Some(content.into_bytes()))?;
        } else if existing.as_deref() != Some(content.as_bytes()) {
            add_change_with_before(&mut changes, &path, existing, Some(content.into_bytes()))?;
        }
        if let Some(old_path) = old_path {
            if moved {
                add_change(&mut changes, &old_path, None)?;
                affected_paths.insert(old_path);
            }
        }
        affected_paths.insert(path);
    }

    let boards = after
        .boards
        .iter()
        .map(|board| board.board_id.clone())
        .collect::<BTreeSet<_>>();
    let old_boards = before
        .boards
        .iter()
        .map(|board| board.board_id.clone())
        .collect::<BTreeSet<_>>();
    for board in boards.union(&old_boards) {
        if board_is_affected(board, before, after, &affected_paths, &loaded.workspace)
            || boards != old_boards
        {
            let path = board_index_path(&loaded.workspace, board);
            let content = render_board_index(&loaded.workspace, &effective_snapshot, board);
            let existing = task_fs::read(&path);
            if existing.as_deref() != Some(content.as_bytes()) {
                add_change_with_before(&mut changes, &path, existing, Some(content.into_bytes()))?;
            }
        }
    }
    let root_index = loaded.workspace.root.join("taskIndex.md");
    let root_content = render_root_index(&loaded.workspace, &effective_snapshot);
    if task_fs::read(&root_index).as_deref() != Some(root_content.as_bytes()) {
        add_change_with_before(
            &mut changes,
            &root_index,
            task_fs::read(&root_index),
            Some(root_content.into_bytes()),
        )?;
    }
    for (folder, basename) in [
        (&loaded.workspace.finished, "taskIndexFinished.md"),
        (&loaded.workspace.cancelled, "taskIndexCancelled.md"),
    ] {
        let path = folder.join(basename);
        let content = render_archive_index(
            folder == &loaded.workspace.finished,
            &effective_snapshot,
            &loaded.workspace,
        );
        if task_fs::read(&path).as_deref() != Some(content.as_bytes()) {
            add_change_with_before(
                &mut changes,
                &path,
                task_fs::read(&path),
                Some(content.into_bytes()),
            )?;
        }
    }
    // Board and group settings are derived from the committed snapshot so the
    // shared metadata can never resurrect a deleted board or group.
    let metadata_path = loaded.workspace.root.join(SHARED_METADATA_FILE);
    let metadata = render_shared_metadata(&effective_snapshot)?;
    let existing_metadata = task_fs::read(&metadata_path);
    if existing_metadata.as_deref() != Some(metadata.as_bytes()) {
        add_change_with_before(
            &mut changes,
            &metadata_path,
            existing_metadata,
            Some(metadata.into_bytes()),
        )?;
    }
    Ok((deduplicate_changes(changes), effective_snapshot))
}

/// `.notia-task-manager.json` (version 1): boards with color, context and
/// activity hours, and groups by board in display order.
fn render_shared_metadata(snapshot: &TaskManagerLibrarySnapshotDto) -> Result<String, BackendError> {
    let board_names = snapshot
        .boards
        .iter()
        .map(|board| (board.board_id.as_str(), board.name.as_str()))
        .collect::<HashMap<_, _>>();
    let boards = snapshot
        .boards
        .iter()
        .map(|board| {
            let mut value = serde_json::json!({
                "name": board.name,
                "color": board.color,
                "activityHoursPerDay": snapshot
                    .config
                    .activity_hours_per_day
                    .get(&board.board_id)
                    .copied()
                    .unwrap_or(24.0),
            });
            if let Some(context) = board.context.as_deref().filter(|context| !context.is_empty()) {
                value["contexto"] = serde_json::Value::String(context.to_string());
            }
            value
        })
        .collect::<Vec<_>>();
    let mut groups = snapshot.groups.iter().collect::<Vec<_>>();
    groups.sort_by(|left, right| {
        left.board_id
            .cmp(&right.board_id)
            .then(left.order.cmp(&right.order))
            .then(left.name.cmp(&right.name))
    });
    let groups = groups
        .into_iter()
        .map(|group| {
            serde_json::json!({
                "name": group.name,
                "color": group.color,
                "board": board_names.get(group.board_id.as_str()).copied().unwrap_or("default"),
            })
        })
        .collect::<Vec<_>>();
    let text = serde_json::to_string_pretty(&serde_json::json!({
        "version": 1,
        "boards": boards,
        "groups": groups,
    }))
    .map_err(|_| BackendError::invalid_input("No se pudo serializar la metadata de Task Manager."))?;
    if text.len() > MAX_SHARED_METADATA_BYTES {
        return Err(BackendError::invalid_input(
            "La metadata de Task Manager supera el límite permitido.",
        ));
    }
    Ok(format!("{text}\n"))
}

fn route_map(routes: &[TaskDocumentRouteDto]) -> Result<HashMap<String, String>, BackendError> {
    let mut result = HashMap::new();
    for route in routes {
        // A ticket created in this commit has no file yet: no route.
        if route.entity_type != "ticket" || route.logical_path.is_empty() {
            continue;
        }
        if route.logical_path.contains('\\')
            || route
                .logical_path
                .split('/')
                .any(|part| part == ".." || part.is_empty())
        {
            return Err(BackendError::invalid_input(
                "Una ruta de Task Manager no es válida.",
            ));
        }
        if result
            .insert(route.entity_id.clone(), route.logical_path.clone())
            .is_some()
        {
            return Err(BackendError::invalid_input(
                "El commit contiene rutas duplicadas.",
            ));
        }
    }
    Ok(result)
}

fn choose_ticket_path(
    workspace: &Workspace,
    ticket: &TaskTicketDto,
    old_path: Option<&Path>,
    route: Option<&str>,
    state_changed: bool,
) -> Result<PathBuf, BackendError> {
    let archived_folder = match ticket.summary.state {
        TaskState::Completed => Some(&workspace.finished),
        TaskState::Cancelled => Some(&workspace.cancelled),
        _ => None,
    };
    if let Some(route) = route {
        let routed = resolve_route_path(workspace, route)?;
        // Archiving moves the file only when the state changes in this
        // commit; an archived ticket stored elsewhere (for example a finished
        // subtask next to its parent) stays where the user keeps it.
        let archived_elsewhere = archived_folder.is_some_and(|folder| !routed.starts_with(folder));
        if !archived_elsewhere || !state_changed {
            return Ok(routed);
        }
    }
    let filename = old_path
        .and_then(|path| path.file_name())
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}.md", safe_filename(&ticket.summary.title)));
    let board = safe_filename(&ticket.summary.board_id.to_ascii_lowercase());
    let base = archived_folder.unwrap_or(&workspace.active);
    let folder = if ticket.summary.parent_ticket_id.is_some() {
        base.join(SUBTASKS)
    } else {
        base.join(board)
    };
    Ok(folder.join(filename))
}

/// `path`, or `name (n).md` next to it, so a moved ticket never overwrites an
/// existing file or another file of the same commit.
fn available_ticket_path(path: PathBuf, changes: &[FileChange]) -> PathBuf {
    let taken = |candidate: &Path| {
        task_fs::read(candidate).is_some() || changes.iter().any(|change| change.path == candidate)
    };
    if !taken(&path) {
        return path;
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("ticket")
        .to_string();
    (2..)
        .map(|index| path.with_file_name(format!("{stem} ({index}).md")))
        .find(|candidate| !taken(candidate))
        .expect("unbounded candidates")
}

fn resolve_route_path(workspace: &Workspace, logical: &str) -> Result<PathBuf, BackendError> {
    if logical.trim().is_empty() {
        return Err(BackendError::invalid_input(
            "Una ruta de Task Manager está vacía.",
        ));
    }
    if logical.starts_with('/')
        || logical.contains('\\')
        || logical
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(BackendError::invalid_input(
            "Una ruta de Task Manager no es válida.",
        ));
    }
    let candidate = workspace.library_root.join(logical);
    if !candidate.starts_with(&workspace.root) {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La ruta queda fuera del workspace de Task Manager.",
            false,
        ));
    }
    Ok(candidate)
}

fn render_ticket(
    ticket: &TaskTicketDto,
    snapshot: &TaskManagerLibrarySnapshotDto,
    existing: Option<&ParsedDocument>,
    path: &Path,
    user_names: &HashMap<String, String>,
) -> Result<String, BackendError> {
    let mut fields = existing
        .map(|document| document.frontmatter.clone())
        .unwrap_or_default();
    set_string(&mut fields, "id", &ticket.summary.ticket_id);
    set_string(&mut fields, "tarea", &ticket.summary.title);
    // The detail lives in the body; `detalle` is only read back from legacy
    // tickets whose body is empty, so it must not duplicate the body.
    set_string(&mut fields, "detalle", "");
    set_string(&mut fields, "estado", state_string(ticket.summary.state));
    set_string(&mut fields, "tablero", &ticket.summary.board_id);
    let persisted_group = ticket
        .summary
        .group_id
        .as_deref()
        .map(|group_id| {
            snapshot
                .groups
                .iter()
                .find(|group| {
                    group.group_id == group_id && group.board_id == ticket.summary.board_id
                })
                .map(|group| group.name.as_str())
                .unwrap_or(group_id)
        })
        .unwrap_or_default();
    set_string(
        &mut fields,
        "equipo",
        persisted_group,
    );
    set_string(
        &mut fields,
        "prioridad",
        priority_string(ticket.summary.priority),
    );
    set_string(&mut fields, "fechaInicio", &ticket.start_date);
    set_string(&mut fields, "fechaFin", &ticket.end_date);
    set_bool(&mut fields, "fechaFinDinamica", ticket.dynamic_end_date);
    set_number(&mut fields, "dedicado", ticket.dedicated_hours);
    set_number(&mut fields, "estimacion", ticket.estimated_hours);
    set_number(&mut fields, "desvio", ticket.deviation_hours);
    set_number(&mut fields, "order", ticket.order);
    if let Some(context) = &ticket.context {
        set_string(&mut fields, "contexto", context);
    }
    set_string(
        &mut fields,
        "revision",
        &ticket.summary.revision.to_string(),
    );
    if let Some(parent_id) = &ticket.summary.parent_ticket_id {
        let parent = snapshot
            .tickets
            .iter()
            .find(|candidate| candidate.summary.ticket_id == *parent_id)
            .ok_or_else(|| BackendError::invalid_input("La subtarea no tiene un padre válido."))?;
        set_string(
            &mut fields,
            "parent",
            &format!("[[{}]]", parent.summary.title),
        );
    } else {
        set_string(&mut fields, "parent", "");
    }
    set_array(&mut fields, "tags", &ticket.tags);
    set_array(&mut fields, "dependencies", &ticket.dependencies);
    set_array(&mut fields, "checklist", &ticket.checklist);
    set_array(&mut fields, "relatedDocuments", &ticket.related_documents);
    set_array(&mut fields, "relatedTasks", &ticket.related_tasks);
    let mut body = ticket.content.trim().to_string();
    let comments = snapshot
        .comments
        .iter()
        .filter(|comment| comment.ticket_id == ticket.summary.ticket_id)
        .collect::<Vec<_>>();
    for comment in comments {
        body.push_str("\n\n");
        body.push_str(&comment_heading(comment, user_names));
        body.push('\n');
        body.push_str(comment.body.trim());
    }
    if !body.is_empty() {
        body.push('\n');
    }
    let _ = path;
    Ok(render_document(&fields, &body))
}

fn render_board_index(
    workspace: &Workspace,
    snapshot: &TaskManagerLibrarySnapshotDto,
    board: &str,
) -> String {
    let board_metadata = snapshot.boards.iter().find(|item| item.board_id == board);
    let mut fields = BTreeMap::new();
    set_string(&mut fields, "tags", "index");
    if let Some(board_metadata) = board_metadata {
        set_string(&mut fields, "boardId", &board_metadata.board_id);
        set_string(&mut fields, "color", &board_metadata.color);
        set_string(
            &mut fields,
            "revision",
            &board_metadata.revision.to_string(),
        );
        if let Some(context) = &board_metadata.context {
            set_string(&mut fields, "contexto", context);
        }
        let activity = snapshot
            .config
            .activity_hours_per_day
            .get(board)
            .copied()
            .unwrap_or(24.0);
        set_string(&mut fields, "activityHoursPerDay", &activity.to_string());
        let groups = snapshot
            .groups
            .iter()
            .filter(|group| group.board_id == board)
            .map(|group| {
                format!(
                    "{}|{}|{}|{}",
                    group.name, group.color, group.revision, group.group_id
                )
            })
            .collect::<Vec<_>>();
        set_array(&mut fields, "groups", &groups);
    }
    let mut links = snapshot
        .tickets
        .iter()
        .filter(|ticket| {
            ticket.summary.board_id == board
                && ticket.summary.parent_ticket_id.is_none()
                && !matches!(
                    ticket.summary.state,
                    TaskState::Completed | TaskState::Cancelled
                )
        })
        .filter_map(|ticket| {
            ticket
                .summary
                .logical_path
                .rsplit('/')
                .next()
                .map(|name| format!("[[{}]]", name.trim_end_matches(".md")))
        })
        .collect::<Vec<_>>();
    links.sort();
    let body = links
        .into_iter()
        .map(|link| format!("{link}\n"))
        .collect::<String>();
    let _ = workspace;
    render_document(&fields, &body)
}

fn render_root_index(workspace: &Workspace, snapshot: &TaskManagerLibrarySnapshotDto) -> String {
    let mut fields = BTreeMap::new();
    set_string(&mut fields, "tags", "index");
    set_string(&mut fields, "generation", &snapshot.generation.to_string());
    let mut names = snapshot
        .boards
        .iter()
        .map(|board| board.board_id.clone())
        .collect::<Vec<_>>();
    names.sort();
    let mut body = names
        .into_iter()
        .map(|name| format!("[[{}TaskIndex]]\n", name))
        .collect::<String>();
    body.push_str("[[taskIndexFinished]]\n[[taskIndexCancelled]]\n");
    let _ = workspace;
    render_document(&fields, &body)
}

fn render_archive_index(
    finished: bool,
    snapshot: &TaskManagerLibrarySnapshotDto,
    workspace: &Workspace,
) -> String {
    let mut fields = BTreeMap::new();
    set_string(&mut fields, "tags", "index");
    let mut links = snapshot
        .tickets
        .iter()
        .filter(|ticket| {
            ticket.summary.state
                == if finished {
                    TaskState::Completed
                } else {
                    TaskState::Cancelled
                }
        })
        .filter_map(|ticket| {
            ticket
                .summary
                .logical_path
                .rsplit('/')
                .next()
                .map(|name| format!("[[{}]]", name.trim_end_matches(".md")))
        })
        .collect::<Vec<_>>();
    links.sort();
    let body = links
        .into_iter()
        .map(|link| format!("{link}\n"))
        .collect::<String>();
    let _ = workspace;
    render_document(&fields, &body)
}

fn board_is_affected(
    board: &str,
    before: &TaskManagerLibrarySnapshotDto,
    after: &TaskManagerLibrarySnapshotDto,
    paths: &BTreeSet<PathBuf>,
    workspace: &Workspace,
) -> bool {
    let changed_ticket = before
        .tickets
        .iter()
        .chain(after.tickets.iter())
        .any(|ticket| {
            ticket.summary.board_id == board
                && paths.iter().any(|path| {
                    logical_path(&workspace.library_root, path).ok().as_deref()
                        == Some(ticket.summary.logical_path.as_str())
                })
        });
    let before_board = before.boards.iter().find(|item| item.board_id == board);
    let after_board = after.boards.iter().find(|item| item.board_id == board);
    before_board != after_board
        || before
            .groups
            .iter()
            .filter(|item| item.board_id == board)
            .collect::<Vec<_>>()
            != after
                .groups
                .iter()
                .filter(|item| item.board_id == board)
                .collect::<Vec<_>>()
        || changed_ticket
}

fn add_change(
    changes: &mut Vec<FileChange>,
    path: &Path,
    after: Option<Vec<u8>>,
) -> Result<(), BackendError> {
    add_change_with_before(changes, path, task_fs::read(path), after)
}

fn add_change_with_before(
    changes: &mut Vec<FileChange>,
    path: &Path,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
) -> Result<(), BackendError> {
    if let Some(parent) = path.parent() {
        task_fs::create_dir_all(parent).map_err(|_| {
            BackendError::new(
                BackendErrorCode::Storage,
                "No se pudo preparar una ruta de Task Manager.",
                true,
            )
        })?;
    }
    changes.push(FileChange {
        path: path.to_path_buf(),
        before,
        after,
    });
    Ok(())
}

fn deduplicate_changes(changes: Vec<FileChange>) -> Vec<FileChange> {
    let mut by_path = BTreeMap::new();
    for change in changes {
        by_path.insert(change.path.clone(), change);
    }
    by_path.into_values().collect()
}

fn apply_file_changes(changes: &[FileChange]) -> Result<(), BackendError> {
    let mut applied = Vec::new();
    for change in changes {
        let current = task_fs::read(&change.path);
        if current != change.before {
            rollback_file_changes(&applied);
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El workspace cambió durante el commit de Task Manager.",
                true,
            ));
        }
        let result = match &change.after {
            Some(content) => {
                let text = String::from_utf8(content.clone()).map_err(|_| {
                    BackendError::invalid_input("El Markdown generado no es UTF-8 válido.")
                })?;
                if change.before.is_some() {
                    task_fs::write_text(
                        &change.path,
                        &text,
                        change
                            .before
                            .as_deref()
                            .map(|bytes| content_revision_bytes(bytes))
                            .as_deref(),
                    )
                    .then_some(())
                    .ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::Storage,
                            "No se pudo escribir atómicamente Task Manager.",
                            true,
                        )
                    })
                } else {
                    task_fs::create_text(&change.path, &text)
                        .then_some(())
                        .ok_or_else(|| {
                            BackendError::new(
                                BackendErrorCode::Storage,
                                "No se pudo crear atómicamente Task Manager.",
                                true,
                            )
                        })
                }
            }
            None => task_fs::remove_file(&change.path).then_some(()).ok_or_else(|| {
                BackendError::new(
                    BackendErrorCode::Storage,
                    "No se pudo eliminar un archivo de Task Manager.",
                    true,
                )
            }),
        };
        if let Err(error) = result {
            rollback_file_changes(&applied);
            return Err(error);
        }
        applied.push(change.clone());
    }
    Ok(())
}

fn rollback_file_changes(changes: &[FileChange]) {
    for change in changes.iter().rev() {
        match &change.before {
            Some(content) => {
                if let Ok(text) = String::from_utf8(content.clone()) {
                    let _ = task_fs::write_text(&change.path, &text, None);
                }
            }
            None => {
                let _ = task_fs::remove_file(&change.path);
            }
        }
    }
}

fn verify_file_changes(changes: &[FileChange]) -> Result<(), BackendError> {
    for change in changes {
        let actual = task_fs::read(&change.path);
        if actual != change.after {
            return Err(BackendError::new(
                BackendErrorCode::Storage,
                "La verificación del commit de Task Manager falló.",
                true,
            ));
        }
    }
    Ok(())
}

fn validate_commit_identity(
    library_id: &str,
    request: &TaskManagerStoreCommit,
) -> Result<(), BackendError> {
    if request.library_id != library_id
        || request.snapshot.library_id != library_id
        || request.operation.library_id != library_id
    {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "El commit no pertenece a la biblioteca abierta.",
            false,
        ));
    }
    if request.operation.library_user_id.trim().is_empty() {
        return Err(BackendError::new(
            BackendErrorCode::Unauthorized,
            "El commit no tiene un usuario autenticado.",
            false,
        ));
    }
    Ok(())
}

fn validate_generation(
    current: Option<&TaskManagerLibrarySnapshotDto>,
    next: &TaskManagerLibrarySnapshotDto,
) -> Result<(), BackendError> {
    if let Some(current) = current {
        if next.generation != current.generation
            && next.generation != current.generation.saturating_add(1)
        {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El snapshot de Task Manager quedó obsoleto.",
                true,
            ));
        }
    }
    Ok(())
}

fn validate_requested_revisions(
    current: Option<&TaskManagerLibrarySnapshotDto>,
    revisions: &[TaskEntityRevisionDto],
) -> Result<(), BackendError> {
    let Some(current) = current else {
        return Ok(());
    };
    for revision in revisions {
        let previous = match revision.entity_type.as_str() {
            "ticket" => current
                .tickets
                .iter()
                .find(|item| item.summary.ticket_id == revision.entity_id)
                .map(|item| item.summary.revision),
            "board" => current
                .boards
                .iter()
                .find(|item| item.board_id == revision.entity_id)
                .map(|item| item.revision),
            "group" => current
                .groups
                .iter()
                .find(|item| item.group_id == revision.entity_id)
                .map(|item| item.revision),
            _ => None,
        };
        if previous.is_some_and(|value| revision.revision != value.saturating_add(1)) {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El ticket, grupo o tablero cambió desde el preview.",
                true,
            ));
        }
    }
    Ok(())
}

fn validate_snapshot_relationships(
    snapshot: &TaskManagerLibrarySnapshotDto,
) -> Result<(), BackendError> {
    let ids = snapshot
        .tickets
        .iter()
        .map(|item| item.summary.ticket_id.as_str())
        .collect::<HashSet<_>>();
    for ticket in &snapshot.tickets {
        if let Some(parent) = &ticket.summary.parent_ticket_id {
            let parent_ticket = snapshot
                .tickets
                .iter()
                .find(|candidate| candidate.summary.ticket_id == *parent)
                .ok_or_else(|| {
                    BackendError::invalid_input("El snapshot contiene una subtarea huérfana.")
                })?;
            if parent_ticket.summary.parent_ticket_id.is_some()
                || parent_ticket.summary.board_id != ticket.summary.board_id
            {
                return Err(BackendError::invalid_input(
                    "El padre debe ser principal y del mismo tablero.",
                ));
            }
        }
    }
    for comment in &snapshot.comments {
        if !ids.contains(comment.ticket_id.as_str()) {
            return Err(BackendError::invalid_input(
                "El snapshot contiene un comentario huérfano.",
            ));
        }
    }
    Ok(())
}

/// Files edited outside Notia may point to a deleted parent, to another
/// subtask or to a ticket of another board. Such subtasks are shown as main
/// tasks instead of making the whole workspace unreadable; new mutations are
/// still validated strictly.
fn detach_invalid_parents(tickets: &mut [TaskTicketDto]) {
    let parents = tickets
        .iter()
        .map(|ticket| {
            (
                ticket.summary.ticket_id.clone(),
                (
                    ticket.summary.board_id.clone(),
                    ticket.summary.parent_ticket_id.clone(),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut detached = 0usize;
    for ticket in tickets.iter_mut() {
        let Some(parent_id) = ticket.summary.parent_ticket_id.clone() else {
            continue;
        };
        let valid = parent_id != ticket.summary.ticket_id
            && parents.get(&parent_id).is_some_and(|(board_id, grandparent)| {
                grandparent.is_none() && *board_id == ticket.summary.board_id
            });
        if !valid {
            ticket.summary.parent_ticket_id = None;
            detached += 1;
        }
    }
    if detached > 0 {
        log::warn!(
            "[notia:task-manager] {detached} subtareas sin padre válido se muestran como tareas principales"
        );
    }
}

fn validate_parent_relationships(tickets: &[TaskTicketDto]) -> Result<(), BackendError> {
    let ids = tickets
        .iter()
        .map(|item| item.summary.ticket_id.as_str())
        .collect::<HashSet<_>>();
    for ticket in tickets {
        if let Some(parent) = &ticket.summary.parent_ticket_id {
            let parent_ticket = tickets
                .iter()
                .find(|candidate| candidate.summary.ticket_id == *parent)
                .ok_or_else(|| {
                    BackendError::invalid_input("El workspace contiene una subtarea huérfana.")
                })?;
            if !ids.contains(parent.as_str())
                || parent_ticket.summary.parent_ticket_id.is_some()
                || parent_ticket.summary.board_id != ticket.summary.board_id
            {
                return Err(BackendError::invalid_input(
                    "El padre debe ser principal y del mismo tablero.",
                ));
            }
        }
    }
    Ok(())
}

fn parse_frontmatter(content: &str) -> (BTreeMap<String, YamlValue>, String) {
    let normalized = content.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return (BTreeMap::new(), normalized);
    }
    let Some(end) = normalized[4..].find("\n---") else {
        return (BTreeMap::new(), normalized);
    };
    let end = end + 4;
    let frontmatter = parse_yaml_lines(&normalized[4..end].lines().collect::<Vec<_>>());
    let body = normalized[end + 4..].trim_start_matches('\n').to_string();
    (frontmatter, body)
}

fn parse_yaml_lines(lines: &[&str]) -> BTreeMap<String, YamlValue> {
    let mut result = BTreeMap::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index].trim_end();
        let Some((key, raw)) = line.split_once(':') else {
            index += 1;
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            index += 1;
            continue;
        }
        let raw = raw.trim();
        if raw.is_empty() {
            let mut values = Vec::new();
            let mut cursor = index + 1;
            while cursor < lines.len() && lines[cursor].trim_start().starts_with("-") {
                values.push(unquote(
                    lines[cursor].trim_start().trim_start_matches('-').trim(),
                ));
                cursor += 1;
            }
            result.insert(key.to_string(), YamlValue::Array(values));
            index = cursor;
        } else if raw.starts_with('[') && raw.ends_with(']') {
            let values = raw[1..raw.len() - 1]
                .split(',')
                .map(|item| unquote(item.trim()))
                .filter(|item| !item.is_empty())
                .collect();
            result.insert(key.to_string(), YamlValue::Array(values));
            index += 1;
        } else if raw.eq_ignore_ascii_case("true") || raw.eq_ignore_ascii_case("false") {
            result.insert(
                key.to_string(),
                YamlValue::Bool(raw.eq_ignore_ascii_case("true")),
            );
            index += 1;
        } else if let Ok(number) = raw.parse::<f64>() {
            result.insert(key.to_string(), YamlValue::Number(number));
            index += 1;
        } else {
            result.insert(key.to_string(), YamlValue::String(unquote(raw)));
            index += 1;
        }
    }
    result
}

fn render_document(fields: &BTreeMap<String, YamlValue>, body: &str) -> String {
    let mut output = String::from("---\n");
    for (key, value) in fields {
        output.push_str(&format!("{key}: {}\n", render_value(value)));
    }
    output.push_str("---\n\n");
    output.push_str(body);
    output
}

fn render_value(value: &YamlValue) -> String {
    match value {
        YamlValue::String(value) => yaml_string(value),
        YamlValue::Number(value) => value.to_string(),
        YamlValue::Bool(value) => value.to_string(),
        YamlValue::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(|value| yaml_string(value))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

fn set_string(fields: &mut BTreeMap<String, YamlValue>, key: &str, value: &str) {
    fields.insert(key.to_string(), YamlValue::String(value.to_string()));
}
fn set_bool(fields: &mut BTreeMap<String, YamlValue>, key: &str, value: bool) {
    fields.insert(key.to_string(), YamlValue::Bool(value));
}
fn set_number(fields: &mut BTreeMap<String, YamlValue>, key: &str, value: f64) {
    fields.insert(key.to_string(), YamlValue::Number(value));
}
fn set_array(fields: &mut BTreeMap<String, YamlValue>, key: &str, values: &[String]) {
    fields.insert(key.to_string(), YamlValue::Array(values.to_vec()));
}
/// Double-quoted scalar on a single line: the frontmatter parser is line
/// based, so line breaks must never reach the file unescaped.
fn yaml_string(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            other => output.push(other),
        }
    }
    output.push('"');
    output
}

fn unescape_quoted(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            output.push(character);
            continue;
        }
        match characters.next() {
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some('t') => output.push('\t'),
            Some(other) => output.push(other),
            None => output.push('\\'),
        }
    }
    output
}
fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        unescape_quoted(&value[1..value.len() - 1])
    } else {
        value.to_string()
    }
}

fn field_string(fields: &BTreeMap<String, YamlValue>, key: &str) -> Option<String> {
    fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .and_then(|(_, value)| match value {
            YamlValue::String(value) => Some(value.clone()),
            YamlValue::Number(value) => Some(value.to_string()),
            YamlValue::Bool(value) => Some(value.to_string()),
            YamlValue::Array(_) => None,
        })
}
fn field_number(fields: &BTreeMap<String, YamlValue>, key: &str) -> Option<f64> {
    fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .and_then(|(_, value)| match value {
            YamlValue::Number(value) => Some(*value),
            YamlValue::String(value) => value.parse().ok(),
            _ => None,
        })
}
fn field_bool(fields: &BTreeMap<String, YamlValue>, key: &str) -> Option<bool> {
    fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .and_then(|(_, value)| match value {
            YamlValue::Bool(value) => Some(*value),
            YamlValue::String(value) => match value.trim().to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" | "si" => Some(true),
                "false" | "0" | "no" => Some(false),
                _ => None,
            },
            YamlValue::Number(value) => Some(*value != 0.0),
            YamlValue::Array(_) => None,
        })
}
// Hydration is lenient: a hand-edited field never hides the workspace. Bad
// values fall back to their defaults and oversized ones are truncated; new
// mutations are still validated strictly by the core.
fn frontmatter_string(fields: &BTreeMap<String, YamlValue>, key: &str, max_chars: usize) -> String {
    field_string(fields, key)
        .unwrap_or_default()
        .chars()
        .take(max_chars)
        .collect()
}
fn frontmatter_number(
    fields: &BTreeMap<String, YamlValue>,
    key: &str,
    default: f64,
    max: f64,
) -> f64 {
    if !has_field(fields, key) {
        return default;
    }
    field_number(fields, key)
        .or_else(|| {
            field_string(fields, key)
                .and_then(|value| value.trim().replace(',', ".").parse::<f64>().ok())
        })
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, max))
        .unwrap_or(default)
}
fn frontmatter_bool(fields: &BTreeMap<String, YamlValue>, key: &str, default: bool) -> bool {
    if !has_field(fields, key) {
        return default;
    }
    field_bool(fields, key).unwrap_or(default)
}
fn frontmatter_references(fields: &BTreeMap<String, YamlValue>, key: &str) -> Vec<String> {
    let Some(value) = fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
    else {
        return Vec::new();
    };
    let values = match value {
        YamlValue::Array(values) => values.clone(),
        YamlValue::String(value) if !value.trim().is_empty() => vec![value.clone()],
        _ => Vec::new(),
    };
    values
        .into_iter()
        .filter(|value| value.chars().count() <= MAX_TASK_REFERENCE_CHARS)
        .take(MAX_TASK_RELATED_REFERENCES)
        .collect()
}
fn has_field(fields: &BTreeMap<String, YamlValue>, key: &str) -> bool {
    fields.keys().any(|name| name.eq_ignore_ascii_case(key))
}
fn field_u64(fields: &BTreeMap<String, YamlValue>, key: &str) -> Option<u64> {
    field_number(fields, key)
        .filter(|value| {
            value.is_finite() && *value >= 1.0 && *value <= MAX_JS_SAFE_INTEGER as f64
        })
        .map(|value| value as u64)
}
fn field_strings(fields: &BTreeMap<String, YamlValue>, key: &str) -> Vec<String> {
    fields
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| match value {
            YamlValue::Array(values) => values.clone(),
            YamlValue::String(value) if !value.trim().is_empty() => vec![value.clone()],
            _ => Vec::new(),
        })
        .unwrap_or_default()
}

fn parse_state(value: Option<&str>) -> TaskState {
    match value.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "cancelada" | "cancelled" => TaskState::Cancelled,
        "en progreso" | "in progress" => TaskState::InProgress,
        "finalizada" | "completed" => TaskState::Completed,
        "bloqueada" | "blocked" => TaskState::Blocked,
        _ => TaskState::Pending,
    }
}
fn parse_priority(value: Option<&str>) -> TaskPriority {
    match value.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "baja" | "low" => TaskPriority::Low,
        "alta" | "high" => TaskPriority::High,
        "urgente" | "urgent" => TaskPriority::Urgent,
        _ => TaskPriority::Medium,
    }
}
fn state_string(value: TaskState) -> &'static str {
    match value {
        TaskState::Pending => "Pendiente",
        TaskState::Cancelled => "Cancelada",
        TaskState::InProgress => "En progreso",
        TaskState::Completed => "Finalizada",
        TaskState::Blocked => "Bloqueada",
    }
}
fn priority_string(value: TaskPriority) -> &'static str {
    match value {
        TaskPriority::Low => "Baja",
        TaskPriority::Medium => "Media",
        TaskPriority::High => "Alta",
        TaskPriority::Urgent => "Urgente",
    }
}
fn normalize_name(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}
fn basename(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("ticket")
        .to_string()
}
fn safe_filename(value: &str) -> String {
    let value = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim()
        .to_string();
    if value.is_empty() {
        "ticket".to_string()
    } else {
        value
    }
}
fn normalize_parent_reference(value: &str) -> String {
    let mut value = value.trim().to_string();
    if value.starts_with("[[") && value.ends_with("]] ") {
        value.truncate(value.len().saturating_sub(3));
    } else if value.starts_with("[[") && value.ends_with("]]") {
        value = value[2..value.len().saturating_sub(2)].to_string();
    }
    value
        .split('|')
        .next()
        .unwrap_or(&value)
        .split('#')
        .next()
        .unwrap_or(&value)
        .rsplit('/')
        .next()
        .unwrap_or(&value)
        .trim_end_matches(".md")
        .trim()
        .to_string()
}

fn logical_path(root: &Path, path: &Path) -> Result<String, BackendError> {
    path.strip_prefix(root)
        .map_err(|_| {
            BackendError::new(
                BackendErrorCode::Forbidden,
                "La ruta queda fuera de la biblioteca.",
                false,
            )
        })
        .and_then(|relative| {
            let value = relative
                .to_str()
                .ok_or_else(|| BackendError::invalid_input("La ruta no es UTF-8 válida."))?
                .replace('\\', "/");
            if value
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            {
                return Err(BackendError::invalid_input("La ruta contiene traversal."));
            }
            Ok(value)
        })
}
fn deterministic_id(kind: &str, value: &str) -> String {
    format!("legacy-{kind}-{}", hex_digest(value))
}
fn stable_revision(kind: &str, value: &str) -> u64 {
    let digest = Sha256::digest(format!("{kind}:{value}").as_bytes());
    (u64::from_be_bytes(digest[..8].try_into().unwrap()) % MAX_JS_SAFE_INTEGER).max(1)
}
fn hex_digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn content_revision_bytes(value: &[u8]) -> String {
    format!("sha256:{}", hex_digest(&String::from_utf8_lossy(value)))
}
fn empty_snapshot(library_id: &str) -> TaskManagerLibrarySnapshotDto {
    TaskManagerLibrarySnapshotDto {
        library_id: library_id.to_string(),
        users: Vec::new(),
        boards: Vec::new(),
        groups: Vec::new(),
        tickets: Vec::new(),
        comments: Vec::new(),
        generation: 1,
        config: TaskManagerConfigDto::default(),
    }
}

fn parse_timestamp_millis(value: &str) -> Option<i64> {
    let value = value.trim();
    if value.len() < 20 {
        return None;
    }
    let date = value.get(0..19)?;
    let bytes = date.as_bytes();
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') || bytes.get(10) != Some(&b'T') {
        return None;
    }
    let year: i64 = date[0..4].parse().ok()?;
    let month: i64 = date[5..7].parse().ok()?;
    let day: i64 = date[8..10].parse().ok()?;
    let hour: i64 = date[11..13].parse().ok()?;
    let minute: i64 = date[14..16].parse().ok()?;
    let second: i64 = date[17..19].parse().ok()?;
    Some((days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000)
}
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = (if year >= 0 { year } else { year - 399 }) / 400;
    let year_of_era = year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146097 + day_of_era - 719468
}
pub(crate) fn format_iso_timestamp(millis: i64) -> String {
    let days = millis.div_euclid(86_400_000);
    let remainder = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        remainder / 3_600_000,
        (remainder / 60_000) % 60,
        (remainder / 1_000) % 60,
        remainder % 1_000
    )
}
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719468;
    let era = (if days >= 0 { days } else { days - 146096 }) / 146097;
    let day_of_era = days - era * 146097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_ticket_and_comment_ids_are_deterministic() {
        assert_eq!(
            deterministic_id("ticket", "task-manager/tasks/default/a.md"),
            deterministic_id("ticket", "task-manager/tasks/default/a.md")
        );
        let (body, comments) = split_comments(
            "Texto\n\n## Comentario - viejo\n---\n---\nComentario\n",
            "library",
            "ticket",
            "task-manager/tasks/default/a.md",
            &HashMap::new(),
        )
        .expect("comments");
        assert_eq!(body, "Texto");
        assert_eq!(
            comments[0].comment_id,
            deterministic_id("comment", "ticket:0:viejo:Comentario")
        );
    }

    #[test]
    fn generated_revisions_fit_the_javascript_integer_contract() {
        assert!((1..=MAX_JS_SAFE_INTEGER).contains(&stable_revision(
            "ticket",
            "Historial refinamientos",
        )));

        let mut fields = BTreeMap::new();
        set_number(
            &mut fields,
            "revision",
            (MAX_JS_SAFE_INTEGER.saturating_add(1)) as f64,
        );
        assert_eq!(field_u64(&fields, "revision"), None);
    }

    #[test]
    fn shared_metadata_resolves_legacy_group_names_to_stable_ids() {
        let mut metadata = BTreeMap::new();
        merge_shared_metadata(
            &mut metadata,
            &serde_json::json!({
                "boards": [{ "name": "default", "color": "#2e6db0" }],
                "groups": [{ "name": "Proximo Q", "board": "default", "color": "#2e6db0" }]
            }),
        );

        let group_id = resolve_group_reference(&metadata, "default", Some("Proximo Q"));
        assert!(group_id.as_deref().is_some_and(|id| id.starts_with("legacy-group-")));
    }

    #[test]
    fn removed_group_reference_is_unassigned() {
        let mut metadata = BTreeMap::new();
        merge_shared_metadata(
            &mut metadata,
            &serde_json::json!({
                "groups": [{ "name": "Proximo Q", "board": "default" }]
            }),
        );

        assert_eq!(
            resolve_group_reference(&metadata, "default", Some("Del Q")),
            None
        );
    }

    #[test]
    fn frontmatter_round_trip_preserves_arrays_and_body() {
        let source = "---\nid: \"ticket-1\"\ntags: [task, urgent]\n---\n\nbody\n";
        let (fields, body) = parse_frontmatter(source);
        assert_eq!(field_string(&fields, "id").as_deref(), Some("ticket-1"));
        assert_eq!(field_strings(&fields, "tags"), vec!["task", "urgent"]);
        assert_eq!(
            render_document(&fields, &body),
            "---\nid: \"ticket-1\"\ntags: [\"task\", \"urgent\"]\n---\n\nbody\n"
        );
    }

    #[test]
    fn ticket_metadata_round_trips_between_frontmatter_and_snapshot() {
        let workspace = default_workspace(PathBuf::from("C:/library"));
        let path = workspace.active.join("default").join("metadata.md");
        let ticket = TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "library".into(),
                ticket_id: "ticket-metadata".into(),
                board_id: "default".into(),
                group_id: Some("backlog".into()),
                title: "Metadata".into(),
                state: TaskState::Pending,
                priority: TaskPriority::High,
                parent_ticket_id: None,
                detail_preview: "Body".into(),
                revision: 1,
                logical_path: "task-manager/tasks/default/metadata.md".into(),
            },
            content: "Body".into(),
            tags: vec!["task".into()],
            dependencies: vec!["ticket-dependency".into()],
            checklist: vec!["check".into()],
            start_date: "2026-09-01T08:00:00.000Z".into(),
            end_date: "2026-09-02T16:30:00.000Z".into(),
            dynamic_end_date: false,
            dedicated_hours: 1.25,
            estimated_hours: 4.5,
            deviation_hours: 0.75,
            order: 12.5,
            context: Some("#Trabajo".into()),
            related_documents: vec!["notes/design.md".into()],
            related_tasks: vec!["ticket-other".into()],
        };
        let snapshot = TaskManagerLibrarySnapshotDto {
            library_id: "library".into(),
            users: vec![],
            boards: vec![],
            groups: vec![TaskGroupDto {
                library_id: "library".into(),
                group_id: "backlog".into(),
                board_id: "default".into(),
                name: "Backlog".into(),
                color: "#2e6db0".into(),
                revision: 1,
                order: 0,
            }],
            tickets: vec![ticket.clone()],
            comments: vec![],
            generation: 1,
            config: TaskManagerConfigDto::default(),
        };
        let content = render_ticket(&ticket, &snapshot, None, &path, &HashMap::new()).unwrap();
        let (frontmatter, body) = parse_frontmatter(&content);
        assert_eq!(field_string(&frontmatter, "equipo").as_deref(), Some("Backlog"));
        let mut documents = HashMap::new();
        documents.insert(
            "task-manager/tasks/default/metadata.md".into(),
            ParsedDocument {
                path: path.clone(),
                logical_path: "task-manager/tasks/default/metadata.md".into(),
                content,
                frontmatter,
                body,
            },
        );
        let index_path = workspace.active.join("defaultTaskIndex.md");
        let mut index_fields = BTreeMap::new();
        set_array(
            &mut index_fields,
            "groups",
            &["Backlog|#2e6db0|1|group-backlog".into()],
        );
        let index_content = render_document(&index_fields, "");
        let (index_frontmatter, index_body) = parse_frontmatter(&index_content);
        let index_logical_path = logical_path(&workspace.library_root, &index_path).unwrap();
        documents.insert(
            index_logical_path.clone(),
            ParsedDocument {
                path: index_path,
                logical_path: index_logical_path,
                content: index_content,
                frontmatter: index_frontmatter,
                body: index_body,
            },
        );

        let hydrated = hydrate_snapshot("library", &workspace, &documents, &HashMap::new()).unwrap();
        let hydrated_ticket = &hydrated.tickets[0];
        assert_eq!(hydrated_ticket.summary.group_id.as_deref(), Some("group-backlog"));
        assert_eq!(hydrated_ticket.start_date, ticket.start_date);
        assert_eq!(hydrated_ticket.end_date, ticket.end_date);
        assert!(!hydrated_ticket.dynamic_end_date);
        assert_eq!(hydrated_ticket.dedicated_hours, ticket.dedicated_hours);
        assert_eq!(hydrated_ticket.estimated_hours, ticket.estimated_hours);
        assert_eq!(hydrated_ticket.deviation_hours, ticket.deviation_hours);
        assert_eq!(hydrated_ticket.order, ticket.order);
        assert_eq!(hydrated_ticket.context, ticket.context);
        assert_eq!(hydrated_ticket.related_documents, ticket.related_documents);
        assert_eq!(hydrated_ticket.related_tasks, ticket.related_tasks);
    }

    #[test]
    fn comments_use_the_readable_heading_and_round_trip() {
        let names = HashMap::from([("user-owner".to_string(), "Gabriel".to_string())]);
        let (_, legacy) = split_comments(
            "Texto\n\n## Comentario - 12/09/2026 13:20\nPrimero\n\n## Comentario - 13/09/2026 09:05 - Gabriel\nSegundo",
            "library",
            "ticket",
            "task-mannager/default/a.md",
            &names,
        )
        .expect("comments");
        assert_eq!(legacy.len(), 2);
        assert!(legacy.iter().all(|comment| comment.author_user_id == "user-owner"));
        assert_eq!(legacy[1].body, "Segundo");

        let heading = comment_heading(&legacy[1], &names);
        assert_eq!(heading, "## Comentario - 13/09/2026 09:05 - Gabriel");
        let (body, parsed) = split_comments(
            &format!("Texto\n\n{heading}\nSegundo\n"),
            "library",
            "ticket",
            "task-mannager/default/a.md",
            &names,
        )
        .expect("comments");
        assert_eq!(body, "Texto");
        assert_eq!(parsed[0].created_at_unix_ms, legacy[1].created_at_unix_ms);
    }

    #[test]
    fn multiline_values_stay_on_one_frontmatter_line() {
        let mut fields = BTreeMap::new();
        set_string(&mut fields, "detalle", "---\ntablero: \"x\"\n---\nC:\\ruta\ttab");
        let content = render_document(&fields, "body\n");
        assert_eq!(content.lines().filter(|line| *line == "---").count(), 2);
        let (parsed, body) = parse_frontmatter(&content);
        assert_eq!(parsed, fields);
        assert_eq!(body, "body\n");
    }

    #[test]
    fn unsafe_board_names_keep_the_index_inside_the_workspace() {
        let workspace = resolve_workspace_for_test();
        let path = board_index_path(&workspace, "\\\"default\\\"");
        assert!(logical_path(&workspace.library_root, &path).is_ok());
    }

    #[test]
    fn archived_tickets_stored_elsewhere_move_only_when_their_state_changes() {
        let workspace = resolve_workspace_for_test();
        let route = "task-mannager/default/subTasks/Hecha.md";
        let ticket = TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "library".into(),
                ticket_id: "ticket-done".into(),
                board_id: "default".into(),
                group_id: None,
                title: "Hecha".into(),
                state: TaskState::Completed,
                priority: TaskPriority::Medium,
                parent_ticket_id: Some("parent".into()),
                detail_preview: String::new(),
                revision: 1,
                logical_path: route.into(),
            },
            content: String::new(),
            tags: vec![],
            dependencies: vec![],
            checklist: vec![],
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            dedicated_hours: 0.0,
            estimated_hours: 0.0,
            deviation_hours: 0.0,
            order: 0.0,
            context: None,
            related_documents: vec![],
            related_tasks: vec![],
        };
        let old_path = workspace.library_root.join(route);

        let kept = choose_ticket_path(&workspace, &ticket, Some(&old_path), Some(route), false)
            .expect("path");
        assert_eq!(kept, old_path);

        let archived = choose_ticket_path(&workspace, &ticket, Some(&old_path), Some(route), true)
            .expect("path");
        assert_eq!(archived, workspace.finished.join(SUBTASKS).join("Hecha.md"));
    }

    fn resolve_workspace_for_test() -> Workspace {
        let root = PathBuf::from("C:/library").join(PRIMARY_ROOT);
        Workspace {
            library_root: PathBuf::from("C:/library"),
            active: root.clone(),
            finished: root.join(FINISHED),
            cancelled: root.join(CANCELLED),
            root,
        }
    }

    #[test]
    fn tickets_created_in_the_commit_have_no_route_yet() {
        let route = |entity_id: &str, logical_path: &str| TaskDocumentRouteDto {
            entity_type: "ticket".into(),
            entity_id: entity_id.into(),
            logical_path: logical_path.into(),
        };
        let routes = route_map(&[
            route("new", ""),
            route("old", "task-mannager/default/a.md"),
        ])
        .expect("routes");
        assert_eq!(routes.len(), 1);
        assert!(route_map(&[route("bad", "task-mannager//a.md")]).is_err());
    }

    #[test]
    fn a_ticket_created_in_memory_gets_the_path_it_was_written_to() {
        let root = std::env::temp_dir().join(format!("notia-task-routes-{}", uuid::Uuid::new_v4()));
        let loaded = LoadedWorkspace {
            workspace: default_workspace(root.clone()),
            snapshot: empty_snapshot("library"),
            documents: HashMap::new(),
            user_names: Default::default(),
        };
        let ticket = TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "library".into(),
                ticket_id: "ticket-new".into(),
                board_id: "default".into(),
                group_id: None,
                title: "Nueva".into(),
                state: TaskState::Pending,
                priority: TaskPriority::Medium,
                parent_ticket_id: None,
                detail_preview: String::new(),
                revision: 1,
                // Created by a mutation: no file yet.
                logical_path: String::new(),
            },
            content: "Detalle".into(),
            tags: vec![],
            dependencies: vec![],
            checklist: vec![],
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            dedicated_hours: 0.0,
            estimated_hours: 0.0,
            deviation_hours: 0.0,
            order: 0.0,
            context: None,
            related_documents: vec![],
            related_tasks: vec![],
        };
        let comment = TaskCommentDto {
            library_id: "library".into(),
            comment_id: "comment-new".into(),
            ticket_id: "ticket-new".into(),
            author_user_id: OWNER_USER_ID.into(),
            body: "Comentario".into(),
            created_at_unix_ms: 0,
            revision: 1,
            logical_path: String::new(),
        };
        let mut snapshot = empty_snapshot("library");
        snapshot.tickets = vec![ticket];
        snapshot.comments = vec![comment];
        snapshot.generation = 1;
        let request = TaskManagerStoreCommit {
            library_id: "library".into(),
            snapshot,
            routes: vec![],
            revisions: vec![],
            operation: notia_backend_core::TaskManagerAppliedOperationDto {
                library_id: "library".into(),
                library_user_id: OWNER_USER_ID.into(),
                operation_id: "operation".into(),
                idempotency_key: "idempotency".into(),
                affected_ids: vec![],
            },
        };
        let (_, committed) = build_file_changes(&loaded, &request).expect("changes");
        let routes = committed_routes(&committed);
        let ticket_path = &routes.iter().find(|route| route.entity_id == "ticket-new").expect("ticket").logical_path;
        assert!(ticket_path.ends_with("/Nueva.md"), "{ticket_path}");
        assert_eq!(
            &routes.iter().find(|route| route.entity_id == "comment-new").expect("comment").logical_path,
            ticket_path
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn traversal_is_rejected() {
        let workspace = default_workspace(std::path::PathBuf::from("C:/library"));
        assert!(resolve_route_path(&workspace, "task-manager/../secret.md").is_err());
    }

    #[test]
    fn timestamps_round_trip_in_utc() {
        let timestamp = "2026-09-09T15:04:00.000Z";
        let millis = parse_timestamp_millis(timestamp).expect("timestamp");
        assert_eq!(format_iso_timestamp(millis), timestamp);
    }

    #[test]
    fn resolves_legacy_completed_folder_without_migrating_on_read() {
        let library_root = std::env::temp_dir().join(format!(
            "notia-task-manager-legacy-{}",
            uuid::Uuid::new_v4()
        ));
        let legacy_completed = library_root.join(PRIMARY_ROOT).join(LEGACY_FINISHED);
        std::fs::create_dir_all(&legacy_completed).expect("legacy workspace");

        let workspace = resolve_workspace(&library_root)
            .expect("workspace resolution")
            .expect("legacy workspace exists");
        assert_eq!(workspace.finished, legacy_completed);

        let _ = std::fs::remove_dir_all(library_root);
    }

    #[test]
    fn hand_edited_workspaces_still_load() {
        let library_root = std::env::temp_dir().join(format!(
            "notia-task-manager-lenient-{}",
            uuid::Uuid::new_v4()
        ));
        let board = library_root.join(MODERN_ROOT).join(MODERN_ACTIVE).join("default");
        std::fs::create_dir_all(&board).expect("board");
        std::fs::write(
            board.join("a.md"),
            "---
tarea: A
id: same
dedicado: 1,5
estimacion: mucho
fechaFinDinamica: quizas
---
Cuerpo
",
        )
        .expect("a");
        std::fs::write(board.join("b.md"), "---
tarea: B
id: same
---
").expect("b");
        std::fs::write(board.join("c.md"), "---
tarea: C
parent: \"[[borrada]]\"
---
").expect("c");
        let registry = LibraryBindingRegistry::default();
        registry.register_desktop_root("library-lenient", &library_root).expect("binding");
        let store = MarkdownTaskManagerStore::new(
            "library-lenient".to_string(),
            registry,
            Arc::new(Mutex::new(())),
        );

        let snapshot = store
            .load("library-lenient")
            .expect("workspace loads")
            .expect("snapshot");
        assert_eq!(snapshot.tickets.len(), 3);
        let ids = snapshot
            .tickets
            .iter()
            .map(|ticket| ticket.summary.ticket_id.clone())
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), 3);
        let a = snapshot.tickets.iter().find(|ticket| ticket.summary.title == "A").expect("A");
        assert_eq!(a.dedicated_hours, 1.5);
        assert_eq!(a.estimated_hours, 0.0);
        assert!(a.dynamic_end_date);
        let c = snapshot.tickets.iter().find(|ticket| ticket.summary.title == "C").expect("C");
        assert!(c.summary.parent_ticket_id.is_none());
        let _ = std::fs::remove_dir_all(library_root);
    }
}
