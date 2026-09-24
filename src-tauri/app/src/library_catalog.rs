//! Catalog of the libraries the user added (display name, visible path,
//! Android grant) and the selected one, persisted by the backend in the app
//! data directory. Access to files is still decided by the binding registry;
//! the catalog is what the library switcher shows.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager};

use crate::backend::{BackendError, BackendErrorCode};

const CATALOG_FILE: &str = "library-catalog.json";
const MAX_LIBRARIES: usize = 64;
const MAX_CATALOG_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogLibrary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) android_tree_uri: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryCatalog {
    #[serde(default)]
    pub(crate) libraries: Vec<CatalogLibrary>,
    #[serde(default)]
    pub(crate) selected_library_id: Option<String>,
    /// Set once the catalog exists in the backend; before that the client
    /// may migrate its legacy copy.
    #[serde(default)]
    pub(crate) initialized: bool,
}

#[derive(Default)]
pub(crate) struct LibraryCatalogState {
    lock: Mutex<()>,
}

fn catalog_file(app: &AppHandle) -> Result<PathBuf, BackendError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(CATALOG_FILE))
        .map_err(|_| storage())
}

fn storage() -> BackendError {
    BackendError::new(BackendErrorCode::Storage, "No se pudo acceder al catálogo de bibliotecas.", true)
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

/// Validates and normalizes a catalog sent by the client: ids are unique,
/// Android grants are tree URIs and the selection points to a library.
pub(crate) fn normalize_catalog(mut catalog: LibraryCatalog) -> Result<LibraryCatalog, BackendError> {
    if catalog.libraries.len() > MAX_LIBRARIES {
        return Err(BackendError::invalid_input("Hay demasiadas bibliotecas."));
    }
    let mut seen = std::collections::HashSet::new();
    for library in &mut catalog.libraries {
        library.name = library.name.trim().to_string();
        if !valid_text(&library.id, 128)
            || !valid_text(&library.name, 200)
            || !valid_text(&library.path, 4_096)
            || !seen.insert(library.id.clone())
        {
            return Err(BackendError::invalid_input("El catálogo de bibliotecas no es válido."));
        }
        if let Some(uri) = library.android_tree_uri.as_deref() {
            if crate::backend::AndroidTreeUriDto::new(uri).is_err() {
                library.android_tree_uri = None;
            }
        }
        show_library(library);
    }
    if catalog
        .selected_library_id
        .as_ref()
        .is_some_and(|id| !catalog.libraries.iter().any(|library| &library.id == id))
    {
        catalog.selected_library_id = None;
    }
    if catalog.selected_library_id.is_none() {
        catalog.selected_library_id = catalog.libraries.first().map(|library| library.id.clone());
    }
    catalog.initialized = true;
    Ok(catalog)
}

/// A library as the interface shows it: an Android library is named after
/// the folder of its grant, and a desktop path uses forward slashes.
fn show_library(library: &mut CatalogLibrary) {
    match library.android_tree_uri.as_deref() {
        Some(uri) => {
            let name = crate::backend::library_tree::library_display_name(uri);
            if !name.trim().is_empty() && !name.starts_with("content://") {
                library.name = name;
            }
        }
        None if !library.path.starts_with("content://") => {
            library.path = crate::backend::library_tree::normalize_entry_path(&library.path);
        }
        None => {}
    }
}

fn read_catalog(app: &AppHandle) -> Result<LibraryCatalog, BackendError> {
    let file = catalog_file(app)?;
    let Ok(metadata) = std::fs::metadata(&file) else {
        return Ok(LibraryCatalog::default());
    };
    if metadata.len() > MAX_CATALOG_BYTES {
        return Err(storage());
    }
    let text = std::fs::read_to_string(&file).map_err(|_| storage())?;
    serde_json::from_str::<LibraryCatalog>(&text)
        .ok()
        .map(normalize_catalog)
        .transpose()?
        .map_or_else(|| Ok(LibraryCatalog::default()), Ok)
}

fn write_catalog(app: &AppHandle, catalog: &LibraryCatalog) -> Result<(), BackendError> {
    let file = catalog_file(app)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|_| storage())?;
    }
    let text = serde_json::to_string_pretty(catalog).map_err(|_| storage())?;
    let temporary = file.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(|_| storage())?;
    std::fs::rename(&temporary, &file).map_err(|_| storage())
}

/// Library the user has selected, for backend services (backups).
/// A library of the catalog by id.
/// Every library of the catalog.
pub(crate) fn catalog_libraries(app: &AppHandle) -> Vec<CatalogLibrary> {
    let state = app.state::<LibraryCatalogState>();
    let Ok(_guard) = state.lock.lock() else {
        return Vec::new();
    };
    read_catalog(app).map(|catalog| catalog.libraries).unwrap_or_default()
}

pub(crate) fn catalog_library(app: &AppHandle, library_id: &str) -> Option<CatalogLibrary> {
    let state = app.state::<LibraryCatalogState>();
    let _guard = state.lock.lock().ok()?;
    read_catalog(app).ok()?.libraries.into_iter().find(|library| library.id == library_id)
}

/// The selected library as the switcher shows it.
pub(crate) fn selected_library(app: &AppHandle) -> Option<CatalogLibrary> {
    let state = app.state::<LibraryCatalogState>();
    let _guard = state.lock.lock().ok()?;
    let catalog = read_catalog(app).ok()?;
    let selected = catalog.selected_library_id?;
    catalog.libraries.into_iter().find(|library| library.id == selected)
}

pub(crate) fn selected_library_id(app: &AppHandle) -> Option<String> {
    let state = app.state::<LibraryCatalogState>();
    let _guard = state.lock.lock().ok()?;
    read_catalog(app).ok()?.selected_library_id
}

pub(crate) fn backend_library_catalog(
    app: AppHandle,
    state: crate::host::State<'_, LibraryCatalogState>,
) -> Result<LibraryCatalog, BackendError> {
    let _guard = state.lock.lock().map_err(|_| storage())?;
    let mut catalog = read_catalog(&app)?;
    catalog.libraries.iter_mut().for_each(show_library);
    Ok(catalog)
}

/// Replaces the catalog (add, remove, rename, select) and returns what was
/// stored. Libraries removed from the catalog lose their binding.
pub(crate) fn backend_save_library_catalog(
    app: AppHandle,
    catalog: LibraryCatalog,
    state: crate::host::State<'_, LibraryCatalogState>,
) -> Result<LibraryCatalog, BackendError> {
    let _guard = state.lock.lock().map_err(|_| storage())?;
    let previous = read_catalog(&app)?;
    let catalog = normalize_catalog(catalog)?;
    write_catalog(&app, &catalog)?;
    let registry = app.state::<crate::library_registry::LibraryBindingRegistry>();
    for removed in previous
        .libraries
        .iter()
        .filter(|library| !catalog.libraries.iter().any(|kept| kept.id == library.id))
    {
        let _ = registry.revoke(&removed.id);
        app.state::<crate::coldpass::ColdPassState>().lock_library(&removed.id);
        crate::agent_workspace::forget_library(&app, &removed.id);
    }
    Ok(catalog)
}

/// Windows canonical paths carry the `\\?\` prefix; the catalog keeps the
/// plain drive path people recognize (`C:\...`). UNC paths are left as is.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn without_verbatim_prefix(path: &str) -> String {
    match path.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => path.to_string(),
    }
}

/// Adds a local folder as a library, trusted because whoever runs the
/// command administers this computer (headless `--add-library`). A folder
/// already in the catalog keeps its id; the first library becomes selected.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn add_desktop_library(app: &AppHandle, folder: &std::path::Path) -> Result<CatalogLibrary, BackendError> {
    let root = std::fs::canonicalize(folder)
        .ok()
        .filter(|root| root.is_dir())
        .ok_or_else(|| BackendError::invalid_input("La carpeta de la biblioteca no existe."))?;
    let path = root
        .to_str()
        .map(without_verbatim_prefix)
        .ok_or_else(|| BackendError::invalid_input("La ruta de la biblioteca no es UTF-8 válida."))?;
    let state = app.state::<LibraryCatalogState>();
    let _guard = state.lock.lock().map_err(|_| storage())?;
    let mut catalog = read_catalog(app)?;
    let existing = catalog
        .libraries
        .iter()
        .find(|library| std::fs::canonicalize(&library.path).is_ok_and(|known| known == root));
    let library = match existing {
        Some(library) => library.clone(),
        None => {
            let name = root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| "Biblioteca".to_string());
            let library = CatalogLibrary { id: uuid::Uuid::new_v4().to_string(), name, path, android_tree_uri: None };
            catalog.libraries.push(library.clone());
            library
        }
    };
    app.state::<crate::library_registry::LibraryBindingRegistry>().register_desktop_root(&library.id, &root)?;
    if catalog.selected_library_id.is_none() {
        catalog.selected_library_id = Some(library.id.clone());
    }
    catalog.initialized = true;
    let catalog = normalize_catalog(catalog)?;
    write_catalog(app, &catalog)?;
    Ok(library)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library(id: &str) -> CatalogLibrary {
        CatalogLibrary {
            id: id.into(),
            name: format!(" {id} "),
            path: format!("C:/libs/{id}"),
            android_tree_uri: Some("no-es-saf".into()),
        }
    }

    #[test]
    fn catalog_paths_drop_the_windows_verbatim_prefix_of_drive_paths() {
        assert_eq!(without_verbatim_prefix(r"\\?\C:\Notas"), r"C:\Notas");
        assert_eq!(without_verbatim_prefix(r"\\?\UNC\server\share"), r"\\?\UNC\server\share");
        assert_eq!(without_verbatim_prefix("/home/notas"), "/home/notas");
    }

    #[test]
    fn adding_a_desktop_library_registers_it_once_and_selects_it() {
        use crate::host::{AppPaths, HostPorts};
        let root = std::env::temp_dir().join(format!("notia-catalog-test-{}", uuid::Uuid::new_v4()));
        let folder = root.join("Mis notas");
        std::fs::create_dir_all(&folder).expect("library folder");
        let app = crate::create_app(AppPaths::new(Some(root.join("data")), None), HostPorts::default());
        let added = add_desktop_library(&app, &folder).expect("library added");
        assert_eq!(added.name, "Mis notas");
        let again = add_desktop_library(&app, &folder).expect("library kept");
        assert_eq!(again.id, added.id);
        let catalog = read_catalog(&app).expect("catalog");
        assert_eq!(catalog.libraries.len(), 1);
        assert_eq!(catalog.selected_library_id.as_deref(), Some(added.id.as_str()));
        assert!(app.state::<crate::library_registry::LibraryBindingRegistry>().lookup(&added.id).is_ok());
        assert!(add_desktop_library(&app, &root.join("no-existe")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn normalization_trims_names_drops_invalid_grants_and_fixes_selection() {
        let catalog = normalize_catalog(LibraryCatalog {
            libraries: vec![library("a"), library("b")],
            selected_library_id: Some("borrada".into()),
            initialized: false,
        })
        .expect("catalog");
        assert_eq!(catalog.libraries[0].name, "a");
        assert_eq!(catalog.libraries[0].android_tree_uri, None);
        assert_eq!(catalog.selected_library_id.as_deref(), Some("a"));
        assert!(catalog.initialized);
    }

    #[test]
    fn rejects_duplicate_ids_and_empty_paths() {
        assert!(normalize_catalog(LibraryCatalog {
            libraries: vec![library("a"), library("a")],
            ..LibraryCatalog::default()
        })
        .is_err());
        let mut empty = library("c");
        empty.path = " ".into();
        assert!(normalize_catalog(LibraryCatalog { libraries: vec![empty], ..LibraryCatalog::default() }).is_err());
    }
}
