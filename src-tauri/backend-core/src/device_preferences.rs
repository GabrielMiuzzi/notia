//! Preferences of this device (not of a library): the Task Manager
//! publication server and the local voice models. The adapter stores them in
//! the app data directory; these rules make every stored value valid.

use serde_json::{json, Map, Value};

pub const DEFAULT_PUBLICATION_PORT: u64 = 52_471;
pub const MAX_PUBLICATION_CLIENTS: u64 = 64;
const TTS_VOICES: [&str; 9] = ["vivian", "serena", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee"];
const DEFAULT_GREETING: &str = "Hola, ¿en qué puedo ayudarte?";
const MAX_BOARDS: usize = 200;

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string()
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite())
}

fn language(value: &Value) -> String {
    let language = text(value, "language").to_lowercase();
    let valid = !language.is_empty() && language.len() <= 16 && language.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid { language } else { "es".to_string() }
}

/// Published boards (lowercase, unique), port and client limit.
pub fn normalize_publication(value: &Value) -> Value {
    let mut boards = Vec::<String>::new();
    for name in value.get("publishedBoardNames").and_then(Value::as_array).into_iter().flatten() {
        let name = name.as_str().unwrap_or_default().trim().to_lowercase();
        if !name.is_empty() && name.chars().count() <= 200 && !boards.contains(&name) && boards.len() < MAX_BOARDS {
            boards.push(name);
        }
    }
    let port = value
        .get("port")
        .and_then(Value::as_u64)
        .filter(|port| (1_024..=65_535).contains(port))
        .unwrap_or(DEFAULT_PUBLICATION_PORT);
    let clients = value
        .get("maxClients")
        .and_then(Value::as_u64)
        .filter(|clients| (1..=MAX_PUBLICATION_CLIENTS).contains(clients))
        .unwrap_or(MAX_PUBLICATION_CLIENTS);
    json!({ "publishedBoardNames": boards, "port": port, "maxClients": clients })
}

/// Speech recognition model, device, language and switch.
pub fn normalize_asr(value: &Value) -> Value {
    json!({
        "model": if text(value, "model") == "1.7b" { "1.7b" } else { "0.6b" },
        "device": if text(value, "device") == "gpu" { "gpu" } else { "cpu" },
        "enabled": value.get("enabled").and_then(Value::as_bool) != Some(false),
        "language": language(value),
    })
}

/// Speech synthesis model, voice, speed, pause detection and greeting.
pub fn normalize_tts(value: &Value) -> Value {
    let voice = text(value, "voice").to_lowercase();
    let greeting = text(value, "greeting");
    json!({
        "model": if text(value, "model") == "1.7b" { "1.7b" } else { "0.6b" },
        "device": "cpu",
        "enabled": value.get("enabled").and_then(Value::as_bool) == Some(true),
        "voice": if TTS_VOICES.contains(&voice.as_str()) { voice } else { "serena".to_string() },
        "language": language(value),
        "speed": number(value, "speed").map_or(1.0, |speed| speed.clamp(0.7, 1.8)),
        "pauseDetectionMs": number(value, "pauseDetectionMs").map_or(1_200, |ms| ms.round().clamp(600.0, 4_000.0) as u64),
        "greeting": if greeting.is_empty() { DEFAULT_GREETING.to_string() } else { greeting.chars().take(500).collect() },
    })
}

/// Every section normalized; missing sections take their defaults.
pub fn normalize_device_preferences(value: &Value) -> Value {
    let empty = Value::Object(Map::new());
    let section = |key: &str| value.get(key).unwrap_or(&empty).clone();
    json!({
        "taskManagerPublication": normalize_publication(&section("taskManagerPublication")),
        "qwen3Asr": normalize_asr(&section("qwen3Asr")),
        "qwen3Tts": normalize_tts(&section("qwen3Tts")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_values_take_their_defaults() {
        let normalized = normalize_device_preferences(&json!({
            "taskManagerPublication": { "publishedBoardNames": [" Equipo ", "equipo", 3], "port": 80, "maxClients": 500 },
            "qwen3Tts": { "voice": "nadie", "speed": 9, "pauseDetectionMs": 10, "enabled": "si" },
        }));
        assert_eq!(normalized["taskManagerPublication"], json!({ "publishedBoardNames": ["equipo"], "port": 52471, "maxClients": 64 }));
        assert_eq!(normalized["qwen3Tts"]["voice"], "serena");
        assert_eq!(normalized["qwen3Tts"]["speed"], 1.8);
        assert_eq!(normalized["qwen3Tts"]["pauseDetectionMs"], 600);
        assert_eq!(normalized["qwen3Tts"]["enabled"], false);
        assert_eq!(normalized["qwen3Asr"], json!({ "model": "0.6b", "device": "cpu", "enabled": true, "language": "es" }));
    }
}
