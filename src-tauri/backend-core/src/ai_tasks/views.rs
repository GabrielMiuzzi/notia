//! What the «Tareas IA» panel shows: the list of tasks and the detail of
//! one, with every text and time already written (es-AR).

use jiff::tz::TimeZone;
use serde::Serialize;

use super::waits;
use super::workflow::workflow_mermaid;
use super::{AiTask, AiTaskApproval, AiTaskOrigin, AiTaskPhase, AiTaskStatus, ApprovalKind, RETENTION_MS};
use crate::events::BackendEvent;
use crate::protocol::BackendEventEnvelope;
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
    /// What it did before each wait and how each wait ended.
    pub notes: Vec<String>,
    pub time_label: Option<String>,
}

/// What a waiting task waits for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskWaitView {
    pub reason: String,
    /// «Respuesta por correo en el hilo (ana@x.com)», «Controla cada hora»…
    pub kind_label: String,
    pub since_label: String,
    pub next_label: Option<String>,
    pub deadline_label: String,
    /// Why the last look at the mail failed.
    pub error: Option<String>,
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
    pub wait: Option<AiTaskWaitView>,
    pub result: Option<String>,
    pub error: Option<String>,
    /// The workflow as a Mermaid flowchart.
    pub workflow: String,
    pub can_cancel: bool,
    pub can_resume: bool,
    /// «Reanudar», or «Seguir sin esperar» for a waiting task.
    pub resume_label: String,
    /// «Se borra el sáb 1 nov · 21:40».
    pub expires_label: String,
}

/// A task is deleted a week after its last change; one that waits is kept.
fn expires_label(task: &AiTask, zone: &TimeZone, now_ms: i64) -> String {
    if task.status == AiTaskStatus::Waiting {
        return "No se borra mientras espera".to_string();
    }
    format!("Se borra {}", when(zone, task.updated_at_ms + RETENTION_MS, now_ms).to_lowercase())
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
        AiTaskStatus::Waiting => match task.wait.as_ref() {
            Some(wait) => format!("Paso {} de {total} · {}", task.steps.iter().position(|step| step.id == wait.step_id).map_or(done + 1, |index| index + 1), wait.reason),
            None => format!("{done} de {total} pasos"),
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
            notes: step.notes.clone(),
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
        wait: task.wait.as_ref().filter(|_| task.status == AiTaskStatus::Waiting).map(|wait| AiTaskWaitView {
            reason: wait.reason.clone(),
            kind_label: waits::kind_label(wait, zone, now_ms),
            since_label: format!("Desde {}", when(zone, wait.started_at_ms, now_ms).to_lowercase()),
            next_label: waits::next_label(wait, zone, now_ms),
            deadline_label: waits::deadline_label(wait, zone, now_ms),
            error: wait.last_error.clone(),
        }),
        result: task.result.clone(),
        error: task.error.clone(),
        workflow: workflow_mermaid(task),
        can_cancel: task.status.is_active(),
        can_resume: task.status.is_resumable(),
        resume_label: if task.status == AiTaskStatus::Waiting { "Seguir sin esperar".to_string() } else { "Reanudar".to_string() },
        expires_label: expires_label(task, zone, now_ms),
    }
}

/// What the panel keeps of a phase's thinking: the tail, so a long run
/// does not grow the page without end.
pub const MAX_THINKING_CHARS: usize = 20_000;

/// The thinking of the phase that runs now, as it streamed so far. The
/// panel shows it and adds the `thinking-summary` events of `request_id`
/// that come after `sequence`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskThinking {
    pub request_id: String,
    pub phase: AiTaskPhase,
    /// The step the executor works, to show the thinking inside it.
    pub step_id: Option<String>,
    /// «Ejecutor · paso 2 · pensando».
    pub label: String,
    pub text: String,
    pub sequence: u64,
    pub max_chars: usize,
}

/// The thinking of a run from its events: the fragments joined, each round
/// apart, within `MAX_THINKING_CHARS`.
pub fn thinking(task: &AiTask, request_id: &str, phase: AiTaskPhase, step_id: Option<String>, events: &[BackendEventEnvelope]) -> AiTaskThinking {
    let mut text = String::new();
    let mut sequence = 0;
    for envelope in events {
        sequence = sequence.max(envelope.sequence);
        match &envelope.event {
            BackendEvent::ThinkingSummary { summary, .. } => text.push_str(summary),
            BackendEvent::RoundStarted { .. } if !text.trim().is_empty() && !text.ends_with("

") => text.push_str("

"),
            _ => {}
        }
    }
    let step = step_id.as_deref().and_then(|id| task.steps.iter().position(|step| step.id == id));
    let label = match step {
        Some(index) => format!("{} · paso {} · pensando", phase.label(), index + 1),
        None => format!("{} · pensando", phase.label()),
    };
    AiTaskThinking { request_id: request_id.to_string(), phase, step_id, label, text: thinking_tail(&text), sequence, max_chars: MAX_THINKING_CHARS }
}

fn thinking_tail(text: &str) -> String {
    let count = text.chars().count();
    if count <= MAX_THINKING_CHARS {
        return text.to_string();
    }
    format!("…{}", text.chars().skip(count - MAX_THINKING_CHARS + 1).collect::<String>())
}
