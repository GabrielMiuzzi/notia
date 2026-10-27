//! The agent's tools over its tasks: it creates them (only it does), lists
//! and reads them, cancels, resumes, reviews again and deletes them. This
//! module reads the arguments, finds the task a call names and writes the
//! views the model reads and the confirmation texts; the adapter stores and
//! runs the tasks.

use serde_json::{json, Value};

use super::{clipped, AiTask, AiTaskStatus, StepStatus, MAX_GOAL_CHARS, MAX_TITLE_CHARS};
use crate::ai_actions::fold;
use crate::error::{BackendError, BackendErrorCode};

pub const AI_TASK_READ_TOOLS: [&str; 2] = ["list_ai_tasks", "get_ai_task"];
pub const AI_TASK_WRITE_TOOLS: [&str; 5] = ["create_ai_task", "cancel_ai_task", "resume_ai_task", "review_ai_task", "delete_ai_task"];
/// Report characters per step `get_ai_task` shows.
const TOOL_REPORT_CHARS: usize = 3_000;

pub fn is_ai_task_tool(name: &str) -> bool {
    AI_TASK_READ_TOOLS.contains(&name) || is_ai_task_write_tool(name)
}

pub fn is_ai_task_write_tool(name: &str) -> bool {
    AI_TASK_WRITE_TOOLS.contains(&name)
}

fn text(arguments: &Value, name: &str) -> Option<String> {
    arguments.get(name).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

/// The tools of a phase's run: no task tool that creates or changes tasks
/// and none of the agent's own plan tools (the task has its plan); the
/// planner and the review only read.
pub fn phase_tools(tools: Vec<crate::ToolDefinition>, phase: super::AiTaskPhase, library_search: bool) -> Vec<crate::ToolDefinition> {
    let tools = if phase.writes() { tools } else { crate::catalog::restrict_tool_access(tools, crate::ToolAccess::ReadOnly, library_search) };
    tools
        .into_iter()
        .filter(|tool| {
            !is_ai_task_write_tool(&tool.name)
                && !matches!(tool.name.as_str(), "set_agent_execution_plan" | "set_task_execution_plan" | "create_agent_plan" | "update_agent_plan")
        })
        .collect()
}

/// What `create_ai_task` asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTask {
    pub title: String,
    pub goal: String,
}

pub fn new_task(arguments: &Value) -> Result<NewTask, BackendError> {
    let title = text(arguments, "title").ok_or_else(|| BackendError::invalid_input("Falta title: un título corto de la tarea."))?;
    let goal = text(arguments, "goal").ok_or_else(|| {
        BackendError::invalid_input("Falta goal: el objetivo completo, con todo el contexto de la conversación que la tarea necesita.")
    })?;
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(BackendError::invalid_input(format!("title tiene más de {MAX_TITLE_CHARS} caracteres.")));
    }
    if goal.chars().count() > MAX_GOAL_CHARS {
        return Err(BackendError::invalid_input(format!("goal tiene más de {MAX_GOAL_CHARS} caracteres.")));
    }
    Ok(NewTask { title, goal })
}

/// The extra instructions of `review_ai_task`.
pub fn review_instructions(arguments: &Value) -> Option<String> {
    text(arguments, "instructions")
}

/// The task a call names in `task`: by id, or by exact title without
/// caring about case or accents.
pub fn resolve_task<'a>(tasks: &'a [AiTask], arguments: &Value) -> Result<&'a AiTask, BackendError> {
    let reference = text(arguments, "task").ok_or_else(|| BackendError::invalid_input("Falta task: el id o el título de la tarea."))?;
    if let Some(task) = tasks.iter().find(|task| task.id == reference) {
        return Ok(task);
    }
    let wanted = fold(&reference);
    let matches = tasks.iter().filter(|task| fold(task.title.trim()) == wanted).collect::<Vec<_>>();
    match matches.as_slice() {
        [task] => Ok(task),
        [] => Err(BackendError::new(BackendErrorCode::NotFound, "No hay una tarea con ese id o título; consultalas con list_ai_tasks.", false)),
        several => Err(BackendError::invalid_input(format!(
            "Hay {} tareas con ese título; usá su id: {}.",
            several.len(),
            several.iter().map(|task| task.id.as_str()).collect::<Vec<_>>().join(", ")
        ))),
    }
}

/// What `list_ai_tasks` returns: every task kept (a week), newest first.
pub fn list_view(tasks: &[AiTask]) -> Value {
    let mut sorted = tasks.iter().collect::<Vec<_>>();
    sorted.sort_by_key(|task| std::cmp::Reverse(task.created_at_ms));
    json!({
        "tasks": sorted.iter().map(|task| {
            let (done, total) = task.progress();
            json!({
                "id": task.id,
                "title": task.title,
                "status": task.status.id(),
                "statusLabel": task.status.label(),
                "steps": format!("{done}/{total}"),
                "origin": task.origin.label(),
                "approveAll": task.approve_all,
                "waitingFor": task.pending.as_ref().filter(|_| task.status == AiTaskStatus::AwaitingApproval).map(|pending| pending.title.clone()),
            })
        }).collect::<Vec<_>>(),
        "note": "Las tareas se guardan una semana desde que se crean.",
    })
}

/// What `get_ai_task` returns: the goal, each step with its report, the
/// reviews and the result.
pub fn detail_view(task: &AiTask) -> Value {
    json!({
        "id": task.id,
        "title": task.title,
        "goal": task.goal,
        "status": task.status.id(),
        "statusLabel": task.status.label(),
        "phase": task.phase.map(|phase| phase.label()),
        "origin": task.origin.label(),
        "approveAll": task.approve_all,
        "steps": task.steps.iter().enumerate().map(|(index, step)| json!({
            "number": index + 1,
            "round": step.round,
            "title": step.title,
            "detail": step.detail,
            "status": step.status.label(),
            "report": step.report.as_deref().map(|report| clipped(report, TOOL_REPORT_CHARS)),
        })).collect::<Vec<_>>(),
        "reviews": task.reviews.iter().map(|review| json!({
            "round": review.round,
            "approved": review.approved,
            "feedback": review.feedback,
        })).collect::<Vec<_>>(),
        "waitingFor": task.pending.as_ref().map(|pending| json!({ "kind": pending.kind, "title": pending.title, "options": pending.options })),
        "result": task.result,
        "error": task.error,
    })
}

/// The confirmation of `create_ai_task`.
pub fn create_summary(task: &NewTask) -> String {
    format!(
        "Crear la Tarea IA «{}»: el Planificador arma el plan, el Ejecutor hace cada paso y el Review lo revisa; la seguís en Tareas IA. «Confirmar todos» aplica sus cambios sin volver a preguntarte.\n\nObjetivo:\n{}",
        task.title,
        clipped(&task.goal, 1_500)
    )
}

pub fn cancel_summary(task: &AiTask) -> String {
    format!("Cancelar la Tarea IA «{}» ({}).", task.title, task.status.label().to_lowercase())
}

pub fn resume_summary(task: &AiTask) -> String {
    let (done, total) = task.progress();
    format!("Reanudar la Tarea IA «{}» desde donde quedó ({done} de {total} pasos hechos).", task.title)
}

pub fn review_summary(task: &AiTask, instructions: Option<&str>) -> String {
    match instructions {
        Some(instructions) => format!("Volver a revisar la Tarea IA «{}»: {}", task.title, clipped(instructions, 500)),
        None => format!("Volver a revisar la Tarea IA «{}».", task.title),
    }
}

pub fn delete_summary(task: &AiTask) -> String {
    format!("Borrar la Tarea IA «{}» y su historial.", task.title)
}

/// Why a task cannot be resumed, reviewed or cancelled now.
pub fn check_resumable(task: &AiTask) -> Result<(), BackendError> {
    if task.status.is_resumable() {
        Ok(())
    } else {
        Err(BackendError::invalid_input(format!("La tarea está {}: solo se reanuda una tarea fallida, cancelada o interrumpida.", task.status.label().to_lowercase())))
    }
}

pub fn check_reviewable(task: &AiTask) -> Result<(), BackendError> {
    if task.status.is_active() {
        return Err(BackendError::invalid_input("La tarea todavía está trabajando: esperá a que termine o cancelala."));
    }
    if task.steps.iter().all(|step| step.status != StepStatus::Done) {
        return Err(BackendError::invalid_input("La tarea no tiene pasos hechos para revisar; reanudala."));
    }
    Ok(())
}

pub fn check_cancellable(task: &AiTask) -> Result<(), BackendError> {
    if task.status.is_active() {
        Ok(())
    } else {
        Err(BackendError::invalid_input(format!("La tarea ya está {}.", task.status.label().to_lowercase())))
    }
}
