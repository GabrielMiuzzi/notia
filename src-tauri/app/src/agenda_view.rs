//! Pure derivation of the Agenda view: the month grid, the week, the
//! upcoming events, the notes and every label the view shows.

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::agenda::{
    ensure_supported_date, parse_date, AgendaCommandError, AgendaData, AgendaPriority,
    AgendaResult, EventRecord, DAY_MINUTES, SLOT_MINUTES,
};

const MONTH_NAMES: [&str; 12] = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
];
const WEEKDAY_SHORT: [&str; 7] = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const WEEKDAY_LONG: [&str; 7] = [
    "lunes",
    "martes",
    "miércoles",
    "jueves",
    "viernes",
    "sábado",
    "domingo",
];
/// Six weeks, so every month fits whatever day it starts on.
const MONTH_GRID_DAYS: i64 = 42;

/// Which month and day the view shows. Both default to today.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaViewRequest {
    #[serde(default)]
    pub selected_date: Option<String>,
    /// `YYYY-MM`; defaults to the month of the selected day.
    #[serde(default)]
    pub month: Option<String>,
}

/// The dates one view covers, resolved from the request and the local clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgendaFrame {
    pub today: NaiveDate,
    pub now_minute: u16,
    pub selected: NaiveDate,
    pub month_start: NaiveDate,
    /// Monday of the first row of the month grid.
    pub grid_start: NaiveDate,
    /// Monday of the selected day's week.
    pub week_start: NaiveDate,
}

impl AgendaFrame {
    pub fn resolve(request: &AgendaViewRequest, today: NaiveDate, now_minute: u16) -> AgendaResult<Self> {
        let selected = match non_empty(&request.selected_date) {
            Some(value) => parse_date(value)?,
            None => today,
        };
        let month_start = match non_empty(&request.month) {
            Some(value) => parse_month(value)?,
            None => first_of_month(selected),
        };
        Ok(Self {
            today,
            now_minute,
            selected,
            month_start,
            grid_start: monday_of(month_start),
            week_start: monday_of(selected),
        })
    }

    pub fn grid_end(&self) -> NaiveDate {
        self.grid_start + Duration::days(MONTH_GRID_DAYS - 1)
    }

    pub fn week_end(&self) -> NaiveDate {
        self.week_start + Duration::days(6)
    }
}

fn non_empty(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|value| !value.is_empty())
}

fn parse_month(value: &str) -> AgendaResult<NaiveDate> {
    let start = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| AgendaCommandError::validation("El mes debe tener formato YYYY-MM."))?;
    ensure_supported_date(start)
}

fn first_of_month(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap_or(date)
}

fn monday_of(date: NaiveDate) -> NaiveDate {
    date - Duration::days(weekday_index(date) as i64)
}

fn shift_month(month_start: NaiveDate, delta: i32) -> NaiveDate {
    let index = month_start.year() * 12 + month_start.month0() as i32 + delta;
    NaiveDate::from_ymd_opt(index.div_euclid(12), index.rem_euclid(12) as u32 + 1, 1).unwrap_or(month_start)
}

fn weekday_index(date: NaiveDate) -> usize {
    date.weekday().num_days_from_monday() as usize
}

fn month_name(date: NaiveDate) -> &'static str {
    MONTH_NAMES[date.month0() as usize]
}

fn month_short(date: NaiveDate) -> String {
    month_name(date).chars().take(3).collect()
}

pub fn date_key(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn month_key(date: NaiveDate) -> String {
    date.format("%Y-%m").to_string()
}

pub fn time_label(minute: u16) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

/// «jueves 24 de septiembre».
pub fn long_day_label(date: NaiveDate) -> String {
    format!(
        "{} {} de {}",
        WEEKDAY_LONG[weekday_index(date)],
        date.day(),
        month_name(date)
    )
}

fn count_label(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

fn capitalized(value: &str) -> String {
    let mut chars = value.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// «21 – 27 sep 2026», or «28 sep – 4 oct 2026» across two months.
fn week_label(start: NaiveDate, end: NaiveDate) -> String {
    let start_month = if start.month() == end.month() {
        String::new()
    } else {
        format!(" {}", month_short(start))
    };
    format!(
        "{}{start_month} – {} {} {}",
        start.day(),
        end.day(),
        month_short(end),
        end.year()
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaView {
    pub today: String,
    pub today_label: String,
    pub summary_label: String,
    pub selected_date: String,
    pub slot_minutes: u16,
    pub month: AgendaMonth,
    pub week: AgendaWeek,
    pub time_slots: Vec<AgendaTimeSlot>,
    pub priorities: Vec<AgendaPriorityOption>,
    pub default_priority: AgendaPriority,
    pub upcoming: AgendaUpcoming,
    pub notes: AgendaNotes,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaMonth {
    pub key: String,
    pub label: String,
    pub prev_month: String,
    pub next_month: String,
    pub weekdays: [&'static str; 7],
    pub cells: Vec<AgendaMonthCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaMonthCell {
    pub date: String,
    pub day: u32,
    pub in_month: bool,
    pub is_today: bool,
    pub is_selected: bool,
    pub has_events: bool,
    pub aria_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaWeek {
    pub label: String,
    pub prev_date: String,
    pub next_date: String,
    pub days: Vec<AgendaWeekDay>,
    pub events: Vec<AgendaEventView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaWeekDay {
    pub date: String,
    pub short_name: &'static str,
    pub day: u32,
    pub long_label: String,
    pub is_today: bool,
    pub is_selected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaTimeSlot {
    pub minute: u16,
    pub label: String,
    pub is_hour: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaPriorityOption {
    pub key: AgendaPriority,
    pub label: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaEventView {
    pub id: String,
    pub date: String,
    pub start_minute: u16,
    pub end_minute: u16,
    pub title: String,
    pub priority: AgendaPriority,
    pub priority_label: &'static str,
    /// «09:00–10:00».
    pub time_label: String,
    /// «Lun 21 sep · 09:00–10:00».
    pub when_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaUpcoming {
    pub events: Vec<AgendaEventView>,
    pub total: usize,
    pub label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaNotes {
    pub items: Vec<AgendaNoteView>,
    pub pending: usize,
    pub pending_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaNoteView {
    pub id: String,
    pub text: String,
    pub done: bool,
}

fn event_view(event: &EventRecord) -> AgendaEventView {
    let time = format!(
        "{}–{}",
        time_label(event.start_minute),
        time_label(event.end_minute)
    );
    AgendaEventView {
        id: event.id.clone(),
        date: date_key(event.date),
        start_minute: event.start_minute,
        end_minute: event.end_minute,
        title: event.title.clone(),
        priority: event.priority,
        priority_label: event.priority.label(),
        when_label: format!(
            "{} {} {} · {time}",
            WEEKDAY_SHORT[weekday_index(event.date)],
            event.date.day(),
            month_short(event.date)
        ),
        time_label: time,
    }
}

fn month_view(frame: &AgendaFrame, data: &AgendaData) -> AgendaMonth {
    let cells = (0..MONTH_GRID_DAYS)
        .map(|offset| {
            let date = frame.grid_start + Duration::days(offset);
            let has_events = data.event_dates.contains(&date);
            AgendaMonthCell {
                date: date_key(date),
                day: date.day(),
                in_month: date.month() == frame.month_start.month(),
                is_today: date == frame.today,
                is_selected: date == frame.selected,
                has_events,
                aria_label: format!(
                    "{}{}",
                    long_day_label(date),
                    if has_events { ", con tareas" } else { "" }
                ),
            }
        })
        .collect();
    AgendaMonth {
        key: month_key(frame.month_start),
        label: format!(
            "{} {}",
            capitalized(month_name(frame.month_start)),
            frame.month_start.year()
        ),
        prev_month: month_key(shift_month(frame.month_start, -1)),
        next_month: month_key(shift_month(frame.month_start, 1)),
        weekdays: WEEKDAY_SHORT,
        cells,
    }
}

fn week_view(frame: &AgendaFrame, data: &AgendaData) -> AgendaWeek {
    let days = (0..7)
        .map(|offset| {
            let date = frame.week_start + Duration::days(offset);
            AgendaWeekDay {
                date: date_key(date),
                short_name: WEEKDAY_SHORT[offset as usize],
                day: date.day(),
                long_label: long_day_label(date),
                is_today: date == frame.today,
                is_selected: date == frame.selected,
            }
        })
        .collect();
    AgendaWeek {
        label: week_label(frame.week_start, frame.week_end()),
        prev_date: date_key(frame.selected - Duration::days(7)),
        next_date: date_key(frame.selected + Duration::days(7)),
        days,
        events: data.week_events.iter().map(event_view).collect(),
    }
}

pub fn build_view(frame: &AgendaFrame, data: &AgendaData) -> AgendaView {
    let pending = data.notes.iter().filter(|note| !note.done).count();
    let upcoming_events: Vec<_> = data.upcoming.iter().map(event_view).collect();
    let upcoming_label = if data.upcoming_total == 0 {
        String::new()
    } else {
        format!("Mostrando {} de {}", upcoming_events.len(), data.upcoming_total)
    };
    AgendaView {
        today: date_key(frame.today),
        today_label: format!("{} de {}", long_day_label(frame.today), frame.today.year()),
        summary_label: format!(
            "{} · {}",
            count_label(data.upcoming_total, "evento próximo", "eventos próximos"),
            count_label(pending, "tarea pendiente", "tareas pendientes")
        ),
        selected_date: date_key(frame.selected),
        slot_minutes: SLOT_MINUTES,
        month: month_view(frame, data),
        week: week_view(frame, data),
        time_slots: (0..DAY_MINUTES)
            .step_by(SLOT_MINUTES as usize)
            .map(|minute| AgendaTimeSlot {
                minute,
                label: time_label(minute),
                is_hour: minute % 60 == 0,
            })
            .collect(),
        priorities: AgendaPriority::ALL
            .into_iter()
            .map(|key| AgendaPriorityOption {
                key,
                label: key.label(),
            })
            .collect(),
        default_priority: AgendaPriority::DEFAULT,
        upcoming: AgendaUpcoming {
            events: upcoming_events,
            total: data.upcoming_total,
            label: upcoming_label,
        },
        notes: AgendaNotes {
            items: data
                .notes
                .iter()
                .map(|note| AgendaNoteView {
                    id: note.id.clone(),
                    text: note.text.clone(),
                    done: note.done,
                })
                .collect(),
            pending,
            pending_label: count_label(pending, "pendiente", "pendientes"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agenda::{AgendaErrorCode, NoteRecord};

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("date")
    }

    fn request(selected_date: Option<&str>, month: Option<&str>) -> AgendaViewRequest {
        AgendaViewRequest {
            selected_date: selected_date.map(str::to_string),
            month: month.map(str::to_string),
        }
    }

    fn event(day: &str, start_minute: u16, end_minute: u16, title: &str) -> EventRecord {
        EventRecord {
            id: format!("{day}-{start_minute}"),
            date: date(day),
            start_minute,
            end_minute,
            title: title.into(),
            priority: AgendaPriority::Urgent,
        }
    }

    #[test]
    fn frame_defaults_to_today_and_its_month() {
        let frame = AgendaFrame::resolve(&request(None, Some(" ")), date("2026-09-24"), 600).unwrap();
        assert_eq!(frame.selected, date("2026-09-24"));
        assert_eq!(frame.month_start, date("2026-09-01"));
        assert_eq!(frame.grid_start, date("2026-08-31"));
        assert_eq!(frame.grid_end(), date("2026-10-11"));
        assert_eq!(frame.week_start, date("2026-09-21"));
        assert_eq!(frame.week_end(), date("2026-09-27"));
    }

    #[test]
    fn frame_keeps_the_selected_day_while_browsing_months() {
        let frame = AgendaFrame::resolve(
            &request(Some("2026-09-24"), Some("2026-11")),
            date("2026-09-24"),
            0,
        )
        .unwrap();
        assert_eq!(frame.selected, date("2026-09-24"));
        assert_eq!(frame.month_start, date("2026-11-01"));
        assert_eq!(frame.grid_start, date("2026-10-26"));
    }

    #[test]
    fn frame_rejects_invalid_requests() {
        let today = date("2026-09-24");
        for bad in [request(Some("2026-13-01"), None), request(None, Some("2026-9-x")), request(None, Some("1500-01"))] {
            let error = AgendaFrame::resolve(&bad, today, 0).unwrap_err();
            assert_eq!(error.code, AgendaErrorCode::Validation);
        }
    }

    #[test]
    fn builds_the_month_grid_and_navigation() {
        let frame = AgendaFrame::resolve(&request(Some("2026-09-22"), None), date("2026-09-24"), 0).unwrap();
        let data = AgendaData {
            event_dates: [date("2026-09-24"), date("2026-10-01")].into_iter().collect(),
            ..AgendaData::default()
        };
        let view = build_view(&frame, &data);
        let month = &view.month;
        assert_eq!(month.key, "2026-09");
        assert_eq!(month.label, "Septiembre 2026");
        assert_eq!((month.prev_month.as_str(), month.next_month.as_str()), ("2026-08", "2026-10"));
        assert_eq!(month.cells.len(), 42);
        assert_eq!(month.cells[0].date, "2026-08-31");
        assert!(!month.cells[0].in_month);
        let today = month.cells.iter().find(|cell| cell.is_today).unwrap();
        assert_eq!(today.date, "2026-09-24");
        assert!(today.has_events);
        assert_eq!(today.aria_label, "jueves 24 de septiembre, con tareas");
        let selected: Vec<_> = month.cells.iter().filter(|cell| cell.is_selected).map(|cell| cell.day).collect();
        assert_eq!(selected, vec![22]);
        assert_eq!(view.selected_date, "2026-09-22");
        assert_eq!(view.today_label, "jueves 24 de septiembre de 2026");
    }

    #[test]
    fn wraps_months_across_years() {
        assert_eq!(shift_month(date("2026-01-01"), -1), date("2025-12-01"));
        assert_eq!(shift_month(date("2026-12-01"), 1), date("2027-01-01"));
    }

    #[test]
    fn builds_the_week_with_its_events() {
        let frame = AgendaFrame::resolve(&request(Some("2026-10-01"), None), date("2026-09-24"), 0).unwrap();
        let data = AgendaData {
            week_events: vec![event("2026-09-29", 540, 600, "Reunión")],
            ..AgendaData::default()
        };
        let week = build_view(&frame, &data).week;
        assert_eq!(week.label, "28 sep – 4 oct 2026");
        assert_eq!((week.prev_date.as_str(), week.next_date.as_str()), ("2026-09-24", "2026-10-08"));
        assert_eq!(week.days[0].date, "2026-09-28");
        assert_eq!(week.days[3].short_name, "Jue");
        assert!(week.days[3].is_selected);
        assert_eq!(week.days[3].long_label, "jueves 1 de octubre");
        assert_eq!(week.events[0].time_label, "09:00–10:00");
        assert_eq!(week.events[0].when_label, "Mar 29 sep · 09:00–10:00");
        assert_eq!(week.events[0].priority_label, "Urgente");

        let same_month = AgendaFrame::resolve(&request(None, None), date("2026-09-24"), 0).unwrap();
        assert_eq!(build_view(&same_month, &AgendaData::default()).week.label, "21 – 27 sep 2026");
    }

    #[test]
    fn labels_counts_and_time_slots() {
        let frame = AgendaFrame::resolve(&request(None, None), date("2026-09-24"), 0).unwrap();
        let data = AgendaData {
            upcoming: vec![event("2026-09-24", 1425, 1440, "Última")],
            upcoming_total: 1,
            notes: vec![
                NoteRecord { id: "a".into(), text: "Uno".into(), done: false },
                NoteRecord { id: "b".into(), text: "Dos".into(), done: true },
            ],
            ..AgendaData::default()
        };
        let view = build_view(&frame, &data);
        assert_eq!(view.summary_label, "1 evento próximo · 1 tarea pendiente");
        assert_eq!(view.upcoming.label, "Mostrando 1 de 1");
        assert_eq!(view.upcoming.events[0].time_label, "23:45–24:00");
        assert_eq!(view.notes.pending_label, "1 pendiente");
        assert_eq!(view.time_slots.len(), 96);
        assert_eq!(view.time_slots[37].label, "09:15");
        assert!(view.time_slots[36].is_hour && !view.time_slots[37].is_hour);
        assert_eq!(view.default_priority, AgendaPriority::Medium);

        let empty = build_view(&frame, &AgendaData::default());
        assert_eq!(empty.summary_label, "0 eventos próximos · 0 tareas pendientes");
        assert_eq!(empty.upcoming.label, "");
        assert_eq!(empty.notes.pending_label, "0 pendientes");
    }

    #[test]
    fn serializes_the_contract_in_camel_case() {
        let frame = AgendaFrame::resolve(&request(None, None), date("2026-09-24"), 0).unwrap();
        let value = serde_json::to_value(build_view(&frame, &AgendaData::default())).unwrap();
        assert_eq!(value["defaultPriority"], "medium");
        assert_eq!(value["month"]["cells"][0]["inMonth"], false);
        assert_eq!(value["week"]["days"][0]["shortName"], "Lun");
        assert_eq!(value["priorities"][0]["key"], "urgent");
        assert_eq!(value["slotMinutes"], 15);
    }
}
