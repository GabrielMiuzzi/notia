//! Rutinas: lee el catálogo de `Gym/` (ejercicios y equipamiento en
//! Markdown, videos y el cuerpo en SVG) y guarda en la base de la
//! biblioteca, por usuario, las rutinas, la sesión en curso, el historial y
//! el equipamiento con el que cuenta. Qué se valida, qué se escribe y qué se
//! muestra lo decide el núcleo (`backend_core::gym`).

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::backend::gym::body::{body_file, parse_body_svg, BodyView};
use crate::backend::gym::change::{
    apply_exercise_edit, new_exercise, plan_change, saved_equipment, CatalogMutation, Clock, GymMutation, StoreOp,
};
use crate::backend::gym::markdown::{parse_equipment, parse_exercise, render_equipment, render_exercise};
use crate::backend::gym::view::{build_view, exercise_detail, ExerciseDetail, GymQuery, GymView};
use crate::backend::gym::tools::{action_summary, apply_patch, read_tool, tool_action, GymToolAction};
use crate::recipes::MessageImage;
use crate::backend::gym::{
    file_stem, fold, BodySex, Catalog, Equipment, Exercise, GymData, GymError, GymErrorCode, Routine, Session, Workout, EQUIPMENT_FOLDER,
    EXERCISES_FOLDER, GYM_FOLDER,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Emitter, Manager};
use crate::library_registry::{LibraryBindingRegistry, LibraryBindingRoot};

/// Rust avisa con el id de la biblioteca cuando cambian los datos o el catálogo de Rutinas.
pub(crate) const GYM_CHANGED_EVENT: &str = "notia://gym-changed";
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Un video o una imagen subidos a la ficha.
const MAX_MEDIA_BYTES: usize = 32 * 1024 * 1024;
const MAX_GIF_BYTES: usize = 6 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Errores y contexto
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GymCommandErrorCode {
    Validation,
    NotFound,
    Storage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GymCommandError {
    pub code: GymCommandErrorCode,
    pub message: String,
}

impl GymCommandError {
    fn new(code: GymCommandErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    fn storage(message: impl Into<String>) -> Self {
        Self::new(GymCommandErrorCode::Storage, message)
    }

    fn validation(message: impl Into<String>) -> Self {
        Self::new(GymCommandErrorCode::Validation, message)
    }
}

impl From<GymError> for GymCommandError {
    fn from(error: GymError) -> Self {
        let code = match error.code {
            GymErrorCode::Validation => GymCommandErrorCode::Validation,
            GymErrorCode::NotFound => GymCommandErrorCode::NotFound,
        };
        Self::new(code, error.message)
    }
}

impl From<rusqlite::Error> for GymCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::storage(format!("No se pudo acceder a los datos de Rutinas: {error}"))
    }
}

impl From<BackendError> for GymCommandError {
    fn from(error: BackendError) -> Self {
        let code = match error.code {
            BackendErrorCode::NotFound => GymCommandErrorCode::NotFound,
            BackendErrorCode::InvalidInput => GymCommandErrorCode::Validation,
            _ => GymCommandErrorCode::Storage,
        };
        Self::new(code, error.message)
    }
}

impl From<crate::recipes::RecipesError> for GymCommandError {
    fn from(error: crate::recipes::RecipesError) -> Self {
        Self::validation(error.message)
    }
}

pub type GymCommandResult<T> = Result<T, GymCommandError>;

/// Biblioteca y usuario de una operación: cada uno ve solo lo suyo.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GymContext {
    pub library_id: String,
    pub actor_library_user_id: String,
}

impl GymContext {
    fn owner(&self) -> &str {
        self.actor_library_user_id.trim()
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or_default()
}

/// La fecha local del equipo.
fn local_today() -> (jiff::civil::Date, String) {
    let text = chrono::Local::now().format("%Y-%m-%d").to_string();
    let date = crate::backend::gym::parse_date(&text).unwrap_or(jiff::civil::date(1970, 1, 1));
    (date, text)
}

fn changed(app: &AppHandle, library_id: &str) {
    let _ = app.emit(GYM_CHANGED_EVENT, library_id);
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> GymCommandResult<T> + Send + 'static) -> GymCommandResult<T> {
    crate::host::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| GymCommandError::storage("No se pudo acceder a los datos de Rutinas."))?
}

// ---------------------------------------------------------------------------
// Catálogo: archivos de `Gym/`
// ---------------------------------------------------------------------------

/// Un archivo de una carpeta del catálogo, con lo que dice si cambió.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct FileStamp {
    path: String,
    size: u64,
    modified: i64,
}

fn visible_markdown(name: &str) -> bool {
    !name.starts_with('.') && !name.starts_with('_') && name.to_ascii_lowercase().ends_with(".md")
}

/// Los `.md` de una carpeta, leídos ahora (no del índice, que puede atrasar).
fn folder_files(app: &AppHandle, library_id: &str, folder: &str) -> GymCommandResult<Vec<FileStamp>> {
    let binding = app.state::<LibraryBindingRegistry>().lookup(library_id)?;
    let mut files = match &binding.root {
        Some(LibraryBindingRoot::Desktop { canonical_root }) => {
            let Ok(entries) = std::fs::read_dir(canonical_root.join(folder)) else {
                return Ok(Vec::new());
            };
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let metadata = entry.metadata().ok().filter(|metadata| metadata.is_file())?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|elapsed| elapsed.as_millis() as i64)
                        .unwrap_or_default();
                    visible_markdown(&name).then(|| FileStamp { path: format!("{folder}/{name}"), size: metadata.len(), modified })
                })
                .collect::<Vec<_>>()
        }
        Some(LibraryBindingRoot::Android { tree_uri }) => android_folder_files(app, tree_uri.as_str(), folder)?,
        None => return Err(GymCommandError::storage("La biblioteca no está disponible.")),
    };
    files.sort();
    Ok(files)
}

#[cfg(target_os = "android")]
fn android_folder_files(app: &AppHandle, tree_uri: &str, folder: &str) -> GymCommandResult<Vec<FileStamp>> {
    let picker = app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>();
    let entries = crate::mobile_directory_picker::read_android_flat_entries(picker.inner(), tree_uri)
        .map_err(|_| GymCommandError::storage("No se pudo leer la biblioteca Android; volvé a autorizar la carpeta."))?;
    let prefix = format!("{folder}/");
    Ok(entries
        .into_iter()
        .filter(|entry| entry.node_type != "folder")
        .filter_map(|entry| {
            let path = entry.path.trim_start_matches('/').to_string();
            let name = path.strip_prefix(&prefix)?.to_string();
            (!name.contains('/') && visible_markdown(&name)).then(|| FileStamp {
                path,
                size: entry.size.unwrap_or_default(),
                modified: entry.last_modified.unwrap_or_default(),
            })
        })
        .collect())
}

#[cfg(not(target_os = "android"))]
fn android_folder_files(_app: &AppHandle, _tree_uri: &str, _folder: &str) -> GymCommandResult<Vec<FileStamp>> {
    Err(GymCommandError::storage("La biblioteca no está disponible."))
}

/// El catálogo leído de cada biblioteca, con la lista de archivos de la que
/// salió: se vuelve a leer cuando cambia un archivo.
type CatalogCache = Mutex<HashMap<String, (Vec<FileStamp>, Arc<Catalog>)>>;

fn catalog_cache() -> &'static CatalogCache {
    static CACHE: OnceLock<CatalogCache> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn forget_catalog(library_id: &str) {
    if let Ok(mut cache) = catalog_cache().lock() {
        cache.remove(library_id);
    }
}

/// El catálogo sin imágenes, para las listas.
pub(crate) fn load_catalog(app: &AppHandle, library_id: &str) -> GymCommandResult<Arc<Catalog>> {
    let mut stamps = folder_files(app, library_id, EXERCISES_FOLDER)?;
    stamps.extend(folder_files(app, library_id, EQUIPMENT_FOLDER)?);
    if let Some((cached, catalog)) = catalog_cache().lock().ok().and_then(|cache| cache.get(library_id).cloned()) {
        if cached == stamps {
            return Ok(catalog);
        }
    }
    let catalog = crate::library_documents::with_documents(app, library_id, |documents| {
        let mut catalog = Catalog::default();
        for stamp in &stamps {
            // Un archivo que no se puede leer o que no es del catálogo queda afuera.
            let Ok(Some(text)) = documents.read(&stamp.path) else { continue };
            if stamp.path.starts_with(EXERCISES_FOLDER) {
                catalog.exercises.extend(parse_exercise(&stamp.path, &text, false));
            } else {
                catalog.equipment.extend(parse_equipment(&stamp.path, &text, false));
            }
        }
        catalog.exercises.sort_by_cached_key(|exercise| fold(&exercise.name));
        // Un id repetido (un archivo copiado) cuenta una sola vez.
        let mut seen = std::collections::BTreeSet::new();
        catalog.exercises.retain(|exercise| seen.insert(exercise.id.clone()));
        let mut seen = std::collections::BTreeSet::new();
        catalog.equipment.retain(|item| seen.insert(item.id.clone()));
        Ok(catalog)
    })?;
    let catalog = Arc::new(catalog);
    if let Ok(mut cache) = catalog_cache().lock() {
        cache.insert(library_id.to_string(), (stamps, Arc::clone(&catalog)));
    }
    Ok(catalog)
}

/// Un ejercicio con su imagen, leído de su archivo.
fn full_exercise(app: &AppHandle, library_id: &str, catalog: &Catalog, id: &str) -> GymCommandResult<Exercise> {
    let path = catalog.exercise(id).map(|exercise| exercise.path.clone()).ok_or_else(|| GymCommandError::new(GymCommandErrorCode::NotFound, "El ejercicio ya no está en Gym/exercises."))?;
    let text = crate::library_documents::with_documents(app, library_id, |documents| documents.read(&path))?
        .ok_or_else(|| GymCommandError::new(GymCommandErrorCode::NotFound, "El ejercicio ya no está en Gym/exercises."))?;
    parse_exercise(&path, &text, true).ok_or_else(|| GymCommandError::validation("El archivo del ejercicio no tiene el formato de Rutinas."))
}

fn full_equipment(app: &AppHandle, library_id: &str, catalog: &Catalog, id: &str) -> GymCommandResult<Equipment> {
    let path = catalog.equipment(id).map(|item| item.path.clone()).ok_or_else(|| GymCommandError::new(GymCommandErrorCode::NotFound, "El equipamiento ya no está en Gym/equipment."))?;
    let text = crate::library_documents::with_documents(app, library_id, |documents| documents.read(&path))?
        .ok_or_else(|| GymCommandError::new(GymCommandErrorCode::NotFound, "El equipamiento ya no está en Gym/equipment."))?;
    parse_equipment(&path, &text, true).ok_or_else(|| GymCommandError::validation("El archivo del equipamiento no tiene el formato de Rutinas."))
}

/// Una ruta libre en `folder` para un nombre: `Nombre.md`, `Nombre 2.md`…
fn free_path(catalog_paths: &[String], folder: &str, name: &str, current: Option<&str>) -> String {
    let stem = file_stem(name);
    let taken = |path: &str| catalog_paths.iter().any(|existing| existing.eq_ignore_ascii_case(path) && Some(existing.as_str()) != current);
    let mut path = format!("{folder}/{stem}.md");
    let mut number = 2;
    while taken(&path) {
        path = format!("{folder}/{stem} {number}.md");
        number += 1;
    }
    path
}

/// Escribe un archivo del catálogo; si cambió de nombre, lo mueve.
fn write_catalog_file(app: &AppHandle, library_id: &str, old_path: Option<&str>, path: &str, content: &str) -> GymCommandResult<()> {
    crate::library_documents::with_documents(app, library_id, |documents| {
        documents.adapter.upsert_text_locator(&documents.locator(path)?, content)?;
        if let Some(old) = old_path.filter(|old| !old.eq_ignore_ascii_case(path)) {
            documents.adapter.delete_locator(&documents.locator(old)?)?;
        }
        Ok(())
    })?;
    forget_catalog(library_id);
    Ok(())
}

/// La foto de un equipamiento o la imagen de un ejercicio, como `data:`
/// JPEG reducido (los GIF se guardan como vienen, para que se muevan).
fn image_data_uri(base64_data: &str, media_type: &str) -> GymCommandResult<String> {
    let raw = base64_data.trim();
    let raw = raw.split_once(";base64,").map(|(_, data)| data).unwrap_or(raw);
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_| GymCommandError::validation("La imagen no se pudo leer."))?;
    if media_type.eq_ignore_ascii_case("image/gif") {
        if bytes.len() > MAX_GIF_BYTES {
            return Err(GymCommandError::validation("El GIF tiene que pesar menos de 6 MB."));
        }
        return Ok(format!("data:image/gif;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
    }
    Ok(crate::recipes::prepare_photo(&bytes)?.data_uri())
}

fn video_extension(media_type: &str) -> Option<&'static str> {
    match media_type.to_ascii_lowercase().as_str() {
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "video/quicktime" => Some("mov"),
        _ => None,
    }
}

fn video_media_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "video/mp4",
    }
}

fn video_path(exercise: &Exercise, video: &str) -> String {
    let folder = exercise.path.rsplit_once('/').map(|(folder, _)| folder).unwrap_or(EXERCISES_FOLDER);
    format!("{folder}/{video}")
}

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

struct Location {
    library_path: String,
    android_directory_uri: Option<String>,
}

fn location(app: &AppHandle, library_id: &str) -> GymCommandResult<Location> {
    let binding = app.state::<LibraryBindingRegistry>().lookup(library_id)?;
    match binding.root {
        Some(LibraryBindingRoot::Desktop { canonical_root }) => {
            Ok(Location { library_path: canonical_root.to_string_lossy().to_string(), android_directory_uri: None })
        }
        Some(LibraryBindingRoot::Android { tree_uri }) => {
            Ok(Location { library_path: String::new(), android_directory_uri: Some(tree_uri.as_str().to_string()) })
        }
        None => Err(GymCommandError::storage("La biblioteca no está disponible.")),
    }
}

fn open(app: &AppHandle, context: &GymContext, location: &Location) -> GymCommandResult<Connection> {
    if context.owner().is_empty() {
        return Err(GymCommandError::validation("El usuario de la biblioteca es obligatorio para Rutinas."));
    }
    let connection = crate::database::open_user_data_connection(app, &location.library_path, location.android_directory_uri.as_deref())
        .map_err(GymCommandError::storage)?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM library_users WHERE id = ?1)", [context.owner()], |row| row.get(0))?;
    if !exists {
        return Err(GymCommandError::validation("El usuario de la biblioteca no está autorizado para Rutinas."));
    }
    Ok(connection)
}

fn corrupt(what: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidColumnType(0, what.to_string(), rusqlite::types::Type::Text)
}

fn from_json<T: serde::de::DeserializeOwned>(text: &str, what: &str) -> rusqlite::Result<T> {
    serde_json::from_str(text).map_err(|_| corrupt(what))
}

fn to_json<T: Serialize>(value: &T) -> rusqlite::Result<String> {
    serde_json::to_string(value).map_err(|_| corrupt("json"))
}

pub(crate) fn load(connection: &Connection, owner: &str) -> GymCommandResult<GymData> {
    let settings = connection
        .query_row("SELECT owned_json, session_json FROM gym_settings WHERE owner_user_id = ?1", [owner], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .optional()?;
    let (owned, session) = match settings {
        Some((owned, session)) => (
            from_json::<Vec<String>>(&owned, "owned_json")?,
            session.map(|text| from_json::<Session>(&text, "session_json")).transpose()?,
        ),
        None => (Vec::new(), None),
    };
    let routines = connection
        .prepare("SELECT routine_json FROM gym_routines WHERE owner_user_id = ?1 ORDER BY position, id")?
        .query_map([owner], |row| from_json::<Routine>(&row.get::<_, String>(0)?, "routine_json"))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let workouts = connection
        .prepare("SELECT workout_json FROM gym_workouts WHERE owner_user_id = ?1 ORDER BY date, ended_at")?
        .query_map([owner], |row| from_json::<Workout>(&row.get::<_, String>(0)?, "workout_json"))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // El cuerpo que se muestra sale del perfil de Salud.
    let sex = crate::health::load(connection, owner).ok().and_then(|health| health.profile).map(|profile| profile.sex);
    Ok(GymData {
        routines,
        workouts,
        owned: owned.into_iter().collect(),
        session,
        sex: if sex == Some(crate::backend::health::Sex::Female) { BodySex::Female } else { BodySex::Male },
        sex_from_profile: sex.is_some(),
    })
}

fn ensure_settings(connection: &Connection, owner: &str) -> rusqlite::Result<()> {
    connection.execute("INSERT OR IGNORE INTO gym_settings (owner_user_id, updated_at) VALUES (?1, ?2)", params![owner, now_ms()])?;
    Ok(())
}

fn apply_ops(connection: &Connection, owner: &str, ops: &[StoreOp]) -> GymCommandResult<()> {
    let now = now_ms();
    for op in ops {
        match op {
            StoreOp::PutRoutine(routine) => {
                connection.execute(
                    "INSERT INTO gym_routines (id, owner_user_id, position, routine_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET position = excluded.position, routine_json = excluded.routine_json,
                         updated_at = excluded.updated_at
                     WHERE gym_routines.owner_user_id = excluded.owner_user_id",
                    params![routine.id, owner, routine.position, to_json(routine)?, now],
                )?;
            }
            StoreOp::DeleteRoutine(id) => {
                connection.execute("DELETE FROM gym_routines WHERE owner_user_id = ?1 AND id = ?2", params![owner, id])?;
            }
            StoreOp::PutOwned(owned) => {
                ensure_settings(connection, owner)?;
                connection.execute(
                    "UPDATE gym_settings SET owned_json = ?2, updated_at = ?3 WHERE owner_user_id = ?1",
                    params![owner, to_json(owned)?, now],
                )?;
            }
            StoreOp::PutSession(session) => {
                ensure_settings(connection, owner)?;
                let session = session.as_ref().map(to_json).transpose()?;
                connection.execute(
                    "UPDATE gym_settings SET session_json = ?2, updated_at = ?3 WHERE owner_user_id = ?1",
                    params![owner, session, now],
                )?;
            }
            StoreOp::PutWorkout(workout) => {
                connection.execute(
                    "INSERT INTO gym_workouts (id, owner_user_id, date, ended_at, workout_json) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO NOTHING",
                    params![workout.id, owner, workout.date, workout.ended_ms, to_json(workout)?],
                )?;
            }
            StoreOp::DeleteWorkout(id) => {
                connection.execute("DELETE FROM gym_workouts WHERE owner_user_id = ?1 AND id = ?2", params![owner, id])?;
            }
        }
    }
    Ok(())
}

fn read<T>(app: &AppHandle, context: &GymContext, work: impl FnOnce(&GymData) -> GymCommandResult<T>) -> GymCommandResult<T> {
    let location = location(app, &context.library_id)?;
    let connection = open(app, context, &location)?;
    work(&load(&connection, context.owner())?)
}

/// Aplica un cambio en una transacción y lo guarda (en Android, de vuelta
/// por SAF).
fn write(app: &AppHandle, context: &GymContext, mutation: &GymMutation, catalog: &Catalog) -> GymCommandResult<Option<String>> {
    let location = location(app, &context.library_id)?;
    let mut connection = open(app, context, &location)?;
    let transaction = connection.transaction()?;
    let data = load(&transaction, context.owner())?;
    let (_, today) = local_today();
    let mut new_id = || Uuid::new_v4().to_string();
    let mut clock = Clock { now_ms: now_ms(), today, new_id: &mut new_id };
    let change = plan_change(&data, catalog, mutation, &mut clock)?;
    apply_ops(&transaction, context.owner(), &change.ops)?;
    transaction.commit()?;
    drop(connection);
    crate::database::sync_user_data_connection(app, location.android_directory_uri.as_deref()).map_err(GymCommandError::storage)?;
    changed(app, &context.library_id);
    Ok(change.routine_id)
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

fn view(app: &AppHandle, context: &GymContext, query: &GymQuery) -> GymCommandResult<GymView> {
    let catalog = load_catalog(app, &context.library_id)?;
    let (today, _) = local_today();
    read(app, context, |data| Ok(build_view(data, &catalog, query, today, now_ms())))
}

pub async fn gym_view(app: AppHandle, context: GymContext, query: Option<GymQuery>) -> GymCommandResult<GymView> {
    blocking(move || view(&app, &context, &query.unwrap_or_default())).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GymApplyResult {
    pub view: GymView,
    /// La rutina que la pantalla muestra después (una creada o duplicada).
    pub routine_id: Option<String>,
}

/// Aplica un cambio de la pantalla y devuelve la vista actualizada.
pub async fn gym_apply(app: AppHandle, context: GymContext, mutation: GymMutation, query: Option<GymQuery>) -> GymCommandResult<GymApplyResult> {
    blocking(move || {
        let catalog = load_catalog(&app, &context.library_id)?;
        let routine_id = write(&app, &context, &mutation, &catalog)?;
        let mut query = query.unwrap_or_default();
        if routine_id.is_some() {
            query.routine_id = routine_id.clone();
        }
        Ok(GymApplyResult { view: view(&app, &context, &query)?, routine_id })
    })
    .await
}

fn detail(app: &AppHandle, context: &GymContext, catalog: &Catalog, exercise_id: &str) -> GymCommandResult<ExerciseDetail> {
    let exercise = full_exercise(app, &context.library_id, catalog, exercise_id)?;
    read(app, context, |data| Ok(exercise_detail(&exercise, catalog, data)))
}

/// La ficha de un ejercicio, con su imagen.
pub async fn gym_exercise(app: AppHandle, context: GymContext, exercise_id: String) -> GymCommandResult<ExerciseDetail> {
    blocking(move || {
        let catalog = load_catalog(&app, &context.library_id)?;
        detail(&app, &context, &catalog, &exercise_id)
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResult {
    pub exercise: Option<ExerciseDetail>,
    pub equipment_id: Option<String>,
}

/// Una imagen enviada por la pantalla.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInput {
    pub media_type: String,
    pub base64: String,
}

fn catalog_paths(catalog: &Catalog) -> Vec<String> {
    catalog.exercises.iter().map(|exercise| exercise.path.clone()).chain(catalog.equipment.iter().map(|item| item.path.clone())).collect()
}

fn apply_catalog(app: &AppHandle, context: &GymContext, mutation: &CatalogMutation, photo: Option<&MediaInput>) -> GymCommandResult<CatalogResult> {
    let library_id = context.library_id.as_str();
    location(app, library_id)?;
    let catalog = load_catalog(app, library_id)?;
    let paths = catalog_paths(&catalog);
    let result = match mutation {
        CatalogMutation::CreateExercise { group } => {
            let exercise = new_exercise(group.as_deref(), &catalog, |name| free_path(&paths, EXERCISES_FOLDER, name, None));
            write_catalog_file(app, library_id, None, &exercise.path, &render_exercise(&exercise))?;
            let catalog = load_catalog(app, library_id)?;
            CatalogResult { exercise: Some(detail(app, context, &catalog, &exercise.id)?), equipment_id: None }
        }
        CatalogMutation::UpdateExercise { exercise_id, edit } => {
            let mut exercise = full_exercise(app, library_id, &catalog, exercise_id)?;
            let old_path = exercise.path.clone();
            let old_video = exercise.video.clone();
            apply_exercise_edit(&mut exercise, edit, &catalog)?;
            exercise.path = free_path(&paths, EXERCISES_FOLDER, &exercise.name, Some(&old_path));
            write_catalog_file(app, library_id, Some(&old_path), &exercise.path, &render_exercise(&exercise))?;
            // Quitar la demostración también borra el video.
            if let (Some(video), None) = (&old_video, &exercise.video) {
                let video = video_path(&exercise, video);
                let _ = crate::library_documents::with_documents(app, library_id, |documents| documents.adapter.delete_locator(&documents.locator(&video)?));
            }
            let catalog = load_catalog(app, library_id)?;
            CatalogResult { exercise: Some(detail(app, context, &catalog, &exercise.id)?), equipment_id: None }
        }
        CatalogMutation::SaveEquipment { equipment_id, name, category } => {
            let existing = equipment_id.as_deref().map(|id| full_equipment(app, library_id, &catalog, id)).transpose()?;
            let mut item = saved_equipment(existing.as_ref(), name, category, &catalog, |name| free_path(&paths, EQUIPMENT_FOLDER, name, None))?;
            if let Some(photo) = photo {
                item.image = Some(image_data_uri(&photo.base64, &photo.media_type)?);
            }
            let old_path = existing.as_ref().map(|existing| existing.path.clone());
            if existing.is_some() {
                item.path = free_path(&paths, EQUIPMENT_FOLDER, &item.name, old_path.as_deref());
            }
            write_catalog_file(app, library_id, old_path.as_deref(), &item.path, &render_equipment(&item))?;
            // Lo agregado queda marcado como disponible.
            if existing.is_none() {
                let catalog = load_catalog(app, library_id)?;
                write(app, context, &GymMutation::ToggleEquipment { equipment_id: item.id.clone() }, &catalog)?;
            }
            CatalogResult { exercise: None, equipment_id: Some(item.id) }
        }
        CatalogMutation::DeleteEquipment { equipment_id } => {
            let item = catalog.equipment(equipment_id).ok_or_else(|| GymCommandError::new(GymCommandErrorCode::NotFound, "El equipamiento ya no existe."))?;
            if !item.custom {
                return Err(GymCommandError::validation("El equipamiento del catálogo no se quita: desmarcalo si no lo tenés."));
            }
            let path = item.path.clone();
            crate::library_documents::with_documents(app, library_id, |documents| documents.adapter.delete_locator(&documents.locator(&path)?))?;
            forget_catalog(library_id);
            CatalogResult { exercise: None, equipment_id: None }
        }
    };
    changed(app, library_id);
    Ok(result)
}

/// Un cambio del catálogo: la ficha de un ejercicio o el equipamiento propio.
pub async fn gym_catalog_apply(app: AppHandle, context: GymContext, mutation: CatalogMutation, photo: Option<MediaInput>) -> GymCommandResult<CatalogResult> {
    blocking(move || apply_catalog(&app, &context, &mutation, photo.as_ref())).await
}

/// La demostración de la ficha: un video queda al lado del `.md`; una
/// imagen o un GIF, dentro del archivo.
pub async fn gym_set_media(app: AppHandle, context: GymContext, exercise_id: String, media: MediaInput) -> GymCommandResult<ExerciseDetail> {
    blocking(move || {
        let library_id = context.library_id.as_str();
        let catalog = load_catalog(&app, library_id)?;
        let mut exercise = full_exercise(&app, library_id, &catalog, &exercise_id)?;
        if let Some(extension) = video_extension(&media.media_type) {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(media.base64.trim())
                .map_err(|_| GymCommandError::validation("El video no se pudo leer."))?;
            if bytes.is_empty() || bytes.len() > MAX_MEDIA_BYTES {
                return Err(GymCommandError::validation("El video tiene que pesar menos de 32 MB."));
            }
            let stem = exercise.path.rsplit('/').next().and_then(|name| name.strip_suffix(".md")).unwrap_or("video").to_string();
            let video = format!("{stem}.{extension}");
            let path = video_path(&exercise, &video);
            crate::library_documents::with_documents(&app, library_id, |documents| documents.adapter.write_binary_locator(&documents.locator(&path)?, &bytes))?;
            exercise.video = Some(video);
        } else if media.media_type.to_ascii_lowercase().starts_with("image/") {
            exercise.image = Some(image_data_uri(&media.base64, &media.media_type)?);
        } else {
            return Err(GymCommandError::validation("Subí un video MP4, WEBM o MOV, un GIF o una imagen PNG, JPG o WEBP."));
        }
        let path = exercise.path.clone();
        write_catalog_file(&app, library_id, None, &path, &render_exercise(&exercise))?;
        changed(&app, library_id);
        let catalog = load_catalog(&app, library_id)?;
        detail(&app, &context, &catalog, &exercise_id)
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoData {
    pub media_type: String,
    pub base64: String,
}

/// El video de un ejercicio, si tiene.
pub async fn gym_video(app: AppHandle, context: GymContext, exercise_id: String) -> GymCommandResult<Option<VideoData>> {
    blocking(move || {
        let library_id = context.library_id.as_str();
        location(&app, library_id)?;
        let catalog = load_catalog(&app, library_id)?;
        let Some(exercise) = catalog.exercise(&exercise_id) else { return Ok(None) };
        let Some(video) = exercise.video.clone() else { return Ok(None) };
        let path = video_path(exercise, &video);
        let bytes = crate::library_documents::with_documents(&app, library_id, |documents| {
            let locator = documents.locator(&path)?;
            if !documents.adapter.exists_locator(&locator)? {
                return Ok(None);
            }
            documents.adapter.read_binary_locator(&locator).map(Some)
        })?;
        Ok(bytes.map(|bytes| VideoData { media_type: video_media_type(&video).to_string(), base64: base64::engine::general_purpose::STANDARD.encode(bytes) }))
    })
    .await
}

/// Las fotos del equipamiento, por id.
pub async fn gym_equipment_images(app: AppHandle, context: GymContext) -> GymCommandResult<BTreeMap<String, String>> {
    blocking(move || {
        let library_id = context.library_id.as_str();
        location(&app, library_id)?;
        let catalog = load_catalog(&app, library_id)?;
        Ok(crate::library_documents::with_documents(&app, library_id, |documents| {
            let mut images = BTreeMap::new();
            for item in catalog.equipment.iter().filter(|item| item.has_image) {
                if let Ok(Some(text)) = documents.read(&item.path) {
                    if let Some(image) = parse_equipment(&item.path, &text, true).and_then(|item| item.image) {
                        images.insert(item.id.clone(), image);
                    }
                }
            }
            Ok(images)
        })?)
    })
    .await
}

/// El cuerpo de frente y de espalda, según el sexo del perfil de Salud.
pub async fn gym_body(app: AppHandle, context: GymContext) -> GymCommandResult<BodyView> {
    blocking(move || {
        let sex = read(&app, &context, |data| Ok(data.sex))?;
        crate::library_documents::with_documents(&app, &context.library_id, |documents| {
            let figure = |back: bool| -> Result<_, BackendError> {
                let path = format!("{GYM_FOLDER}/{}", body_file(sex, back));
                Ok(documents.read(&path)?.and_then(|svg| parse_body_svg(&svg)))
            };
            Ok(BodyView { sex: sex.id().to_string(), front: figure(false)?, back: figure(true)? })
        })
        .map_err(GymCommandError::from)
    })
    .await
}

// ---------------------------------------------------------------------------
// Herramientas del agente
// ---------------------------------------------------------------------------

pub(crate) fn is_gym_tool(name: &str) -> bool {
    crate::backend::gym::tools::is_gym_tool(name)
}

pub(crate) fn is_gym_write_tool(name: &str) -> bool {
    crate::backend::gym::tools::is_gym_write_tool(name)
}

/// El error que recibe el modelo.
pub(crate) fn tool_error(error: GymCommandError) -> BackendError {
    match error.code {
        GymCommandErrorCode::Validation => BackendError::invalid_input(error.message),
        GymCommandErrorCode::NotFound => BackendError::new(BackendErrorCode::NotFound, error.message, false),
        GymCommandErrorCode::Storage => BackendError::new(BackendErrorCode::Storage, error.message, true),
    }
}

/// La llamada resuelta contra los datos y el catálogo; un cambio de los
/// datos del usuario se prueba sin guardar, así el rechazo vuelve al modelo
/// antes de preguntarle a la persona.
fn resolve_tool(data: &GymData, catalog: &Catalog, name: &str, arguments: &serde_json::Value) -> GymCommandResult<GymToolAction> {
    let (today, today_text) = local_today();
    let action = tool_action(name, arguments, data, catalog, today)?;
    if let GymToolAction::Change(mutation) = &action {
        let mut new_id = || Uuid::new_v4().to_string();
        plan_change(data, catalog, mutation, &mut Clock { now_ms: now_ms(), today: today_text, new_id: &mut new_id })?;
    }
    Ok(action)
}

/// La confirmación de una llamada de escritura: qué va a hacer, sin guardar.
pub(crate) fn preview_tool(app: &AppHandle, context: &GymContext, name: &str, arguments: &serde_json::Value) -> GymCommandResult<String> {
    let catalog = load_catalog(app, &context.library_id)?;
    read(app, context, |data| {
        let action = resolve_tool(data, &catalog, name, arguments)?;
        Ok(action_summary(&action, data, &catalog))
    })
}

/// La imagen del mensaje que pidió el modelo, como `data:` JPEG.
fn message_image(images: &[MessageImage], number: Option<usize>) -> GymCommandResult<Option<String>> {
    number.map(|number| crate::recipes::photo_from_message(images, number).map(|photo| photo.data_uri()).map_err(GymCommandError::from)).transpose()
}

pub(crate) fn execute_tool(
    app: &AppHandle,
    context: &GymContext,
    name: &str,
    arguments: &serde_json::Value,
    images: &[MessageImage],
) -> GymCommandResult<serde_json::Value> {
    let library_id = context.library_id.as_str();
    let catalog = load_catalog(app, library_id)?;
    if crate::backend::gym::tools::GYM_READ_TOOLS.contains(&name) {
        let (today, _) = local_today();
        return read(app, context, |data| Ok(read_tool(name, arguments, data, &catalog, today, now_ms())?));
    }
    let (action, summary) = read(app, context, |data| {
        let action = resolve_tool(data, &catalog, name, arguments)?;
        let summary = action_summary(&action, data, &catalog);
        Ok((action, summary))
    })?;
    let paths = catalog_paths(&catalog);
    let mut result = serde_json::json!({ "ok": true, "summary": summary });
    match action {
        GymToolAction::Change(mutation) => {
            let routine_id = write(app, context, &mutation, &catalog)?;
            result["routineId"] = serde_json::json!(routine_id);
        }
        GymToolAction::SaveExercise { exercise_id, patch, photo } => {
            let image = message_image(images, photo)?;
            let (mut exercise, old_path) = match &exercise_id {
                Some(id) => {
                    let exercise = full_exercise(app, library_id, &catalog, id)?;
                    let path = exercise.path.clone();
                    (exercise, Some(path))
                }
                None => (new_exercise(patch.group.as_deref(), &catalog, |name| free_path(&paths, EXERCISES_FOLDER, name, None)), None),
            };
            apply_patch(&mut exercise, &patch)?;
            if image.is_some() {
                exercise.image = image;
                exercise.has_image = true;
            }
            exercise.path = free_path(&paths, EXERCISES_FOLDER, &exercise.name, old_path.as_deref());
            write_catalog_file(app, library_id, old_path.as_deref(), &exercise.path, &render_exercise(&exercise))?;
            changed(app, library_id);
            result["exerciseId"] = serde_json::json!(exercise.id);
            result["file"] = serde_json::json!(exercise.path);
        }
        GymToolAction::DeleteExercise { exercise_id } => {
            let exercise = catalog.exercise(&exercise_id).cloned().ok_or_else(|| GymCommandError::new(GymCommandErrorCode::NotFound, "El ejercicio ya no existe."))?;
            crate::library_documents::with_documents(app, library_id, |documents| {
                documents.adapter.delete_locator(&documents.locator(&exercise.path)?)?;
                if let Some(video) = &exercise.video {
                    let locator = documents.locator(&video_path(&exercise, video))?;
                    if documents.adapter.exists_locator(&locator)? {
                        documents.adapter.delete_locator(&locator)?;
                    }
                }
                Ok(())
            })?;
            forget_catalog(library_id);
            changed(app, library_id);
        }
        GymToolAction::SaveEquipment { equipment_id, name, category, photo } => {
            let photo = message_image(images, photo)?.map(|uri| MediaInput { media_type: "image/jpeg".to_string(), base64: uri });
            let saved = apply_catalog(app, context, &CatalogMutation::SaveEquipment { equipment_id, name, category }, photo.as_ref())?;
            result["equipmentId"] = serde_json::json!(saved.equipment_id);
        }
        GymToolAction::DeleteEquipment { equipment_id } => {
            apply_catalog(app, context, &CatalogMutation::DeleteEquipment { equipment_id }, None)?;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::gym::view::Screen;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("database");
        crate::database::migrate(&connection).expect("migrate");
        connection
    }

    #[test]
    fn routines_sessions_and_workouts_round_trip_per_user() {
        let connection = database();
        let owner = crate::backend::OWNER_LIBRARY_USER_ID;
        let catalog = Catalog {
            exercises: vec![Exercise { id: "push_ups".into(), name: "Flexiones".into(), group: "pecho".into(), kcal_per_min: 6.0, ..Exercise::default() }],
            equipment: vec![Equipment { id: "dumbbell".into(), name: "Mancuernas".into(), category: "libres".into(), ..Equipment::default() }],
        };
        let mut counter = 0;
        let mut new_id = || {
            counter += 1;
            format!("id-{counter}")
        };
        let mut step = |mutation: GymMutation, now_ms: i64| {
            let data = load(&connection, owner).expect("load");
            let mut clock = Clock { now_ms, today: "2026-10-01".into(), new_id: &mut new_id };
            let change = plan_change(&data, &catalog, &mutation, &mut clock).expect("change");
            apply_ops(&connection, owner, &change.ops).expect("apply");
            change.routine_id
        };
        let routine = step(GymMutation::CreateRoutine, 0).expect("routine");
        step(GymMutation::AddExercise { routine_id: routine.clone(), exercise_id: "push_ups".into() }, 0);
        step(GymMutation::ToggleEquipment { equipment_id: "dumbbell".into() }, 0);
        let item = load(&connection, owner).expect("load").routines[0].items[0].id.clone();
        step(GymMutation::ToggleSetDone { routine_id: routine.clone(), item_id: item, index: 0 }, 1_000);
        step(GymMutation::FinishSession, 600_000);

        let data = load(&connection, owner).expect("load");
        assert_eq!(data.routines.len(), 1);
        assert!(data.owned.contains("dumbbell"));
        assert_eq!(data.workouts.len(), 1);
        assert_eq!(data.workouts[0].minutes, 10.0);
        assert_eq!(data.session.as_ref().map(|session| session.status), Some(crate::backend::gym::SessionStatus::Done));
        assert!(!data.sex_from_profile);

        // Otro usuario no ve estos datos.
        connection
            .execute(
                "INSERT INTO library_users (id, name, normalized_name, role_id, created_at, updated_at)
                 SELECT 'user-ana', 'Ana', 'ana', role_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM library_users WHERE id = 'user-owner'",
                [],
            )
            .expect("user");
        let other = load(&connection, "user-ana").expect("load");
        assert!(other.routines.is_empty() && other.workouts.is_empty());

        let (today, _) = local_today();
        let view = build_view(&data, &catalog, &GymQuery { screen: Screen::Entrenar, ..GymQuery::default() }, today, 700_000);
        assert_eq!(view.training.as_ref().map(|training| training.status.as_str()), Some("done"));
    }

    /// The agent's tools on a library folder: preview without saving, then
    /// routines in the database and exercises and equipment as files.
    #[cfg(not(target_os = "android"))]
    #[test]
    fn the_agent_tools_change_the_database_and_the_files() {
        use crate::host::{AppContext, AppPaths, HostPorts, Manager};
        use serde_json::json;

        let root = std::env::temp_dir().join(format!("notia-gym-tools-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(EXERCISES_FOLDER)).expect("exercises");
        std::fs::create_dir_all(root.join(EQUIPMENT_FOLDER)).expect("equipment");
        std::fs::create_dir_all(root.join(".notia")).expect("database folder");
        std::fs::write(
            root.join(EXERCISES_FOLDER).join("Press de banca con barra.md"),
            "---\nid: bench_press\ngrupo: pecho\nregistro: peso-reps\nkcalPorMinuto: 6\nprincipales: Pecho inferior\nequipamiento: barbell\n---\n# Press de banca con barra\n\n![Press](data:image/png;base64,AAAA)\n",
        )
        .expect("exercise");
        std::fs::write(root.join(EQUIPMENT_FOLDER).join("Barra y discos.md"), "---\nid: barbell\ncategoria: libres\norigen: catalogo\n---\n# Barra y discos\n").expect("equipment");
        let app = AppContext::new(AppPaths::default(), HostPorts::default());
        let registry = crate::library_registry::LibraryBindingRegistry::default();
        registry.register_desktop_root("library-gym", &root).expect("binding");
        app.manage(registry);
        app.manage(crate::mobile_directory_picker::AndroidDirectoryPickerState::empty());
        let context = GymContext { library_id: "library-gym".into(), actor_library_user_id: crate::backend::OWNER_LIBRARY_USER_ID.into() };

        // The preview says what will happen and saves nothing.
        let arguments = json!({ "name": "Pecho", "days": ["lunes"], "exercises": [{ "exercise": "press de banca con barra", "sets": 4, "reps": 8, "weight": 70 }] });
        let summary = preview_tool(&app, &context, "save_gym_routine", &arguments).expect("preview");
        assert!(summary.contains("Crear la rutina «Pecho»") && summary.contains("8 reps con 70 kg"), "{summary}");
        assert!(read(&app, &context, |data| Ok(data.routines.is_empty())).expect("read"));
        let result = execute_tool(&app, &context, "save_gym_routine", &arguments, &[]).expect("save");
        assert!(result["routineId"].is_string());
        let summary = execute_tool(&app, &context, "get_gym_summary", &json!({}), &[]).expect("summary");
        assert_eq!(summary["routines"][0]["sets"], 4);

        // A new exercise with the photo of the message, as a file.
        let mut png = Vec::new();
        image::RgbImage::from_pixel(4, 4, image::Rgb([10, 200, 90])).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).expect("png");
        let photo = MessageImage { base64: base64::engine::general_purpose::STANDARD.encode(png) };
        let created = execute_tool(
            &app,
            &context,
            "save_gym_exercise",
            &json!({ "name": "Remo con banda", "group": "espalda", "primaryMuscles": ["Dorsales"], "steps": ["Pisá la banda.", "Tirá hacia el ombligo."], "photoFromMessage": 1 }),
            &[photo],
        )
        .expect("exercise");
        assert_eq!(created["file"], "Gym/exercises/Remo con banda.md");
        let text = std::fs::read_to_string(root.join(EXERCISES_FOLDER).join("Remo con banda.md")).expect("file");
        assert!(text.contains("principales: Dorsales") && text.contains("](data:image/jpeg;base64,") && text.contains("2. Tirá hacia el ombligo."), "{text}");
        // Renaming moves the file; editing keeps the image.
        execute_tool(&app, &context, "save_gym_exercise", &json!({ "exercise": "Remo con banda", "name": "Remo con banda elástica" }), &[]).expect("rename");
        assert!(!root.join(EXERCISES_FOLDER).join("Remo con banda.md").exists());
        let renamed = std::fs::read_to_string(root.join(EXERCISES_FOLDER).join("Remo con banda elástica.md")).expect("renamed");
        assert!(renamed.contains("](data:image/jpeg;base64,"));

        // Own equipment, owned at once, and its removal.
        let saved = execute_tool(&app, &context, "save_gym_equipment", &json!({ "name": "Banda elástica", "category": "accesorios" }), &[]).expect("equipment");
        let id = saved["equipmentId"].as_str().expect("id").to_string();
        assert!(read(&app, &context, |data| Ok(data.owned.contains(&id))).expect("owned"));
        execute_tool(&app, &context, "delete_gym_equipment", &json!({ "equipment": "Banda elástica" }), &[]).expect("delete");
        assert!(!root.join(EQUIPMENT_FOLDER).join("Banda elástica.md").exists());
        // The catalog's equipment is only unmarked.
        assert!(preview_tool(&app, &context, "delete_gym_equipment", &json!({ "equipment": "barbell" })).is_ok());
        assert!(execute_tool(&app, &context, "delete_gym_equipment", &json!({ "equipment": "barbell" }), &[]).is_err());

        // A past workout, read back.
        execute_tool(&app, &context, "log_gym_workout", &json!({ "routine": "Pecho", "minutes": 45 }), &[]).expect("workout");
        let workouts = execute_tool(&app, &context, "list_gym_workouts", &json!({}), &[]).expect("workouts");
        assert_eq!(workouts["workouts"][0]["sets"], 4);
        assert_eq!(workouts["workouts"][0]["routine"], "Pecho");
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn catalog_files_get_free_names() {
        let paths = vec!["Gym/exercises/Plancha.md".to_string(), "Gym/exercises/Plancha 2.md".to_string()];
        assert_eq!(free_path(&paths, EXERCISES_FOLDER, "Plancha", None), "Gym/exercises/Plancha 3.md");
        assert_eq!(free_path(&paths, EXERCISES_FOLDER, "plancha", Some("Gym/exercises/Plancha.md")), "Gym/exercises/plancha.md");
        assert_eq!(video_media_type("Plancha.webm"), "video/webm");
        assert_eq!(video_extension("video/mp4"), Some("mp4"));
    }
}
