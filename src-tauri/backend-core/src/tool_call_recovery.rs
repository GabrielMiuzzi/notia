//! Tool calls that a local model wrote as text instead of structured
//! `tool_calls`. Some Qwen builds served locally emit
//! `<function=name><parameter=key>value</parameter></function>` (optionally
//! wrapped in `<tool_call>`), or `<tool_call>{"name":…,"arguments":…}</tool_call>`,
//! and may leak `<think>` blocks into the answer. The server then reports a
//! plain answer and the agent never runs the call.
//!
//! Only names the request offered are recovered, so text that merely talks
//! about a tool is never executed.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value};

/// A call recovered from text, with its arguments as a JSON object.
#[derive(Debug, Clone, PartialEq)]
pub struct RecoveredToolCall {
    pub name: String,
    pub arguments: Value,
}

fn xml_function() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?s)(?:<tool_call>\s*)?<function=([\w.\-]+)>(.*?)</function>(?:\s*</tool_call>)?")
            .expect("valid pattern")
    })
}

fn xml_parameter() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?s)<parameter=([\w.\-]+)>(.*?)</parameter>").expect("valid pattern")
    })
}

fn json_tool_call() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?s)<tool_call>\s*(\{.*?\})\s*</tool_call>").expect("valid pattern")
    })
}

fn think_block() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?s)<think>.*?</think>").expect("valid pattern"))
}

/// A parameter value: JSON when it parses (numbers, booleans, objects,
/// arrays), else the trimmed text.
fn parameter_value(raw: &str) -> Value {
    let raw = raw.trim();
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

fn arguments_object(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Object(object)) => Value::Object(object.clone()),
        // Some templates send the arguments as a JSON string.
        Some(Value::String(text)) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Map::new())),
        _ => Value::Object(Map::new()),
    }
}

/// Calls written in `text` whose name is one of `known_tools`, in order.
pub fn recover_tool_calls(text: &str, known_tools: &[&str]) -> Vec<RecoveredToolCall> {
    let known = |name: &str| known_tools.iter().any(|tool| *tool == name);
    let mut calls = Vec::new();
    for capture in xml_function().captures_iter(text) {
        let name = capture[1].trim();
        if !known(name) {
            continue;
        }
        let mut arguments = Map::new();
        for parameter in xml_parameter().captures_iter(&capture[2]) {
            arguments.insert(parameter[1].trim().to_string(), parameter_value(&parameter[2]));
        }
        calls.push(RecoveredToolCall {
            name: name.to_string(),
            arguments: Value::Object(arguments),
        });
    }
    for capture in json_tool_call().captures_iter(text) {
        let Ok(value) = serde_json::from_str::<Value>(&capture[1]) else {
            continue;
        };
        let Some(name) = value.get("name").and_then(Value::as_str).map(str::trim) else {
            continue;
        };
        if !known(name) {
            continue;
        }
        calls.push(RecoveredToolCall {
            name: name.to_string(),
            arguments: arguments_object(value.get("arguments").or_else(|| value.get("parameters"))),
        });
    }
    calls
}

/// The visible answer without leaked `<think>` blocks, a stray closing
/// `</think>` or tool-call markup.
pub fn clean_answer_text(text: &str) -> String {
    let text = think_block().replace_all(text, "");
    let text = match text.find("</think>") {
        Some(index) => text[index + "</think>".len()..].to_string(),
        None => text.into_owned(),
    };
    let text = xml_function().replace_all(&text, "");
    json_tool_call().replace_all(&text, "").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TOOLS: [&str; 2] = ["search_library", "read_document"];

    #[test]
    fn recovers_qwen_xml_calls_after_text() {
        let text = "Voy a buscar.\n<tool_call>\n<function=search_library>\n<parameter=query>\nfacturas\n</parameter>\n<parameter=limit>\n5\n</parameter>\n</function>\n</tool_call>";
        let calls = recover_tool_calls(text, &TOOLS);
        assert_eq!(
            calls,
            vec![RecoveredToolCall {
                name: "search_library".into(),
                arguments: json!({ "query": "facturas", "limit": 5 }),
            }]
        );
        assert_eq!(clean_answer_text(text), "Voy a buscar.");
    }

    #[test]
    fn recovers_json_tool_calls_with_string_arguments() {
        let text = r#"<tool_call>{"name": "read_document", "arguments": "{\"path\": \"a.md\"}"}</tool_call>"#;
        let calls = recover_tool_calls(text, &TOOLS);
        assert_eq!(calls[0].arguments, json!({ "path": "a.md" }));
    }

    #[test]
    fn ignores_tools_the_request_did_not_offer() {
        let text = "<function=delete_everything><parameter=x>1</parameter></function>";
        assert!(recover_tool_calls(text, &TOOLS).is_empty());
    }

    #[test]
    fn strips_leaked_thinking() {
        assert_eq!(clean_answer_text("<think>plan</think>\nRespuesta"), "Respuesta");
        assert_eq!(clean_answer_text("resto del plan</think> Respuesta"), "Respuesta");
        assert_eq!(clean_answer_text("Respuesta normal"), "Respuesta normal");
    }
}
