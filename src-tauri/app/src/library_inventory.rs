//! Backend-owned library inventory. Rust walks the library through its
//! registered binding and publishes a complete snapshot of logical paths in
//! one transaction; the WebView only asks for a reindex and reads pages.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use crate::host::{AppHandle, Manager};

use crate::backend::{BackendError, BackendErrorCode, LogicalPathDto};
use crate::library_registry::{LibraryBinding, LibraryBindingRegistry, LibraryBindingRoot};

/// Upper bound of indexed entries. A larger library is rejected instead of
/// publishing a partial inventory that tools would treat as complete.
const MAX_INDEXED_ENTRIES: usize = 100_000;
/// Directory nesting explored on desktop (SAF applies its own limit).
const MAX_INDEX_DEPTH: usize = 64;

/// Reindexes are serialized: two walks of the same library would only race
/// to publish equivalent snapshots.
static REINDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IndexedEntry {
    pub(crate) logical_path: String,
    pub(crate) is_folder: bool,
    pub(crate) name: String,
    pub(crate) size_bytes: Option<i64>,
    pub(crate) modified_at: Option<i64>,
}

impl IndexedEntry {
    fn parent_path(&self) -> Option<&str> {
        self.logical_path.rsplit_once('/').map(|(parent, _)| parent)
    }
}

pub(crate) fn reindex_library(app: &AppHandle, library_id: &str) -> Result<(usize, i64), BackendError> {
    let _guard = REINDEX_LOCK.lock().map_err(|_| storage("El índice de la biblioteca no está disponible."))?;
    let binding = app.state::<LibraryBindingRegistry>().lookup(library_id)?;
    let entries = collect_entries(app, &binding)?;
    let mut connection = open_connection(app, &binding)?;
    let generation = publish_snapshot(&mut connection, &entries)?;
    sync_connection(app, &binding)?;
    Ok((entries.len(), generation))
}

/// Logical paths of the files in the published inventory and its generation.
pub(crate) fn inventory_files(app: &AppHandle, library_id: &str) -> Result<(Vec<String>, i64), BackendError> {
    let binding = app.state::<LibraryBindingRegistry>().lookup(library_id)?;
    let connection = open_connection(app, &binding)?;
    let generation = connection
        .query_row("SELECT active_generation FROM library_inventory_state WHERE id=1", [], |row| row.get::<_, i64>(0))
        .map_err(|_| storage("El estado del índice no es válido."))?;
    let mut statement = connection
        .prepare(
            "SELECT path FROM library_inventory WHERE generation=?1 AND entry_type='file'
             ORDER BY path LIMIT ?2",
        )
        .map_err(|_| storage("No se pudo leer el índice."))?;
    let files = statement
        .query_map(params![generation, MAX_INDEXED_ENTRIES as i64], |row| row.get::<_, String>(0))
        .map_err(|_| storage("No se pudo leer el índice."))?
        .filter_map(Result::ok)
        .filter(|path| LogicalPathDto::new(path).is_ok())
        .collect();
    Ok((files, generation))
}

fn collect_entries(app: &AppHandle, binding: &LibraryBinding) -> Result<Vec<IndexedEntry>, BackendError> {
    match &binding.root {
        Some(LibraryBindingRoot::Desktop { canonical_root }) => {
            let _ = app;
            let mut entries = Vec::new();
            walk_desktop(canonical_root, "", 0, &mut entries)?;
            Ok(entries)
        }
        Some(LibraryBindingRoot::Android { tree_uri }) => {
            #[cfg(target_os = "android")]
            {
                let picker = app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>();
                let files = crate::mobile_directory_picker::read_android_flat_entries(picker.inner(), tree_uri.as_str())
                    .map_err(|_| {
                        BackendError::new(
                            BackendErrorCode::Forbidden,
                            "No se pudo leer la biblioteca Android; volvé a autorizar la carpeta.",
                            true,
                        )
                    })?;
                entries_from_saf(tree_uri.as_str(), files.into_iter().map(|file| (file.path, file.node_type == "folder")))
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, tree_uri);
                Err(unavailable())
            }
        }
        None => Err(unavailable()),
    }
}

/// Walks the desktop library without following symlinks, so a link can
/// neither escape the root nor create cycles.
fn walk_desktop(
    directory: &Path,
    logical_prefix: &str,
    depth: usize,
    entries: &mut Vec<IndexedEntry>,
) -> Result<(), BackendError> {
    if depth > MAX_INDEX_DEPTH {
        return Ok(());
    }
    let Ok(children) = std::fs::read_dir(directory) else {
        return Ok(());
    };
    for child in children.filter_map(Result::ok) {
        let name = child.file_name().to_string_lossy().into_owned();
        if crate::filesystem::helpers::has_invalid_entry_name(&name)
            || !crate::filesystem::helpers::is_visible_library_tree_entry(&name)
        {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(child.path()) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        let logical_path = if logical_prefix.is_empty() {
            name.clone()
        } else {
            format!("{logical_prefix}/{name}")
        };
        if LogicalPathDto::new(&logical_path).is_err() {
            continue;
        }
        if entries.len() >= MAX_INDEXED_ENTRIES {
            return Err(too_large());
        }
        let is_folder = metadata.is_dir();
        entries.push(IndexedEntry {
            logical_path: logical_path.clone(),
            is_folder,
            name,
            size_bytes: (!is_folder).then(|| metadata.len().min(i64::MAX as u64) as i64),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|elapsed| elapsed.as_millis().min(i64::MAX as u128) as i64),
        });
        if is_folder {
            walk_desktop(&child.path(), &logical_path, depth + 1, entries)?;
        }
    }
    Ok(())
}

#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
/// SAF flat entries arrive as `tree/<logical path>`; only real children of
/// the granted tree with valid logical paths are indexed.
fn entries_from_saf(
    tree_uri: &str,
    files: impl Iterator<Item = (String, bool)>,
) -> Result<Vec<IndexedEntry>, BackendError> {
    let prefix = format!("{}/", tree_uri.trim_end_matches('/'));
    let mut entries = Vec::new();
    for (path, is_folder) in files {
        let Some(logical_path) = path.strip_prefix(&prefix) else {
            continue;
        };
        if LogicalPathDto::new(logical_path).is_err()
            || !logical_path
                .split('/')
                .all(crate::filesystem::helpers::is_visible_library_tree_entry)
        {
            continue;
        }
        if entries.len() >= MAX_INDEXED_ENTRIES {
            return Err(too_large());
        }
        let name = logical_path.rsplit('/').next().unwrap_or(logical_path).to_string();
        entries.push(IndexedEntry {
            logical_path: logical_path.to_string(),
            is_folder,
            name,
            size_bytes: None,
            modified_at: None,
        });
    }
    Ok(entries)
}

/// Replaces the published inventory with `entries` under a new generation in
/// a single transaction; readers see either the old or the new snapshot.
pub(crate) fn publish_snapshot(connection: &mut Connection, entries: &[IndexedEntry]) -> Result<i64, BackendError> {
    let transaction = connection.transaction().map_err(|_| storage("No se pudo iniciar la reindexación."))?;
    let generation = transaction
        .query_row("SELECT active_generation FROM library_inventory_state WHERE id=1", [], |row| row.get::<_, i64>(0))
        .map_err(|_| storage("El estado del índice no es válido."))?
        .max(0)
        .saturating_add(1);
    transaction
        .execute("DELETE FROM library_inventory", [])
        .map_err(|_| storage("No se pudo reemplazar el índice anterior."))?;
    {
        let mut insert = transaction
            .prepare(
                "INSERT INTO library_inventory(path,entry_type,name,parent_path,size_bytes,modified_at,revision,generation,indexed_at)
                 VALUES(?1,?2,?3,?4,?5,?6,0,?7,CURRENT_TIMESTAMP)",
            )
            .map_err(|_| storage("No se pudo preparar el índice."))?;
        for entry in entries {
            insert
                .execute(params![
                    entry.logical_path,
                    if entry.is_folder { "folder" } else { "file" },
                    entry.name,
                    entry.parent_path(),
                    entry.size_bytes,
                    entry.modified_at,
                    generation,
                ])
                .map_err(|_| storage("No se pudo escribir el índice."))?;
        }
    }
    transaction
        .execute("DELETE FROM library_inventory_staging", [])
        .map_err(|_| storage("No se pudo cerrar la reindexación."))?;
    transaction
        .execute(
            "UPDATE library_inventory_state SET active_generation=?1, staging_generation=NULL WHERE id=1",
            params![generation],
        )
        .map_err(|_| storage("No se pudo publicar el índice."))?;
    transaction.commit().map_err(|_| storage("No se pudo confirmar el índice."))?;
    Ok(generation)
}

fn open_connection(app: &AppHandle, binding: &LibraryBinding) -> Result<Connection, BackendError> {
    match &binding.root {
        Some(LibraryBindingRoot::Desktop { canonical_root }) => {
            let _ = app;
            #[cfg(not(target_os = "android"))]
            {
                let root = canonical_root
                    .to_str()
                    .ok_or_else(|| storage("La ruta de la biblioteca no es UTF-8 válida."))?;
                crate::database::open_library_connection(root)
                    .map_err(|_| storage("No se pudo abrir la base de la biblioteca."))
            }
            #[cfg(target_os = "android")]
            {
                let _ = canonical_root;
                Err(unavailable())
            }
        }
        Some(LibraryBindingRoot::Android { tree_uri }) => {
            #[cfg(target_os = "android")]
            {
                crate::database::open_mobile_library_connection(app, tree_uri.as_str())
                    .map_err(|_| storage("No se pudo abrir la base de la biblioteca Android."))
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

/// Android works on a local SQLite copy that must be written back via SAF.
fn sync_connection(app: &AppHandle, binding: &LibraryBinding) -> Result<(), BackendError> {
    #[cfg(target_os = "android")]
    if let Some(LibraryBindingRoot::Android { tree_uri }) = &binding.root {
        return crate::database::sync_mobile_library_connection(app, tree_uri.as_str())
            .map_err(|_| storage("No se pudo guardar el índice en la biblioteca Android."));
    }
    let _ = (app, binding);
    Ok(())
}

fn storage(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Storage, message, true)
}

fn unavailable() -> BackendError {
    BackendError::new(
        BackendErrorCode::Forbidden,
        "La biblioteca no está disponible; volvé a seleccionarla.",
        true,
    )
}

fn too_large() -> BackendError {
    BackendError::new(
        BackendErrorCode::InvalidInput,
        "La biblioteca supera el tamaño máximo indexable.",
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("database");
        crate::database::migrate(&connection).expect("migrate");
        connection
    }

    #[test]
    fn snapshots_replace_the_inventory_with_logical_paths_and_a_new_generation() {
        let mut connection = connection();
        let entry = |path: &str, is_folder| IndexedEntry {
            logical_path: path.to_string(),
            is_folder,
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            size_bytes: None,
            modified_at: None,
        };
        let first = publish_snapshot(&mut connection, &[entry("notas", true), entry("notas/a.md", false)]).expect("first");
        let second = publish_snapshot(&mut connection, &[entry("b.md", false)]).expect("second");
        assert_eq!(second, first + 1);
        let rows: Vec<(String, Option<String>, i64)> = connection
            .prepare("SELECT path,parent_path,generation FROM library_inventory")
            .expect("query")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("rows")
            .collect::<Result<_, _>>()
            .expect("collect");
        assert_eq!(rows, vec![("b.md".to_string(), None, second)]);
    }

    #[test]
    fn saf_entries_keep_only_valid_children_of_the_granted_tree() {
        let tree = "content://provider/tree/primary%3ANotas";
        let entries = entries_from_saf(
            tree,
            vec![
                (format!("{tree}/notas"), true),
                (format!("{tree}/notas/a.md"), false),
                (format!("{tree}/.notia/notia.db"), false),
                ("content://provider/tree/other/x.md".to_string(), false),
                (format!("{tree}/../fuera.md"), false),
            ]
            .into_iter(),
        )
        .expect("entries");
        let paths = entries.iter().map(|entry| entry.logical_path.as_str()).collect::<Vec<_>>();
        assert_eq!(paths, vec!["notas", "notas/a.md"]);
        assert_eq!(entries[1].parent_path(), Some("notas"));
    }

    #[test]
    fn desktop_walk_skips_symlinks_and_hidden_entries() {
        let root = std::env::temp_dir().join(format!("notia-reindex-{}", std::process::id()));
        std::fs::create_dir_all(root.join("notas")).expect("fixture");
        std::fs::create_dir_all(root.join(".notia")).expect("hidden");
        std::fs::write(root.join("notas/a.md"), "a").expect("file");
        let mut entries = Vec::new();
        walk_desktop(&root, "", 0, &mut entries).expect("walk");
        let mut paths = entries.iter().map(|entry| entry.logical_path.clone()).collect::<Vec<_>>();
        paths.sort();
        assert_eq!(paths, vec!["notas".to_string(), "notas/a.md".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
