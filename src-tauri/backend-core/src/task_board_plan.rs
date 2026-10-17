//! Calendar of a Task Manager board: its workday, sprints and year
//! divisions, the people and projects it assigns, and the kind of each
//! column. Everything here is pure: callers pass the local date and time.
//!
//! The workday sets the hours per day of the planner, the sprints decide
//! which dates «Sprint actual» and «Sprint siguiente» cover, and the
//! divisions decide «Próximo Q», the Management picker and its prefix.

use jiff::civil::{Date, DateTime, Time, Weekday};
use jiff::Span;
use serde::{Deserialize, Serialize};

use crate::error::BackendError;

/// Colors a board offers for itself, its people and its projects, in the
/// order they are handed out.
pub const BOARD_PALETTE: [&str; 8] = [
    "#4FD1C5", "#6C8EFF", "#A78BFA", "#D9B44A", "#FFB86B", "#F28CB1", "#6FCF97", "#64748B",
];
pub const BOARD_PALETTE_NAMES: [&str; 8] =
    ["Teal", "Periwinkle", "Violeta", "Oro", "Ámbar", "Rosa", "Salvia", "Slate"];

pub const MAX_BOARD_MEMBERS: usize = 64;
pub const MAX_BOARD_PROJECTS: usize = 64;
const MAX_LABEL_CHARS: usize = 80;
const MAX_PREFIX_CHARS: usize = 4;
const MINUTES_PER_DAY: u16 = 24 * 60;
const STEP_MINUTES: u16 = 30;
/// A year holds at most this many work days: loops over days stop there.
const MAX_SCAN_DAYS: i64 = 4 * 366;

const MONTHS_SHORT: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG: [&str; 12] = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre",
    "diciembre",
];
const WEEKDAYS_SHORT: [&str; 7] = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const WEEKDAYS_LONG: [&str; 7] = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Workday, sprints and divisions of a board. Missing keys take the
/// defaults: 09:00–18:00 Monday to Friday, two-week sprints from Monday and
/// four «Q» divisions from January.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskBoardPlanDto {
    /// Minutes since midnight, in steps of 30.
    pub day_start_minutes: u16,
    pub day_end_minutes: u16,
    /// Monday first.
    pub work_days: [bool; 7],
    pub sprint_weeks: u8,
    /// 0 is Monday, 4 is Friday.
    pub sprint_start_weekday: u8,
    pub divisions_per_year: u8,
    pub division_prefix: String,
    pub year_start_month: u8,
}

impl Default for TaskBoardPlanDto {
    fn default() -> Self {
        Self {
            day_start_minutes: 9 * 60,
            day_end_minutes: 18 * 60,
            work_days: [true, true, true, true, true, false, false],
            sprint_weeks: 2,
            sprint_start_weekday: 0,
            divisions_per_year: 4,
            division_prefix: "Q".to_string(),
            year_start_month: 1,
        }
    }
}

impl TaskBoardPlanDto {
    /// Settings of a board that only knew its activity hours: the workday
    /// starts at 09:00 and lasts those hours (24, the old default, means
    /// «never set»).
    pub fn from_activity_hours(hours: f64) -> Self {
        let mut plan = Self::default();
        if hours.is_finite() && hours > 0.0 && hours < 24.0 {
            let minutes = ((hours * 60.0 / f64::from(STEP_MINUTES)).round() as u16).max(1) * STEP_MINUTES;
            plan.day_end_minutes = (plan.day_start_minutes + minutes).min(MINUTES_PER_DAY);
        }
        plan
    }

    pub fn validate(&self) -> Result<(), BackendError> {
        let on_step = |minutes: u16| minutes % STEP_MINUTES == 0;
        if !on_step(self.day_start_minutes)
            || !on_step(self.day_end_minutes)
            || self.day_end_minutes > MINUTES_PER_DAY
            || self.day_start_minutes + STEP_MINUTES > self.day_end_minutes
        {
            return Err(invalid("La jornada debe ir en pasos de 30 minutos y durar al menos 30 minutos."));
        }
        if !self.work_days.iter().any(|day| *day) {
            return Err(invalid("Elegí al menos un día activo."));
        }
        if !(1..=8).contains(&self.sprint_weeks) {
            return Err(invalid("Los sprints duran de 1 a 8 semanas."));
        }
        if self.sprint_start_weekday > 4 {
            return Err(invalid("Los sprints empiezan de lunes a viernes."));
        }
        if !(1..=12).contains(&self.divisions_per_year) {
            return Err(invalid("El año se divide en 1 a 12 partes."));
        }
        let prefix = self.division_prefix.trim();
        if prefix.is_empty() || prefix.chars().count() > MAX_PREFIX_CHARS || prefix.chars().any(char::is_whitespace) {
            return Err(invalid("El prefijo de las divisiones tiene de 1 a 4 caracteres, sin espacios."));
        }
        if !(1..=12).contains(&self.year_start_month) {
            return Err(invalid("El mes de inicio del año no es válido."));
        }
        Ok(())
    }

    /// Hours of one workday.
    pub fn hours_per_day(&self) -> f64 {
        f64::from(self.day_end_minutes.saturating_sub(self.day_start_minutes)) / 60.0
    }

    pub fn work_days_per_week(&self) -> usize {
        self.work_days.iter().filter(|day| **day).count()
    }

    fn prefix(&self) -> &str {
        self.division_prefix.trim()
    }
}

/// A person of the board. Only they can be assigned to its tasks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardMemberDto {
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub is_owner: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardProjectDto {
    pub name: String,
    pub color: String,
}

/// What a board keeps besides its name, color and context. `None` means
/// the board never saved it: the view derives it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardConfigDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<TaskBoardPlanDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<TaskBoardMemberDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<TaskBoardProjectDto>>,
}

fn valid_label(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= MAX_LABEL_CHARS && !trimmed.chars().any(char::is_control)
}

/// A `#RRGGBB` color.
pub fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn validate_members(members: &[TaskBoardMemberDto]) -> Result<(), BackendError> {
    if members.len() > MAX_BOARD_MEMBERS {
        return Err(invalid("El tablero supera el límite de personas."));
    }
    let mut seen = std::collections::HashSet::new();
    for member in members {
        if !valid_label(&member.name) || !is_hex_color(&member.color) {
            return Err(invalid("Una persona del tablero no es válida."));
        }
        if !seen.insert(fold(&member.name)) {
            return Err(invalid("Esa persona ya está en el tablero."));
        }
    }
    if members.iter().filter(|member| member.is_owner).count() > 1 {
        return Err(invalid("El tablero tiene un solo propietario."));
    }
    Ok(())
}

pub fn validate_projects(projects: &[TaskBoardProjectDto]) -> Result<(), BackendError> {
    if projects.len() > MAX_BOARD_PROJECTS {
        return Err(invalid("El tablero supera el límite de proyectos."));
    }
    let mut seen = std::collections::HashSet::new();
    for project in projects {
        if !valid_label(&project.name) || !is_hex_color(&project.color) {
            return Err(invalid("Un proyecto del tablero no es válido."));
        }
        if !seen.insert(fold(&project.name)) {
            return Err(invalid("Ya existe un proyecto con ese nombre."));
        }
    }
    Ok(())
}

/// First palette color nobody uses yet, else the one after the last used.
pub fn next_palette_color<'a>(used: impl IntoIterator<Item = &'a str>) -> String {
    let used = used.into_iter().map(str::to_ascii_uppercase).collect::<Vec<_>>();
    BOARD_PALETTE
        .iter()
        .find(|color| !used.iter().any(|candidate| candidate == *color))
        .map(|color| color.to_string())
        .unwrap_or_else(|| BOARD_PALETTE[used.len() % BOARD_PALETTE.len()].to_string())
}

/// Lowercase without accents or repeated spaces: how names are compared.
pub fn fold(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            other => other,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/// What a column means to the planner. Saved columns keep the kind they
/// were given; older ones are recognized by their name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskColumnKind {
    Notes,
    CurrentSprint,
    NextSprint,
    NextDivision,
    Refine,
    Review,
    Blocked,
    Overdue,
    Custom,
}

impl TaskColumnKind {
    pub const ALL: [Self; 9] = [
        Self::Notes,
        Self::CurrentSprint,
        Self::NextSprint,
        Self::NextDivision,
        Self::Refine,
        Self::Review,
        Self::Blocked,
        Self::Overdue,
        Self::Custom,
    ];

    pub fn from_key(key: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(key.trim().to_string())).ok()
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Notes => "notes",
            Self::CurrentSprint => "current-sprint",
            Self::NextSprint => "next-sprint",
            Self::NextDivision => "next-division",
            Self::Refine => "refine",
            Self::Review => "review",
            Self::Blocked => "blocked",
            Self::Overdue => "overdue",
            Self::Custom => "custom",
        }
    }

    /// How the column dialog names the kind.
    pub fn label(self, prefix: &str) -> String {
        match self {
            Self::Notes => "Anotadores".to_string(),
            Self::CurrentSprint => "Sprint actual".to_string(),
            Self::NextSprint => "Sprint siguiente".to_string(),
            Self::NextDivision => format!("Próximo {prefix}"),
            Self::Refine => "A refinar".to_string(),
            Self::Review => "En revisión".to_string(),
            Self::Blocked => "Bloqueado".to_string(),
            Self::Overdue => "Atrasado".to_string(),
            Self::Custom => "Otra".to_string(),
        }
    }

    /// Kind of a column that never saved one, by its name.
    pub fn infer(name: &str) -> Self {
        let name = fold(name);
        if name.starts_with("anotador") {
            Self::Notes
        } else if name == "sprint actual" || name == "sprint en curso" {
            Self::CurrentSprint
        } else if name == "sprint siguiente" || name == "proximo sprint" {
            Self::NextSprint
        } else if name.starts_with("proximo ") || name.starts_with("proxima ") {
            Self::NextDivision
        } else if name.contains("refinar") {
            Self::Refine
        } else if name.contains("revision") {
            Self::Review
        } else if name.starts_with("bloquead") {
            Self::Blocked
        } else if name.starts_with("atrasad") || name == "vencidas" {
            Self::Overdue
        } else {
            Self::Custom
        }
    }

    /// Whether Management plans its tasks (every kind but notes).
    pub fn is_planned(self) -> bool {
        self != Self::Notes
    }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}

fn add_days(date: Date, days: i64) -> Date {
    date.checked_add(Span::new().days(days)).unwrap_or(date)
}

/// Days from `from` to `to` (negative when `to` is earlier).
pub fn days_between(from: Date, to: Date) -> i64 {
    from.until(to).map(|span| i64::from(span.get_days())).unwrap_or(0)
}

/// 0 is Monday.
pub fn weekday_index(date: Date) -> usize {
    date.weekday().to_monday_zero_offset() as usize
}

pub fn month_short(month: i8) -> &'static str {
    MONTHS_SHORT[(month.clamp(1, 12) - 1) as usize]
}

pub fn month_long(month: i8) -> &'static str {
    MONTHS_LONG[(month.clamp(1, 12) - 1) as usize]
}

pub fn weekday_short(date: Date) -> &'static str {
    WEEKDAYS_SHORT[weekday_index(date)]
}

pub fn weekday_long(index: usize) -> &'static str {
    WEEKDAYS_LONG[index.min(6)]
}

/// «19 oct».
pub fn day_month(date: Date) -> String {
    format!("{} {}", date.day(), month_short(date.month()))
}

/// «19 oct – 1 nov».
pub fn date_range(start: Date, end: Date) -> String {
    format!("{} – {}", day_month(start), day_month(end))
}

/// «lun 19 oct».
pub fn weekday_day_month(date: Date) -> String {
    format!("{} {}", weekday_short(date), day_month(date))
}

/// «09:00».
pub fn clock(minutes: u16) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

/// «lun 19 oct · 09:00».
pub fn date_time_label(value: DateTime) -> String {
    format!("{} · {:02}:{:02}", weekday_day_month(value.date()), value.hour(), value.minute())
}

/// Hours with a comma decimal and one place, without a trailing «,0».
pub fn hours_label(hours: f64) -> String {
    let rounded = (hours * 10.0).round() / 10.0;
    if (rounded - rounded.round()).abs() < 1e-9 {
        format!("{}", rounded.round() as i64)
    } else {
        format!("{rounded:.1}").replace('.', ",")
    }
}

fn first_weekday_on_or_after(date: Date, weekday: Weekday) -> Date {
    let offset = (i64::from(weekday.to_monday_zero_offset()) - i64::from(date.weekday().to_monday_zero_offset()))
        .rem_euclid(7);
    add_days(date, offset)
}

fn weekday_from_index(index: u8) -> Weekday {
    match index {
        0 => Weekday::Monday,
        1 => Weekday::Tuesday,
        2 => Weekday::Wednesday,
        3 => Weekday::Thursday,
        4 => Weekday::Friday,
        5 => Weekday::Saturday,
        _ => Weekday::Sunday,
    }
}

// ---------------------------------------------------------------------------
// Fiscal year and divisions
// ---------------------------------------------------------------------------

/// A division of the year (Q4) or a sprint, with inclusive dates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarSpan {
    /// 1-based inside its year.
    pub number: u32,
    /// Calendar year in which its fiscal year starts.
    pub year: i16,
    pub start: Date,
    pub end: Date,
}

impl CalendarSpan {
    pub fn contains(&self, date: Date) -> bool {
        self.start <= date && date <= self.end
    }

    pub fn days(&self) -> i64 {
        days_between(self.start, self.end) + 1
    }
}

pub fn fiscal_year_start(plan: &TaskBoardPlanDto, year: i16) -> Date {
    Date::new(year, plan.year_start_month.clamp(1, 12) as i8, 1).unwrap_or(jiff::civil::date(1970, 1, 1))
}

/// Calendar year in which the fiscal year of `date` started.
pub fn fiscal_year_of(plan: &TaskBoardPlanDto, date: Date) -> i16 {
    if date >= fiscal_year_start(plan, date.year()) {
        date.year()
    } else {
        date.year() - 1
    }
}

/// «2026», or «2026/27» when the fiscal year crosses the calendar year.
pub fn fiscal_year_label(plan: &TaskBoardPlanDto, year: i16) -> String {
    if plan.year_start_month <= 1 {
        year.to_string()
    } else {
        format!("{year}/{:02}", (i32::from(year) + 1).rem_euclid(100))
    }
}

/// Divisions of a fiscal year. When 12 is a multiple of their count they
/// fall on whole months; otherwise the year is split in equal days.
pub fn divisions_of_year(plan: &TaskBoardPlanDto, year: i16) -> Vec<CalendarSpan> {
    let count = u32::from(plan.divisions_per_year.clamp(1, 12));
    let start = fiscal_year_start(plan, year);
    let next = fiscal_year_start(plan, year + 1);
    let mut spans = Vec::with_capacity(count as usize);
    if 12 % count == 0 {
        let months = 12 / count;
        for index in 0..count {
            let first = start
                .checked_add(Span::new().months(i64::from(index * months)))
                .unwrap_or(start);
            let after = start
                .checked_add(Span::new().months(i64::from((index + 1) * months)))
                .unwrap_or(next);
            spans.push(CalendarSpan { number: index + 1, year, start: first, end: add_days(after, -1) });
        }
    } else {
        let total = days_between(start, next);
        for index in 0..count {
            let from = total * i64::from(index) / i64::from(count);
            let to = total * i64::from(index + 1) / i64::from(count);
            spans.push(CalendarSpan {
                number: index + 1,
                year,
                start: add_days(start, from),
                end: add_days(start, to - 1),
            });
        }
    }
    spans
}

pub fn division_at(plan: &TaskBoardPlanDto, date: Date) -> CalendarSpan {
    let year = fiscal_year_of(plan, date);
    divisions_of_year(plan, year)
        .into_iter()
        .find(|division| division.contains(date))
        .unwrap_or_else(|| CalendarSpan { number: 1, year, start: date, end: date })
}

/// The division `offset` places after (or before) the one of `date`.
pub fn division_with_offset(plan: &TaskBoardPlanDto, date: Date, offset: i32) -> CalendarSpan {
    let count = i32::from(plan.divisions_per_year.clamp(1, 12));
    let current = division_at(plan, date);
    let index = (current.number as i32 - 1) + offset;
    let year = i32::from(current.year) + index.div_euclid(count);
    let number = index.rem_euclid(count) as usize;
    divisions_of_year(plan, year.clamp(1900, 2999) as i16)
        .into_iter()
        .nth(number)
        .unwrap_or(current)
}

/// «Q4».
pub fn division_label(plan: &TaskBoardPlanDto, division: &CalendarSpan) -> String {
    format!("{}{}", plan.prefix(), division.number)
}

/// «Q4 2026».
pub fn division_title(plan: &TaskBoardPlanDto, division: &CalendarSpan) -> String {
    format!("{} {}", division_label(plan, division), fiscal_year_label(plan, division.year))
}

pub fn division_unit(count: u8) -> &'static str {
    match count {
        1 => "año",
        2 => "semestres",
        3 => "cuatrimestres",
        4 => "trimestres",
        6 => "bimestres",
        12 => "meses",
        _ => "divisiones",
    }
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

/// Sprints of a fiscal year: the first starts on the first sprint weekday
/// of the year and the numbering restarts each year. The last one ends the
/// day before the first sprint of the next year.
pub fn sprints_of_year(plan: &TaskBoardPlanDto, year: i16) -> Vec<CalendarSpan> {
    let weekday = weekday_from_index(plan.sprint_start_weekday);
    let first = first_weekday_on_or_after(fiscal_year_start(plan, year), weekday);
    let next_first = first_weekday_on_or_after(fiscal_year_start(plan, year + 1), weekday);
    let length = i64::from(plan.sprint_weeks.clamp(1, 8)) * 7;
    let mut sprints = Vec::new();
    let mut start = first;
    let mut number = 1;
    while start < next_first {
        let end = add_days(start, length - 1).min(add_days(next_first, -1));
        sprints.push(CalendarSpan { number, year, start, end });
        start = add_days(start, length);
        number += 1;
    }
    sprints
}

pub fn sprint_at(plan: &TaskBoardPlanDto, date: Date) -> CalendarSpan {
    let year = fiscal_year_of(plan, date);
    [year, year - 1]
        .into_iter()
        .flat_map(|year| sprints_of_year(plan, year))
        .find(|sprint| sprint.contains(date))
        .unwrap_or_else(|| CalendarSpan { number: 1, year, start: date, end: date })
}

/// The sprint right after the one of `date`.
pub fn next_sprint(plan: &TaskBoardPlanDto, date: Date) -> CalendarSpan {
    sprint_at(plan, add_days(sprint_at(plan, date).end, 1))
}

/// Sprints that touch `[start, end]`, in order.
pub fn sprints_between(plan: &TaskBoardPlanDto, start: Date, end: Date) -> Vec<CalendarSpan> {
    let mut sprints = Vec::new();
    let mut day = sprint_at(plan, start).start;
    while day <= end && sprints.len() < 400 {
        let sprint = sprint_at(plan, day);
        day = add_days(sprint.end, 1);
        sprints.push(sprint);
    }
    sprints
}

/// «Sprint 21».
pub fn sprint_label(sprint: &CalendarSpan) -> String {
    format!("Sprint {}", sprint.number)
}

// ---------------------------------------------------------------------------
// Work calendar
// ---------------------------------------------------------------------------

/// Working hours of a board: the planner measures time in hours of work
/// from the start of the plan.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkCalendar {
    day_start: u16,
    day_end: u16,
    work_days: [bool; 7],
    /// Start of the plan: always a working moment.
    origin: DateTime,
}

fn minutes_of(time: Time) -> u16 {
    time.hour() as u16 * 60 + time.minute() as u16
}

fn time_of(minutes: f64) -> Time {
    let total = minutes.round().clamp(0.0, f64::from(MINUTES_PER_DAY)) as i64;
    if total >= i64::from(MINUTES_PER_DAY) {
        return Time::new(23, 59, 0, 0).unwrap_or(Time::midnight());
    }
    Time::new((total / 60) as i8, (total % 60) as i8, 0, 0).unwrap_or(Time::midnight())
}

impl WorkCalendar {
    /// The plan starts now if now is inside the workday of a work day, at
    /// the day start if the workday has not begun, and otherwise at the
    /// start of the next work day.
    pub fn new(plan: &TaskBoardPlanDto, now: DateTime) -> Self {
        let mut calendar = Self {
            day_start: plan.day_start_minutes,
            day_end: plan.day_end_minutes.max(plan.day_start_minutes + STEP_MINUTES),
            work_days: plan.work_days,
            origin: now,
        };
        if !calendar.work_days.iter().any(|day| *day) {
            calendar.work_days = [true; 7];
        }
        calendar.origin = calendar.next_working_moment(now);
        calendar
    }

    pub fn origin(&self) -> DateTime {
        self.origin
    }

    pub fn hours_per_day(&self) -> f64 {
        f64::from(self.day_end - self.day_start) / 60.0
    }

    pub fn is_work_day(&self, date: Date) -> bool {
        self.work_days[weekday_index(date)]
    }

    fn next_work_day(&self, date: Date) -> Date {
        let mut day = date;
        for _ in 0..14 {
            if self.is_work_day(day) {
                return day;
            }
            day = add_days(day, 1);
        }
        date
    }

    fn at_day_start(&self, date: Date) -> DateTime {
        date.to_datetime(time_of(f64::from(self.day_start)))
    }

    /// First working moment at or after `value`.
    pub fn next_working_moment(&self, value: DateTime) -> DateTime {
        let minutes = minutes_of(value.time());
        if self.is_work_day(value.date()) {
            if minutes < self.day_start {
                return self.at_day_start(value.date());
            }
            if minutes < self.day_end {
                return value;
            }
        }
        self.at_day_start(self.next_work_day(add_days(value.date(), 1)))
    }

    /// Work days strictly after `from` up to and including `to`.
    fn work_days_until(&self, from: Date, to: Date) -> i64 {
        let span = days_between(from, to).clamp(0, MAX_SCAN_DAYS);
        (1..=span).filter(|offset| self.is_work_day(add_days(from, *offset))).count() as i64
    }

    /// Hours of work from the origin to `value` (0 before the origin).
    pub fn hours_at(&self, value: DateTime) -> f64 {
        let value = self.next_working_moment(value);
        if value <= self.origin {
            return 0.0;
        }
        let days = self.work_days_until(self.origin.date(), value.date()) as f64;
        let minutes = f64::from(minutes_of(value.time())) - f64::from(minutes_of(self.origin.time()));
        days * self.hours_per_day() + minutes / 60.0
    }

    /// Hours of work from the origin to the start of `date`.
    pub fn hours_at_date(&self, date: Date) -> f64 {
        self.hours_at(date.to_datetime(Time::midnight()))
    }

    /// Date and time `hours` of work after the origin. An end that falls on
    /// a day boundary reads as the end of that day (18:00), never as the
    /// start of the next one.
    pub fn date_time_at(&self, hours: f64, is_end: bool) -> DateTime {
        let per_day = self.hours_per_day();
        let offset = f64::from(minutes_of(self.origin.time()) - self.day_start) / 60.0;
        let absolute = (offset + hours.max(0.0)).max(0.0);
        let mut days = (absolute / per_day + 1e-9).floor();
        let mut rest = absolute - days * per_day;
        if rest.abs() < 1e-6 {
            rest = 0.0;
        }
        if is_end && rest == 0.0 && absolute > 1e-9 {
            days -= 1.0;
            rest = per_day;
        }
        let mut date = self.origin.date();
        let mut remaining = days.max(0.0) as i64;
        let mut guard = 0;
        while remaining > 0 && guard < MAX_SCAN_DAYS * 2 {
            date = add_days(date, 1);
            if self.is_work_day(date) {
                remaining -= 1;
            }
            guard += 1;
        }
        date.to_datetime(time_of(f64::from(self.day_start) + rest * 60.0))
    }
}

// ---------------------------------------------------------------------------
// Edit board preview
// ---------------------------------------------------------------------------

/// What «Editar tablero» shows for the settings being edited.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardPlanPreviewDto {
    /// «default · #Laboral · 09:00–18:00 · sprints de 2 sem · 4 Q».
    pub summary: String,
    pub workday: WorkdayPreviewDto,
    pub sprints: SprintsPreviewDto,
    pub divisions: DivisionsPreviewDto,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkdayPreviewDto {
    pub title: String,
    pub hint: String,
    pub days_title: String,
    pub start_label: String,
    pub end_label: String,
    pub hours_per_day: String,
    pub hours_per_week: String,
    /// Place of the current time on the 24 h bar, from 0 to 1.
    pub now_fraction: f64,
    pub presets: Vec<WorkdayPresetDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkdayPresetDto {
    pub label: String,
    pub start_minutes: u16,
    pub end_minutes: u16,
    /// Work days the preset also sets (only «Fin de semana» does).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_days: Option<[bool; 7]>,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprintsPreviewDto {
    pub weeks_label: String,
    pub year_note: String,
    pub rows: Vec<SprintRowDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprintRowDto {
    pub number: u32,
    pub label: String,
    pub range: String,
    /// `current`, `next`, `later` or `next-year`.
    pub badge_kind: String,
    pub badge: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DivisionsPreviewDto {
    pub unit: String,
    pub year_label: String,
    pub today_label: String,
    pub sprint_label: String,
    pub bars: Vec<DivisionBarDto>,
    /// Where each sprint starts on the year bar, from 0 to 1.
    pub sprint_ticks: Vec<f64>,
    pub today_fraction: f64,
    pub months: Vec<String>,
    pub duration: String,
    pub sprints_per_division: String,
    pub current: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DivisionBarDto {
    pub label: String,
    pub days: i64,
    pub current: bool,
    pub tooltip: String,
}

struct ContextCopy {
    title: String,
    hint: String,
    days_title: &'static str,
    presets: Vec<(&'static str, u16, u16, Option<[bool; 7]>)>,
}

fn context_copy(context: &str) -> ContextCopy {
    let weekend = Some([false, false, false, false, false, true, true]);
    match fold(context.trim_start_matches('#')).as_str() {
        "laboral" => ContextCopy {
            title: "Jornada laboral".to_string(),
            hint: "Horario en el que trabajás este tablero. Se usa para los tiempos dedicados y el foco.".to_string(),
            days_title: "Días laborables",
            presets: vec![("Completa 9–18", 540, 1080, None), ("Media 9–13", 540, 780, None), ("Tarde 14–22", 840, 1320, None)],
        },
        "estudiantil" => ContextCopy {
            title: "Horas de estudio por día".to_string(),
            hint: "Franja en la que estudiás. Cuenta para el avance y los pomodoros del tablero.".to_string(),
            days_title: "Días de estudio",
            presets: vec![("Mañana 8–12", 480, 720, None), ("Tarde 14–18", 840, 1080, None), ("Noche 19–23", 1140, 1380, None)],
        },
        "personal" => ContextCopy {
            title: "Horas disponibles por día".to_string(),
            hint: "Tiempo que le dedicás a este tablero fuera de otras obligaciones.".to_string(),
            days_title: "Días disponibles",
            presets: vec![("Mañana 7–9", 420, 540, None), ("Noche 20–23", 1200, 1380, None), ("Fin de semana 10–14", 600, 840, weekend)],
        },
        _ => ContextCopy {
            title: "Horas por día".to_string(),
            hint: format!("Franja horaria activa para el contexto {}.", context.trim()),
            days_title: "Días activos",
            presets: vec![("Mañana 9–13", 540, 780, None), ("Tarde 14–18", 840, 1080, None)],
        },
    }
}

/// Preview of the settings being edited, at the local `now`.
pub fn plan_preview(
    board_name: &str,
    context: &str,
    plan: &TaskBoardPlanDto,
    now: DateTime,
) -> Result<TaskBoardPlanPreviewDto, BackendError> {
    plan.validate()?;
    let today = now.date();
    let copy = context_copy(context);
    let hours_per_day = plan.hours_per_day();
    let hours_per_week = hours_per_day * plan.work_days_per_week() as f64;
    let workday = WorkdayPreviewDto {
        title: copy.title,
        hint: copy.hint,
        days_title: copy.days_title.to_string(),
        start_label: clock(plan.day_start_minutes),
        end_label: clock(plan.day_end_minutes),
        hours_per_day: hours_label(hours_per_day),
        hours_per_week: format!("{} h por semana", hours_label(hours_per_week)),
        now_fraction: f64::from(minutes_of(now.time())) / f64::from(MINUTES_PER_DAY),
        presets: copy
            .presets
            .into_iter()
            .map(|(label, start, end, work_days)| WorkdayPresetDto {
                label: label.to_string(),
                start_minutes: start,
                end_minutes: end,
                work_days,
                active: plan.day_start_minutes == start
                    && plan.day_end_minutes == end
                    && work_days.is_none_or(|days| days == plan.work_days),
            })
            .collect(),
    };

    let year = fiscal_year_of(plan, today);
    let year_sprints = sprints_of_year(plan, year);
    let current = sprint_at(plan, today);
    let next = next_sprint(plan, today);
    let after = next_sprint(plan, next.start);
    let rows = [(&current, "current", "Actual"), (&next, "next", "Siguiente"), (&after, "later", "Después")]
        .into_iter()
        .map(|(sprint, kind, badge)| {
            let next_year = sprint.year != current.year && kind != "current";
            SprintRowDto {
                number: sprint.number,
                label: sprint_label(sprint),
                range: date_range(sprint.start, sprint.end),
                badge_kind: if next_year { "next-year" } else { kind }.to_string(),
                badge: if next_year { "Año siguiente" } else { badge }.to_string(),
            }
        })
        .collect();
    let weeks = plan.sprint_weeks;
    let sprints = SprintsPreviewDto {
        weeks_label: if weeks == 1 { "semana".to_string() } else { "semanas".to_string() },
        year_note: format!("{} sprints en el año · la numeración se reinicia con el año.", year_sprints.len()),
        rows,
    };

    let start = fiscal_year_start(plan, year);
    let year_days = days_between(start, fiscal_year_start(plan, year + 1)).max(1) as f64;
    let fraction = |date: Date| (days_between(start, date) as f64 / year_days).clamp(0.0, 1.0);
    let divisions = divisions_of_year(plan, year);
    let current_division = division_at(plan, today);
    let prefix = plan.prefix();
    let average_days = year_days / divisions.len().max(1) as f64;
    let duration = if 12 % u32::from(plan.divisions_per_year) == 0 {
        let months = 12 / u32::from(plan.divisions_per_year);
        format!("Cada {prefix} dura ≈ {months} {}", if months == 1 { "mes" } else { "meses" })
    } else {
        format!("Cada {prefix} dura ≈ {} días", average_days.round() as i64)
    };
    let sprints_per_division = average_days / (f64::from(weeks) * 7.0);
    let months = (0..12)
        .map(|offset| month_short(((i32::from(plan.year_start_month) - 1 + offset).rem_euclid(12) + 1) as i8).to_string())
        .collect();
    let preview_divisions = DivisionsPreviewDto {
        unit: division_unit(plan.divisions_per_year).to_string(),
        year_label: format!("Año {}", fiscal_year_label(plan, year)),
        today_label: format!("Hoy: {}", division_label(plan, &current_division)),
        sprint_label: format!(" · Sprint {} de {}", current.number, year_sprints.len()),
        bars: divisions
            .iter()
            .map(|division| DivisionBarDto {
                label: division_label(plan, division),
                days: division.days(),
                current: division.contains(today),
                tooltip: date_range(division.start, division.end),
            })
            .collect(),
        sprint_ticks: year_sprints.iter().map(|sprint| fraction(sprint.start)).collect(),
        today_fraction: fraction(today),
        months,
        duration,
        sprints_per_division: format!("≈ {} sprints por {prefix}", hours_label(sprints_per_division)),
        current: format!(
            "{}: {}",
            division_label(plan, &current_division),
            date_range(current_division.start, current_division.end)
        ),
    };

    let summary = format!(
        "{} · {} · {}–{} · sprints de {} sem · {} {}",
        board_name.trim(),
        context.trim(),
        clock(plan.day_start_minutes),
        clock(plan.day_end_minutes),
        weeks,
        plan.divisions_per_year,
        prefix
    );
    Ok(TaskBoardPlanPreviewDto { summary, workday, sprints, divisions: preview_divisions })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::civil::date;

    fn plan() -> TaskBoardPlanDto {
        TaskBoardPlanDto::default()
    }

    #[test]
    fn four_divisions_fall_on_whole_quarters() {
        let quarters = divisions_of_year(&plan(), 2026);
        assert_eq!(quarters.len(), 4);
        assert_eq!((quarters[3].start, quarters[3].end), (date(2026, 10, 1), date(2026, 12, 31)));
        assert_eq!(division_title(&plan(), &division_at(&plan(), date(2026, 10, 19))), "Q4 2026");
    }

    #[test]
    fn five_divisions_split_the_year_in_equal_days() {
        let mut five = plan();
        five.divisions_per_year = 5;
        let divisions = divisions_of_year(&five, 2026);
        assert!(divisions.iter().all(|division| division.days() == 73));
        assert_eq!(divisions[4].end, date(2026, 12, 31));
    }

    #[test]
    fn a_fiscal_year_can_start_in_another_month() {
        let mut fiscal = plan();
        fiscal.year_start_month = 7;
        let first = division_at(&fiscal, date(2026, 8, 3));
        assert_eq!((first.number, first.year, first.start), (1, 2026, date(2026, 7, 1)));
        assert_eq!(division_at(&fiscal, date(2026, 3, 1)).year, 2025);
        assert_eq!(division_title(&fiscal, &first), "Q1 2026/27");
    }

    #[test]
    fn sprints_count_from_the_first_start_day_of_the_year() {
        let sprint = sprint_at(&plan(), date(2026, 10, 19));
        assert_eq!((sprint.number, sprint.start, sprint.end), (21, date(2026, 10, 12), date(2026, 10, 25)));
        let next = next_sprint(&plan(), date(2026, 10, 19));
        assert_eq!((next.number, next.start), (22, date(2026, 10, 26)));
        // The first days of January belong to the last sprint of the year before.
        let january = sprint_at(&plan(), date(2026, 1, 2));
        assert_eq!(january.year, 2025);
        assert_eq!(sprint_at(&plan(), date(2026, 1, 5)).number, 1);
        // Seven sprints touch Q4 2026.
        let q4 = division_at(&plan(), date(2026, 10, 19));
        assert_eq!(sprints_between(&plan(), q4.start, q4.end).len(), 7);
    }

    #[test]
    fn changing_the_sprints_moves_the_current_and_next_sprint_dates() {
        let mut weekly = plan();
        weekly.sprint_weeks = 1;
        weekly.sprint_start_weekday = 2;
        let current = sprint_at(&weekly, date(2026, 10, 19));
        assert_eq!((current.start, current.end), (date(2026, 10, 14), date(2026, 10, 20)));
        assert_eq!(next_sprint(&weekly, date(2026, 10, 19)).start, date(2026, 10, 21));
    }

    #[test]
    fn columns_are_recognized_by_kind_or_by_name() {
        assert_eq!(TaskColumnKind::infer("Sprint Actual"), TaskColumnKind::CurrentSprint);
        assert_eq!(TaskColumnKind::infer("Próximo Q"), TaskColumnKind::NextDivision);
        assert_eq!(TaskColumnKind::infer("En Revisión"), TaskColumnKind::Review);
        assert_eq!(TaskColumnKind::infer("Bloqueado"), TaskColumnKind::Blocked);
        assert_eq!(TaskColumnKind::infer("Atrasado"), TaskColumnKind::Overdue);
        assert_eq!(TaskColumnKind::infer("Anotadores"), TaskColumnKind::Notes);
        assert_eq!(TaskColumnKind::infer("Backlog Q"), TaskColumnKind::Custom);
        assert_eq!(TaskColumnKind::from_key("next-sprint"), Some(TaskColumnKind::NextSprint));
    }

    #[test]
    fn the_work_calendar_starts_in_working_time_and_ends_on_the_day_boundary() {
        let calendar = WorkCalendar::new(&plan(), date(2026, 10, 19).at(9, 0, 0, 0));
        assert_eq!(calendar.date_time_at(9.0, true), date(2026, 10, 19).at(18, 0, 0, 0));
        assert_eq!(calendar.date_time_at(9.0, false), date(2026, 10, 20).at(9, 0, 0, 0));
        assert_eq!(calendar.date_time_at(12.0, true), date(2026, 10, 20).at(12, 0, 0, 0));
        // Saturday night starts on Monday morning.
        let weekend = WorkCalendar::new(&plan(), date(2026, 10, 24).at(22, 0, 0, 0));
        assert_eq!(weekend.origin(), date(2026, 10, 26).at(9, 0, 0, 0));
        let friday = WorkCalendar::new(&plan(), date(2026, 10, 23).at(16, 0, 0, 0));
        assert_eq!(friday.date_time_at(5.0, true), date(2026, 10, 26).at(12, 0, 0, 0));
        assert_eq!(calendar.hours_at(date(2026, 10, 20).at(13, 0, 0, 0)), 13.0);
    }

    #[test]
    fn the_preview_names_the_sprints_and_divisions_of_the_settings() {
        let preview = plan_preview("default", "#Laboral", &plan(), date(2026, 10, 19).at(10, 30, 0, 0)).unwrap();
        assert_eq!(preview.summary, "default · #Laboral · 09:00–18:00 · sprints de 2 sem · 4 Q");
        assert_eq!(preview.workday.title, "Jornada laboral");
        assert_eq!(preview.workday.hours_per_day, "9");
        assert_eq!(preview.workday.hours_per_week, "45 h por semana");
        assert!(preview.workday.presets[0].active);
        assert_eq!(preview.sprints.rows[0].range, "12 oct – 25 oct");
        assert_eq!(preview.sprints.rows[1].badge, "Siguiente");
        assert_eq!(preview.divisions.current, "Q4: 1 oct – 31 dic");
        assert_eq!(preview.divisions.today_label, "Hoy: Q4");
        assert_eq!(preview.divisions.sprints_per_division, "≈ 6,5 sprints por Q");
        let mut wrong = plan();
        wrong.day_end_minutes = wrong.day_start_minutes;
        assert!(plan_preview("default", "#Laboral", &wrong, date(2026, 10, 19).at(10, 0, 0, 0)).is_err());
    }

    #[test]
    fn a_board_with_activity_hours_keeps_them_as_its_workday() {
        assert_eq!(TaskBoardPlanDto::from_activity_hours(8.0).day_end_minutes, 17 * 60);
        assert_eq!(TaskBoardPlanDto::from_activity_hours(24.0), TaskBoardPlanDto::default());
    }

    #[test]
    fn palette_colors_are_handed_out_unused_first() {
        assert_eq!(next_palette_color(["#4FD1C5", "#6c8eff"]), "#A78BFA");
        assert_eq!(hours_label(6.5), "6,5");
        assert_eq!(hours_label(16.0), "16");
    }
}
