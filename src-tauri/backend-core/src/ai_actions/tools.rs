//! Agent tools over the AI actions: the agent administers its own scheduled
//! actions on the Owner's request, in every chat. This module reads the
//! tool arguments into the same form the panel sends, finds the action a
//! call names, and writes the confirmation texts and the views the model
//! reads. The adapter stores the changes (`app/src/ai_actions.rs`).

use jiff::civil::Date;
use jiff::tz::TimeZone;
use serde_json::{json, Map, Value};

use super::dashboard::{AiActionsDashboard, RunRow};
use super::labels::{moment_label, next_label, schedule_label};
use super::schedule::local_date;
use super::{fold, input_from_action, time_zone, upcoming, AiAction, AiActionInput, AiActionKind, FieldError, RepeatUnit, ValidAction};
use crate::error::BackendError;

pub const AI_ACTION_READ_TOOLS: [&str; 2] = ["list_ai_actions", "get_ai_action"];
pub const AI_ACTION_WRITE_TOOLS: [&str; 6] = [
    "create_ai_action",
    "update_ai_action",
    "set_ai_action_enabled",
    "delete_ai_action",
    "run_ai_action_now",
    "retry_ai_action_run",
];
/// Runs of an action `get_ai_action` lists.
pub const TOOL_HISTORY_RUNS: usize = 10;
/// Prompt characters `list_ai_actions` shows per action.
const LIST_PROMPT_CHARS: usize = 240;
const WEEKDAY_NAMES: [&str; 7] = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

pub fn is_ai_action_tool(name: &str) -> bool {
    AI_ACTION_READ_TOOLS.contains(&name) || is_ai_action_write_tool(name)
}

pub fn is_ai_action_write_tool(name: &str) -> bool {
    AI_ACTION_WRITE_TOOLS.contains(&name)
}

fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}

fn text(arguments: &Value, name: &str) -> Option<String> {
    arguments.get(name).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

pub fn required_text(arguments: &Value, name: &str) -> Result<String, BackendError> {
    text(arguments, name).ok_or_else(|| invalid(format!("Falta {name}.")))
}

/// `enabled`, when the call sends it.
pub fn enabled_argument(arguments: &Value) -> Result<Option<bool>, BackendError> {
    match arguments.get("enabled") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(enabled)) => Ok(Some(*enabled)),
        Some(_) => Err(invalid("enabled tiene que ser true o false.")),
    }
}

/// The action a call names: by id, or by exact name without caring about
/// case or accents. Several with that name is an error that lists them.
pub fn resolve_action<'a>(actions: &'a [AiAction], reference: &str) -> Result<&'a AiAction, BackendError> {
    if let Some(action) = actions.iter().find(|action| action.id == reference) {
        return Ok(action);
    }
    let wanted = fold(reference.trim());
    let matches = actions.iter().filter(|action| fold(action.name.trim()) == wanted).collect::<Vec<_>>();
    match matches.as_slice() {
        [action] => Ok(action),
        [] => Err(BackendError::new(
            crate::error::BackendErrorCode::NotFound,
            "No hay una acción con ese id o nombre; consultalas con list_ai_actions.",
            false,
        )),
        several => Err(invalid(format!(
            "Hay {} acciones llamadas así; usá su id: {}.",
            several.len(),
            several.iter().map(|action| action.id.as_str()).collect::<Vec<_>>().join(", ")
        ))),
    }
}

fn kind_argument(value: &str) -> Result<AiActionKind, BackendError> {
    match fold(value.trim()).as_str() {
        "reminder" | "recordatorio" => Ok(AiActionKind::Reminder),
        "one-shot" | "oneshot" | "hora" | "hora especifica" | "horario" | "una vez" => Ok(AiActionKind::OneShot),
        "recurring" | "recurrente" => Ok(AiActionKind::Recurring),
        _ => Err(invalid("kind tiene que ser reminder, one-shot o recurring.")),
    }
}

fn unit_argument(value: &str) -> Result<RepeatUnit, BackendError> {
    match fold(value.trim()).as_str() {
        "minutes" | "minutos" | "minuto" => Ok(RepeatUnit::Minutes),
        "hours" | "horas" | "hora" => Ok(RepeatUnit::Hours),
        "days" | "dias" | "dia" => Ok(RepeatUnit::Days),
        "weeks" | "semanas" | "semana" => Ok(RepeatUnit::Weeks),
        _ => Err(invalid("unit tiene que ser minutes, hours, days o weeks.")),
    }
}

/// A day of the week: 0 (lunes) to 6 (domingo), or its Spanish name.
fn weekday_argument(value: &Value) -> Result<u8, BackendError> {
    let day = match value {
        Value::Number(number) => number.as_u64().filter(|day| *day < 7).map(|day| day as u8),
        Value::String(name) => {
            let name = fold(name.trim());
            WEEKDAY_NAMES.iter().position(|day| *day == name || (name.len() >= 2 && day.starts_with(&name))).map(|day| day as u8)
        }
        _ => None,
    };
    day.ok_or_else(|| invalid("weekdays lleva días de 0 (lunes) a 6 (domingo) o sus nombres."))
}

/// An optional text field: absent keeps `current`, `null` or empty clears it.
fn optional_field(arguments: &Value, name: &str, current: Option<String>) -> Result<Option<String>, BackendError> {
    match arguments.get(name) {
        None => Ok(current),
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.trim().to_string()).filter(|value| !value.is_empty())),
        Some(_) => Err(invalid(format!("{name} tiene que ser texto."))),
    }
}

/// The form of a call, on top of `base`: the stored action's for an update,
/// empty for a create. Fields the call leaves out keep their value.
pub fn input_from_arguments(arguments: &Value, base: AiActionInput) -> Result<AiActionInput, BackendError> {
    let mut input = base;
    if let Some(kind) = text(arguments, "kind") {
        input.kind = Some(kind_argument(&kind)?);
    }
    if let Some(name) = arguments.get("name") {
        input.name = name.as_str().ok_or_else(|| invalid("name tiene que ser texto."))?.to_string();
    }
    if let Some(prompt) = arguments.get("prompt") {
        input.prompt = prompt.as_str().ok_or_else(|| invalid("prompt tiene que ser texto."))?.to_string();
    }
    input.date = optional_field(arguments, "date", input.date)?;
    input.time = optional_field(arguments, "time", input.time)?;
    input.from = optional_field(arguments, "from", input.from)?;
    input.to = optional_field(arguments, "to", input.to)?;
    match arguments.get("every") {
        None => {}
        Some(Value::Number(number)) => input.every = Some(number.to_string()),
        Some(Value::String(value)) => input.every = Some(value.trim().to_string()),
        Some(Value::Null) => input.every = None,
        Some(_) => return Err(invalid("every tiene que ser un número entero.")),
    }
    if let Some(unit) = text(arguments, "unit") {
        input.unit = Some(unit_argument(&unit)?);
    }
    if let Some(days) = arguments.get("weekdays") {
        let days = days.as_array().ok_or_else(|| invalid("weekdays tiene que ser una lista."))?;
        let mut weekdays = days.iter().map(weekday_argument).collect::<Result<Vec<_>, _>>()?;
        weekdays.sort_unstable();
        weekdays.dedup();
        input.weekdays = weekdays;
    }
    // A recurrence without days or unit gets the form's defaults.
    if input.kind == Some(AiActionKind::Recurring) {
        if input.unit.is_none() {
            input.unit = Some(RepeatUnit::Hours);
        }
        if input.weekdays.is_empty() && arguments.get("weekdays").is_none() {
            input.weekdays = (0..7).collect();
        }
    }
    Ok(input)
}

/// The base of a create: an empty form.
pub fn empty_input() -> AiActionInput {
    AiActionInput::default()
}

/// The form of a stored action, as an update starts from it.
pub fn stored_input(action: &AiAction) -> AiActionInput {
    input_from_action(action)
}

/// The form's errors as one message for the model.
pub fn field_errors_message(errors: &[FieldError]) -> String {
    let fields = errors.iter().map(|error| format!("{}: {}", error.field, error.message)).collect::<Vec<_>>().join(" ");
    format!("La acción no es válida. {fields}")
}

fn kind_noun(kind: AiActionKind) -> &'static str {
    match kind {
        AiActionKind::Reminder => "el recordatorio",
        AiActionKind::OneShot => "la acción de una vez",
        AiActionKind::Recurring => "la acción recurrente",
    }
}

fn clipped(value: &str, max: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    format!("{}…", collapsed.chars().take(max).collect::<String>().trim_end())
}

fn today(zone: &TimeZone, now_ms: i64) -> Date {
    local_date(zone, now_ms)
}

/// Confirmation of a create: what, when and the prompt as it will run.
pub fn create_summary(valid: &ValidAction, zone_name: &str, enabled: bool, now_ms: i64) -> String {
    let zone = time_zone(zone_name);
    let when = schedule_label(&valid.schedule, &zone, today(&zone, now_ms));
    let paused = if enabled { "" } else { " (pausada)" };
    format!("Crear {} «{}» · {when}{paused}.\nPrompt: {}", kind_noun(valid.kind), valid.name, valid.prompt)
}

/// Confirmation of an update: only what changes.
pub fn update_summary(before: &AiAction, valid: &ValidAction, enabled: Option<bool>, now_ms: i64) -> String {
    let zone = time_zone(&before.time_zone);
    let today = today(&zone, now_ms);
    let mut changes = Vec::new();
    if valid.name != before.name {
        changes.push(format!("nombre «{}»", valid.name));
    }
    if valid.kind != before.kind {
        changes.push(format!("tipo {}", valid.kind.label().to_lowercase()));
    }
    let (old_when, new_when) = (schedule_label(&before.schedule, &zone, today), schedule_label(&valid.schedule, &zone, today));
    if valid.schedule != before.schedule {
        changes.push(format!("horario «{old_when}» → «{new_when}»"));
    }
    if valid.prompt != before.prompt {
        changes.push(format!("prompt «{}»", clipped(&valid.prompt, 400)));
    }
    match enabled {
        Some(true) if !before.enabled => changes.push("activarla".into()),
        Some(false) if before.enabled => changes.push("pausarla".into()),
        _ => {}
    }
    if changes.is_empty() {
        format!("Guardar «{}» sin cambios.", before.name)
    } else {
        format!("Cambiar «{}»: {}.", before.name, changes.join("; "))
    }
}

pub fn enabled_summary(action: &AiAction, enabled: bool) -> String {
    match (enabled, action.enabled) {
        (true, true) => format!("«{}» ya está activa.", action.name),
        (false, false) => format!("«{}» ya está pausada.", action.name),
        (true, false) => format!("Activar «{}».", action.name),
        (false, true) => format!("Pausar «{}».", action.name),
    }
}

pub fn delete_summary(action: &AiAction) -> String {
    format!("Eliminar {} «{}». Su historial de ejecuciones se conserva.", kind_noun(action.kind), action.name)
}

pub fn run_now_summary(action: &AiAction) -> String {
    format!("Ejecutar ahora «{}»; la respuesta llega por Telegram.", action.name)
}

pub fn retry_summary(action_name: &str) -> String {
    format!("Reintentar la ejecución fallida de «{action_name}»; la respuesta llega por Telegram.")
}

fn next_run(action: &AiAction, now_ms: i64, zone: &TimeZone, today: Date) -> Option<String> {
    if !action.enabled {
        return None;
    }
    super::next_after(&action.schedule, &time_zone(&action.time_zone), now_ms.max(action.active_since_ms - 1))
        .map(|at_ms| next_label(zone, at_ms, today))
}

/// What `list_ai_actions` returns: every action, with the state its card
/// shows (or «Ya pasó» for the one-time actions the panel hides), and the
/// next run of the day.
pub fn list_view(actions: &[AiAction], dashboard: &AiActionsDashboard, now_ms: i64, zone: &TimeZone) -> Value {
    let today = today(zone, now_ms);
    let cards = dashboard.columns.iter().flat_map(|column| column.cards.iter()).collect::<Vec<_>>();
    let items = actions
        .iter()
        .map(|action| {
            let card = cards.iter().find(|card| card.id == action.id);
            json!({
                "id": action.id,
                "name": action.name,
                "kind": action.kind.id(),
                "enabled": action.enabled,
                "when": schedule_label(&action.schedule, zone, today),
                "status": card.map_or_else(|| "Ya pasó".to_string(), |card| card.status.label.clone()),
                "failedRunId": card.and_then(|card| card.retry_run_id.clone()),
                "nextRun": next_run(action, now_ms, zone, today),
                "todayRuns": card.and_then(|card| card.runs_label.clone()),
                "prompt": clipped(&action.prompt, LIST_PROMPT_CHARS),
                "builtin": action.builtin.is_some(),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "actions": items,
        "today": {
            "doneToday": dashboard.metrics.done_today,
            "failedToday": dashboard.metrics.failed_today,
            "pendingToday": dashboard.metrics.pending_today,
            "nextRun": dashboard.metrics.next.as_ref().map(|next| format!("{} · {}", next.time, next.name)),
        },
    })
}

/// What `get_ai_action` returns: the whole action, its form fields, its
/// next runs and its latest runs.
pub fn detail_view(action: &AiAction, history: &[RunRow], now_ms: i64, zone: &TimeZone) -> Value {
    let today = today(zone, now_ms);
    let form = input_from_action(action);
    let mut fields = Map::new();
    match action.kind {
        AiActionKind::Reminder | AiActionKind::OneShot => {
            fields.insert("date".into(), json!(form.date));
            fields.insert("time".into(), json!(form.time));
        }
        AiActionKind::Recurring => {
            fields.insert("every".into(), json!(form.every));
            fields.insert("unit".into(), json!(form.unit));
            fields.insert("weekdays".into(), json!(form.weekdays));
            fields.insert("from".into(), json!(form.from));
            fields.insert("to".into(), json!(form.to));
        }
    }
    let action_zone = time_zone(&action.time_zone);
    let next = if action.enabled {
        upcoming(&action.schedule, &action_zone, now_ms.max(action.active_since_ms - 1), 3)
            .into_iter()
            .map(|at_ms| moment_label(zone, at_ms, today))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    json!({
        "id": action.id,
        "name": action.name,
        "kind": action.kind.id(),
        "enabled": action.enabled,
        "prompt": action.prompt,
        "when": schedule_label(&action.schedule, zone, today),
        "schedule": Value::Object(fields),
        "timeZone": action.time_zone,
        "nextRuns": next,
        "builtin": action.builtin.is_some(),
        "runs": history.iter().take(TOOL_HISTORY_RUNS).map(|run| json!({
            "id": run.id,
            "when": run.when,
            "trigger": run.trigger,
            "status": run.status.label,
            "note": run.note,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_actions::{hourly_review_action, AiSchedule};

    fn action(id: &str, name: &str) -> AiAction {
        let mut action = hourly_review_action(id.into(), "America/Argentina/Buenos_Aires".into(), true, 0);
        action.name = name.into();
        action.builtin = None;
        action
    }

    #[test]
    fn an_action_is_found_by_id_or_by_its_name() {
        let actions = [action("a1", "Resumen de correos"), action("a2", "Registrar gastos"), action("a3", "registrar GASTOS")];
        assert_eq!(resolve_action(&actions, "a2").expect("id").id, "a2");
        assert_eq!(resolve_action(&actions, "resumen de correos").expect("name").id, "a1");
        let several = resolve_action(&actions, "Registrar gastos").expect_err("ambiguous");
        assert!(several.message.contains("a2, a3"));
        assert!(resolve_action(&actions, "otra").is_err());
    }

    #[test]
    fn the_arguments_fill_the_form_and_keep_what_they_leave_out() {
        let created = input_from_arguments(
            &json!({"kind": "recurrente", "name": "Gastos", "prompt": "Preguntame", "every": 3, "unit": "horas", "weekdays": ["lunes", "vie", 2], "from": "09:00", "to": "21:00"}),
            empty_input(),
        )
        .expect("create");
        assert_eq!(created.kind, Some(AiActionKind::Recurring));
        assert_eq!((created.every.as_deref(), created.unit, created.weekdays.clone()), (Some("3"), Some(RepeatUnit::Hours), vec![0, 2, 4]));
        // A recurrence without days runs every day.
        let every_day = input_from_arguments(&json!({"kind": "recurring", "every": "1"}), empty_input()).expect("days");
        assert_eq!(every_day.weekdays, (0..7).collect::<Vec<_>>());
        let updated = input_from_arguments(&json!({"to": null, "name": "Gastos del día"}), created.clone()).expect("update");
        assert_eq!((updated.name.as_str(), updated.to, updated.from.as_deref()), ("Gastos del día", None, Some("09:00")));
        assert!(input_from_arguments(&json!({"unit": "años"}), created.clone()).is_err());
        assert!(input_from_arguments(&json!({"weekdays": [7]}), created).is_err());
        assert_eq!(enabled_argument(&json!({"enabled": false})).expect("enabled"), Some(false));
    }

    #[test]
    fn the_confirmations_say_what_changes() {
        let before = action("a1", "Revisión");
        let mut after = ValidAction { name: "Revisión".into(), prompt: before.prompt.clone(), kind: before.kind, schedule: before.schedule.clone() };
        assert_eq!(update_summary(&before, &after, None, 0), "Guardar «Revisión» sin cambios.");
        if let AiSchedule::Recurring { rule } = &mut after.schedule {
            rule.every = 2;
        }
        let summary = update_summary(&before, &after, Some(false), 0);
        assert!(summary.contains("horario «Cada hora» → «Cada 2 h»") && summary.contains("pausarla"), "{summary}");
        let created = create_summary(&after, "America/Argentina/Buenos_Aires", true, 0);
        assert!(created.starts_with("Crear la acción recurrente «Revisión» · Cada 2 h."), "{created}");
        assert_eq!(enabled_summary(&before, false), "Pausar «Revisión».");
    }
}
