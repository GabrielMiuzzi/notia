//! Prompts and parsing for the background knowledge tasks of the agent: the
//! title of a new chat, long-term memories learned from a turn and the
//! reorganization of rules and memories. The adapter calls the model and
//! persists the results through the workspace rules.

use serde_json::Value;

use crate::agent_workspace::MAX_MEMORIES;

const MAX_TITLE_CHARS: usize = 80;
const MAX_TURN_CHARS: usize = 8_000;

fn bounded(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

/// System and user messages asking for a short chat title.
pub fn title_messages(prompt: &str) -> (String, String) {
    (
        "Genera un titulo muy corto para un chat. Responde solo con el titulo. No uses comillas. Maximo 6 palabras. Debe sonar natural y describir el pedido del usuario.".to_string(),
        format!("Mensaje inicial del usuario:\n{}", bounded(prompt, MAX_TURN_CHARS)),
    )
}

/// Single-line title without quotes, or `None` when the model gave none.
pub fn sanitize_title(answer: &str) -> Option<String> {
    let title = answer
        .trim()
        .trim_matches(['"', '\'', '`'])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = title.chars().take(MAX_TITLE_CHARS).collect::<String>();
    (!title.is_empty() && !title.contains(['\n', '\r'])).then_some(title)
}

/// A message of the recent conversation (`user` or `assistant`).
pub struct TurnMessage<'a> {
    pub role: &'a str,
    pub content: &'a str,
}

/// System and user messages asking for new durable facts about the user.
pub fn memory_messages(existing: &[String], previous: &[TurnMessage<'_>], prompt: &str, reply: &str) -> (String, String) {
    let existing = existing.iter().map(|memory| memory.trim()).filter(|memory| !memory.is_empty()).take(MAX_MEMORIES).collect::<Vec<_>>();
    let conversation = previous
        .iter()
        .filter(|message| !message.content.trim().is_empty())
        .rev()
        .take(10)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| format!("{}: {}", message.role, bounded(message.content, 2_000)))
        .collect::<Vec<_>>()
        .join("\n");
    let user = [
        "Memorias ya guardadas:".to_string(),
        serde_json::to_string_pretty(&existing).unwrap_or_else(|_| "[]".into()),
        String::new(),
        "Contexto reciente del chat:".to_string(),
        if conversation.is_empty() { "(sin mensajes previos)".to_string() } else { conversation },
        String::new(),
        "Ultimo mensaje del usuario:".to_string(),
        bounded(prompt, MAX_TURN_CHARS),
        String::new(),
        "Ultima respuesta del asistente:".to_string(),
        bounded(reply, MAX_TURN_CHARS),
    ]
    .join("\n");
    (
        "Extrae memorias de largo plazo nuevas y utiles para el usuario. Devuelve solo un JSON array de strings. Cada item debe ser un hecho estable, preferencia, gusto o dato personal explicito y util. Si el usuario dijo su nombre, gustos, profesion, ubicacion, estudios, objetivos o preferencias duraderas, debes extraerlo. No repitas memorias ya existentes. Si no hay nada nuevo o duradero, devuelve []. No expliques nada fuera del JSON. Ejemplo valido: [\"El nombre del usuario es Gabriel.\", \"Al usuario le gusta la electronica y la musica.\"]".to_string(),
        user,
    )
}

fn json_candidate(answer: &str) -> &str {
    let trimmed = answer.trim();
    if let Some(start) = trimmed.find("```") {
        let rest = &trimmed[start + 3..];
        let rest = rest.strip_prefix("json").unwrap_or(rest);
        if let Some(end) = rest.find("```") {
            return rest[..end].trim();
        }
    }
    match (trimmed.find(['[', '{']), trimmed.rfind([']', '}'])) {
        (Some(start), Some(end)) if end > start => &trimmed[start..=end],
        _ => trimmed,
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

/// Memories in the answer: a JSON array, `{"memories": [...]}` or one per
/// line as a fallback.
pub fn parse_memory_list(answer: &str) -> Vec<String> {
    match serde_json::from_str::<Value>(json_candidate(answer)) {
        Ok(Value::Array(items)) => strings(Some(&Value::Array(items))),
        Ok(value @ Value::Object(_)) => strings(value.get("memories")),
        _ => answer
            .lines()
            .map(|line| line.trim().trim_start_matches(['-', '*']).trim())
            .filter(|line| !line.is_empty() && *line != "[]")
            .map(str::to_string)
            .collect(),
    }
}

/// System and user messages asking to split knowledge into rules and memories.
pub fn organize_messages(rules: &[String], memories: &[String]) -> (String, String) {
    let input = serde_json::json!({ "rules": rules, "memories": memories });
    (
        "Sos un clasificador estricto de reglas y memorias.".to_string(),
        [
            "Clasifica y reorganiza el conocimiento persistente del agente.".to_string(),
            "Devuelve exclusivamente JSON valido con esta forma: {\"rules\":[\"...\"],\"memories\":[\"...\"]}.".to_string(),
            "rules contiene solo instrucciones imperativas sobre el comportamiento futuro del asistente.".to_string(),
            "memories contiene identidad, preferencias, empleo, proyectos y hechos duraderos del usuario.".to_string(),
            "Deduplica, conserva todos los hechos utiles y no inventes informacion.".to_string(),
            format!("Entrada: {input}"),
        ]
        .join("\n"),
    )
}

/// Rules and memories of the answer; `None` when it is not the expected JSON.
pub fn parse_organized(answer: &str) -> Option<(Vec<String>, Vec<String>)> {
    let value = serde_json::from_str::<Value>(json_candidate(answer)).ok()?;
    value.is_object().then(|| (strings(value.get("rules")), strings(value.get("memories"))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_are_single_line_without_quotes() {
        assert_eq!(sanitize_title(" \"Plan de viaje\" ").as_deref(), Some("Plan de viaje"));
        assert_eq!(sanitize_title("  "), None);
    }

    #[test]
    fn memories_accept_arrays_objects_and_lines() {
        assert_eq!(parse_memory_list("```json\n[\"Se llama Ana\"]\n```"), vec!["Se llama Ana".to_string()]);
        assert_eq!(parse_memory_list("{\"memories\": [\"Vive en Salta\", 3]}"), vec!["Vive en Salta".to_string()]);
        assert_eq!(parse_memory_list("- Uno\n- Dos"), vec!["Uno".to_string(), "Dos".to_string()]);
        assert!(parse_memory_list("[]").is_empty());
    }

    #[test]
    fn organized_knowledge_needs_an_object() {
        assert_eq!(
            parse_organized("{\"rules\":[\"Respondé breve\"],\"memories\":[\"Se llama Ana\"]}"),
            Some((vec!["Respondé breve".to_string()], vec!["Se llama Ana".to_string()]))
        );
        assert_eq!(parse_organized("no"), None);
    }
}
