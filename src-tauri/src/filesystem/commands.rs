use crate::notia_timer::NotiaTimer;
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::backend::BackendErrorCode;
use crate::backend::LibraryDocumentReadPort;
use crate::backend::ExportFormat;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker;

#[cfg(target_os = "android")]
use super::android_saf;
use super::desktop;
use super::types::{
    CreateLibraryDirectoryPayload, CreateLibraryEntryPayload, CreateLibraryFilePayload, FileNode,
    FilesystemConflict, IsDirectoryPathResult, LibraryEntryOperationPayload, MarkdownFileDocument,
    OperationResult, PathExistsPayload, PathExistsResult, ReadLibraryFilePayload,
    ReadLibraryFileResult, ReadLibraryTreePayload, ReadMarkdownFilesPayload,
    SearchLibraryFilesPayload, SearchLibraryFilesResult,
    WriteLibraryFilePayload, WriteLibraryFileResult,
};
use super::validation::{
    validate_create_library_entry_payload, validate_library_entry_operation_payload,
    ValidatedLibraryEntryOperation,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendDocumentPayload {
    pub(crate) library_id: String,
    pub(crate) logical_path: String,
    #[serde(default)]
    pub(crate) content: Option<String>,
    #[serde(default)]
    pub(crate) expected_revision: Option<String>,
    /// Create the document when it does not exist (only without a revision).
    #[serde(default)]
    pub(crate) create_if_missing: bool,
    /// On read, add the default note frontmatter when missing and persist it
    /// against the revision just read.
    #[serde(default)]
    pub(crate) ensure_markdown_defaults: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendMarkdownExportPayload {
    pub(crate) library_id: String,
    pub(crate) source_logical_path: String,
    pub(crate) format: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendMarkdownExportResult {
    pub(crate) ok: bool,
    pub(crate) destination_logical_path: Option<String>,
    pub(crate) byte_length: Option<usize>,
    pub(crate) content_fingerprint: Option<u64>,
    pub(crate) retryable: bool,
    pub(crate) error: Option<String>,
}

#[tauri::command]
pub(crate) fn backend_export_markdown_document(
    payload: BackendMarkdownExportPayload,
    registry: State<'_, LibraryBindingRegistry>,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> BackendMarkdownExportResult {
    let result = (|| -> Result<(String, usize, u64), crate::backend::BackendError> {
        let format = match payload.format.trim().to_ascii_lowercase().as_str() {
            "pdf" => ExportFormat::Pdf,
            "docx" => ExportFormat::Docx,
            _ => {
                return Err(crate::backend::BackendError::invalid_input(
                    "Formato de exportación no válido.",
                ))
            }
        };
        let receipt = crate::filesystem::adapter::export_library_document(
            registry.inner(),
            android_picker_state.inner(),
            &payload.library_id,
            &payload.source_logical_path,
            format,
        )?;
        Ok((
            receipt.destination_logical_path,
            receipt.byte_length,
            receipt.content_fingerprint,
        ))
    })();
    match result {
        Ok((destination, byte_length, content_fingerprint)) => BackendMarkdownExportResult {
            ok: true,
            destination_logical_path: Some(destination),
            byte_length: Some(byte_length),
            content_fingerprint: Some(content_fingerprint),
            retryable: false,
            error: None,
        },
        Err(error) => BackendMarkdownExportResult {
            ok: false,
            destination_logical_path: None,
            byte_length: None,
            content_fingerprint: None,
            retryable: error.retryable,
            error: Some(error.message),
        },
    }
}

#[tauri::command]
pub(crate) fn backend_read_library_document(
    payload: BackendDocumentPayload,
    registry: State<'_, LibraryBindingRegistry>,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> ReadLibraryFileResult {
    let result = (|| -> Result<ReadLibraryFileResult, crate::backend::BackendError> {
        let adapter =
            crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
                registry.inner(),
                &payload.library_id,
                android_picker_state.inner(),
            )?;
        let locator = crate::backend::DocumentLocatorDto::new(
            &payload.library_id,
            &payload.logical_path,
            None,
            None,
        )?;
        let document = adapter.read_document(&locator)?;
        let content = if payload.ensure_markdown_defaults {
            with_markdown_defaults(
                registry.inner(),
                android_picker_state.inner(),
                &locator,
                document.content,
            )
        } else {
            document.content
        };
        Ok(ReadLibraryFileResult {
            ok: true,
            revision: Some(super::types::content_revision(&content)),
            content,
            error: None,
        })
    })();

    match result {
        Ok(result) => result,
        Err(error) => ReadLibraryFileResult {
            ok: false,
            revision: None,
            content: String::new(),
            error: Some(error.message),
        },
    }
}

/// Applies the default note frontmatter and persists it only if the document
/// still has the revision just read. When the write fails (conflict, revoked
/// grant) the stored content is returned unchanged so the UI never shows
/// content that is not on disk.
fn with_markdown_defaults(
    registry: &LibraryBindingRegistry,
    picker: &mobile_directory_picker::AndroidDirectoryPickerState,
    locator: &crate::backend::DocumentLocatorDto,
    content: String,
) -> String {
    let created_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default();
    let Some(updated) = crate::backend::ensure_markdown_defaults(&content, created_at_ms) else {
        return content;
    };
    let revision = super::types::content_revision(&content);
    let written = super::adapter::TauriFilesystemDocumentAdapter::for_library(
        registry,
        &locator.library_id,
        picker,
    )
    .and_then(|adapter| adapter.write_locator(locator, &updated, Some(&revision)));
    match written {
        Ok(()) => updated,
        Err(error) => {
            log::warn!(
                "[notia:documents] no se pudieron guardar los defaults de frontmatter code={:?}",
                error.code
            );
            content
        }
    }
}

#[tauri::command]
pub(crate) fn backend_write_library_document(
    payload: BackendDocumentPayload,
    registry: State<'_, LibraryBindingRegistry>,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> WriteLibraryFileResult {
    let expected_revision = payload.expected_revision.clone();
    let result = (|| -> Result<(), crate::backend::BackendError> {
        let content = payload.content.as_deref().ok_or_else(|| {
            crate::backend::BackendError::invalid_input("La escritura necesita contenido.")
        })?;
        let adapter = super::adapter::TauriFilesystemDocumentAdapter::for_library(
            registry.inner(),
            &payload.library_id,
            android_picker_state.inner(),
        )?;
        let locator = crate::backend::DocumentLocatorDto::new(
            &payload.library_id,
            &payload.logical_path,
            None,
            None,
        )?;
        if payload.create_if_missing && expected_revision.is_none() {
            return adapter.upsert_text_locator(&locator, content);
        }
        adapter.write_locator(&locator, content, expected_revision.as_deref())
    })();

    match result {
        Ok(()) => WriteLibraryFileResult {
            revision: payload.content.as_deref().map(super::types::content_revision),
            ok: true,
            error: None,
            conflict: None,
        },
        Err(error) => WriteLibraryFileResult {
            revision: None,
            ok: false,
            error: Some(error.message),
            conflict: (error.code == BackendErrorCode::Conflict).then(|| FilesystemConflict {
                kind: "revision",
                expected_revision: expected_revision.unwrap_or_default(),
                current_revision: None,
            }),
        },
    }
}

#[tauri::command]
pub async fn read_library_tree(app: tauri::AppHandle, payload: ReadLibraryTreePayload) -> Vec<FileNode> {
    if read_outside_registered_libraries(&app, &payload.directory_path) {
        return Vec::new();
    }
    let directory_path = payload.directory_path.clone();
    tokio::task::spawn_blocking(move || {
        let _timer =
            NotiaTimer::new("cmd.read_library_tree").with_meta(format!("path={}", directory_path));
        let result = desktop::read_library_tree(payload);
        log::info!(
            "[notia:perf] cmd.read_library_tree node_count={}",
            result.len()
        );
        result
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn read_library_tree_signature(
    app: tauri::AppHandle,
    payload: ReadLibraryTreePayload,
) -> String {
    if read_outside_registered_libraries(&app, &payload.directory_path) {
        return String::new();
    }
    let directory_path = payload.directory_path.clone();
    tokio::task::spawn_blocking(move || {
        let _timer = NotiaTimer::new("cmd.read_library_tree_signature")
            .with_meta(format!("path={}", directory_path));
        desktop::read_library_tree_signature(payload)
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn read_library_file(
    payload: ReadLibraryFilePayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> ReadLibraryFileResult {
    let _timer =
        NotiaTimer::new("cmd.read_library_file").with_meta(format!("path={}", payload.file_path));
    if payload.file_path.trim().is_empty() {
        return ReadLibraryFileResult {
            ok: false,
            revision: None,
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

    #[cfg(target_os = "android")]
    let _ = registry;
    #[cfg(not(target_os = "android"))]
    let _ = android_picker_state;
    #[cfg(not(target_os = "android"))]
    if let Some(error) = outside_registered_libraries(&registry, &[Some(payload.file_path.as_str())]) {
        return ReadLibraryFileResult {
            ok: false,
            revision: None,
            content: String::new(),
            error: Some(error),
        };
    }

    desktop::read_library_file(&payload.file_path)
}

#[tauri::command]
pub async fn search_library_files(
    app: tauri::AppHandle,
    payload: SearchLibraryFilesPayload,
) -> SearchLibraryFilesResult {
    if read_outside_registered_libraries(&app, &payload.directory_path) {
        return SearchLibraryFilesResult { paths: Vec::new() };
    }
    let directory_path = payload.directory_path.clone();
    let query = payload.query.clone();
    tokio::task::spawn_blocking(move || {
        let _timer = NotiaTimer::new("cmd.search_library_files")
            .with_meta(format!("path={} query={}", directory_path, query));
        let result = desktop::search_library_files(payload);
        log::info!(
            "[notia:perf] cmd.search_library_files result_count={}",
            result.paths.len()
        );
        result
    })
    .await
    .unwrap_or(SearchLibraryFilesResult { paths: Vec::new() })
}

#[tauri::command]
pub async fn read_markdown_files(
    app: tauri::AppHandle,
    payload: ReadMarkdownFilesPayload,
) -> Vec<MarkdownFileDocument> {
    if read_outside_registered_libraries(&app, &payload.directory_path) {
        return Vec::new();
    }
    let directory_path = payload.directory_path.clone();
    tokio::task::spawn_blocking(move || {
        let _timer = NotiaTimer::new("cmd.read_markdown_files")
            .with_meta(format!("path={}", directory_path));
        let result = desktop::read_markdown_files(payload);
        log::info!(
            "[notia:perf] cmd.read_markdown_files doc_count={}",
            result.len()
        );
        result
    })
    .await
    .unwrap_or_default()
}

/// Desktop filesystem commands receive absolute paths from the WebView. A
/// mutation is only allowed inside a registered library root; otherwise a
/// compromised page could write anywhere the user can.
#[cfg(not(target_os = "android"))]
fn outside_registered_libraries(registry: &LibraryBindingRegistry, paths: &[Option<&str>]) -> Option<String> {
    let outside = paths
        .iter()
        .flatten()
        .any(|path| !registry.contains_desktop_path(std::path::Path::new(path)));
    outside.then(|| "La ruta está fuera de las bibliotecas registradas.".to_string())
}

/// Desktop content reads (tree, search, Markdown bulk, signature) are limited
/// to registered library roots too. Existence checks (`path_exists`,
/// `is_directory_path`) stay open: they only reveal presence and are used to
/// validate library roots before they are registered.
fn read_outside_registered_libraries(app: &tauri::AppHandle, path: &str) -> bool {
    #[cfg(not(target_os = "android"))]
    {
        use tauri::Manager;
        let outside = outside_registered_libraries(
            app.state::<LibraryBindingRegistry>().inner(),
            &[Some(path)],
        )
        .is_some();
        if outside {
            log::warn!("[notia:filesystem] lectura rechazada fuera de las bibliotecas registradas");
        }
        outside
    }
    #[cfg(target_os = "android")]
    {
        let _ = (app, path);
        false
    }
}

#[tauri::command]
pub fn write_library_file(
    payload: WriteLibraryFilePayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> WriteLibraryFileResult {
    #[cfg(not(target_os = "android"))]
    if let Some(error) = outside_registered_libraries(&registry, &[Some(payload.file_path.as_str())]) {
        return WriteLibraryFileResult {
            revision: None,
            ok: false,
            error: Some(error),
            conflict: None,
        };
    }
    #[cfg(target_os = "android")]
    let _ = registry;
    let _timer =
        NotiaTimer::new("cmd.write_library_file").with_meta(format!("path={}", payload.file_path));
    if payload.file_path.trim().is_empty() {
        return WriteLibraryFileResult {
            revision: None,
            ok: false,
            error: Some("Invalid file data.".to_string()),
            conflict: None,
        };
    }

    let picker = android_picker_state.inner();
    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::write_library_file(
        picker,
        &payload.file_path,
        &payload.content,
        payload.expected_revision.as_deref(),
        payload.directory_uri.as_deref(),
    ) {
        return verified_write(result, &payload.file_path, &payload.content, payload.directory_uri.as_deref(), picker);
    }

    let result = desktop::write_library_file(
        &payload.file_path,
        &payload.content,
        payload.expected_revision.as_deref(),
    );
    verified_write(result, &payload.file_path, &payload.content, payload.directory_uri.as_deref(), picker)
}

/// Stored content of a file written by path, on SAF or desktop.
fn read_back(
    path: &str,
    directory_uri: Option<&str>,
    picker: &mobile_directory_picker::AndroidDirectoryPickerState,
) -> Option<String> {
    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::read_library_file(picker, path, directory_uri) {
        return result.ok.then_some(result.content);
    }
    #[cfg(not(target_os = "android"))]
    let _ = (picker, directory_uri);
    let result = desktop::read_library_file(path);
    result.ok.then_some(result.content)
}

/// A path write only succeeds when the stored content is the one sent, so a
/// provider that ignores truncation cannot report success.
fn verified_write(
    result: WriteLibraryFileResult,
    path: &str,
    content: &str,
    directory_uri: Option<&str>,
    picker: &mobile_directory_picker::AndroidDirectoryPickerState,
) -> WriteLibraryFileResult {
    if !result.ok {
        return result;
    }
    if read_back(path, directory_uri, picker).as_deref() == Some(content) {
        return WriteLibraryFileResult { revision: Some(super::types::content_revision(content)), ..result };
    }
    WriteLibraryFileResult {
        revision: None,
        ok: false,
        error: Some("The written file could not be verified.".to_string()),
        conflict: None,
    }
}

#[tauri::command]
pub fn create_library_file(
    payload: CreateLibraryFilePayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> OperationResult {
    #[cfg(not(target_os = "android"))]
    if let Some(error) = outside_registered_libraries(&registry, &[Some(payload.file_path.as_str())]) {
        return OperationResult {
            ok: false,
            error: Some(error),
        };
    }
    #[cfg(target_os = "android")]
    let _ = registry;
    let _timer =
        NotiaTimer::new("cmd.create_library_file").with_meta(format!("path={}", payload.file_path));
    log::info!(
        "[notia:saf] create_library_file input directory_uri_present={} directory_uri_len={}",
        payload
            .directory_uri
            .as_deref()
            .is_some_and(|uri| !uri.trim().is_empty()),
        payload.directory_uri.as_deref().map_or(0, str::len)
    );
    if payload.file_path.trim().is_empty() {
        return OperationResult {
            ok: false,
            error: Some("Invalid file data.".to_string()),
        };
    }

    let picker = android_picker_state.inner();
    #[cfg(target_os = "android")]
    let result = android_saf::create_library_file(
        picker,
        &payload.file_path,
        &payload.content,
        payload.directory_uri.as_deref(),
    );
    #[cfg(not(target_os = "android"))]
    let result: Option<OperationResult> = None;
    let result = result.unwrap_or_else(|| desktop::create_library_file(&payload.file_path, &payload.content));
    if result.ok && read_back(&payload.file_path, payload.directory_uri.as_deref(), picker).as_deref() != Some(payload.content.as_str()) {
        return OperationResult {
            ok: false,
            error: Some("The created file could not be verified.".to_string()),
        };
    }
    result
}

#[tauri::command]
pub fn create_library_directory(
    payload: CreateLibraryDirectoryPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> OperationResult {
    #[cfg(not(target_os = "android"))]
    if let Some(error) = outside_registered_libraries(&registry, &[Some(payload.directory_path.as_str())]) {
        return OperationResult {
            ok: false,
            error: Some(error),
        };
    }
    #[cfg(target_os = "android")]
    let _ = registry;
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
pub fn create_library_entry(
    payload: CreateLibraryEntryPayload,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> OperationResult {
    #[cfg(not(target_os = "android"))]
    if let Some(error) = outside_registered_libraries(&registry, &[Some(payload.directory_path.as_str())]) {
        return OperationResult {
            ok: false,
            error: Some(error),
        };
    }
    #[cfg(target_os = "android")]
    let _ = registry;
    run_create_library_entry(&payload, android_picker_state.inner())
}

fn run_create_library_entry(
    payload: &CreateLibraryEntryPayload,
    android_picker_state: &mobile_directory_picker::AndroidDirectoryPickerState,
) -> OperationResult {
    let _timer = NotiaTimer::new("cmd.create_library_entry").with_meta(format!(
        "path={} kind={}",
        payload.directory_path, payload.kind
    ));
    let normalized_name = match validate_create_library_entry_payload(payload) {
        Ok(normalized_name) => normalized_name,
        Err(result) => return result,
    };

    #[cfg(target_os = "android")]
    if let Some(result) = android_saf::create_library_entry(
        android_picker_state,
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
    registry: State<'_, LibraryBindingRegistry>,
) -> OperationResult {
    #[cfg(not(target_os = "android"))]
    if let Some(error) = outside_registered_libraries(&registry, &[payload.target_path.as_deref(), payload.source_path.as_deref(), payload.target_directory_path.as_deref()]) {
        return OperationResult {
            ok: false,
            error: Some(error),
        };
    }
    #[cfg(target_os = "android")]
    let _ = registry;
    run_library_entry_operation(&payload, android_picker_state.inner())
}

fn run_library_entry_operation(
    payload: &LibraryEntryOperationPayload,
    android_picker_state: &mobile_directory_picker::AndroidDirectoryPickerState,
) -> OperationResult {
    let _timer = NotiaTimer::new("cmd.library_entry_operation")
        .with_meta(format!("action={}", payload.action));
    let validated_operation = match validate_library_entry_operation_payload(payload) {
        Ok(operation) => operation,
        Err(result) => return result,
    };

    match validated_operation {
        ValidatedLibraryEntryOperation::Delete { target_path } => {
            #[cfg(target_os = "android")]
            if let Some(result) = android_saf::delete_entry(
                android_picker_state,
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
                android_picker_state,
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
                android_picker_state,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendLibraryEntryPayload {
    pub(crate) library_id: String,
    /// `create`, `delete`, `rename` or `paste`.
    pub(crate) action: String,
    /// Entry to delete or rename; parent directory for `create`. Empty means
    /// the library root, which is only valid as a parent.
    #[serde(default)]
    pub(crate) logical_path: String,
    /// New entry name for `create` and `rename`.
    #[serde(default)]
    pub(crate) name: Option<String>,
    /// `file` or `directory` for `create`.
    #[serde(default)]
    pub(crate) kind: Option<String>,
    /// Entry copied or moved by `paste`; `logical_path` is the destination.
    #[serde(default)]
    pub(crate) source_logical_path: Option<String>,
    /// `copy` or `cut` for `paste`.
    #[serde(default)]
    pub(crate) mode: Option<String>,
}

/// Initial content of a note created from the explorer: the default context.
const NEW_NOTE_CONTENT: &str = "---\ncontexto: \"#Personal\"\n---\n";

/// Physical form of a library entry for the platform adapters: an absolute
/// path under the canonical desktop root, or `tree/logical` resolved by SAF
/// through the library grant. The client never supplies either form.
fn resolve_library_entry_path(
    binding: &crate::library_registry::LibraryBinding,
    logical_path: &str,
    allow_root: bool,
) -> Result<String, crate::backend::BackendError> {
    use crate::library_registry::LibraryBindingRoot;
    let is_root = logical_path.trim().is_empty();
    if is_root && !allow_root {
        return Err(crate::backend::BackendError::invalid_input(
            "La operación necesita una entrada de la biblioteca.",
        ));
    }
    let logical = if is_root {
        None
    } else {
        Some(crate::backend::LogicalPathDto::new(logical_path)?)
    };
    match (&binding.root, logical) {
        (Some(LibraryBindingRoot::Desktop { canonical_root }), None) => {
            Ok(canonical_root.to_string_lossy().into_owned())
        }
        (Some(LibraryBindingRoot::Desktop { canonical_root }), Some(logical)) => {
            super::adapter::resolve_desktop_document(canonical_root, &logical)
                .map(|path| path.to_string_lossy().into_owned())
        }
        (Some(LibraryBindingRoot::Android { tree_uri }), None) => Ok(tree_uri.as_str().to_string()),
        (Some(LibraryBindingRoot::Android { tree_uri }), Some(logical)) => {
            Ok(format!("{}/{}", tree_uri.as_str(), logical.as_str()))
        }
        (None, _) => Err(crate::backend::BackendError::new(
            BackendErrorCode::Forbidden,
            "La biblioteca no está disponible; volvé a seleccionarla.",
            true,
        )),
    }
}

fn android_directory_uri(binding: &crate::library_registry::LibraryBinding) -> Option<String> {
    match &binding.root {
        Some(crate::library_registry::LibraryBindingRoot::Android { tree_uri }) => {
            Some(tree_uri.as_str().to_string())
        }
        _ => None,
    }
}

/// Creates the folder `name` under the logical `parent` of a bound library;
/// an existing folder is not an error.
pub(crate) fn ensure_library_folder(
    registry: &LibraryBindingRegistry,
    picker: &mobile_directory_picker::AndroidDirectoryPickerState,
    library_id: &str,
    parent: &str,
    name: &str,
) -> Result<(), crate::backend::BackendError> {
    let binding = registry.lookup(library_id)?;
    let result = run_create_library_entry(
        &CreateLibraryEntryPayload {
            directory_path: resolve_library_entry_path(&binding, parent, true)?,
            name: name.to_string(),
            kind: "folder".to_string(),
            directory_uri: android_directory_uri(&binding),
        },
        picker,
    );
    if result.ok || result.error.as_deref().is_some_and(|error| error.contains("already exists")) {
        Ok(())
    } else {
        Err(super::adapter::map_filesystem_error(
            result.error.as_deref().unwrap_or("Could not create entry."),
        ))
    }
}

/// Creates, deletes, renames, copies or moves a library entry addressed by
/// `libraryId` + logical paths. The registered binding decides the physical
/// location, so the WebView cannot address anything outside the library.
#[tauri::command]
pub(crate) fn backend_library_entry_operation(
    payload: BackendLibraryEntryPayload,
    registry: State<'_, LibraryBindingRegistry>,
    android_picker_state: State<'_, mobile_directory_picker::AndroidDirectoryPickerState>,
) -> OperationResult {
    let result = (|| -> Result<OperationResult, crate::backend::BackendError> {
        let binding = registry.lookup(&payload.library_id)?;
        let directory_uri = android_directory_uri(&binding);
        let picker = android_picker_state.inner();
        match payload.action.as_str() {
            "create" => {
                let create_payload = CreateLibraryEntryPayload {
                    directory_path: resolve_library_entry_path(&binding, &payload.logical_path, true)?,
                    name: payload.name.clone().unwrap_or_default(),
                    kind: payload.kind.clone().unwrap_or_default(),
                    directory_uri,
                };
                if create_payload.kind != "note" {
                    return Ok(run_create_library_entry(&create_payload, picker));
                }
                // Notes are created with their initial frontmatter in one
                // verified write, never as an empty file patched later.
                let file_name = match validate_create_library_entry_payload(&create_payload) {
                    Ok(file_name) => file_name,
                    Err(result) => return Ok(result),
                };
                let parent = payload.logical_path.trim().trim_matches('/');
                let logical_path = if parent.is_empty() {
                    file_name
                } else {
                    format!("{parent}/{file_name}")
                };
                let locator = crate::backend::DocumentLocatorDto::new(
                    &payload.library_id,
                    &logical_path,
                    None,
                    None,
                )?;
                super::adapter::TauriFilesystemDocumentAdapter::for_library(
                    registry.inner(),
                    &payload.library_id,
                    picker,
                )?
                .create_text_locator(&locator, NEW_NOTE_CONTENT)?;
                Ok(OperationResult {
                    ok: true,
                    error: None,
                })
            }
            "delete" | "rename" => Ok(run_library_entry_operation(
                &LibraryEntryOperationPayload {
                    action: payload.action.clone(),
                    target_path: Some(resolve_library_entry_path(&binding, &payload.logical_path, false)?),
                    new_name: payload.name.clone(),
                    source_path: None,
                    target_directory_path: None,
                    mode: None,
                    directory_uri,
                },
                picker,
            )),
            "paste" => {
                let source = payload.source_logical_path.as_deref().unwrap_or_default();
                Ok(run_library_entry_operation(
                    &LibraryEntryOperationPayload {
                        action: payload.action.clone(),
                        target_path: None,
                        new_name: None,
                        source_path: Some(resolve_library_entry_path(&binding, source, false)?),
                        target_directory_path: Some(resolve_library_entry_path(
                            &binding,
                            &payload.logical_path,
                            true,
                        )?),
                        mode: payload.mode.clone(),
                        directory_uri,
                    },
                    picker,
                ))
            }
            _ => Err(crate::backend::BackendError::invalid_input(
                "La operación de biblioteca no es válida.",
            )),
        }
    })();
    result.unwrap_or_else(|error| OperationResult {
        ok: false,
        error: Some(error.message),
    })
}

/// Executes the filesystem subset used by the browser-hosted Task Manager.
/// Its caller must authorize every path before reaching this adapter.
pub(crate) fn execute_desktop_filesystem_command(
    command: &str,
    payload: Value,
) -> Result<Value, String> {
    let result = match command {
        "read_library_tree" => serde_json::to_value(desktop::read_library_tree(
            serde_json::from_value::<ReadLibraryTreePayload>(payload)
                .map_err(|_| "Solicitud inválida.")?,
        )),
        "read_markdown_files" => serde_json::to_value(desktop::read_markdown_files(
            serde_json::from_value::<ReadMarkdownFilesPayload>(payload)
                .map_err(|_| "Solicitud inválida.")?,
        )),
        "read_library_file" => {
            let payload = serde_json::from_value::<ReadLibraryFilePayload>(payload)
                .map_err(|_| "Solicitud inválida.")?;
            serde_json::to_value(desktop::read_library_file(&payload.file_path))
        }
        "write_library_file" => {
            let payload = serde_json::from_value::<WriteLibraryFilePayload>(payload)
                .map_err(|_| "Solicitud inválida.")?;
            serde_json::to_value(desktop::write_library_file(
                &payload.file_path,
                &payload.content,
                payload.expected_revision.as_deref(),
            ))
        }
        "path_exists" => {
            let payload = serde_json::from_value::<PathExistsPayload>(payload)
                .map_err(|_| "Solicitud inválida.")?;
            serde_json::to_value(desktop::path_exists(&payload.path))
        }
        "is_directory_path" => {
            let payload = serde_json::from_value::<PathExistsPayload>(payload)
                .map_err(|_| "Solicitud inválida.")?;
            serde_json::to_value(desktop::is_directory_path(&payload.path))
        }
        "create_library_entry" => {
            let payload = serde_json::from_value::<CreateLibraryEntryPayload>(payload)
                .map_err(|_| "Solicitud inválida.")?;
            let name = validate_create_library_entry_payload(&payload).map_err(|result| {
                result
                    .error
                    .unwrap_or_else(|| "Solicitud inválida.".to_string())
            })?;
            serde_json::to_value(desktop::create_library_entry(
                &payload.directory_path,
                &name,
                &payload.kind,
            ))
        }
        "library_entry_operation" => {
            let payload = serde_json::from_value::<LibraryEntryOperationPayload>(payload)
                .map_err(|_| "Solicitud inválida.")?;
            let result =
                match validate_library_entry_operation_payload(&payload).map_err(|result| {
                    result
                        .error
                        .unwrap_or_else(|| "Solicitud inválida.".to_string())
                })? {
                    ValidatedLibraryEntryOperation::Delete { target_path } => {
                        desktop::delete_entry(target_path)
                    }
                    ValidatedLibraryEntryOperation::Rename {
                        target_path,
                        new_name,
                    } => desktop::rename_entry(target_path, new_name),
                    ValidatedLibraryEntryOperation::Paste {
                        source_path,
                        target_directory_path,
                        mode,
                    } => desktop::paste_entry(source_path, target_directory_path, mode),
                };
            serde_json::to_value(result)
        }
        _ => return Err("Operación no disponible en la publicación.".to_string()),
    };
    result.map_err(|_| "No se pudo serializar la respuesta.".to_string())
}

#[cfg(all(test, not(target_os = "android")))]
mod tests {
    use super::resolve_library_entry_path;
    use crate::library_registry::{LibraryBinding, LibraryBindingRoot};

    fn desktop_binding(root: &std::path::Path) -> LibraryBinding {
        LibraryBinding {
            library_id: "lib".to_string(),
            generation: 1,
            root: Some(LibraryBindingRoot::Desktop {
                canonical_root: std::fs::canonicalize(root).expect("root"),
            }),
            revoked: false,
        }
    }

    #[test]
    fn entry_paths_resolve_inside_the_bound_root_only() {
        let root = std::env::temp_dir().join(format!("notia-entry-{}", std::process::id()));
        std::fs::create_dir_all(root.join("notas")).expect("fixture");
        let binding = desktop_binding(&root);

        let canonical_root = std::fs::canonicalize(&root).expect("root");
        assert_eq!(
            resolve_library_entry_path(&binding, "", true).expect("root parent"),
            canonical_root.to_string_lossy()
        );
        assert!(resolve_library_entry_path(&binding, "", false).is_err());
        assert!(resolve_library_entry_path(&binding, "notas/nueva.md", false)
            .expect("child")
            .starts_with(canonical_root.to_string_lossy().as_ref()));
        assert!(resolve_library_entry_path(&binding, "../fuera.md", false).is_err());
        assert!(resolve_library_entry_path(&binding, "C:/fuera.md", false).is_err());

        let revoked = LibraryBinding {
            root: None,
            revoked: true,
            ..binding
        };
        assert!(resolve_library_entry_path(&revoked, "notas", false).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
