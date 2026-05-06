use crate::notia_timer::NotiaTimer;
use tauri::State;

use crate::mobile_directory_picker;

use super::android_saf;
use super::desktop;
use super::types::{
    CreateLibraryDirectoryPayload, CreateLibraryEntryPayload, CreateLibraryFilePayload, FileNode,
    IsDirectoryPathResult, LibraryEntryOperationPayload, MarkdownFileDocument, OperationResult,
    PathExistsPayload, PathExistsResult, ReadLibraryFilePayload, ReadLibraryFileResult,
    ReadLibraryTreePayload, ReadMarkdownFilesPayload, SearchLibraryFilesPayload,
    SearchLibraryFilesResult, WriteBinaryFilePayload, WriteLibraryFilePayload,
    WriteLibraryFileResult,
};
use super::validation::{
    validate_create_library_entry_payload, validate_library_entry_operation_payload,
    ValidatedLibraryEntryOperation,
};

#[tauri::command]
pub fn read_library_tree(payload: ReadLibraryTreePayload) -> Vec<FileNode> {
    let _timer = NotiaTimer::new("cmd.read_library_tree")
        .with_meta(format!("path={}", payload.directory_path));
    let result = desktop::read_library_tree(payload);
    log::info!(
        "[notia:perf] cmd.read_library_tree node_count={}",
        result.len()
    );
    result
}

#[tauri::command]
pub fn read_library_tree_signature(payload: ReadLibraryTreePayload) -> String {
    let _timer = NotiaTimer::new("cmd.read_library_tree_signature")
        .with_meta(format!("path={}", payload.directory_path));
    desktop::read_library_tree_signature(payload)
}

#[tauri::command]
pub fn read_library_file(
    payload: ReadLibraryFilePayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> ReadLibraryFileResult {
    let _timer =
        NotiaTimer::new("cmd.read_library_file").with_meta(format!("path={}", payload.file_path));
    if payload.file_path.trim().is_empty() {
        return ReadLibraryFileResult {
            ok: false,
            content: String::new(),
            error: Some("Invalid file path.".to_string()),
        };
    }

    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::read_library_file(
        android_picker_state.inner(),
        &payload.file_path,
        payload.directory_uri.as_deref(),
    ) {
        return result;
    }

    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    desktop::read_library_file(&payload.file_path)
}

#[tauri::command]
pub fn search_library_files(payload: SearchLibraryFilesPayload) -> SearchLibraryFilesResult {
    let _timer = NotiaTimer::new("cmd.search_library_files")
        .with_meta(format!("path={}", payload.directory_path));
    let result = desktop::search_library_files(payload);
    log::info!(
        "[notia:perf] cmd.search_library_files result_count={}",
        result.paths.len()
    );
    result
}

#[tauri::command]
pub fn read_markdown_files(payload: ReadMarkdownFilesPayload) -> Vec<MarkdownFileDocument> {
    let _timer = NotiaTimer::new("cmd.read_markdown_files")
        .with_meta(format!("path={}", payload.directory_path));
    let result = desktop::read_markdown_files(payload);
    log::info!(
        "[notia:perf] cmd.read_markdown_files doc_count={}",
        result.len()
    );
    result
}

#[tauri::command]
pub fn write_library_file(
    payload: WriteLibraryFilePayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> WriteLibraryFileResult {
    let _timer =
        NotiaTimer::new("cmd.write_library_file").with_meta(format!("path={}", payload.file_path));
    if payload.file_path.trim().is_empty() {
        return WriteLibraryFileResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::write_library_file(
        android_picker_state.inner(),
        &payload.file_path,
        &payload.content,
        payload.directory_uri.as_deref(),
    ) {
        return result;
    }

    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    desktop::write_library_file(&payload.file_path, &payload.content)
}

#[tauri::command]
pub fn create_library_file(
    payload: CreateLibraryFilePayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> OperationResult {
    let _timer =
        NotiaTimer::new("cmd.create_library_file").with_meta(format!("path={}", payload.file_path));
    if payload.file_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::create_library_file(
        android_picker_state.inner(),
        &payload.file_path,
        &payload.content,
        payload.directory_uri.as_deref(),
    ) {
        return result;
    }

    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    desktop::create_library_file(&payload.file_path, &payload.content)
}

#[tauri::command]
pub fn create_library_directory(
    payload: CreateLibraryDirectoryPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> OperationResult {
    let _timer = NotiaTimer::new("cmd.create_library_directory")
        .with_meta(format!("path={}", payload.directory_path));
    if payload.directory_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid directory data.".to_string()),
        };
    }

    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::create_library_directory(
        android_picker_state.inner(),
        &payload.directory_path,
        payload.directory_uri.as_deref(),
    ) {
        return result;
    }

    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    desktop::create_library_directory(&payload.directory_path)
}

#[tauri::command]
pub fn path_exists(
    payload: PathExistsPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> PathExistsResult {
    let _timer = NotiaTimer::new("cmd.path_exists").with_meta(format!("path={}", payload.path));
    if payload.path.trim().is_empty() {
        return PathExistsResult { exists: false };
    }

    #[cfg(target_os = "android")]
    {
        return android_saf::path_exists(
            android_picker_state.inner(),
            &payload.path,
            payload.directory_uri.as_deref(),
        );
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = android_picker_state;
        desktop::path_exists(&payload.path)
    }
}

#[tauri::command]
pub fn is_directory_path(
    payload: PathExistsPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> IsDirectoryPathResult {
    let _timer =
        NotiaTimer::new("cmd.is_directory_path").with_meta(format!("path={}", payload.path));
    if payload.path.trim().is_empty() {
        return IsDirectoryPathResult {
            is_directory: false,
        };
    }

    #[cfg(target_os = "android")]
    {
        return android_saf::is_directory_path(
            android_picker_state.inner(),
            &payload.path,
            payload.directory_uri.as_deref(),
        );
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = android_picker_state;
        desktop::is_directory_path(&payload.path)
    }
}

#[tauri::command]
pub fn write_binary_file(payload: WriteBinaryFilePayload) -> OperationResult {
    if payload.file_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    desktop::write_binary_file(payload)
}

#[tauri::command]
pub fn create_library_entry(
    payload: CreateLibraryEntryPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> OperationResult {
    let _timer = NotiaTimer::new("cmd.create_library_entry").with_meta(format!(
        "path={} kind={}",
        payload.directory_path, payload.kind
    ));
    let normalized_name = match validate_create_library_entry_payload(&payload) {
        Ok(normalized_name) => normalized_name,
        Err(result) => return result,
    };

    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::create_library_entry(
        android_picker_state.inner(),
        &payload.directory_path,
        &normalized_name,
        &payload.kind,
        payload.directory_uri.as_deref(),
    ) {
        return result;
    }

    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;

    desktop::create_library_entry(&payload.directory_path, &normalized_name, &payload.kind)
}

#[tauri::command]
pub fn library_entry_operation(
    payload: LibraryEntryOperationPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> OperationResult {
    let _timer = NotiaTimer::new("cmd.library_entry_operation")
        .with_meta(format!("action={}", payload.action));
    let validated_operation = match validate_library_entry_operation_payload(&payload) {
        Ok(operation) => operation,
        Err(result) => return result,
    };

    match validated_operation {
        ValidatedLibraryEntryOperation::Delete { target_path } => {
            #[cfg(target_os = "android")]
            if let Some(result) = android_saf::delete_entry(
                android_picker_state.inner(),
                target_path,
                payload.directory_uri.as_deref(),
            ) {
                return result;
            }

            #[cfg(not(target_os = "android"))]
            let _ = android_picker_state;

            desktop::delete_entry(target_path)
        }
        ValidatedLibraryEntryOperation::Rename {
            target_path,
            new_name,
        } => {
            #[cfg(target_os = "android")]
            if let Some(result) = android_saf::rename_entry(
                android_picker_state.inner(),
                target_path,
                new_name,
                payload.directory_uri.as_deref(),
            ) {
                return result;
            }

            #[cfg(not(target_os = "android"))]
            let _ = android_picker_state;

            desktop::rename_entry(target_path, new_name)
        }
        ValidatedLibraryEntryOperation::Paste {
            source_path,
            target_directory_path,
            mode,
        } => {
            #[cfg(target_os = "android")]
            if let Some(result) = android_saf::paste_entry(
                android_picker_state.inner(),
                source_path,
                target_directory_path,
                mode,
                payload.directory_uri.as_deref(),
            ) {
                return result;
            }

            #[cfg(not(target_os = "android"))]
            let _ = android_picker_state;

            desktop::paste_entry(source_path, target_directory_path, mode)
        }
    }
}
