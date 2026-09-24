//! Rutina: hábitos agrupados en rutinas y persistidos en la base SQLite de la
//! biblioteca, separados por usuario de la biblioteca. Rust valida, persiste y
//! deriva todas las métricas del panel; React solo representa el DTO.

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, Local, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::routine_dashboard::{build_dashboard, RoutineDashboard};

/// Emitted after the agent (chat or Telegram) changes routine data so an
/// open Rutina view reloads its dashboard.
pub const ROUTINE_DATA_CHANGED_EVENT: &str = "notia:routine-data-changed";

pub const LIFE_CATEGORIES: [&str; 8] = [
    "Salud y deporte",
    "Familia y amor",
    "Trabajo y finanzas",
    "Ocio y amistad",
    "Tiempo para mí",
    "Emocional",
    "Educativa y cultura",
    "Espiritual y ética",
];
pub const DAY_NAMES: [&str; 7] = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
];
pub const DAY_SHORT: [&str; 7] = ["L", "M", "X", "J", "V", "S", "D"];
pub const DEFAULT_GOAL: u8 = 10;
/// Days of history loaded to compute streaks.
pub const HISTORY_DAYS: i64 = 730;

const DEFAULT_ROUTINE_NAME: &str = "Rutina";
const MAX_ROUTINE_NAME_CHARS: usize = 30;
const MAX_TASK_NAME_CHARS: usize = 60;
const MAX_TASK_NOTES_CHARS: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutineErrorCode {
    Validation,
    NotFound,
    Conflict,
    Storage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineCommandError {
    pub code: RoutineErrorCode,
    pub message: String,
}

impl RoutineCommandError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: RoutineErrorCode::Validation,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: RoutineErrorCode::NotFound,
            message: message.into(),
        }
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self {
            code: RoutineErrorCode::Conflict,
            message: message.into(),
        }
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self {
            code: RoutineErrorCode::Storage,
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for RoutineCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::storage(format!("No se pudo acceder a los datos de Rutina: {error}"))
    }
}

pub type RoutineResult<T> = Result<T, RoutineCommandError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineContext {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
    pub actor_library_user_id: String,
    pub source: String,
}

impl RoutineContext {
    fn owner(&self) -> &str {
        self.actor_library_user_id.trim()
    }
}

fn open_connection(context: &RoutineContext, app: &crate::host::AppHandle) -> RoutineResult<Connection> {
    if !matches!(context.source.as_str(), "app" | "telegram") {
        return Err(RoutineCommandError::validation(
            "El origen de la operación de Rutina no es válido.",
        ));
    }
    if context.owner().is_empty() {
        return Err(RoutineCommandError::validation(
            "El usuario de la biblioteca es obligatorio para acceder a Rutina.",
        ));
    }
    let connection = open_library_connection(context, app).map_err(RoutineCommandError::storage)?;
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_users WHERE id=?1)",
        [context.owner()],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(RoutineCommandError::validation(
            "El usuario de la biblioteca no está autorizado para Rutina.",
        ));
    }
    Ok(connection)
}

#[cfg(target_os = "android")]
fn open_library_connection(
    context: &RoutineContext,
    app: &crate::host::AppHandle,
) -> Result<Connection, String> {
    let directory_uri = context
        .android_directory_uri
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "La biblioteca perdió su URI SAF. Volvé a seleccionarla.".to_string())?;
    crate::database::open_mobile_library_connection(app, directory_uri)
}

#[cfg(target_os = "ios")]
fn open_library_connection(
    _context: &RoutineContext,
    _app: &crate::host::AppHandle,
) -> Result<Connection, String> {
    Err("Rutina todavía no está disponible en iOS.".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn open_library_connection(
    context: &RoutineContext,
    _app: &crate::host::AppHandle,
) -> Result<Connection, String> {
    if context.library_path.trim().is_empty() {
        return Err("La librería es obligatoria.".to_string());
    }
    crate::database::open_library_connection(&context.library_path)
}

/// Android works on a cached copy of the database; writes must be copied
/// back through SAF before they are reported as saved.
fn sync_library_connection(context: &RoutineContext, app: &crate::host::AppHandle) -> RoutineResult<()> {
    #[cfg(target_os = "android")]
    {
        let directory_uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                RoutineCommandError::storage(
                    "La biblioteca perdió su URI SAF. Volvé a seleccionarla.",
                )
            })?;
        crate::database::sync_mobile_library_connection(app, directory_uri)
            .map_err(RoutineCommandError::storage)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (context, app);
        Ok(())
    }
}

pub fn local_today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn weekday_index(date: NaiveDate) -> u8 {
    date.weekday().num_days_from_monday() as u8
}

pub fn parse_date(value: &str) -> RoutineResult<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| RoutineCommandError::validation("La fecha debe tener formato YYYY-MM-DD."))
}

/// Days of the week a task applies to, Monday = 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskDays {
    All,
    Only(Vec<u8>),
}

impl TaskDays {
    fn from_stored(value: &str) -> Self {
        if value == "all" {
            return Self::All;
        }
        let days = value
            .split(',')
            .filter_map(|part| part.trim().parse::<u8>().ok())
            .filter(|day| *day < 7)
            .collect::<Vec<_>>();
        if days.is_empty() {
            Self::All
        } else {
            Self::Only(days)
        }
    }

    fn to_stored(&self) -> String {
        match self {
            Self::All => "all".to_string(),
            Self::Only(days) => days.iter().map(u8::to_string).collect::<Vec<_>>().join(","),
        }
    }

    /// `None` means every day; a list must name at least one valid weekday.
    pub fn from_input(days: Option<&[u8]>) -> RoutineResult<Self> {
        let Some(days) = days else {
            return Ok(Self::All);
        };
        if days.iter().any(|day| *day > 6) {
            return Err(RoutineCommandError::validation(
                "Los días deben ir de 0 (lunes) a 6 (domingo).",
            ));
        }
        let mut unique = days.to_vec();
        unique.sort_unstable();
        unique.dedup();
        match unique.len() {
            0 => Err(RoutineCommandError::validation("Elegí al menos un día.")),
            7 => Ok(Self::All),
            _ => Ok(Self::Only(unique)),
        }
    }

    pub fn applies(&self, weekday: u8) -> bool {
        match self {
            Self::All => true,
            Self::Only(days) => days.contains(&weekday),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::All => "Todos los días".to_string(),
            Self::Only(days) => days
                .iter()
                .map(|day| DAY_SHORT[*day as usize])
                .collect::<Vec<_>>()
                .join(" "),
        }
    }

    pub fn as_list(&self) -> Vec<u8> {
        match self {
            Self::All => (0..7).collect(),
            Self::Only(days) => days.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RoutineTaskStatus {
    Active,
    Paused,
}

impl RoutineTaskStatus {
    fn from_stored(value: &str) -> Self {
        if value == "paused" {
            Self::Paused
        } else {
            Self::Active
        }
    }

    fn as_stored(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RoutineRecord {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct TaskRecord {
    pub id: String,
    pub routine_id: String,
    pub name: String,
    pub category: String,
    pub days: TaskDays,
    pub notes: String,
    pub status: RoutineTaskStatus,
}

impl TaskRecord {
    pub fn is_active(&self) -> bool {
        self.status == RoutineTaskStatus::Active
    }
}

/// Everything the dashboard derives from, for one library user.
#[derive(Debug, Default)]
pub struct RoutineData {
    pub routines: Vec<RoutineRecord>,
    pub tasks: Vec<TaskRecord>,
    pub completions: HashSet<(String, NaiveDate)>,
    pub goals: HashMap<String, u8>,
}

impl RoutineData {
    pub fn is_completed(&self, task_id: &str, date: NaiveDate) -> bool {
        self.completions.contains(&(task_id.to_string(), date))
    }

    pub fn goal(&self, category: &str) -> u8 {
        self.goals.get(category).copied().unwrap_or(DEFAULT_GOAL)
    }
}

const TASK_COLUMNS: &str = "t.id, t.routine_id, t.name, t.category, t.days, t.notes, t.status";

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRecord> {
    Ok(TaskRecord {
        id: row.get(0)?,
        routine_id: row.get(1)?,
        name: row.get(2)?,
        category: row.get(3)?,
        days: TaskDays::from_stored(&row.get::<_, String>(4)?),
        notes: row.get(5)?,
        status: RoutineTaskStatus::from_stored(&row.get::<_, String>(6)?),
    })
}

/// Loads the routines, visible tasks, goals and the completions recorded on
/// or after `since`, ordered as the dashboard shows them.
pub fn load_data(
    connection: &Connection,
    owner: &str,
    since: NaiveDate,
) -> RoutineResult<RoutineData> {
    let routines = connection
        .prepare(
            "SELECT id, name FROM routine_routines WHERE owner_user_id=?1 ORDER BY position, created_at, id",
        )?
        .query_map([owner], |row| Ok(RoutineRecord { id: row.get(0)?, name: row.get(1)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    let tasks = connection
        .prepare(&format!(
            "SELECT {TASK_COLUMNS} FROM routine_tasks t
             JOIN routine_routines r ON r.id = t.routine_id
             WHERE t.owner_user_id=?1 AND t.deleted_at IS NULL
             ORDER BY r.position, r.created_at, t.position, t.created_at"
        ))?
        .query_map([owner], task_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let completions = connection
        .prepare(
            "SELECT c.task_id, c.date FROM routine_completions c
             JOIN routine_tasks t ON t.id = c.task_id
             WHERE t.owner_user_id=?1 AND t.deleted_at IS NULL AND c.date >= ?2",
        )?
        .query_map(
            params![owner, since.format("%Y-%m-%d").to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?
        .filter_map(|row| match row {
            Ok((task_id, date)) => NaiveDate::parse_from_str(&date, "%Y-%m-%d")
                .ok()
                .map(|date| Ok((task_id, date))),
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<HashSet<_>, _>>()?;
    let goals = connection
        .prepare("SELECT category, goal FROM routine_goals WHERE owner_user_id=?1")?
        .query_map([owner], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u8>(1)?))
        })?
        .collect::<Result<HashMap<_, _>, _>>()?;
    Ok(RoutineData {
        routines,
        tasks,
        completions,
        goals,
    })
}

fn ensure_default_routine(connection: &Connection, owner: &str) -> RoutineResult<bool> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM routine_routines WHERE owner_user_id=?1",
        [owner],
        |row| row.get(0),
    )?;
    if count > 0 {
        return Ok(false);
    }
    let timestamp = crate::finance::now();
    connection.execute(
        "INSERT INTO routine_routines (id, owner_user_id, name, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        params![
            Uuid::new_v4().to_string(),
            owner,
            DEFAULT_ROUTINE_NAME,
            timestamp
        ],
    )?;
    Ok(true)
}

fn bounded_text(
    value: &str,
    max_chars: usize,
    field: &str,
    required: bool,
) -> RoutineResult<String> {
    let trimmed = value.trim();
    if required && trimmed.is_empty() {
        return Err(RoutineCommandError::validation(format!(
            "{field} es obligatorio."
        )));
    }
    if trimmed.chars().count() > max_chars {
        return Err(RoutineCommandError::validation(format!(
            "{field} admite como máximo {max_chars} caracteres."
        )));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(RoutineCommandError::validation(format!(
            "{field} contiene caracteres no válidos."
        )));
    }
    Ok(trimmed.to_string())
}

pub fn canonical_category(value: &str) -> RoutineResult<&'static str> {
    let wanted = value.trim().to_lowercase();
    LIFE_CATEGORIES
        .iter()
        .copied()
        .find(|category| category.to_lowercase() == wanted)
        .ok_or_else(|| {
            RoutineCommandError::validation(format!(
                "La categoría debe ser una de: {}.",
                LIFE_CATEGORIES.join(", ")
            ))
        })
}

fn find_routine(connection: &Connection, owner: &str, id: &str) -> RoutineResult<RoutineRecord> {
    connection
        .query_row(
            "SELECT id, name FROM routine_routines WHERE id=?1 AND owner_user_id=?2",
            params![id.trim(), owner],
            |row| {
                Ok(RoutineRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| RoutineCommandError::not_found("La rutina no existe."))
}

fn find_task(
    connection: &Connection,
    owner: &str,
    id: &str,
    deleted: bool,
) -> RoutineResult<TaskRecord> {
    let deleted_clause = if deleted { "IS NOT NULL" } else { "IS NULL" };
    connection
        .query_row(
            &format!(
                "SELECT {TASK_COLUMNS} FROM routine_tasks t
                 WHERE t.id=?1 AND t.owner_user_id=?2 AND t.deleted_at {deleted_clause}"
            ),
            params![id.trim(), owner],
            task_from_row,
        )
        .optional()?
        .ok_or_else(|| {
            RoutineCommandError::not_found(if deleted {
                "La tarea eliminada no existe o ya fue restaurada."
            } else {
                "La tarea no existe."
            })
        })
}

/// Resolves a routine by id or by case-insensitive name.
pub fn resolve_routine(
    connection: &Connection,
    owner: &str,
    reference: &str,
) -> RoutineResult<RoutineRecord> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err(RoutineCommandError::validation("Indicá la rutina."));
    }
    if let Ok(routine) = find_routine(connection, owner, reference) {
        return Ok(routine);
    }
    let matches = connection
        .prepare(
            "SELECT id, name FROM routine_routines WHERE owner_user_id=?1 AND lower(trim(name))=lower(?2)",
        )?
        .query_map(params![owner, reference], |row| {
            Ok(RoutineRecord { id: row.get(0)?, name: row.get(1)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    single_match(matches, "rutina", reference, |routine| routine.id.clone())
}

/// Resolves a visible (or, with `deleted`, a deleted) task by id or name,
/// optionally within a routine.
pub fn resolve_task(
    connection: &Connection,
    owner: &str,
    reference: &str,
    routine_id: Option<&str>,
    deleted: bool,
) -> RoutineResult<TaskRecord> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err(RoutineCommandError::validation("Indicá la tarea."));
    }
    if let Ok(task) = find_task(connection, owner, reference, deleted) {
        if routine_id.is_none_or(|routine_id| routine_id == task.routine_id) {
            return Ok(task);
        }
    }
    let deleted_clause = if deleted { "IS NOT NULL" } else { "IS NULL" };
    let matches = connection
        .prepare(&format!(
            "SELECT {TASK_COLUMNS} FROM routine_tasks t
             WHERE t.owner_user_id=?1 AND t.deleted_at {deleted_clause}
               AND lower(trim(t.name))=lower(?2) AND (?3 IS NULL OR t.routine_id=?3)
             ORDER BY t.deleted_at DESC"
        ))?
        .query_map(params![owner, reference, routine_id], task_from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    single_match(matches, "tarea", reference, |task| task.id.clone())
}

fn single_match<T>(
    mut matches: Vec<T>,
    kind: &str,
    reference: &str,
    id: impl Fn(&T) -> String,
) -> RoutineResult<T> {
    match matches.len() {
        0 => Err(RoutineCommandError::not_found(format!(
            "No existe la {kind} «{reference}»."
        ))),
        1 => Ok(matches.remove(0)),
        _ => Err(RoutineCommandError::validation(format!(
            "Hay varias {kind}s llamadas «{reference}»; indicá el id: {}.",
            matches.iter().map(id).collect::<Vec<_>>().join(", ")
        ))),
    }
}

/// A single validated change to the routine data of one user.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RoutineMutation {
    SaveRoutine {
        id: Option<String>,
        name: String,
    },
    DeleteRoutine {
        id: String,
    },
    SaveTask {
        id: Option<String>,
        routine_id: String,
        name: String,
        category: String,
        /// `None` means every day; Monday = 0.
        days: Option<Vec<u8>>,
        #[serde(default)]
        notes: String,
    },
    SetTaskStatus {
        id: String,
        status: RoutineTaskStatus,
    },
    DeleteTask {
        id: String,
    },
    RestoreTask {
        id: String,
    },
    ReorderTasks {
        routine_id: String,
        ordered_task_ids: Vec<String>,
    },
    SetCompletion {
        task_id: String,
        date: String,
        completed: bool,
    },
    SetGoal {
        category: String,
        goal: u8,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineMutationOutcome {
    pub changed: bool,
    pub entity_id: Option<String>,
    pub summary: String,
}

fn outcome(changed: bool, entity_id: &str, summary: String) -> RoutineMutationOutcome {
    RoutineMutationOutcome {
        changed,
        entity_id: Some(entity_id.to_string()),
        summary,
    }
}

fn short_date(date: NaiveDate) -> String {
    format!(
        "{} {}",
        DAY_NAMES[weekday_index(date) as usize].to_lowercase(),
        date.format("%d/%m/%Y")
    )
}

/// Applies one mutation inside the caller's transaction. Every rule lives
/// here so the view, the chat and Telegram share the same validation.
pub fn apply_mutation(
    connection: &Connection,
    owner: &str,
    mutation: &RoutineMutation,
    today: NaiveDate,
) -> RoutineResult<RoutineMutationOutcome> {
    let timestamp = crate::finance::now();
    match mutation {
        RoutineMutation::SaveRoutine { id, name } => {
            let name = bounded_text(name, MAX_ROUTINE_NAME_CHARS, "El nombre de la rutina", true)?;
            let duplicate: Option<String> = connection
                .query_row(
                    "SELECT id FROM routine_routines
                     WHERE owner_user_id=?1 AND lower(trim(name))=lower(?2) AND id<>COALESCE(?3,'')",
                    params![owner, name, id.as_deref().map(str::trim)],
                    |row| row.get(0),
                )
                .optional()?;
            if duplicate.is_some() {
                return Err(RoutineCommandError::conflict(format!(
                    "Ya existe una rutina llamada «{name}»."
                )));
            }
            match id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
                Some(id) => {
                    let routine = find_routine(connection, owner, id)?;
                    connection.execute(
                        "UPDATE routine_routines SET name=?1, updated_at=?2 WHERE id=?3",
                        params![name, timestamp, routine.id],
                    )?;
                    Ok(outcome(
                        routine.name != name,
                        &routine.id,
                        format!("Renombrar la rutina «{}» a «{name}».", routine.name),
                    ))
                }
                None => {
                    let id = Uuid::new_v4().to_string();
                    connection.execute(
                        "INSERT INTO routine_routines (id, owner_user_id, name, position, created_at, updated_at)
                         SELECT ?1, ?2, ?3, COALESCE(MAX(position), -1) + 1, ?4, ?4
                         FROM routine_routines WHERE owner_user_id=?2",
                        params![id, owner, name, timestamp],
                    )?;
                    Ok(outcome(true, &id, format!("Crear la rutina «{name}».")))
                }
            }
        }
        RoutineMutation::DeleteRoutine { id } => {
            let routine = find_routine(connection, owner, id)?;
            let routine_count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM routine_routines WHERE owner_user_id=?1",
                [owner],
                |row| row.get(0),
            )?;
            if routine_count <= 1 {
                return Err(RoutineCommandError::conflict(
                    "Necesitás al menos una rutina.",
                ));
            }
            let task_count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM routine_tasks WHERE routine_id=?1 AND deleted_at IS NULL",
                [&routine.id],
                |row| row.get(0),
            )?;
            if task_count > 0 {
                return Err(RoutineCommandError::conflict(format!(
                    "La rutina «{}» tiene {task_count} tarea(s); vaciala antes de eliminarla.",
                    routine.name
                )));
            }
            connection.execute(
                "DELETE FROM routine_completions WHERE task_id IN (SELECT id FROM routine_tasks WHERE routine_id=?1)",
                [&routine.id],
            )?;
            connection.execute(
                "DELETE FROM routine_tasks WHERE routine_id=?1",
                [&routine.id],
            )?;
            connection.execute("DELETE FROM routine_routines WHERE id=?1", [&routine.id])?;
            Ok(outcome(
                true,
                &routine.id,
                format!("Eliminar la rutina «{}».", routine.name),
            ))
        }
        RoutineMutation::SaveTask {
            id,
            routine_id,
            name,
            category,
            days,
            notes,
        } => {
            let name = bounded_text(name, MAX_TASK_NAME_CHARS, "El nombre de la tarea", true)?;
            let notes = bounded_text(notes, MAX_TASK_NOTES_CHARS, "La nota", false)?;
            let category = canonical_category(category)?;
            let days = TaskDays::from_input(days.as_deref())?;
            let routine = find_routine(connection, owner, routine_id)?;
            let detail = format!("{category} · {} en «{}»", days.label(), routine.name);
            match id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
                Some(id) => {
                    let task = find_task(connection, owner, id, false)?;
                    let changed = task.name != name
                        || task.category != category
                        || task.days != days
                        || task.notes != notes
                        || task.routine_id != routine.id;
                    connection.execute(
                        "UPDATE routine_tasks SET name=?1, category=?2, days=?3, notes=?4, routine_id=?5,
                             position = CASE WHEN routine_id=?5 THEN position
                                 ELSE (SELECT COALESCE(MAX(position), -1) + 1 FROM routine_tasks WHERE routine_id=?5) END,
                             updated_at=?6
                         WHERE id=?7",
                        params![name, category, days.to_stored(), notes, routine.id, timestamp, task.id],
                    )?;
                    Ok(outcome(
                        changed,
                        &task.id,
                        format!("Actualizar la tarea «{name}» ({detail})."),
                    ))
                }
                None => {
                    let id = Uuid::new_v4().to_string();
                    connection.execute(
                        "INSERT INTO routine_tasks
                             (id, owner_user_id, routine_id, name, category, days, notes, status, position, created_at, updated_at)
                         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', COALESCE(MAX(position), -1) + 1, ?8, ?8
                         FROM routine_tasks WHERE routine_id=?3",
                        params![id, owner, routine.id, name, category, days.to_stored(), notes, timestamp],
                    )?;
                    Ok(outcome(
                        true,
                        &id,
                        format!("Crear la tarea «{name}» ({detail})."),
                    ))
                }
            }
        }
        RoutineMutation::SetTaskStatus { id, status } => {
            let task = find_task(connection, owner, id, false)?;
            connection.execute(
                "UPDATE routine_tasks SET status=?1, updated_at=?2 WHERE id=?3",
                params![status.as_stored(), timestamp, task.id],
            )?;
            let verb = match status {
                RoutineTaskStatus::Active => "Reanudar",
                RoutineTaskStatus::Paused => "Pausar",
            };
            Ok(outcome(
                task.status != *status,
                &task.id,
                format!("{verb} la tarea «{}».", task.name),
            ))
        }
        RoutineMutation::DeleteTask { id } => {
            let task = find_task(connection, owner, id, false)?;
            connection.execute(
                "UPDATE routine_tasks SET deleted_at=?1, updated_at=?1 WHERE id=?2",
                params![timestamp, task.id],
            )?;
            Ok(outcome(
                true,
                &task.id,
                format!(
                    "Eliminar la tarea «{}» (se conserva su historial para poder restaurarla).",
                    task.name
                ),
            ))
        }
        RoutineMutation::RestoreTask { id } => {
            let task = find_task(connection, owner, id, true)?;
            connection.execute(
                "UPDATE routine_tasks SET deleted_at=NULL, updated_at=?1 WHERE id=?2",
                params![timestamp, task.id],
            )?;
            Ok(outcome(
                true,
                &task.id,
                format!("Restaurar la tarea «{}».", task.name),
            ))
        }
        RoutineMutation::ReorderTasks {
            routine_id,
            ordered_task_ids,
        } => {
            let routine = find_routine(connection, owner, routine_id)?;
            let current = connection
                .prepare(
                    "SELECT id FROM routine_tasks WHERE routine_id=?1 AND deleted_at IS NULL ORDER BY position, created_at",
                )?
                .query_map([&routine.id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let requested = ordered_task_ids
                .iter()
                .map(|id| id.trim().to_string())
                .collect::<Vec<_>>();
            let requested_set = requested.iter().collect::<HashSet<_>>();
            if requested.len() != current.len()
                || requested_set.len() != requested.len()
                || current.iter().any(|id| !requested_set.contains(id))
            {
                return Err(RoutineCommandError::validation(format!(
                    "El nuevo orden debe incluir exactamente las {} tarea(s) de «{}».",
                    current.len(),
                    routine.name
                )));
            }
            for (position, id) in requested.iter().enumerate() {
                connection.execute(
                    "UPDATE routine_tasks SET position=?1, updated_at=?2 WHERE id=?3",
                    params![position as i64, timestamp, id],
                )?;
            }
            Ok(outcome(
                requested != current,
                &routine.id,
                format!("Reordenar las tareas de «{}».", routine.name),
            ))
        }
        RoutineMutation::SetCompletion {
            task_id,
            date,
            completed,
        } => {
            let date = parse_date(date)?;
            if date > today {
                return Err(RoutineCommandError::validation(
                    "No se pueden marcar días futuros.",
                ));
            }
            let task = find_task(connection, owner, task_id, false)?;
            if !task.is_active() {
                return Err(RoutineCommandError::conflict(format!(
                    "La tarea «{}» está pausada; reanudala para registrarla.",
                    task.name
                )));
            }
            if !task.days.applies(weekday_index(date)) {
                return Err(RoutineCommandError::validation(format!(
                    "La tarea «{}» no aplica el {} ({}).",
                    task.name,
                    short_date(date),
                    task.days.label()
                )));
            }
            let stored_date = date.format("%Y-%m-%d").to_string();
            let rows = if *completed {
                connection.execute(
                    "INSERT OR IGNORE INTO routine_completions (task_id, date, completed_at) VALUES (?1, ?2, ?3)",
                    params![task.id, stored_date, timestamp],
                )?
            } else {
                connection.execute(
                    "DELETE FROM routine_completions WHERE task_id=?1 AND date=?2",
                    params![task.id, stored_date],
                )?
            };
            let verb = if *completed {
                "Marcar como hecha"
            } else {
                "Desmarcar"
            };
            Ok(outcome(
                rows > 0,
                &task.id,
                format!("{verb} «{}» el {}.", task.name, short_date(date)),
            ))
        }
        RoutineMutation::SetGoal { category, goal } => {
            let category = canonical_category(category)?;
            if !(1..=10).contains(goal) {
                return Err(RoutineCommandError::validation(
                    "La meta debe estar entre 1 y 10.",
                ));
            }
            let previous: Option<u8> = connection
                .query_row(
                    "SELECT goal FROM routine_goals WHERE owner_user_id=?1 AND category=?2",
                    params![owner, category],
                    |row| row.get(0),
                )
                .optional()?;
            connection.execute(
                "INSERT INTO routine_goals (owner_user_id, category, goal, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(owner_user_id, category) DO UPDATE SET goal=excluded.goal, updated_at=excluded.updated_at",
                params![owner, category, goal, timestamp],
            )?;
            Ok(RoutineMutationOutcome {
                changed: previous.unwrap_or(DEFAULT_GOAL) != *goal,
                entity_id: None,
                summary: format!("Fijar la meta de «{category}» en {goal}/10."),
            })
        }
    }
}

/// Runs `work` in a transaction on the user's data. With `commit` the
/// transaction is committed and synchronized; otherwise it is rolled back,
/// which lets the agent validate a mutation before asking for confirmation.
pub fn with_transaction<T>(
    app: &crate::host::AppHandle,
    context: &RoutineContext,
    commit: bool,
    work: impl FnOnce(&Transaction<'_>, &str, NaiveDate) -> RoutineResult<T>,
) -> RoutineResult<T> {
    let mut connection = open_connection(context, app)?;
    let transaction = connection.transaction()?;
    let value = work(&transaction, context.owner(), local_today())?;
    if commit {
        transaction.commit()?;
        drop(connection);
        sync_library_connection(context, app)?;
    }
    Ok(value)
}

pub fn load_dashboard(
    app: &crate::host::AppHandle,
    context: &RoutineContext,
) -> RoutineResult<RoutineDashboard> {
    let connection = open_connection(context, app)?;
    let today = local_today();
    let created = ensure_default_routine(&connection, context.owner())?;
    let data = load_data(
        &connection,
        context.owner(),
        today - Duration::days(HISTORY_DAYS),
    )?;
    drop(connection);
    if created {
        sync_library_connection(context, app)?;
    }
    Ok(build_dashboard(&data, today))
}

pub fn routine_get_dashboard(
    app: crate::host::AppHandle,
    context: RoutineContext,
) -> RoutineResult<RoutineDashboard> {
    load_dashboard(&app, &context)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRoutineMutationPayload {
    pub context: RoutineContext,
    pub mutation: RoutineMutation,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineMutationResponse {
    pub outcome: RoutineMutationOutcome,
    pub dashboard: RoutineDashboard,
}

pub fn routine_apply_mutation(
    app: crate::host::AppHandle,
    payload: ApplyRoutineMutationPayload,
) -> RoutineResult<RoutineMutationResponse> {
    let outcome = with_transaction(&app, &payload.context, true, |transaction, owner, today| {
        apply_mutation(transaction, owner, &payload.mutation, today)
    })?;
    let dashboard = load_dashboard(&app, &payload.context)?;
    Ok(RoutineMutationResponse { outcome, dashboard })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        crate::database::migrate(&connection).expect("migration");
        connection
    }

    pub(crate) fn date(value: &str) -> NaiveDate {
        parse_date(value).expect("date")
    }

    fn apply(
        connection: &Connection,
        mutation: RoutineMutation,
    ) -> RoutineResult<RoutineMutationOutcome> {
        apply_mutation(connection, "user-owner", &mutation, date("2026-09-23"))
    }

    pub(crate) fn seed_routine(connection: &Connection, name: &str) -> String {
        apply(
            connection,
            RoutineMutation::SaveRoutine {
                id: None,
                name: name.into(),
            },
        )
        .expect("routine")
        .entity_id
        .expect("id")
    }

    pub(crate) fn seed_task(
        connection: &Connection,
        routine_id: &str,
        name: &str,
        days: Option<Vec<u8>>,
    ) -> String {
        apply(
            connection,
            RoutineMutation::SaveTask {
                id: None,
                routine_id: routine_id.into(),
                name: name.into(),
                category: "salud y deporte".into(),
                days,
                notes: String::new(),
            },
        )
        .expect("task")
        .entity_id
        .expect("id")
    }

    #[test]
    fn parses_mutations_with_camel_case_fields() {
        let mutation: RoutineMutation = serde_json::from_value(serde_json::json!({
            "type": "setCompletion", "taskId": "t1", "date": "2026-09-23", "completed": true
        }))
        .expect("mutation");
        assert!(matches!(
            mutation,
            RoutineMutation::SetCompletion {
                completed: true,
                ..
            }
        ));
    }

    #[test]
    fn normalizes_days_and_categories() {
        assert_eq!(TaskDays::from_input(None).unwrap(), TaskDays::All);
        assert_eq!(
            TaskDays::from_input(Some(&[4, 0, 4])).unwrap(),
            TaskDays::Only(vec![0, 4])
        );
        assert_eq!(
            TaskDays::from_input(Some(&[0, 1, 2, 3, 4, 5, 6])).unwrap(),
            TaskDays::All
        );
        assert!(TaskDays::from_input(Some(&[])).is_err());
        assert!(TaskDays::from_input(Some(&[7])).is_err());
        assert_eq!(TaskDays::Only(vec![0, 2]).label(), "L X");
        assert_eq!(canonical_category(" EMOCIONAL ").unwrap(), "Emocional");
        assert!(canonical_category("Otra").is_err());
    }

    #[test]
    fn creates_tasks_and_records_completions_per_owner() {
        let connection = connection();
        let routine = seed_routine(&connection, "Mañana");
        let task = seed_task(&connection, &routine, "Tomar agua", None);
        let done = apply(
            &connection,
            RoutineMutation::SetCompletion {
                task_id: task.clone(),
                date: "2026-09-22".into(),
                completed: true,
            },
        )
        .expect("completion");
        assert!(done.changed);
        let again = apply(
            &connection,
            RoutineMutation::SetCompletion {
                task_id: task.clone(),
                date: "2026-09-22".into(),
                completed: true,
            },
        )
        .expect("idempotent completion");
        assert!(!again.changed);
        let data = load_data(&connection, "user-owner", date("2026-01-01")).expect("data");
        assert!(data.is_completed(&task, date("2026-09-22")));
        let other = load_data(&connection, "user-other", date("2026-01-01")).expect("other user");
        assert!(other.tasks.is_empty() && other.completions.is_empty());
    }

    #[test]
    fn rejects_future_paused_and_non_applicable_completions() {
        let connection = connection();
        let routine = seed_routine(&connection, "Mañana");
        let weekdays = seed_task(&connection, &routine, "Correr", Some(vec![0]));
        let future = apply(
            &connection,
            RoutineMutation::SetCompletion {
                task_id: weekdays.clone(),
                date: "2026-09-24".into(),
                completed: true,
            },
        );
        assert_eq!(future.unwrap_err().code, RoutineErrorCode::Validation);
        // 2026-09-23 is a Wednesday; the task only applies on Mondays.
        let not_applicable = apply(
            &connection,
            RoutineMutation::SetCompletion {
                task_id: weekdays.clone(),
                date: "2026-09-23".into(),
                completed: true,
            },
        );
        assert_eq!(
            not_applicable.unwrap_err().code,
            RoutineErrorCode::Validation
        );
        apply(
            &connection,
            RoutineMutation::SetTaskStatus {
                id: weekdays.clone(),
                status: RoutineTaskStatus::Paused,
            },
        )
        .expect("pause");
        let paused = apply(
            &connection,
            RoutineMutation::SetCompletion {
                task_id: weekdays,
                date: "2026-09-21".into(),
                completed: true,
            },
        );
        assert_eq!(paused.unwrap_err().code, RoutineErrorCode::Conflict);
    }

    #[test]
    fn deleting_a_task_keeps_history_for_restore() {
        let connection = connection();
        let routine = seed_routine(&connection, "Noche");
        let task = seed_task(&connection, &routine, "Leer", None);
        apply(
            &connection,
            RoutineMutation::SetCompletion {
                task_id: task.clone(),
                date: "2026-09-20".into(),
                completed: true,
            },
        )
        .expect("completion");
        apply(
            &connection,
            RoutineMutation::DeleteTask { id: task.clone() },
        )
        .expect("delete");
        assert!(load_data(&connection, "user-owner", date("2026-01-01"))
            .unwrap()
            .tasks
            .is_empty());
        apply(
            &connection,
            RoutineMutation::RestoreTask { id: task.clone() },
        )
        .expect("restore");
        let data = load_data(&connection, "user-owner", date("2026-01-01")).unwrap();
        assert_eq!(data.tasks.len(), 1);
        assert!(data.is_completed(&task, date("2026-09-20")));
    }

    #[test]
    fn protects_the_last_routine_and_routines_with_tasks() {
        let connection = connection();
        let first = seed_routine(&connection, "Mañana");
        let last = apply(
            &connection,
            RoutineMutation::DeleteRoutine { id: first.clone() },
        );
        assert_eq!(last.unwrap_err().code, RoutineErrorCode::Conflict);
        let second = seed_routine(&connection, "Noche");
        let task = seed_task(&connection, &second, "Meditar", None);
        let with_tasks = apply(
            &connection,
            RoutineMutation::DeleteRoutine { id: second.clone() },
        );
        assert_eq!(with_tasks.unwrap_err().code, RoutineErrorCode::Conflict);
        apply(&connection, RoutineMutation::DeleteTask { id: task }).expect("delete task");
        apply(&connection, RoutineMutation::DeleteRoutine { id: second }).expect("delete routine");
        let duplicate = apply(
            &connection,
            RoutineMutation::SaveRoutine {
                id: None,
                name: " mañana ".into(),
            },
        );
        assert_eq!(duplicate.unwrap_err().code, RoutineErrorCode::Conflict);
    }

    #[test]
    fn reorders_only_with_the_exact_task_set() {
        let connection = connection();
        let routine = seed_routine(&connection, "Mañana");
        let a = seed_task(&connection, &routine, "A", None);
        let b = seed_task(&connection, &routine, "B", None);
        let partial = apply(
            &connection,
            RoutineMutation::ReorderTasks {
                routine_id: routine.clone(),
                ordered_task_ids: vec![b.clone()],
            },
        );
        assert_eq!(partial.unwrap_err().code, RoutineErrorCode::Validation);
        apply(
            &connection,
            RoutineMutation::ReorderTasks {
                routine_id: routine,
                ordered_task_ids: vec![b.clone(), a.clone()],
            },
        )
        .expect("reorder");
        let data = load_data(&connection, "user-owner", date("2026-01-01")).unwrap();
        assert_eq!(
            data.tasks
                .iter()
                .map(|task| task.id.clone())
                .collect::<Vec<_>>(),
            vec![b, a]
        );
    }

    #[test]
    fn resolves_references_by_id_or_unique_name() {
        let connection = connection();
        let morning = seed_routine(&connection, "Mañana");
        let night = seed_routine(&connection, "Noche");
        let water = seed_task(&connection, &morning, "Tomar agua", None);
        seed_task(&connection, &night, "Leer", None);
        seed_task(&connection, &morning, "Leer", None);
        assert_eq!(
            resolve_routine(&connection, "user-owner", "noche")
                .unwrap()
                .id,
            night
        );
        assert_eq!(
            resolve_task(&connection, "user-owner", "tomar AGUA", None, false)
                .unwrap()
                .id,
            water
        );
        assert_eq!(
            resolve_task(&connection, "user-owner", &water, None, false)
                .unwrap()
                .id,
            water
        );
        assert!(resolve_task(&connection, "user-owner", "Leer", None, false).is_err());
        assert!(resolve_task(&connection, "user-owner", "Leer", Some(&night), false).is_ok());
        assert_eq!(
            resolve_task(&connection, "user-owner", "inexistente", None, false)
                .unwrap_err()
                .code,
            RoutineErrorCode::NotFound
        );
    }

    #[test]
    fn validates_goals_and_seeds_a_default_routine_once() {
        let connection = connection();
        assert!(ensure_default_routine(&connection, "user-owner").unwrap());
        assert!(!ensure_default_routine(&connection, "user-owner").unwrap());
        assert!(apply(
            &connection,
            RoutineMutation::SetGoal {
                category: "Emocional".into(),
                goal: 11
            }
        )
        .is_err());
        apply(
            &connection,
            RoutineMutation::SetGoal {
                category: "emocional".into(),
                goal: 6,
            },
        )
        .expect("goal");
        assert_eq!(
            load_data(&connection, "user-owner", date("2026-01-01"))
                .unwrap()
                .goal("Emocional"),
            6
        );
    }
}
