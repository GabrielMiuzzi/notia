//! Opening and refreshing the explorer of a library.
//!
//! The interface names the library it shows; the backend binds it from the
//! catalog, prepares its structure (chats, agent workspace, SQLite), reads
//! the tree the way the platform allows (the full tree on desktop, the root
//! listing on Android, whose folders load on demand), watches it on desktop,
//! keeps the inventory up to date and decides whether a refresh needs a new
//! read. Every node comes out normalized and in explorer order.

#[cfg(not(target_os = "android"))]
use std::collections::HashMap;
#[cfg(not(target_os = "android"))]
use std::sync::Mutex;

use notia_backend_core::library_tree::{normalize_tree, shallow_listing, LibraryTreeNodeDto};
use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager, Window};

use crate::backend::{BackendError, BackendErrorCode};
use crate::library_catalog::CatalogLibrary;
use crate::library_registry::LibraryBindingRegistry;

/// Last tree signature seen per library, to skip desktop reads when nothing
/// moved (Android has no cheap signature and re-reads).
#[derive(Default)]
pub(crate) struct LibrarySessionState {
    #[cfg(not(target_os = "android"))]
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
fn reindex_in_background(app: &AppHandle, library_id: &str) {
    let app = app.clone();
    let library_id = library_id.to_string();
    crate::host::async_runtime::spawn_blocking(move || {
        match crate::library_inventory::reindex_library(&app, &library_id) {
            Ok(_) => crate::library_graph::schedule_link_cache_rebuild(&app, &library_id),
            Err(error) => log::warn!("[notia:library] no se pudo reindexar: {}", error.message),
        }
    });
}

#[cfg(not(target_os = "android"))]
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
            nodes: shallow_listing(nodes),
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
            nodes: normalize_tree(nodes),
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
        let _ = payload.force;
        normalize_tree(android_read(&app, &library, library.path.clone(), true).await?)
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
        nodes: Some(nodes),
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
        Ok(shallow_listing(android_read(app, &library, folder, false).await?))
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
        Ok(shallow_listing(nodes))
    }
}

/// Identity the explorer shows for a logical path of a library.
pub(crate) fn visible_path(app: &AppHandle, library_id: &str, logical_path: &str) -> String {
    match crate::library_catalog::catalog_library(app, library_id) {
        Some(library) => notia_backend_core::library_tree::library_visible_path(&library.path, logical_path),
        None => logical_path.to_string(),
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
    library_id: String,
    /// Identity of the document as the explorer shows it.
    path: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    expected_revision: Option<String>,
    #[serde(default)]
    create_if_missing: bool,
    /// On read, add the default note frontmatter when it is missing (the
    /// editor opening a note); other reads leave the file untouched.
    #[serde(default)]
    markdown_defaults: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryDocumentReadDto {
    ok: bool,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Path of the document inside the library.
    #[serde(skip_serializing_if = "Option::is_none")]
    logical_path: Option<String>,
    /// Context the note must keep because it lives in a Task Manager board.
    #[serde(skip_serializing_if = "Option::is_none")]
    locked_context: Option<String>,
}

/// Reads a document of the library. With `markdownDefaults`, a note gets
/// the default frontmatter when it is missing, persisted against the
/// revision just read.
pub(crate) fn library_read_document(app: AppHandle, payload: LibraryDocumentPayload) -> LibraryDocumentReadDto {
    let library_id = payload.library_id.clone();
    let logical_path = catalog_entry(&app, &payload.library_id)
        .and_then(|library| logical_path_of(&library, &payload.path))
        .ok();
    let result = read_document(&app, payload);
    let locked_context = logical_path
        .as_deref()
        .filter(|path| result.ok && is_markdown(path))
        .and_then(|path| crate::task_manager_commands::board_context_of_document(&app, &library_id, path));
    LibraryDocumentReadDto {
        locked_context,
        logical_path: result.ok.then_some(logical_path).flatten(),
        ok: result.ok,
        content: result.content,
        revision: result.revision,
        error: result.error,
    }
}

fn read_document(app: &AppHandle, payload: LibraryDocumentPayload) -> crate::filesystem::types::ReadLibraryFileResult {
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
    let result = crate::filesystem::commands::backend_write_library_document(
        crate::filesystem::commands::BackendDocumentPayload {
            library_id: library.id,
            logical_path,
            content: payload.content,
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
    let library_id = library.id.clone();
    let result = crate::filesystem::commands::backend_library_entry_operation(
        crate::filesystem::commands::BackendLibraryEntryPayload {
            library_id: library.id,
            action: payload.action,
            logical_path,
            name: payload.name,
            kind: payload.kind,
            source_logical_path,
            mode: payload.mode,
        },
        app.state(),
        app.state(),
    );
    if result.ok {
        reindex_in_background(&app, &library_id);
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
