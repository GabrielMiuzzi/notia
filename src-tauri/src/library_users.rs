use rusqlite::{params, Connection, Error as SqlError, ErrorCode, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::database::open_library_connection;
#[cfg(target_os = "android")]
use crate::database::{open_mobile_library_connection, sync_mobile_library_connection};
use crate::user_auth::{hash_password, verify_password};

const OWNER_USER_ID: &str = "user-owner";
const OWNER_ROLE_ID: &str = "role-owner";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDatabaseContext {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDataError {
    pub code: String,
    pub message: String,
}

type CommandResult<T> = Result<T, LibraryDataError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoleDto {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserDto {
    pub id: String,
    pub name: String,
    pub role_id: String,
    pub role_name: String,
    pub password_configured: bool,
    pub telegram_linked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryRolePayload {
    pub context: LibraryDatabaseContext,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLibraryUserPayload {
    pub context: LibraryDatabaseContext,
    pub name: String,
    pub role_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryUserIdPayload {
    pub context: LibraryDatabaseContext,
    pub user_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibraryUserPasswordPayload {
    pub context: LibraryDatabaseContext,
    pub user_id: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibraryUserNamePayload {
    pub context: LibraryDatabaseContext,
    pub user_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibraryUserRolePayload {
    pub context: LibraryDatabaseContext,
    pub user_id: String,
    pub role_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveTelegramUserPayload {
    pub context: LibraryDatabaseContext,
    pub telegram_user_id: i64,
    pub telegram_chat_id: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindLibraryUserPayload {
    pub context: LibraryDatabaseContext,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTelegramPayload {
    pub context: LibraryDatabaseContext,
    pub user_id: String,
    pub telegram_user_id: i64,
    pub telegram_chat_id: i64,
    pub password: String,
}

fn error(code: &str, message: impl Into<String>) -> LibraryDataError {
    LibraryDataError {
        code: code.to_string(),
        message: message.into(),
    }
}

fn storage_error(message: impl Into<String>) -> LibraryDataError {
    error("storage_error", message)
}

fn open_context(app: &AppHandle, context: &LibraryDatabaseContext) -> CommandResult<Connection> {
    #[cfg(target_os = "android")]
    {
        let uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                error(
                    "invalid_library",
                    "La biblioteca no tiene una URI SAF válida.",
                )
            })?;
        return open_mobile_library_connection(app, uri).map_err(storage_error);
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, context);
        Err(error(
            "unsupported",
            "La gestión de usuarios no está disponible en iOS.",
        ))
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        open_library_connection(&context.library_path).map_err(|message| {
            if context.library_path.trim().is_empty() {
                error("invalid_library", message)
            } else {
                storage_error(message)
            }
        })
    }
}

fn sync_context(app: &AppHandle, context: &LibraryDatabaseContext) -> CommandResult<()> {
    #[cfg(target_os = "android")]
    {
        let uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                error(
                    "invalid_library",
                    "La biblioteca no tiene una URI SAF válida.",
                )
            })?;
        sync_mobile_library_connection(app, uri).map_err(storage_error)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, context);
        Ok(())
    }
}

fn normalize_name(value: &str, kind: &str) -> CommandResult<String> {
    let name = value.trim();
    let length = name.chars().count();
    if length == 0 || length > 64 {
        return Err(error(
            "invalid_name",
            format!("El nombre del {kind} debe tener entre 1 y 64 caracteres."),
        ));
    }
    Ok(name.to_string())
}

fn map_sql_error(sql: SqlError) -> LibraryDataError {
    if let SqlError::SqliteFailure(details, _) = &sql {
        if details.code == ErrorCode::ConstraintViolation {
            return error(
                "duplicate",
                "Ya existe un registro con ese nombre o asociación.",
            );
        }
    }
    storage_error(format!("No se pudo actualizar la biblioteca: {sql}"))
}

fn read_existing_password_hash(
    transaction: &Transaction<'_>,
    user_id: &str,
) -> CommandResult<Option<String>> {
    transaction
        .query_row(
            "SELECT password_hash FROM library_users WHERE id=?1",
            params![user_id.trim()],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map(|hash| hash.flatten())
        .map_err(map_sql_error)
}

/// Authenticates against the library database without exposing the stored hash.
/// The publication runtime uses the returned stable user id as its session identity.
pub(crate) fn authenticate_library_user(
    library_path: &str,
    username: &str,
    password: &str,
) -> Option<String> {
    let username = username.trim();
    if username.is_empty() || password.is_empty() || username.chars().count() > 64 {
        return None;
    }
    let connection = open_library_connection(library_path).ok()?;
    let row: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT id, password_hash FROM library_users WHERE normalized_name=?1",
            params![username.to_lowercase()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()?;
    let (id, hash) = row?;
    hash.filter(|value| verify_password(password, value))
        .map(|_| id)
}

fn list_roles(connection: &Connection) -> CommandResult<Vec<LibraryRoleDto>> {
    let mut statement = connection
        .prepare("SELECT id, name FROM library_roles ORDER BY sort_order, created_at, id")
        .map_err(map_sql_error)?;
    let result = statement
        .query_map([], |row| {
            Ok(LibraryRoleDto {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(map_sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sql_error);
    result
}

fn list_users(connection: &Connection) -> CommandResult<Vec<LibraryUserDto>> {
    let mut statement = connection.prepare(
        "SELECT u.id, u.name, u.role_id, r.name, u.password_hash IS NOT NULL, u.telegram_user_id IS NOT NULL
         FROM library_users u JOIN library_roles r ON r.id = u.role_id
         ORDER BY u.id = 'user-owner' DESC, u.created_at, u.id",
    ).map_err(map_sql_error)?;
    let result = statement
        .query_map([], |row| {
            Ok(LibraryUserDto {
                id: row.get(0)?,
                name: row.get(1)?,
                role_id: row.get(2)?,
                role_name: row.get(3)?,
                password_configured: row.get(4)?,
                telegram_linked: row.get(5)?,
            })
        })
        .map_err(map_sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sql_error);
    result
}

#[tauri::command]
pub fn list_library_roles(
    app: AppHandle,
    payload: LibraryDatabaseContext,
) -> CommandResult<Vec<LibraryRoleDto>> {
    list_roles(&open_context(&app, &payload)?)
}

#[tauri::command]
pub fn create_library_role(
    app: AppHandle,
    payload: CreateLibraryRolePayload,
) -> CommandResult<Vec<LibraryRoleDto>> {
    let name = normalize_name(&payload.name, "rol")?;
    let normalized = name.to_lowercase();
    let connection = open_context(&app, &payload.context)?;
    connection.execute(
        "INSERT INTO library_roles (id,name,normalized_name,sort_order,created_at,updated_at) VALUES (?1,?2,?3,1000,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        params![Uuid::new_v4().to_string(), name, normalized],
    ).map_err(map_sql_error)?;
    sync_context(&app, &payload.context)?;
    list_roles(&connection)
}

#[tauri::command]
pub fn list_library_users(
    app: AppHandle,
    payload: LibraryDatabaseContext,
) -> CommandResult<Vec<LibraryUserDto>> {
    list_users(&open_context(&app, &payload)?)
}

#[tauri::command]
pub fn create_library_user(
    app: AppHandle,
    payload: CreateLibraryUserPayload,
) -> CommandResult<Vec<LibraryUserDto>> {
    let name = normalize_name(&payload.name, "usuario")?;
    if payload.role_id.trim().is_empty() {
        return Err(error("invalid_role", "Elegí un rol existente."));
    }
    let connection = open_context(&app, &payload.context)?;
    let inserted = connection.execute(
        "INSERT INTO library_users (id,name,normalized_name,role_id,password_hash,created_at,updated_at)
         SELECT ?1,?2,?3,id,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM library_roles WHERE id=?4",
        params![Uuid::new_v4().to_string(), name, name.to_lowercase(), payload.role_id.trim()],
    ).map_err(map_sql_error)?;
    if inserted == 0 {
        return Err(error(
            "invalid_role",
            "El rol seleccionado no existe en esta biblioteca.",
        ));
    }
    sync_context(&app, &payload.context)?;
    list_users(&connection)
}

#[tauri::command]
pub fn update_library_user_password(
    app: AppHandle,
    state: tauri::State<'_, crate::task_manager_publication::TaskManagerPublicationState>,
    payload: UpdateLibraryUserPasswordPayload,
) -> CommandResult<Vec<LibraryUserDto>> {
    let hash =
        hash_password(&payload.password).map_err(|message| error("invalid_password", message))?;
    let connection = open_context(&app, &payload.context)?;
    let updated = connection
        .execute(
            "UPDATE library_users SET password_hash=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![hash, payload.user_id.trim()],
        )
        .map_err(map_sql_error)?;
    if updated == 0 {
        return Err(error(
            "not_found",
            "El usuario no existe en esta biblioteca.",
        ));
    }
    crate::task_manager_publication::revoke_library_user_sessions(&state, payload.user_id.trim());
    sync_context(&app, &payload.context)?;
    list_users(&connection)
}

#[tauri::command]
pub fn delete_library_user(
    app: AppHandle,
    state: tauri::State<'_, crate::task_manager_publication::TaskManagerPublicationState>,
    payload: LibraryUserIdPayload,
) -> CommandResult<Vec<LibraryUserDto>> {
    if payload.user_id == OWNER_USER_ID {
        return Err(error(
            "protected_user",
            "El usuario Owner no se puede eliminar.",
        ));
    }
    let connection = open_context(&app, &payload.context)?;
    let deleted = connection
        .execute(
            "DELETE FROM library_users WHERE id=?1",
            params![payload.user_id.trim()],
        )
        .map_err(map_sql_error)?;
    if deleted == 0 {
        return Err(error(
            "not_found",
            "El usuario no existe en esta biblioteca.",
        ));
    }
    crate::task_manager_publication::revoke_library_user_sessions(&state, payload.user_id.trim());
    sync_context(&app, &payload.context)?;
    list_users(&connection)
}

#[tauri::command]
pub fn update_library_user_name(
    app: AppHandle,
    payload: UpdateLibraryUserNamePayload,
) -> CommandResult<Vec<LibraryUserDto>> {
    let name = normalize_name(&payload.name, "usuario")?;
    let connection = open_context(&app, &payload.context)?;
    let updated = connection.execute(
        "UPDATE library_users SET name=?1, normalized_name=?2, updated_at=CURRENT_TIMESTAMP WHERE id=?3",
        params![name, name.to_lowercase(), payload.user_id.trim()],
    ).map_err(map_sql_error)?;
    if updated == 0 {
        return Err(error(
            "not_found",
            "El usuario no existe en esta biblioteca.",
        ));
    }
    sync_context(&app, &payload.context)?;
    list_users(&connection)
}

#[tauri::command]
pub fn update_library_user_role(
    app: AppHandle,
    payload: UpdateLibraryUserRolePayload,
) -> CommandResult<Vec<LibraryUserDto>> {
    if payload.user_id == OWNER_USER_ID && payload.role_id != OWNER_ROLE_ID {
        return Err(error(
            "protected_user",
            "El usuario Owner debe conservar el rol Owner.",
        ));
    }
    let connection = open_context(&app, &payload.context)?;
    let updated = connection.execute(
        "UPDATE library_users SET role_id=(SELECT id FROM library_roles WHERE id=?1), updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND EXISTS (SELECT 1 FROM library_roles WHERE id=?1)",
        params![payload.role_id.trim(), payload.user_id.trim()],
    ).map_err(map_sql_error)?;
    if updated == 0 {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_users WHERE id=?1)",
                params![payload.user_id.trim()],
                |row| row.get(0),
            )
            .map_err(map_sql_error)?;
        return Err(if exists {
            error(
                "invalid_role",
                "El rol seleccionado no existe en esta biblioteca.",
            )
        } else {
            error("not_found", "El usuario no existe en esta biblioteca.")
        });
    }
    sync_context(&app, &payload.context)?;
    list_users(&connection)
}

#[tauri::command]
pub fn resolve_library_telegram_user(
    app: AppHandle,
    payload: ResolveTelegramUserPayload,
) -> CommandResult<Option<LibraryUserDto>> {
    if payload.telegram_user_id <= 0 || payload.telegram_chat_id <= 0 {
        return Err(error(
            "invalid_identity",
            "La identidad de Telegram no es válida.",
        ));
    }
    let connection = open_context(&app, &payload.context)?;
    connection.query_row(
        "SELECT u.id, u.name, u.role_id, r.name, u.password_hash IS NOT NULL, u.telegram_user_id IS NOT NULL
         FROM library_users u JOIN library_roles r ON r.id=u.role_id WHERE u.telegram_user_id=?1 AND u.telegram_chat_id=?2",
        params![payload.telegram_user_id, payload.telegram_chat_id],
        |row| Ok(LibraryUserDto { id: row.get(0)?, name: row.get(1)?, role_id: row.get(2)?, role_name: row.get(3)?, password_configured: row.get(4)?, telegram_linked: row.get(5)? }),
    ).optional().map_err(map_sql_error)
}

#[tauri::command]
pub fn find_library_user(
    app: AppHandle,
    payload: FindLibraryUserPayload,
) -> CommandResult<Option<LibraryUserDto>> {
    let name = normalize_name(&payload.name, "usuario")?;
    let connection = open_context(&app, &payload.context)?;
    connection.query_row(
        "SELECT u.id, u.name, u.role_id, r.name, u.password_hash IS NOT NULL, u.telegram_user_id IS NOT NULL
         FROM library_users u JOIN library_roles r ON r.id=u.role_id WHERE u.normalized_name=?1",
        params![name.to_lowercase()],
        |row| Ok(LibraryUserDto { id: row.get(0)?, name: row.get(1)?, role_id: row.get(2)?, role_name: row.get(3)?, password_configured: row.get(4)?, telegram_linked: row.get(5)? }),
    ).optional().map_err(map_sql_error)
}

#[tauri::command]
pub fn link_library_user_telegram(
    app: AppHandle,
    payload: LinkTelegramPayload,
) -> CommandResult<LibraryUserDto> {
    if payload.telegram_user_id <= 0 || payload.telegram_chat_id <= 0 {
        return Err(error(
            "invalid_identity",
            "La identidad de Telegram no es válida.",
        ));
    }
    let connection = open_context(&app, &payload.context)?;
    let transaction = connection.unchecked_transaction().map_err(map_sql_error)?;
    let existing_hash = read_existing_password_hash(&transaction, &payload.user_id)?;
    if existing_hash.is_none() {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_users WHERE id=?1)",
                params![payload.user_id.trim()],
                |row| row.get(0),
            )
            .map_err(map_sql_error)?;
        if !exists {
            return Err(error(
                "not_found",
                "El usuario no existe en esta biblioteca.",
            ));
        }
    }
    if let Some(hash) = existing_hash.as_deref() {
        if !verify_password(&payload.password, hash) {
            return Err(error(
                "invalid_credentials",
                "No se pudo verificar la contraseña.",
            ));
        }
    } else {
        let hash = hash_password(&payload.password)
            .map_err(|message| error("invalid_password", message))?;
        transaction
            .execute(
                "UPDATE library_users SET password_hash=?1 WHERE id=?2",
                params![hash, payload.user_id.trim()],
            )
            .map_err(map_sql_error)?;
    }
    let updated = transaction.execute(
        "UPDATE library_users SET telegram_user_id=?1, telegram_chat_id=?2, updated_at=CURRENT_TIMESTAMP
         WHERE id=?3 AND NOT EXISTS (SELECT 1 FROM library_users WHERE telegram_user_id=?1 AND id<>?3)",
        params![payload.telegram_user_id, payload.telegram_chat_id, payload.user_id.trim()],
    ).map_err(map_sql_error)?;
    if updated == 0 {
        return Err(error(
            "duplicate",
            "La cuenta de Telegram ya está asociada a otro usuario.",
        ));
    }
    transaction.commit().map_err(map_sql_error)?;
    sync_context(&app, &payload.context)?;
    list_users(&connection)?
        .into_iter()
        .find(|user| user.id == payload.user_id.trim())
        .ok_or_else(|| storage_error("No se pudo leer el usuario actualizado."))
}

#[tauri::command]
pub fn unlink_library_user_telegram(
    app: AppHandle,
    payload: LibraryUserIdPayload,
) -> CommandResult<Vec<LibraryUserDto>> {
    let connection = open_context(&app, &payload.context)?;
    let updated = connection.execute("UPDATE library_users SET telegram_user_id=NULL, telegram_chat_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?1", params![payload.user_id.trim()]).map_err(map_sql_error)?;
    if updated == 0 {
        return Err(error(
            "not_found",
            "El usuario no existe en esta biblioteca.",
        ));
    }
    sync_context(&app, &payload.context)?;
    list_users(&connection)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{normalize_name, read_existing_password_hash};

    #[test]
    fn names_are_trimmed_and_empty_names_are_rejected() {
        assert_eq!(normalize_name("  Ana  ", "usuario").expect("name"), "Ana");
        assert!(normalize_name("   ", "usuario").is_err());
    }

    #[test]
    fn new_users_with_null_password_hash_can_start_telegram_linking() {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute(
                "CREATE TABLE library_users (id TEXT PRIMARY KEY, password_hash TEXT)",
                [],
            )
            .expect("schema");
        connection
            .execute(
                "INSERT INTO library_users (id, password_hash) VALUES ('user-1', NULL)",
                [],
            )
            .expect("user");

        let transaction = connection.unchecked_transaction().expect("transaction");
        assert!(read_existing_password_hash(&transaction, "user-1")
            .expect("password hash")
            .is_none());
    }
}
