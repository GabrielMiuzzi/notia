#[cfg(target_os = "android")]
use std::path::Path;
#[cfg(any(target_os = "android", test))]
use std::path::PathBuf;
#[cfg(target_os = "android")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "android")]
use crate::mobile_directory_picker;
#[cfg(target_os = "android")]
use crate::notia_timer::NotiaTimer;

#[cfg(target_os = "android")]
use super::types::{content_revision, FilesystemConflict};
use super::types::{
    OperationResult, PathExistsResult, ReadLibraryFileResult,
    WriteLibraryFileResult,
};

#[cfg(target_os = "android")]
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

#[cfg(any(target_os = "android", test))]
fn map_already_exists_error(error_message: String, fallback: &str) -> OperationResult {
    let lowered = error_message.to_lowercase();
    if lowered.contains("already exists")
        || lowered.contains("ya existe")
        || lowered.contains("exists")
    {
        OperationResult {
            ok: false,
            error: Some("An entry with that name already exists.".to_string()),
        }
    } else {
        OperationResult {
            ok: false,
            error: Some(format!("{fallback} {error_message}")),
        }
    }
}

#[cfg(test)]
mod error_mapping_tests {
    use super::map_already_exists_error;

    #[test]
    fn preserves_android_creation_error_details() {
        let result = map_already_exists_error(
            "No se pudo crear la ruta Android: escritura rechazada".to_string(),
            "Could not create file.",
        );

        assert_eq!(
            result.error.as_deref(),
            Some("Could not create file. No se pudo crear la ruta Android: escritura rechazada")
        );
    }

    #[test]
    fn keeps_the_stable_duplicate_error() {
        let result = map_already_exists_error(
            "Ya existe una entrada incompatible con ese nombre.".to_string(),
            "Could not create file.",
        );

        assert_eq!(
            result.error.as_deref(),
            Some("An entry with that name already exists.")
        );
    }
}

/// Drops a stale path cache for one library tree. Freshness is tracked per
/// tree URI in `AndroidDirectoryPickerState`, so a refresh of one library can
/// never suppress the invalidation of another.
#[cfg(target_os = "android")]
fn refresh_root_tree_cache(state: &AndroidDirectoryPickerState, root_tree_uri: Option<&str>) {
    let Some(tree_uri) = root_tree_uri else {
        return;
    };
    if !mobile_directory_picker::is_cache_fresh(state, tree_uri) {
        // Lazy refresh: the next operation that must resolve a path rebuilds
        // only what it needs instead of eagerly traversing the whole tree.
        mobile_directory_picker::invalidate_tree_cache(state, tree_uri);
    }
}

/// Invalidate only the paths that are affected by an entry mutation (create,
/// delete, rename, paste). Instead of clearing the entire path cache, only
/// remove entries whose key starts with `path_prefix`. This allows subsequent
/// reads of sibling or parent entries to still hit the cache.
#[cfg(target_os = "android")]
fn invalidate_paths_for_entry(
    state: &AndroidDirectoryPickerState,
    path_prefix: &str,
    root_tree_uri: Option<&str>,
) {
    // 1. Mark the tree as mutated: the next readTree or readFlatFileList
    //    fetches fresh data and reads already in flight are discarded.
    if let Some(tree_uri) = root_tree_uri {
        mobile_directory_picker::mark_tree_mutated(state, tree_uri);
    }

    // 2. Selectively remove cached path→URI entries that match the affected
    //    path prefix. This way, reading an unrelated file still hits cache.
    mobile_directory_picker::invalidate_paths_by_prefix(state, path_prefix);
}

#[cfg(target_os = "android")]
fn has_android_resolution_context(root_tree_uri: Option<&str>, path: &str) -> bool {
    root_tree_uri
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        || path.starts_with("content://")
}

#[cfg(any(target_os = "android", test))]
fn is_android_document_uri(path: &str) -> bool {
    path.starts_with("content://") && path.contains("/document/")
}

#[cfg(any(target_os = "android", test))]
fn is_android_tree_uri(path: &str) -> bool {
    path.starts_with("content://") && path.contains("/tree/") && !is_android_document_uri(path)
}

#[cfg(target_os = "android")]
fn is_document_under_tree(document_uri: &str, tree_uri: &str) -> bool {
    let document = normalize_android_path(document_uri);
    let tree = normalize_android_path(tree_uri);
    is_android_document_uri(&document)
        && is_android_tree_uri(&tree)
        && document.starts_with(&format!("{tree}/document/"))
}

#[cfg(any(target_os = "android", test))]
fn normalize_android_path(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(any(target_os = "android", test))]
fn android_parent_path(path: &str) -> Option<String> {
    let normalized = normalize_android_path(path);
    let separator = normalized.rfind('/')?;
    if separator == 0 {
        return Some("/".to_string());
    }
    Some(normalized[..separator].to_string())
}

#[cfg(target_os = "android")]
fn android_file_name(path: &str) -> Option<String> {
    normalize_android_path(path)
        .rsplit('/')
        .next()
        .map(ToString::to_string)
}

#[cfg(any(target_os = "android", test))]
fn android_relative_segments(path: &str, root_tree_uri: &str) -> Option<Vec<String>> {
    let normalized_path = normalize_android_path(path);
    let normalized_root = normalize_android_path(root_tree_uri);
    if !is_android_tree_uri(&normalized_root) {
        return None;
    }
    if !is_same_or_nested_android_path(&normalized_root, &normalized_path)
        || normalized_path == normalized_root
    {
        return None;
    }
    let relative = normalized_path.strip_prefix(&normalized_root)?;
    let relative = relative.strip_prefix('/')?;
    if relative.is_empty() {
        return None;
    }

    let segments = relative
        .split('/')
        .map(str::trim)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if segments.len() > 24
        || segments.iter().any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.len() > 255
                || segment
                    .chars()
                    .any(|character| character.is_control() || character == '\\')
        })
    {
        return None;
    }
    Some(segments)
}

#[cfg(target_os = "android")]
fn resolve_entry_uri(
    state: &AndroidDirectoryPickerState,
    path: &str,
    root_tree_uri: Option<&str>,
) -> Option<String> {
    // A document URI returned by SAF is directly addressable. A tree URI with
    // appended logical segments (for example `tree/.../.notia/config.json`)
    // is not a document URI and must go through the path cache/tree refresh;
    // treating it as direct would make pathExists report a false positive and
    // make writeFile target a non-existent synthetic URI.
    if is_android_document_uri(path) {
        if let Some(tree_uri) = root_tree_uri {
            if !is_document_under_tree(path, tree_uri) {
                return None;
            }
        }
        log::debug!("[notia:saf] resolve_entry_uri direct document");
        return Some(path.to_string());
    }

    // The selected tree itself is a valid SAF parent URI. Keep this explicit
    // instead of relying on the path cache: the first create/read operation
    // may happen before the initial tree refresh has populated it.
    if let Some(tree_uri) = root_tree_uri
        .map(str::trim)
        .filter(|value| is_android_tree_uri(value))
    {
        if normalize_android_path(path) == normalize_android_path(tree_uri) {
            return Some(tree_uri.to_string());
        }
    }

    // 1. Fast Rust-only LRU lookup (no JNI).
    if let Some(lru_hit) = mobile_directory_picker::resolve_android_path_lru(state, path) {
        log::debug!("[notia:saf] resolve_entry_uri lru_hit");
        return Some(lru_hit);
    }

    // 2. Persistent path map cache.
    let resolved = mobile_directory_picker::resolve_android_tree_uri(state, path, None)
        .ok()
        .flatten();
    if let Some(uri) = resolved {
        log::debug!("[notia:saf] resolve_entry_uri cache_hit");
        mobile_directory_picker::put_android_path_lru(state, path.to_string(), uri.clone());
        return Some(uri);
    }

    // 3. If the path is not in the cache but we have a root_tree_uri, use it
    // as context for resolution. This is critical for multi-library setups
    // where the paths HashMap may not have been populated yet for the new
    // library.
    if let Some(tree_uri) = root_tree_uri
        .map(str::trim)
        .filter(|v| is_android_tree_uri(v))
    {
        // Lazy cache refresh: if the cache is stale and we can't resolve
        // the path, try refreshing the cache once via a full readTree,
        // then retry the resolution.
        if !mobile_directory_picker::is_cache_fresh(state, tree_uri) {
            log::info!("[notia:saf] resolve_entry_uri cache stale, lazy refresh");
            let refresh_result =
                mobile_directory_picker::refresh_android_tree_path_cache(state, tree_uri, false);
            if let Err(ref e) = refresh_result {
                log::warn!("[notia:saf] lazy cache refresh failed error={}", e);
            } else {
                // Retry resolution after cache refresh
                let retry = mobile_directory_picker::resolve_android_tree_uri(state, path, None)
                    .ok()
                    .flatten();
                if let Some(uri) = retry {
                    log::info!("[notia:saf] resolve_entry_uri resolved after refresh");
                    mobile_directory_picker::put_android_path_lru(
                        state,
                        path.to_string(),
                        uri.clone(),
                    );
                    return Some(uri);
                }
            }
        }

        log::warn!("[notia:saf] resolve_entry_uri failed");
        return None;
    }

    log::warn!("[notia:saf] resolve_entry_uri failed no_context");
    None
}

/// Resolves a logical SAF lookup path to the real document URI used by I/O.
///
/// The lookup path may be a synthetic `tree`-based path, but the returned value
/// is only used after it has resolved to a document URI. Callers must not pass
/// the tree grant to `readFile` or `writeFile`.
#[cfg(target_os = "android")]
pub(crate) fn resolve_document_uri(
    state: &AndroidDirectoryPickerState,
    lookup_path: &str,
    root_tree_uri: Option<&str>,
) -> Option<String> {
    resolve_entry_uri(state, lookup_path, root_tree_uri)
}

#[cfg(test)]
mod tests {
    use super::{
        android_parent_path, android_relative_segments, is_android_document_uri,
        is_android_tree_uri, is_same_or_nested_android_path,
    };

    #[test]
    fn only_document_uris_bypass_saf_path_resolution() {
        assert!(is_android_document_uri(
            "content://com.android.externalstorage.documents/tree/primary%3ANotas/document/primary%3ANotas%2Fnota.md"
        ));
        assert!(!is_android_document_uri(
            "content://com.android.externalstorage.documents/tree/primary%3ANotas/.notia/notiaConfig.json"
        ));
        assert_eq!(
            android_parent_path(
                "content://com.android.externalstorage.documents/tree/primary%3ANotas/.notia"
            ),
            Some(
                "content://com.android.externalstorage.documents/tree/primary%3ANotas".to_string(),
            )
        );
        assert!(is_android_tree_uri(
            "content://com.android.externalstorage.documents/tree/primary%3ANotas"
        ));
        assert!(!is_android_tree_uri(
            "content://com.android.externalstorage.documents/tree/primary%3ANotas/document/primary%3ANotas%2Fnota.md"
        ));
    }

    #[test]
    fn derives_only_real_children_of_the_granted_tree() {
        let root = "content://provider/tree/root";
        assert_eq!(
            android_relative_segments("content://provider/tree/root/.notia/config.json", root),
            Some(vec![".notia".to_string(), "config.json".to_string()])
        );
        assert_eq!(android_relative_segments(root, root), None);
        assert_eq!(
            android_relative_segments("content://provider/tree/root-other/file", root),
            None
        );
        assert!(!is_same_or_nested_android_path(
            root,
            "content://provider/tree/root-other"
        ));
    }
}

#[cfg(target_os = "android")]
fn resolve_parent_uri(
    state: &AndroidDirectoryPickerState,
    path: &str,
    root_tree_uri: Option<&str>,
) -> Option<String> {
    let parent_path = android_parent_path(path)?;
    resolve_entry_uri(state, &parent_path, root_tree_uri)
}

#[cfg(any(target_os = "android", test))]
fn normalize_comparable_path(path: &str) -> PathBuf {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        PathBuf::from("/")
    } else {
        PathBuf::from(trimmed)
    }
}

#[cfg(any(target_os = "android", test))]
fn is_same_or_nested_android_path(parent_path: &str, child_path: &str) -> bool {
    let normalized_parent = normalize_comparable_path(parent_path);
    let normalized_child = normalize_comparable_path(child_path);

    normalized_child == normalized_parent
        || normalized_child.to_string_lossy().starts_with(&format!(
            "{}/",
            normalized_parent.to_string_lossy().trim_end_matches('/')
        ))
}

#[cfg(target_os = "android")]
pub(crate) fn read_library_file(
    state: &AndroidDirectoryPickerState,
    file_path: &str,
    root_tree_uri: Option<&str>,
) -> Option<ReadLibraryFileResult> {
    let _timer = NotiaTimer::new("saf.read_library_file").with_meta(format!("path={}", file_path));
    refresh_root_tree_cache(state, root_tree_uri);
    let content_uri = match resolve_entry_uri(state, file_path, root_tree_uri) {
        Some(content_uri) => content_uri,
        None if has_android_resolution_context(root_tree_uri, file_path) => {
            return Some(ReadLibraryFileResult {
                ok: false,
                revision: None,
                content: String::new(),
                error: Some("Could not resolve Android file.".to_string()),
            })
        }
        None => return None,
    };

    Some(
        match mobile_directory_picker::read_android_content_text(state, &content_uri) {
            Ok(content) => ReadLibraryFileResult {
                ok: true,
                revision: Some(content_revision(&content)),
                content,
                error: None,
            },
            Err(error) => ReadLibraryFileResult {
                ok: false,
                revision: None,
                content: String::new(),
                error: Some(error),
            },
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn read_library_file<T>(
    _state: &T,
    _file_path: &str,
    _root_tree_uri: Option<&str>,
) -> Option<ReadLibraryFileResult> {
    None
}

/// Reads a binary SAF document (PDF/images) for finance extraction. Returns
/// `(name, bytes)` on success, `Err(message)` on a resolvable read failure and
/// `None` when the path cannot be resolved at all (no Android context).
#[cfg(target_os = "android")]
pub(crate) fn read_library_file_bytes(
    state: &AndroidDirectoryPickerState,
    file_path: &str,
    root_tree_uri: Option<&str>,
) -> Option<Result<(String, Vec<u8>), String>> {
    let _timer =
        NotiaTimer::new("saf.read_library_file_bytes").with_meta(format!("path={}", file_path));
    refresh_root_tree_cache(state, root_tree_uri);
    let content_uri = match resolve_entry_uri(state, file_path, root_tree_uri) {
        Some(content_uri) => content_uri,
        None if has_android_resolution_context(root_tree_uri, file_path) => {
            return Some(Err("Could not resolve Android file.".to_string()))
        }
        None => return None,
    };

    Some(
        mobile_directory_picker::read_android_content_bytes(state, &content_uri)
            .map_err(|error| format!("Could not read document: {error}")),
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn read_library_file_bytes<T>(
    _state: &T,
    _file_path: &str,
    _root_tree_uri: Option<&str>,
) -> Option<Result<(String, Vec<u8>), String>> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn write_library_file(
    state: &AndroidDirectoryPickerState,
    file_path: &str,
    content: &str,
    expected_revision: Option<&str>,
    root_tree_uri: Option<&str>,
) -> Option<WriteLibraryFileResult> {
    let _timer = NotiaTimer::new("saf.write_library_file").with_meta(format!("path={}", file_path));
    refresh_root_tree_cache(state, root_tree_uri);
    let content_uri = match resolve_entry_uri(state, file_path, root_tree_uri) {
        Some(content_uri) => content_uri,
        None if has_android_resolution_context(root_tree_uri, file_path) => {
            return Some(WriteLibraryFileResult {
                revision: None,
                ok: false,
                error: Some("Could not resolve Android file.".to_string()),
                conflict: None,
            })
        }
        None => return None,
    };

    if let Some(expected_revision) = expected_revision {
        let current_revision =
            mobile_directory_picker::read_android_content_text(state, &content_uri)
                .ok()
                .map(|current| content_revision(&current));
        if current_revision.as_deref() != Some(expected_revision) {
            return Some(WriteLibraryFileResult {
                revision: None,
                ok: false,
                error: Some("CONFLICT: el archivo cambió desde la última lectura.".to_string()),
                conflict: Some(FilesystemConflict {
                    kind: "revision",
                    expected_revision: expected_revision.to_string(),
                    current_revision,
                }),
            });
        }
    }

    Some(
        match mobile_directory_picker::write_android_content_text(state, &content_uri, content) {
            Ok(()) => WriteLibraryFileResult {
                revision: None,
                ok: true,
                error: None,
                conflict: None,
            },
            Err(error) => WriteLibraryFileResult {
                revision: None,
                ok: false,
                error: Some(error),
                conflict: None,
            },
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn write_library_file<T>(
    _state: &T,
    _file_path: &str,
    _content: &str,
    _expected_revision: Option<&str>,
    _root_tree_uri: Option<&str>,
) -> Option<WriteLibraryFileResult> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn create_library_file(
    state: &AndroidDirectoryPickerState,
    file_path: &str,
    content: &str,
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    let _timer =
        NotiaTimer::new("saf.create_library_file").with_meta(format!("path={}", file_path));

    // Creation below a granted tree must not depend on readTree observing an
    // intermediate directory. Traverse/create the exact relative path in the
    // Android plugin, starting from the authoritative root grant.
    if let Some((tree_uri, segments)) = root_tree_uri
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|tree_uri| {
            android_relative_segments(file_path, tree_uri).map(|segments| (tree_uri, segments))
        })
    {
        return Some(
            match mobile_directory_picker::create_android_path_entry(
                state,
                tree_uri,
                &segments,
                "file",
                Some(content),
            ) {
                Ok(created_uri) => {
                    invalidate_paths_for_entry(state, file_path, root_tree_uri);
                    mobile_directory_picker::put_android_path_lru(
                        state,
                        file_path.to_string(),
                        created_uri,
                    );
                    OperationResult {
                        ok: true,
                        error: None,
                    }
                }
                Err(error_message) => {
                    map_already_exists_error(error_message, "Could not create file.")
                }
            },
        );
    }

    refresh_root_tree_cache(state, root_tree_uri);

    let parent_uri = match resolve_parent_uri(state, file_path, root_tree_uri) {
        Some(parent_uri) => parent_uri,
        None if has_android_resolution_context(root_tree_uri, file_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android directory.".to_string()),
            })
        }
        None => return None,
    };
    let file_name = android_file_name(file_path)?;

    Some(
        match mobile_directory_picker::create_android_tree_entry(
            state,
            &parent_uri,
            &file_name,
            "file",
            Some(content),
        ) {
            Ok(created_uri) => {
                invalidate_paths_for_entry(state, file_path, root_tree_uri);
                // SAF providers may not expose a newly-created entry in the
                // immediately following readTree. Keep the authoritative URI
                // returned by createEntry so the next operation can address
                // this exact file without treating its synthetic path as a
                // document URI.
                mobile_directory_picker::put_android_path_lru(
                    state,
                    file_path.to_string(),
                    created_uri,
                );
                OperationResult {
                    ok: true,
                    error: None,
                }
            }
            Err(error_message) => map_already_exists_error(error_message, "Could not create file."),
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn create_library_file<T>(
    _state: &T,
    _file_path: &str,
    _content: &str,
    _root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn create_library_directory(
    state: &AndroidDirectoryPickerState,
    directory_path: &str,
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    let _timer = NotiaTimer::new("saf.create_library_directory")
        .with_meta(format!("path={}", directory_path));

    if let Some((tree_uri, segments)) = root_tree_uri
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|tree_uri| {
            android_relative_segments(directory_path, tree_uri).map(|segments| (tree_uri, segments))
        })
    {
        return Some(
            match mobile_directory_picker::create_android_path_entry(
                state, tree_uri, &segments, "folder", None,
            ) {
                Ok(created_uri) => {
                    invalidate_paths_for_entry(state, directory_path, root_tree_uri);
                    mobile_directory_picker::put_android_path_lru(
                        state,
                        directory_path.to_string(),
                        created_uri,
                    );
                    OperationResult {
                        ok: true,
                        error: None,
                    }
                }
                Err(error_message) => OperationResult {
                    ok: false,
                    error: Some(format!("Could not create directory: {}", error_message)),
                },
            },
        );
    }

    refresh_root_tree_cache(state, root_tree_uri);

    let parent_uri = match resolve_parent_uri(state, directory_path, root_tree_uri) {
        Some(parent_uri) => parent_uri,
        None if has_android_resolution_context(root_tree_uri, directory_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android directory.".to_string()),
            })
        }
        None => return None,
    };
    let directory_name = android_file_name(directory_path)?;

    Some(
        match mobile_directory_picker::create_android_directory(state, &parent_uri, &directory_name)
        {
            Ok(created_uri) => {
                invalidate_paths_for_entry(state, directory_path, root_tree_uri);
                // Do not rely on an immediate tree refresh after creation:
                // some SAF providers return stale children briefly. The URI
                // from createEntry is the exact parent for a file created in
                // this directory during the same library-add transaction.
                mobile_directory_picker::put_android_path_lru(
                    state,
                    directory_path.to_string(),
                    created_uri,
                );
                OperationResult {
                    ok: true,
                    error: None,
                }
            }
            Err(error_message) => OperationResult {
                ok: false,
                error: Some(format!("Could not create directory: {}", error_message)),
            },
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn create_library_directory<T>(
    _state: &T,
    _directory_path: &str,
    _root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn path_exists(
    state: &AndroidDirectoryPickerState,
    path: &str,
    root_tree_uri: Option<&str>,
) -> PathExistsResult {
    let _timer = NotiaTimer::new("saf.path_exists").with_meta(format!("path={}", path));
    refresh_root_tree_cache(state, root_tree_uri);

    PathExistsResult {
        exists: resolve_entry_uri(state, path, root_tree_uri).is_some(),
    }
}

#[cfg(not(target_os = "android"))]
pub(crate) fn path_exists<T>(
    _state: &T,
    _path: &str,
    _root_tree_uri: Option<&str>,
) -> PathExistsResult {
    PathExistsResult { exists: false }
}

#[cfg(target_os = "android")]
pub(crate) fn write_binary_file(
    state: &AndroidDirectoryPickerState,
    file_path: &str,
    data: &[u8],
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    use std::io::Write;

    let _timer = NotiaTimer::new("saf.write_binary_file").with_meta(format!("path={}", file_path));
    refresh_root_tree_cache(state, root_tree_uri);
    match resolve_entry_uri(state, file_path, root_tree_uri) {
        Some(_) => Some(OperationResult {
            ok: false,
            error: Some("El archivo exportado ya existe.".to_string()),
        }),
        None if has_android_resolution_context(root_tree_uri, file_path) => {
            let normalized_path = file_path.replace('\\', "/");
            let Some((parent_path, file_name)) = normalized_path.rsplit_once('/') else {
                return Some(OperationResult {
                    ok: false,
                    error: Some("Could not resolve Android destination directory.".to_string()),
                });
            };
            if file_name.trim().is_empty() {
                return Some(OperationResult {
                    ok: false,
                    error: Some("Could not resolve Android destination file.".to_string()),
                });
            }
            let Some(parent_uri) = resolve_entry_uri(state, parent_path, root_tree_uri) else {
                return Some(OperationResult {
                    ok: false,
                    error: Some("Could not resolve Android destination directory.".to_string()),
                });
            };
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            let temporary_name = format!(".{file_name}.notia-export-{nonce}.tmp");
            let temporary_uri = match mobile_directory_picker::create_android_tree_entry(
                state,
                &parent_uri,
                &temporary_name,
                "file",
                None,
            ) {
                Ok(created_uri) => created_uri,
                Err(error) => {
                    return Some(OperationResult {
                        ok: false,
                        error: Some(error),
                    });
                }
            };

            let write_result =
                mobile_directory_picker::write_android_content_bytes(state, &temporary_uri, data);
            if let Err(error) = write_result {
                let _ = mobile_directory_picker::delete_android_tree_entry(state, &temporary_uri);
                return Some(OperationResult {
                    ok: false,
                    error: Some(error),
                });
            }

            match mobile_directory_picker::rename_android_tree_entry(
                state,
                &temporary_uri,
                file_name,
            ) {
                Ok(created_uri) => {
                    mobile_directory_picker::put_android_path_lru(
                        state,
                        file_path.to_string(),
                        created_uri.clone(),
                    );
                    return Some(OperationResult {
                        ok: true,
                        error: None,
                    });
                }
                Err(error) => {
                    let _ =
                        mobile_directory_picker::delete_android_tree_entry(state, &temporary_uri);
                    return Some(OperationResult {
                        ok: false,
                        error: Some(error),
                    });
                }
            }
        }
        None => None,
    }
}


#[cfg(target_os = "android")]
pub(crate) fn create_library_entry(
    state: &AndroidDirectoryPickerState,
    directory_path: &str,
    normalized_name: &str,
    kind: &str,
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    let _timer = NotiaTimer::new("saf.create_library_entry")
        .with_meta(format!("path={} kind={}", directory_path, kind));
    refresh_root_tree_cache(state, root_tree_uri);
    let parent_uri = match resolve_entry_uri(state, directory_path, root_tree_uri) {
        Some(parent_uri) => parent_uri,
        None if has_android_resolution_context(root_tree_uri, directory_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android directory.".to_string()),
            })
        }
        None => return None,
    };

    let (entry_type, content) = if kind == "folder" {
        ("folder", None)
    } else {
        ("file", Some(""))
    };

    Some(
        match mobile_directory_picker::create_android_tree_entry(
            state,
            &parent_uri,
            normalized_name,
            entry_type,
            content,
        ) {
            Ok(_) => {
                invalidate_paths_for_entry(state, directory_path, root_tree_uri);
                OperationResult {
                    ok: true,
                    error: None,
                }
            }
            Err(error_message) => {
                map_already_exists_error(error_message, "Could not create entry.")
            }
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn create_library_entry<T>(
    _state: &T,
    _directory_path: &str,
    _normalized_name: &str,
    _kind: &str,
    _root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn delete_entry(
    state: &AndroidDirectoryPickerState,
    target_path: &str,
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    let _timer = NotiaTimer::new("saf.delete_entry").with_meta(format!("path={}", target_path));
    refresh_root_tree_cache(state, root_tree_uri);
    let entry_uri = match resolve_entry_uri(state, target_path, root_tree_uri) {
        Some(entry_uri) => entry_uri,
        None if has_android_resolution_context(root_tree_uri, target_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android entry.".to_string()),
            })
        }
        None => return None,
    };

    Some(
        match mobile_directory_picker::delete_android_tree_entry(state, &entry_uri) {
            Ok(()) => {
                invalidate_paths_for_entry(state, target_path, root_tree_uri);
                OperationResult {
                    ok: true,
                    error: None,
                }
            }
            Err(error) => OperationResult {
                ok: false,
                error: Some(error),
            },
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn delete_entry<T>(
    _state: &T,
    _target_path: &str,
    _root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn rename_entry(
    state: &AndroidDirectoryPickerState,
    target_path: &str,
    new_name: &str,
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    let _timer = NotiaTimer::new("saf.rename_entry").with_meta(format!("path={}", target_path));
    refresh_root_tree_cache(state, root_tree_uri);
    let entry_uri = match resolve_entry_uri(state, target_path, root_tree_uri) {
        Some(entry_uri) => entry_uri,
        None if has_android_resolution_context(root_tree_uri, target_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android entry.".to_string()),
            })
        }
        None => return None,
    };

    Some(
        match mobile_directory_picker::rename_android_tree_entry(state, &entry_uri, new_name) {
            Ok(_) => {
                invalidate_paths_for_entry(state, target_path, root_tree_uri);
                OperationResult {
                    ok: true,
                    error: None,
                }
            }
            Err(error_message) => {
                map_already_exists_error(error_message, "Could not rename entry.")
            }
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn rename_entry<T>(
    _state: &T,
    _target_path: &str,
    _new_name: &str,
    _root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    None
}

#[cfg(target_os = "android")]
pub(crate) fn paste_entry(
    state: &AndroidDirectoryPickerState,
    source_path: &str,
    target_directory_path: &str,
    mode: &str,
    root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    let _timer =
        NotiaTimer::new("saf.paste_entry").with_meta(format!("src={} mode={}", source_path, mode));
    refresh_root_tree_cache(state, root_tree_uri);
    let source_name = Path::new(source_path).file_name()?.to_str()?;
    let target_path = PathBuf::from(target_directory_path).join(source_name);
    let target_path_string = target_path.to_string_lossy().to_string();

    if normalize_comparable_path(source_path) == normalize_comparable_path(&target_path_string) {
        return Some(OperationResult {
            ok: false,
            error: Some("Source and destination are the same.".to_string()),
        });
    }

    if resolve_entry_uri(state, &target_path_string, root_tree_uri).is_some() {
        return Some(OperationResult {
            ok: false,
            error: Some("An entry with that name already exists.".to_string()),
        });
    }

    if mode == "move" && is_same_or_nested_android_path(source_path, target_directory_path) {
        return Some(OperationResult {
            ok: false,
            error: Some("Cannot move a folder into itself.".to_string()),
        });
    }

    let source_uri = match resolve_entry_uri(state, source_path, root_tree_uri) {
        Some(source_uri) => source_uri,
        None if has_android_resolution_context(root_tree_uri, source_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android source entry.".to_string()),
            })
        }
        None => return None,
    };
    let target_parent_uri = match resolve_entry_uri(state, target_directory_path, root_tree_uri) {
        Some(target_parent_uri) => target_parent_uri,
        None if has_android_resolution_context(root_tree_uri, target_directory_path) => {
            return Some(OperationResult {
                ok: false,
                error: Some("Could not resolve Android target directory.".to_string()),
            })
        }
        None => return None,
    };

    let operation_result = if mode == "copy" {
        mobile_directory_picker::copy_android_tree_entry(state, &source_uri, &target_parent_uri)
    } else {
        let source_parent_uri = match resolve_parent_uri(state, source_path, root_tree_uri) {
            Some(source_parent_uri) => source_parent_uri,
            None if has_android_resolution_context(root_tree_uri, source_path) => {
                return Some(OperationResult {
                    ok: false,
                    error: Some("Could not resolve Android source directory.".to_string()),
                })
            }
            None => return None,
        };
        mobile_directory_picker::move_android_tree_entry(
            state,
            &source_uri,
            &source_parent_uri,
            &target_parent_uri,
        )
    };

    Some(match operation_result {
        Ok(_) => {
            // Invalidate both source and target paths. For a move, the source
            // path is removed and the target path gets a new child. For a copy,
            // the target gets a new child. Invalidate target_directory_path
            // which covers both, and also source_path for moves.
            invalidate_paths_for_entry(state, target_directory_path, root_tree_uri);
            if mode == "move" {
                invalidate_paths_for_entry(state, source_path, root_tree_uri);
            }
            OperationResult {
                ok: true,
                error: None,
            }
        }
        Err(error_message) => map_already_exists_error(error_message, "Could not paste entry."),
    })
}

#[cfg(not(target_os = "android"))]
pub(crate) fn paste_entry<T>(
    _state: &T,
    _source_path: &str,
    _target_directory_path: &str,
    _mode: &str,
    _root_tree_uri: Option<&str>,
) -> Option<OperationResult> {
    None
}
