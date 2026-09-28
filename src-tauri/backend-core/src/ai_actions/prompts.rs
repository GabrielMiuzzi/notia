//! What the agent reads when an action runs. The run is a turn of the
//! Owner's Telegram chat, so it has the Owner's rules, memory, thoughts and
//! tools; this section of the system prompt says why it started and how to
//! answer, and the request carries the action's prompt as written.

use serde::{Deserialize, Serialize};

use crate::agent_autonomy::SILENCE_MARKER;

use super::AiActionKind;

/// Prefix of the message of a test run («Probar ahora»).
pub const TEST_PREFIX: &str = "[Prueba]";
/// The thought of a sent message stays within `MAX_THOUGHT_CHARS` with the
/// action's name.
const MAX_SENT_CHARS: usize = 800;
const MAX_SUMMARY_CHARS: usize = 300;

/// The prompt of the hourly review Notia sets up in every library.
pub const HOURLY_REVIEW_PROMPT: &str = "Revisá mi agenda, mis tareas, mi rutina, mi correo y mis finanzas, y comparalo con tus pensamientos. Decidí si hay algo para recordarme, preguntarme o proponerme ahora: un recordatorio, una pregunta o una propuesta concreta para organizar mi rutina, agenda, tareas o correo. No cambies nada por tu cuenta: si algo conviene cambiarlo, proponelo y lo hacemos si te digo que sí. No repitas avisos, preguntas ni propuestas que tus pensamientos dicen que ya me hiciste, salvo que haya novedades o se acerque el momento, y respetá mis reglas de horarios. Si nada vale un mensaje, respondé exactamente [SIN_MENSAJE].";

/// What the system prompt needs to know about the action that runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledActionPrompt {
    pub name: String,
    pub kind: AiActionKind,
    /// When it runs, as its card says it («Cada 3 h · 09 a 21 h»).
    pub when: String,
    pub test: bool,
}

/// System prompt section of a run.
pub fn action_guidance(action: &ScheduledActionPrompt) -> String {
    let kind = match action.kind {
        AiActionKind::Reminder => "recordatorio",
        AiActionKind::OneShot => "acción de una vez",
        AiActionKind::Recurring => "acción recurrente",
    };
    let mut lines = vec![
        format!(
            "Ejecución programada de Notia: te despertó la acción «{}» ({kind}, {}), no un mensaje recién escrito. El pedido es el prompt que el Owner dejó configurado.",
            action.name, action.when
        ),
        "Usá tus reglas, tu memoria, tus pensamientos y tus herramientas como en cualquier pedido del Owner.".to_string(),
        "Tu respuesta final es el mensaje que le llega por Telegram: breve, directo y en Markdown simple (**negrita**, listas con guiones), nunca en HTML.".to_string(),
    ];
    match action.kind {
        AiActionKind::Reminder => lines.push(
            "Es un recordatorio: redactá un aviso breve y accionable a partir del prompt (qué tiene que hacer y, si ayuda, el dato que necesita). No hagas tareas largas ni cambies datos.".to_string(),
        ),
        AiActionKind::OneShot | AiActionKind::Recurring => {
            lines.push("Ejecutá el prompt como una tarea y respondé con el resultado. Si un cambio necesita confirmación, pedila como siempre: el Owner la ve en Telegram.".to_string());
            lines.push(format!(
                "Si el prompt pide avisar solo cuando haya algo y no hay nada que valga un mensaje, respondé exactamente {SILENCE_MARKER} y nada más."
            ));
        }
    }
    lines.push("Antes de terminar, guardá con add_agent_thought lo que hiciste o decidiste, así la próxima ejecución no repite lo mismo.".to_string());
    if action.test {
        lines.push("Es una prueba pedida desde el panel de Acciones IA: hacé lo mismo que en una ejecución real.".to_string());
    }
    lines.join("\n")
}

/// The request of a run: the action's prompt with when and why it runs.
pub fn action_request(name: &str, prompt: &str, now_label: &str, test: bool) -> String {
    let origin = if test { "Prueba de acción de Notia" } else { "Acción programada de Notia" };
    format!("[{origin} · {now_label} · «{name}»]\n{}", prompt.trim())
}

/// Whether the answer of a run is silence: nothing is sent. A reminder
/// always writes.
pub fn is_silent(kind: AiActionKind, answer: &str) -> bool {
    kind != AiActionKind::Reminder && crate::agent_autonomy::is_silent(answer)
}

/// The message that reaches Telegram.
pub fn outgoing_message(answer: &str, test: bool) -> String {
    if test {
        format!("{TEST_PREFIX} {}", answer.trim())
    } else {
        answer.trim().to_string()
    }
}

fn bounded(value: &str, max: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max {
        return collapsed;
    }
    format!("{}…", collapsed.chars().take(max).collect::<String>().trim_end())
}

/// What the run keeps of its answer, for its history.
pub fn output_summary(answer: &str) -> String {
    bounded(answer, MAX_SUMMARY_CHARS)
}

/// Summary of a run that sent nothing.
pub const SILENT_SUMMARY: &str = "Sin mensaje: no había nada para avisar.";

/// The thought Notia keeps for each message an action sent, so the next
/// runs know what was already said.
pub fn sent_thought(name: &str, message: &str) -> String {
    format!("Por la acción «{}» le escribí por Telegram: {}", bounded(name, 80), bounded(message, MAX_SENT_CHARS))
}
