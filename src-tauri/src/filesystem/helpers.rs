use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::notia_timer::NotiaTimer;

use super::types::{FileNode, MarkdownFileDocument};

pub(crate) fn to_path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn canonical_or_original(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub(crate) fn has_invalid_entry_name(name: &str) -> bool {
    if name.is_empty() {
        return true;
    }

    // Fast path: avoid allocation for names without whitespace or separators.
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return true;
    }

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

/// Strips matching surrounding YAML quotes (single or double) and unescapes simple sequences.
fn strip_yaml_quotes(value: &str) -> String {
    let s = value.trim();
    if s.len() >= 2 {
        let first = s.chars().next().unwrap();
        let last = s.chars().last().unwrap();
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            let inner = &s[1..s.len() - 1];
            return if first == '"' {
                inner.replace("\\\"", "\"").replace("\\\\", "\\")
            } else {
                inner.replace("\\'", "'")
            };
        }
    }
    s.to_string()
}

const FRONTMATTER_MAX_LINES: usize = 100;

pub(crate) fn read_partial_frontmatter(file_path: &Path) -> Option<HashMap<String, String>> {
    let file = fs::File::open(file_path).ok()?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let first_line = lines.next()?.ok()?;
    if first_line.trim() != "---" {
        return None;
    }

    let mut map = HashMap::with_capacity(4);
    let mut line_count = 0;
    for line_result in lines {
        line_count += 1;
        if line_count > FRONTMATTER_MAX_LINES {
            break;
        }
        let line = line_result.ok()?;
        if line.trim() == "---" {
            break;
        }

        if let Some((key, value)) = line.split_once(':') {
            let trimmed_key = key.trim().to_string();
            let trimmed_value = strip_yaml_quotes(value.trim());
            if trimmed_key == "nextPage"
                || trimmed_key == "previousPage"
                || trimmed_key == "createdAt"
            {
                map.insert(trimmed_key, trimmed_value);
            }
        }
    }

    if map.is_empty() {
        return None;
    }

    Some(map)
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
    let _timer = NotiaTimer::new("helpers.read_directory_tree")
        .with_meta(format!("path={}", directory_path.display()));
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
            let entry_name_lossy = entry.file_name();
            let entry_name = entry_name_lossy.to_string_lossy();
            if has_invalid_entry_name(&entry_name) || is_hidden_entry_name(&entry_name) {
                return None;
            }

            let entry_path = entry.path();
            let entry_path_string = to_path_string(&entry_path);
            let meta = fs::metadata(&entry_path).ok();
            let is_directory = entry
                .file_type()
                .map(|entry_file_type| entry_file_type.is_dir())
                .or_else(|_| fs::symlink_metadata(&entry_path).map(|metadata| metadata.is_dir()))
                .unwrap_or(false);

            let created_ms = meta
                .as_ref()
                .and_then(|m| m.created().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            let modified_ms = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);

            let mut effective_created = created_ms.or(modified_ms);

            let mut next_page: Option<String> = None;
            let mut previous_page: Option<String> = None;

            if !is_directory {
                if let Some(ext) = entry_path.extension() {
                    if ext.to_string_lossy().to_lowercase() == "md" {
                        if let Some(frontmatter) = read_partial_frontmatter(&entry_path) {
                            if let Some(created_at_str) = frontmatter.get("createdAt") {
                                if let Ok(created_at_parsed) = created_at_str.parse::<i64>() {
                                    effective_created = Some(created_at_parsed);
                                }
                            }
                            if let Some(np) = frontmatter.get("nextPage") {
                                if np.trim() != "N/A" && !np.trim().is_empty() {
                                    next_page = Some(np.trim().to_string());
                                }
                            }
                            if let Some(pp) = frontmatter.get("previousPage") {
                                if pp.trim() != "N/A" && !pp.trim().is_empty() {
                                    previous_page = Some(pp.trim().to_string());
                                }
                            }
                        }
                    }
                }
            }

            if is_directory {
                return Some(FileNode {
                    id: entry_path_string.clone(),
                    name: entry_name.into_owned(),
                    path: Some(entry_path_string),
                    node_type: "folder".to_string(),
                    expanded: Some(true),
                    children: Some(read_directory_tree(&entry_path, visited_directories)),
                    created_at: effective_created,
                    modified_at: modified_ms,
                    next_page: None,
                    previous_page: None,
                });
            }

            Some(FileNode {
                id: entry_path_string.clone(),
                name: entry_name.into_owned(),
                path: Some(entry_path_string),
                node_type: "file".to_string(),
                expanded: None,
                children: None,
                created_at: effective_created,
                modified_at: modified_ms,
                next_page,
                previous_page,
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

        let a_date = a.created_at.or(a.modified_at).unwrap_or(i64::MAX);
        let b_date = b.created_at.or(b.modified_at).unwrap_or(i64::MAX);
        let date_cmp = a_date.cmp(&b_date);
        if date_cmp != Ordering::Equal {
            return date_cmp;
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
    let _timer = NotiaTimer::new("helpers.collect_directory_signature")
        .with_meta(format!("path={}", directory_path.display()));
    let canonical_directory_path = canonical_or_original(directory_path);
    if visited_directories.contains(&canonical_directory_path) {
        return;
    }
    visited_directories.insert(canonical_directory_path);

    let Ok(entries) = fs::read_dir(directory_path) else {
        return;
    };

    let mut entries_to_hash: Vec<(String, PathBuf, bool, Option<i64>)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let entry_name_lossy = entry.file_name();
            let entry_name = entry_name_lossy.to_string_lossy();
            if has_invalid_entry_name(&entry_name) || is_hidden_entry_name(&entry_name) {
                return None;
            }

            let entry_path = entry.path();
            let meta = fs::metadata(&entry_path).ok();
            let is_directory = entry
                .file_type()
                .map(|entry_file_type| entry_file_type.is_dir())
                .or_else(|_| fs::symlink_metadata(&entry_path).map(|metadata| metadata.is_dir()))
                .unwrap_or(false);

            let created_ms = meta
                .as_ref()
                .and_then(|m| m.created().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            let modified_ms = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);

            let effective_created = created_ms.or(modified_ms);

            Some((
                entry_name.into_owned(),
                entry_path,
                is_directory,
                effective_created,
            ))
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

        let left_date = left.3.unwrap_or(i64::MAX);
        let right_date = right.3.unwrap_or(i64::MAX);
        let date_cmp = left_date.cmp(&right_date);
        if date_cmp != Ordering::Equal {
            return date_cmp;
        }

        left.0.to_lowercase().cmp(&right.0.to_lowercase())
    });

    for (entry_name, entry_path, is_directory, _created_at) in entries_to_hash {
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
    let _timer = NotiaTimer::new("helpers.read_markdown_files_in_directory")
        .with_meta(format!("path={}", directory_path.display()));
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn read_partial_frontmatter_reads_page_links() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_frontmatter_page_links.md");
        let mut file = fs::File::create(&file_path).unwrap();
        write!(
            file,
            "---\ncreatedAt: 1699999999\nnextPage: [[B.md]]\npreviousPage: N/A\n---\n\n# Hello\n"
        )
        .unwrap();
        drop(file);

        let result = read_partial_frontmatter(&file_path).unwrap();
        assert_eq!(result.get("createdAt"), Some(&"1699999999".to_string()));
        assert_eq!(result.get("nextPage"), Some(&"[[B.md]]".to_string()));
        assert_eq!(result.get("previousPage"), Some(&"N/A".to_string()));

        fs::remove_file(&file_path).unwrap();
    }

    #[test]
    fn read_partial_frontmatter_strips_yaml_quotes() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_quotes.md");
        let mut file = fs::File::create(&file_path).unwrap();
        write!(
            file,
            "---\nnextPage: \"[[B.md]]\"\npreviousPage: '[[A.md]]'\ncreatedAt: 1699999999\n---\n\n# Hello\n"
        )
        .unwrap();
        drop(file);

        let result = read_partial_frontmatter(&file_path).unwrap();
        assert_eq!(result.get("nextPage"), Some(&"[[B.md]]".to_string()));
        assert_eq!(result.get("previousPage"), Some(&"[[A.md]]".to_string()));
        assert_eq!(result.get("createdAt"), Some(&"1699999999".to_string()));

        fs::remove_file(&file_path).unwrap();
    }

    #[test]
    fn read_partial_frontmatter_returns_none_for_no_frontmatter() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_no_frontmatter.md");
        let mut file = fs::File::create(&file_path).unwrap();
        write!(file, "# Hello\n\nWorld\n").unwrap();
        drop(file);

        let result = read_partial_frontmatter(&file_path);
        assert!(result.is_none());

        fs::remove_file(&file_path).unwrap();
    }

    #[test]
    fn read_partial_frontmatter_returns_none_for_empty_file() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_empty.md");
        let file = fs::File::create(&file_path).unwrap();
        drop(file);

        let result = read_partial_frontmatter(&file_path);
        assert!(result.is_none());

        fs::remove_file(&file_path).unwrap();
    }

    #[test]
    fn read_partial_frontmatter_skips_unrelated_keys() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_skip_keys.md");
        let mut file = fs::File::create(&file_path).unwrap();
        write!(
            file,
            "---\ntitle: Hello\nnextPage: [[C.md]]\nauthor: Me\n---\n\nBody\n"
        )
        .unwrap();
        drop(file);

        let result = read_partial_frontmatter(&file_path).unwrap();
        assert_eq!(result.get("nextPage"), Some(&"[[C.md]]".to_string()));
        assert!(!result.contains_key("title"));
        assert!(!result.contains_key("author"));

        fs::remove_file(&file_path).unwrap();
    }
}
