//! Agenda: eventos en bloques de 15 minutos y un anotador rápido, guardados en
//! la base SQLite de la biblioteca y separados por usuario de la biblioteca.
//! Rust valida, convierte la selección de bloques en eventos y arma la vista
//! completa; React solo la representa.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{Datelike, Local, NaiveDate, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::agenda_view::{
    build_view, date_key, long_day_label, time_label, AgendaFrame, AgendaView, AgendaViewRequest,
};

/// Length of one block of the week grid.
pub const SLOT_MINUTES: u16 = 15;
pub const DAY_MINUTES: u16 = 24 * 60;
/// Upcoming events listed by the view.
pub const UPCOMING_LIMIT: usize = 10;
pub const MIN_YEAR: i32 = 1900;
pub const MAX_YEAR: i32 = 2199;

/// A selection covers at most a full week of blocks.
const MAX_SELECTED_SLOTS: usize = 7 * (DAY_MINUTES / SLOT_MINUTES) as usize;
const MAX_EVENT_TITLE_CHARS: usize = 120;
const MAX_NOTE_CHARS: usize = 200;
const UNTITLED_EVENT: &str = "Tarea sin título";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgendaErrorCode {
    Validation,
    NotFound,
    Conflict,
    Storage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaCommandError {
    pub code: AgendaErrorCode,
    pub message: String,
}

impl AgendaCommandError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: AgendaErrorCode::Validation,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: AgendaErrorCode::NotFound,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            code: AgendaErrorCode::Conflict,
            message: message.into(),
        }
    }

    fn storage(message: impl Into<String>) -> Self {
        Self {
            code: AgendaErrorCode::Storage,
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for AgendaCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::storage(format!("No se pudo acceder a los datos de la Agenda: {error}"))
    }
}

pub type AgendaResult<T> = Result<T, AgendaCommandError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaContext {
    pub library_path: String,
    pub android_directory_uri: Option<String>,
    pub actor_library_user_id: String,
}

impl AgendaContext {
    fn owner(&self) -> &str {
        self.actor_library_user_id.trim()
    }
}

fn open_connection(context: &AgendaContext, app: &crate::host::AppHandle) -> AgendaResult<Connection> {
    if context.owner().is_empty() {
        return Err(AgendaCommandError::validation(
            "El usuario de la biblioteca es obligatorio para usar la Agenda.",
        ));
    }
    let connection = crate::database::open_user_data_connection(
        app,
        &context.library_path,
        context.android_directory_uri.as_deref(),
    )
    .map_err(AgendaCommandError::storage)?;
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM library_users WHERE id=?1)",
        [context.owner()],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(AgendaCommandError::validation(
            "El usuario de la biblioteca no está autorizado para la Agenda.",
        ));
    }
    Ok(connection)
}

/// Local date and minute of the day. Every rule that depends on "today" or
/// "now" reads this one clock.
fn local_now() -> (NaiveDate, u16) {
    let now = Local::now();
    (now.date_naive(), (now.hour() * 60 + now.minute()) as u16)
}

pub fn ensure_supported_date(date: NaiveDate) -> AgendaResult<NaiveDate> {
    if (MIN_YEAR..=MAX_YEAR).contains(&date.year()) {
        Ok(date)
    } else {
        Err(AgendaCommandError::validation(format!(
            "La fecha debe estar entre los años {MIN_YEAR} y {MAX_YEAR}."
        )))
    }
}

pub fn parse_date(value: &str) -> AgendaResult<NaiveDate> {
    let date = NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
        .map_err(|_| AgendaCommandError::validation("La fecha debe tener formato YYYY-MM-DD."))?;
    ensure_supported_date(date)
}

fn stored_date(value: &str) -> AgendaResult<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AgendaCommandError::storage("La Agenda tiene una fecha guardada inválida."))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgendaPriority {
    Urgent,
    High,
    Medium,
    Low,
}

impl AgendaPriority {
    pub const ALL: [Self; 4] = [Self::Urgent, Self::High, Self::Medium, Self::Low];
    pub const DEFAULT: Self = Self::Medium;

    fn as_str(self) -> &'static str {
        match self {
            Self::Urgent => "urgent",
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Urgent => "Urgente",
            Self::High => "Alta",
            Self::Medium => "Media",
            Self::Low => "Baja",
        }
    }

    fn from_stored(value: &str) -> AgendaResult<Self> {
        Self::ALL
            .into_iter()
            .find(|priority| priority.as_str() == value)
            .ok_or_else(|| AgendaCommandError::storage("La Agenda tiene una prioridad guardada inválida."))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventRecord {
    pub id: String,
    pub date: NaiveDate,
    pub start_minute: u16,
    /// Exclusive: the minute the event ends.
    pub end_minute: u16,
    pub title: String,
    pub priority: AgendaPriority,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteRecord {
    pub id: String,
    pub text: String,
    pub done: bool,
}

/// What the view needs from the database for one frame.
#[derive(Debug, Default)]
pub struct AgendaData {
    /// Days of the month grid that have at least one event.
    pub event_dates: BTreeSet<NaiveDate>,
    pub week_events: Vec<EventRecord>,
    /// The first [`UPCOMING_LIMIT`] events that have not ended yet.
    pub upcoming: Vec<EventRecord>,
    pub upcoming_total: usize,
    /// Pending notes, plus the ones checked today.
    pub notes: Vec<NoteRecord>,
}

type EventRow = (String, String, u16, u16, String, String);

fn query_events(
    connection: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> AgendaResult<Vec<EventRecord>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(params, |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
        ))
    })?;
    rows.map(|row| {
        let (id, date, start_minute, end_minute, title, priority): EventRow = row?;
        Ok(EventRecord {
            id,
            date: stored_date(&date)?,
            start_minute,
            end_minute,
            title,
            priority: AgendaPriority::from_stored(&priority)?,
        })
    })
    .collect()
}

pub fn load_data(connection: &Connection, owner: &str, frame: &AgendaFrame) -> AgendaResult<AgendaData> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT date FROM agenda_events
         WHERE owner_user_id=?1 AND date BETWEEN ?2 AND ?3",
    )?;
    let event_dates = statement
        .query_map(
            params![owner, date_key(frame.grid_start), date_key(frame.grid_end())],
            |row| row.get::<_, String>(0),
        )?
        .map(|date| stored_date(&date?))
        .collect::<AgendaResult<BTreeSet<_>>>()?;

    let week_events = query_events(
        connection,
        "SELECT id, date, start_minute, end_minute, title, priority FROM agenda_events
         WHERE owner_user_id=?1 AND date BETWEEN ?2 AND ?3
         ORDER BY date, start_minute",
        params![owner, date_key(frame.week_start), date_key(frame.week_end())],
    )?;

    let today = date_key(frame.today);
    let upcoming_filter = "owner_user_id=?1 AND (date>?2 OR (date=?2 AND end_minute>?3))";
    let upcoming = query_events(
        connection,
        &format!(
            "SELECT id, date, start_minute, end_minute, title, priority FROM agenda_events
             WHERE {upcoming_filter} ORDER BY date, start_minute LIMIT ?4"
        ),
        params![owner, today, frame.now_minute, UPCOMING_LIMIT as i64],
    )?;
    let upcoming_total: i64 = connection.query_row(
        &format!("SELECT COUNT(*) FROM agenda_events WHERE {upcoming_filter}"),
        params![owner, today, frame.now_minute],
        |row| row.get(0),
    )?;

    let mut statement = connection.prepare(
        "SELECT id, text, done_on FROM agenda_notes
         WHERE owner_user_id=?1 AND (done_on IS NULL OR done_on>=?2)
         ORDER BY created_at, rowid",
    )?;
    let notes = statement
        .query_map(params![owner, today], |row| {
            Ok(NoteRecord {
                id: row.get(0)?,
                text: row.get(1)?,
                done: row.get::<_, Option<String>>(2)?.is_some(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(AgendaData {
        event_dates,
        week_events,
        upcoming,
        upcoming_total: upcoming_total.max(0) as usize,
        notes,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaSlotInput {
    pub date: String,
    /// Minute of the day the block starts at.
    pub minute: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgendaMutation {
    /// Turns the selected blocks into one event per run of consecutive
    /// blocks of the same day, all with the same title and priority.
    ScheduleEvents {
        slots: Vec<AgendaSlotInput>,
        #[serde(default)]
        title: String,
        priority: AgendaPriority,
    },
    DeleteEvent {
        id: String,
    },
    AddNote {
        text: String,
    },
    SetNoteDone {
        id: String,
        done: bool,
    },
    DeleteNote {
        id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlotRun {
    pub date: NaiveDate,
    pub start_minute: u16,
    pub end_minute: u16,
}

/// Groups the selected blocks into runs of consecutive blocks of the same
/// day. Repeated blocks count once; the runs come out sorted.
pub fn group_slots(slots: &[AgendaSlotInput]) -> AgendaResult<Vec<SlotRun>> {
    if slots.is_empty() {
        return Err(AgendaCommandError::validation(
            "Elegí al menos un bloque de 15 minutos.",
        ));
    }
    if slots.len() > MAX_SELECTED_SLOTS {
        return Err(AgendaCommandError::validation(format!(
            "Se pueden agendar como máximo {MAX_SELECTED_SLOTS} bloques a la vez."
        )));
    }
    let mut by_date: BTreeMap<NaiveDate, BTreeSet<u16>> = BTreeMap::new();
    for slot in slots {
        if slot.minute >= DAY_MINUTES || slot.minute % SLOT_MINUTES != 0 {
            return Err(AgendaCommandError::validation(
                "Cada bloque debe empezar en un múltiplo de 15 minutos del día.",
            ));
        }
        by_date
            .entry(parse_date(&slot.date)?)
            .or_default()
            .insert(slot.minute);
    }
    let mut runs = Vec::new();
    for (date, minutes) in by_date {
        let mut current: Option<SlotRun> = None;
        for minute in minutes {
            match current.as_mut() {
                Some(run) if run.end_minute == minute => run.end_minute = minute + SLOT_MINUTES,
                _ => {
                    runs.extend(current.take());
                    current = Some(SlotRun {
                        date,
                        start_minute: minute,
                        end_minute: minute + SLOT_MINUTES,
                    });
                }
            }
        }
        runs.extend(current);
    }
    Ok(runs)
}

fn bounded_text(value: &str, max_chars: usize, field: &str) -> AgendaResult<String> {
    let trimmed = value.trim();
    if trimmed.chars().count() > max_chars {
        return Err(AgendaCommandError::validation(format!(
            "{field} admite como máximo {max_chars} caracteres."
        )));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AgendaCommandError::validation(format!(
            "{field} contiene caracteres no válidos."
        )));
    }
    Ok(trimmed.to_string())
}

fn run_label(run: &SlotRun) -> String {
    format!(
        "{} de {} a {}",
        long_day_label(run.date),
        time_label(run.start_minute),
        time_label(run.end_minute)
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaMutationOutcome {
    pub changed: bool,
    pub entity_ids: Vec<String>,
    pub summary: String,
}

fn outcome(changed: bool, id: &str, summary: String) -> AgendaMutationOutcome {
    AgendaMutationOutcome {
        changed,
        entity_ids: vec![id.to_string()],
        summary,
    }
}

/// Applies one mutation inside the caller's transaction.
pub fn apply_mutation(
    connection: &Connection,
    owner: &str,
    mutation: &AgendaMutation,
    today: NaiveDate,
) -> AgendaResult<AgendaMutationOutcome> {
    let timestamp = crate::finance::now();
    match mutation {
        AgendaMutation::ScheduleEvents {
            slots,
            title,
            priority,
        } => {
            let title = match bounded_text(title, MAX_EVENT_TITLE_CHARS, "El nombre de la tarea")? {
                title if title.is_empty() => UNTITLED_EVENT.to_string(),
                title => title,
            };
            let runs = group_slots(slots)?;
            let mut ids = Vec::with_capacity(runs.len());
            for run in &runs {
                let overlapping: Option<String> = connection
                    .query_row(
                        "SELECT title FROM agenda_events
                         WHERE owner_user_id=?1 AND date=?2 AND start_minute<?4 AND end_minute>?3
                         ORDER BY start_minute LIMIT 1",
                        params![owner, date_key(run.date), run.start_minute, run.end_minute],
                        |row| row.get(0),
                    )
                    .optional()?;
                if let Some(existing) = overlapping {
                    return Err(AgendaCommandError::conflict(format!(
                        "El horario del {} se superpone con «{existing}».",
                        run_label(run)
                    )));
                }
                let id = Uuid::new_v4().to_string();
                connection.execute(
                    "INSERT INTO agenda_events
                     (id, owner_user_id, date, start_minute, end_minute, title, priority, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                    params![
                        id,
                        owner,
                        date_key(run.date),
                        run.start_minute,
                        run.end_minute,
                        title,
                        priority.as_str(),
                        timestamp
                    ],
                )?;
                ids.push(id);
            }
            let summary = match runs.as_slice() {
                [run] => format!("Se agendó «{title}» el {}.", run_label(run)),
                _ => format!("Se agendaron {} eventos «{title}».", runs.len()),
            };
            Ok(AgendaMutationOutcome {
                changed: true,
                entity_ids: ids,
                summary,
            })
        }
        AgendaMutation::DeleteEvent { id } => {
            let id = id.trim();
            let title: String = connection
                .query_row(
                    "SELECT title FROM agenda_events WHERE id=?1 AND owner_user_id=?2",
                    params![id, owner],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| AgendaCommandError::not_found("El evento ya no existe."))?;
            connection.execute(
                "DELETE FROM agenda_events WHERE id=?1 AND owner_user_id=?2",
                params![id, owner],
            )?;
            Ok(outcome(true, id, format!("Se eliminó «{title}».")))
        }
        AgendaMutation::AddNote { text } => {
            let text = bounded_text(text, MAX_NOTE_CHARS, "La nota")?;
            if text.is_empty() {
                return Err(AgendaCommandError::validation("La nota es obligatoria."));
            }
            let id = Uuid::new_v4().to_string();
            connection.execute(
                "INSERT INTO agenda_notes (id, owner_user_id, text, done_on, created_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
                params![id, owner, text, timestamp],
            )?;
            Ok(outcome(true, &id, format!("Se anotó «{text}».")))
        }
        AgendaMutation::SetNoteDone { id, done } => {
            let id = id.trim();
            let done_on: Option<String> = connection
                .query_row(
                    "SELECT done_on FROM agenda_notes WHERE id=?1 AND owner_user_id=?2",
                    params![id, owner],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| AgendaCommandError::not_found("La nota ya no existe."))?;
            let summary = if *done {
                "Nota marcada como hecha."
            } else {
                "Nota marcada como pendiente."
            };
            if done_on.is_some() == *done {
                return Ok(outcome(false, id, summary.to_string()));
            }
            connection.execute(
                "UPDATE agenda_notes SET done_on=?1, updated_at=?2 WHERE id=?3 AND owner_user_id=?4",
                params![done.then(|| date_key(today)), timestamp, id, owner],
            )?;
            Ok(outcome(true, id, summary.to_string()))
        }
        AgendaMutation::DeleteNote { id } => {
            let id = id.trim();
            let deleted = connection.execute(
                "DELETE FROM agenda_notes WHERE id=?1 AND owner_user_id=?2",
                params![id, owner],
            )?;
            if deleted == 0 {
                return Err(AgendaCommandError::not_found("La nota ya no existe."));
            }
            Ok(outcome(true, id, "Se borró la nota.".to_string()))
        }
    }
}

fn load_view(
    app: &crate::host::AppHandle,
    context: &AgendaContext,
    frame: &AgendaFrame,
) -> AgendaResult<AgendaView> {
    let connection = open_connection(context, app)?;
    let data = load_data(&connection, context.owner(), frame)?;
    Ok(build_view(frame, &data))
}

pub fn agenda_get_view(
    app: crate::host::AppHandle,
    context: AgendaContext,
    request: AgendaViewRequest,
) -> AgendaResult<AgendaView> {
    let (today, now_minute) = local_now();
    let frame = AgendaFrame::resolve(&request, today, now_minute)?;
    load_view(&app, &context, &frame)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgendaMutationPayload {
    pub context: AgendaContext,
    pub mutation: AgendaMutation,
    /// The frame the view shows, returned updated after the change.
    pub request: AgendaViewRequest,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaMutationResponse {
    pub outcome: AgendaMutationOutcome,
    pub view: AgendaView,
}

pub fn agenda_apply_mutation(
    app: crate::host::AppHandle,
    payload: ApplyAgendaMutationPayload,
) -> AgendaResult<AgendaMutationResponse> {
    let (today, now_minute) = local_now();
    // Validate the frame first so a bad request never follows a saved change.
    let frame = AgendaFrame::resolve(&payload.request, today, now_minute)?;
    let mut connection = open_connection(&payload.context, &app)?;
    let transaction = connection.transaction()?;
    let outcome = apply_mutation(&transaction, payload.context.owner(), &payload.mutation, today)?;
    transaction.commit()?;
    drop(connection);
    crate::database::sync_user_data_connection(&app, payload.context.android_directory_uri.as_deref())
        .map_err(AgendaCommandError::storage)?;
    let view = load_view(&app, &payload.context, &frame)?;
    Ok(AgendaMutationResponse { outcome, view })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    const OWNER: &str = "user-owner";

    pub(crate) fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory SQLite");
        crate::database::migrate(&connection).expect("migration");
        connection
    }

    pub(crate) fn date(value: &str) -> NaiveDate {
        parse_date(value).expect("date")
    }

    fn slot(date: &str, minute: u16) -> AgendaSlotInput {
        AgendaSlotInput {
            date: date.into(),
            minute,
        }
    }

    fn apply(connection: &Connection, mutation: AgendaMutation) -> AgendaResult<AgendaMutationOutcome> {
        apply_mutation(connection, OWNER, &mutation, date("2026-09-24"))
    }

    fn schedule(connection: &Connection, slots: Vec<AgendaSlotInput>, title: &str) -> AgendaResult<AgendaMutationOutcome> {
        apply(
            connection,
            AgendaMutation::ScheduleEvents {
                slots,
                title: title.into(),
                priority: AgendaPriority::High,
            },
        )
    }

    fn frame(today: &str, now_minute: u16) -> AgendaFrame {
        AgendaFrame::resolve(&AgendaViewRequest::default(), date(today), now_minute).expect("frame")
    }

    #[test]
    fn parses_mutations_with_camel_case_fields() {
        let mutation: AgendaMutation = serde_json::from_value(serde_json::json!({
            "type": "scheduleEvents",
            "slots": [{ "date": "2026-09-24", "minute": 540 }],
            "title": "Reunión",
            "priority": "urgent"
        }))
        .expect("mutation");
        assert!(matches!(
            mutation,
            AgendaMutation::ScheduleEvents {
                priority: AgendaPriority::Urgent,
                ..
            }
        ));
        let note: AgendaMutation = serde_json::from_value(serde_json::json!({
            "type": "setNoteDone", "id": "n1", "done": true
        }))
        .expect("note mutation");
        assert!(matches!(note, AgendaMutation::SetNoteDone { done: true, .. }));
    }

    #[test]
    fn groups_selected_blocks_into_runs_per_day() {
        let runs = group_slots(&[
            slot("2026-09-24", 555),
            slot("2026-09-24", 540),
            slot("2026-09-24", 540),
            slot("2026-09-24", 600),
            slot("2026-09-22", 0),
            slot("2026-09-22", 1425),
        ])
        .expect("runs");
        assert_eq!(
            runs,
            vec![
                SlotRun { date: date("2026-09-22"), start_minute: 0, end_minute: 15 },
                SlotRun { date: date("2026-09-22"), start_minute: 1425, end_minute: 1440 },
                SlotRun { date: date("2026-09-24"), start_minute: 540, end_minute: 570 },
                SlotRun { date: date("2026-09-24"), start_minute: 600, end_minute: 615 },
            ]
        );
    }

    #[test]
    fn rejects_invalid_selections() {
        assert!(group_slots(&[]).is_err());
        assert!(group_slots(&[slot("2026-09-24", 545)]).is_err());
        assert!(group_slots(&[slot("2026-09-24", 1440)]).is_err());
        assert!(group_slots(&[slot("24/09/2026", 540)]).is_err());
        assert!(group_slots(&[slot("1800-01-01", 540)]).is_err());
        let too_many = (0..8)
            .flat_map(|day| (0..96).map(move |index| slot(&format!("2026-09-{:02}", day + 1), index * 15)))
            .collect::<Vec<_>>();
        assert!(group_slots(&too_many).is_err());
    }

    #[test]
    fn schedules_events_and_rejects_overlaps() {
        let connection = connection();
        let created = schedule(
            &connection,
            vec![slot("2026-09-24", 540), slot("2026-09-24", 555), slot("2026-09-25", 600)],
            "  Reunión de equipo ",
        )
        .expect("schedule");
        assert_eq!(created.entity_ids.len(), 2);
        assert_eq!(created.summary, "Se agendaron 2 eventos «Reunión de equipo».");

        let conflict = schedule(&connection, vec![slot("2026-09-24", 555)], "Otra").unwrap_err();
        assert_eq!(conflict.code, AgendaErrorCode::Conflict);
        assert!(conflict.message.contains("«Reunión de equipo»"));

        // Right after the event ends is free.
        let adjacent = schedule(&connection, vec![slot("2026-09-24", 570)], "").expect("adjacent");
        assert_eq!(
            adjacent.summary,
            "Se agendó «Tarea sin título» el jueves 24 de septiembre de 09:30 a 09:45."
        );

        let data = load_data(&connection, OWNER, &frame("2026-09-24", 0)).expect("data");
        let week: Vec<_> = data
            .week_events
            .iter()
            .map(|event| (event.date, event.start_minute, event.end_minute, event.title.as_str()))
            .collect();
        assert_eq!(
            week,
            vec![
                (date("2026-09-24"), 540, 570, "Reunión de equipo"),
                (date("2026-09-24"), 570, 585, "Tarea sin título"),
                (date("2026-09-25"), 600, 615, "Reunión de equipo"),
            ]
        );
        assert_eq!(data.week_events[0].priority, AgendaPriority::High);
        assert!(data.event_dates.contains(&date("2026-09-25")));
    }

    #[test]
    fn upcoming_events_skip_the_ones_already_finished() {
        let connection = connection();
        schedule(&connection, vec![slot("2026-09-23", 600)], "Ayer").unwrap();
        schedule(&connection, vec![slot("2026-09-24", 480)], "Temprano").unwrap();
        schedule(&connection, vec![slot("2026-09-24", 540)], "En curso").unwrap();
        schedule(&connection, vec![slot("2026-10-02", 60)], "Próxima semana").unwrap();

        let data = load_data(&connection, OWNER, &frame("2026-09-24", 545)).expect("data");
        let titles: Vec<_> = data.upcoming.iter().map(|event| event.title.as_str()).collect();
        assert_eq!(titles, vec!["En curso", "Próxima semana"]);
        assert_eq!(data.upcoming_total, 2);
    }

    #[test]
    fn upcoming_events_are_limited_but_counted() {
        let connection = connection();
        let slots = (0..12).map(|index| slot("2026-09-25", index * 30)).collect();
        schedule(&connection, slots, "Bloque").unwrap();
        let data = load_data(&connection, OWNER, &frame("2026-09-24", 0)).expect("data");
        assert_eq!(data.upcoming.len(), UPCOMING_LIMIT);
        assert_eq!(data.upcoming_total, 12);
    }

    #[test]
    fn events_belong_to_their_owner() {
        let connection = connection();
        connection
            .execute(
                "INSERT INTO library_users (id, name, normalized_name, role_id, created_at, updated_at)
                 VALUES ('user-guest', 'Guest', 'guest', 'role-guest', '0', '0')",
                [],
            )
            .unwrap();
        let created = schedule(&connection, vec![slot("2026-09-24", 540)], "Privado").unwrap();
        let id = created.entity_ids[0].clone();

        let guest = load_data(&connection, "user-guest", &frame("2026-09-24", 0)).expect("guest");
        assert!(guest.week_events.is_empty());
        // Another user may use the same hour.
        apply_mutation(
            &connection,
            "user-guest",
            &AgendaMutation::ScheduleEvents {
                slots: vec![slot("2026-09-24", 540)],
                title: "Suyo".into(),
                priority: AgendaPriority::Low,
            },
            date("2026-09-24"),
        )
        .expect("guest schedule");
        let error = apply_mutation(
            &connection,
            "user-guest",
            &AgendaMutation::DeleteEvent { id: id.clone() },
            date("2026-09-24"),
        )
        .unwrap_err();
        assert_eq!(error.code, AgendaErrorCode::NotFound);

        let deleted = apply(&connection, AgendaMutation::DeleteEvent { id }).expect("delete");
        assert_eq!(deleted.summary, "Se eliminó «Privado».");
        assert!(load_data(&connection, OWNER, &frame("2026-09-24", 0)).unwrap().week_events.is_empty());
    }

    #[test]
    fn notes_checked_today_stay_until_the_day_ends() {
        let connection = connection();
        assert!(apply(&connection, AgendaMutation::AddNote { text: "   ".into() }).is_err());
        let first = apply(&connection, AgendaMutation::AddNote { text: " Responder mails ".into() })
            .unwrap()
            .entity_ids[0]
            .clone();
        let second = apply(&connection, AgendaMutation::AddNote { text: "Comprar pan".into() })
            .unwrap()
            .entity_ids[0]
            .clone();

        let done = apply(&connection, AgendaMutation::SetNoteDone { id: first.clone(), done: true }).unwrap();
        assert!(done.changed);
        let again = apply(&connection, AgendaMutation::SetNoteDone { id: first.clone(), done: true }).unwrap();
        assert!(!again.changed);

        let today = load_data(&connection, OWNER, &frame("2026-09-24", 0)).unwrap();
        let notes: Vec<_> = today.notes.iter().map(|note| (note.text.as_str(), note.done)).collect();
        assert_eq!(notes, vec![("Responder mails", true), ("Comprar pan", false)]);

        let tomorrow = load_data(&connection, OWNER, &frame("2026-09-25", 0)).unwrap();
        let notes: Vec<_> = tomorrow.notes.iter().map(|note| note.text.as_str()).collect();
        assert_eq!(notes, vec!["Comprar pan"]);

        apply(&connection, AgendaMutation::DeleteNote { id: second.clone() }).unwrap();
        let error = apply(&connection, AgendaMutation::DeleteNote { id: second }).unwrap_err();
        assert_eq!(error.code, AgendaErrorCode::NotFound);
    }

    #[test]
    fn rejects_long_or_control_text() {
        let connection = connection();
        let long = "x".repeat(MAX_EVENT_TITLE_CHARS + 1);
        assert!(schedule(&connection, vec![slot("2026-09-24", 540)], &long).is_err());
        assert!(apply(&connection, AgendaMutation::AddNote { text: "a\u{7}b".into() }).is_err());
    }
}
