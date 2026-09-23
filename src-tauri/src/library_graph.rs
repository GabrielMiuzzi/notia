//! Graph View and link cache commands. The backend reads the inventory and
//! the Markdown sources, resolves links and contexts, and returns the model;
//! the WebView only lays it out.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::backend::library_graph::{
    build_library_graph, is_markdown_path, render_link_cache, search_library_files, search_library_graph, GraphContext,
    GraphModelDto,
    GraphSearchResultDto,
};
use crate::backend::{BackendError, BackendErrorCode, DocumentLocatorDto, TaskManagerSnapshotStore};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

/// Markdown documents read per graph and their total size.
const MAX_GRAPH_SOURCES: usize = 5_000;
const MAX_GRAPH_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_CACHED_GRAPHS: usize = 8;

#[derive(Default)]
pub(crate) struct LibraryGraphState {
    /// library → (inventory generation, client revision, graph)
    cache: Mutex<HashMap<String, (i64, u64, Arc<BuiltGraph>)>>,
}

/// Model plus the Markdown sources it was built from (for content search).
pub(crate) struct BuiltGraph {
    model: GraphModelDto,
    sources: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryGraphPayload {
    library_id: String,
    /// Index revision of the client; a new value re-reads the sources.
    #[serde(default)]
    revision: u64,
}

fn context_catalog(app: &AppHandle, library_id: &str) -> Vec<GraphContext> {
    let config = crate::library_config::read_library_config(app, library_id)
        .ok()
        .flatten()
        .unwrap_or_else(crate::backend::library_config::default_library_config);
    config
        .get("contexts")
        .and_then(serde_json::Value::as_array)
        .map(|contexts| {
            contexts
                .iter()
                .filter_map(|context| {
                    Some(GraphContext {
                        tag: context.get("tag")?.as_str()?.to_string(),
                        color: context.get("color")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Board context tags by lower-case board name; tickets inherit them.
fn board_contexts(app: &AppHandle, library_id: &str) -> HashMap<String, String> {
    let registry = app.state::<LibraryBindingRegistry>();
    let store = crate::task_manager_store::MarkdownTaskManagerStore::new(
        library_id.to_string(),
        registry.inner().clone(),
        Arc::new(Mutex::new(())),
    )
    .with_app(app.clone());
    store
        .load(library_id)
        .ok()
        .flatten()
        .map(|snapshot| {
            snapshot
                .boards
                .into_iter()
                .filter_map(|board| board.context.map(|context| (board.name.to_lowercase(), context)))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn build_graph(app: &AppHandle, library_id: &str) -> Result<(i64, BuiltGraph), BackendError> {
    let (files, generation) = crate::library_inventory::inventory_files(app, library_id)?;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), library_id, picker.inner())?;
    let mut sources = BTreeMap::new();
    let mut total = 0usize;
    for path in files.iter().filter(|path| is_markdown_path(path)).take(MAX_GRAPH_SOURCES) {
        let Ok(locator) = DocumentLocatorDto::new(library_id, path, None, None) else {
            continue;
        };
        // Unreadable documents stay as nodes without outgoing links.
        let Ok(content) = adapter.read_locator(&locator) else {
            continue;
        };
        total = total.saturating_add(content.len());
        if total > MAX_GRAPH_SOURCE_BYTES {
            break;
        }
        sources.insert(path.clone(), content);
    }
    let model = build_library_graph(
        &files,
        &sources,
        &context_catalog(app, library_id),
        &board_contexts(app, library_id),
    );
    Ok((generation, BuiltGraph { model, sources }))
}

/// Cached graph for the inventory generation and client revision.
fn cached_graph(app: &AppHandle, library_id: &str, revision: u64) -> Result<Arc<BuiltGraph>, BackendError> {
    let state = app.state::<LibraryGraphState>();
    let (_, generation) = crate::library_inventory::inventory_files(app, library_id)?;
    if let Some((cached_generation, cached_revision, graph)) =
        state.cache.lock().ok().and_then(|cache| cache.get(library_id).cloned())
    {
        if cached_generation == generation && cached_revision == revision {
            return Ok(graph);
        }
    }
    let (generation, graph) = build_graph(app, library_id)?;
    let graph = Arc::new(graph);
    if let Ok(mut cache) = state.cache.lock() {
        if cache.len() >= MAX_CACHED_GRAPHS && !cache.contains_key(library_id) {
            if let Some(key) = cache.keys().next().cloned() {
                cache.remove(&key);
            }
        }
        cache.insert(library_id.to_string(), (generation, revision, graph.clone()));
    }
    Ok(graph)
}

/// Graph View model of a library; paths are logical paths of the library.
#[tauri::command]
pub(crate) async fn backend_library_graph(
    app: AppHandle,
    payload: LibraryGraphPayload,
) -> Result<GraphModelDto, BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(cached_graph(&app, &payload.library_id, payload.revision)?.model.clone())
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo construir el grafo.", true))?
}

/// Regenerates `.notia/linkCache.md` from the current graph.
#[tauri::command]
pub(crate) async fn backend_rebuild_link_cache(
    app: AppHandle,
    payload: LibraryGraphPayload,
) -> Result<(), BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, graph) = build_graph(&app, &payload.library_id)?;
        let model = graph.model;
        let registry = app.state::<LibraryBindingRegistry>();
        let picker = app.state::<AndroidDirectoryPickerState>();
        let locator = DocumentLocatorDto::new(&payload.library_id, ".notia/linkCache.md", None, None)?;
        let content = render_link_cache(&model);
        let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), &payload.library_id, picker.inner())?;
        if adapter.exists_locator(&locator)? && adapter.read_locator(&locator).ok().as_deref() == Some(content.as_str()) {
            return Ok(());
        }
        adapter.upsert_text_locator(&locator, &content)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo regenerar el cache de enlaces.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryGraphSearchPayload {
    library_id: String,
    #[serde(default)]
    revision: u64,
    query: String,
    #[serde(default)]
    max_results: Option<usize>,
}

/// Title and content search of Graph View over the cached sources.
#[tauri::command]
pub(crate) async fn backend_library_graph_search(
    app: AppHandle,
    payload: LibraryGraphSearchPayload,
) -> Result<Vec<GraphSearchResultDto>, BackendError> {
    if payload.query.chars().count() > 200 {
        return Err(BackendError::invalid_input("La búsqueda es demasiado larga."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let graph = cached_graph(&app, &payload.library_id, payload.revision)?;
        Ok(search_library_graph(
            &graph.model,
            &graph.sources,
            &payload.query,
            payload.max_results.unwrap_or(8),
        ))
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo buscar en el grafo.", true))?
}

/// Upper bound of explorer search matches returned to the UI.
const MAX_EXPLORER_MATCHES: usize = 1_000;

/// Explorer search over names, paths and Markdown contents; returns logical
/// paths.
#[tauri::command]
pub(crate) async fn backend_library_search(
    app: AppHandle,
    payload: LibraryGraphSearchPayload,
) -> Result<Vec<String>, BackendError> {
    if payload.query.chars().count() > 200 {
        return Err(BackendError::invalid_input("La búsqueda es demasiado larga."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let graph = cached_graph(&app, &payload.library_id, payload.revision)?;
        Ok(search_library_files(
            &graph.model,
            &graph.sources,
            &payload.query,
            payload.max_results.unwrap_or(MAX_EXPLORER_MATCHES).min(MAX_EXPLORER_MATCHES),
        ))
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo buscar en la biblioteca.", true))?
}
