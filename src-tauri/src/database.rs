use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, State, Wry,
};

const NOTIA_DIRECTORY: &str = ".notia";
const DATABASE_FILE_NAME: &str = "notia.db";
const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeLibraryDatabasePayload {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
}

pub struct LibraryDatabaseState {
    #[cfg(target_os = "android")]
    handle: std::sync::Mutex<Option<PluginHandle<Wry>>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeLibraryDatabaseResult {
    pub ok: bool,
    pub database_path: Option<String>,
    pub schema_version: Option<i64>,
    pub error: Option<String>,
}

fn database_path(library_path: &str) -> Result<PathBuf, String> {
    let trimmed_library_path = library_path.trim();
    if trimmed_library_path.is_empty() {
        return Err("La ruta de la librería es obligatoria.".to_string());
    }
    let library_root = Path::new(trimmed_library_path);
    if !library_root.is_dir() {
        return Err("La ruta de la librería no es un directorio válido.".to_string());
    }
    Ok(library_root.join(NOTIA_DIRECTORY).join(DATABASE_FILE_NAME))
}

fn migrate(connection: &Connection) -> Result<i64, rusqlite::Error> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = DELETE;
         CREATE TABLE IF NOT EXISTS notia_schema_migrations (
             version INTEGER PRIMARY KEY,
             applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );",
    )?;
    let current_version: i64 = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM notia_schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if current_version < CURRENT_SCHEMA_VERSION {
        let transaction = connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO notia_schema_migrations (version) VALUES (?1)",
            [CURRENT_SCHEMA_VERSION],
        )?;
        transaction.commit()?;
    }
    Ok(current_version.max(CURRENT_SCHEMA_VERSION))
}

#[tauri::command]
pub fn initialize_library_database(
    payload: InitializeLibraryDatabasePayload,
    state: State<'_, LibraryDatabaseState>,
) -> InitializeLibraryDatabaseResult {
    #[cfg(target_os = "android")]
    {
        let Some(directory_uri) = payload
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        else {
            return failure("La librería Android no tiene una URI SAF válida.".to_string());
        };
        let guard = match state.handle.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return failure("No se pudo acceder al adaptador SQLite Android.".to_string())
            }
        };
        let Some(handle) = guard.as_ref() else {
            return failure("El adaptador SQLite Android no está disponible.".to_string());
        };
        return match handle.run_mobile_plugin::<InitializeLibraryDatabaseResult>(
            "initializeDatabase",
            serde_json::json!({ "libraryUri": directory_uri }),
        ) {
            Ok(result) => result,
            Err(error) => failure(format!("No se pudo inicializar SQLite en Android: {error}")),
        };
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let path = match database_path(&payload.library_path) {
            Ok(path) => path,
            Err(error) => return failure(error),
        };
        let Some(parent) = path.parent() else {
            return failure("No se pudo resolver el directorio .notia.".to_string());
        };
        if let Err(error) = fs::create_dir_all(parent) {
            return failure(format!("No se pudo crear .notia: {error}"));
        }
        let connection = match Connection::open(&path) {
            Ok(connection) => connection,
            Err(error) => return failure(format!("No se pudo abrir la base SQLite: {error}")),
        };
        let schema_version = match migrate(&connection) {
            Ok(version) => version,
            Err(error) => return failure(format!("No se pudo migrar la base SQLite: {error}")),
        };
        return InitializeLibraryDatabaseResult {
            ok: true,
            database_path: Some(path.to_string_lossy().into_owned()),
            schema_version: Some(schema_version),
            error: None,
        };
    }
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-library-database")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api
                    .register_android_plugin("com.gabriel.notia", "LibraryDatabasePlugin")
                    .map_err(|error| {
                        format!("No se pudo registrar el plugin SQLite Android: {error}")
                    })?;
                app.manage(LibraryDatabaseState {
                    handle: std::sync::Mutex::new(Some(handle)),
                });
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
                app.manage(LibraryDatabaseState {});
            }
            Ok(())
        })
        .build()
}

fn failure(error: String) -> InitializeLibraryDatabaseResult {
    InitializeLibraryDatabaseResult {
        ok: false,
        database_path: None,
        schema_version: None,
        error: Some(error),
    }
}

#[cfg(test)]
mod tests {
    use super::migrate;
    use rusqlite::Connection;

    #[test]
    fn migration_is_idempotent() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        assert_eq!(migrate(&connection).expect("first migration"), 1);
        assert_eq!(migrate(&connection).expect("second migration"), 1);
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM notia_schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");
        assert_eq!(count, 1);
    }
}
