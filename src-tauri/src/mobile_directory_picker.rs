use crate::notia_timer::NotiaTimer;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use std::time::Instant;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, State, Wry,
};

/// TTL in seconds for the SAF tree path cache. When a cache entry is younger
/// than this, `refresh_android_tree_path_cache` will skip the expensive
/// recursive `readTree` call and reuse the cached path→URI mappings.
/// Increased from 5s to 30s to reduce redundant full-tree traversals on
/// Android SAF, especially during library add/switch flows.
#[cfg(target_os = "android")]
const SAF_CACHE_TTL_SECS: u64 = 30;

pub struct AndroidDirectoryPickerState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
    #[cfg(target_os = "android")]
    roots: Mutex<HashMap<String, String>>,
    #[cfg(target_os = "android")]
    paths: Mutex<HashMap<String, String>>,
    #[cfg(target_os = "android")]
    root_entries: Mutex<HashMap<String, Vec<String>>>,
    /// Tracks the last successful cache refresh time per tree URI so that
    /// repetitive refreshes within the TTL window can be skipped.
    #[cfg(target_os = "android")]
    last_cache_refresh_at: Mutex<HashMap<String, Instant>>,
}

#[cfg(target_os = "android")]
fn normalize_android_root_key(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

impl AndroidDirectoryPickerState {
    #[cfg(target_os = "android")]
    fn with_handle(handle: PluginHandle<Wry>) -> Self {
        Self {
            handle: Mutex::new(Some(handle)),
            roots: Mutex::new(HashMap::new()),
            paths: Mutex::new(HashMap::new()),
            root_entries: Mutex::new(HashMap::new()),
            last_cache_refresh_at: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(target_os = "android")]
    fn unavailable() -> Self {
        Self {
            handle: Mutex::new(None),
            roots: Mutex::new(HashMap::new()),
            paths: Mutex::new(HashMap::new()),
            root_entries: Mutex::new(HashMap::new()),
            last_cache_refresh_at: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(not(target_os = "android"))]
    fn empty() -> Self {
        Self {}
    }
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickDirectoryTreeResponse {
    path: Option<String>,
    uri: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickAndroidDirectoryTreeResult {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadTreeResponse {
    nodes: Vec<AndroidTreeNode>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadFileResponse {
    content: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryInfoResponse {
    ok: Option<bool>,
    #[serde(rename = "type")]
    node_type: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteFileResponse {
    ok: bool,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateEntryResponse {
    path: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryMutationResponse {
    ok: Option<bool>,
    path: Option<String>,
}

#[cfg(target_os = "android")]
fn cache_android_path(
    path_map: &mut HashMap<String, String>,
    cached_keys: &mut HashSet<String>,
    path: &str,
    uri: &str,
) {
    path_map.insert(path.to_string(), uri.to_string());
    cached_keys.insert(path.to_string());

    let normalized_path = normalize_android_root_key(path);
    if !normalized_path.is_empty() {
        path_map.insert(normalized_path.clone(), uri.to_string());
        cached_keys.insert(normalized_path);
    }
}

#[cfg(target_os = "android")]
fn cache_android_tree_nodes(
    path_map: &mut HashMap<String, String>,
    cached_keys: &mut HashSet<String>,
    nodes: &[AndroidTreeNode],
) {
    for node in nodes {
        if let Some(path) = node.path.as_deref() {
            if node.id.starts_with("content://") {
                cache_android_path(path_map, cached_keys, path, &node.id);
            }
        }

        if let Some(children) = node.children.as_deref() {
            cache_android_tree_nodes(path_map, cached_keys, children);
        }
    }
}

#[cfg(target_os = "android")]
pub fn is_cache_fresh(state: &AndroidDirectoryPickerState, tree_uri: &str) -> bool {
    let Ok(timestamps) = state.last_cache_refresh_at.lock() else {
        return false;
    };
    timestamps
        .get(tree_uri)
        .map(|instant| instant.elapsed().as_secs() < SAF_CACHE_TTL_SECS)
        .unwrap_or(false)
}

#[cfg(target_os = "android")]
fn mark_cache_fresh(state: &AndroidDirectoryPickerState, tree_uri: &str) {
    if let Ok(mut timestamps) = state.last_cache_refresh_at.lock() {
        timestamps.insert(tree_uri.to_string(), Instant::now());
    }
}

/// Mark the SAF path cache as stale for the given tree URI without doing any
/// I/O. The next call to `refresh_android_tree_path_cache` with `force=false`
/// will perform a full `readTree` to rebuild the cache.
#[cfg(target_os = "android")]
pub fn invalidate_tree_cache(state: &AndroidDirectoryPickerState, tree_uri: &str) {
    if let Ok(mut timestamps) = state.last_cache_refresh_at.lock() {
        timestamps.remove(tree_uri);
    }
}

#[cfg(not(target_os = "android"))]
pub fn invalidate_paths_by_prefix(_state: &AndroidDirectoryPickerState, _path_prefix: &str) {
    // No-op on non-Android platforms
}

/// Invalidate only the path entries that start with `path_prefix` from the
/// cached paths map, instead of clearing the entire tree cache. This allows
/// subsequent reads of sibling or parent paths to still hit the cache.
#[cfg(target_os = "android")]
pub fn invalidate_paths_by_prefix(state: &AndroidDirectoryPickerState, path_prefix: &str) {
    let normalized_prefix = normalize_android_root_key(path_prefix);
    let mut paths = match state.paths.lock() {
        Ok(p) => p,
        Err(_) => return,
    };
    paths.retain(|key, _| {
        !key.starts_with(&normalized_prefix) && !key.starts_with(path_prefix)
    });
}

/// Update cached path→URI mappings from tree nodes that have already been
/// fetched (e.g. by `read_android_library_tree`). This avoids the redundant
/// second `readTree` call that `refresh_android_tree_path_cache` would make.
#[cfg(target_os = "android")]
pub fn update_cache_from_nodes(
    state: &AndroidDirectoryPickerState,
    tree_uri: &str,
    nodes: &[AndroidTreeNode],
) {
    let root_paths = {
        let Ok(roots) = state.roots.lock() else {
            return;
        };
        roots
            .iter()
            .filter(|(_, uri)| uri.as_str() == tree_uri)
            .map(|(path, uri)| (path.clone(), uri.clone()))
            .collect::<Vec<_>>()
    };

    let mut cached_keys = HashSet::new();

    let Ok(mut paths) = state.paths.lock() else {
        return;
    };
    let Ok(mut root_entries) = state.root_entries.lock() else {
        return;
    };

    if let Some(previous_keys) = root_entries.get(tree_uri) {
        for key in previous_keys {
            paths.remove(key);
        }
    }

    for (root_path, root_uri) in &root_paths {
        cache_android_path(&mut paths, &mut cached_keys, root_path, root_uri);
    }

    cache_android_tree_nodes(&mut paths, &mut cached_keys, nodes);
    root_entries.insert(tree_uri.to_string(), cached_keys.into_iter().collect());
    mark_cache_fresh(state, tree_uri);
}

#[cfg(target_os = "android")]
pub fn refresh_android_tree_path_cache(
    state: &AndroidDirectoryPickerState,
    tree_uri: &str,
    force: bool,
) -> Result<(), String> {
    if !force && is_cache_fresh(state, tree_uri) {
        return Ok(());
    }

    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<ReadTreeResponse>("readTree", serde_json::json!({ "uri": tree_uri }))
        .map_err(|error| format!("No se pudo leer la carpeta Android: {error}"))?;

    // Release the handle lock before acquiring paths/root_entries.
    drop(guard);

    let root_paths = {
        let roots = state
            .roots
            .lock()
            .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
        roots
            .iter()
            .filter(|(_, uri)| uri.as_str() == tree_uri)
            .map(|(path, uri)| (path.clone(), uri.clone()))
            .collect::<Vec<_>>()
    };

    let mut cached_keys = HashSet::new();
    let mut paths = state
        .paths
        .lock()
        .map_err(|_| "No se pudo actualizar la cache Android.".to_string())?;
    let mut root_entries = state
        .root_entries
        .lock()
        .map_err(|_| "No se pudo actualizar la cache Android.".to_string())?;

    if let Some(previous_keys) = root_entries.get(tree_uri) {
        for key in previous_keys {
            paths.remove(key);
        }
    }

    for (root_path, root_uri) in &root_paths {
        cache_android_path(&mut paths, &mut cached_keys, root_path, root_uri);
    }

    cache_android_tree_nodes(&mut paths, &mut cached_keys, &response.nodes);
    root_entries.insert(tree_uri.to_string(), cached_keys.into_iter().collect());
    mark_cache_fresh(state, tree_uri);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AndroidTreeNode {
    id: String,
    name: String,
    path: Option<String>,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_children: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<AndroidTreeNode>>,
}

/// A flat file entry returned by the `readFlatFileList` Kotlin command.
/// Unlike `AndroidTreeNode`, this has no nesting — just the path, type,
/// and name for every file/folder in the tree. Used by search index and
/// graph engine which need the complete file list without tree structure.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AndroidFlatFileEntry {
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadFlatFileListResponse {
    files: Vec<AndroidFlatFileEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAndroidTreePayload {
    directory_path: String,
    #[serde(default)]
    directory_uri: Option<String>,
}

#[tauri::command]
pub fn pick_android_directory_tree(
    state: State<'_, AndroidDirectoryPickerState>,
) -> Result<PickAndroidDirectoryTreeResult, String> {
    #[cfg(target_os = "android")]
    {
        let _timer = NotiaTimer::new("pick_android_directory_tree");
        log::info!("[notia:directory_picker] pick_android_directory_tree called");
        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            log::warn!("[notia:directory_picker] plugin handle not available");
            return Err("El selector de carpetas no esta disponible.".to_string());
        };

        log::info!("[notia:directory_picker] calling pickDirectoryTree plugin");
        let response = handle
            .run_mobile_plugin::<PickDirectoryTreeResponse>("pickDirectoryTree", ())
            .map_err(|error| {
                log::error!("[notia:directory_picker] plugin call failed: {}", error);
                format!("No se pudo abrir el selector de carpetas: {error}")
            })?;
        log::info!(
            "[notia:directory_picker] plugin response: path={:?}, uri={:?}",
            response.path,
            response.uri
        );
        let Some(path) = response.path else {
            log::warn!("[notia:directory_picker] no path in response");
            return Err("No se pudo resolver la carpeta seleccionada.".to_string());
        };
        if path.trim().is_empty() {
            log::warn!("[notia:directory_picker] path is empty");
            return Err("No se pudo resolver la carpeta seleccionada.".to_string());
        }

        let selected_uri = response.uri.clone();
        if let Some(uri) = selected_uri.clone() {
            let mut roots = state
                .roots
                .lock()
                .map_err(|_| "No se pudo guardar la referencia de carpeta Android.".to_string())?;
            let normalized_key = normalize_android_root_key(&path);
            roots.insert(path.clone(), uri.clone());
            roots.insert(normalized_key, uri.clone());

            // Invalidate the Rust-side cache for this tree URI so that the
            // next readTree will fetch fresh data (the directory may have
            // changed externally since the last time it was accessed).
            invalidate_tree_cache(state.inner(), &uri);
        }

        if let Some(uri) = selected_uri.as_deref() {
            let mut paths = state
                .paths
                .lock()
                .map_err(|_| "No se pudo guardar la referencia de carpeta Android.".to_string())?;
            let normalized_key = normalize_android_root_key(&path);
            paths.insert(path.clone(), uri.to_string());
            paths.insert(normalized_key, uri.to_string());
        }

        return Ok(PickAndroidDirectoryTreeResult {
            path,
            uri: selected_uri,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        Err("El selector de carpetas Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub async fn read_android_library_tree(
    state: State<'_, AndroidDirectoryPickerState>,
    payload: ReadAndroidTreePayload,
) -> Result<Vec<AndroidTreeNode>, String> {
    #[cfg(target_os = "android")]
    {
        let mut timer = NotiaTimer::new("read_android_library_tree");
        if payload.directory_path.trim().is_empty() {
            return Ok(Vec::new());
        }

        log::info!(
            "[notia:directory_picker] read_android_library_tree path={}",
            payload.directory_path
        );

        let uri = {
            let normalized_key = normalize_android_root_key(&payload.directory_path);
            if let Some(uri) = payload
                .directory_uri
                .clone()
                .filter(|value| !value.trim().is_empty())
            {
                let mut roots = state.roots.lock().map_err(|_| {
                    "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                })?;
                roots.insert(payload.directory_path.clone(), uri.clone());
                roots.insert(normalized_key, uri.clone());
                log::info!("[notia:directory_picker] uri resolved from payload uri={}", uri);
                Some(uri)
            } else {
                let exact_path_uri = {
                    let paths = state.paths.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    paths.get(&payload.directory_path).cloned().or_else(|| {
                        paths
                            .get(&normalize_android_root_key(&payload.directory_path))
                            .cloned()
                    })
                };
                if exact_path_uri.is_some() {
                    exact_path_uri
                } else {
                    let normalized_key = normalize_android_root_key(&payload.directory_path);
                    let roots = state.roots.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    roots
                        .get(&payload.directory_path)
                        .cloned()
                        .or_else(|| roots.get(&normalized_key).cloned())
                        .or_else(|| {
                            // Multi-root fallback: find the root whose path is a
                            // prefix of the requested path (longest prefix wins).
                            roots
                                .iter()
                                .filter(|(root_path, _)| {
                                    let norm_root = normalize_android_root_key(root_path);
                                    payload.directory_path.starts_with(root_path.as_str())
                                        || payload.directory_path.starts_with(norm_root.as_str())
                                })
                                .max_by_key(|(root_path, _)| root_path.len())
                                .map(|(_, uri)| uri.clone())
                        })
                }
            }
        };

        let Some(uri) = uri else {
            log::warn!(
                "[notia:directory_picker] uri resolution failed path={}",
                payload.directory_path
            );
            return Err(
                "No se encontro la referencia Android de la carpeta seleccionada.".to_string(),
            );
        };

        log::info!(
            "[notia:directory_picker] calling readTree plugin uri={} ...",
            uri
        );

        // Fetch the tree and update the cache in one pass — no second readTree.
        // This is an async command so the Tauri runtime can process other events
        // (e.g. WebView rendering) while this command runs on the async thread pool.
        let response = {
            let guard = state
                .handle
                .lock()
                .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
            let Some(handle) = guard.as_ref() else {
                return Err("El selector de carpetas no esta disponible.".to_string());
            };

            handle
                .run_mobile_plugin::<ReadTreeResponse>(
                    "readTree",
                    serde_json::json!({ "uri": uri }),
                )
                .map_err(|error| format!("No se pudo leer la carpeta Android: {error}"))?
        };

        // Update the path cache from the tree nodes we already fetched, avoiding
        // the redundant second readTree that refresh_android_tree_path_cache would do.
        update_cache_from_nodes(state.inner(), &uri, &response.nodes);

        let node_count = response.nodes.len();
        timer.finish_with_meta(&format!("uri={} node_count={}", uri, node_count));

        Ok(response.nodes)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let ReadAndroidTreePayload {
            directory_path,
            directory_uri,
        } = payload;
        let _ = (directory_path, directory_uri);
        Err("Solo disponible en Android.".to_string())
    }
}

/// Read a single directory's immediate children (non-recursive, ls-style).
/// Folders are returned with `hasChildren: true` and `children: None`,
/// meaning the caller must issue a separate read_android_directory call
/// to expand them. This avoids the expensive recursive tree traversal on
/// large libraries.
#[tauri::command]
pub async fn read_android_directory(
    state: State<'_, AndroidDirectoryPickerState>,
    payload: ReadAndroidTreePayload,
) -> Result<Vec<AndroidTreeNode>, String> {
    #[cfg(target_os = "android")]
    {
        let mut timer = NotiaTimer::new("read_android_directory");
        if payload.directory_path.trim().is_empty() {
            return Ok(Vec::new());
        }

        log::info!(
            "[notia:directory_picker] read_android_directory path={}",
            payload.directory_path
        );

        // Resolve the URI for this directory.
        // Priority: cached paths > directory_uri payload > roots fallback.
        // This is critical for subdirectory reads: when expanding a subfolder
        // in the tree, directoryUri may be the library root tree URI (not the
        // specific subfolder URI). The paths cache has the exact content:// URI
        // for each subdirectory from previous reads.
        let uri = {
            let normalized_key = normalize_android_root_key(&payload.directory_path);

            // 1. Check the paths cache for an exact match (most accurate).
            let exact_path_uri = {
                let paths = state.paths.lock().map_err(|_| {
                    "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                })?;
                paths.get(&payload.directory_path).cloned().or_else(|| {
                    paths.get(&normalized_key).cloned()
                })
            };

            if exact_path_uri.is_some() {
                log::info!("[notia:directory_picker] read_android_directory uri resolved from paths cache path={}", payload.directory_path);
                exact_path_uri
            } else if let Some(uri) = payload
                .directory_uri
                .clone()
                .filter(|value| !value.trim().is_empty())
            {
                // 2. Use the provided directoryUri, but only store it in the
                //    paths cache (not roots) unless this is a known library root.
                //    Subdirectories should not pollute the roots cache.
                {
                    let mut paths = state.paths.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    paths.insert(payload.directory_path.clone(), uri.clone());
                    if !normalized_key.is_empty() {
                        paths.insert(normalized_key.clone(), uri.clone());
                    }
                }
                let is_known_root = {
                    let roots = state.roots.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    roots.contains_key(&payload.directory_path) || roots.contains_key(&normalized_key)
                };
                if is_known_root {
                    let mut roots = state.roots.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    roots.insert(payload.directory_path.clone(), uri.clone());
                    roots.insert(normalized_key, uri.clone());
                }
                log::info!("[notia:directory_picker] read_android_directory uri resolved from payload uri={}", uri);
                Some(uri)
            } else {
                // 3. Fallback: check roots for exact match or prefix match.
                let roots = state.roots.lock().map_err(|_| {
                    "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                })?;
                roots
                    .get(&payload.directory_path)
                    .cloned()
                    .or_else(|| roots.get(&normalized_key).cloned())
                    .or_else(|| {
                        roots
                            .iter()
                            .filter(|(root_path, _)| {
                                let norm_root = normalize_android_root_key(root_path);
                                payload.directory_path.starts_with(root_path.as_str())
                                    || payload.directory_path.starts_with(norm_root.as_str())
                            })
                            .max_by_key(|(root_path, _)| root_path.len())
                            .map(|(_, uri)| uri.clone())
                    })
            }
        };

        let Some(uri) = uri else {
            log::warn!(
                "[notia:directory_picker] read_android_directory uri resolution failed path={}",
                payload.directory_path
            );
            return Err(
                "No se encontro la referencia Android de la carpeta seleccionada.".to_string(),
            );
        };

        log::info!(
            "[notia:directory_picker] calling readDirectory plugin uri={} ...",
            uri
        );

        // Call the Kotlin readDirectory command (shallow, non-recursive)
        let response = {
            let guard = state
                .handle
                .lock()
                .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
            let Some(handle) = guard.as_ref() else {
                return Err("El selector de carpetas no esta disponible.".to_string());
            };

            handle
                .run_mobile_plugin::<ReadTreeResponse>(
                    "readDirectory",
                    serde_json::json!({ "uri": uri }),
                )
                .map_err(|error| format!("No se pudo leer el directorio Android: {error}"))?
        };

        // Update the path cache from the shallow nodes we received.
        // Shallow nodes have id (content URI), name, and path which are
        // enough to populate the path cache for direct children.
        {
            let mut paths = state.paths.lock().map_err(|_| {
                "No se pudo actualizar la cache Android.".to_string()
            })?;
            for node in &response.nodes {
                if let Some(path) = node.path.as_deref() {
                    if node.id.starts_with("content://") {
                        paths.insert(path.to_string(), node.id.clone());
                        let normalized = normalize_android_root_key(path);
                        if !normalized.is_empty() {
                            paths.insert(normalized, node.id.clone());
                        }
                    }
                }
            }
        }

        let node_count = response.nodes.len();
        timer.finish_with_meta(&format!("uri={} node_count={}", uri, node_count));

        Ok(response.nodes)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let ReadAndroidTreePayload {
            directory_path,
            directory_uri,
        } = payload;
        let _ = (directory_path, directory_uri);
        Err("Solo disponible en Android.".to_string())
    }
}

/// Read a flat (non-nested) list of ALL files and folders in the tree.
/// This performs a recursive traversal on the Kotlin side but returns a
/// flat array of `{path, type, name}` without nesting. Used by search
/// index and graph engine which need the complete list regardless of
/// the lazy-loaded tree state in the frontend.
#[tauri::command]
pub async fn read_android_flat_file_list(
    state: State<'_, AndroidDirectoryPickerState>,
    payload: ReadAndroidTreePayload,
) -> Result<Vec<AndroidFlatFileEntry>, String> {
    #[cfg(target_os = "android")]
    {
        let mut timer = NotiaTimer::new("read_android_flat_file_list");
        if payload.directory_path.trim().is_empty() {
            return Ok(Vec::new());
        }

        log::info!(
            "[notia:directory_picker] read_android_flat_file_list path={}",
            payload.directory_path
        );

        let uri = {
            let normalized_key = normalize_android_root_key(&payload.directory_path);
            if let Some(uri) = payload
                .directory_uri
                .clone()
                .filter(|value| !value.trim().is_empty())
            {
                let mut roots = state.roots.lock().map_err(|_| {
                    "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                })?;
                roots.insert(payload.directory_path.clone(), uri.clone());
                roots.insert(normalized_key, uri.clone());
                log::info!("[notia:directory_picker] uri resolved from payload uri={}", uri);
                Some(uri)
            } else {
                let exact_path_uri = {
                    let paths = state.paths.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    paths.get(&payload.directory_path).cloned().or_else(|| {
                        paths
                            .get(&normalize_android_root_key(&payload.directory_path))
                            .cloned()
                    })
                };
                if exact_path_uri.is_some() {
                    exact_path_uri
                } else {
                    let normalized_key = normalize_android_root_key(&payload.directory_path);
                    let roots = state.roots.lock().map_err(|_| {
                        "No se pudo acceder a las carpetas Android seleccionadas.".to_string()
                    })?;
                    roots
                        .get(&payload.directory_path)
                        .cloned()
                        .or_else(|| roots.get(&normalized_key).cloned())
                        .or_else(|| {
                            roots
                                .iter()
                                .filter(|(root_path, _)| {
                                    let norm_root = normalize_android_root_key(root_path);
                                    payload.directory_path.starts_with(root_path.as_str())
                                        || payload.directory_path.starts_with(norm_root.as_str())
                                })
                                .max_by_key(|(root_path, _)| root_path.len())
                                .map(|(_, uri)| uri.clone())
                        })
                }
            }
        };

        let Some(uri) = uri else {
            log::warn!(
                "[notia:directory_picker] read_android_flat_file_list uri resolution failed path={}",
                payload.directory_path
            );
            return Err(
                "No se encontro la referencia Android de la carpeta seleccionada.".to_string(),
            );
        };

        log::info!(
            "[notia:directory_picker] calling readFlatFileList plugin uri={} ...",
            uri
        );

        let response = {
            let guard = state
                .handle
                .lock()
                .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
            let Some(handle) = guard.as_ref() else {
                return Err("El selector de carpetas no esta disponible.".to_string());
            };

            handle
                .run_mobile_plugin::<ReadFlatFileListResponse>(
                    "readFlatFileList",
                    serde_json::json!({ "uri": uri }),
                )
                .map_err(|error| format!("No se pudo leer la lista de archivos Android: {error}"))?
        };

        // The Kotlin readFlatFileList does NOT build tree nodes anymore (fixed:
        // it only builds the flat list to avoid double traversal). Therefore we
        // cannot update the Rust path cache from it (flat entries lack URIs).
        // We also must NOT mark the cache as fresh, because the path cache may
        // not have been populated yet — `resolve_entry_uri` relies on the
        // cache staleness check to trigger a lazy `readTree` refresh when needed.

        let file_count = response.files.len();
        timer.finish_with_meta(&format!("uri={} file_count={}", uri, file_count));

        Ok(response.files)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let ReadAndroidTreePayload {
            directory_path,
            directory_uri,
        } = payload;
        let _ = (directory_path, directory_uri);
        Err("Solo disponible en Android.".to_string())
    }
}

#[cfg(target_os = "android")]
pub fn read_android_content_text(
    state: &AndroidDirectoryPickerState,
    content_uri: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<ReadFileResponse>(
            "readFile",
            serde_json::json!({ "uri": content_uri }),
        )
        .map_err(|error| format!("No se pudo leer el archivo Android: {error}"))?;
    let Some(content) = response.content else {
        return Err("No se pudo leer el contenido del archivo Android.".to_string());
    };

    Ok(content)
}

#[cfg(target_os = "android")]
pub fn write_android_content_text(
    state: &AndroidDirectoryPickerState,
    content_uri: &str,
    content: &str,
) -> Result<(), String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<WriteFileResponse>(
            "writeFile",
            serde_json::json!({ "uri": content_uri, "content": content }),
        )
        .map_err(|error| format!("No se pudo escribir el archivo Android: {error}"))?;

    if !response.ok {
        return Err("No se pudo escribir el archivo Android.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "android")]
pub fn read_android_entry_type(
    state: &AndroidDirectoryPickerState,
    entry_uri: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<EntryInfoResponse>(
            "statEntry",
            serde_json::json!({ "uri": entry_uri }),
        )
        .map_err(|error| format!("No se pudo leer la entrada Android: {error}"))?;

    if !response.ok.unwrap_or(false) {
        return Err("No se pudo leer la entrada Android.".to_string());
    }

    let Some(node_type) = response.node_type else {
        return Err("No se pudo leer el tipo de la entrada Android.".to_string());
    };
    if node_type.trim().is_empty() {
        return Err("No se pudo leer el tipo de la entrada Android.".to_string());
    }

    Ok(node_type)
}

#[cfg(target_os = "android")]
pub fn create_android_tree_entry(
    state: &AndroidDirectoryPickerState,
    parent_uri: &str,
    name: &str,
    entry_type: &str,
    content: Option<&str>,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<CreateEntryResponse>(
            "createEntry",
            serde_json::json!({
                "parentUri": parent_uri,
                "name": name,
                "entryType": entry_type,
                "content": content,
            }),
        )
        .map_err(|error| format!("No se pudo crear la entrada Android: {error}"))?;

    let Some(path) = response.path else {
        return Err("No se pudo crear la entrada Android.".to_string());
    };
    if path.trim().is_empty() {
        return Err("No se pudo crear la entrada Android.".to_string());
    }

    Ok(path)
}

#[cfg(target_os = "android")]
pub fn create_android_directory(
    state: &AndroidDirectoryPickerState,
    parent_uri: &str,
    dir_name: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<CreateEntryResponse>(
            "createEntry",
            serde_json::json!({
                "parentUri": parent_uri,
                "name": dir_name,
                "entryType": "folder",
                "content": null,
            }),
        )
        .map_err(|error| format!("No se pudo crear el directorio Android: {error}"))?;

    let Some(path) = response.path else {
        return Err("No se pudo crear el directorio Android.".to_string());
    };

    Ok(path)
}

#[cfg(target_os = "android")]
pub fn delete_android_tree_entry(
    state: &AndroidDirectoryPickerState,
    entry_uri: &str,
) -> Result<(), String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<WriteFileResponse>(
            "deleteEntry",
            serde_json::json!({ "uri": entry_uri }),
        )
        .map_err(|error| format!("No se pudo eliminar la entrada Android: {error}"))?;

    if !response.ok {
        return Err("No se pudo eliminar la entrada Android.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "android")]
pub fn rename_android_tree_entry(
    state: &AndroidDirectoryPickerState,
    entry_uri: &str,
    new_name: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<EntryMutationResponse>(
            "renameEntry",
            serde_json::json!({ "uri": entry_uri, "newName": new_name }),
        )
        .map_err(|error| format!("No se pudo renombrar la entrada Android: {error}"))?;

    if !response.ok.unwrap_or(false) {
        return Err("No se pudo renombrar la entrada Android.".to_string());
    }

    let Some(path) = response.path else {
        return Err("No se pudo renombrar la entrada Android.".to_string());
    };
    if path.trim().is_empty() {
        return Err("No se pudo renombrar la entrada Android.".to_string());
    }

    Ok(path)
}

#[cfg(target_os = "android")]
pub fn copy_android_tree_entry(
    state: &AndroidDirectoryPickerState,
    source_uri: &str,
    target_parent_uri: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<EntryMutationResponse>(
            "copyEntry",
            serde_json::json!({
                "sourceUri": source_uri,
                "targetParentUri": target_parent_uri,
            }),
        )
        .map_err(|error| format!("No se pudo copiar la entrada Android: {error}"))?;

    if !response.ok.unwrap_or(false) {
        return Err("No se pudo copiar la entrada Android.".to_string());
    }

    let Some(path) = response.path else {
        return Err("No se pudo copiar la entrada Android.".to_string());
    };
    if path.trim().is_empty() {
        return Err("No se pudo copiar la entrada Android.".to_string());
    }

    Ok(path)
}

#[cfg(target_os = "android")]
pub fn move_android_tree_entry(
    state: &AndroidDirectoryPickerState,
    source_uri: &str,
    source_parent_uri: &str,
    target_parent_uri: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<EntryMutationResponse>(
            "moveEntry",
            serde_json::json!({
                "sourceUri": source_uri,
                "sourceParentUri": source_parent_uri,
                "targetParentUri": target_parent_uri,
            }),
        )
        .map_err(|error| format!("No se pudo mover la entrada Android: {error}"))?;

    if !response.ok.unwrap_or(false) {
        return Err("No se pudo mover la entrada Android.".to_string());
    }

    let Some(path) = response.path else {
        return Err("No se pudo mover la entrada Android.".to_string());
    };
    if path.trim().is_empty() {
        return Err("No se pudo mover la entrada Android.".to_string());
    }

    Ok(path)
}

#[cfg(target_os = "android")]
pub fn resolve_android_tree_uri(
    state: &AndroidDirectoryPickerState,
    directory_path: &str,
    directory_uri: Option<&str>,
) -> Result<Option<String>, String> {
    let normalized_key = normalize_android_root_key(directory_path);
    if let Some(uri) = directory_uri
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    {
        let mut roots = state
            .roots
            .lock()
            .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
        roots.insert(directory_path.to_string(), uri.clone());
        roots.insert(normalized_key.clone(), uri.clone());
        let mut paths = state
            .paths
            .lock()
            .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
        paths.insert(directory_path.to_string(), uri.clone());
        paths.insert(normalized_key, uri.clone());
        return Ok(Some(uri));
    }

    // Try exact path match in the cached paths map first.
    let exact_path_uri = {
        let paths = state
            .paths
            .lock()
            .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
        paths
            .get(directory_path)
            .cloned()
            .or_else(|| paths.get(&normalized_key).cloned())
    };
    if exact_path_uri.is_some() {
        return Ok(exact_path_uri);
    }

    // Try exact match in roots.
    let roots = state
        .roots
        .lock()
        .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
    let resolved = roots
        .get(directory_path)
        .cloned()
        .or_else(|| roots.get(&normalized_key).cloned())
        .or_else(|| {
            // Multi-root fallback: find the root whose normalized path is a
            // prefix of the requested normalized path (longest prefix wins).
            roots
                .iter()
                .filter(|(root_path, _)| {
                    let norm_root = normalize_android_root_key(root_path);
                    normalized_key.starts_with(norm_root.as_str())
                        || normalized_key.starts_with(root_path.as_str())
                })
                .max_by_key(|(root_path, _)| root_path.len())
                .map(|(_, uri)| uri.clone())
        });
    Ok(resolved)
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-mobile")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                match api.register_android_plugin("com.gabriel.notia", "DirectoryPickerPlugin") {
                    Ok(handle) => {
                        app.manage(AndroidDirectoryPickerState::with_handle(handle));
                    }
                    Err(error) => {
                        log::error!(
                            "[notia:directory_picker] Android plugin not available, continuing without directory picker: {error}"
                        );
                        app.manage(AndroidDirectoryPickerState::unavailable());
                    }
                }
            }

            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(AndroidDirectoryPickerState::empty());
            }

            Ok(())
        })
        .build()
}
