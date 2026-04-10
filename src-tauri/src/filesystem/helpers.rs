use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::types::{FileNode, MarkdownFileDocument};

pub(crate) fn to_path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn canonical_or_original(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub(crate) fn has_invalid_entry_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return true;
    }

    trimmed.contains('/') || trimmed.contains('\\')
}

pub(crate) fn default_inkdoc_content() -> &'static str {
    r#"{
  "version": 1,
  "title": "InkDoc sin titulo",
  "page": {
    "size": "A4",
    "marginMm": 10
  },
  "pages": [
    {
      "id": "p1",
      "canvas": null
    }
  ]
}
"#
}

pub(crate) fn is_hidden_entry_name(name: &str) -> bool {
    name.trim_start().starts_with('.')
}

pub(crate) fn is_same_or_nested_path(parent_path: &Path, child_path: &Path) -> bool {
    let normalized_parent = canonical_or_original(parent_path);
    let normalized_child = canonical_or_original(child_path);

    normalized_child == normalized_parent || normalized_child.starts_with(&normalized_parent)
}

pub(crate) fn read_directory_tree(
    directory_path: &Path,
    visited_directories: &mut HashSet<PathBuf>,
) -> Vec<FileNode> {
    let canonical_directory_path = canonical_or_original(directory_path);
    if visited_directories.contains(&canonical_directory_path) {
        return Vec::new();
    }
    visited_directories.insert(canonical_directory_path);

    let Ok(entries) = fs::read_dir(directory_path) else {
        return Vec::new();
    };

    let mut children: Vec<FileNode> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let entry_name = entry.file_name().to_string_lossy().into_owned();
            if has_invalid_entry_name(&entry_name) || is_hidden_entry_name(&entry_name) {
                return None;
            }

            let entry_path = entry.path();
            let entry_path_string = to_path_string(&entry_path);
            let is_directory = entry
                .file_type()
                .map(|entry_file_type| entry_file_type.is_dir())
                .or_else(|_| fs::symlink_metadata(&entry_path).map(|metadata| metadata.is_dir()))
                .unwrap_or(false);

            if is_directory {
                return Some(FileNode {
                    id: entry_path_string.clone(),
                    name: entry_name,
                    path: Some(entry_path_string),
                    node_type: "folder".to_string(),
                    expanded: Some(true),
                    children: Some(read_directory_tree(&entry_path, visited_directories)),
                });
            }

            Some(FileNode {
                id: entry_path_string.clone(),
                name: entry_name,
                path: Some(entry_path_string),
                node_type: "file".to_string(),
                expanded: None,
                children: None,
            })
        })
        .collect();

    children.sort_by(|a, b| {
        if a.node_type != b.node_type {
            return if a.node_type == "folder" {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    children
}

pub(crate) fn update_signature_hash_with_text(current_hash: u32, value: &str) -> u32 {
    let mut next_hash = current_hash;
    for code_unit in value.encode_utf16() {
        next_hash ^= u32::from(code_unit);
        next_hash = next_hash.wrapping_mul(16_777_619);
    }

    next_hash
}

pub(crate) fn collect_directory_signature(
    directory_path: &Path,
    visited_directories: &mut HashSet<PathBuf>,
    current_hash: &mut u32,
) {
    let canonical_directory_path = canonical_or_original(directory_path);
    if visited_directories.contains(&canonical_directory_path) {
        return;
    }
    visited_directories.insert(canonical_directory_path);

    let Ok(entries) = fs::read_dir(directory_path) else {
        return;
    };

    let mut entries_to_hash: Vec<(String, PathBuf, bool)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let entry_name = entry.file_name().to_string_lossy().into_owned();
            if has_invalid_entry_name(&entry_name) || is_hidden_entry_name(&entry_name) {
                return None;
            }

            let entry_path = entry.path();
            let is_directory = entry
                .file_type()
                .map(|entry_file_type| entry_file_type.is_dir())
                .or_else(|_| fs::symlink_metadata(&entry_path).map(|metadata| metadata.is_dir()))
                .unwrap_or(false);

            Some((entry_name, entry_path, is_directory))
        })
        .collect();

    entries_to_hash.sort_by(|left, right| {
        if left.2 != right.2 {
            return if left.2 {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        left.0.to_lowercase().cmp(&right.0.to_lowercase())
    });

    for (entry_name, entry_path, is_directory) in entries_to_hash {
        let token = format!(
            "{}|{}|{}",
            if is_directory { "folder" } else { "file" },
            to_path_string(&entry_path),
            entry_name
        );
        *current_hash = update_signature_hash_with_text(*current_hash, &token);

        if is_directory {
            collect_directory_signature(&entry_path, visited_directories, current_hash);
        }
    }
}

pub(crate) fn copy_entry_recursive(source_path: &Path, target_path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(source_path)?;
    if metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Symbolic links are not supported.",
        ));
    }

    if metadata.is_dir() {
        fs::create_dir(target_path)?;
        for entry in fs::read_dir(source_path)? {
            let entry = entry?;
            let entry_source_path = entry.path();
            let entry_target_path = target_path.join(entry.file_name());
            copy_entry_recursive(&entry_source_path, &entry_target_path)?;
        }
        return Ok(());
    }

    fs::copy(source_path, target_path)?;
    Ok(())
}

pub(crate) fn search_library_files_in_directory(
    directory_path: &Path,
    normalized_query: &str,
    visited_directories: &mut HashSet<PathBuf>,
    matched_file_paths: &mut Vec<String>,
) {
    let canonical_directory_path = canonical_or_original(directory_path);
    if visited_directories.contains(&canonical_directory_path) {
        return;
    }
    visited_directories.insert(canonical_directory_path);

    let Ok(entries) = fs::read_dir(directory_path) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if has_invalid_entry_name(&entry_name) || is_hidden_entry_name(&entry_name) {
            continue;
        }

        let entry_path = entry.path();
        let entry_metadata = fs::metadata(&entry_path).ok();
        let is_directory = entry
            .file_type()
            .map(|entry_file_type| entry_file_type.is_dir())
            .or_else(|_| {
                entry_metadata
                    .as_ref()
                    .map(|metadata| metadata.is_dir())
                    .ok_or(std::io::Error::from(std::io::ErrorKind::Other))
            })
            .unwrap_or(false);

        if is_directory {
            search_library_files_in_directory(
                &entry_path,
                normalized_query,
                visited_directories,
                matched_file_paths,
            );
            continue;
        }

        let entry_name_matches = entry_name.to_lowercase().contains(normalized_query);
        if entry_name_matches {
            matched_file_paths.push(to_path_string(&entry_path));
            continue;
        }

        if entry_metadata
            .as_ref()
            .map(|metadata| metadata.len() > 2_000_000)
            .unwrap_or(true)
        {
            continue;
        }

        let Ok(file_content) = fs::read_to_string(&entry_path) else {
            continue;
        };
        if file_content.to_lowercase().contains(normalized_query) {
            matched_file_paths.push(to_path_string(&entry_path));
        }
    }
}

pub(crate) fn read_markdown_files_in_directory(
    directory_path: &Path,
    visited_directories: &mut HashSet<PathBuf>,
    documents: &mut Vec<MarkdownFileDocument>,
) {
    let canonical_directory_path = canonical_or_original(directory_path);
    if visited_directories.contains(&canonical_directory_path) {
        return;
    }
    visited_directories.insert(canonical_directory_path);

    let Ok(entries) = fs::read_dir(directory_path) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if has_invalid_entry_name(&entry_name) || is_hidden_entry_name(&entry_name) {
            continue;
        }

        let entry_path = entry.path();
        let is_directory = entry
            .file_type()
            .map(|entry_file_type| entry_file_type.is_dir())
            .or_else(|_| fs::symlink_metadata(&entry_path).map(|metadata| metadata.is_dir()))
            .unwrap_or(false);

        if is_directory {
            read_markdown_files_in_directory(&entry_path, visited_directories, documents);
            continue;
        }

        let Some(extension) = entry_path.extension() else {
            continue;
        };
        if extension.to_string_lossy().to_lowercase() != "md" {
            continue;
        }

        let Ok(content) = fs::read_to_string(&entry_path) else {
            continue;
        };

        documents.push(MarkdownFileDocument {
            path: to_path_string(&entry_path),
            content,
        });
    }
}
