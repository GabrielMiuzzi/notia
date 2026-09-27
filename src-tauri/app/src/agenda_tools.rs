//! Agent tools over the Agenda of Notia: events on the 15-minute grid of a
//! day and the day's notepad. Every write is validated inside a transaction,
//! so the preview shown before confirmation is exactly what the execution
//! applies. Google Calendar has its own tools (see `mail_tools`).

use chrono::{Duration, NaiveDate};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::agenda::{
    apply_mutation, events_between, load_notes, parse_date, with_transaction, AgendaCommandError, AgendaContext,
    AgendaMutation, AgendaPriority, AgendaResult, AgendaSlotInput, DAY_MINUTES, SLOT_MINUTES,
};
use crate::agenda_view::{date_key, time_label};
use crate::host::Emitter;

pub const AGENDA_READ_TOOLS: [&str; 1] = ["list_agenda"];
pub const AGENDA_WRITE_TOOLS: [&str; 5] = [
    "create_agenda_event",
    "delete_agenda_event",
    "add_agenda_note",
    "set_agenda_note_done",
    "delete_agenda_note",
];
/// Emitted after the agent or the Google Calendar sync changed the Agenda, so
/// open views read it again.
pub const AGENDA_DATA_CHANGED_EVENT: &str = "notia:agenda-data-changed";
/// Days `list_agenda` reads when no end is given, and at most.
const DEFAULT_LIST_DAYS: i64 = 30;
const MAX_LIST_DAYS: i64 = 92;

pub fn is_agenda_tool(name: &str) -> bool {
    AGENDA_READ_TOOLS.contains(&name) || is_agenda_write_tool(name)
}

pub fn is_agenda_write_tool(name: &str) -> bool {
    AGENDA_WRITE_TOOLS.contains(&name)
}

fn text(arguments: &Value, name: &str) -> Option<String> {
    arguments.get(name).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

fn required(arguments: &Value, name: &str) -> AgendaResult<String> {
    text(arguments, name).ok_or_else(|| AgendaCommandError::validation(format!("Falta el campo {name}.")))
}

/// Minute of the day of `HH:MM` (`24:00` is the end of the day).
fn minute_of(value: &str, field: &str) -> AgendaResult<u16> {
    let invalid = || AgendaCommandError::validation(format!("{field} debe tener el formato HH:MM."));
    let (hours, minutes) = value.trim().split_once(':').ok_or_else(invalid)?;
    let (hours, minutes) = (hours.parse::<u16>().map_err(|_| invalid())?, minutes.parse::<u16>().map_err(|_| invalid())?);
    let minute = hours * 60 + minutes;
    if minutes >= 60 || minute > DAY_MINUTES {
        return Err(invalid());
    }
    Ok(minute)
}

fn priority(arguments: &Value) -> AgendaResult<AgendaPriority> {
    Ok(match text(arguments, "priority").map(|value| value.to_lowercase()).as_deref() {
        None | Some("medium" | "media") => AgendaPriority::Medium,
        Some("urgent" | "urgente") => AgendaPriority::Urgent,
        Some("high" | "alta") => AgendaPriority::High,
        Some("low" | "baja") => AgendaPriority::Low,
        Some(_) => return Err(AgendaCommandError::validation("La prioridad debe ser urgent, high, medium o low.")),
    })
}

/// The 15-minute blocks of `start`–`end` on `date`: the start rounds down
/// and the end up to the grid, so the event covers the time asked for.
fn blocks(date: &str, start: u16, end: u16) -> AgendaResult<Vec<AgendaSlotInput>> {
    let first = start - start % SLOT_MINUTES;
    let last = end.div_ceil(SLOT_MINUTES) * SLOT_MINUTES;
    if last <= first || last > DAY_MINUTES {
        return Err(AgendaCommandError::validation(
            "El evento tiene que terminar el mismo día después de empezar; para uno que pasa la medianoche, agendá dos.",
        ));
    }
    Ok((first..last).step_by(usize::from(SLOT_MINUTES)).map(|minute| AgendaSlotInput { date: date.to_string(), minute }).collect())
}

fn tool_mutation(name: &str, arguments: &Value) -> AgendaResult<AgendaMutation> {
    Ok(match name {
        "create_agenda_event" => {
            let date = date_key(parse_date(&required(arguments, "date")?)?);
            let start = minute_of(&required(arguments, "start")?, "start")?;
            let end = minute_of(&required(arguments, "end")?, "end")?;
            AgendaMutation::ScheduleEvents {
                slots: blocks(&date, start, end)?,
                title: required(arguments, "title")?,
                priority: priority(arguments)?,
            }
        }
        "delete_agenda_event" => AgendaMutation::DeleteEvent { id: required(arguments, "eventId")? },
        "add_agenda_note" => AgendaMutation::AddNote { text: required(arguments, "text")? },
        "set_agenda_note_done" => AgendaMutation::SetNoteDone {
            id: required(arguments, "noteId")?,
            done: arguments.get("done").and_then(Value::as_bool).unwrap_or(true),
        },
        "delete_agenda_note" => AgendaMutation::DeleteNote { id: required(arguments, "noteId")? },
        _ => return Err(AgendaCommandError::validation("La herramienta de Agenda no existe.")),
    })
}

/// Validates a write and returns the summary shown in the confirmation. The
/// transaction is rolled back, so nothing is saved.
pub fn preview_tool(app: &crate::host::AppHandle, context: &AgendaContext, name: &str, arguments: &Value) -> AgendaResult<String> {
    let mutation = tool_mutation(name, arguments)?;
    with_transaction(app, context, false, |transaction, owner, today| apply_mutation(transaction, owner, &mutation, today))
        .map(|outcome| outcome.summary)
}

pub fn execute_tool(app: &crate::host::AppHandle, context: &AgendaContext, name: &str, arguments: &Value) -> AgendaResult<Value> {
    if !is_agenda_write_tool(name) {
        return with_transaction(app, context, false, |transaction, owner, today| read_agenda(transaction, owner, arguments, today));
    }
    let mutation = tool_mutation(name, arguments)?;
    let outcome = with_transaction(app, context, true, |transaction, owner, today| apply_mutation(transaction, owner, &mutation, today))?;
    if outcome.changed {
        if let Err(error) = app.emit(AGENDA_DATA_CHANGED_EVENT, ()) {
            log::error!("[notia:agenda] evento de cambio no emitido: {error}");
        }
    }
    Ok(json!({ "ok": true, "changed": outcome.changed, "result": outcome }))
}

/// Events of a range of days (today and the next 30 by default) and the
/// notepad: pending notes and those checked today.
fn read_agenda(connection: &Connection, owner: &str, arguments: &Value, today: NaiveDate) -> AgendaResult<Value> {
    let from = text(arguments, "from").map(|value| parse_date(&value)).transpose()?.unwrap_or(today);
    let to = text(arguments, "to").map(|value| parse_date(&value)).transpose()?.unwrap_or(from + Duration::days(DEFAULT_LIST_DAYS));
    if to < from || (to - from).num_days() > MAX_LIST_DAYS {
        return Err(AgendaCommandError::validation(format!(
            "El rango va de from a to, de hasta {MAX_LIST_DAYS} días."
        )));
    }
    let events = events_between(connection, owner, from, to)?
        .into_iter()
        .map(|event| {
            json!({
                "id": event.id,
                "date": date_key(event.date),
                "start": time_label(event.start_minute),
                "end": time_label(event.end_minute),
                "title": event.title,
                "priority": event.priority.as_str(),
            })
        })
        .collect::<Vec<_>>();
    let notes = load_notes(connection, owner, &date_key(today))?
        .into_iter()
        .map(|note| json!({ "id": note.id, "text": note.text, "done": note.done }))
        .collect::<Vec<_>>();
    Ok(json!({ "from": date_key(from), "to": date_key(to), "events": events, "notes": notes }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agenda::tests::{connection, date};

    const OWNER: &str = "user-owner";

    fn run(connection: &Connection, name: &str, arguments: Value) -> AgendaResult<crate::agenda::AgendaMutationOutcome> {
        apply_mutation(connection, OWNER, &tool_mutation(name, &arguments)?, date("2026-09-27"))
    }

    #[test]
    fn a_concert_is_scheduled_on_the_grid_and_read_back() {
        let connection = connection();
        // «21:00 a 23:59» covers until the end of the day.
        let outcome = run(
            &connection,
            "create_agenda_event",
            json!({ "date": "2026-10-21", "start": "21:00", "end": "23:59", "title": "IRON MAIDEN en Huracán", "priority": "alta" }),
        )
        .expect("scheduled");
        assert!(outcome.changed);
        let read = read_agenda(&connection, OWNER, &json!({}), date("2026-09-27")).expect("read");
        let event = &read["events"][0];
        assert_eq!(
            (event["date"].as_str(), event["start"].as_str(), event["end"].as_str(), event["title"].as_str(), event["priority"].as_str()),
            (Some("2026-10-21"), Some("21:00"), Some("24:00"), Some("IRON MAIDEN en Huracán"), Some("high"))
        );
        // Another event at the same time is allowed: the week shows both.
        run(&connection, "create_agenda_event", json!({ "date": "2026-10-21", "start": "22:00", "end": "23:00", "title": "Otra" }))
            .expect("overlap");
        let read = read_agenda(&connection, OWNER, &json!({}), date("2026-09-27")).expect("read");
        assert_eq!(read["events"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn times_are_validated_and_rounded_to_the_grid() {
        assert_eq!(minute_of("21:10", "start").expect("time"), 1270);
        assert_eq!(minute_of("24:00", "end").expect("end of day"), DAY_MINUTES);
        assert!(minute_of("25:00", "end").is_err() && minute_of("9", "start").is_err() && minute_of("10:75", "start").is_err());
        let slots = blocks("2026-10-21", 1270, 1280).expect("blocks");
        assert_eq!(slots.iter().map(|slot| slot.minute).collect::<Vec<_>>(), [1260, 1275]);
        assert!(blocks("2026-10-21", 1320, 60).is_err(), "past midnight needs two events");
    }

    #[test]
    fn notes_are_added_checked_and_removed() {
        let connection = connection();
        let added = run(&connection, "add_agenda_note", json!({ "text": "Comprar remera de Iron Maiden" })).expect("added");
        let id = added.entity_ids[0].clone();
        run(&connection, "set_agenda_note_done", json!({ "noteId": id })).expect("done");
        let read = read_agenda(&connection, OWNER, &json!({}), date("2026-09-27")).expect("read");
        assert_eq!(read["notes"][0]["done"], json!(true));
        run(&connection, "delete_agenda_note", json!({ "noteId": id })).expect("deleted");
        assert!(tool_mutation("list_agenda", &json!({})).is_err());
        assert!(read_agenda(&connection, OWNER, &json!({ "from": "2026-10-01", "to": "2027-03-01" }), date("2026-09-27")).is_err());
    }
}
