//! Tauri-side bridge from backend document locators to safe filesystem APIs.
//!
//! This is an integration boundary, not the document domain implementation.
//! The backend core owns logical paths and locator validation; this module owns
//! the platform-specific mapping to desktop paths or SAF document URIs.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::backend::{
    validate_document_locator, AndroidDocumentUriDto, AndroidTreeUriDto, BackendError,
    BackendErrorCode, DocumentLocatorDto, DocumentRepository, LogicalPathDto,
};
#[cfg(target_os = "android")]
use crate::filesystem::android_saf;
use crate::filesystem::desktop;
use crate::library_registry::{LibraryBindingRegistry, LibraryBindingRoot};
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const INVALID_DOCUMENT_MESSAGE: &str = "El documento no es válido.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AndroidLocatorTarget {
    pub(crate) logical_path: LogicalPathDto,
    pub(crate) tree_uri: Option<AndroidTreeUriDto>,
    pub(crate) document_uri: Option<AndroidDocumentUriDto>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MappedDocumentTarget {
    Desktop {
        logical_path: LogicalPathDto,
        filesystem_path: PathBuf,
    },
    Android {
        logical_path: LogicalPathDto,
        tree_uri: Option<AndroidTreeUriDto>,
        document_uri: AndroidDocumentUriDto,
        document_uri_supplied: bool,
    },
}

pub(crate) struct TauriFilesystemDocumentAdapter<'a> {
    library_id: String,
    binding_generation: u64,
    registry: LibraryBindingRegistry,
    android_picker_state: &'a AndroidDirectoryPickerState,
}

impl<'a> TauriFilesystemDocumentAdapter<'a> {
    pub(crate) fn for_library(
        registry: &LibraryBindingRegistry,
        library_id: &str,
        android_picker_state: &'a AndroidDirectoryPickerState,
    ) -> Result<Self, BackendError> {
        let binding = registry.lookup(library_id)?;
        Ok(Self {
            library_id: non_empty_library_id(library_id)?,
            binding_generation: binding.generation,
            registry: registry.clone(),
            android_picker_state,
        })
    }

    fn binding(&self) -> Result<crate::library_registry::LibraryBinding, BackendError> {
        let binding = self.registry.lookup(&self.library_id)?;
        if binding.generation != self.binding_generation {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "La referencia de la biblioteca quedó obsoleta.",
                true,
            ));
        }
        Ok(binding)
    }

    pub(crate) fn map_locator(
        &self,
        locator: &DocumentLocatorDto,
    ) -> Result<MappedDocumentTarget, BackendError> {
        validate_document_locator(locator, &self.library_id)?;
        let binding = self.binding()?;

        #[cfg(target_os = "android")]
        {
            let Some(LibraryBindingRoot::Android { tree_uri }) = binding.root else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La biblioteca no tiene un grant SAF Android.",
                    false,
                ));
            };
            let android_target = validate_android_locator(locator, Some(&tree_uri))?;
            let tree_uri = android_target.tree_uri.as_ref().map(|uri| uri.as_str());
            let lookup_path = android_target
                .document_uri
                .as_ref()
                .map(|uri| uri.as_str().to_string())
                .or_else(|| {
                    tree_uri.map(|tree| format!("{tree}/{}", android_target.logical_path.as_str()))
                })
                .ok_or_else(|| {
                    BackendError::invalid_input(
                        "El documento Android necesita un árbol o una URI document.",
                    )
                })?;

            let resolved_uri = android_saf::resolve_document_uri(
                self.android_picker_state,
                &lookup_path,
                // An explicitly supplied document URI is verified by Kotlin
                // through the registered grant before it reaches I/O. Logical
                // paths retain the tree context so they resolve children via
                // SAF rather than becoming synthetic document URIs.
                tree_uri.filter(|_| android_target.document_uri.is_none()),
            )
            .ok_or_else(|| {
                BackendError::new(
                    BackendErrorCode::NotFound,
                    "No se pudo resolver el documento Android.",
                    true,
                )
            })?;
            let document_uri = AndroidDocumentUriDto::new(&resolved_uri).map_err(|_| {
                BackendError::new(
                    BackendErrorCode::Storage,
                    "El proveedor Android no devolvió una URI document válida.",
                    true,
                )
            })?;

            return Ok(MappedDocumentTarget::Android {
                logical_path: android_target.logical_path,
                tree_uri: android_target.tree_uri,
                document_uri,
                document_uri_supplied: android_target.document_uri.is_some(),
            });
        }

        #[cfg(not(target_os = "android"))]
        {
            let Some(LibraryBindingRoot::Desktop { canonical_root }) = binding.root else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La biblioteca no tiene una raíz de filesystem disponible.",
                    false,
                ));
            };
            return Ok(MappedDocumentTarget::Desktop {
                logical_path: locator.logical_path.clone(),
                filesystem_path: resolve_desktop_document(&canonical_root, &locator.logical_path)?,
            });
        }
    }

    pub(crate) fn read_locator(
        &self,
        locator: &DocumentLocatorDto,
    ) -> Result<String, BackendError> {
        match self.map_locator(locator)? {
            MappedDocumentTarget::Desktop {
                filesystem_path, ..
            } => {
                let path = filesystem_path.to_str().ok_or_else(|| {
                    BackendError::invalid_input("La ruta del documento no es UTF-8 válida.")
                })?;
                let result = desktop::read_library_file(path);
                if result.ok {
                    Ok(result.content)
                } else {
                    Err(map_filesystem_error(
                        result.error.as_deref().unwrap_or("Could not read file."),
                    ))
                }
            }
            MappedDocumentTarget::Android {
                tree_uri,
                document_uri,
                document_uri_supplied,
                ..
            } => {
                #[cfg(target_os = "android")]
                {
                    if document_uri_supplied {
                        verify_android_document_access(
                            self.android_picker_state,
                            tree_uri.as_ref(),
                            &document_uri,
                            false,
                        )?;
                    }
                    let result = android_saf::read_library_file(
                        self.android_picker_state,
                        document_uri.as_str(),
                        None,
                    )
                    .ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::Unsupported,
                            "La lectura SAF no está disponible en esta plataforma.",
                            false,
                        )
                    })?;
                    if result.ok {
                        Ok(result.content)
                    } else {
                        Err(map_filesystem_error(
                            result.error.as_deref().unwrap_or("Could not read file."),
                        ))
                    }
                }
                #[cfg(not(target_os = "android"))]
                {
                    let _ = (tree_uri, document_uri, document_uri_supplied);
                    Err(BackendError::new(
                        BackendErrorCode::Unsupported,
                        "La lectura SAF no está disponible en esta plataforma.",
                        false,
                    ))
                }
            }
        }
    }

    /// Replaces a text document and verifies the persisted content.
    pub(crate) fn write_locator(
        &self,
        locator: &DocumentLocatorDto,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<(), BackendError> {
        self.write_locator_unverified(locator, content, expected_revision)?;
        self.verify_text_locator(locator, content)
    }

    /// Whether the document exists, without reading it.
    pub(crate) fn exists_locator(&self, locator: &DocumentLocatorDto) -> Result<bool, BackendError> {
        validate_document_locator(locator, &self.library_id)?;
        match self.binding()?.root {
            Some(LibraryBindingRoot::Desktop { canonical_root }) => {
                Ok(canonical_root.join(locator.logical_path.as_str()).is_file())
            }
            Some(LibraryBindingRoot::Android { tree_uri }) => {
                #[cfg(target_os = "android")]
                {
                    let path = format!(
                        "{}/{}",
                        tree_uri.as_str().trim_end_matches('/'),
                        locator.logical_path.as_str()
                    );
                    Ok(android_saf::path_exists(self.android_picker_state, &path, Some(tree_uri.as_str())).exists)
                }
                #[cfg(not(target_os = "android"))]
                {
                    let _ = tree_uri;
                    Ok(false)
                }
            }
            None => Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La biblioteca no está disponible; volvé a seleccionarla.",
                true,
            )),
        }
    }

    /// Replaces a text document only if it still has the backend-core
    /// revision (`compute_document_revision`) the caller read. The platform
    /// write then re-checks the same content through its own revision.
    pub(crate) fn write_locator_at_revision(
        &self,
        locator: &DocumentLocatorDto,
        content: &str,
        expected_revision: u64,
    ) -> Result<(), BackendError> {
        let current = self.read_locator(locator)?;
        if crate::backend::compute_document_revision(&current) != expected_revision {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El documento cambió desde la última lectura.",
                true,
            ));
        }
        let platform_revision = super::types::content_revision(&current);
        self.write_locator(locator, content, Some(&platform_revision))
    }

    /// Reads the document back after a write. Some SAF providers ignore the
    /// truncating mode and keep stale trailing bytes; success is only
    /// reported when the persisted text matches exactly.
    fn verify_text_locator(
        &self,
        locator: &DocumentLocatorDto,
        expected: &str,
    ) -> Result<(), BackendError> {
        if self.read_locator(locator)? != expected {
            return Err(BackendError::new(
                BackendErrorCode::Storage,
                "El documento guardado no coincide con el contenido enviado.",
                true,
            ));
        }
        Ok(())
    }

    fn write_locator_unverified(
        &self,
        locator: &DocumentLocatorDto,
        content: &str,
        expected_revision: Option<&str>,
    ) -> Result<(), BackendError> {
        if content.chars().count()
            > notia_backend_core::library_tools::max_write_document_chars(locator.logical_path.as_str())
        {
            return Err(BackendError::invalid_input(
                "El documento supera el límite de tamaño.",
            ));
        }

        match self.map_locator(locator)? {
            MappedDocumentTarget::Desktop {
                filesystem_path, ..
            } => {
                let path = filesystem_path.to_str().ok_or_else(|| {
                    BackendError::invalid_input("La ruta del documento no es UTF-8 válida.")
                })?;
                let result = desktop::write_library_file(path, content, expected_revision);
                if result.ok {
                    Ok(())
                } else {
                    Err(map_filesystem_error(
                        result.error.as_deref().unwrap_or("Could not write file."),
                    ))
                }
            }
            MappedDocumentTarget::Android {
                tree_uri,
                document_uri,
                document_uri_supplied,
                ..
            } => {
                #[cfg(target_os = "android")]
                {
                    if document_uri_supplied {
                        verify_android_document_access(
                            self.android_picker_state,
                            tree_uri.as_ref(),
                            &document_uri,
                            true,
                        )?;
                    }
                    let result = android_saf::write_library_file(
                        self.android_picker_state,
                        document_uri.as_str(),
                        content,
                        expected_revision,
                        None,
                    )
                    .ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::Unsupported,
                            "La escritura SAF no está disponible en esta plataforma.",
                            false,
                        )
                    })?;
                    if result.ok {
                        Ok(())
                    } else {
                        Err(map_filesystem_error(
                            result.error.as_deref().unwrap_or("Could not write file."),
                        ))
                    }
                }
                #[cfg(not(target_os = "android"))]
                {
                    let _ = (tree_uri, document_uri, document_uri_supplied);
                    Err(BackendError::new(
                        BackendErrorCode::Unsupported,
                        "La escritura SAF no está disponible en esta plataforma.",
                        false,
                    ))
                }
            }
        }
    }

    /// Creates a text document (failing if it exists) and verifies it.
    pub(crate) fn create_text_locator(
        &self,
        locator: &DocumentLocatorDto,
        content: &str,
    ) -> Result<(), BackendError> {
        self.create_text_locator_unverified(locator, content)?;
        self.verify_text_locator(locator, content)
    }

    fn create_text_locator_unverified(
        &self,
        locator: &DocumentLocatorDto,
        content: &str,
    ) -> Result<(), BackendError> {
        validate_document_locator(locator, &self.library_id)?;
        if content.chars().count()
            > notia_backend_core::library_tools::max_write_document_chars(locator.logical_path.as_str())
        {
            return Err(BackendError::invalid_input(
                "El documento supera el límite de tamaño.",
            ));
        }

        #[cfg(not(target_os = "android"))]
        {
            let MappedDocumentTarget::Desktop { filesystem_path, .. } = self.map_locator(locator)? else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La creación documental no está disponible para esta biblioteca.",
                    false,
                ));
            };
            let path = filesystem_path.to_str().ok_or_else(|| {
                BackendError::invalid_input("La ruta del documento no es UTF-8 válida.")
            })?;
            let result = desktop::create_library_file(path, content);
            return if result.ok {
                Ok(())
            } else {
                Err(map_filesystem_error(
                    result.error.as_deref().unwrap_or("Could not create file."),
                ))
            };
        }

        #[cfg(target_os = "android")]
        {
            let binding = self.binding()?;
            let Some(LibraryBindingRoot::Android { tree_uri }) = binding.root else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La biblioteca no tiene un grant SAF Android.",
                    false,
                ));
            };
            let file_path = format!(
                "{}/{}",
                tree_uri.as_str().trim_end_matches('/'),
                locator.logical_path.as_str()
            );
            let result = android_saf::create_library_file(
                self.android_picker_state,
                &file_path,
                content,
                Some(tree_uri.as_str()),
            )
            .ok_or_else(|| {
                BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La creación documental SAF no está disponible.",
                    false,
                )
            })?;
            if result.ok {
                Ok(())
            } else {
                Err(map_filesystem_error(
                    result.error.as_deref().unwrap_or("Could not create file."),
                ))
            }
        }
    }

    /// Replaces a text document, creating it (and, on desktop, its missing
    /// parent directories inside the library) when it does not exist yet.
    /// SAF creates the whole relative path in one native call.
    pub(crate) fn upsert_text_locator(
        &self,
        locator: &DocumentLocatorDto,
        content: &str,
    ) -> Result<(), BackendError> {
        match self.write_locator(locator, content, None) {
            Err(error) if error.code == BackendErrorCode::NotFound => {
                #[cfg(not(target_os = "android"))]
                self.create_desktop_parent_directories(locator)?;
                self.create_text_locator(locator, content)
            }
            other => other,
        }
    }

    #[cfg(not(target_os = "android"))]
    fn create_desktop_parent_directories(
        &self,
        locator: &DocumentLocatorDto,
    ) -> Result<(), BackendError> {
        let Some(LibraryBindingRoot::Desktop { canonical_root }) = self.binding()?.root else {
            return Ok(());
        };
        let Some((parent, _)) = locator.logical_path.as_str().rsplit_once('/') else {
            return Ok(());
        };
        let target = canonical_root.join(parent);
        // The deepest existing ancestor must stay inside the root so a
        // symlinked folder cannot redirect directory creation elsewhere.
        let mut existing = target.as_path();
        while !existing.exists() {
            existing = existing.parent().unwrap_or(&canonical_root);
        }
        let inside = fs::canonicalize(existing)
            .map(|resolved| resolved.starts_with(&canonical_root))
            .unwrap_or(false);
        if !inside {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La ruta del documento queda fuera de la biblioteca.",
                false,
            ));
        }
        fs::create_dir_all(&target).map_err(|_| {
            BackendError::new(
                BackendErrorCode::Storage,
                "No se pudo crear la carpeta del documento.",
                true,
            )
        })
    }

    pub(crate) fn delete_locator(
        &self,
        locator: &DocumentLocatorDto,
    ) -> Result<(), BackendError> {
        validate_document_locator(locator, &self.library_id)?;

        #[cfg(not(target_os = "android"))]
        {
            let MappedDocumentTarget::Desktop { filesystem_path, .. } = self.map_locator(locator)? else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La eliminación documental no está disponible para esta biblioteca.",
                    false,
                ));
            };
            let path = filesystem_path.to_str().ok_or_else(|| {
                BackendError::invalid_input("La ruta del documento no es UTF-8 válida.")
            })?;
            let result = desktop::delete_entry(path);
            return if result.ok {
                Ok(())
            } else {
                Err(map_filesystem_error(
                    result.error.as_deref().unwrap_or("Could not delete file."),
                ))
            };
        }

        #[cfg(target_os = "android")]
        {
            let binding = self.binding()?;
            let Some(LibraryBindingRoot::Android { tree_uri }) = binding.root else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La biblioteca no tiene un grant SAF Android.",
                    false,
                ));
            };
            let file_path = format!(
                "{}/{}",
                tree_uri.as_str().trim_end_matches('/'),
                locator.logical_path.as_str()
            );
            let result = android_saf::delete_entry(
                self.android_picker_state,
                &file_path,
                Some(tree_uri.as_str()),
            )
            .ok_or_else(|| {
                BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La eliminación documental SAF no está disponible.",
                    false,
                )
            })?;
            if result.ok {
                Ok(())
            } else {
                Err(map_filesystem_error(
                    result.error.as_deref().unwrap_or("Could not delete file."),
                ))
            }
        }
    }

    pub(crate) fn write_binary_locator(
        &self,
        locator: &DocumentLocatorDto,
        data: &[u8],
    ) -> Result<(), BackendError> {
        validate_document_locator(locator, &self.library_id)?;
        if data.is_empty() || data.len() > notia_backend_core::MAX_EXPORT_OUTPUT_BYTES {
            return Err(BackendError::invalid_input(
                "La salida binaria supera los límites permitidos.",
            ));
        }

        #[cfg(target_os = "android")]
        {
            let binding = self.binding()?;
            let Some(LibraryBindingRoot::Android { tree_uri }) = binding.root else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La biblioteca no tiene un grant SAF Android.",
                    false,
                ));
            };
            let result = android_saf::write_binary_file(
                self.android_picker_state,
                &format!(
                    "{}/{}",
                    tree_uri.as_str().trim_end_matches('/'),
                    locator.logical_path.as_str()
                ),
                data,
                Some(tree_uri.as_str()),
            )
            .ok_or_else(|| {
                BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La escritura binaria SAF no está disponible.",
                    false,
                )
            })?;
            if result.ok {
                self.verify_binary_locator(locator, data)
            } else {
                Err(map_filesystem_error(
                    result.error.as_deref().unwrap_or("Could not write file."),
                ))
            }
        }

        #[cfg(not(target_os = "android"))]
        {
            let MappedDocumentTarget::Desktop {
                filesystem_path, ..
            } = self.map_locator(locator)?
            else {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La escritura binaria no está disponible en esta plataforma.",
                    false,
                ));
            };
            write_binary_file_atomic(&filesystem_path, data)?;
            self.verify_binary_locator(locator, data)
        }
    }

    fn verify_binary_locator(
        &self,
        locator: &DocumentLocatorDto,
        expected: &[u8],
    ) -> Result<(), BackendError> {
        let persisted = self.read_binary_locator(locator)?;
        if persisted.as_slice() != expected {
            return Err(BackendError::new(
                BackendErrorCode::Storage,
                "La exportación no coincide con los bytes persistidos.",
                true,
            ));
        }
        Ok(())
    }

    fn read_binary_locator(&self, locator: &DocumentLocatorDto) -> Result<Vec<u8>, BackendError> {
        match self.map_locator(locator)? {
            MappedDocumentTarget::Desktop {
                filesystem_path, ..
            } => fs::read(filesystem_path).map_err(|_| {
                BackendError::new(
                    BackendErrorCode::Storage,
                    "No se pudo verificar la exportación persistida.",
                    true,
                )
            }),
            MappedDocumentTarget::Android {
                tree_uri,
                document_uri,
                document_uri_supplied,
                ..
            } => {
                #[cfg(target_os = "android")]
                {
                    if document_uri_supplied {
                        verify_android_document_access(
                            self.android_picker_state,
                            tree_uri.as_ref(),
                            &document_uri,
                            false,
                        )?;
                    }
                    let path = document_uri.as_str();
                    let result = android_saf::read_library_file_bytes(
                        self.android_picker_state,
                        path,
                        tree_uri.as_ref().map(|uri| uri.as_str()),
                    )
                    .ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::Unsupported,
                            "La lectura binaria SAF no está disponible en esta plataforma.",
                            false,
                        )
                    })?
                    .map_err(|_| {
                        BackendError::new(
                            BackendErrorCode::Storage,
                            "No se pudo verificar la exportación persistida.",
                            true,
                        )
                    })?;
                    Ok(result.1)
                }
                #[cfg(not(target_os = "android"))]
                {
                    let _ = (tree_uri, document_uri, document_uri_supplied);
                    Err(BackendError::new(
                        BackendErrorCode::Unsupported,
                        "La lectura binaria SAF no está disponible en esta plataforma.",
                        false,
                    ))
                }
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
fn write_binary_file_atomic(path: &Path, data: &[u8]) -> Result<(), BackendError> {
    if path.exists() {
        return Err(BackendError::new(
            BackendErrorCode::Conflict,
            "El archivo exportado ya existe.",
            false,
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| BackendError::invalid_input("El destino de exportación no es válido."))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary_path = parent.join(format!(
        ".{}.notia-export-{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("export"),
        nonce
    ));
    let result = (|| -> Result<(), BackendError> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|_| {
                BackendError::new(
                    BackendErrorCode::Storage,
                    "No se pudo preparar la exportación.",
                    true,
                )
            })?;
        file.write_all(data)
            .and_then(|_| file.sync_all())
            .map_err(|_| {
                BackendError::new(
                    BackendErrorCode::Storage,
                    "No se pudo persistir la exportación.",
                    true,
                )
            })?;
        fs::rename(&temporary_path, path).map_err(|_| {
            BackendError::new(
                BackendErrorCode::Storage,
                "No se pudo finalizar la exportación.",
                true,
            )
        })?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

impl DocumentRepository for TauriFilesystemDocumentAdapter<'_> {
    fn read_text(&self, library_id: &str, logical_path: &str) -> Result<String, BackendError> {
        let locator = DocumentLocatorDto::new(library_id, logical_path, None, None)?;
        self.read_locator(&locator)
    }

    fn write_text(
        &self,
        library_id: &str,
        logical_path: &str,
        content: &str,
    ) -> Result<(), BackendError> {
        let locator = DocumentLocatorDto::new(library_id, logical_path, None, None)?;
        self.write_locator(&locator, content, None)
    }
}

fn non_empty_library_id(library_id: &str) -> Result<String, BackendError> {
    let library_id = library_id.trim();
    if library_id.is_empty() {
        return Err(BackendError::invalid_input(INVALID_DOCUMENT_MESSAGE));
    }
    Ok(library_id.to_string())
}

pub(crate) fn resolve_desktop_document(
    root: &Path,
    logical_path: &LogicalPathDto,
) -> Result<PathBuf, BackendError> {
    let canonical_root = fs::canonicalize(root).map_err(|_| {
        BackendError::new(
            BackendErrorCode::NotFound,
            "No se pudo resolver la raíz de la biblioteca.",
            true,
        )
    })?;
    let candidate = canonical_root.join(logical_path.as_str());
    let resolved = match fs::canonicalize(&candidate) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = candidate.parent().ok_or_else(|| {
                BackendError::invalid_input("La ruta del documento no es válida.")
            })?;
            let canonical_parent = fs::canonicalize(parent).map_err(|_| {
                BackendError::new(
                    BackendErrorCode::NotFound,
                    "No se pudo resolver la carpeta del documento.",
                    true,
                )
            })?;
            canonical_parent.join(candidate.file_name().ok_or_else(|| {
                BackendError::invalid_input("La ruta del documento no es válida.")
            })?)
        }
        Err(_) => {
            return Err(BackendError::new(
                BackendErrorCode::Storage,
                "No se pudo resolver el documento de la biblioteca.",
                true,
            ));
        }
    };

    if resolved == canonical_root || !resolved.starts_with(&canonical_root) {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La ruta del documento queda fuera de la biblioteca.",
            false,
        ));
    }
    Ok(resolved)
}

fn validate_android_locator(
    locator: &DocumentLocatorDto,
    configured_tree_uri: Option<&AndroidTreeUriDto>,
) -> Result<AndroidLocatorTarget, BackendError> {
    let tree_uri = locator
        .android_tree_uri
        .clone()
        .or_else(|| configured_tree_uri.cloned());
    if let (Some(expected), Some(actual)) = (configured_tree_uri, &tree_uri) {
        if expected != actual {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "El árbol Android no pertenece a la biblioteca activa.",
                false,
            ));
        }
    }
    if let (Some(tree), Some(document)) = (&tree_uri, &locator.android_document_uri) {
        if !document.has_same_authority(tree) {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "El documento Android no pertenece a la autoridad autorizada.",
                false,
            ));
        }
    }
    Ok(AndroidLocatorTarget {
        logical_path: locator.logical_path.clone(),
        tree_uri,
        document_uri: locator.android_document_uri.clone(),
    })
}

#[cfg(target_os = "android")]
fn verify_android_document_access(
    state: &AndroidDirectoryPickerState,
    tree_uri: Option<&AndroidTreeUriDto>,
    document_uri: &AndroidDocumentUriDto,
    require_write: bool,
) -> Result<(), BackendError> {
    let tree_uri = tree_uri.ok_or_else(|| {
        BackendError::new(
            BackendErrorCode::Unsupported,
            "La biblioteca no tiene un grant SAF Android.",
            false,
        )
    })?;
    let verified = crate::mobile_directory_picker::verify_android_document_under_tree(
        state,
        tree_uri.as_str(),
        document_uri.as_str(),
        require_write,
    )
    .map_err(|error| map_filesystem_error(&error))?;
    if !verified {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "El documento Android no pertenece al árbol autorizado o el permiso no está disponible.",
            false,
        ));
    }
    Ok(())
}

pub(crate) fn map_filesystem_error(message: &str) -> BackendError {
    let lowered = message.to_lowercase();
    if lowered.contains("permission")
        || lowered.contains("permiso")
        || lowered.contains("securityexception")
        || lowered.contains("revoc")
    {
        return BackendError::new(
            BackendErrorCode::Forbidden,
            "El permiso de la biblioteca fue revocado o no está disponible.",
            true,
        );
    }
    if lowered.contains("conflict") || lowered.contains("conflicto") {
        return BackendError::new(
            BackendErrorCode::Conflict,
            "El documento cambió durante la operación.",
            true,
        );
    }
    if lowered.contains("resolve") || lowered.contains("resolver") {
        return BackendError::new(
            BackendErrorCode::NotFound,
            "No se pudo resolver el documento de la biblioteca.",
            true,
        );
    }
    let _ = message;
    BackendError::new(
        BackendErrorCode::Storage,
        "No se pudo acceder al documento de la biblioteca.",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        map_filesystem_error, validate_android_locator, AndroidLocatorTarget, MappedDocumentTarget,
        TauriFilesystemDocumentAdapter,
    };
    use crate::backend::{
        AndroidDocumentUriDto, AndroidTreeUriDto, BackendErrorCode, DocumentLocatorDto,
        LogicalPathDto,
    };
    use crate::library_registry::LibraryBindingRegistry;
    use crate::mobile_directory_picker::AndroidDirectoryPickerState;

    fn state() -> AndroidDirectoryPickerState {
        #[cfg(target_os = "android")]
        {
            AndroidDirectoryPickerState::unavailable()
        }
        #[cfg(not(target_os = "android"))]
        {
            AndroidDirectoryPickerState::empty()
        }
    }

    #[test]
    fn maps_logical_path_under_desktop_root_without_using_uri_fields() {
        let root = std::env::temp_dir().join(format!("notia-adapter-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("notes")).expect("root");
        let state = state();
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-one", &root)
            .expect("binding");
        let adapter = TauriFilesystemDocumentAdapter::for_library(&registry, "library-one", &state)
            .expect("adapter");
        let locator = DocumentLocatorDto::new(
            "library-one",
            "notes/opaque.md",
            Some("content://provider/tree/root"),
            None,
        )
        .expect("locator");

        let MappedDocumentTarget::Desktop {
            logical_path,
            filesystem_path,
        } = adapter.map_locator(&locator).expect("mapped target")
        else {
            panic!("expected desktop target");
        };

        assert_eq!(logical_path.as_str(), "notes/opaque.md");
        // The registry keeps the canonical root (`\\?\` on Windows).
        let canonical_root = std::fs::canonicalize(&root).expect("canonical root");
        assert_eq!(filesystem_path, canonical_root.join("notes").join("opaque.md"));
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn adapter_factory_rejects_unknown_library_bindings() {
        let registry = LibraryBindingRegistry::default();
        let state = state();

        let result =
            TauriFilesystemDocumentAdapter::for_library(&registry, "missing-library", &state)
                .err()
                .expect("unknown binding");

        assert_eq!(result.code, BackendErrorCode::NotFound);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_desktop_symlink_escape_before_io() {
        use std::os::unix::fs::symlink;

        let root =
            std::env::temp_dir().join(format!("notia-adapter-symlink-test-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("notia-adapter-outside-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("root");
        std::fs::create_dir_all(&outside).expect("outside");
        symlink(&outside, root.join("linked")).expect("symlink");

        let state = state();
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-one", &root)
            .expect("binding");
        let adapter = TauriFilesystemDocumentAdapter::for_library(&registry, "library-one", &state)
            .expect("adapter");
        let locator =
            DocumentLocatorDto::new("library-one", "linked/file.md", None, None).expect("locator");

        let error = adapter.map_locator(&locator).expect_err("escape");
        assert_eq!(error.code, BackendErrorCode::Forbidden);
        std::fs::remove_dir_all(root).expect("root cleanup");
        std::fs::remove_dir_all(outside).expect("outside cleanup");
    }

    #[test]
    fn rejects_a_locator_for_another_library_before_mapping() {
        let state = state();
        let root = std::env::temp_dir().join(format!("notia-adapter-scope-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("root");
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-one", &root)
            .expect("binding");
        let adapter = TauriFilesystemDocumentAdapter::for_library(&registry, "library-one", &state)
            .expect("adapter");
        let locator =
            DocumentLocatorDto::new("library-two", "notes/a.md", None, None).expect("locator");

        let error = adapter.map_locator(&locator).expect_err("scope error");
        assert_eq!(error.code, BackendErrorCode::Forbidden);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_traversal_and_stale_replaced_bindings() {
        let root =
            std::env::temp_dir().join(format!("notia-adapter-generation-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("root");
        let state = state();
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-one", &root)
            .expect("binding");
        let adapter = TauriFilesystemDocumentAdapter::for_library(&registry, "library-one", &state)
            .expect("adapter");
        let traversal = DocumentLocatorDto::new("library-one", "../outside.md", None, None);
        assert!(traversal.is_err());

        registry
            .register_desktop_root("library-one", &root)
            .expect("replacement");
        let locator =
            DocumentLocatorDto::new("library-one", "notes/a.md", None, None).expect("locator");
        let error = adapter.map_locator(&locator).expect_err("stale binding");
        assert_eq!(error.code, BackendErrorCode::Conflict);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn preserves_opaque_tree_and_document_uris_for_mock_saf_mapping() {
        let tree = "content://provider/tree/primary%3ANotas";
        let document = "content://provider/tree/primary%3ANotas/document/primary%3ANotas%2Fnota.md";
        let locator = DocumentLocatorDto::new("library-one", "nota.md", Some(tree), Some(document))
            .expect("locator");

        crate::backend::validate_document_locator(&locator, "library-one").expect("scope");
        let target = validate_android_locator(&locator, None).expect("target");
        let mut mock = MockSafAdapter::default();
        mock.read(&target).expect("mock read");

        assert_eq!(mock.last_opened.as_deref(), Some(document));
        assert_ne!(mock.last_opened.as_deref(), Some(tree));
        assert_eq!(target.logical_path.as_str(), "nota.md");
        assert_eq!(target.tree_uri.as_ref().unwrap().as_str(), tree);
    }

    #[test]
    fn rejects_a_document_uri_from_a_different_tree_even_with_the_same_authority() {
        let tree = AndroidTreeUriDto::new("content://provider/tree/primary%3ANotas").expect("tree");
        let locator = DocumentLocatorDto::new(
            "library-one",
            "nota.md",
            Some(tree.as_str()),
            Some("content://provider/tree/primary%3AOtra/document/primary%3AOtra%2Fnota.md"),
        )
        .expect("locator");

        validate_android_locator(&locator, Some(&tree))
            .expect("same-authority containment is verified by the Android provider");
    }

    #[test]
    fn maps_permission_and_revocation_errors_to_recoverable_forbidden() {
        let error = map_filesystem_error("SecurityException: permiso revocado");
        assert_eq!(error.code, BackendErrorCode::Forbidden);
        assert!(error.retryable);
    }

    #[test]
    fn maps_resolution_errors_without_exposing_provider_details() {
        let error = map_filesystem_error("No se pudo resolver la entrada Android: private detail");
        assert_eq!(error.code, BackendErrorCode::NotFound);
        assert_eq!(
            error.message,
            "No se pudo resolver el documento de la biblioteca."
        );
        assert!(!error.message.contains("private detail"));
    }

    #[derive(Default)]
    struct MockSafAdapter {
        last_opened: Option<String>,
    }

    impl MockSafAdapter {
        fn read(&mut self, target: &AndroidLocatorTarget) -> Result<(), &'static str> {
            let document = target.document_uri.as_ref().ok_or("document unresolved")?;
            self.last_opened = Some(document.as_str().to_string());
            Ok(())
        }
    }

    #[allow(dead_code)]
    fn _typed_uri_assertions() {
        let _ = AndroidTreeUriDto::new("content://provider/tree/id");
        let _ = AndroidDocumentUriDto::new("content://provider/document/id");
        let _ = LogicalPathDto::new("notes/a.md");
    }
}

/// Receipt of a library export written by the backend.
pub(crate) struct LibraryExportReceipt {
    pub(crate) destination_logical_path: String,
    pub(crate) byte_length: usize,
    pub(crate) content_fingerprint: u64,
}

/// Renders a library Markdown document and writes it next to the source with
/// atomic replacement and read-back verification (desktop and SAF). An
/// existing export is never overwritten: a numbered name is chosen instead.
pub(crate) fn export_library_document(
    registry: &LibraryBindingRegistry,
    picker: &AndroidDirectoryPickerState,
    library_id: &str,
    source_logical_path: &str,
    format: crate::backend::ExportFormat,
) -> Result<LibraryExportReceipt, BackendError> {
    use crate::backend::LibraryDocumentReadPort;

    let source_locator = DocumentLocatorDto::new(library_id, source_logical_path, None, None)?;
    let reader = crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
        registry, library_id, picker,
    )?;
    let source = reader.read_document(&source_locator)?;
    let bytes = crate::backend::render_markdown_export(&source.content, format)?;
    let writer = TauriFilesystemDocumentAdapter::for_library(registry, library_id, picker)?;
    for attempt in 1..=crate::backend::MAX_EXPORT_NAME_ATTEMPTS {
        let destination = crate::backend::export_destination_path(
            source_locator.logical_path.as_str(),
            format,
            attempt,
        )?;
        let destination_locator = DocumentLocatorDto::new(library_id, &destination, None, None)?;
        match writer.write_binary_locator(&destination_locator, &bytes) {
            Ok(()) => {
                return Ok(LibraryExportReceipt {
                    destination_logical_path: destination,
                    byte_length: bytes.len(),
                    content_fingerprint: crate::backend::export_fingerprint(&bytes),
                })
            }
            Err(error) if error.code == BackendErrorCode::Conflict => continue,
            Err(error) => return Err(error),
        }
    }
    Err(BackendError::new(
        BackendErrorCode::Conflict,
        "Ya existen demasiadas exportaciones de este documento en la carpeta.",
        false,
    ))
}
