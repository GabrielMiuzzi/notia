use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use crate::backend::{AndroidTreeUriDto, BackendError, BackendErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LibraryBindingRoot {
    Desktop { canonical_root: PathBuf },
    Android { tree_uri: AndroidTreeUriDto },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LibraryBinding {
    pub(crate) library_id: String,
    pub(crate) generation: u64,
    pub(crate) root: Option<LibraryBindingRoot>,
    pub(crate) revoked: bool,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct LibraryBindingRegistry {
    bindings: Arc<RwLock<HashMap<String, LibraryBinding>>>,
    /// Backend-owned file with the desktop roots chosen by the user. It is
    /// loaded before the WebView starts so no client call can race it.
    persistence: Arc<RwLock<Option<PathBuf>>>,
}

/// File, inside the app data directory, that persists desktop bindings.
#[cfg(not(target_os = "android"))]
const BINDINGS_FILE: &str = "library-bindings.json";
#[cfg(not(target_os = "android"))]
const MAX_BINDINGS_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedDesktopBinding {
    library_id: String,
    desktop_root: PathBuf,
}

impl LibraryBindingRegistry {
    /// Loads persisted desktop bindings and enables persistence to `file`.
    /// Roots that no longer exist are skipped; they can be picked again.
    #[cfg(not(target_os = "android"))]
    pub(crate) fn load_persisted(&self, file: PathBuf) {
        if let Ok(metadata) = fs::metadata(&file) {
            if metadata.len() <= MAX_BINDINGS_FILE_BYTES {
                let entries = fs::read_to_string(&file)
                    .ok()
                    .and_then(|text| serde_json::from_str::<Vec<PersistedDesktopBinding>>(&text).ok())
                    .unwrap_or_default();
                for entry in entries {
                    let Ok(library_id) = validate_library_id(&entry.library_id) else {
                        continue;
                    };
                    let Ok(canonical_root) = fs::canonicalize(&entry.desktop_root) else {
                        continue;
                    };
                    if canonical_root.is_dir() {
                        let _ = self.replace_binding(
                            library_id.to_string(),
                            LibraryBindingRoot::Desktop { canonical_root },
                        );
                    }
                }
            } else {
                log::warn!("[notia:libraries] registro de bibliotecas ignorado por tamaño");
            }
        }
        if let Ok(mut persistence) = self.persistence.write() {
            *persistence = Some(file);
        }
    }

    /// Writes the desktop bindings atomically. Without a persistence file
    /// (tests, Android) this is a no-op.
    fn persist(&self) -> Result<(), BackendError> {
        let Some(file) = self.persistence.read().map_err(|_| registry_error())?.clone() else {
            return Ok(());
        };
        let entries = self
            .bindings
            .read()
            .map_err(|_| registry_error())?
            .values()
            .filter(|binding| !binding.revoked)
            .filter_map(|binding| match &binding.root {
                Some(LibraryBindingRoot::Desktop { canonical_root }) => Some(PersistedDesktopBinding {
                    library_id: binding.library_id.clone(),
                    desktop_root: canonical_root.clone(),
                }),
                _ => None,
            })
            .collect::<Vec<_>>();
        let text = serde_json::to_string_pretty(&entries).map_err(|_| registry_error())?;
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent).map_err(|_| persistence_error())?;
        }
        let temporary = file.with_extension("json.tmp");
        fs::write(&temporary, text).map_err(|_| persistence_error())?;
        fs::rename(&temporary, &file).map_err(|_| persistence_error())
    }

    /// Registers a root the user chose in the native folder picker.
    pub(crate) fn register_desktop_root(
        &self,
        library_id: &str,
        selected_root: &Path,
    ) -> Result<LibraryBinding, BackendError> {
        let binding = self.bind_desktop_root(library_id, selected_root)?;
        self.persist()?;
        Ok(binding)
    }

    /// Registers a root sent by the WebView. It is only accepted when it is
    /// the root already bound to that library, or an existing Notia library
    /// (it contains `.notia/`), so a compromised client cannot turn an
    /// arbitrary folder into a writable library.
    pub(crate) fn register_desktop_root_from_client(
        &self,
        library_id: &str,
        claimed_root: &Path,
    ) -> Result<LibraryBinding, BackendError> {
        let library_id = validate_library_id(library_id)?;
        let canonical_root = fs::canonicalize(claimed_root).map_err(|_| {
            BackendError::new(
                BackendErrorCode::NotFound,
                "No se pudo resolver la raíz de la biblioteca.",
                true,
            )
        })?;
        let already_bound = self
            .bindings
            .read()
            .map_err(|_| registry_error())?
            .get(library_id)
            .and_then(|binding| binding.root.clone())
            == Some(LibraryBindingRoot::Desktop {
                canonical_root: canonical_root.clone(),
            });
        if already_bound {
            return self.lookup(library_id);
        }
        if !canonical_root.join(".notia").is_dir() {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La carpeta no es una biblioteca de Notia; elegila con el selector de bibliotecas.",
                false,
            ));
        }
        self.register_desktop_root(library_id, &canonical_root)
    }

    /// Whether `path` lies inside an active desktop library root. The longest
    /// existing ancestor is canonicalized (resolving links and `..`) and the
    /// non-existing remainder may only contain normal components.
    pub(crate) fn contains_desktop_path(&self, path: &Path) -> bool {
        let mut existing = path.to_path_buf();
        let mut remainder = Vec::new();
        while !existing.exists() {
            let Some(name) = existing.file_name().map(|name| name.to_os_string()) else {
                return false;
            };
            remainder.push(name);
            if !existing.pop() {
                return false;
            }
        }
        if remainder.iter().any(|name| {
            let name = name.to_string_lossy();
            name == "." || name == ".." || name.is_empty()
        }) {
            return false;
        }
        let Ok(canonical) = fs::canonicalize(&existing) else {
            return false;
        };
        let Ok(bindings) = self.bindings.read() else {
            return false;
        };
        bindings.values().any(|binding| {
            !binding.revoked
                && matches!(
                    &binding.root,
                    Some(LibraryBindingRoot::Desktop { canonical_root }) if canonical.starts_with(canonical_root)
                )
        })
    }

    fn bind_desktop_root(
        &self,
        library_id: &str,
        selected_root: &Path,
    ) -> Result<LibraryBinding, BackendError> {
        let library_id = validate_library_id(library_id)?;
        let canonical_root = fs::canonicalize(selected_root).map_err(|_| {
            BackendError::new(
                BackendErrorCode::NotFound,
                "No se pudo resolver la raíz de la biblioteca.",
                true,
            )
        })?;
        if !canonical_root.is_dir() {
            return Err(BackendError::invalid_input(
                "La raíz de la biblioteca no es un directorio.",
            ));
        }

        self.replace_binding(
            library_id.to_string(),
            LibraryBindingRoot::Desktop { canonical_root },
        )
    }

    pub(crate) fn register_android_tree(
        &self,
        library_id: &str,
        tree_uri: &str,
    ) -> Result<LibraryBinding, BackendError> {
        let library_id = validate_library_id(library_id)?;
        let tree_uri = AndroidTreeUriDto::new(tree_uri)?;
        self.replace_binding(
            library_id.to_string(),
            LibraryBindingRoot::Android { tree_uri },
        )
    }

    pub(crate) fn lookup(&self, library_id: &str) -> Result<LibraryBinding, BackendError> {
        let library_id = validate_library_id(library_id)?;
        let bindings = self.bindings.read().map_err(|_| registry_error())?;
        let binding = bindings.get(library_id).ok_or_else(|| {
            BackendError::new(
                BackendErrorCode::NotFound,
                "La biblioteca no está registrada.",
                true,
            )
        })?;
        if binding.revoked || binding.root.is_none() {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La biblioteca fue revocada.",
                true,
            ));
        }
        Ok(binding.clone())
    }

    pub(crate) fn revoke(&self, library_id: &str) -> Result<u64, BackendError> {
        let library_id = validate_library_id(library_id)?;
        let mut bindings = self.bindings.write().map_err(|_| registry_error())?;
        let binding = bindings.get_mut(library_id).ok_or_else(|| {
            BackendError::new(
                BackendErrorCode::NotFound,
                "La biblioteca no está registrada.",
                true,
            )
        })?;
        binding.generation = next_generation(binding.generation);
        binding.root = None;
        binding.revoked = true;
        let generation = binding.generation;
        drop(bindings);
        self.persist()?;
        Ok(generation)
    }

    fn replace_binding(
        &self,
        library_id: String,
        root: LibraryBindingRoot,
    ) -> Result<LibraryBinding, BackendError> {
        let mut bindings = self.bindings.write().map_err(|_| registry_error())?;
        let generation = bindings
            .get(&library_id)
            .map(|binding| next_generation(binding.generation))
            .unwrap_or(1);
        let binding = LibraryBinding {
            library_id: library_id.clone(),
            generation,
            root: Some(root),
            revoked: false,
        };
        bindings.insert(library_id, binding.clone());
        Ok(binding)
    }
}

fn validate_library_id(library_id: &str) -> Result<&str, BackendError> {
    let library_id = library_id.trim();
    if library_id.is_empty() || library_id.chars().any(char::is_control) {
        return Err(BackendError::invalid_input("La biblioteca no es válida."));
    }
    Ok(library_id)
}

fn next_generation(generation: u64) -> u64 {
    generation.saturating_add(1)
}

fn persistence_error() -> BackendError {
    BackendError::new(
        BackendErrorCode::Storage,
        "No se pudo guardar el registro de bibliotecas.",
        true,
    )
}

/// Loads the desktop bindings saved in the data folder.
#[cfg(not(target_os = "android"))]
pub(crate) fn load_persisted_bindings(app: &crate::host::AppHandle) {
    if let Ok(directory) = crate::host::Manager::path(app).app_data_dir() {
        crate::host::Manager::state::<LibraryBindingRegistry>(app).load_persisted(directory.join(BINDINGS_FILE));
    }
}

/// Loads the persisted desktop bindings before any WebView command runs.
pub(crate) fn init() -> crate::host::plugin::TauriPlugin<crate::host::Wry> {
    crate::host::plugin::Builder::new("library-registry")
        .setup(|app, _api| {
            #[cfg(not(target_os = "android"))]
            load_persisted_bindings(app);
            crate::library_session::rehydrate_bindings(app);
            Ok(())
        })
        .build()
}

fn registry_error() -> BackendError {
    BackendError::new(
        BackendErrorCode::Internal,
        "No se pudo acceder al registro de bibliotecas.",
        true,
    )
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedLibraryDirectory {
    pub(crate) path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickLibraryDirectoryPayload {
    pub(crate) library_id: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn pick_library_directory(
    app: crate::host::AppHandle,
    registry: crate::host::State<'_, LibraryBindingRegistry>,
    payload: PickLibraryDirectoryPayload,
) -> Result<Option<PickedLibraryDirectory>, BackendError> {
    use crate::host::dialog::DialogExt;

    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Seleccionar libreria")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let selected_path = selected.into_path().map_err(|_| {
        BackendError::invalid_input("El selector no devolvió una ruta de biblioteca local válida.")
    })?;
    let binding = registry.register_desktop_root(&payload.library_id, &selected_path)?;
    let Some(LibraryBindingRoot::Desktop { canonical_root }) = binding.root else {
        return Err(BackendError::new(
            BackendErrorCode::Internal,
            "El registro devolvió una raíz de biblioteca inválida.",
            false,
        ));
    };
    let path = canonical_root.to_str().ok_or_else(|| {
        BackendError::invalid_input("La ruta de la biblioteca no es UTF-8 válida.")
    })?;
    Ok(Some(PickedLibraryDirectory {
        path: path.to_string(),
    }))
}

pub(crate) fn revoke_library_binding(
    app: crate::host::AppHandle,
    library_id: String,
    registry: crate::host::State<'_, LibraryBindingRegistry>,
    backend: crate::host::State<'_, crate::backend_runtime::BackendRuntimeState>,
    coldpass: crate::host::State<'_, crate::coldpass::ColdPassState>,
) -> Result<(), BackendError> {
    registry.revoke(&library_id)?;
    // A revoked grant must not keep agent runs writing through a stale root.
    backend.cancel_library_runs(&library_id)?;
    coldpass.lock_library(&library_id);
    crate::agent_workspace::forget_library(&app, &library_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{LibraryBindingRegistry, LibraryBindingRoot};

    fn temp_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "notia-library-registry-{name}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn unknown_library_is_rejected_without_a_fallback_root() {
        let registry = LibraryBindingRegistry::default();

        let error = registry
            .lookup("missing-library")
            .expect_err("unknown library");

        assert_eq!(error.code, crate::backend::BackendErrorCode::NotFound);
    }

    #[test]
    fn android_registration_accepts_only_tree_uris() {
        let registry = LibraryBindingRegistry::default();
        let tree = "content://provider/tree/primary%3ANotas";
        let document = "content://provider/tree/primary%3ANotas/document/primary%3ANotas%2Fnota.md";

        let binding = registry
            .register_android_tree("library-one", tree)
            .expect("tree");
        assert!(matches!(
            binding.root,
            Some(LibraryBindingRoot::Android { .. })
        ));
        assert!(registry
            .register_android_tree("library-two", document)
            .is_err());
    }

    #[test]
    fn revoke_and_replace_advance_the_binding_generation() {
        let root = temp_root("generation");
        std::fs::create_dir_all(&root).expect("root");
        let registry = LibraryBindingRegistry::default();

        let first = registry
            .register_desktop_root("library-one", Path::new(&root))
            .expect("first binding");
        let revoked_generation = registry.revoke("library-one").expect("revoke");
        assert_eq!(revoked_generation, first.generation + 1);
        assert!(registry.lookup("library-one").is_err());

        let replacement = registry
            .register_desktop_root("library-one", Path::new(&root))
            .expect("replacement binding");
        assert_eq!(replacement.generation, revoked_generation + 1);
        assert!(!replacement.revoked);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn client_registration_requires_a_known_root_or_an_existing_notia_library() {
        let plain = temp_root("plain-folder");
        let library = temp_root("notia-library");
        std::fs::create_dir_all(&plain).expect("plain");
        std::fs::create_dir_all(library.join(".notia")).expect("library");
        let registry = LibraryBindingRegistry::default();

        assert_eq!(
            registry
                .register_desktop_root_from_client("library-one", &plain)
                .expect_err("plain folder")
                .code,
            crate::backend::BackendErrorCode::Forbidden
        );
        registry
            .register_desktop_root_from_client("library-two", &library)
            .expect("existing Notia library");
        registry
            .register_desktop_root("library-three", &plain)
            .expect("picked folder");
        registry
            .register_desktop_root_from_client("library-three", &plain)
            .expect("same root again");
    }

    #[test]
    fn desktop_paths_must_stay_inside_a_registered_root() {
        let root = temp_root("containment");
        let outside = temp_root("containment-outside");
        std::fs::create_dir_all(root.join("notas")).expect("root");
        std::fs::create_dir_all(&outside).expect("outside");
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-one", &root)
            .expect("binding");

        assert!(registry.contains_desktop_path(&root.join("notas").join("nueva.md")));
        assert!(registry.contains_desktop_path(&root.join("carpeta-nueva").join("a.md")));
        assert!(!registry.contains_desktop_path(&outside.join("a.md")));
        assert!(!registry.contains_desktop_path(&root.join("..").join("escape.md")));
        registry.revoke("library-one").expect("revoke");
        assert!(!registry.contains_desktop_path(&root.join("notas").join("nueva.md")));
    }
}
