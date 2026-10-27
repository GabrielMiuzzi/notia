//! What the «Tareas IA» panel shows: the list of tasks and the detail of
//! one, with every text and time already written (es-AR).

use jiff::tz::TimeZone;
use serde::Serialize;

use super::workflow::workflow_mermaid;
use super::{AiTask, AiTaskApproval, AiTaskOrigin, AiTaskStatus, ApprovalKind, RETENTION_MS};
use crate::ai_actions::labels::moment_label;
use crate::ai_actions::schedule::local_date;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskCard {
    pub id: String,
    pub title: String,
    pub status: AiTaskStatus,
    pub status_label: String,
    /// «Paso 2 de 5 · Ejecutor», «Esperando tu confirmación»…
    pub phase_label: String,
    pub done_steps: usize,
    pub total_steps: usize,
    pub origin: AiTaskOrigin,
    pub origin_label: String,
    pub approve_all: bool,
    pub needs_you: bool,
    pub created_label: String,
    pub updated_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskStepView {
    pub id: String,
    pub number: usize,
    /// «Plan inicial», «Corrección 1»…
    pub round_label: String,
    pub title: String,
    pub detail: String,
    pub status: super::StepStatus,
    pub status_label: String,
    pub report: Option<String>,
    pub time_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskReviewView {
    pub number: usize,
    pub approved: bool,
    pub verdict_label: String,
    pub feedback: String,
    pub time_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskApprovalView {
    pub id: String,
    pub kind: ApprovalKind,
    /// «El Ejecutor necesita tu confirmación (paso 3)».
    pub heading: String,
    pub title: String,
    pub detail: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskDetail {
    #[serde(flatten)]
    pub card: AiTaskCard,
    pub goal: String,
    pub steps: Vec<AiTaskStepView>,
    pub reviews: Vec<AiTaskReviewView>,
    pub pending: Option<AiTaskApprovalView>,
    pub result: Option<String>,
    pub error: Option<String>,
    /// The workflow as a Mermaid flowchart.
    pub workflow: String,
    pub can_cancel: bool,
    pub can_resume: bool,
    /// «Se borra el sáb 1 nov · 21:40».
    pub expires_label: String,
}

fn when(zone: &TimeZone, ms: i64, now_ms: i64) -> String {
    moment_label(zone, ms, local_date(zone, now_ms))
}

fn phase_label(task: &AiTask) -> String {
    let (done, total) = task.progress();
    match task.status {
        AiTaskStatus::Planning => "Armando el plan".to_string(),
        AiTaskStatus::Running => match task.next_work() {
            super::NextWork::Execute(index) => format!("Paso {} de {total}", index + 1),
            _ => format!("{done} de {total} pasos"),
        },
        AiTaskStatus::Reviewing => format!("Revisión {}", task.reviews.len() + 1),
        AiTaskStatus::AwaitingApproval => match task.pending.as_ref().map(|pending| pending.kind) {
            Some(ApprovalKind::Clarification) => "Tiene una pregunta para vos".to_string(),
            Some(ApprovalKind::Plan) => "Espera que apruebes un plan".to_string(),
            _ => "Espera tu confirmación".to_string(),
        },
        AiTaskStatus::Completed => format!("{total} pasos · {} revisiones", task.reviews.len()),
        AiTaskStatus::Failed | AiTaskStatus::Cancelled | AiTaskStatus::Interrupted => format!("{done} de {total} pasos hechos"),
    }
}

pub fn card(task: &AiTask, zone: &TimeZone, now_ms: i64) -> AiTaskCard {
    let (done_steps, total_steps) = task.progress();
    AiTaskCard {
        id: task.id.clone(),
        title: task.title.clone(),
        status: task.status,
        status_label: task.status.label().to_string(),
        phase_label: phase_label(task),
        done_steps,
        total_steps,
        origin: task.origin,
        origin_label: task.origin.label().to_string(),
        approve_all: task.approve_all,
        needs_you: task.status == AiTaskStatus::AwaitingApproval,
        created_label: when(zone, task.created_at_ms, now_ms),
        updated_label: when(zone, task.updated_at_ms, now_ms),
    }
}

/// The newest first; the ones waiting for the person on top.
pub fn cards(tasks: &[AiTask], zone: &TimeZone, now_ms: i64) -> Vec<AiTaskCard> {
    let mut sorted = tasks.iter().collect::<Vec<_>>();
    sorted.sort_by_key(|task| (task.status != AiTaskStatus::AwaitingApproval, !task.status.is_active(), std::cmp::Reverse(task.created_at_ms)));
    sorted.into_iter().map(|task| card(task, zone, now_ms)).collect()
}

fn approval_view(task: &AiTask, approval: &AiTaskApproval) -> AiTaskApprovalView {
    let what = match approval.kind {
        ApprovalKind::Confirmation => "necesita tu confirmación",
        ApprovalKind::Plan => "necesita que apruebes un plan",
        ApprovalKind::Clarification => "tiene una pregunta",
    };
    let step = approval
        .step_id
        .as_deref()
        .and_then(|id| task.steps.iter().position(|step| step.id == id))
        .map(|index| format!(" (paso {})", index + 1))
        .unwrap_or_default();
    AiTaskApprovalView {
        id: approval.id.clone(),
        kind: approval.kind,
        heading: format!("El {} {what}{step}", approval.phase.label()),
        title: approval.title.clone(),
        detail: approval.detail.clone(),
        options: approval.options.clone(),
    }
}

pub fn detail(task: &AiTask, zone: &TimeZone, now_ms: i64) -> AiTaskDetail {
    let steps = task
        .steps
        .iter()
        .enumerate()
        .map(|(index, step)| AiTaskStepView {
            id: step.id.clone(),
            number: index + 1,
            round_label: if step.round == 0 { "Plan inicial".to_string() } else { format!("Corrección {}", step.round) },
            title: step.title.clone(),
            detail: step.detail.clone(),
            status: step.status,
            status_label: step.status.label().to_string(),
            report: step.report.clone(),
            time_label: step.finished_at_ms.or(step.started_at_ms).map(|ms| when(zone, ms, now_ms)),
        })
        .collect();
    let reviews = task
        .reviews
        .iter()
        .enumerate()
        .map(|(index, review)| AiTaskReviewView {
            number: index + 1,
            approved: review.approved,
            verdict_label: if review.approved { "Aprobada".to_string() } else { "Pidió rehacer".to_string() },
            feedback: review.feedback.clone(),
            time_label: when(zone, review.at_ms, now_ms),
        })
        .collect();
    AiTaskDetail {
        card: card(task, zone, now_ms),
        goal: task.goal.clone(),
        steps,
        reviews,
        pending: task.pending.as_ref().filter(|_| task.status == AiTaskStatus::AwaitingApproval).map(|approval| approval_view(task, approval)),
        result: task.result.clone(),
        error: task.error.clone(),
        workflow: workflow_mermaid(task),
        can_cancel: task.status.is_active(),
        can_resume: task.status.is_resumable(),
        expires_label: format!("Se borra {}", when(zone, task.created_at_ms + RETENTION_MS, now_ms).to_lowercase()),
    }
}
