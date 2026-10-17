//! Agent tools that run the board's own actions.
//!
//! Each tool becomes the same [`TaskBoardIntent`] the interface sends, so the
//! assistant follows the board's rules: the running time, the «Bloqueado»
//! column, people and projects of the board, dependencies without cycles,
//! subtasks that follow their task. The model names tickets, boards and
//! groups by the ids the read tools return.

use serde_json::{json, Value};

use crate::error::BackendError;
use crate::task_board_actions::{board_members, board_plan, board_projects};
use crate::task_board_plan::{
    clock, date_range, division_title, division_with_offset, fold, hours_label, month_long, next_sprint, sprint_at,
    sprint_label, weekday_long, TaskBoardPlanDto, TaskColumnKind,
};
use crate::task_management_view::ManagementViewDto;
use crate::task_manager_tools::{TaskBoardDto, TaskManagerLibrarySnapshotDto, TaskState, TaskTicketDto};
use crate::task_manager_ui::{TaskBoardIntent, DEFAULT_CONTEXT_TAG};

/// Tools that change the board through its own actions; each asks for
/// confirmation.
pub const TASK_BOARD_ACTION_TOOLS: [&str; 18] = [
    "set_task_time",
    "set_task_people",
    "set_task_project",
    "start_task_timer",
    "pause_task_timer",
    "set_task_block_note",
    "set_task_dependencies",
    "toggle_task_subtask",
    "change_task_state",
    "archive_task",
    "restore_task",
    "move_task_group",
    "duplicate_task",
    "add_task_board_member",
    "remove_task_board_member",
    "add_task_board_project",
    "remove_task_board_project",
    "update_task_board_calendar",
];

/// Reads of a board's settings and plan.
pub const TASK_BOARD_READ_TOOLS: [&str; 2] = ["get_task_board_settings", "get_task_board_plan"];

pub fn is_task_board_action_tool(name: &str) -> bool {
    TASK_BOARD_ACTION_TOOLS.contains(&name)
}

pub fn is_task_board_read_tool(name: &str) -> bool {
    TASK_BOARD_READ_TOOLS.contains(&name)
}

/// What a tool asks of the board: its intents, and a title the copy of a
/// duplicate takes afterwards.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardToolPlan {
    pub intents: Vec<TaskBoardIntent>,
    pub rename_copy_to: Option<String>,
    /// The confirmation the person reads, naming tickets by their title.
    pub summary: String,
}

fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}

fn text(arguments: &Value, name: &str) -> String {
    arguments.get(name).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string()
}

fn required(arguments: &Value, name: &str) -> Result<String, BackendError> {
    Some(text(arguments, name))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("Falta {name}; consultalo con las herramientas de lectura antes de cambiar el tablero.")))
}

fn strings(arguments: &Value, name: &str) -> Option<Vec<String>> {
    arguments.get(name).and_then(Value::as_array).map(|values| {
        values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect()
    })
}

fn number(arguments: &Value, name: &str) -> Result<Option<f64>, BackendError> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_f64()
            .filter(|value| value.is_finite() && *value >= 0.0)
            .map(Some)
            .ok_or_else(|| invalid(format!("{name} debe ser un número de horas mayor o igual a 0."))),
    }
}

fn find_ticket<'a>(snapshot: &'a TaskManagerLibrarySnapshotDto, id: &str) -> Result<&'a TaskTicketDto, BackendError> {
    snapshot
        .tickets
        .iter()
        .find(|ticket| ticket.summary.ticket_id == id)
        .filter(|ticket| !ticket.summary.logical_path.is_empty())
        .ok_or_else(|| invalid("El ticket no existe o no está a tu alcance; buscalo con search_task_tickets."))
}

fn board<'a>(snapshot: &'a TaskManagerLibrarySnapshotDto, reference: &str) -> Result<&'a TaskBoardDto, BackendError> {
    snapshot
        .boards
        .iter()
        .find(|board| board.board_id == reference || fold(&board.name) == fold(reference))
        .ok_or_else(|| invalid("El tablero no existe o no está a tu alcance; consultalo con get_task_manager_options."))
}

fn quoted(names: &[String]) -> String {
    let quoted = names.iter().map(|name| format!("«{name}»")).collect::<Vec<_>>();
    match quoted.as_slice() {
        [] => String::new(),
        [single] => single.clone(),
        [rest @ .., last] => format!("{} y {last}", rest.join(", ")),
    }
}

fn state_label(state: TaskState) -> &'static str {
    match state {
        TaskState::Pending => "Pendiente",
        TaskState::InProgress => "En progreso",
        TaskState::Blocked => "Bloqueada",
        TaskState::Completed => "Finalizada",
        TaskState::Cancelled => "Cancelada",
    }
}

const DAY_PREFIXES: [&str; 7] = ["lu", "ma", "mi", "ju", "vi", "sa", "do"];

/// 0 is Monday; accepts «lunes», «lun», «Lu»…
fn weekday_index(value: &str) -> Option<usize> {
    let folded = fold(value);
    DAY_PREFIXES.iter().position(|prefix| folded.starts_with(prefix))
}

/// «09:00» or «9:30» in minutes since midnight.
fn minutes(value: &str) -> Result<u16, BackendError> {
    let (hours, minutes) = value.trim().split_once(':').unwrap_or((value.trim(), "0"));
    let hours = hours.parse::<u16>().ok().filter(|hours| *hours <= 24);
    let minutes = minutes.parse::<u16>().ok().filter(|minutes| *minutes < 60);
    match (hours, minutes) {
        (Some(hours), Some(minutes)) if hours * 60 + minutes <= 24 * 60 => Ok(hours * 60 + minutes),
        _ => Err(invalid(format!("«{value}» no es una hora HH:MM."))),
    }
}

fn month_number(value: &Value) -> Result<u8, BackendError> {
    if let Some(number) = value.as_u64().filter(|number| (1..=12).contains(number)) {
        return Ok(number as u8);
    }
    let name = value.as_str().map(fold).unwrap_or_default();
    (1..=12)
        .find(|month| fold(month_long(*month as i8)).starts_with(&name) && name.len() >= 3)
        .map(|month| month as u8)
        .ok_or_else(|| invalid("yearStartMonth es un mes de 1 a 12 o su nombre."))
}

/// The calendar with the fields the tool sends, and the changes in words.
fn calendar_from(current: &TaskBoardPlanDto, arguments: &Value) -> Result<(TaskBoardPlanDto, Vec<String>), BackendError> {
    let mut plan = current.clone();
    let mut changes = Vec::new();
    if let Some(start) = arguments.get("workdayStart").and_then(Value::as_str) {
        plan.day_start_minutes = minutes(start)?;
    }
    if let Some(end) = arguments.get("workdayEnd").and_then(Value::as_str) {
        plan.day_end_minutes = minutes(end)?;
    }
    if (plan.day_start_minutes, plan.day_end_minutes) != (current.day_start_minutes, current.day_end_minutes) {
        changes.push(format!("jornada {}–{}", clock(plan.day_start_minutes), clock(plan.day_end_minutes)));
    }
    if let Some(days) = strings(arguments, "workDays") {
        let mut work_days = [false; 7];
        for day in &days {
            let index = weekday_index(day).ok_or_else(|| invalid(format!("«{day}» no es un día de la semana.")))?;
            work_days[index] = true;
        }
        plan.work_days = work_days;
        if work_days != current.work_days {
            let names = (0..7).filter(|index| work_days[*index]).map(weekday_long).collect::<Vec<_>>();
            changes.push(format!("días {}", names.join(", ")));
        }
    }
    if let Some(weeks) = arguments.get("sprintWeeks") {
        plan.sprint_weeks = weeks
            .as_u64()
            .filter(|weeks| (1..=8).contains(weeks))
            .ok_or_else(|| invalid("sprintWeeks va de 1 a 8."))? as u8;
        if plan.sprint_weeks != current.sprint_weeks {
            changes.push(format!("sprints de {} semana{}", plan.sprint_weeks, if plan.sprint_weeks == 1 { "" } else { "s" }));
        }
    }
    if let Some(day) = arguments.get("sprintStartDay").and_then(Value::as_str) {
        let index = weekday_index(day).filter(|index| *index <= 4).ok_or_else(|| invalid("sprintStartDay va de lunes a viernes."))?;
        plan.sprint_start_weekday = index as u8;
        if plan.sprint_start_weekday != current.sprint_start_weekday {
            changes.push(format!("sprints desde el {}", weekday_long(index)));
        }
    }
    if let Some(count) = arguments.get("divisionsPerYear") {
        plan.divisions_per_year = count
            .as_u64()
            .filter(|count| (1..=12).contains(count))
            .ok_or_else(|| invalid("divisionsPerYear va de 1 a 12."))? as u8;
        if plan.divisions_per_year != current.divisions_per_year {
            changes.push(format!("{} divisiones por año", plan.divisions_per_year));
        }
    }
    if let Some(prefix) = arguments.get("divisionPrefix").and_then(Value::as_str) {
        plan.division_prefix = prefix.trim().to_string();
        if plan.division_prefix != current.division_prefix {
            changes.push(format!("prefijo «{}»", plan.division_prefix));
        }
    }
    if let Some(month) = arguments.get("yearStartMonth") {
        plan.year_start_month = month_number(month)?;
        if plan.year_start_month != current.year_start_month {
            changes.push(format!("año desde {}", month_long(plan.year_start_month as i8)));
        }
    }
    plan.validate()?;
    Ok((plan, changes))
}

/// Turns a board tool into the board's intents and its confirmation text.
/// `owner_name` is the library Owner's name, the owner of every board.
pub fn board_tool_plan(
    name: &str,
    arguments: &Value,
    snapshot: &TaskManagerLibrarySnapshotDto,
    owner_name: Option<&str>,
) -> Result<BoardToolPlan, BackendError> {
    let one = |intent: TaskBoardIntent, summary: String| BoardToolPlan { intents: vec![intent], rename_copy_to: None, summary };
    let none = |summary: String| BoardToolPlan { intents: Vec::new(), rename_copy_to: None, summary };
    let task = || -> Result<&TaskTicketDto, BackendError> { find_ticket(snapshot, &required(arguments, "ticketId")?) };
    let path = |ticket: &TaskTicketDto| ticket.summary.logical_path.clone();
    let title = |ticket: &TaskTicketDto| ticket.summary.title.clone();
    Ok(match name {
        "set_task_time" => {
            let ticket = task()?;
            let estimated = number(arguments, "estimatedHours")?;
            let dedicated = number(arguments, "dedicatedHours")?;
            if estimated.is_none() && dedicated.is_none() {
                return Err(invalid("set_task_time necesita estimatedHours, dedicatedHours o ambos."));
            }
            let mut parts = Vec::new();
            if let Some(hours) = estimated {
                parts.push(if hours > 0.0 { format!("estimado {} h", hours_label(hours)) } else { "sin estimación".to_string() });
            }
            if let Some(hours) = dedicated {
                parts.push(format!("dedicado {} h", hours_label(hours)));
            }
            one(
                TaskBoardIntent::SetTaskTime { task_path: path(ticket), estimated_hours: estimated, dedicated_hours: dedicated },
                format!("Cambiar el tiempo de «{}»: {}.", title(ticket), parts.join(", ")),
            )
        }
        "set_task_people" => {
            let ticket = task()?;
            let people = strings(arguments, "people").ok_or_else(|| invalid("Falta people (una lista de nombres)."))?;
            let mode = text(arguments, "mode");
            let mut next = ticket.assignees.clone();
            match mode.as_str() {
                "" | "replace" => next = people.clone(),
                "add" => next.extend(people.clone()),
                "remove" => next.retain(|name| !people.iter().any(|removed| fold(removed) == fold(name))),
                _ => return Err(invalid("mode es replace, add o remove.")),
            }
            let members = board_members(snapshot, &ticket.summary.board_id, owner_name);
            let unknown = next
                .iter()
                .filter(|name| !members.iter().any(|member| fold(&member.name) == fold(name)))
                .cloned()
                .collect::<Vec<_>>();
            if !unknown.is_empty() {
                return Err(invalid(format!(
                    "{} no {} en el tablero: agregalas con add_task_board_member (confirmando con el usuario) o elegí personas de get_task_board_settings.",
                    quoted(&unknown),
                    if unknown.len() == 1 { "está" } else { "están" }
                )));
            }
            let summary = if next.is_empty() {
                format!("Quitar a todas las personas de «{}».", title(ticket))
            } else {
                format!("Asignar «{}» a {}.", title(ticket), quoted(&next))
            };
            one(TaskBoardIntent::SetTaskPeople { task_path: path(ticket), people: next }, summary)
        }
        "set_task_project" => {
            let ticket = task()?;
            let project = text(arguments, "project");
            let summary = if project.is_empty() {
                format!("Quitar el proyecto de «{}».", title(ticket))
            } else {
                let exists = board_projects(snapshot, &ticket.summary.board_id)
                    .iter()
                    .any(|candidate| fold(&candidate.name) == fold(&project));
                format!(
                    "Poner «{}» en el proyecto «{project}»{}.",
                    title(ticket),
                    if exists { "" } else { " (se crea en el tablero)" }
                )
            };
            one(TaskBoardIntent::SetTaskProject { task_path: path(ticket), project }, summary)
        }
        "start_task_timer" => {
            let ticket = task()?;
            one(
                TaskBoardIntent::StartTask { task_path: path(ticket) },
                format!("Iniciar «{}»: pasa a En progreso y empieza a contar el tiempo.", title(ticket)),
            )
        }
        "pause_task_timer" => {
            let ticket = task()?;
            one(
                TaskBoardIntent::PauseTask { task_path: path(ticket) },
                format!("Pausar «{}»: vuelve a Pendiente y suma el tiempo corrido a lo dedicado.", title(ticket)),
            )
        }
        "set_task_block_note" => {
            let ticket = task()?;
            let note = text(arguments, "note");
            let summary = if note.is_empty() {
                format!("Quitar el motivo de bloqueo de «{}».", title(ticket))
            } else {
                format!("Poner como motivo de bloqueo de «{}»: «{note}».", title(ticket))
            };
            one(TaskBoardIntent::SetBlockNote { task_path: path(ticket), note }, summary)
        }
        "set_task_dependencies" => {
            let ticket = task()?;
            let ids = strings(arguments, "dependsOnTicketIds").ok_or_else(|| invalid("Falta dependsOnTicketIds (puede ser una lista vacía)."))?;
            let dependencies = ids.iter().map(|id| find_ticket(snapshot, id)).collect::<Result<Vec<_>, _>>()?;
            let summary = if dependencies.is_empty() {
                format!("Quitar las dependencias de «{}».", title(ticket))
            } else {
                let names = dependencies.iter().map(|dependency| dependency.summary.title.clone()).collect::<Vec<_>>();
                format!("Hacer que «{}» empiece después de {}.", title(ticket), quoted(&names))
            };
            one(
                TaskBoardIntent::SetDependencies {
                    task_path: path(ticket),
                    dependency_paths: dependencies.iter().map(|dependency| path(dependency)).collect(),
                },
                summary,
            )
        }
        "toggle_task_subtask" => {
            let ticket = task()?;
            if ticket.summary.parent_ticket_id.is_none() {
                return Err(invalid("toggle_task_subtask es para subtareas; para una tarea usá change_task_state."));
            }
            let done = arguments.get("done").and_then(Value::as_bool).ok_or_else(|| invalid("Falta done (true o false)."))?;
            let label = if done { "hecha" } else { "pendiente" };
            if (ticket.summary.state == TaskState::Completed) == done {
                none(format!("La subtarea «{}» ya está {label}.", title(ticket)))
            } else {
                one(
                    TaskBoardIntent::ToggleSubtask { task_path: path(ticket) },
                    format!("Marcar la subtarea «{}» como {label}.", title(ticket)),
                )
            }
        }
        "change_task_state" => {
            let ticket = task()?;
            let state = serde_json::from_value::<TaskState>(arguments.get("state").cloned().unwrap_or(Value::Null))
                .map_err(|_| invalid("state no es un estado permitido."))?;
            one(
                TaskBoardIntent::ChangeState { task_path: path(ticket), state },
                format!("Cambiar el estado de «{}» a {}.", title(ticket), state_label(state)),
            )
        }
        "archive_task" => {
            let ticket = task()?;
            one(TaskBoardIntent::FinishTask { task_path: path(ticket) }, format!("Finalizar «{}».", title(ticket)))
        }
        "restore_task" => {
            let ticket = task()?;
            one(
                TaskBoardIntent::RestoreTasks { task_paths: vec![path(ticket)] },
                format!("Recuperar «{}» como pendiente en su columna.", title(ticket)),
            )
        }
        "move_task_group" => {
            let ticket = task()?;
            let group_id = required(arguments, "groupId")?;
            let group = snapshot
                .groups
                .iter()
                .find(|group| group.group_id == group_id && group.board_id == ticket.summary.board_id)
                .ok_or_else(|| invalid("El grupo no existe en el tablero del ticket; consultalo con get_task_manager_options."))?;
            let note = match group.column_kind() {
                TaskColumnKind::Blocked => " (queda bloqueada)",
                _ if ticket.summary.state == TaskState::Blocked => " (deja de estar bloqueada)",
                _ => "",
            };
            one(
                TaskBoardIntent::MoveTask { task_path: path(ticket), group: group.group_id.clone() },
                format!("Mover «{}» a la columna «{}»{note}; sus subtareas van con ella.", title(ticket), group.name),
            )
        }
        "duplicate_task" => {
            let ticket = task()?;
            let rename = Some(text(arguments, "title")).filter(|title| !title.is_empty());
            let copy = rename.clone().unwrap_or_else(|| format!("{} (copia)", title(ticket)));
            BoardToolPlan {
                intents: vec![TaskBoardIntent::DuplicateTask { task_path: path(ticket) }],
                rename_copy_to: rename,
                summary: format!(
                    "Duplicar «{}» como «{copy}», sin horas, con las mismas personas, proyecto y dependencias y sus subtareas sin marcar.",
                    title(ticket)
                ),
            }
        }
        "add_task_board_member" | "remove_task_board_member" | "add_task_board_project" | "remove_task_board_project" => {
            let board = board(snapshot, &required(arguments, "boardId")?)?;
            let person_or_project = required(arguments, "name")?;
            let (intent, summary) = match name {
                "add_task_board_member" => (
                    TaskBoardIntent::AddBoardMember { board: board.name.clone(), name: person_or_project.clone() },
                    format!("Agregar a «{person_or_project}» al tablero «{}».", board.name),
                ),
                "remove_task_board_member" => (
                    TaskBoardIntent::RemoveBoardMember { board: board.name.clone(), name: person_or_project.clone() },
                    format!("Quitar a «{person_or_project}» del tablero «{}»: deja de estar asignada en sus tareas.", board.name),
                ),
                "add_task_board_project" => (
                    TaskBoardIntent::AddBoardProject { board: board.name.clone(), name: person_or_project.clone(), color: text(arguments, "color") },
                    format!("Agregar el proyecto «{person_or_project}» al tablero «{}».", board.name),
                ),
                _ => (
                    TaskBoardIntent::RemoveBoardProject { board: board.name.clone(), name: person_or_project.clone() },
                    format!("Eliminar el proyecto «{person_or_project}» del tablero «{}»: sus tareas quedan sin proyecto.", board.name),
                ),
            };
            one(intent, summary)
        }
        "update_task_board_calendar" => {
            let board = board(snapshot, &required(arguments, "boardId")?)?;
            let (plan, changes) = calendar_from(&board_plan(snapshot, &board.board_id), arguments)?;
            if changes.is_empty() {
                return Ok(none(format!("El calendario del tablero «{}» ya es ese.", board.name)));
            }
            one(
                TaskBoardIntent::UpdateBoard {
                    previous_name: board.name.clone(),
                    name: board.name.clone(),
                    color: board.color.clone(),
                    activity_hours_per_day: plan.hours_per_day(),
                    contexto: board.context.clone().unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string()),
                    plan: Some(plan),
                },
                format!("Cambiar el calendario del tablero «{}»: {}.", board.name, changes.join(", ")),
            )
        }
        _ => return Err(invalid("La herramienta no corresponde a una acción del tablero.")),
    })
}

fn open(ticket: &TaskTicketDto) -> bool {
    !matches!(ticket.summary.state, TaskState::Completed | TaskState::Cancelled)
}

/// `get_task_board_settings`: calendar, people, projects and columns of a
/// board, with the dates of `today`.
pub fn board_settings_for_agent(
    snapshot: &TaskManagerLibrarySnapshotDto,
    board_reference: &str,
    owner_name: Option<&str>,
    today: jiff::civil::Date,
) -> Result<Value, BackendError> {
    let board = board(snapshot, board_reference)?;
    let plan = board_plan(snapshot, &board.board_id);
    let tickets = snapshot
        .tickets
        .iter()
        .filter(|ticket| ticket.summary.board_id == board.board_id && open(ticket))
        .collect::<Vec<_>>();
    let sprint = sprint_at(&plan, today);
    let next = next_sprint(&plan, today);
    let division = division_with_offset(&plan, today, 0);
    let next_division = division_with_offset(&plan, today, 1);
    let mut groups = snapshot.groups.iter().filter(|group| group.board_id == board.board_id).collect::<Vec<_>>();
    groups.sort_by_key(|group| group.order);
    Ok(json!({
        "boardId": board.board_id,
        "name": board.name,
        "context": board.context.clone().unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string()),
        "calendar": {
            "workday": format!("{}–{}", clock(plan.day_start_minutes), clock(plan.day_end_minutes)),
            "hoursPerDay": plan.hours_per_day(),
            "workDays": (0..7).filter(|index| plan.work_days[*index]).map(weekday_long).collect::<Vec<_>>(),
            "sprintWeeks": plan.sprint_weeks,
            "sprintStartDay": weekday_long(plan.sprint_start_weekday as usize),
            "currentSprint": format!("{} · {}", sprint_label(&sprint), date_range(sprint.start, sprint.end)),
            "nextSprint": format!("{} · {}", sprint_label(&next), date_range(next.start, next.end)),
            "divisionsPerYear": plan.divisions_per_year,
            "divisionPrefix": plan.division_prefix,
            "yearStartMonth": month_long(plan.year_start_month as i8),
            "currentDivision": format!("{} · {}", division_title(&plan, &division), date_range(division.start, division.end)),
            "nextDivision": format!("{} · {}", division_title(&plan, &next_division), date_range(next_division.start, next_division.end)),
        },
        "people": board_members(snapshot, &board.board_id, owner_name).iter().map(|member| json!({
            "name": member.name,
            "owner": member.is_owner,
            "openTasks": tickets.iter().filter(|ticket| ticket.assignees.iter().any(|name| fold(name) == fold(&member.name))).count(),
        })).collect::<Vec<_>>(),
        "projects": board_projects(snapshot, &board.board_id).iter().map(|project| json!({
            "name": project.name,
            "color": project.color,
            "openTasks": tickets.iter().filter(|ticket| ticket.project.as_deref().is_some_and(|name| fold(name) == fold(&project.name))).count(),
        })).collect::<Vec<_>>(),
        "columns": groups.iter().map(|group| json!({
            "groupId": group.group_id,
            "name": group.name,
            "kind": group.column_kind(),
            "kindLabel": group.column_kind().label(&plan.division_prefix),
            "openTasks": tickets.iter().filter(|ticket| ticket.summary.parent_ticket_id.is_none() && ticket.summary.group_id.as_deref() == Some(group.group_id.as_str())).count(),
        })).collect::<Vec<_>>(),
    }))
}

/// `get_task_board_plan`: what Management shows, in words: the range, the
/// KPIs, the critical path and each planned task with its dates.
pub fn board_plan_for_agent(view: &ManagementViewDto, snapshot: &TaskManagerLibrarySnapshotDto) -> Value {
    let ticket_id = |path: &str| {
        snapshot
            .tickets
            .iter()
            .find(|ticket| ticket.summary.logical_path == path)
            .map(|ticket| ticket.summary.ticket_id.clone())
            .unwrap_or_default()
    };
    if view.empty {
        return json!({ "empty": true, "message": view.empty_label });
    }
    json!({
        "range": format!("{} · {}", view.range.title, view.range.subtitle),
        "division": view.divisions.title,
        "kpis": view.kpis.iter().map(|kpi| json!({ "label": kpi.label, "value": kpi.value, "detail": kpi.sub })).collect::<Vec<_>>(),
        "criticalPath": view.critical_path,
        "hoursPerDay": view.hours_per_day,
        "tasks": view.table.rows.iter().map(|row| json!({
            "letter": row.letter,
            "ticketId": ticket_id(&row.task_path),
            "title": row.title,
            "column": row.group,
            "people": row.people.iter().map(|person| person.name.clone()).collect::<Vec<_>>(),
            "remaining": row.remaining,
            "unestimated": row.unestimated_note,
            "dependsOn": row.predecessors,
            "start": row.start_label,
            "waitsFor": row.wait_label,
            "end": row.end_label,
            "lateStart": row.late_start_label,
            "slack": row.slack_label,
            "critical": row.critical,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_manager_tools::{TaskGroupDto, TaskManagerConfigDto, TaskPriority, TaskTicketSummaryDto};

    fn ticket(id: &str, title: &str, group: &str) -> TaskTicketDto {
        TaskTicketDto {
            summary: TaskTicketSummaryDto {
                library_id: "lib".into(),
                ticket_id: id.into(),
                board_id: "work".into(),
                group_id: Some(group.into()),
                title: title.into(),
                state: TaskState::Pending,
                priority: TaskPriority::Medium,
                parent_ticket_id: None,
                detail_preview: String::new(),
                revision: 1,
                logical_path: format!("task-manager/tasks/work/{id}.md"),
            },
            content: String::new(),
            tags: vec![],
            dependencies: vec![],
            checklist: vec![],
            start_date: String::new(),
            end_date: String::new(),
            dynamic_end_date: true,
            dedicated_hours: 0.0,
            estimated_hours: 4.0,
            deviation_hours: 0.0,
            order: 10.0,
            context: None,
            related_documents: vec![],
            related_tasks: vec![],
            project: None,
            assignees: vec!["Doris".into()],
            started_at_unix_ms: None,
            closed_at_unix_ms: None,
            block_note: None,
        }
    }

    fn snapshot() -> TaskManagerLibrarySnapshotDto {
        let group = |id: &str, name: &str, order: u32| TaskGroupDto {
            library_id: "lib".into(),
            group_id: id.into(),
            board_id: "work".into(),
            name: name.into(),
            color: "#4FD1C5".into(),
            revision: 1,
            order,
            kind: None,
        };
        let mut child = ticket("a1", "Primer paso", "sprint");
        child.summary.parent_ticket_id = Some("a".into());
        TaskManagerLibrarySnapshotDto {
            library_id: "lib".into(),
            users: vec![],
            boards: vec![TaskBoardDto {
                library_id: "lib".into(),
                board_id: "work".into(),
                name: "work".into(),
                color: "#6C8EFF".into(),
                context: Some("#Laboral".into()),
                revision: 1,
            }],
            groups: vec![group("sprint", "Sprint actual", 0), group("blocked", "Bloqueado", 1)],
            tickets: vec![ticket("a", "Informe", "sprint"), ticket("b", "Revisión", "sprint"), child],
            comments: vec![],
            generation: 1,
            config: TaskManagerConfigDto::default(),
        }
    }

    fn plan(name: &str, arguments: Value) -> Result<BoardToolPlan, BackendError> {
        board_tool_plan(name, &arguments, &snapshot(), Some("Gabriel"))
    }

    #[test]
    fn people_are_assigned_only_from_the_board_and_in_three_modes() {
        let error = plan("set_task_people", json!({"ticketId": "a", "people": ["Nadie"]})).unwrap_err();
        assert!(error.message.contains("add_task_board_member"), "{}", error.message);
        let added = plan("set_task_people", json!({"ticketId": "a", "people": ["gabriel"], "mode": "add"})).unwrap();
        assert_eq!(
            added.intents,
            vec![TaskBoardIntent::SetTaskPeople {
                task_path: "task-manager/tasks/work/a.md".into(),
                people: vec!["Doris".into(), "gabriel".into()],
            }]
        );
        assert_eq!(added.summary, "Asignar «Informe» a «Doris» y «gabriel».");
        let removed = plan("set_task_people", json!({"ticketId": "a", "people": ["DORIS"], "mode": "remove"})).unwrap();
        assert_eq!(removed.summary, "Quitar a todas las personas de «Informe».");
    }

    #[test]
    fn the_board_tools_name_tickets_by_their_title_and_explain_the_rules() {
        assert_eq!(
            plan("set_task_time", json!({"ticketId": "a", "estimatedHours": 6.5, "dedicatedHours": 2})).unwrap().summary,
            "Cambiar el tiempo de «Informe»: estimado 6,5 h, dedicado 2 h."
        );
        assert_eq!(
            plan("move_task_group", json!({"ticketId": "a", "groupId": "blocked"})).unwrap().summary,
            "Mover «Informe» a la columna «Bloqueado» (queda bloqueada); sus subtareas van con ella."
        );
        assert_eq!(
            plan("set_task_project", json!({"ticketId": "a", "project": "Remesas"})).unwrap().summary,
            "Poner «Informe» en el proyecto «Remesas» (se crea en el tablero)."
        );
        assert_eq!(
            plan("set_task_dependencies", json!({"ticketId": "b", "dependsOnTicketIds": ["a"]})).unwrap().summary,
            "Hacer que «Revisión» empiece después de «Informe»."
        );
        assert!(plan("set_task_time", json!({"ticketId": "a"})).is_err());
        assert!(plan("start_task_timer", json!({"ticketId": "zzz"})).is_err());
        assert!(plan("toggle_task_subtask", json!({"ticketId": "a", "done": true})).is_err());
        let toggle = plan("toggle_task_subtask", json!({"ticketId": "a1", "done": true})).unwrap();
        assert_eq!(toggle.summary, "Marcar la subtarea «Primer paso» como hecha.");
        let copy = plan("duplicate_task", json!({"ticketId": "a", "title": "Informe Q1"})).unwrap();
        assert_eq!(copy.rename_copy_to.as_deref(), Some("Informe Q1"));
    }

    #[test]
    fn the_calendar_takes_only_the_fields_sent() {
        let calendar = plan(
            "update_task_board_calendar",
            json!({"boardId": "work", "workdayEnd": "17:00", "workDays": ["lunes", "Mar", "miércoles"], "sprintStartDay": "miercoles", "yearStartMonth": "julio"}),
        )
        .unwrap();
        let TaskBoardIntent::UpdateBoard { plan: Some(saved), name, contexto, .. } = &calendar.intents[0] else {
            panic!("update-board");
        };
        assert_eq!((name.as_str(), contexto.as_str()), ("work", "#Laboral"));
        assert_eq!((saved.day_start_minutes, saved.day_end_minutes), (540, 1020));
        assert_eq!(saved.work_days, [true, true, true, false, false, false, false]);
        assert_eq!((saved.sprint_start_weekday, saved.sprint_weeks, saved.year_start_month), (2, 2, 7));
        assert_eq!(
            calendar.summary,
            "Cambiar el calendario del tablero «work»: jornada 09:00–17:00, días lunes, martes, miércoles, sprints desde el miércoles, año desde julio."
        );
        assert!(plan("update_task_board_calendar", json!({"boardId": "work", "workdayStart": "09:10"})).is_err());
        assert!(plan("update_task_board_calendar", json!({"boardId": "work", "sprintStartDay": "sábado"})).is_err());
        assert!(plan("update_task_board_calendar", json!({"boardId": "work"})).unwrap().intents.is_empty());
    }

    #[test]
    fn the_settings_read_names_the_calendar_people_projects_and_columns() {
        let settings = board_settings_for_agent(&snapshot(), "work", Some("Gabriel"), jiff::civil::date(2026, 10, 19)).unwrap();
        assert_eq!(settings["calendar"]["workday"], "09:00–18:00");
        assert_eq!(settings["calendar"]["currentSprint"], "Sprint 21 · 12 oct – 25 oct");
        assert_eq!(settings["calendar"]["nextDivision"], "Q1 2027 · 1 ene – 31 mar");
        assert_eq!(settings["people"][0]["name"], "Gabriel");
        assert_eq!(settings["people"][1]["openTasks"], 3);
        assert_eq!(settings["columns"][1]["kind"], "blocked");
        assert_eq!(settings["columns"][0]["openTasks"], 2);
    }
}
