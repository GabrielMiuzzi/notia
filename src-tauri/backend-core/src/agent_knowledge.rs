//! Prompts and parsing for the background knowledge tasks: the title of a
//! new chat and the organization of the agent memories (`memory.md`) and of
//! its own thoughts (`thoughts.md`). The adapter calls the model without
//! tools and without the memory context, and saves the result.

use serde_json::Value;

use crate::agent_workspace::{ItemBudget, MAX_MEMORIES, MAX_RULE_CHARS, MAX_THOUGHT_CHARS};

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
/// With `budget` (a full memory), the answer must also fit in it.
pub fn organize_memories_messages(memories: &[String], budget: Option<ItemBudget>) -> (String, String) {
    let input = serde_json::to_string_pretty(memories).unwrap_or_else(|_| "[]".into());
    let mut system = vec![
        "Organizas la memoria persistente de un asistente: hechos duraderos sobre la persona usuaria.".to_string(),
        "Devuelve exclusivamente un JSON array de strings, sin texto antes ni despues.".to_string(),
        "Une duplicados y datos que dicen lo mismo, corrige contradicciones quedandote con el dato mas reciente (el que aparece mas abajo en la lista) y agrupa en una sola memoria los datos del mismo tema cuando quede claro.".to_string(),
        "Cada memoria es una oracion breve, autocontenida y en tercera persona.".to_string(),
        "No inventes ni deduzcas datos, no pierdas ningun dato util y no agregues instrucciones para el asistente.".to_string(),
        "Descarta solo lo que no sea un hecho duradero sobre la persona (saludos, pedidos puntuales, datos temporales).".to_string(),
    ];
    if let Some(budget) = budget {
        system.push(format!(
            "La memoria llego a su limite: reescribila en como maximo {} memorias y {} caracteres en total, resumiendo y uniendo sin perder los datos mas importantes.",
            budget.items, budget.chars
        ));
    }
    (system.join(" "), format!("Memorias actuales, de la mas antigua a la mas reciente:\n{input}"))
}

/// System and user messages asking to reorganize the agent's own thoughts
/// within `budget`. `now_label` is the local date and time, so the model
/// can tell what already passed.
pub fn organize_thoughts_messages(thoughts: &[String], now_label: &str, budget: ItemBudget) -> (String, String) {
    let input = serde_json::to_string_pretty(thoughts).unwrap_or_else(|_| "[]".into());
    (
        [
            "Organizas los pensamientos de trabajo de un asistente personal: lo que observo y lo que le aviso, pregunto o propuso a la persona usuaria.".to_string(),
            "Devuelve exclusivamente un JSON array de strings, sin texto antes ni despues.".to_string(),
            "Cada pensamiento empieza con su fecha en el formato [AAAA-MM-DD HH:MM]: conservala tal cual y, al unir varios, usa la mas reciente.".to_string(),
            "Une duplicados y pensamientos del mismo tema en uno solo, breve y autocontenido, y ordenalos por tema.".to_string(),
            "Descarta lo que ya no sirve: eventos y plazos que ya pasaron sin dejar nada pendiente, preguntas respondidas y propuestas resueltas.".to_string(),
            "Conserva lo que ya aviso, pregunto o propuso mientras el tema siga vigente, para no repetirlo.".to_string(),
            "No inventes ni deduzcas datos y no agregues instrucciones.".to_string(),
            format!(
                "Como maximo {} pensamientos y {} caracteres en total; cada uno de hasta {MAX_THOUGHT_CHARS} caracteres sin contar la fecha.",
                budget.items, budget.chars
            ),
        ]
        .join(" "),
        format!("Fecha y hora actual: {now_label}.\nPensamientos actuales, del mas antiguo al mas reciente:\n{input}"),
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

/// Non-empty strings of the answer: a JSON array of strings, or an object
/// holding that array under `key`, with whitespace collapsed.
fn parse_string_list(answer: &str, key: &str) -> Option<Vec<String>> {
    let value = serde_json::from_str::<Value>(json_candidate(answer)).ok()?;
    let items = match &value {
        Value::Array(items) => items,
        Value::Object(object) => object.get(key)?.as_array()?,
        _ => return None,
    };
    Some(
        items
            .iter()
            .filter_map(Value::as_str)
            .map(|item| item.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|item| !item.is_empty())
            .collect(),
    )
}

/// Organized memories of the answer: a JSON array of strings (or
/// `{"memories": [...]}`). `None` when the answer is not that, is empty
/// while there were memories, or does not fit the memory limits (and
/// `budget`, when given), so a bad answer never replaces the file.
pub fn parse_organized_memories(answer: &str, previous: &[String], budget: Option<ItemBudget>) -> Option<Vec<String>> {
    let memories = parse_string_list(answer, "memories")?;
    let fits = memories.len() <= MAX_MEMORIES
        && memories.iter().all(|item| item.chars().count() <= MAX_RULE_CHARS)
        && budget.is_none_or(|budget| budget.fits(&memories));
    (fits && (!memories.is_empty() || previous.is_empty())).then_some(memories)
}

/// Characters a thought's `[AAAA-MM-DD HH:MM] ` prefix adds.
const THOUGHT_STAMP_CHARS: usize = 19;

/// Organized thoughts of the answer (a JSON array of strings, or
/// `{"thoughts": [...]}`), or `None` when it is not usable or does not fit
/// `budget`, so a bad answer never replaces the file.
pub fn parse_organized_thoughts(answer: &str, previous: &[String], budget: ItemBudget) -> Option<Vec<String>> {
    let thoughts = parse_string_list(answer, "thoughts")?;
    let fits = budget.fits(&thoughts)
        && thoughts.iter().all(|item| item.chars().count() <= MAX_THOUGHT_CHARS + THOUGHT_STAMP_CHARS);
    (fits && (!thoughts.is_empty() || previous.is_empty())).then_some(thoughts)
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
```", &previous, None),
            Some(vec!["Se llama Ana.".to_string()])
        );
        assert_eq!(parse_organized_memories("{\"memories\": [\"Vive en Salta.\"]}", &previous, None), Some(vec!["Vive en Salta.".to_string()]));
        assert_eq!(parse_organized_memories("[]", &previous, None), None);
        assert_eq!(parse_organized_memories("no sé", &previous, None), None);
        let too_many = serde_json::to_string(&vec!["x"; MAX_MEMORIES + 1]).expect("json");
        assert_eq!(parse_organized_memories(&too_many, &previous, None), None);
        let (system, user) = organize_memories_messages(&previous, None);
        assert!(system.contains("JSON array") && user.contains("Se llama Ana") && !system.contains("limite"));
    }

    #[test]
    fn a_full_memory_must_be_rewritten_within_the_budget() {
        let previous = vec!["Se llama Ana.".to_string()];
        let budget = ItemBudget { items: 1, chars: 20 };
        let (system, _) = organize_memories_messages(&previous, Some(budget));
        assert!(system.contains("como maximo 1 memorias y 20 caracteres"));
        assert_eq!(parse_organized_memories("[\"Se llama Ana.\", \"Vive en Salta.\"]", &previous, Some(budget)), None);
        assert_eq!(
            parse_organized_memories("[\"Ana, de Salta.\"]", &previous, Some(budget)),
            Some(vec!["Ana, de Salta.".to_string()])
        );
    }

    #[test]
    fn organized_thoughts_keep_their_dates_and_fit_the_budget() {
        let previous = vec![
            "[2026-09-27 10:00] Le avisé del turno del lunes.".to_string(),
            "[2026-09-27 11:00] Le avisé del turno del lunes a las 10.".to_string(),
        ];
        let budget = ItemBudget { items: 1, chars: 200 };
        let (system, user) = organize_thoughts_messages(&previous, "2026-09-27 12:00", budget);
        assert!(system.contains("[AAAA-MM-DD HH:MM]") && system.contains("Como maximo 1 pensamientos"));
        assert!(user.contains("Fecha y hora actual: 2026-09-27 12:00.") && user.contains("turno del lunes"));
        assert_eq!(
            parse_organized_thoughts("{\"thoughts\": [\"[2026-09-27 11:00] Le avisé del turno del lunes a las 10.\"]}", &previous, budget),
            Some(vec!["[2026-09-27 11:00] Le avisé del turno del lunes a las 10.".to_string()])
        );
        assert_eq!(parse_organized_thoughts(&serde_json::to_string(&previous).expect("json"), &previous, budget), None);
        assert_eq!(parse_organized_thoughts("[]", &previous, budget), None);
        let long = serde_json::to_string(&vec![format!("[2026-09-27 11:00] {}", "x".repeat(MAX_THOUGHT_CHARS + 1))]).expect("json");
        assert_eq!(parse_organized_thoughts(&long, &previous, ItemBudget { items: 5, chars: 10_000 }), None);
    }
}
