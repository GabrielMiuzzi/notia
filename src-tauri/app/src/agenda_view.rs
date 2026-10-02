//! Pure derivation of the Agenda view: the month grid, the week, the
//! upcoming events, the notes, the holidays and every label the view shows.

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::agenda::{
    ensure_supported_date, parse_date, AgendaCommandError, AgendaData, AgendaPriority,
    AgendaResult, EventRecord, DAY_MINUTES, SLOT_MINUTES,
};
use crate::holidays::{Holiday, HolidayCalendar, HolidayKind};

pub(crate) const MONTH_NAMES: [&str; 12] = [
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
pub(crate) const WEEKDAY_SHORT: [&str; 7] = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
/// The two letters of the day strip of the phone layout.
const WEEKDAY_INITIALS: [&str; 7] = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
pub(crate) const WEEKDAY_LONG: [&str; 7] = [
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

    /// Years whose holidays the month grid, the week and the countdown show.
    /// The week can fall outside the grid while browsing other months.
    pub fn holiday_years(&self) -> Vec<i32> {
        let mut years = vec![
            self.grid_start.year(),
            self.grid_end().year(),
            self.week_start.year(),
            self.week_end().year(),
            self.today.year(),
        ];
        years.sort_unstable();
        years.dedup();
        years
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

pub(crate) fn weekday_index(date: NaiveDate) -> usize {
    date.weekday().num_days_from_monday() as usize
}

pub(crate) fn month_name(date: NaiveDate) -> &'static str {
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
    pub holidays: AgendaHolidays,
    pub selected_day: AgendaSelectedDay,
}

/// The selected day under the month of the phone layout, with every holiday
/// it has.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaSelectedDay {
    /// «Jueves 24 de septiembre».
    pub label: String,
    /// The most important first.
    pub holidays: Vec<AgendaDayHoliday>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaDayHoliday {
    pub name: String,
    pub kind: HolidayKind,
    /// «Feriado inamovible», «Feriado bancario»…
    pub kind_label: &'static str,
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
    /// The day's most important holiday; empty when there is none.
    pub holiday_name: String,
    pub holiday_kind: Option<HolidayKind>,
    /// Every holiday of the day with its kind, for the tooltip.
    pub holiday_title: String,
    pub aria_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaWeek {
    pub label: String,
    pub prev_date: String,
    pub next_date: String,
    pub days: Vec<AgendaWeekDay>,
    pub events: Vec<AgendaWeekEventView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaWeekDay {
    pub date: String,
    pub short_name: &'static str,
    /// «Lu», for the day strip of the phone layout.
    pub initials: &'static str,
    pub day: u32,
    pub long_label: String,
    pub is_today: bool,
    pub is_selected: bool,
    pub has_events: bool,
    /// The day's most important holiday kind, when it has one.
    pub holiday_kind: Option<HolidayKind>,
    pub aria_label: String,
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

/// An event of the week grid. Events that overlap share their width: each
/// one takes lane `lane` of `lanes` side by side.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaWeekEventView {
    #[serde(flatten)]
    pub event: AgendaEventView,
    pub lane: usize,
    pub lanes: usize,
    /// «Se superpone con A, B», or empty.
    pub overlap_label: String,
    pub tooltip: String,
    pub aria_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaHolidays {
    pub next: Option<AgendaNextHoliday>,
    /// «Navidad (inamovible) · Vie 25 dic», or empty.
    pub after_label: String,
    /// Shown when there is no next holiday.
    pub empty_label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaNextHoliday {
    pub date: String,
    pub name: String,
    pub kind: HolidayKind,
    /// «Próximo feriado en 15 días».
    pub countdown_label: String,
    /// «lunes 12 de octubre».
    pub date_label: String,
    pub kind_label: &'static str,
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

/// «lunes 12 de octubre, Feriado trasladable: …, con tareas».
fn day_aria_label(date: NaiveDate, day_holidays: &[Holiday], has_events: bool) -> String {
    let aria_holidays: String = day_holidays
        .iter()
        .map(|holiday| format!(", {}: {}", holiday.label(), holiday.name))
        .collect();
    format!(
        "{}{aria_holidays}{}",
        long_day_label(date),
        if has_events { ", con tareas" } else { "" }
    )
}

fn month_cell(frame: &AgendaFrame, data: &AgendaData, holidays: &HolidayCalendar, date: NaiveDate) -> AgendaMonthCell {
    let has_events = data.event_dates.contains(&date);
    let day_holidays = holidays.on(date);
    let holiday_title = day_holidays
        .iter()
        .map(|holiday| format!("{} ({})", holiday.name, holiday.label()))
        .collect::<Vec<_>>()
        .join(" · ");
    AgendaMonthCell {
        date: date_key(date),
        day: date.day(),
        in_month: date.month() == frame.month_start.month(),
        is_today: date == frame.today,
        is_selected: date == frame.selected,
        has_events,
        holiday_name: day_holidays.first().map(|holiday| holiday.name.clone()).unwrap_or_default(),
        holiday_kind: day_holidays.first().map(|holiday| holiday.kind),
        holiday_title,
        aria_label: day_aria_label(date, day_holidays, has_events),
    }
}

fn month_view(frame: &AgendaFrame, data: &AgendaData, holidays: &HolidayCalendar) -> AgendaMonth {
    let cells = (0..MONTH_GRID_DAYS)
        .map(|offset| month_cell(frame, data, holidays, frame.grid_start + Duration::days(offset)))
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

fn week_view(frame: &AgendaFrame, data: &AgendaData, holidays: &HolidayCalendar) -> AgendaWeek {
    let days = (0..7)
        .map(|offset| {
            let date = frame.week_start + Duration::days(offset);
            let has_events = data.week_events.iter().any(|event| event.date == date);
            let day_holidays = holidays.on(date);
            AgendaWeekDay {
                date: date_key(date),
                short_name: WEEKDAY_SHORT[offset as usize],
                initials: WEEKDAY_INITIALS[offset as usize],
                day: date.day(),
                long_label: long_day_label(date),
                is_today: date == frame.today,
                is_selected: date == frame.selected,
                has_events,
                holiday_kind: day_holidays.first().map(|holiday| holiday.kind),
                aria_label: day_aria_label(date, day_holidays, has_events),
            }
        })
        .collect();
    AgendaWeek {
        label: week_label(frame.week_start, frame.week_end()),
        prev_date: date_key(frame.selected - Duration::days(7)),
        next_date: date_key(frame.selected + Duration::days(7)),
        days,
        events: week_events(&data.week_events),
    }
}

fn overlap(left: &EventRecord, right: &EventRecord) -> bool {
    left.date == right.date && left.id != right.id && left.start_minute < right.end_minute && right.start_minute < left.end_minute
}

/// Lane and lane count of each event of one day: a group of events that
/// overlap one another splits the column in as many lanes as it needs, and
/// each event takes the first lane free when it starts.
fn day_lanes(events: &[&EventRecord]) -> Vec<(usize, usize)> {
    let mut order: Vec<usize> = (0..events.len()).collect();
    order.sort_by_key(|&index| (events[index].start_minute, std::cmp::Reverse(events[index].end_minute)));
    let mut placed = vec![(0, 1); events.len()];
    let mut group: Vec<usize> = Vec::new();
    let mut lane_ends: Vec<u16> = Vec::new();
    let mut group_end = 0;
    let close = |group: &mut Vec<usize>, lane_ends: &mut Vec<u16>, placed: &mut Vec<(usize, usize)>| {
        for &index in group.iter() {
            placed[index].1 = lane_ends.len();
        }
        group.clear();
        lane_ends.clear();
    };
    for index in order {
        let event = events[index];
        if !group.is_empty() && event.start_minute >= group_end {
            close(&mut group, &mut lane_ends, &mut placed);
        }
        let lane = match lane_ends.iter().position(|&end| end <= event.start_minute) {
            Some(lane) => {
                lane_ends[lane] = event.end_minute;
                lane
            }
            None => {
                lane_ends.push(event.end_minute);
                lane_ends.len() - 1
            }
        };
        placed[index].0 = lane;
        group.push(index);
        group_end = if group.len() == 1 { event.end_minute } else { group_end.max(event.end_minute) };
    }
    close(&mut group, &mut lane_ends, &mut placed);
    placed
}

fn week_events(events: &[EventRecord]) -> Vec<AgendaWeekEventView> {
    let mut lanes = vec![(0, 1); events.len()];
    let mut dates: Vec<NaiveDate> = events.iter().map(|event| event.date).collect();
    dates.dedup();
    for date in dates {
        let indices: Vec<usize> = (0..events.len()).filter(|&index| events[index].date == date).collect();
        let day: Vec<&EventRecord> = indices.iter().map(|&index| &events[index]).collect();
        for (index, placed) in indices.into_iter().zip(day_lanes(&day)) {
            lanes[index] = placed;
        }
    }
    events
        .iter()
        .zip(lanes)
        .map(|(event, (lane, lane_count))| {
            let others: Vec<&str> = events
                .iter()
                .filter(|other| overlap(event, other))
                .map(|other| other.title.as_str())
                .collect();
            let view = event_view(event);
            let (overlap_label, tooltip_overlap, aria_overlap) = if others.is_empty() {
                (String::new(), String::new(), String::new())
            } else {
                (
                    format!("Se superpone con {}", others.join(", ")),
                    format!(" · se superpone con {}", others.join(", ")),
                    format!(", superpuesta con {}", count_label(others.len(), "evento", "eventos")),
                )
            };
            AgendaWeekEventView {
                tooltip: format!("{} · {}{tooltip_overlap}", event.title, view.time_label),
                aria_label: format!(
                    "{}, prioridad {}, {} de {} a {}{aria_overlap}",
                    event.title,
                    event.priority.label(),
                    long_day_label(event.date),
                    time_label(event.start_minute),
                    time_label(event.end_minute)
                ),
                overlap_label,
                lane,
                lanes: lane_count,
                event: view,
            }
        })
        .collect()
}

fn countdown_label(days: i64) -> String {
    match days {
        0 => "Hoy es feriado".to_string(),
        1 => "Próximo feriado mañana".to_string(),
        days => format!("Próximo feriado en {days} días"),
    }
}

/// «Navidad (inamovible) · Vie 25 dic».
fn after_label(holiday: &Holiday) -> String {
    let kind = holiday.label();
    let kind = kind.strip_prefix("Feriado ").unwrap_or(kind);
    format!(
        "{} ({kind}) · {} {} {}",
        holiday.name,
        WEEKDAY_SHORT[weekday_index(holiday.date)],
        holiday.date.day(),
        month_short(holiday.date)
    )
}

fn holidays_view(frame: &AgendaFrame, holidays: &HolidayCalendar) -> AgendaHolidays {
    let next = holidays.next_days_off(frame.today, 2);
    let empty_label = if holidays.unavailable.contains(&frame.today.year()) {
        "No se pudieron cargar los feriados. Revisá la conexión."
    } else {
        "No hay feriados publicados por delante."
    };
    AgendaHolidays {
        next: next.first().map(|holiday| AgendaNextHoliday {
            date: date_key(holiday.date),
            name: holiday.name.clone(),
            kind: holiday.kind,
            countdown_label: countdown_label((holiday.date - frame.today).num_days()),
            date_label: long_day_label(holiday.date),
            kind_label: holiday.label(),
        }),
        after_label: next.get(1).map(|holiday| after_label(holiday)).unwrap_or_default(),
        empty_label: empty_label.to_string(),
    }
}

pub fn build_view(frame: &AgendaFrame, data: &AgendaData, holidays: &HolidayCalendar) -> AgendaView {
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
        month: month_view(frame, data, holidays),
        week: week_view(frame, data, holidays),
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
        holidays: holidays_view(frame, holidays),
        selected_day: selected_day_view(frame, holidays),
    }
}

fn selected_day_view(frame: &AgendaFrame, holidays: &HolidayCalendar) -> AgendaSelectedDay {
    AgendaSelectedDay {
        label: capitalized(&long_day_label(frame.selected)),
        holidays: holidays
            .on(frame.selected)
            .iter()
            .map(|holiday| AgendaDayHoliday {
                name: holiday.name.clone(),
                kind: holiday.kind,
                kind_label: holiday.label(),
            })
            .collect(),
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
        let view = build_view(&frame, &data, &HolidayCalendar::default());
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
        let week = build_view(&frame, &data, &HolidayCalendar::default()).week;
        assert_eq!(week.label, "28 sep – 4 oct 2026");
        assert_eq!((week.prev_date.as_str(), week.next_date.as_str()), ("2026-09-24", "2026-10-08"));
        assert_eq!(week.days[0].date, "2026-09-28");
        assert_eq!(week.days[3].short_name, "Jue");
        assert_eq!(week.days[5].initials, "Sá");
        assert!(week.days[3].is_selected);
        assert_eq!(week.days[3].long_label, "jueves 1 de octubre");
        let with_events: Vec<_> = week.days.iter().filter(|day| day.has_events).map(|day| day.day).collect();
        assert_eq!(with_events, vec![29]);
        assert_eq!(week.days[1].aria_label, "martes 29 de septiembre, con tareas");
        assert_eq!(week.days[2].aria_label, "miércoles 30 de septiembre");
        assert_eq!(week.days[2].holiday_kind, None);
        assert_eq!(week.events[0].event.time_label, "09:00–10:00");
        assert_eq!(week.events[0].event.when_label, "Mar 29 sep · 09:00–10:00");
        assert_eq!(week.events[0].event.priority_label, "Urgente");

        let same_month = AgendaFrame::resolve(&request(None, None), date("2026-09-24"), 0).unwrap();
        assert_eq!(build_view(&same_month, &AgendaData::default(), &HolidayCalendar::default()).week.label, "21 – 27 sep 2026");
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
        let view = build_view(&frame, &data, &HolidayCalendar::default());
        assert_eq!(view.summary_label, "1 evento próximo · 1 tarea pendiente");
        assert_eq!(view.upcoming.label, "Mostrando 1 de 1");
        assert_eq!(view.upcoming.events[0].time_label, "23:45–24:00");
        assert_eq!(view.notes.pending_label, "1 pendiente");
        assert_eq!(view.time_slots.len(), 96);
        assert_eq!(view.time_slots[37].label, "09:15");
        assert!(view.time_slots[36].is_hour && !view.time_slots[37].is_hour);
        assert_eq!(view.default_priority, AgendaPriority::Medium);

        let empty = build_view(&frame, &AgendaData::default(), &HolidayCalendar::default());
        assert_eq!(empty.summary_label, "0 eventos próximos · 0 tareas pendientes");
        assert_eq!(empty.upcoming.label, "");
        assert_eq!(empty.notes.pending_label, "0 pendientes");
    }

    #[test]
    fn overlapping_events_share_the_column_in_lanes() {
        let frame = AgendaFrame::resolve(&request(Some("2026-09-23"), None), date("2026-09-24"), 0).unwrap();
        let data = AgendaData {
            week_events: vec![
                event("2026-09-23", 840, 900, "Revisión de proyecto"),
                event("2026-09-23", 870, 930, "Revisión de diseño"),
                event("2026-09-23", 900, 960, "Sync con producto"),
                event("2026-09-23", 960, 1020, "Después"),
                event("2026-09-21", 540, 600, "Reunión de equipo"),
            ],
            ..AgendaData::default()
        };
        let week = build_view(&frame, &data, &HolidayCalendar::default()).week;
        let lanes: Vec<_> = week.events.iter().map(|event| (event.event.title.as_str(), event.lane, event.lanes)).collect();
        assert_eq!(
            lanes,
            vec![
                ("Revisión de proyecto", 0, 2),
                ("Revisión de diseño", 1, 2),
                ("Sync con producto", 0, 2),
                ("Después", 0, 1),
                ("Reunión de equipo", 0, 1),
            ]
        );
        assert_eq!(week.events[1].overlap_label, "Se superpone con Revisión de proyecto, Sync con producto");
        assert_eq!(week.events[0].overlap_label, "Se superpone con Revisión de diseño");
        assert_eq!(week.events[3].overlap_label, "");
        assert_eq!(week.events[3].tooltip, "Después · 16:00–17:00");
        assert_eq!(
            week.events[1].aria_label,
            "Revisión de diseño, prioridad Urgente, miércoles 23 de septiembre de 14:30 a 15:30, superpuesta con 2 eventos"
        );
    }

    #[test]
    fn a_long_event_keeps_its_lane_while_shorter_ones_fill_the_other() {
        let events = [event("2026-09-23", 540, 720, "Largo"), event("2026-09-23", 540, 600, "A"), event("2026-09-23", 600, 660, "B")];
        let day: Vec<&EventRecord> = events.iter().collect();
        assert_eq!(day_lanes(&day), vec![(0, 2), (1, 2), (1, 2)]);
    }

    #[test]
    fn holidays_mark_the_month_and_count_down() {
        let frame = AgendaFrame::resolve(&request(None, Some("2026-10")), date("2026-09-27"), 0).unwrap();
        let holidays = crate::holidays::tests::calendar_of(
            2026,
            &[
                ("2026-10-12", "trasladable", "Día del Respeto a la Diversidad Cultural"),
                ("2026-11-23", "trasladable", "Día de la Soberanía Nacional (20/11)"),
            ],
            &[("2026-10-12", "Día de la Raza"), ("2026-11-06", "Día del Bancario")],
        );
        let view = build_view(&frame, &AgendaData::default(), &holidays);
        let cell = view.month.cells.iter().find(|cell| cell.date == "2026-10-12").unwrap();
        assert_eq!(cell.holiday_name, "Día del Respeto a la Diversidad Cultural");
        assert_eq!(cell.holiday_kind, Some(HolidayKind::Movable));
        assert_eq!(cell.holiday_title, "Día del Respeto a la Diversidad Cultural (Feriado trasladable)");
        assert_eq!(
            cell.aria_label,
            "lunes 12 de octubre, Feriado trasladable: Día del Respeto a la Diversidad Cultural"
        );
        let bank = view.month.cells.iter().find(|cell| cell.date == "2026-11-06").unwrap();
        assert_eq!(bank.holiday_kind, Some(HolidayKind::NonWorking));
        assert_eq!(bank.holiday_title, "Día del Bancario (Feriado bancario)");

        let next = view.holidays.next.as_ref().unwrap();
        assert_eq!(next.countdown_label, "Próximo feriado en 15 días");
        assert_eq!(next.date_label, "lunes 12 de octubre");
        assert_eq!(next.kind_label, "Feriado trasladable");
        assert_eq!(view.holidays.after_label, "Día de la Soberanía Nacional (20/11) (trasladable) · Lun 23 nov");

        let on_the_day = AgendaFrame::resolve(&request(None, None), date("2026-10-12"), 0).unwrap();
        let today = build_view(&on_the_day, &AgendaData::default(), &holidays).holidays;
        assert_eq!(today.next.unwrap().countdown_label, "Hoy es feriado");
        assert_eq!(countdown_label(1), "Próximo feriado mañana");
    }

    #[test]
    fn the_week_and_the_selected_day_show_their_holidays() {
        let holidays = crate::holidays::tests::calendar_of(
            2026,
            &[("2026-10-12", "trasladable", "Día del Respeto a la Diversidad Cultural")],
            &[("2026-10-12", "Día de la Raza"), ("2026-10-14", "Día del Bancario")],
        );
        let frame = AgendaFrame::resolve(&request(Some("2026-10-12"), Some("2026-11")), date("2026-09-27"), 0).unwrap();
        let view = build_view(&frame, &AgendaData::default(), &holidays);
        let monday = &view.week.days[0];
        assert_eq!(monday.holiday_kind, Some(HolidayKind::Movable));
        assert_eq!(
            monday.aria_label,
            "lunes 12 de octubre, Feriado trasladable: Día del Respeto a la Diversidad Cultural"
        );
        assert_eq!(view.week.days[2].holiday_kind, Some(HolidayKind::NonWorking));
        assert_eq!(view.week.days[1].holiday_kind, None);

        // The selected day is outside the November grid and still lists its holidays.
        assert_eq!(view.selected_day.label, "Lunes 12 de octubre");
        let names: Vec<_> = view
            .selected_day
            .holidays
            .iter()
            .map(|holiday| (holiday.kind, holiday.kind_label, holiday.name.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![(HolidayKind::Movable, "Feriado trasladable", "Día del Respeto a la Diversidad Cultural")]
        );

        let plain = AgendaFrame::resolve(&request(Some("2026-10-13"), None), date("2026-09-27"), 0).unwrap();
        let day = build_view(&plain, &AgendaData::default(), &holidays).selected_day;
        assert_eq!(day.label, "Martes 13 de octubre");
        assert!(day.holidays.is_empty());
    }

    #[test]
    fn the_holidays_card_explains_why_it_is_empty() {
        let frame = AgendaFrame::resolve(&request(None, None), date("2026-09-27"), 0).unwrap();
        let mut offline = HolidayCalendar::default();
        offline.unavailable.insert(2026);
        let view = build_view(&frame, &AgendaData::default(), &offline);
        assert!(view.holidays.next.is_none());
        assert_eq!(view.holidays.empty_label, "No se pudieron cargar los feriados. Revisá la conexión.");
        let none = build_view(&frame, &AgendaData::default(), &HolidayCalendar::default()).holidays;
        assert_eq!(none.empty_label, "No hay feriados publicados por delante.");
    }

    #[test]
    fn the_frame_asks_the_years_it_shows() {
        let december = AgendaFrame::resolve(&request(None, Some("2026-12")), date("2026-09-27"), 0).unwrap();
        assert_eq!(december.holiday_years(), vec![2026, 2027]);
        let january = AgendaFrame::resolve(&request(None, Some("2027-01")), date("2026-09-27"), 0).unwrap();
        assert_eq!(january.holiday_years(), vec![2026, 2027]);
        let may = AgendaFrame::resolve(&request(None, Some("2027-05")), date("2026-09-27"), 0).unwrap();
        assert_eq!(may.holiday_years(), vec![2026, 2027]);
        // Browsing back while the selected week crosses into the next year.
        let crossing = AgendaFrame::resolve(&request(Some("2026-12-31"), Some("2026-06")), date("2026-09-27"), 0).unwrap();
        assert_eq!(crossing.holiday_years(), vec![2026, 2027]);
    }

    #[test]
    fn serializes_the_contract_in_camel_case() {
        let frame = AgendaFrame::resolve(&request(None, None), date("2026-09-24"), 0).unwrap();
        let value = serde_json::to_value(build_view(&frame, &AgendaData::default(), &HolidayCalendar::default())).unwrap();
        assert_eq!(value["defaultPriority"], "medium");
        assert_eq!(value["month"]["cells"][0]["inMonth"], false);
        assert_eq!(value["week"]["days"][0]["shortName"], "Lun");
        assert_eq!(value["week"]["days"][0]["initials"], "Lu");
        assert_eq!(value["week"]["days"][3]["hasEvents"], false);
        assert!(value["week"]["days"][3]["holidayKind"].is_null());
        assert_eq!(value["week"]["days"][3]["ariaLabel"], "jueves 24 de septiembre");
        assert_eq!(value["selectedDay"]["label"], "Jueves 24 de septiembre");
        assert_eq!(value["selectedDay"]["holidays"], serde_json::json!([]));
        assert_eq!(value["priorities"][0]["key"], "urgent");
        assert_eq!(value["slotMinutes"], 15);
    }
}
