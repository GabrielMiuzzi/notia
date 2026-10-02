//! Graph View and link cache commands. The backend reads the inventory and
//! the Markdown sources, resolves links and contexts, and returns the model;
//! the WebView only lays it out.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use crate::host::{AppHandle, Manager};

use crate::backend::library_graph::{
    build_library_graph, is_markdown_path, render_link_cache, search_library_files, search_library_graph, GraphContext,
    GraphModelDto,
    GraphSearchResultDto,
};
use crate::backend::wiki_links::{self, WikiLinkTargetDto};
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

/// The Markdown sources last read of each library, so the link cache, rebuilt
/// after every save, re-reads only the notes that changed: on Android each
/// read is a storage call, and a library has hundreds of notes. Writes of
/// Notia drop their note (`forget_source`); what changes outside Notia is
/// read again at least every [`FULL_READ_INTERVAL`].
struct SourceCache {
    sources: BTreeMap<String, String>,
    read_at: std::time::Instant,
}

/// The sources of one library: ready, or being read by a build, which
/// collects what is written meanwhile to drop it when it finishes.
enum SourceSlot {
    Ready(SourceCache),
    Building(Vec<String>),
}

const FULL_READ_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10 * 60);
const MAX_CACHED_SOURCE_LIBRARIES: usize = 4;

static SOURCE_CACHE: std::sync::LazyLock<Mutex<HashMap<String, SourceSlot>>> = std::sync::LazyLock::new(Default::default);
/// One graph build at a time, so a single build owns a library's slot.
static GRAPH_BUILD: Mutex<()> = Mutex::new(());

fn drop_sources(sources: &mut BTreeMap<String, String>, logical_path: &str) {
    let folder = format!("{}/", logical_path.trim_end_matches('/'));
    sources.retain(|path, _| path != logical_path && !path.starts_with(&folder));
}

/// A document of `library_id` changed or went away: its source (or, for a
/// folder, the sources inside it) is read again next time.
pub(crate) fn forget_source(library_id: &str, logical_path: &str) {
    let Ok(mut cache) = SOURCE_CACHE.lock() else {
        return;
    };
    match cache.get_mut(library_id) {
        Some(SourceSlot::Ready(entry)) => drop_sources(&mut entry.sources, logical_path),
        Some(SourceSlot::Building(written)) => written.push(logical_path.to_string()),
        None => {}
    }
}

/// The graph of a library with every source read now (Graph View, when the
/// client asks for a new revision).
pub(crate) fn build_graph(app: &AppHandle, library_id: &str) -> Result<(i64, BuiltGraph), BackendError> {
    build_graph_from(app, library_id, true)
}

/// The graph reusing the sources read before (`fresh` reads them all).
fn build_graph_from(app: &AppHandle, library_id: &str, fresh: bool) -> Result<(i64, BuiltGraph), BackendError> {
    let (files, generation) = crate::library_inventory::inventory_files(app, library_id)?;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), library_id, picker.inner())?;
    let _building = GRAPH_BUILD.lock().unwrap_or_else(|error| error.into_inner());
    let previous = SOURCE_CACHE.lock().ok().and_then(|mut cache| {
        match cache.insert(library_id.to_string(), SourceSlot::Building(Vec::new())) {
            Some(SourceSlot::Ready(entry)) => Some(entry),
            _ => None,
        }
    });
    let mut known = previous.filter(|entry| !fresh && entry.read_at.elapsed() < FULL_READ_INTERVAL);
    let read_at = known.as_ref().map(|entry| entry.read_at).unwrap_or_else(std::time::Instant::now);
    let mut sources = BTreeMap::new();
    let mut total = 0usize;
    for path in files.iter().filter(|path| is_markdown_path(path)).take(MAX_GRAPH_SOURCES) {
        let content = match known.as_mut().and_then(|entry| entry.sources.remove(path)) {
            Some(content) => content,
            None => {
                let Ok(locator) = DocumentLocatorDto::new(library_id, path, None, None) else {
                    continue;
                };
                // Unreadable documents stay as nodes without outgoing links.
                let Ok(content) = adapter.read_locator(&locator) else {
                    continue;
                };
                content
            }
        };
        total = total.saturating_add(content.len());
        if total > MAX_GRAPH_SOURCE_BYTES {
            break;
        }
        sources.insert(path.clone(), content);
    }
    if let Ok(mut cache) = SOURCE_CACHE.lock() {
        let mut kept = sources.clone();
        // What was written while reading may be older here than in the file.
        if let Some(SourceSlot::Building(written)) = cache.remove(library_id) {
            for path in &written {
                drop_sources(&mut kept, path);
            }
        }
        if cache.len() >= MAX_CACHED_SOURCE_LIBRARIES {
            let oldest = cache
                .iter()
                .filter_map(|(key, slot)| match slot {
                    SourceSlot::Ready(entry) => Some((key.clone(), entry.read_at)),
                    SourceSlot::Building(_) => None,
                })
                .min_by_key(|(_, read_at)| *read_at)
                .map(|(key, _)| key);
            if let Some(oldest) = oldest {
                cache.remove(&oldest);
            }
        }
        cache.insert(library_id.to_string(), SourceSlot::Ready(SourceCache { sources: kept, read_at }));
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

/// Graph View model of a library, with the paths the explorer shows.
pub(crate) async fn backend_library_graph(
    app: AppHandle,
    payload: LibraryGraphPayload,
) -> Result<GraphModelDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let mut model = cached_graph(&app, &payload.library_id, payload.revision)?.model.clone();
        let root = crate::library_session::visible_path(&app, &payload.library_id, "");
        let visible = |logical: &str| notia_backend_core::library_tree::library_visible_path(&root, logical);
        for node in &mut model.nodes {
            node.id = visible(&node.id);
            node.path = visible(&node.path);
            for neighbor in &mut node.neighbors {
                *neighbor = visible(neighbor);
            }
        }
        for path in &mut model.summary.top_connected {
            *path = visible(path);
        }
        for edge in &mut model.edges {
            edge.source_path = visible(&edge.source_path);
            edge.target_path = visible(&edge.target_path);
            edge.id = format!("{}<=>{}", edge.source_path, edge.target_path);
        }
        Ok(model)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo construir el grafo.", true))?
}

/// Regenerates `.notia/linkCache.md` from the current graph; an unchanged
/// cache is not rewritten.
fn rebuild_link_cache(app: &AppHandle, library_id: &str) -> Result<(), BackendError> {
    let (_, graph) = build_graph_from(app, library_id, false)?;
    let model = graph.model;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let locator = DocumentLocatorDto::new(library_id, ".notia/linkCache.md", None, None)?;
    let content = render_link_cache(&model);
    let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), library_id, picker.inner())?;
    if adapter.exists_locator(&locator)? && adapter.read_locator(&locator).ok().as_deref() == Some(content.as_str()) {
        return Ok(());
    }
    adapter.upsert_text_locator(&locator, &content)
}

/// Pending link cache rebuild of each library; a newer request replaces an
/// older one, so a burst of changes produces a single rebuild.
static LINK_CACHE_SCHEDULE: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, u64>>> =
    std::sync::LazyLock::new(Default::default);
const LINK_CACHE_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(1500);

/// Rebuilds the link cache of a library after its changes settle.
pub(crate) fn schedule_link_cache_rebuild(app: &AppHandle, library_id: &str) {
    let generation = {
        let Ok(mut schedule) = LINK_CACHE_SCHEDULE.lock() else {
            return;
        };
        let entry = schedule.entry(library_id.to_string()).or_default();
        *entry = entry.wrapping_add(1);
        *entry
    };
    let app = app.clone();
    let library_id = library_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(LINK_CACHE_DEBOUNCE);
        let current = LINK_CACHE_SCHEDULE
            .lock()
            .ok()
            .and_then(|schedule| schedule.get(&library_id).copied());
        if current != Some(generation) {
            return;
        }
        if let Err(error) = rebuild_link_cache(&app, &library_id) {
            log::warn!("[notia:library] no se pudo regenerar linkCache: {}", error.message);
        }
    });
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
pub(crate) async fn backend_library_graph_search(
    app: AppHandle,
    payload: LibraryGraphSearchPayload,
) -> Result<Vec<GraphSearchResultDto>, BackendError> {
    if payload.query.chars().count() > 200 {
        return Err(BackendError::invalid_input("La búsqueda es demasiado larga."));
    }
    crate::host::async_runtime::spawn_blocking(move || {
        let graph = cached_graph(&app, &payload.library_id, payload.revision)?;
        let root = crate::library_session::visible_path(&app, &payload.library_id, "");
        let mut results = search_library_graph(
            &graph.model,
            &graph.sources,
            &payload.query,
            payload.max_results.unwrap_or(8),
        );
        for result in &mut results {
            result.path = notia_backend_core::library_tree::library_visible_path(&root, &result.path);
        }
        Ok(results)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo buscar en el grafo.", true))?
}

/// Upper bound of explorer search matches returned to the UI.
const MAX_EXPLORER_MATCHES: usize = 1_000;

/// Explorer search over names, paths and Markdown contents; returns the
/// paths the explorer shows.
pub(crate) async fn backend_library_search(
    app: AppHandle,
    payload: LibraryGraphSearchPayload,
) -> Result<Vec<String>, BackendError> {
    if payload.query.chars().count() > 200 {
        return Err(BackendError::invalid_input("La búsqueda es demasiado larga."));
    }
    crate::host::async_runtime::spawn_blocking(move || {
        let graph = cached_graph(&app, &payload.library_id, payload.revision)?;
        let root = crate::library_session::visible_path(&app, &payload.library_id, "");
        Ok(search_library_files(
            &graph.model,
            &graph.sources,
            &payload.query,
            payload.max_results.unwrap_or(MAX_EXPLORER_MATCHES).min(MAX_EXPLORER_MATCHES),
        )
        .into_iter()
        .map(|logical| notia_backend_core::library_tree::library_visible_path(&root, &logical))
        .collect())
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo buscar en la biblioteca.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkTargetsPayload {
    library_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkSuggestionsPayload {
    library_id: String,
    query: String,
    #[serde(default)]
    limit: Option<usize>,
}

/// Wikilink targets of the indexed notes, with the paths the explorer shows.
fn link_targets(app: &AppHandle, library_id: &str) -> Result<Vec<WikiLinkTargetDto>, BackendError> {
    let (files, _) = crate::library_inventory::inventory_files(app, library_id)?;
    let root = crate::library_session::visible_path(app, library_id, "");
    let mut targets = wiki_links::build_targets(&files);
    for target in &mut targets {
        target.path = notia_backend_core::library_tree::library_visible_path(&root, &target.relative_path_with_extension);
    }
    Ok(targets)
}

/// Notes a wikilink can point to; the editor resolves the links it draws
/// against them.
pub(crate) async fn library_link_targets(
    app: AppHandle,
    payload: LinkTargetsPayload,
) -> Result<Vec<WikiLinkTargetDto>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || link_targets(&app, &payload.library_id))
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron leer los enlaces.", true))?
}

/// Notes suggested for the wikilink being typed.
pub(crate) async fn library_link_suggestions(
    app: AppHandle,
    payload: LinkSuggestionsPayload,
) -> Result<Vec<WikiLinkTargetDto>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let targets = link_targets(&app, &payload.library_id)?;
        let limit = payload.limit.unwrap_or(wiki_links::MAX_SUGGESTIONS).min(100);
        Ok(wiki_links::suggest(&targets, &payload.query, limit))
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron sugerir enlaces.", true))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edges(graph: &BuiltGraph) -> Vec<(String, String)> {
        let mut edges: Vec<_> = graph.model.edges.iter().map(|edge| (edge.source_path.clone(), edge.target_path.clone())).collect();
        edges.sort();
        edges
    }

    #[test]
    fn the_link_cache_rereads_only_the_notes_notia_wrote() {
        use crate::host::{AppPaths, HostPorts};
        let root = std::env::temp_dir().join(format!("notia-graph-test-{}", uuid::Uuid::new_v4()));
        let folder = root.join("Biblioteca");
        std::fs::create_dir_all(folder.join(".notia")).expect("library folder");
        std::fs::write(folder.join("a.md"), "Ver [[b]].").expect("a");
        std::fs::write(folder.join("b.md"), "Nota b.").expect("b");
        std::fs::write(folder.join("c.md"), "Nota c.").expect("c");
        let app = crate::create_app(AppPaths::new(Some(root.join("data")), None), HostPorts::default());
        app.manage(crate::mobile_directory_picker::AndroidDirectoryPickerState::empty());
        let id = crate::library_catalog::add_desktop_library(&app, &folder).expect("library").id;
        crate::database::open_library_connection(&folder.to_string_lossy()).expect("database");
        crate::library_inventory::reindex_library(&app, &id).expect("index");
        let link = |source: &str, target: &str| (source.to_string(), target.to_string());

        let (_, first) = build_graph_from(&app, &id, false).expect("first build");
        assert_eq!(edges(&first), vec![link("a.md", "b.md")]);

        // A note Notia writes is read again.
        let registry = app.state::<LibraryBindingRegistry>();
        let picker = app.state::<AndroidDirectoryPickerState>();
        let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), &id, picker.inner()).expect("adapter");
        let locator = DocumentLocatorDto::new(&id, "a.md", None, None).expect("locator");
        adapter.upsert_text_locator(&locator, "Ver [[c]].").expect("write");
        // A note changed outside Notia waits for the next full read.
        std::fs::write(folder.join("b.md"), "Ahora [[c]].").expect("outside");
        let (_, second) = build_graph_from(&app, &id, false).expect("incremental build");
        assert_eq!(edges(&second), vec![link("a.md", "c.md")]);

        let (_, fresh) = build_graph(&app, &id).expect("full build");
        assert_eq!(edges(&fresh), vec![link("a.md", "c.md"), link("b.md", "c.md")]);
        // A deleted note leaves the sources.
        adapter.delete_locator(&locator).expect("delete");
        crate::library_inventory::reindex_library(&app, &id).expect("index");
        let (_, after) = build_graph_from(&app, &id, false).expect("after delete");
        assert_eq!(edges(&after), vec![link("b.md", "c.md")]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
