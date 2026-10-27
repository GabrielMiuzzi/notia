//! Opening and refreshing the explorer of a library.
//!
//! The interface names the library it shows; the backend binds it from the
//! catalog, prepares its structure (chats, agent workspace, SQLite), reads
//! the tree the way the platform allows (the full tree on desktop, the root
//! listing on Android, whose folders load on demand), watches it on desktop,
//! keeps the inventory up to date and decides whether a refresh needs a new
//! read. Every node comes out normalized and in explorer order.

use std::collections::HashMap;
use std::sync::Mutex;

use notia_backend_core::library_tree::{normalize_tree, shallow_listing, LibraryTreeNodeDto};
use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager, Window};

use crate::backend::{BackendError, BackendErrorCode};
use crate::library_catalog::CatalogLibrary;
use crate::library_registry::LibraryBindingRegistry;

/// Last tree signature seen per library: desktop skips the read when
/// nothing moved; Android, without a cheap signature, reads the tree but
/// does not send it nor index it again when it is the same.
#[derive(Default)]
pub(crate) struct LibrarySessionState {
    signatures: Mutex<HashMap<String, String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryPayload {
    library_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryRefreshPayload {
    library_id: String,
    /// Read even if the signature did not change (after a known mutation).
    #[serde(default)]
    force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryDirectoryPayload {
    library_id: String,
    /// Identity of the folder as the tree returned it.
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryTreeViewDto {
    nodes: Vec<LibraryTreeNodeDto>,
    /// Folders load their children with `library_read_directory`.
    lazy: bool,
    /// The backend watches the library and announces changes; otherwise the
    /// interface refreshes it periodically.
    watched: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryRefreshDto {
    changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    nodes: Option<Vec<LibraryTreeNodeDto>>,
}

fn unavailable(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, message, true)
}

fn catalog_entry(app: &AppHandle, library_id: &str) -> Result<CatalogLibrary, BackendError> {
    crate::library_catalog::catalog_library(app, library_id)
        .ok_or_else(|| unavailable("La biblioteca no está en el catálogo."))
}

fn to_nodes<T: Serialize>(nodes: Vec<T>) -> Result<Vec<LibraryTreeNodeDto>, BackendError> {
    serde_json::to_value(nodes)
        .and_then(serde_json::from_value)
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo leer el árbol de la biblioteca.", true))
}

/// The library root is only accessible after its binding is registered.
fn bind(app: &AppHandle, library: &CatalogLibrary) -> Result<(), BackendError> {
    let registry = app.state::<LibraryBindingRegistry>();
    #[cfg(target_os = "android")]
    {
        let tree_uri = library
            .android_tree_uri
            .as_deref()
            .ok_or_else(|| BackendError::invalid_input("La biblioteca Android necesita un grant SAF."))?;
        registry.register_android_tree(&library.id, tree_uri).map(|_| ())
    }
    #[cfg(not(target_os = "android"))]
    {
        registry
            .register_desktop_root_from_client(&library.id, std::path::Path::new(&library.path))
            .map(|_| ())
    }
}

/// Binds every library of the catalog at start, so background features
/// (Telegram, publication, agent) reach them without the interface.
pub(crate) fn rehydrate_bindings(app: &AppHandle) {
    let libraries = crate::library_catalog::catalog_libraries(app);
    for library in libraries {
        if let Err(error) = bind(app, &library) {
            log::warn!("[notia:library] binding no restaurado: {}", error.message);
        }
    }
}

/// Chat folders, agent workspace and SQLite database. A failing step is
/// logged and does not block the explorer.
fn prepare_structure(app: &AppHandle, library: &CatalogLibrary) {
    if let Err(error) = crate::chat_history::ensure_structure(app, &library.id) {
        log::warn!("[notia:library] estructura de chats no disponible: {}", error.message);
    }
    if let Err(error) = crate::agent_workspace::ensure_workspace(app, &library.id) {
        log::warn!("[notia:library] espacio del agente no disponible: {}", error.message);
    }
    let database = crate::database::initialize_library_database(
        app.clone(),
        crate::database::InitializeLibraryDatabasePayload {
            library_path: library.path.clone(),
            android_directory_uri: library.android_tree_uri.clone(),
        },
        app.state(),
    );
    if !database.ok {
        log::warn!("[notia:library] base SQLite no disponible: {}", database.error.unwrap_or_default());
    }
}

#[cfg(not(target_os = "android"))]
fn desktop_tree(library: &CatalogLibrary) -> Result<Vec<LibraryTreeNodeDto>, BackendError> {
    to_nodes(crate::filesystem::desktop::read_library_tree(
        crate::filesystem::types::ReadLibraryTreePayload {
            directory_path: library.path.clone(),
        },
    ))
}

#[cfg(not(target_os = "android"))]
fn desktop_signature(library: &CatalogLibrary) -> String {
    crate::filesystem::desktop::read_library_tree_signature(crate::filesystem::types::ReadLibraryTreePayload {
        directory_path: library.path.clone(),
    })
}

#[cfg(target_os = "android")]
async fn android_read(
    app: &AppHandle,
    library: &CatalogLibrary,
    directory_path: String,
    recursive: bool,
) -> Result<Vec<LibraryTreeNodeDto>, BackendError> {
    use crate::mobile_directory_picker::{read_android_directory, read_android_library_tree, ReadAndroidTreePayload};
    // The library's tree grant is the only context: a child document URI
    // never becomes the grant of another read.
    let payload = ReadAndroidTreePayload {
        directory_path,
        directory_uri: library.android_tree_uri.clone(),
    };
    let nodes = if recursive {
        read_android_library_tree(app.state(), payload).await
    } else {
        read_android_directory(app.state(), payload).await
    };
    to_nodes(nodes.map_err(|message| BackendError::new(BackendErrorCode::Storage, message, true))?)
}

fn blocking_error() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "La lectura de la biblioteca se interrumpió.", true)
}

/// Rebuilds the inventory used by search, Graph View and the agent tools.
pub(crate) fn reindex_in_background(app: &AppHandle, library_id: &str) {
    let app = app.clone();
    let library_id = library_id.to_string();
    crate::host::async_runtime::spawn_blocking(move || {
        match crate::library_inventory::reindex_library_if_changed(&app, &library_id) {
            // Saved notes schedule their own rebuild.
            Ok(true) => crate::library_graph::schedule_link_cache_rebuild(&app, &library_id),
            Ok(false) => {}
            Err(error) => log::warn!("[notia:library] no se pudo reindexar: {}", error.message),
        }
    });
}

/// A short fingerprint of a tree read on Android.
#[cfg(target_os = "android")]
fn tree_signature(nodes: &[LibraryTreeNodeDto]) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(nodes).unwrap_or_default().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn remember_signature(app: &AppHandle, library_id: &str, signature: String) -> bool {
    let state = app.state::<LibrarySessionState>();
    let Ok(mut signatures) = state.signatures.lock() else {
        return true;
    };
    let changed = signatures.get(library_id) != Some(&signature);
    signatures.insert(library_id.to_string(), signature);
    changed
}

#[cfg(not(target_os = "android"))]
fn watch(window: &Window, library: &CatalogLibrary) -> bool {
    let result = crate::filesystem::watch::start_library_tree_watch(
        window.clone(),
        crate::filesystem::watch::StartLibraryTreeWatchPayload {
            directory_path: library.path.clone(),
        },
        window.app_handle().state(),
    );
    if !result.ok {
        log::warn!("[notia:library] no se pudo vigilar la biblioteca");
    }
    result.ok
}

/// Binds, prepares and reads the library the interface opens.
pub(crate) async fn library_open(window: Window, payload: LibraryPayload) -> Result<LibraryTreeViewDto, BackendError> {
    let app = window.app_handle().clone();
    let library = catalog_entry(&app, &payload.library_id)?;
    {
        let (app, library) = (app.clone(), library.clone());
        crate::host::async_runtime::spawn_blocking(move || {
            if let Err(error) = bind(&app, &library) {
                log::warn!("[notia:library] no se pudo registrar la biblioteca: {}", error.message);
            }
            prepare_structure(&app, &library);
        })
        .await
        .map_err(|_| blocking_error())?;
    }

    #[cfg(target_os = "android")]
    let view = {
        let _ = &window;
        let nodes = android_read(&app, &library, library.path.clone(), false).await?;
        LibraryTreeViewDto {
            nodes: with_folder_contexts(&app, &library.id, shallow_listing(nodes), ""),
            lazy: true,
            watched: false,
        }
    };
    #[cfg(not(target_os = "android"))]
    let view = {
        let (reader, library_for_read) = (app.clone(), library.clone());
        let (nodes, signature) = crate::host::async_runtime::spawn_blocking(move || {
            let _ = &reader;
            desktop_tree(&library_for_read).map(|nodes| (nodes, desktop_signature(&library_for_read)))
        })
        .await
        .map_err(|_| blocking_error())??;
        remember_signature(&app, &library.id, signature);
        LibraryTreeViewDto {
            nodes: with_folder_contexts(&app, &library.id, normalize_tree(nodes), ""),
            lazy: false,
            watched: watch(&window, &library),
        }
    };
    reindex_in_background(&app, &library.id);
    Ok(view)
}

/// Re-reads the tree when it may have changed. On desktop an unchanged
/// signature skips the read; on Android, where there is no watcher, the
/// tree is read again.
pub(crate) async fn library_refresh(app: AppHandle, payload: LibraryRefreshPayload) -> Result<LibraryRefreshDto, BackendError> {
    let library = catalog_entry(&app, &payload.library_id)?;

    #[cfg(target_os = "android")]
    let nodes = {
        let nodes = normalize_tree(android_read(&app, &library, library.path.clone(), true).await?);
        let changed = remember_signature(&app, &library.id, tree_signature(&nodes));
        if !changed && !payload.force {
            return Ok(LibraryRefreshDto { changed: false, nodes: None });
        }
        nodes
    };
    #[cfg(not(target_os = "android"))]
    let nodes = {
        let library_for_read = library.clone();
        let signature = crate::host::async_runtime::spawn_blocking(move || desktop_signature(&library_for_read))
            .await
            .map_err(|_| blocking_error())?;
        let changed = remember_signature(&app, &library.id, signature);
        if !changed && !payload.force {
            return Ok(LibraryRefreshDto { changed: false, nodes: None });
        }
        let library_for_read = library.clone();
        normalize_tree(
            crate::host::async_runtime::spawn_blocking(move || desktop_tree(&library_for_read))
                .await
                .map_err(|_| blocking_error())??,
        )
    };
    reindex_in_background(&app, &library.id);
    Ok(LibraryRefreshDto {
        changed: true,
        nodes: Some(with_folder_contexts(&app, &library.id, nodes, "")),
    })
}

/// Children of a folder: the explorer loads Android folders on demand and
/// other views list a known folder by its logical path.
pub(crate) async fn library_read_directory(
    app: AppHandle,
    payload: LibraryDirectoryPayload,
) -> Result<Vec<LibraryTreeNodeDto>, BackendError> {
    read_directory(&app, &payload.library_id, &payload.path).await
}

/// Children of a folder of the library, by the path the interface holds or
/// a logical path.
pub(crate) async fn read_directory(
    app: &AppHandle,
    library_id: &str,
    path: &str,
) -> Result<Vec<LibraryTreeNodeDto>, BackendError> {
    let library = catalog_entry(app, library_id)?;
    let logical = logical_path_of(&library, path)?;
    let folder = notia_backend_core::library_tree::library_visible_path(&library.path, &logical);
    #[cfg(target_os = "android")]
    {
        Ok(with_folder_contexts(app, &library.id, shallow_listing(android_read(app, &library, folder, false).await?), &logical))
    }
    #[cfg(not(target_os = "android"))]
    {
        let inside = match (std::fs::canonicalize(&library.path), std::fs::canonicalize(&folder)) {
            (Ok(root), Ok(requested)) => requested.starts_with(root),
            _ => false,
        };
        if !inside {
            return Err(BackendError::new(
                BackendErrorCode::NotFound,
                "La carpeta no existe en la biblioteca.",
                false,
            ));
        }
        let nodes = crate::host::async_runtime::spawn_blocking(move || {
            to_nodes(crate::filesystem::desktop::read_library_tree(
                crate::filesystem::types::ReadLibraryTreePayload { directory_path: folder },
            ))
        })
        .await
        .map_err(|_| blocking_error())??;
        Ok(with_folder_contexts(app, &library.id, shallow_listing(nodes), &logical))
    }
}

/// The explorer nodes read from the folder `parent` (logical path), with
/// the context each folder has.
fn with_folder_contexts(app: &AppHandle, library_id: &str, mut nodes: Vec<LibraryTreeNodeDto>, parent: &str) -> Vec<LibraryTreeNodeDto> {
    notia_backend_core::folder_contexts::mark_tree(&mut nodes, parent, &crate::folder_contexts::load(app, library_id));
    nodes
}

/// Identity the explorer shows for a logical path of a library.
pub(crate) fn visible_path(app: &AppHandle, library_id: &str, logical_path: &str) -> String {
    match crate::library_catalog::catalog_library(app, library_id) {
        Some(library) => notia_backend_core::library_tree::library_visible_path(&library.path, logical_path),
        None => logical_path.to_string(),
    }
}

/// Text of a library file by its logical path, for the chat context.
pub(crate) fn read_library_text(app: &AppHandle, library_id: &str, logical_path: &str) -> Result<String, BackendError> {
    let library = catalog_entry(app, library_id)?;
    let result = read_document(
        app,
        LibraryDocumentPayload {
            library_id: library.id.clone(),
            path: notia_backend_core::library_tree::library_visible_path(&library.path, logical_path),
            content: None,
            expected_revision: None,
            create_if_missing: false,
            markdown_defaults: false,
            base_content: None,
        },
    );
    if result.ok {
        Ok(result.content)
    } else {
        Err(BackendError::new(BackendErrorCode::Storage, result.error.unwrap_or_else(|| "No se pudo leer el archivo.".to_string()), true))
    }
}

/// Logical path of a library entry from the identity the interface holds
/// (the path the explorer shows or an already logical path).
pub(crate) fn resolve_logical_path(app: &AppHandle, library_id: &str, identity: &str) -> Result<String, BackendError> {
    logical_path_of(&catalog_entry(app, library_id)?, identity)
}

fn logical_path_of(library: &CatalogLibrary, identity: &str) -> Result<String, BackendError> {
    notia_backend_core::library_tree::library_logical_path(&library.path, identity).ok_or_else(|| {
        BackendError::new(BackendErrorCode::Forbidden, "La ruta está fuera de la biblioteca activa.", false)
    })
}

fn is_markdown(logical_path: &str) -> bool {
    logical_path.to_ascii_lowercase().ends_with(".md")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryDocumentPayload {
    pub(crate) library_id: String,
    /// Identity of the document as the explorer shows it.
    pub(crate) path: String,
    #[serde(default)]
    pub(crate) content: Option<String>,
    #[serde(default)]
    pub(crate) expected_revision: Option<String>,
    #[serde(default)]
    pub(crate) create_if_missing: bool,
    /// On read, add the default note frontmatter when it is missing (the
    /// editor opening a note); other reads leave the file untouched.
    #[serde(default)]
    pub(crate) markdown_defaults: bool,
    /// On write, the text the editor last read or saved: when the file
    /// changed since (the agent, another device), both changes are merged.
    #[serde(default)]
    pub(crate) base_content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryDocumentReadDto {
    pub(crate) ok: bool,
    pub(crate) content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    /// Path of the document inside the library.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) logical_path: Option<String>,
    /// Context the note must keep because it lives in a Task Manager board
    /// or in a folder with a context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) locked_context: Option<String>,
    /// What sets `locked_context`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) locked_context_source: Option<LockedContextSource>,
    /// Why the document opens read-only: a file only the AI writes
    /// (`#System`). Every write of it is refused anyway.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) read_only: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LockedContextSource {
    Board,
    Folder,
}

/// A note opened in the editor takes what its folder forces (its context,
/// `publicado` in a published folder), written over the revision just read. When that write fails the stored content is
/// kept, so the editor never shows what is not on disk.
fn with_folder_context(
    app: &AppHandle,
    library_id: &str,
    logical_path: &str,
    result: &mut crate::filesystem::types::ReadLibraryFileResult,
) {
    let Some(updated) = crate::folder_contexts::enforced(app, library_id, logical_path, &result.content) else { return };
    let revision = crate::filesystem::types::content_revision(&result.content);
    let written = crate::library_documents::with_documents(app, library_id, |documents| {
        documents.adapter.write_locator(&documents.locator(logical_path)?, &updated, Some(&revision))
    });
    match written {
        Ok(()) => {
            result.revision = Some(crate::filesystem::types::content_revision(&updated));
            result.content = updated;
        }
        Err(error) => log::warn!("[notia:folder-contexts] la nota no tomó el contexto de su carpeta code={:?}", error.code),
    }
}

/// Reads a document of the library. With `markdownDefaults`, a note gets
/// the default frontmatter when it is missing, persisted against the
/// revision just read.
pub(crate) fn library_read_document(app: AppHandle, mut payload: LibraryDocumentPayload) -> LibraryDocumentReadDto {
    let library_id = payload.library_id.clone();
    let logical_path = catalog_entry(&app, &payload.library_id)
        .and_then(|library| logical_path_of(&library, &payload.path))
        .ok();
    // A file only the AI writes opens as it is: no note defaults, no
    // folder context.
    let system = logical_path.as_deref().is_some_and(notia_backend_core::agent_workspace::is_system_file);
    if system {
        payload.markdown_defaults = false;
    }
    // Only the editor opening a note asks for its defaults: Home lists it.
    let opened_in_editor = payload.markdown_defaults;
    let mut result = read_document(&app, payload);
    if let Some(path) = logical_path.as_deref().filter(|path| opened_in_editor && result.ok && is_markdown(path)) {
        crate::recent_documents::record(&app, &library_id, path);
        with_folder_context(&app, &library_id, path, &mut result);
    }
    let locked_context = logical_path.as_deref().filter(|path| result.ok && is_markdown(path)).and_then(|path| {
        crate::task_manager_commands::board_context_of_document(&app, &library_id, path)
            .map(|tag| (tag, LockedContextSource::Board))
            .or_else(|| crate::folder_contexts::effective(&app, &library_id, path).map(|tag| (tag, LockedContextSource::Folder)))
    });
    let (locked_context, locked_context_source) = locked_context.unzip();
    LibraryDocumentReadDto {
        locked_context,
        locked_context_source,
        read_only: (system && result.ok).then(|| SYSTEM_FILE_READ_ONLY.to_string()),
        logical_path: result.ok.then_some(logical_path).flatten(),
        ok: result.ok,
        content: result.content,
        revision: result.revision,
        error: result.error,
    }
}

pub(crate) fn read_document(app: &AppHandle, payload: LibraryDocumentPayload) -> crate::filesystem::types::ReadLibraryFileResult {
    let app = app.clone();
    let failure = |error: BackendError| crate::filesystem::types::ReadLibraryFileResult {
        ok: false,
        content: String::new(),
        revision: None,
        error: Some(error.message),
    };
    let library = match catalog_entry(&app, &payload.library_id) {
        Ok(library) => library,
        Err(error) => return failure(error),
    };
    let logical_path = match logical_path_of(&library, &payload.path) {
        Ok(path) => path,
        Err(error) => return failure(error),
    };
    if is_markdown(&logical_path) {
        return crate::filesystem::commands::backend_read_library_document(
            crate::filesystem::commands::BackendDocumentPayload {
                library_id: library.id,
                logical_path,
                content: None,
                expected_revision: None,
                create_if_missing: false,
                ensure_markdown_defaults: payload.markdown_defaults,
            },
            app.state(),
            app.state(),
        );
    }
    let read = (|| {
        let adapter = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
            app.state::<LibraryBindingRegistry>().inner(),
            &library.id,
            app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>().inner(),
        )?;
        let locator = crate::backend::DocumentLocatorDto::new(&library.id, &logical_path, None, None)?;
        adapter.read_locator(&locator)
    })();
    match read {
        Ok(content) => crate::filesystem::types::ReadLibraryFileResult {
            ok: true,
            revision: Some(crate::filesystem::types::content_revision(&content)),
            content,
            error: None,
        },
        Err(error) => failure(error),
    }
}

/// Writes a document of the library, only over the revision the editor
/// loaded or saved when one is given.
pub(crate) fn library_write_document(
    app: AppHandle,
    payload: LibraryDocumentPayload,
) -> crate::filesystem::types::WriteLibraryFileResult {
    let resolved = catalog_entry(&app, &payload.library_id)
        .and_then(|library| logical_path_of(&library, &payload.path).map(|path| (library, path)));
    let (library, logical_path) = match resolved {
        Ok(resolved) => resolved,
        Err(error) => {
            return crate::filesystem::types::WriteLibraryFileResult {
                ok: false,
                revision: None,
                error: Some(error.message),
                conflict: None,
            }
        }
    };
    let markdown = is_markdown(&logical_path);
    let library_id = library.id.clone();
    let content = payload
        .content
        .map(|content| if markdown { crate::folder_contexts::enforce(&app, &library_id, &logical_path, content) } else { content });
    if let Some(refusal) = system_write_refusal(&logical_path, content.as_deref()) {
        return crate::filesystem::types::WriteLibraryFileResult {
            ok: false,
            revision: None,
            error: Some(refusal.to_string()),
            conflict: None,
        };
    }
    let result = crate::filesystem::commands::backend_write_library_document(
        crate::filesystem::commands::BackendDocumentPayload {
            library_id: library.id,
            logical_path,
            content,
            expected_revision: payload.expected_revision,
            create_if_missing: payload.create_if_missing,
            ensure_markdown_defaults: false,
        },
        app.state(),
        app.state(),
    );
    // Links between notes may have changed.
    if result.ok && markdown {
        crate::library_graph::schedule_link_cache_rebuild(&app, &library_id);
    }
    result
}

/// What an editor's save wrote.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibrarySaveDto {
    #[serde(flatten)]
    result: crate::filesystem::types::WriteLibraryFileResult,
    /// The text written when it is not the one sent: the editor's merged
    /// with what changed in the file.
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    /// Places where both changed the same lines and both versions stayed.
    #[serde(skip_serializing_if = "Option::is_none")]
    merge_conflicts: Option<usize>,
}

/// A file that changes again between reading and writing is merged again.
const MAX_MERGE_ATTEMPTS: usize = 3;

/// The editor's save. When the file changed since the editor's revision and
/// the editor sent the text it started from, nothing is refused: its
/// changes and the file's are merged (`text_merge`) and the merge written.
pub(crate) fn library_save_document(app: AppHandle, payload: LibraryDocumentPayload) -> LibrarySaveDto {
    let plain = |result| LibrarySaveDto { result, content: None, merge_conflicts: None };
    let (Some(base), Some(mine)) = (payload.base_content.clone(), payload.content.clone()) else {
        return plain(library_write_document(app, payload));
    };
    let mut result = library_write_document(
        app.clone(),
        LibraryDocumentPayload { content: Some(mine.clone()), base_content: None, ..payload.clone_without_content() },
    );
    for _ in 0..MAX_MERGE_ATTEMPTS {
        if result.conflict.is_none() {
            break;
        }
        let current = read_document(&app, LibraryDocumentPayload { content: None, expected_revision: None, base_content: None, ..payload.clone_without_content() });
        let Some(revision) = current.revision.filter(|_| current.ok) else { break };
        let merged = notia_backend_core::text_merge::merge_texts(&base, &mine, &current.content);
        let written = match resolve_logical_path(&app, &payload.library_id, &payload.path) {
            Ok(path) if is_markdown(&path) => crate::folder_contexts::enforce(&app, &payload.library_id, &path, merged.content),
            _ => merged.content,
        };
        result = library_write_document(
            app.clone(),
            LibraryDocumentPayload {
                content: Some(written.clone()),
                expected_revision: Some(revision),
                base_content: None,
                ..payload.clone_without_content()
            },
        );
        if result.ok {
            return LibrarySaveDto { result, content: Some(written), merge_conflicts: Some(merged.conflicts) };
        }
    }
    plain(result)
}

impl LibraryDocumentPayload {
    /// The same document, without content or revision.
    fn clone_without_content(&self) -> Self {
        Self {
            library_id: self.library_id.clone(),
            path: self.path.clone(),
            content: None,
            expected_revision: self.expected_revision.clone(),
            create_if_missing: self.create_if_missing,
            markdown_defaults: false,
            base_content: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryEntryPayload {
    library_id: String,
    /// `create`, `delete`, `rename` or `paste`.
    action: String,
    /// Entry to delete or rename, parent folder for `create`, destination
    /// folder for `paste`, as the explorer shows them.
    path: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    source_path: Option<String>,
    #[serde(default)]
    mode: Option<String>,
}

/// Creates, deletes, renames, copies or moves an explorer entry.
pub(crate) fn library_mutate_entry(
    app: AppHandle,
    payload: LibraryEntryPayload,
) -> crate::filesystem::types::OperationResult {
    let resolved = catalog_entry(&app, &payload.library_id).and_then(|library| {
        let logical_path = logical_path_of(&library, &payload.path)?;
        let source_logical_path = payload
            .source_path
            .as_deref()
            .map(|source| logical_path_of(&library, source))
            .transpose()?;
        if payload.action != "create" && logical_path.is_empty() && payload.action != "paste" {
            return Err(BackendError::invalid_input("La raíz de la biblioteca no se puede modificar."));
        }
        Ok((library, logical_path, source_logical_path))
    });
    let (library, logical_path, source_logical_path) = match resolved {
        Ok(resolved) => resolved,
        Err(error) => {
            return crate::filesystem::types::OperationResult {
                ok: false,
                error: Some(error.message),
            }
        }
    };
    apply_entry_operation(
        &app,
        crate::filesystem::commands::BackendLibraryEntryPayload {
            library_id: library.id,
            action: payload.action,
            logical_path,
            name: payload.name,
            kind: payload.kind,
            source_logical_path,
            mode: payload.mode,
        },
    )
}

/// Runs an explorer operation on logical paths the caller already checked
/// (the published page), as `library_mutate_entry` does for the explorer.
#[allow(clippy::too_many_arguments)]
pub(crate) fn mutate_entry_at(
    app: &AppHandle,
    library_id: &str,
    action: &str,
    logical_path: &str,
    name: Option<&str>,
    kind: Option<&str>,
    source_logical_path: Option<&str>,
    mode: Option<&str>,
) -> crate::filesystem::types::OperationResult {
    if action != "create" && action != "paste" && logical_path.is_empty() {
        return crate::filesystem::types::OperationResult {
            ok: false,
            error: Some("La raíz de la biblioteca no se puede modificar.".to_string()),
        };
    }
    apply_entry_operation(
        app,
        crate::filesystem::commands::BackendLibraryEntryPayload {
            library_id: library_id.to_string(),
            action: action.to_string(),
            logical_path: logical_path.to_string(),
            name: name.map(str::to_string),
            kind: kind.map(str::to_string),
            source_logical_path: source_logical_path.map(str::to_string),
            mode: mode.map(str::to_string),
        },
    )
}

/// Moves a file or folder of a library into another folder for the agent,
/// creating the missing destination folders, as the explorer moves an entry.
pub(crate) fn move_entry(
    app: &AppHandle,
    library_id: &str,
    entry_move: &notia_backend_core::library_tools::EntryMove,
) -> Result<(), BackendError> {
    let folder = entry_move.target_folder.as_ref().map(|folder| folder.as_str().to_string()).unwrap_or_default();
    crate::filesystem::commands::ensure_library_folders(
        app.state::<crate::library_registry::LibraryBindingRegistry>().inner(),
        app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>().inner(),
        library_id,
        &folder,
    )?;
    let result = apply_entry_operation(
        app,
        crate::filesystem::commands::BackendLibraryEntryPayload {
            library_id: library_id.to_string(),
            action: "paste".to_string(),
            logical_path: folder,
            name: None,
            kind: None,
            source_logical_path: Some(entry_move.source.as_str().to_string()),
            mode: Some("move".to_string()),
        },
    );
    if result.ok {
        Ok(())
    } else {
        Err(crate::filesystem::adapter::map_filesystem_error(
            result.error.as_deref().unwrap_or("Could not paste entry."),
        ))
    }
}

const SYSTEM_FILE_READ_ONLY: &str = "Este archivo lo escribe solo la IA (contexto #System): se puede leer, pero no editar a mano.";
const SYSTEM_CONTEXT_RESERVED: &str = "El contexto #System es solo de los archivos que escribe la IA: elegí otro contexto para esta nota.";
const SYSTEM_ENTRY_LOCKED: &str = "Los archivos que escribe solo la IA (contexto #System) y las carpetas que los contienen no se borran, renombran, mueven ni copian a mano.";

/// Why a person's write of `logical_path` with `content` is refused: the
/// file is one only the AI writes, or the note would take the reserved
/// `#System` context. The AI writes its files through `agent_workspace`,
/// never through this path.
fn system_write_refusal(logical_path: &str, content: Option<&str>) -> Option<&'static str> {
    if notia_backend_core::agent_workspace::is_system_file(logical_path) {
        return Some(SYSTEM_FILE_READ_ONLY);
    }
    let takes_system = is_markdown(logical_path)
        && content
            .and_then(notia_backend_core::library_graph::frontmatter_context)
            .is_some_and(|tag| notia_backend_core::library_config::is_system_context(&tag));
    takes_system.then_some(SYSTEM_CONTEXT_RESERVED)
}

/// Whether an explorer operation deletes, renames, moves or copies a file
/// only the AI writes (or a folder holding one), or creates or renames an
/// entry onto one of their paths.
fn touches_system_files(payload: &crate::filesystem::commands::BackendLibraryEntryPayload) -> bool {
    use notia_backend_core::agent_workspace::{holds_system_files, is_system_file};
    let lands_on_system_file = |parent: &str| {
        let Some(name) = payload.name.as_deref().map(str::trim).filter(|name| !name.is_empty()) else { return false };
        let target = match parent.trim_matches('/') {
            "" => name.to_string(),
            parent => format!("{parent}/{name}"),
        };
        is_system_file(&target) || is_system_file(&format!("{target}.md"))
    };
    match payload.action.as_str() {
        "delete" => holds_system_files(&payload.logical_path),
        "rename" => {
            let parent = payload.logical_path.trim_matches('/').rsplit_once('/').map_or("", |(parent, _)| parent);
            holds_system_files(&payload.logical_path) || lands_on_system_file(parent)
        }
        "paste" => payload.source_logical_path.as_deref().is_some_and(holds_system_files),
        "create" => lands_on_system_file(&payload.logical_path),
        _ => false,
    }
}

/// Runs an entry operation on logical paths; the handwriting of the notes
/// follows them (`.notia/ink`) and the library is indexed again.
fn apply_entry_operation(
    app: &AppHandle,
    payload: crate::filesystem::commands::BackendLibraryEntryPayload,
) -> crate::filesystem::types::OperationResult {
    if touches_system_files(&payload) {
        return crate::filesystem::types::OperationResult { ok: false, error: Some(SYSTEM_ENTRY_LOCKED.to_string()) };
    }
    let library_id = payload.library_id.clone();
    let ink_change = crate::note_ink::plan_entry_change(
        app,
        &library_id,
        &payload.action,
        &payload.logical_path,
        payload.name.as_deref(),
        payload.source_logical_path.as_deref(),
        payload.mode.as_deref(),
    );
    let files_before = ink_change
        .as_ref()
        .map(|change| crate::folder_contexts::files_before(app, &library_id, change))
        .unwrap_or_default();
    let created_note = (payload.action == "create" && payload.kind.as_deref() == Some("note")).then(|| {
        let file_name = crate::filesystem::validation::normalize_library_entry_name("note", payload.name.as_deref().unwrap_or_default());
        match payload.logical_path.trim().trim_matches('/') {
            "" => file_name,
            parent => format!("{parent}/{file_name}"),
        }
    });
    let result = crate::filesystem::commands::backend_library_entry_operation(payload, app.state(), app.state());
    if result.ok {
        if let Some(change) = &ink_change {
            crate::note_ink::apply_entry_change(app, &library_id, change);
            crate::folder_contexts::apply_entry_change(app, &library_id, change, &files_before);
        }
        if let Some(note) = &created_note {
            crate::folder_contexts::apply_to_new_note(app, &library_id, note);
        }
        reindex_in_background(app, &library_id);
    }
    result
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedLibraryDto {
    name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    android_tree_uri: Option<String>,
}

/// How long the Android folder picker may stay open before the request is
/// treated as abandoned; the picker itself cannot be cancelled from here.
#[cfg(target_os = "android")]
const ANDROID_PICKER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Opens the platform folder picker for a new library and binds the chosen
/// root to `libraryId`. `None` when the person cancels.
pub(crate) async fn library_pick_directory(
    app: AppHandle,
    payload: LibraryPayload,
) -> Result<Option<PickedLibraryDto>, BackendError> {
    #[cfg(target_os = "android")]
    {
        let picker_app = app.clone();
        let library_id = payload.library_id.clone();
        let pick = crate::host::async_runtime::spawn_blocking(move || {
            crate::mobile_directory_picker::pick_android_directory_tree(
                picker_app.state(),
                picker_app.state(),
                Some(crate::mobile_directory_picker::PickAndroidDirectoryTreePayload {
                    library_id: Some(library_id),
                }),
            )
        });
        let selected = tokio::time::timeout(ANDROID_PICKER_TIMEOUT, pick)
            .await
            .map_err(|_| {
                BackendError::new(
                    BackendErrorCode::Timeout,
                    "El selector de carpetas tardó demasiado. Intenta nuevamente.",
                    true,
                )
            })?
            .map_err(|_| blocking_error())?
            .map_err(|message| BackendError::new(BackendErrorCode::Storage, message, true))?;
        let _ = &app;
        let tree_uri = selected.uri.unwrap_or_default();
        return Ok(Some(PickedLibraryDto {
            name: notia_backend_core::library_tree::library_display_name(&tree_uri),
            path: tree_uri.clone(),
            android_tree_uri: Some(tree_uri),
        }));
    }
    #[cfg(not(target_os = "android"))]
    {
        let picked = crate::host::async_runtime::spawn_blocking(move || {
            crate::library_registry::pick_library_directory(
                app.clone(),
                app.state(),
                crate::library_registry::PickLibraryDirectoryPayload {
                    library_id: payload.library_id,
                },
            )
        })
        .await
        .map_err(|_| blocking_error())??;
        Ok(picked.map(|picked| {
            // The catalog keeps desktop roots with forward slashes.
            let path = notia_backend_core::library_tree::normalize_entry_path(&picked.path);
            PickedLibraryDto {
                name: notia_backend_core::library_tree::library_display_name(&path),
                path,
                android_tree_uri: None,
            }
        }))
    }
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryFileDto {
    /// Identity the explorer shows.
    path: String,
    name: String,
    /// Path inside the library.
    relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryFolderDto {
    /// Identity the explorer shows.
    path: String,
    name: String,
    /// Path inside the library.
    relative_path: String,
    /// Files inside the folder, subfolders included.
    file_count: usize,
}

/// Every folder of the library that holds files, from the inventory.
pub(crate) async fn library_list_folders(app: AppHandle, payload: LibraryPayload) -> Result<Vec<LibraryFolderDto>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let library = catalog_entry(&app, &payload.library_id)?;
        let (paths, _) = crate::library_inventory::inventory_files(&app, &library.id)?;
        Ok(notia_backend_core::chat_context::library_folders(&paths)
            .into_iter()
            .map(|folder| LibraryFolderDto {
                path: notia_backend_core::library_tree::library_visible_path(&library.path, &folder.path),
                name: folder.path.rsplit('/').next().unwrap_or(&folder.path).to_string(),
                relative_path: folder.path,
                file_count: folder.file_count,
            })
            .collect())
    })
    .await
    .map_err(|_| blocking_error())?
}

/// Every file of the library, from the inventory kept by the backend.
pub(crate) async fn library_list_files(app: AppHandle, payload: LibraryPayload) -> Result<Vec<LibraryFileDto>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let library = catalog_entry(&app, &payload.library_id)?;
        let (paths, _) = crate::library_inventory::inventory_files(&app, &library.id)?;
        let mut files = paths
            .into_iter()
            .map(|logical| LibraryFileDto {
                path: notia_backend_core::library_tree::library_visible_path(&library.path, &logical),
                name: logical.rsplit('/').next().unwrap_or(&logical).to_string(),
                relative_path: logical,
            })
            .collect::<Vec<_>>();
        files.sort_by(|left, right| left.relative_path.to_lowercase().cmp(&right.relative_path.to_lowercase()));
        Ok(files)
    })
    .await
    .map_err(|_| blocking_error())?
}

#[cfg(test)]
mod tests {
    use crate::filesystem::commands::BackendLibraryEntryPayload;

    fn entry(action: &str, path: &str, name: Option<&str>, source: Option<&str>) -> BackendLibraryEntryPayload {
        BackendLibraryEntryPayload {
            library_id: "library-1".into(),
            action: action.into(),
            logical_path: path.into(),
            name: name.map(str::to_string),
            kind: None,
            source_logical_path: source.map(str::to_string),
            mode: None,
        }
    }

    #[test]
    fn the_person_only_reads_the_files_the_ai_writes() {
        let refusal = |path: &str, content: Option<&str>| super::system_write_refusal(path, content);
        assert_eq!(refusal(".agent/memory/memory.md", Some("- dato")), Some(super::SYSTEM_FILE_READ_ONLY));
        assert_eq!(refusal(".agent/memory/improve.md", None), Some(super::SYSTEM_FILE_READ_ONLY));
        // Prompts, skills and notes stay editable; no note takes #System.
        assert_eq!(refusal(".agent/promps/mio.md", Some("hola")), None);
        assert_eq!(refusal("Ideas/a.md", Some("---\ncontexto: \"#Personal\"\n---\nhola")), None);
        assert_eq!(refusal("Ideas/a.md", Some("---\ncontexto: \"#System\"\n---\nhola")), Some(super::SYSTEM_CONTEXT_RESERVED));
        assert_eq!(refusal("Ideas/a.txt", Some("---\ncontexto: \"#System\"\n---\n")), None);
    }

    #[test]
    fn explorer_operations_never_touch_the_files_the_ai_writes() {
        let touches = |payload: BackendLibraryEntryPayload| super::touches_system_files(&payload);
        assert!(touches(entry("delete", ".agent/memory/people.md", None, None)));
        assert!(touches(entry("delete", ".agent", None, None)));
        assert!(touches(entry("rename", ".agent/memory", Some("viejo"), None)));
        assert!(touches(entry("rename", ".agent/memory/notas.md", Some("memory.md"), None)));
        assert!(touches(entry("paste", "Ideas", None, Some(".agent/memory/talk.md"))));
        assert!(touches(entry("create", ".agent/memory", Some("improve"), None)));
        assert!(!touches(entry("delete", ".agent/promps/mio.md", None, None)));
        assert!(!touches(entry("rename", "Ideas/a.md", Some("memory.md"), None)));
        assert!(!touches(entry("paste", ".agent/memory", None, Some("Ideas/a.md"))));
        assert!(!touches(entry("create", ".agent/memory", Some("otra.md"), None)));
    }
}
