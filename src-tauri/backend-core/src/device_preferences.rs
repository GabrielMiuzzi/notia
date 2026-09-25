//! Preferences of this device (not of a library): the Task Manager
//! publication server and the local voice models. The adapter stores them in
//! the app data directory; these rules make every stored value valid.

use serde_json::{json, Map, Value};

pub const DEFAULT_PUBLICATION_PORT: u64 = 52_471;
pub const MAX_PUBLICATION_CLIENTS: u64 = 64;
const TTS_VOICES: [&str; 9] = ["vivian", "serena", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee"];
const DEFAULT_GREETING: &str = "Hola, ¿en qué puedo ayudarte?";
const MAX_BOARDS: usize = 200;
/// The first option of each list is the default.
const PEN_TOOLS: [&str; 3] = ["fountain", "pencil", "marker"];
const PEN_COLORS: [&str; 6] = ["ink", "teal", "blue", "red", "orange", "yellow"];
const PEN_SIDE_BUTTON: [&str; 3] = ["eraser", "select", "none"];

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

/// Speech recognition switch and language (Parakeet is the only model).
pub fn normalize_asr(value: &Value) -> Value {
    json!({
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

fn one_of<'a>(value: &Value, key: &str, allowed: &[&'a str]) -> &'a str {
    let chosen = text(value, key).to_ascii_lowercase();
    allowed.iter().copied().find(|option| *option == chosen).unwrap_or(allowed[0])
}

/// Pen settings for handwriting in notes (the pen itself is not available
/// yet): default tool, ink color by name, stroke and hardware options.
pub fn normalize_pen(value: &Value) -> Value {
    json!({
        "tool": one_of(value, "tool", &PEN_TOOLS),
        "color": one_of(value, "color", &PEN_COLORS),
        "thickness": number(value, "thickness").map_or(3, |thickness| thickness.round().clamp(1.0, 14.0) as u64),
        "smoothing": number(value, "smoothing").map_or(40, |smoothing| smoothing.round().clamp(0.0, 100.0) as u64),
        "pressure": value.get("pressure").and_then(Value::as_bool) != Some(false),
        "palmRejection": value.get("palmRejection").and_then(Value::as_bool) != Some(false),
        "penOnly": value.get("penOnly").and_then(Value::as_bool) == Some(true),
        "sideButton": one_of(value, "sideButton", &PEN_SIDE_BUTTON),
    })
}

/// Every section normalized; missing sections take their defaults. Older
/// versions stored speech recognition under `qwen3Asr`; it is read until the
/// next save writes `speechRecognition`.
pub fn normalize_device_preferences(value: &Value) -> Value {
    let empty = Value::Object(Map::new());
    let section = |key: &str| value.get(key).unwrap_or(&empty).clone();
    let speech_recognition = value.get("speechRecognition").or_else(|| value.get("qwen3Asr")).unwrap_or(&empty);
    json!({
        "taskManagerPublication": normalize_publication(&section("taskManagerPublication")),
        "speechRecognition": normalize_asr(speech_recognition),
        "qwen3Tts": normalize_tts(&section("qwen3Tts")),
        "editorPage": crate::page_setup::normalize_editor_page(&section("editorPage")),
        "pen": normalize_pen(&section("pen")),
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
        assert_eq!(normalized["speechRecognition"], json!({ "enabled": true, "language": "es" }));
    }

    #[test]
    fn editor_page_and_pen_take_valid_values() {
        let normalized = normalize_device_preferences(&json!({
            "editorPage": { "pageMode": true, "format": "legal", "orientation": "landscape" },
            "pen": { "tool": "Marker", "color": "violeta", "thickness": 40, "smoothing": -3, "pressure": false, "penOnly": true, "sideButton": "none" },
        }));
        assert_eq!(
            normalized["editorPage"],
            json!({ "pageMode": true, "format": "legal", "orientation": "landscape", "margins": "normal", "pageNumbers": true })
        );
        assert_eq!(
            normalized["pen"],
            json!({ "tool": "marker", "color": "ink", "thickness": 14, "smoothing": 0, "pressure": false, "palmRejection": true, "penOnly": true, "sideButton": "none" })
        );
        assert_eq!(normalize_device_preferences(&Value::Null)["pen"]["tool"], "fountain");
    }

    #[test]
    fn speech_recognition_keeps_the_legacy_section_until_saved_again() {
        let legacy = json!({ "qwen3Asr": { "model": "1.7b", "device": "gpu", "enabled": false, "language": "en" } });
        let normalized = normalize_device_preferences(&legacy);
        assert_eq!(normalized["speechRecognition"], json!({ "enabled": false, "language": "en" }));
        assert!(normalized.get("qwen3Asr").is_none());

        let both = json!({ "speechRecognition": { "language": "pt" }, "qwen3Asr": { "language": "en" } });
        assert_eq!(normalize_device_preferences(&both)["speechRecognition"]["language"], "pt");
    }
}
