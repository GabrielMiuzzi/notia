use std::path::{Path, PathBuf};

use crate::mobile_directory_picker;
use crate::notia_timer::NotiaTimer;

use super::helpers::default_inkdoc_content;
use super::types::{
    IsDirectoryPathResult, OperationResult, PathExistsResult, ReadLibraryFileResult,
    WriteLibraryFileResult,
};

#[cfg(target_os = "android")]
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

#[cfg(target_os = "android")]
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
            error: Some(fallback.to_string()),
        }
    }
}

#[cfg(target_os = "android")]
fn refresh_root_tree_cache(state: &AndroidDirectoryPickerState, root_tree_uri: Option<&str>) {
    if let Some(tree_uri) = root_tree_uri {
        let is_fresh = mobile_directory_picker::is_cache_fresh(state, tree_uri);
        if is_fresh {
            log::debug!("[notia:saf] cache hit uri={}", tree_uri);
        } else {
            // Instead of eagerly doing a full readTree, just invalidate the
            // cache. The next operation that truly needs to resolve a path
            // will trigger a lazy refresh. This avoids the expensive full
            // tree traversal that refresh_android_tree_path_cache would do.
            log::info!(
                "[notia:saf] cache stale, invalidating (lazy refresh) uri={}",
                tree_uri
            );
            mobile_directory_picker::invalidate_tree_cache(state, tree_uri);
        }
    }
}

/// Mark the SAF path cache as stale so that the next operation that needs a
/// fresh cache will trigger a full `readTree`. This is used after mutations
/// (create, delete, rename, paste) instead of eagerly doing a full refresh.
#[cfg(target_os = "android")]
fn invalidate_root_tree_cache(state: &AndroidDirectoryPickerState, root_tree_uri: Option<&str>) {
    if let Some(tree_uri) = root_tree_uri {
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
    // 1. Invalidate the Kotlin tree cache timestamp so that the next readTree
    //    or readFlatFileList will fetch fresh data from SAF.
    if let Some(tree_uri) = root_tree_uri {
        mobile_directory_picker::invalidate_tree_cache(state, tree_uri);
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

#[cfg(target_os = "android")]
fn resolve_entry_uri(
    state: &AndroidDirectoryPickerState,
    path: &str,
    root_tree_uri: Option<&str>,
) -> Option<String> {
    if path.starts_with("content://") {
        log::debug!(
            "[notia:saf] resolve_entry_uri direct content:// path={}",
            path
        );
        Some(path.to_string())
    } else {
        // Try the cached path map first (most common case).
        let resolved = mobile_directory_picker::resolve_android_tree_uri(state, path, None)
            .ok()
            .flatten();
        if resolved.is_some() {
            log::debug!("[notia:saf] resolve_entry_uri cache_hit path={}", path);
            return resolved;
        }

        // If the path is not in the cache but we have a root_tree_uri, use it
        // as context for resolution. This is critical for multi-library setups
        // where the paths HashMap may not have been populated yet for the new
        // library.
        if let Some(tree_uri) = root_tree_uri.map(str::trim).filter(|v| !v.is_empty()) {
            // Lazy cache refresh: if the cache is stale and we can't resolve
            // the path, try refreshing the cache once via a full readTree,
            // then retry the resolution.
            if !mobile_directory_picker::is_cache_fresh(state, tree_uri) {
                log::info!(
                    "[notia:saf] resolve_entry_uri cache stale, lazy refresh path={} tree_uri={}",
                    path,
                    tree_uri
                );
                let refresh_result = mobile_directory_picker::refresh_android_tree_path_cache(
                    state, tree_uri, false,
                );
                if let Err(ref e) = refresh_result {
                    log::warn!(
                        "[notia:saf] lazy cache refresh failed uri={} error={}",
                        tree_uri,
                        e
                    );
                } else {
                    // Retry resolution after cache refresh
                    let retry =
                        mobile_directory_picker::resolve_android_tree_uri(state, path, None)
                            .ok()
                            .flatten();
                    if retry.is_some() {
                        log::info!(
                            "[notia:saf] resolve_entry_uri resolved after refresh path={}",
                            path
                        );
                        return retry;
                    }
                }
            }

            let fallback =
                mobile_directory_picker::resolve_android_tree_uri(state, path, Some(tree_uri))
                    .ok()
                    .flatten();
            if fallback.is_some() {
                log::info!(
                    "[notia:saf] resolve_entry_uri root_fallback path={} tree_uri={}",
                    path,
                    tree_uri
                );
            } else {
                log::warn!(
                    "[notia:saf] resolve_entry_uri failed path={} tree_uri={}",
                    path,
                    tree_uri
                );
            }
            fallback
        } else {
            log::warn!(
                "[notia:saf] resolve_entry_uri failed no_context path={}",
                path
            );
            None
        }
    }
}

#[cfg(target_os = "android")]
fn resolve_parent_uri(
    state: &AndroidDirectoryPickerState,
    path: &str,
    root_tree_uri: Option<&str>,
) -> Option<String> {
    let path = PathBuf::from(path);
    let parent_path = path.parent()?.to_string_lossy().to_string();
    resolve_entry_uri(state, &parent_path, root_tree_uri)
}

#[cfg(target_os = "android")]
fn normalize_comparable_path(path: &str) -> PathBuf {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        PathBuf::from("/")
    } else {
        PathBuf::from(trimmed)
    }
}

#[cfg(target_os = "android")]
fn is_same_or_nested_android_path(parent_path: &str, child_path: &str) -> bool {
    let normalized_parent = normalize_comparable_path(parent_path);
    let normalized_child = normalize_comparable_path(child_path);

    normalized_child == normalized_parent || normalized_child.starts_with(&normalized_parent)
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
                content,
                error: None,
            },
            Err(_) => ReadLibraryFileResult {
                ok: false,
                content: String::new(),
                error: Some("Could not read file.".to_string()),
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

#[cfg(target_os = "android")]
pub(crate) fn write_library_file(
    state: &AndroidDirectoryPickerState,
    file_path: &str,
    content: &str,
    root_tree_uri: Option<&str>,
) -> Option<WriteLibraryFileResult> {
    let _timer = NotiaTimer::new("saf.write_library_file").with_meta(format!("path={}", file_path));
    refresh_root_tree_cache(state, root_tree_uri);
    let content_uri = match resolve_entry_uri(state, file_path, root_tree_uri) {
        Some(content_uri) => content_uri,
        None if has_android_resolution_context(root_tree_uri, file_path) => {
            return Some(WriteLibraryFileResult {
                ok: false,
                error: Some("Could not resolve Android file.".to_string()),
            })
        }
        None => return None,
    };

    Some(
        match mobile_directory_picker::write_android_content_text(state, &content_uri, content) {
            Ok(()) => WriteLibraryFileResult {
                ok: true,
                error: None,
            },
            Err(_) => WriteLibraryFileResult {
                ok: false,
                error: Some("Could not write file.".to_string()),
            },
        },
    )
}

#[cfg(not(target_os = "android"))]
pub(crate) fn write_library_file<T>(
    _state: &T,
    _file_path: &str,
    _content: &str,
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
    let file_name = Path::new(file_path).file_name()?.to_str()?;

    Some(
        match mobile_directory_picker::create_android_tree_entry(
            state,
            &parent_uri,
            file_name,
            "file",
            Some(content),
        ) {
            Ok(_) => {
                invalidate_paths_for_entry(state, file_path, root_tree_uri);
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
    let directory_name = Path::new(directory_path).file_name()?.to_str()?;

    Some(
        match mobile_directory_picker::create_android_directory(state, &parent_uri, directory_name)
        {
            Ok(_) => {
                invalidate_paths_for_entry(state, directory_path, root_tree_uri);
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
pub(crate) fn is_directory_path(
    state: &AndroidDirectoryPickerState,
    path: &str,
    root_tree_uri: Option<&str>,
) -> IsDirectoryPathResult {
    let _timer = NotiaTimer::new("saf.is_directory_path").with_meta(format!("path={}", path));
    refresh_root_tree_cache(state, root_tree_uri);
    let Some(entry_uri) = resolve_entry_uri(state, path, root_tree_uri) else {
        return IsDirectoryPathResult {
            is_directory: false,
        };
    };

    IsDirectoryPathResult {
        is_directory: mobile_directory_picker::read_android_entry_type(state, &entry_uri)
            .map(|entry_type| entry_type == "folder")
            .unwrap_or(false),
    }
}

#[cfg(not(target_os = "android"))]
pub(crate) fn is_directory_path<T>(
    _state: &T,
    _path: &str,
    _root_tree_uri: Option<&str>,
) -> IsDirectoryPathResult {
    IsDirectoryPathResult {
        is_directory: false,
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
    } else if kind == "inkdoc" {
        ("file", Some(default_inkdoc_content()))
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
            Err(_) => OperationResult {
                ok: false,
                error: Some("Could not delete entry.".to_string()),
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
