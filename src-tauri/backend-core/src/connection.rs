//! How this installation runs (a device setting, not a library one):
//!
//! - **Host**: it keeps the library and serves it to clients on a port
//!   (Windows and Linux; Android has no server).
//! - **Client**: it uses the library of a host. **Remote** clients keep no
//!   files; **copy** clients keep a synced copy to work without connection.
//!
//! The adapter stores these settings in the app data folder; the
//! certificate the client trusts is pinned on the first connection. On
//! Android the copy lives in a folder the person chooses (SAF).

use serde::{Deserialize, Serialize};

use crate::error::BackendError;

pub const DEFAULT_HOST_PORT: u16 = 52_480;
/// Version of the API between a client and its host (`/api/health`).
pub const HOST_PROTOCOL_VERSION: u16 = 1;
const MIN_PORT: u16 = 1_024;
const MAX_HOST_CHARS: usize = 253;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunMode {
    #[default]
    Host,
    Client,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientKind {
    #[default]
    Copy,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSettings {
    #[serde(default)]
    pub mode: RunMode,
    #[serde(default)]
    pub client_kind: ClientKind,
    /// `host:port` of the host, as the person wrote it (normalized).
    #[serde(default)]
    pub host_address: String,
    /// Port this installation listens on as a host.
    #[serde(default = "default_port")]
    pub port: u16,
    /// SHA-256 of the host certificate trusted on the first connection
    /// (hex); a different certificate is refused until the address changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_certificate: Option<String>,
    /// Folder of the copy chosen on Android (a SAF tree). Desktop keeps
    /// the copy in the app data folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copy_folder: Option<CopyFolder>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFolder {
    /// The tree URI of the grant, kept as received (opaque).
    pub uri: String,
    /// Name of the folder, to show.
    pub name: String,
}

fn default_port() -> u16 {
    DEFAULT_HOST_PORT
}

impl Default for ConnectionSettings {
    fn default() -> Self {
        Self {
            mode: RunMode::Host,
            client_kind: ClientKind::Copy,
            host_address: String::new(),
            port: DEFAULT_HOST_PORT,
            host_certificate: None,
            copy_folder: None,
        }
    }
}

/// A host address split into host and port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostAddress {
    pub host: String,
    pub port: u16,
}

impl HostAddress {
    /// `host:port`, with brackets around an IPv6 address.
    pub fn display(&self) -> String {
        if self.host.contains(':') { format!("[{}]:{}", self.host, self.port) } else { format!("{}:{}", self.host, self.port) }
    }

    /// Base URL of the host's API.
    pub fn base_url(&self) -> String {
        format!("https://{}", self.display())
    }
}

fn invalid_address() -> BackendError {
    BackendError::invalid_input("Escribí la dirección del host como equipo:puerto, por ejemplo 192.168.0.10:52480.")
}

/// Parses `equipo`, `equipo:puerto` or `[ipv6]:puerto` (without scheme or
/// path); the port defaults to 52480.
pub fn parse_host_address(text: &str) -> Result<HostAddress, BackendError> {
    let text = text.trim();
    let text = text.strip_prefix("https://").unwrap_or(text).trim_end_matches('/');
    if text.is_empty() || text.contains(['/', '?', '#', '@', ' ']) {
        return Err(invalid_address());
    }
    let (host, port) = if let Some(rest) = text.strip_prefix('[') {
        let (host, after) = rest.split_once(']').ok_or_else(invalid_address)?;
        let port = match after.strip_prefix(':') {
            Some(port) => Some(port),
            None if after.is_empty() => None,
            None => return Err(invalid_address()),
        };
        (host.to_string(), port)
    } else {
        match text.rsplit_once(':') {
            Some((host, port)) if !host.contains(':') => (host.to_string(), Some(port)),
            Some(_) => return Err(invalid_address()),
            None => (text.to_string(), None),
        }
    };
    let port = match port {
        Some(port) => port.parse::<u16>().ok().filter(|port| *port >= MIN_PORT).ok_or_else(invalid_address)?,
        None => DEFAULT_HOST_PORT,
    };
    let valid_host = !host.is_empty()
        && host.chars().count() <= MAX_HOST_CHARS
        && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '%'));
    if !valid_host {
        return Err(invalid_address());
    }
    Ok(HostAddress { host: host.to_ascii_lowercase(), port })
}

/// Settings as stored, with a valid port and a normalized address. A pin
/// that belongs to another address is dropped by the adapter on change.
pub fn normalize_connection(settings: ConnectionSettings) -> ConnectionSettings {
    let host_address = parse_host_address(&settings.host_address).map(|address| address.display()).unwrap_or_default();
    ConnectionSettings {
        port: if settings.port >= MIN_PORT { settings.port } else { DEFAULT_HOST_PORT },
        host_certificate: settings
            .host_certificate
            .filter(|pin| pin.len() == 64 && pin.chars().all(|c| c.is_ascii_hexdigit()) && !host_address.is_empty()),
        copy_folder: settings.copy_folder.filter(|folder| crate::AndroidTreeUriDto::new(&folder.uri).is_ok()),
        host_address,
        ..settings
    }
}

/// Commands a client runs on its own device even while it uses a host:
/// its sign-in with the host, its connection settings, the preferences of
/// the device itself and its speech: dictation and the whole Meeting
/// (microphone, recognizer, speakers and the meeting itself; the meeting
/// note, its tasks and the AI run on the host). Everything else goes to the
/// host.
pub const CLIENT_LOCAL_COMMANDS: &[&str] = &[
    "app_auth_status",
    "app_auth_login",
    "app_auth_first_login",
    "app_auth_create_password",
    "app_auth_change_password",
    "app_auth_logout",
    "connection_settings",
    "save_connection_settings",
    "test_host_connection",
    "client_open",
    "enter_offline_copy",
    "leave_offline_copy",
    "sync_copy_now",
    "pick_copy_folder",
    "backend_device_preferences",
    "backend_save_device_preferences",
    // The clipboard of the device the person is using.
    "coldpass_copy_secret",
    // The fingerprint sensor of the device the person is using: the
    // unlock it opens still runs on the host.
    "coldpass_biometric_status",
    "coldpass_enable_biometric",
    "coldpass_disable_biometric",
    "coldpass_unlock_biometric",
    // Speech runs on the device the person holds: a tablet dictates and
    // transcribes a meeting in the room, also without the network.
    "get_speech_capabilities",
    "probe_speech_audio_input",
    "probe_sherpa_runtime",
    "prepare_device_speech_model",
    "start_speech_session",
    "pause_speech_session",
    "resume_speech_session",
    "consume_speech_turn",
    "stop_speech_session",
    "cancel_speech_session",
    "skip_speech_diarization",
    "speech_session_state",
    "start_audio_monitor",
    "stop_audio_monitor",
    "meeting_media_begin",
    "meeting_media_chunk",
    "meeting_media_finish",
    "meeting_media_discard",
    "meeting_start_file_session",
    "meeting_snapshot",
    "meeting_context",
    "meeting_discard",
    "meeting_add_mark",
    "meeting_remove_mark",
    "meeting_set_notes",
    "meeting_set_live_answers",
    "meeting_set_ai_notes",
    "meeting_call_notes_agent",
    "meeting_regenerate_answer",
    "meeting_pin_answer",
    "meeting_rename_speaker",
    "meeting_merge_speakers",
    "meeting_generate_insights",
    "meeting_save_note",
    "meeting_export",
    "meeting_send_tasks",
];

pub fn is_client_local_command(command: &str) -> bool {
    CLIENT_LOCAL_COMMANDS.contains(&command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_addresses_are_parsed_with_their_port() {
        assert_eq!(parse_host_address(" 192.168.0.10:52480 ").expect("ip").display(), "192.168.0.10:52480");
        assert_eq!(parse_host_address("Notebook-Gabi").expect("name"), HostAddress { host: "notebook-gabi".into(), port: DEFAULT_HOST_PORT });
        assert_eq!(parse_host_address("https://casa.local:6000/").expect("scheme").display(), "casa.local:6000");
        assert_eq!(parse_host_address("[fe80::1]:6000").expect("ipv6").display(), "[fe80::1]:6000");
        assert_eq!(parse_host_address("[fe80::1]").expect("ipv6").base_url(), "https://[fe80::1]:52480");
        for bad in ["", "casa:80", "casa:puerto", "a/b", "fe80::1", "user@casa", "casa:70000"] {
            assert!(parse_host_address(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn stored_settings_are_normalized() {
        let settings = normalize_connection(ConnectionSettings {
            mode: RunMode::Client,
            client_kind: ClientKind::Remote,
            host_address: "Casa:6000".into(),
            port: 80,
            host_certificate: Some("ab".repeat(32)),
            copy_folder: Some(CopyFolder { uri: "content://com.android.externalstorage.documents/tree/primary%3ACopia".into(), name: "Copia".into() }),
        });
        assert!(settings.copy_folder.is_some());
        let bad_folder = normalize_connection(ConnectionSettings {
            copy_folder: Some(CopyFolder { uri: "file:///sdcard/Copia".into(), name: "Copia".into() }),
            ..settings.clone()
        });
        assert_eq!(bad_folder.copy_folder, None);
        assert_eq!(settings.host_address, "casa:6000");
        assert_eq!(settings.port, DEFAULT_HOST_PORT);
        assert!(settings.host_certificate.is_some());
        let without_host = normalize_connection(ConnectionSettings { host_address: "no válido".into(), ..settings.clone() });
        assert_eq!(without_host.host_address, "");
        assert_eq!(without_host.host_certificate, None);
        let parsed: ConnectionSettings = serde_json::from_str("{}").expect("defaults");
        assert_eq!(parsed, ConnectionSettings::default());
        assert!(is_client_local_command("app_auth_login") && !is_client_local_command("finance_overview"));
        assert!(is_client_local_command("start_speech_session") && is_client_local_command("meeting_snapshot"));
        assert!(!is_client_local_command("meeting_task_boards"));
    }
}
