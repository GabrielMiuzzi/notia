//! AI actions: prompts the agent runs by itself at a set time, always for
//! the Owner and always answered by Telegram. A reminder writes a short
//! notice once, a one-shot action runs its prompt as a task once, and a
//! recurring action repeats it by a rule.
//!
//! This module is the whole logic of the feature and knows neither SQLite
//! nor Telegram: the adapter stores actions and runs, runs the clock and
//! delivers the answers. Times are UTC milliseconds; each action keeps the
//! IANA zone its schedule is read in.

pub mod dashboard;
pub mod labels;
pub mod prompts;
pub mod schedule;
pub mod scheduler;
pub mod tools;

use jiff::tz::TimeZone;
use serde::{Deserialize, Serialize};

pub use dashboard::{build_dashboard, AiActionsDashboard, DashboardFilter};
pub use schedule::{next_after, occurrences_between, upcoming};

pub const MAX_NAME_CHARS: usize = 80;
pub const MAX_PROMPT_CHARS: usize = 4_000;
/// Occurrences listed under the form's summary.
pub const PREVIEW_OCCURRENCES: usize = 3;
/// Zone of a library that has none that `jiff` knows.
pub const FALLBACK_TIME_ZONE: &str = "UTC";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AiActionKind {
    Reminder,
    OneShot,
    Recurring,
}

impl AiActionKind {
    pub const ALL: [Self; 3] = [Self::Reminder, Self::OneShot, Self::Recurring];

    pub fn id(self) -> &'static str {
        match self {
            Self::Reminder => "reminder",
            Self::OneShot => "one-shot",
            Self::Recurring => "recurring",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.id() == id)
    }

    /// Name of the kind in the dashboard («Horario» is its column).
    pub fn label(self) -> &'static str {
        match self {
            Self::Reminder => "Recordatorio",
            Self::OneShot => "Horario",
            Self::Recurring => "Recurrente",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepeatUnit {
    Minutes,
    Hours,
    Days,
    Weeks,
}

impl RepeatUnit {
    /// Largest `every` of the unit: minutes and hours repeat within a day.
    fn max_every(self) -> u32 {
        match self {
            Self::Minutes => 1_440,
            Self::Hours => 24,
            Self::Days => 365,
            Self::Weeks => 52,
        }
    }

    fn within_day(self) -> bool {
        matches!(self, Self::Minutes | Self::Hours)
    }
}

/// Rule of a recurring action. `weekdays` counts from Monday (0) to Sunday
/// (6). With minutes or hours, the occurrences start at `from` (or 00:00)
/// and repeat until `to` (or 23:59) on each chosen day; with days or weeks,
/// `from` is the time of the run and `anchor_date` (the local date the
/// rule was set) fixes which days or weeks count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub every: u32,
    pub unit: RepeatUnit,
    pub weekdays: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    pub anchor_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum AiSchedule {
    Once { at_ms: i64 },
    Recurring { rule: Recurrence },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAction {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub kind: AiActionKind,
    pub schedule: AiSchedule,
    pub time_zone: String,
    pub enabled: bool,
    /// Occurrences before this moment never count: the action did not
    /// exist, had another schedule or was paused. Set on creation, on a
    /// schedule change and when the action is turned on again.
    pub active_since_ms: i64,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    /// Set on the actions Notia creates by itself (`BUILTIN_HOURLY_REVIEW`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub builtin: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
}

impl RunStatus {
    pub fn id(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [Self::Pending, Self::Running, Self::Success, Self::Failed, Self::Skipped]
            .into_iter()
            .find(|status| status.id() == id)
    }

    pub fn is_active(self) -> bool {
        matches!(self, Self::Pending | Self::Running)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunTrigger {
    Scheduled,
    Manual,
    Retry,
    Test,
}

impl RunTrigger {
    pub fn id(self) -> &'static str {
        match self {
            Self::Scheduled => "scheduled",
            Self::Manual => "manual",
            Self::Retry => "retry",
            Self::Test => "test",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        [Self::Scheduled, Self::Manual, Self::Retry, Self::Test].into_iter().find(|trigger| trigger.id() == id)
    }
}

/// One run of an action. A retry keeps the `scheduled_for` of the run it
/// retries; a test has no action. `runner` is the instance that runs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiActionRun {
    pub id: String,
    pub action_id: Option<String>,
    pub action_name: String,
    pub kind: AiActionKind,
    pub scheduled_for_ms: i64,
    pub created_at_ms: i64,
    pub started_at_ms: Option<i64>,
    pub finished_at_ms: Option<i64>,
    pub status: RunStatus,
    pub error: Option<String>,
    pub output_summary: Option<String>,
    pub trigger: RunTrigger,
    pub retry_of: Option<String>,
    pub runner: Option<String>,
}

/// What the form sends. Every field is text as typed; `validate_input`
/// decides.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiActionInput {
    pub kind: Option<AiActionKind>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub every: Option<String>,
    #[serde(default)]
    pub unit: Option<RepeatUnit>,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

fn field_error(field: &str, message: &str) -> FieldError {
    FieldError { field: field.to_string(), message: message.to_string() }
}

/// A checked form: what an action stores.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidAction {
    pub name: String,
    pub prompt: String,
    pub kind: AiActionKind,
    pub schedule: AiSchedule,
}

/// Where the form comes from: a new action, or an edit that may keep the
/// moment and the anchor it already had.
#[derive(Debug, Clone, Copy, Default)]
pub struct InputOrigin<'a> {
    /// A one-time action keeps its past moment when the edit leaves it.
    pub stored_at_ms: Option<i64>,
    /// A recurring action keeps the date its days or weeks count from.
    pub stored_anchor_date: Option<&'a str>,
}

/// The zone named `name`, or the fallback when `jiff` does not know it.
pub fn time_zone(name: &str) -> TimeZone {
    TimeZone::get(name).unwrap_or(TimeZone::UTC)
}

/// The library's zone: the one of its place (Settings → Clima), else the
/// system's, else UTC.
pub fn library_time_zone(place_zone: Option<&str>) -> String {
    place_zone
        .filter(|name| TimeZone::get(name).is_ok())
        .map(str::to_string)
        .or_else(|| TimeZone::try_system().ok().and_then(|zone| zone.iana_name().map(str::to_string)))
        .unwrap_or_else(|| FALLBACK_TIME_ZONE.to_string())
}

/// Checks the form. `now_ms` decides what is future; the zone reads the
/// date and times typed. All errors come back at once, by field.
pub fn validate_input(
    input: &AiActionInput,
    zone: &TimeZone,
    now_ms: i64,
    origin: InputOrigin<'_>,
) -> Result<ValidAction, Vec<FieldError>> {
    let mut errors = Vec::new();
    let name = input.name.trim().to_string();
    if name.is_empty() {
        errors.push(field_error("name", "Poné un nombre."));
    } else if name.chars().count() > MAX_NAME_CHARS {
        errors.push(field_error("name", "El nombre puede tener hasta 80 caracteres."));
    }
    let prompt = input.prompt.trim().to_string();
    if prompt.is_empty() {
        errors.push(field_error("prompt", "Escribí el prompt."));
    } else if prompt.chars().count() > MAX_PROMPT_CHARS {
        errors.push(field_error("prompt", "El prompt puede tener hasta 4000 caracteres."));
    }
    let Some(kind) = input.kind else {
        errors.push(field_error("kind", "Elegí el tipo de acción."));
        return Err(errors);
    };
    let schedule = match kind {
        AiActionKind::Reminder | AiActionKind::OneShot => validate_once(input, zone, now_ms, origin.stored_at_ms, &mut errors),
        AiActionKind::Recurring => validate_recurrence(input, zone, now_ms, origin.stored_anchor_date, &mut errors),
    };
    match schedule {
        Some(schedule) if errors.is_empty() => Ok(ValidAction { name, prompt, kind, schedule }),
        _ => Err(errors),
    }
}

fn validate_once(
    input: &AiActionInput,
    zone: &TimeZone,
    now_ms: i64,
    stored_at_ms: Option<i64>,
    errors: &mut Vec<FieldError>,
) -> Option<AiSchedule> {
    let date = match input.date.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        None => {
            errors.push(field_error("date", "Elegí la fecha."));
            None
        }
        Some(value) => {
            let parsed = schedule::parse_date(value);
            if parsed.is_none() {
                errors.push(field_error("date", "La fecha no es válida."));
            }
            parsed
        }
    };
    let minute = match input.time.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        None => {
            errors.push(field_error("time", "Elegí la hora."));
            None
        }
        Some(value) => {
            let parsed = schedule::parse_minute(value);
            if parsed.is_none() {
                errors.push(field_error("time", "La hora no es válida."));
            }
            parsed
        }
    };
    let at_ms = schedule::local_instant(zone, date?, minute?)?;
    if at_ms <= now_ms && stored_at_ms != Some(at_ms) {
        errors.push(field_error("time", "La fecha y hora tienen que ser futuras."));
        return None;
    }
    Some(AiSchedule::Once { at_ms })
}

fn optional_minute(value: Option<&str>, field: &str, errors: &mut Vec<FieldError>) -> Result<Option<u16>, ()> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some(value) => match schedule::parse_minute(value) {
            Some(minute) => Ok(Some(minute)),
            None => {
                errors.push(field_error(field, "La hora no es válida."));
                Err(())
            }
        },
    }
}

fn validate_recurrence(
    input: &AiActionInput,
    zone: &TimeZone,
    now_ms: i64,
    stored_anchor_date: Option<&str>,
    errors: &mut Vec<FieldError>,
) -> Option<AiSchedule> {
    let unit = input.unit.unwrap_or(RepeatUnit::Hours);
    let every = match input.every.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        None => {
            errors.push(field_error("every", "Indicá cada cuánto se repite."));
            None
        }
        Some(value) => match value.parse::<u32>() {
            Ok(every) if every == 0 => {
                errors.push(field_error("every", "Tiene que ser un número entero mayor o igual a 1."));
                None
            }
            Ok(every) if unit == RepeatUnit::Minutes && every < 5 => {
                errors.push(field_error("every", "En minutos, el mínimo es 5."));
                None
            }
            Ok(every) if every > unit.max_every() => {
                errors.push(field_error("every", &format!("El máximo es {}.", unit.max_every())));
                None
            }
            Ok(every) => Some(every),
            Err(_) => {
                errors.push(field_error("every", "Tiene que ser un número entero mayor o igual a 1."));
                None
            }
        },
    };
    let mut weekdays = input.weekdays.iter().copied().filter(|day| *day < 7).collect::<Vec<_>>();
    weekdays.sort_unstable();
    weekdays.dedup();
    if weekdays.is_empty() {
        errors.push(field_error("weekdays", "Elegí al menos un día."));
    }
    let from = optional_minute(input.from.as_deref(), "from", errors);
    let to = if unit.within_day() { optional_minute(input.to.as_deref(), "to", errors) } else { Ok(None) };
    let (Ok(from), Ok(to)) = (from, to) else {
        return None;
    };
    if !unit.within_day() && from.is_none() {
        errors.push(field_error("from", "En días o semanas, «Desde» es la hora de ejecución y es obligatoria."));
    }
    if let (Some(from), Some(to)) = (from, to) {
        if from >= to {
            errors.push(field_error("to", "«Hasta» tiene que ser posterior a «Desde»."));
        }
    }
    let every = every?;
    if weekdays.is_empty() || !errors.is_empty() {
        return None;
    }
    let anchor_date = stored_anchor_date
        .filter(|date| schedule::parse_date(date).is_some())
        .map(str::to_string)
        .unwrap_or_else(|| schedule::local_date(zone, now_ms).to_string());
    Some(AiSchedule::Recurring {
        rule: Recurrence {
            every,
            unit,
            weekdays,
            from: from.map(schedule::format_minute),
            to: to.map(schedule::format_minute),
            anchor_date,
        },
    })
}

/// The form of a stored action, for editing it.
pub fn input_from_action(action: &AiAction) -> AiActionInput {
    let zone = time_zone(&action.time_zone);
    let mut input = AiActionInput {
        kind: Some(action.kind),
        name: action.name.clone(),
        prompt: action.prompt.clone(),
        ..AiActionInput::default()
    };
    match &action.schedule {
        AiSchedule::Once { at_ms } => {
            let (date, minute) = schedule::local_date_minute(&zone, *at_ms);
            input.date = Some(date.to_string());
            input.time = Some(schedule::format_minute(minute));
            input.unit = Some(RepeatUnit::Hours);
            input.weekdays = vec![0, 1, 2, 3, 4];
        }
        AiSchedule::Recurring { rule } => {
            input.every = Some(rule.every.to_string());
            input.unit = Some(rule.unit);
            input.weekdays = rule.weekdays.clone();
            input.from = rule.from.clone();
            input.to = rule.to.clone();
        }
    }
    input
}

/// Id of the hourly review Notia sets up by itself in every library: the
/// review the autonomous agent used to run on its own clock.
pub const BUILTIN_HOURLY_REVIEW: &str = "hourly-review";

/// The hourly review as an action: every hour, every day, enabled when the
/// library had the autonomous agent on.
pub fn hourly_review_action(id: String, time_zone: String, enabled: bool, now_ms: i64) -> AiAction {
    let zone = self::time_zone(&time_zone);
    AiAction {
        id,
        name: "Revisión de cada hora".to_string(),
        prompt: prompts::HOURLY_REVIEW_PROMPT.to_string(),
        kind: AiActionKind::Recurring,
        schedule: AiSchedule::Recurring {
            rule: Recurrence {
                every: 1,
                unit: RepeatUnit::Hours,
                weekdays: (0..7).collect(),
                from: None,
                to: None,
                anchor_date: schedule::local_date(&zone, now_ms).to_string(),
            },
        },
        time_zone,
        enabled,
        active_since_ms: now_ms,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
        builtin: Some(BUILTIN_HOURLY_REVIEW.to_string()),
    }
}

/// Text folded for search: lower case, without accents.
pub(crate) fn fold(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests;
