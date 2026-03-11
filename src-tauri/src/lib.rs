use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

mod mobile_directory_picker;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    id: String,
    name: String,
    path: Option<String>,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<FileNode>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadLibraryFileResult {
    ok: bool,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteLibraryFileResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchLibraryFilesResult {
    paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFileDocument {
    path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadLibraryTreePayload {
    directory_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadLibraryFilePayload {
    file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteLibraryFilePayload {
    file_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLibraryFilePayload {
    file_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLibraryDirectoryPayload {
    directory_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathExistsPayload {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteBinaryFilePayload {
    file_path: String,
    data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateLibraryEntryPayload {
    directory_path: String,
    #[serde(default)]
    directory_uri: Option<String>,
    name: String,
    kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchLibraryFilesPayload {
    directory_path: String,
    query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathExistsResult {
    exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IsDirectoryPathResult {
    is_directory: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadMarkdownFilesPayload {
    directory_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryEntryOperationPayload {
    action: String,
    target_path: Option<String>,
    new_name: Option<String>,
    source_path: Option<String>,
    target_directory_path: Option<String>,
    mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowControlPayload {
    action: String,
}

fn to_path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn canonical_or_original(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn has_invalid_entry_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return true;
    }

    trimmed.contains('/') || trimmed.contains('\\')
}

fn default_inkdoc_content() -> &'static str {
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

fn is_hidden_entry_name(name: &str) -> bool {
    name.trim_start().starts_with('.')
}

fn is_same_or_nested_path(parent_path: &Path, child_path: &Path) -> bool {
    let normalized_parent = canonical_or_original(parent_path);
    let normalized_child = canonical_or_original(child_path);

    normalized_child == normalized_parent || normalized_child.starts_with(&normalized_parent)
}

fn read_directory_tree(
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

fn update_signature_hash_with_text(current_hash: u32, value: &str) -> u32 {
    let mut next_hash = current_hash;
    for code_unit in value.encode_utf16() {
        next_hash ^= u32::from(code_unit);
        next_hash = next_hash.wrapping_mul(16_777_619);
    }

    next_hash
}

fn collect_directory_signature(
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

fn copy_entry_recursive(source_path: &Path, target_path: &Path) -> std::io::Result<()> {
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

fn search_library_files_in_directory(
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

fn read_markdown_files_in_directory(
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

#[tauri::command]
fn read_library_tree(payload: ReadLibraryTreePayload) -> Vec<FileNode> {
    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    read_directory_tree(&directory_path, &mut visited_directories)
}

#[tauri::command]
fn read_library_tree_signature(payload: ReadLibraryTreePayload) -> String {
    if payload.directory_path.trim().is_empty() {
        return String::new();
    }

    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let mut signature_hash: u32 = 2_166_136_261;
    collect_directory_signature(&directory_path, &mut visited_directories, &mut signature_hash);
    format!("{:08x}", signature_hash)
}

#[tauri::command]
fn read_library_file(
    payload: ReadLibraryFilePayload,
    android_picker_state: tauri::State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> ReadLibraryFileResult {
    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    if payload.file_path.trim().is_empty() {
        return ReadLibraryFileResult {
            ok: false,
            content: String::new(),
            error: Some("Invalid file path.".to_string()),
        };
    }

    #[cfg(target_os = "android")]
    if payload.file_path.starts_with("content://") {
        match mobile_directory_picker::read_android_content_text(
            android_picker_state.inner(),
            &payload.file_path,
        ) {
            Ok(content) => {
                return ReadLibraryFileResult {
                    ok: true,
                    content,
                    error: None,
                }
            }
            Err(_) => {
                return ReadLibraryFileResult {
                    ok: false,
                    content: String::new(),
                    error: Some("Could not read file.".to_string()),
                }
            }
        }
    }

    match fs::read_to_string(payload.file_path) {
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
    }
}

#[tauri::command]
fn search_library_files(payload: SearchLibraryFilesPayload) -> SearchLibraryFilesResult {
    let normalized_query = payload.query.trim().to_lowercase();
    if payload.directory_path.trim().is_empty() || normalized_query.is_empty() {
        return SearchLibraryFilesResult { paths: Vec::new() };
    }

    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let mut matched_file_paths: Vec<String> = Vec::new();

    search_library_files_in_directory(
        &directory_path,
        &normalized_query,
        &mut visited_directories,
        &mut matched_file_paths,
    );

    matched_file_paths.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    SearchLibraryFilesResult {
        paths: matched_file_paths,
    }
}

#[tauri::command]
fn read_markdown_files(payload: ReadMarkdownFilesPayload) -> Vec<MarkdownFileDocument> {
    if payload.directory_path.trim().is_empty() {
        return Vec::new();
    }

    let directory_path = PathBuf::from(payload.directory_path);
    let mut visited_directories = HashSet::new();
    let mut documents = Vec::new();

    read_markdown_files_in_directory(&directory_path, &mut visited_directories, &mut documents);
    documents.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    documents
}

#[tauri::command]
fn write_library_file(
    payload: WriteLibraryFilePayload,
    android_picker_state: tauri::State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> WriteLibraryFileResult {
    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    if payload.file_path.trim().is_empty() {
        return WriteLibraryFileResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    #[cfg(target_os = "android")]
    if payload.file_path.starts_with("content://") {
        match mobile_directory_picker::write_android_content_text(
            android_picker_state.inner(),
            &payload.file_path,
            &payload.content,
        ) {
            Ok(()) => {
                return WriteLibraryFileResult {
                    ok: true,
                    error: None,
                }
            }
            Err(_) => {
                return WriteLibraryFileResult {
                    ok: false,
                    error: Some("Could not write file.".to_string()),
                }
            }
        }
    }

    match fs::write(payload.file_path, payload.content) {
        Ok(()) => WriteLibraryFileResult {
            ok: true,
            error: None,
        },
        Err(_) => WriteLibraryFileResult {
            ok: false,
            error: Some("Could not write file.".to_string()),
        },
    }
}

#[tauri::command]
fn create_library_file(payload: CreateLibraryFilePayload) -> OperationResult {
    if payload.file_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&payload.file_path)
    {
        Ok(mut file) => {
            use std::io::Write;
            let write_result = file.write_all(payload.content.as_bytes());
            match write_result {
                Ok(()) => OperationResult {
                    ok: true,
                    error: None,
                },
                Err(_) => OperationResult {
                    ok: false,
                    error: Some("Could not create file.".to_string()),
                },
            }
        }
        Err(error) => {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            OperationResult {
                ok: false,
                error: Some("Could not create file.".to_string()),
            }
        }
    }
}

#[tauri::command]
fn create_library_directory(payload: CreateLibraryDirectoryPayload) -> OperationResult {
    if payload.directory_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid directory data.".to_string()),
        };
    }

    match fs::create_dir(payload.directory_path) {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(error) => {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            OperationResult {
                ok: false,
                error: Some("Could not create directory.".to_string()),
            }
        }
    }
}

#[tauri::command]
fn path_exists(payload: PathExistsPayload) -> PathExistsResult {
    if payload.path.trim().is_empty() {
        return PathExistsResult { exists: false };
    }

    PathExistsResult {
        exists: Path::new(&payload.path).exists(),
    }
}

#[tauri::command]
fn is_directory_path(payload: PathExistsPayload) -> IsDirectoryPathResult {
    if payload.path.trim().is_empty() {
        return IsDirectoryPathResult {
            is_directory: false,
        };
    }

    IsDirectoryPathResult {
        is_directory: Path::new(&payload.path).is_dir(),
    }
}

#[tauri::command]
fn write_binary_file(payload: WriteBinaryFilePayload) -> OperationResult {
    if payload.file_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    match fs::write(payload.file_path, payload.data) {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(_) => OperationResult {
            ok: false,
            error: Some("Could not write file.".to_string()),
        },
    }
}

#[tauri::command]
fn create_library_entry(
    payload: CreateLibraryEntryPayload,
    android_picker_state: tauri::State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> OperationResult {
    #[cfg(not(target_os = "android"))]
    {
        let _ = android_picker_state;
        let _ = &payload.directory_uri;
    }

    if payload.directory_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid entry data.".to_string()),
        };
    }

    if payload.kind != "folder" && payload.kind != "note" && payload.kind != "inkdoc" {
        return OperationResult {
            ok: false,
            error: Some("Invalid entry type.".to_string()),
        };
    }

    if has_invalid_entry_name(&payload.name) {
        return OperationResult {
            ok: false,
            error: Some("Invalid name.".to_string()),
        };
    }

    let trimmed_name = payload.name.trim();
    let normalized_name = if payload.kind == "note" && !trimmed_name.to_lowercase().ends_with(".md") {
        format!("{}.md", trimmed_name)
    } else if payload.kind == "inkdoc" && !trimmed_name.to_lowercase().ends_with(".inkdoc") {
        format!("{}.inkdoc", trimmed_name)
    } else {
        trimmed_name.to_string()
    };

    #[cfg(target_os = "android")]
    {
        let resolved_uri = if payload.directory_path.starts_with("content://") {
            Some(payload.directory_path.clone())
        } else {
            match mobile_directory_picker::resolve_android_tree_uri(
                android_picker_state.inner(),
                &payload.directory_path,
                payload.directory_uri.as_deref(),
            ) {
                Ok(uri) => uri,
                Err(_) => None,
            }
        };

        if let Some(parent_uri) = resolved_uri {
            let (entry_type, content) = if payload.kind == "folder" {
                ("folder", None)
            } else if payload.kind == "inkdoc" {
                ("file", Some(default_inkdoc_content()))
            } else {
                ("file", Some(""))
            };

            return match mobile_directory_picker::create_android_tree_entry(
                android_picker_state.inner(),
                &parent_uri,
                &normalized_name,
                entry_type,
                content,
            ) {
                Ok(_) => OperationResult {
                    ok: true,
                    error: None,
                },
                Err(error_message) => {
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
                            error: Some("Could not create entry.".to_string()),
                        }
                    }
                }
            };
        }
    }

    let target_path = PathBuf::from(&payload.directory_path).join(normalized_name);

    let operation_result = if payload.kind == "folder" {
        fs::create_dir(target_path)
    } else if payload.kind == "inkdoc" {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target_path)
            .and_then(|mut file| {
                use std::io::Write;
                file.write_all(default_inkdoc_content().as_bytes())
            })
    } else {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target_path)
            .map(|_| ())
    };

    match operation_result {
        Ok(()) => OperationResult {
            ok: true,
            error: None,
        },
        Err(error) => {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            OperationResult {
                ok: false,
                error: Some("Could not create entry.".to_string()),
            }
        }
    }
}

#[tauri::command]
fn library_entry_operation(payload: LibraryEntryOperationPayload) -> OperationResult {
    match payload.action.as_str() {
        "delete" => {
            let Some(target_path_value) = payload.target_path else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid target path.".to_string()),
                };
            };

            let target_path = PathBuf::from(target_path_value);
            let operation_result = if target_path.is_dir() {
                fs::remove_dir_all(target_path)
            } else {
                fs::remove_file(target_path)
            };

            match operation_result {
                Ok(()) => OperationResult {
                    ok: true,
                    error: None,
                },
                Err(_) => OperationResult {
                    ok: false,
                    error: Some("Could not delete entry.".to_string()),
                },
            }
        }
        "rename" => {
            let Some(target_path_value) = payload.target_path else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid rename data.".to_string()),
                };
            };
            let Some(new_name) = payload.new_name else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid rename data.".to_string()),
                };
            };

            if has_invalid_entry_name(&new_name) {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid rename data.".to_string()),
                };
            }

            let target_path = PathBuf::from(target_path_value);
            let Some(parent_directory) = target_path.parent() else {
                return OperationResult {
                    ok: false,
                    error: Some("Could not rename entry.".to_string()),
                };
            };

            let next_path = parent_directory.join(new_name.trim());
            if next_path.exists() {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            match fs::rename(target_path, next_path) {
                Ok(()) => OperationResult {
                    ok: true,
                    error: None,
                },
                Err(_) => OperationResult {
                    ok: false,
                    error: Some("Could not rename entry.".to_string()),
                },
            }
        }
        "paste" => {
            let Some(source_path_value) = payload.source_path else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid paste data.".to_string()),
                };
            };
            let Some(target_directory_path_value) = payload.target_directory_path else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid paste data.".to_string()),
                };
            };
            let Some(mode) = payload.mode else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid paste data.".to_string()),
                };
            };

            if mode != "copy" && mode != "move" {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid paste data.".to_string()),
                };
            }

            let source_path = PathBuf::from(source_path_value);
            let target_directory_path = PathBuf::from(target_directory_path_value);
            let Some(source_name) = source_path.file_name() else {
                return OperationResult {
                    ok: false,
                    error: Some("Invalid paste data.".to_string()),
                };
            };
            let target_path = target_directory_path.join(source_name);

            if canonical_or_original(&source_path) == canonical_or_original(&target_path) {
                return OperationResult {
                    ok: false,
                    error: Some("Source and destination are the same.".to_string()),
                };
            }

            if target_path.exists() {
                return OperationResult {
                    ok: false,
                    error: Some("An entry with that name already exists.".to_string()),
                };
            }

            if mode == "move" && is_same_or_nested_path(&source_path, &target_directory_path) {
                return OperationResult {
                    ok: false,
                    error: Some("Cannot move a folder into itself.".to_string()),
                };
            }

            let operation_result = if mode == "copy" {
                copy_entry_recursive(&source_path, &target_path)
            } else {
                fs::rename(&source_path, &target_path)
            };

            match operation_result {
                Ok(()) => OperationResult {
                    ok: true,
                    error: None,
                },
                Err(_) => OperationResult {
                    ok: false,
                    error: Some("Could not paste entry.".to_string()),
                },
            }
        }
        _ => OperationResult {
            ok: false,
            error: Some("Unknown action.".to_string()),
        },
    }
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn window_control(window: tauri::Window, payload: WindowControlPayload) {
    match payload.action.as_str() {
        "minimize" => {
            let _ = window.minimize();
        }
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
        }
        "close" => {
            let _ = window.close();
        }
        _ => {}
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
fn window_control(_window: tauri::Window, _payload: WindowControlPayload) {}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn start_window_dragging(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
fn start_window_dragging(_window: tauri::Window) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_library_tree,
            read_library_tree_signature,
            read_library_file,
            search_library_files,
            read_markdown_files,
            write_library_file,
            create_library_file,
            create_library_directory,
            path_exists,
            is_directory_path,
            write_binary_file,
            create_library_entry,
            library_entry_operation,
            mobile_directory_picker::pick_android_directory_tree,
            mobile_directory_picker::read_android_library_tree,
            window_control,
            start_window_dragging,
        ])
        .plugin(mobile_directory_picker::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
