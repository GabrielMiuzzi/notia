use crate::notia_timer::NotiaTimer;
use serde::Deserialize;
use crate::host::State;

use crate::backend::BackendErrorCode;
use crate::backend::LibraryDocumentReadPort;
use crate::backend::ExportFormat;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker;

#[cfg(target_os = "android")]
use super::android_saf;
use super::desktop;
use super::types::{
    CreateLibraryEntryPayload, FilesystemConflict, LibraryEntryOperationPayload, OperationResult,
    ReadLibraryFileResult, WriteLibraryFileResult,
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

pub(crate) fn backend_export_markdown_document(
    app: crate::host::AppHandle,
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
        crate::device_preferences::ensure_export_allowed(&app, format)?;
        let source_logical_path = crate::library_session::resolve_logical_path(
            &app,
            &payload.library_id,
            &payload.source_logical_path,
        )?;
        let receipt = crate::filesystem::adapter::export_library_document(
            registry.inner(),
            android_picker_state.inner(),
            &payload.library_id,
            &source_logical_path,
            format,
            &crate::device_preferences::page_geometry(&app),
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
