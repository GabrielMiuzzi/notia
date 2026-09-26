//! Conversation rules of the Telegram bot that are independent of the
//! transport: replies to confirmations and choices, the texts the bot sends
//! (confirmation, plan, progress, queue) and which requests are financial.
//! The worker in the Tauri adapter polls Telegram and runs the agent.

use std::sync::OnceLock;

use regex::Regex;

use crate::events::BackendEvent;
use crate::formatting::escape_telegram_html;
use crate::interaction::ExecutionPlan;
use crate::protocol::MutationPreview;

pub const MAX_PENDING_REQUESTS: usize = 10;
pub const RECOVERY_COMMAND: &str = "/reanudar";
pub const MAX_HISTORY_MESSAGES: usize = 20;
const MAX_DETAIL_CHARS: usize = 3_000;

fn fold(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' => 'a',
            'é' => 'e',
            'í' => 'i',
            'ó' => 'o',
            'ú' | 'ü' => 'u',
            other => other,
        })
        .collect()
}

/// `true`/`false` for a typed yes/no answer to a pending confirmation.
pub fn parse_confirmation_decision(value: &str) -> Option<bool> {
    let normalized = fold(value)
        .chars()
        .map(|character| if ",.!?¿¡".contains(character) { ' ' } else { character })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    match normalized.as_str() {
        "si" | "confirmo" | "si confirmo" | "confirmar" | "acepto" => Some(true),
        "no" | "cancelo" | "no confirmo" | "cancelar" | "rechazo" => Some(false),
        _ => None,
    }
}

/// A typed 1-based number selects the same option shown as a button.
pub fn resolve_choice_reply(value: &str, choices: &[String]) -> (String, Option<usize>) {
    let trimmed = value.trim();
    let number = trimmed.trim_end_matches(['.', ')']).trim();
    match number.parse::<usize>().ok().and_then(|index| index.checked_sub(1)) {
        Some(index) if index < choices.len() => (choices[index].clone(), Some(index)),
        _ => (trimmed.to_string(), None),
    }
}

/// Removes operation ids, secrets and private paths from text shown in a chat.
pub fn redact_detail(value: &str) -> String {
    static RULES: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let rules = RULES.get_or_init(|| {
        [
            (r"(?i)\boperationId\s*[:=]\s*[^\s,;]+", "operationId=[oculto]"),
            (r"(?i)((?:api[_ -]?key|access[_ -]?token|password|passwd|secret|cookie))\s*[:=]\s*[^\s,;}]+", "$1=[oculto]"),
            (r#"(?i)(?:[A-Za-z]:[\\/]|/(?:Users|home|private|appdata|documents)[\\/])[^\s"']+"#, "[ruta privada]"),
        ]
        .into_iter()
        .map(|(pattern, replacement)| (Regex::new(pattern).expect("static redaction pattern"), replacement))
        .collect()
    });
    let mut text = value.to_string();
    for (pattern, replacement) in rules {
        text = pattern.replace_all(&text, *replacement).into_owned();
    }
    text.trim().to_string()
}

/// Longest agent note the progress message shows.
const MAX_NOTE_CHARS: usize = 300;

fn bounded(value: &str) -> String {
    if value.chars().count() > MAX_DETAIL_CHARS {
        format!("{}\n…", value.chars().take(MAX_DETAIL_CHARS).collect::<String>())
    } else {
        value.to_string()
    }
}

/// Confirmation text for a prepared mutation (HTML).
pub fn confirmation_message(preview: &MutationPreview) -> String {
    let detail = [
        redact_detail(&preview.summary),
        format!(
            "Documentos afectados: {}. Cambios preparados: {}.",
            preview.documents.len(),
            preview.hunks.len()
        ),
    ]
    .into_iter()
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    format!(
        "Confirmación requerida:\n\n{}\n\nRespondé Confirmar para ejecutar o Cancelar para detenerla.",
        escape_telegram_html(&bounded(&detail))
    )
}

/// Approval text for an execution plan (HTML).
pub fn plan_message(plan: &ExecutionPlan) -> String {
    let steps = plan
        .steps
        .iter()
        .enumerate()
        .map(|(index, step)| format!("{}. {}", index + 1, redact_detail(&step.label)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Aprobar este plan de ejecución:\n{}\n\nRespondé Confirmar para ejecutarlo o Cancelar para detenerlo.",
        escape_telegram_html(&bounded(&steps))
    )
}

/// Whether a message is about mail or the calendar. Those requests stay in
/// the library, where the Gmail and Calendar tools are, even when they say
/// «cuenta» («de mi cuenta de gmail»).
pub fn is_mail_request(value: &str) -> bool {
    static TERMS: OnceLock<Regex> = OnceLock::new();
    TERMS
        .get_or_init(|| {
            Regex::new(r"\b(gmail|correos?|e-?mails?|mails?|bandeja de entrada|casilla de correo|calendario|google calendar)\b").expect("mail terms")
        })
        .is_match(&fold(value))
}

/// Whether a message is about personal finances; documents always are.
/// Mail and calendar requests are not, even when they name an account.
pub fn is_finance_request(value: &str) -> bool {
    if is_mail_request(value) {
        return false;
    }
    static TERMS: OnceLock<(Regex, Regex, Regex)> = OnceLock::new();
    let (terms, amount, verb) = TERMS.get_or_init(|| {
        (
            Regex::new(r"\b(finanzas?|financier[oa]s?|gast(?:o|os|e|aste|amos|ar)|pague|pagaste|pago|cobre|cobraste|cobro|ingreso|ingresos|saldo|saldos|cuenta|cuentas|categoria|categorias|ahorro|ahorros|retiro|aporte|transferencia|movimiento|movimientos|sueldo|ticket|factura|boleta|servicio|luz|gas|internet|precio|nafta|combustible|cotizacion(?:es)?|dolar(?:es)?|inflacion|ipc|oficial|blue)\b").expect("finance terms"),
            Regex::new(r"(?:\$\s*\d|\b\d+(?:[.,]\d{1,2})?\s*(?:ars|usd|pesos?)\b)").expect("money amount"),
            Regex::new(r"\b(carg(?:a|ue|aste|amos|ar|ado)|anot(?:a|alo|arla|ar|e|aste|amos|ado)|registr(?:a|alo|arla|ar|e|aste|amos|ado))\b").expect("finance verb"),
        )
    });
    let normalized = fold(value);
    terms.is_match(&normalized) || (amount.is_match(&normalized) && verb.is_match(&normalized))
}

/// What the agent is doing, in words for the user.
pub fn tool_label(tool: &str) -> &'static str {
    match tool {
        "search_library_documents" | "search_library_files" => "buscando en la biblioteca",
        "search_library_context" => "consultando el contexto de la biblioteca",
        "read_library_document" | "read_library_documents" => "leyendo documentos autorizados",
        "read_all_task_tickets" | "search_task_tickets" | "get_task_board_summary" => "consultando las tareas",
        "search_web" => "consultando fuentes públicas",
        "list_gmail_messages" | "read_gmail_message" | "list_gmail_labels" => "revisando tu correo",
        "send_gmail_message" => "preparando el correo",
        "trash_gmail_messages" | "move_gmail_messages" | "mark_gmail_spam" | "mark_gmail_read" => "preparando el cambio en tu correo",
        "list_calendar_events" => "revisando tu calendario",
        "create_calendar_event" => "preparando el evento del calendario",
        "request_user_clarification" => "preparando una pregunta para vos",
        "get_finance_dollar_quotes" | "get_finance_historical_dollar_quotes" => "consultando cotizaciones",
        "get_finance_inflation_indices" => "consultando índices económicos",
        "extract_finance_document" => "leyendo el documento financiero",
        name if name.starts_with("get_finance_") || name.starts_with("list_finance_") => "consultando tus finanzas",
        name if name.starts_with("create_finance_") || name.starts_with("save_finance_") => "preparando el registro financiero",
        name if name.starts_with("get_routine_") || name.starts_with("list_routine_") => "consultando tu rutina",
        "set_routine_completions" => "registrando tus hábitos",
        name if name.contains("routine") => "preparando el cambio en tu rutina",
        name if name.contains("task") => "preparando el cambio en tareas",
        name if name.contains("library") || name.contains("markdown") || name.contains("document") => "preparando el cambio en la biblioteca",
        _ => "completando una tarea autorizada",
    }
}

fn phase_label(phase: &str) -> &'static str {
    match phase {
        "planning" => "Organizando los pasos",
        "reading" => "Leyendo la información necesaria",
        "searching" => "Buscando información pública",
        "responding" => "Redactando la respuesta",
        "executing" => "Ejecutando la operación autorizada",
        "waiting-clarification" => "Necesito una aclaración",
        "waiting-confirmation" => "Espero tu confirmación",
        "verifying" => "Verificando el resultado",
        _ => "Preparando la solicitud",
    }
}

/// Progress text after the events seen so far (HTML), or `None` before the
/// agent starts.
pub fn progress_message(events: &[BackendEvent]) -> Option<String> {
    let mut phase = None;
    let mut activity = None;
    let mut round = None;
    let mut note = None;
    for event in events {
        match event {
            BackendEvent::AssistantNote { text, .. } => note = Some(text.as_str()),
            BackendEvent::PhaseChanged { phase: value, round: value_round, .. } => {
                phase = Some(phase_label(value));
                if value_round.is_some() {
                    round = *value_round;
                }
            }
            BackendEvent::RoundStarted { round: value, .. } => round = Some(*value),
            BackendEvent::ToolStarted { tool_name, .. } => activity = Some(tool_label(tool_name)),
            BackendEvent::ToolCompleted { .. } => activity = None,
            BackendEvent::ClarificationRequired { .. } => phase = Some(phase_label("waiting-clarification")),
            BackendEvent::ConfirmationRequired { .. } => phase = Some(phase_label("waiting-confirmation")),
            _ => {}
        }
    }
    let phase = phase.or(round.map(|_| phase_label("reading")))?;
    let step = round.map(|value| format!(" (paso {value})")).unwrap_or_default();
    // The agent's last note is its status, as a command-line agent shows it.
    let note = note
        .map(|text| format!("\n<i>{}</i>", escape_telegram_html(&clipped_note(text))))
        .unwrap_or_default();
    Some(match activity {
        Some(activity) => format!("<b>{phase}</b>{step}{note}\nAhora: {activity}."),
        None => format!("<b>{phase}</b>{step}{note}"),
    })
}

fn clipped_note(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() > MAX_NOTE_CHARS {
        format!("{}…", text.chars().take(MAX_NOTE_CHARS).collect::<String>())
    } else {
        text.to_string()
    }
}

/// Reply when a message asks to stop the running request (HTML).
pub const CANCELLING_MESSAGE: &str = "<b>Cancelando la solicitud en curso…</b>";

/// Reply once the running request stopped.
pub const CANCELLED_MESSAGE: &str = crate::turn_interrupts::CANCELLED_REPLY;

/// Reply when the request finished before the cancellation reached it.
pub const TOO_LATE_TO_CANCEL_MESSAGE: &str = "La solicitud ya había terminado cuando llegó la cancelación.";

/// Reply when a request waits behind others (HTML).
pub fn queued_message(ahead: usize, document: bool) -> String {
    let what = if document { "Documento en cola." } else { "Solicitud en cola." };
    let plural = if ahead == 1 { "" } else { "es" };
    format!("<b>{what}</b> Hay {ahead} solicitud{plural} antes.")
}

/// Notice about requests interrupted by a restart.
pub fn interrupted_message(count: usize) -> String {
    if count == 1 {
        format!("Tengo una solicitud interrumpida con estado desconocido. Escribí {RECOVERY_COMMAND} si querés reanudarla; no la voy a repetir automáticamente.")
    } else {
        format!("Tengo {count} solicitudes interrumpidas con estado desconocido. Escribí {RECOVERY_COMMAND} si querés reanudarlas; no las voy a repetir automáticamente.")
    }
}

/// Request of a photo, image or PDF sent without text: the model decides
/// what it is, since the router and the agent both see the attachment.
pub const DOCUMENT_PROMPT: &str = "[Origen: documento de Telegram sin texto. Mirá su contenido y hacé lo que corresponda: si es un comprobante financiero (ticket de compra, factura o boleta de servicio, recibo de sueldo, resumen de tarjeta de crédito), extraé todos los campos legibles y registralo con la herramienta financiera del tipo detectado, sin duplicar como gasto una factura de servicio; si es otra cosa (por ejemplo, una agenda o un calendario, una tarea o apuntes), usá las herramientas que correspondan o preguntá qué hacer. Si son varios, procesalos todos.]";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decisions_and_choices_are_parsed() {
        assert_eq!(parse_confirmation_decision("Sí, confirmo!"), Some(true));
        assert_eq!(parse_confirmation_decision("no"), Some(false));
        assert_eq!(parse_confirmation_decision("tal vez"), None);
        let choices = vec!["Banco".to_string(), "Efectivo".to_string()];
        assert_eq!(resolve_choice_reply("2)", &choices), ("Efectivo".to_string(), Some(1)));
        assert_eq!(resolve_choice_reply("otra", &choices), ("otra".to_string(), None));
    }

    #[test]
    fn details_are_redacted_and_escaped() {
        let text = redact_detail("operationId=abc api_key: xyz en C:\\Users\\ana\\x.md");
        assert_eq!(text, "operationId=[oculto] api_key=[oculto] en [ruta privada]");
    }

    #[test]
    fn finance_requests_are_detected() {
        assert!(is_finance_request("¿Cuánto gasté en nafta?"));
        assert!(is_finance_request("anotá $ 500 de almuerzo"));
        assert!(!is_finance_request("resumí la nota de ayer"));
        // «cuenta» names the mail account here: the request goes to the
        // library, where the Gmail tools are.
        let mail = "necesito que de mi cuenta de gmail, elimines todos los email de \"Tienda Vapor\"";
        assert!(is_mail_request(mail));
        assert!(!is_finance_request(mail));
        assert!(is_mail_request("¿qué tengo en el calendario mañana?"));
        assert!(is_finance_request("pagué la cuenta de la luz"));
        assert!(!is_mail_request("pagué la cuenta de la luz"));
    }

    #[test]
    fn progress_follows_phases_and_tools() {
        let events = vec![
            BackendEvent::RoundStarted { request_id: "r".into(), round: 1 },
            BackendEvent::ToolStarted { request_id: "r".into(), tool_name: "search_library_documents".into(), round: 1 },
        ];
        assert_eq!(progress_message(&events).as_deref(), Some("<b>Leyendo la información necesaria</b> (paso 1)\nAhora: buscando en la biblioteca."));
        assert_eq!(progress_message(&[]), None);
    }

    #[test]
    fn progress_shows_the_last_note_of_the_agent() {
        let events = vec![
            BackendEvent::RoundStarted { request_id: "r".into(), round: 2 },
            BackendEvent::AssistantNote { request_id: "r".into(), text: "Busco los correos.".into() },
            BackendEvent::AssistantNote { request_id: "r".into(), text: "Voy a ver el volumen total <antes> de borrar.".into() },
            BackendEvent::ToolStarted { request_id: "r".into(), tool_name: "search_library_documents".into(), round: 2 },
        ];
        assert_eq!(
            progress_message(&events).as_deref(),
            Some("<b>Leyendo la información necesaria</b> (paso 2)\n<i>Voy a ver el volumen total &lt;antes&gt; de borrar.</i>\nAhora: buscando en la biblioteca.")
        );
        let long = vec![
            BackendEvent::RoundStarted { request_id: "r".into(), round: 1 },
            BackendEvent::AssistantNote { request_id: "r".into(), text: "x".repeat(400) },
        ];
        assert!(progress_message(&long).expect("message").ends_with("…</i>"));
    }
}
