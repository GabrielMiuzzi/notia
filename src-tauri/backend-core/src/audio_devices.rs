//! The microphone and the computer output a recording captures. The person
//! may choose them; a chosen device that is no longer connected falls back
//! to the system default. Virtual devices (voice changers, mixers, virtual
//! cables) process the voice before it reaches the recognizer and lower its
//! accuracy, so they are flagged.

use serde::Serialize;
use serde_json::{json, Value};

/// Longest device name kept.
pub const MAX_DEVICE_NAME_CHARS: usize = 200;

/// Words in the name of known virtual audio devices.
const VIRTUAL_MARKERS: &[&str] = &[
    "voicemod",
    "vb-audio",
    "voicemeeter",
    "virtual",
    "cable input",
    "cable output",
    "krisp",
    "nvidia broadcast",
    "steam streaming",
    "wave link",
    "obs",
];

/// A device as the recording setup lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceDto {
    pub name: String,
    pub is_default: bool,
    pub is_virtual: bool,
}

/// The devices a recording may capture and the ones chosen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevicesDto {
    /// This platform lets the person choose (Windows).
    pub supported: bool,
    pub microphones: Vec<AudioDeviceDto>,
    pub outputs: Vec<AudioDeviceDto>,
    /// The chosen microphone while it is connected; `None` is the default.
    pub microphone: Option<String>,
    pub output: Option<String>,
}

/// Whether `name` belongs to a virtual audio device.
pub fn is_virtual_device(name: &str) -> bool {
    let name = name.to_lowercase();
    VIRTUAL_MARKERS.iter().any(|marker| {
        name.match_indices(marker).any(|(index, _)| {
            // Whole words: "obs" in "Altavoces (OBS)", not in "kobs".
            let before = name[..index].chars().next_back().is_none_or(|character| !character.is_alphanumeric());
            let after = name[index + marker.len()..].chars().next().is_none_or(|character| !character.is_alphanumeric());
            before && after
        })
    })
}

/// The list of `names` with the default and the virtual ones marked.
pub fn device_list(names: &[String], default: Option<&str>) -> Vec<AudioDeviceDto> {
    names
        .iter()
        .map(|name| AudioDeviceDto {
            name: name.clone(),
            is_default: default == Some(name.as_str()),
            is_virtual: is_virtual_device(name),
        })
        .collect()
}

/// The device a capture opens: the chosen one while it is connected,
/// otherwise `None`, the system default.
pub fn connected_choice(chosen: Option<&str>, available: &[String]) -> Option<String> {
    let chosen = chosen?;
    available.iter().find(|name| name.as_str() == chosen).cloned()
}

fn device_name(value: &Value) -> Value {
    value
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.chars().count() <= MAX_DEVICE_NAME_CHARS && !name.chars().any(char::is_control))
        .map_or(Value::Null, |name| Value::String(name.to_string()))
}

/// The `audioDevices` section of the device preferences: the chosen
/// microphone and output by name, `null` for the default.
pub fn normalize_audio_devices(value: &Value) -> Value {
    json!({
        "microphone": device_name(&value["microphone"]),
        "output": device_name(&value["output"]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_changers_mixers_and_virtual_cables_are_flagged() {
        assert!(is_virtual_device("Micrófono (Voicemod)"));
        assert!(is_virtual_device("CABLE Output (VB-Audio Virtual Cable)"));
        assert!(is_virtual_device("VoiceMeeter Output (VB-Audio VoiceMeeter VAIO)"));
        assert!(is_virtual_device("Micrófono (NVIDIA Broadcast)"));
        assert!(is_virtual_device("Altavoces (OBS)"));
        assert!(!is_virtual_device("Micrófono (Yeti X)"));
        assert!(!is_virtual_device("Micrófono (4- Logitech G935/G933s Gaming Headset)"));
        assert!(!is_virtual_device("Kobs Studio Mic"));
    }

    #[test]
    fn a_chosen_device_counts_only_while_connected() {
        let names = vec!["Micrófono (Voicemod)".to_string(), "Micrófono (Yeti X)".to_string()];
        assert_eq!(connected_choice(Some("Micrófono (Yeti X)"), &names).as_deref(), Some("Micrófono (Yeti X)"));
        assert_eq!(connected_choice(Some("Micrófono (USB viejo)"), &names), None);
        assert_eq!(connected_choice(None, &names), None);
        let list = device_list(&names, Some("Micrófono (Voicemod)"));
        assert!(list[0].is_default && list[0].is_virtual);
        assert!(!list[1].is_default && !list[1].is_virtual);
    }

    #[test]
    fn the_saved_choice_is_a_name_or_the_default() {
        assert_eq!(
            normalize_audio_devices(&json!({ "microphone": "  Micrófono (Yeti X) ", "output": 3 })),
            json!({ "microphone": "Micrófono (Yeti X)", "output": null })
        );
        assert_eq!(normalize_audio_devices(&Value::Null), json!({ "microphone": null, "output": null }));
        assert_eq!(normalize_audio_devices(&json!({ "microphone": "x".repeat(MAX_DEVICE_NAME_CHARS + 1) }))["microphone"], Value::Null);
    }
}
