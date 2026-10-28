//! The workflow of a task as a Mermaid flowchart: the request, the plan,
//! each step in order, each review (and the steps a rework added) and the
//! end. Every node carries the class of its state (`done`, `running`,
//! `waiting`, `pending`, `failed`, `rework`); the panel colors them with
//! the theme's tokens.

use super::{AiTask, AiTaskPhase, AiTaskStatus, StepStatus};

/// Characters of a node's label.
const LABEL_CHARS: usize = 48;

fn label(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let short = super::clipped(&flat, LABEL_CHARS);
    short.replace('"', "#quot;").replace('<', "#lt;").replace('>', "#gt;")
}

fn step_class(status: StepStatus) -> &'static str {
    match status {
        StepStatus::Done => "done",
        StepStatus::Running => "running",
        StepStatus::Waiting => "waiting",
        StepStatus::Pending => "pending",
        StepStatus::Failed => "failed",
    }
}

/// The Mermaid source of the task's workflow.
pub fn workflow_mermaid(task: &AiTask) -> String {
    let waiting = task.status == AiTaskStatus::AwaitingApproval;
    let active = |phase: AiTaskPhase| task.status.is_active() && task.phase == Some(phase);
    let mut lines = vec!["flowchart TD".to_string(), "  start([\"Pedido\"])".to_string()];
    let mut classes: Vec<(String, &str)> = vec![("start".into(), "done")];

    let plan_class = if !task.steps.is_empty() {
        "done"
    } else if active(AiTaskPhase::Planner) {
        if waiting { "waiting" } else { "running" }
    } else if task.status == AiTaskStatus::Failed || task.status == AiTaskStatus::Interrupted || task.status == AiTaskStatus::Cancelled {
        "failed"
    } else {
        "pending"
    };
    lines.push("  plan[\"Plan\"]".to_string());
    lines.push("  start --> plan".to_string());
    classes.push(("plan".into(), plan_class));

    let mut previous = "plan".to_string();
    let rounds = if task.steps.is_empty() { 0 } else { task.current_round() + 1 };
    for round in 0..rounds {
        for (index, step) in task.steps.iter().enumerate().filter(|(_, step)| step.round == round) {
            let node = step.id.clone();
            lines.push(format!("  {node}[\"{}. {}\"]", index + 1, label(&step.title)));
            let edge = if previous.starts_with('r') { format!("  {previous} -->|rehacer| {node}") } else { format!("  {previous} --> {node}") };
            lines.push(edge);
            let class = if step.status == StepStatus::Running && waiting { "waiting" } else { step_class(step.status) };
            classes.push((node.clone(), class));
            previous = node;
        }
        let review = task.reviews.iter().find(|review| review.round == round);
        let reviewing = review.is_none() && round + 1 == rounds && active(AiTaskPhase::Review);
        if review.is_none() && !reviewing {
            continue;
        }
        let node = format!("r{}", round + 1);
        lines.push(format!("  {node}{{\"Review {}\"}}", round + 1));
        lines.push(format!("  {previous} --> {node}"));
        let class = match review {
            Some(review) if review.approved => "done",
            Some(_) => "rework",
            None if waiting => "waiting",
            None => "running",
        };
        classes.push((node.clone(), class));
        previous = node;
    }

    let end = match task.status {
        AiTaskStatus::Completed => Some(("Resultado", "done", "aprobada")),
        AiTaskStatus::Failed => Some(("Falló", "failed", "")),
        AiTaskStatus::Cancelled => Some(("Cancelada", "failed", "")),
        AiTaskStatus::Interrupted => Some(("Interrumpida", "failed", "")),
        _ => None,
    };
    if let Some((text, class, edge)) = end {
        lines.push(format!("  fin([\"{text}\"])"));
        lines.push(if edge.is_empty() { format!("  {previous} --> fin") } else { format!("  {previous} -->|{edge}| fin") });
        classes.push(("fin".into(), class));
    }

    for class in ["done", "running", "waiting", "pending", "failed", "rework"] {
        lines.push(format!("  classDef {class} stroke-width:2px"));
        let nodes = classes.iter().filter(|(_, node_class)| *node_class == class).map(|(node, _)| node.as_str()).collect::<Vec<_>>();
        if !nodes.is_empty() {
            lines.push(format!("  class {} {class}", nodes.join(",")));
        }
    }
    lines.join("\n")
}
