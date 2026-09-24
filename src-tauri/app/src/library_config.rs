//! Tauri commands for the library configuration. The backend reads,
//! normalizes, migrates and persists `.notia/notiaConfig.json` through the
//! registered library binding; the WebView only sends library identity and
//! the configuration it wants to store.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::host::State;

use crate::backend::library_config::{
    default_library_config, normalize_library_config, parse_library_config,
    serialize_library_config, LIBRARY_CONFIG_DIRECTORY, LIBRARY_CONFIG_LOGICAL_PATH,
};
use crate::backend::{BackendError, BackendErrorCode, DocumentLocatorDto};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::{LibraryBinding, LibraryBindingRegistry, LibraryBindingRoot};
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryConfigPayload {
    library_id: String,
    #[serde(default)]
    config: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryConfigResult {
    ok: bool,
    /// Normalized configuration; `None` when the library has none yet.
    config: Option<Value>,
    error: Option<String>,
}

impl LibraryConfigResult {
    fn from_result(result: Result<Option<Value>, BackendError>) -> Self {
        match result {
            Ok(config) => Self {
                ok: true,
                config,
                error: None,
            },
            Err(error) => Self {
                ok: false,
                config: None,
                error: Some(error.message),
            },
        }
    }
}

struct LibraryConfigStore<'a> {
    library_id: String,
    binding: LibraryBinding,
    adapter: TauriFilesystemDocumentAdapter<'a>,
    picker: &'a AndroidDirectoryPickerState,
}

impl<'a> LibraryConfigStore<'a> {
    fn open(
        registry: &LibraryBindingRegistry,
        library_id: &str,
        picker: &'a AndroidDirectoryPickerState,
    ) -> Result<Self, BackendError> {
        Ok(Self {
            library_id: library_id.to_string(),
            binding: registry.lookup(library_id)?,
            adapter: TauriFilesystemDocumentAdapter::for_library(registry, library_id, picker)?,
            picker,
        })
    }

    fn locator(&self) -> Result<DocumentLocatorDto, BackendError> {
        DocumentLocatorDto::new(&self.library_id, LIBRARY_CONFIG_LOGICAL_PATH, None, None)
    }

    fn exists(&self) -> Result<bool, BackendError> {
        match &self.binding.root {
            Some(LibraryBindingRoot::Desktop { canonical_root }) => {
                let _ = self.picker;
                Ok(canonical_root.join(LIBRARY_CONFIG_LOGICAL_PATH).is_file())
            }
            Some(LibraryBindingRoot::Android { tree_uri }) => {
                #[cfg(target_os = "android")]
                {
                    let path = format!("{}/{}", tree_uri.as_str(), LIBRARY_CONFIG_LOGICAL_PATH);
                    Ok(crate::filesystem::android_saf::path_exists(
                        self.picker,
                        &path,
                        Some(tree_uri.as_str()),
                    )
                    .exists)
                }
                #[cfg(not(target_os = "android"))]
                {
                    let _ = tree_uri;
                    Err(unavailable())
                }
            }
            None => Err(unavailable()),
        }
    }

    fn read(&self) -> Result<Option<Value>, BackendError> {
        if !self.exists()? {
            return Ok(None);
        }
        let normalized = parse_library_config(&self.adapter.read_locator(&self.locator()?)?)?;
        if normalized.needs_migration {
            self.persist(&normalized.config, true)?;
        }
        Ok(Some(normalized.config))
    }

    /// Writes the configuration atomically, creating `.notia/` when needed.
    /// SAF creates the whole relative path in one native call; desktop
    /// creates the directory under the canonical root first.
    fn persist(&self, config: &Value, exists: bool) -> Result<(), BackendError> {
        let text = serialize_library_config(config)?;
        let locator = self.locator()?;
        if exists {
            return self.adapter.write_locator(&locator, &text, None);
        }
        if let Some(LibraryBindingRoot::Desktop { canonical_root }) = &self.binding.root {
            std::fs::create_dir_all(canonical_root.join(LIBRARY_CONFIG_DIRECTORY)).map_err(|_| {
                BackendError::new(
                    BackendErrorCode::Storage,
                    "No se pudo crear el directorio de configuración.",
                    true,
                )
            })?;
        }
        self.adapter.create_text_locator(&locator, &text)
    }
}

/// Normalized configuration of a library for other backend modules (context
/// catalog, provider settings). `None` when the library has none.
pub(crate) fn read_library_config(app: &crate::host::AppHandle, library_id: &str) -> Result<Option<Value>, BackendError> {
    use crate::host::Manager;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    LibraryConfigStore::open(registry.inner(), library_id, picker.inner())?.read()
}

fn unavailable() -> BackendError {
    BackendError::new(
        BackendErrorCode::Forbidden,
        "La biblioteca no está disponible; volvé a seleccionarla.",
        true,
    )
}

/// Reads the normalized configuration, migrating legacy files in place.
pub(crate) fn backend_read_library_config(
    payload: LibraryConfigPayload,
    registry: State<'_, LibraryBindingRegistry>,
    picker: State<'_, AndroidDirectoryPickerState>,
) -> LibraryConfigResult {
    LibraryConfigResult::from_result(
        LibraryConfigStore::open(registry.inner(), &payload.library_id, picker.inner())
            .and_then(|store| store.read()),
    )
}

/// Normalizes and stores the configuration sent by the client and returns
/// what was persisted.
pub(crate) fn backend_write_library_config(
    payload: LibraryConfigPayload,
    registry: State<'_, LibraryBindingRegistry>,
    picker: State<'_, AndroidDirectoryPickerState>,
) -> LibraryConfigResult {
    LibraryConfigResult::from_result((|| {
        let config = payload
            .config
            .as_ref()
            .ok_or_else(|| BackendError::invalid_input("Falta la configuración a guardar."))?;
        if !config.is_object() {
            return Err(BackendError::invalid_input("La configuración debe ser un objeto."));
        }
        let store = LibraryConfigStore::open(registry.inner(), &payload.library_id, picker.inner())?;
        // Sections the client does not edit (for example the LlamaCloud
        // credential) keep their stored value instead of being erased.
        // A corrupt stored file is replaced; access errors resurface on write.
        let exists = store.exists()?;
        let stored = if exists { store.read().ok().flatten() } else { None };
        let mut merged = stored.unwrap_or_else(|| Value::Object(Default::default()));
        if let (Some(target), Some(updates)) = (merged.as_object_mut(), config.as_object()) {
            for (key, value) in updates {
                target.insert(key.clone(), value.clone());
            }
        }
        let normalized = normalize_library_config(&merged).config;
        store.persist(&normalized, exists)?;
        Ok(Some(normalized))
    })())
}

/// Creates the default configuration when the library has none.
pub(crate) fn backend_ensure_library_config(
    payload: LibraryConfigPayload,
    registry: State<'_, LibraryBindingRegistry>,
    picker: State<'_, AndroidDirectoryPickerState>,
) -> LibraryConfigResult {
    LibraryConfigResult::from_result((|| {
        let store = LibraryConfigStore::open(registry.inner(), &payload.library_id, picker.inner())?;
        if let Some(config) = store.read()? {
            return Ok(Some(config));
        }
        let config = default_library_config();
        store.persist(&config, false)?;
        Ok(Some(config))
    })())
}
