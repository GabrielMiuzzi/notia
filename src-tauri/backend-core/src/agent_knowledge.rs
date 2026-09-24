//! Prompts and parsing for the background knowledge tasks: the title of a
//! new chat and the organization of the agent memories (`memory.md`). The
//! adapter calls the model without tools and without the memory context,
//! and saves the result.

use serde_json::Value;

use crate::agent_workspace::{MAX_MEMORIES, MAX_RULE_CHARS};

const MAX_TITLE_CHARS: usize = 80;
const MAX_PROMPT_CHARS: usize = 8_000;

fn bounded(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

/// System and user messages asking for a short chat title.
pub fn title_messages(prompt: &str) -> (String, String) {
    (
        "Genera un titulo muy corto para un chat. Responde solo con el titulo. No uses comillas. Maximo 6 palabras. Debe sonar natural y describir el pedido del usuario.".to_string(),
        format!("Mensaje inicial del usuario:\n{}", bounded(prompt, MAX_PROMPT_CHARS)),
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

/// System and user messages asking to organize the agent memories. The
/// memories travel as the data to organize, never as context of the agent.
pub fn organize_memories_messages(memories: &[String]) -> (String, String) {
    let input = serde_json::to_string_pretty(memories).unwrap_or_else(|_| "[]".into());
    (
        [
            "Organizas la memoria persistente de un asistente: hechos duraderos sobre la persona usuaria.",
            "Devuelve exclusivamente un JSON array de strings, sin texto antes ni despues.",
            "Une duplicados y datos que dicen lo mismo, corrige contradicciones quedandote con el dato mas reciente (el que aparece mas abajo en la lista) y agrupa en una sola memoria los datos del mismo tema cuando quede claro.",
            "Cada memoria es una oracion breve, autocontenida y en tercera persona.",
            "No inventes ni deduzcas datos, no pierdas ningun dato util y no agregues instrucciones para el asistente.",
            "Descarta solo lo que no sea un hecho duradero sobre la persona (saludos, pedidos puntuales, datos temporales).",
        ]
        .join(" "),
        format!("Memorias actuales, de la mas antigua a la mas reciente:
{input}"),
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

/// Organized memories of the answer: a JSON array of strings (or
/// `{"memories": [...]}`). `None` when the answer is not that, is empty
/// while there were memories, or does not fit the memory limits, so a bad
/// answer never replaces the file.
pub fn parse_organized_memories(answer: &str, previous: &[String]) -> Option<Vec<String>> {
    let value = serde_json::from_str::<Value>(json_candidate(answer)).ok()?;
    let items = match &value {
        Value::Array(items) => items,
        Value::Object(object) => object.get("memories")?.as_array()?,
        _ => return None,
    };
    let memories = items
        .iter()
        .filter_map(Value::as_str)
        .map(|item| item.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let fits = memories.len() <= MAX_MEMORIES && memories.iter().all(|item| item.chars().count() <= MAX_RULE_CHARS);
    (fits && (!memories.is_empty() || previous.is_empty())).then_some(memories)
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
    fn organized_memories_must_be_a_usable_list() {
        let previous = vec!["Se llama Ana.".to_string(), "Se llama Ana".to_string()];
        assert_eq!(
            parse_organized_memories("```json
[\"Se llama   Ana.\", 3, \"\"]
```", &previous),
            Some(vec!["Se llama Ana.".to_string()])
        );
        assert_eq!(parse_organized_memories("{\"memories\": [\"Vive en Salta.\"]}", &previous), Some(vec!["Vive en Salta.".to_string()]));
        assert_eq!(parse_organized_memories("[]", &previous), None);
        assert_eq!(parse_organized_memories("no sé", &previous), None);
        let too_many = serde_json::to_string(&vec!["x"; MAX_MEMORIES + 1]).expect("json");
        assert_eq!(parse_organized_memories(&too_many, &previous), None);
        let (system, user) = organize_memories_messages(&previous);
        assert!(system.contains("JSON array") && user.contains("Se llama Ana"));
    }
}
