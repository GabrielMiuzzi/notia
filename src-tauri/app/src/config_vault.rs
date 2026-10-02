//! Libraries unlocked in this session: the data key that opens each
//! library's encrypted configuration, held in memory after the Owner signs
//! in. «Recordar sesión» keeps it on this device so the library opens (and
//! its background services run) without signing in again; «Recordar datos»
//! keeps the Owner's user name and password to fill the form. Both are
//! sealed with `device_secret`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use crate::backend::config_envelope::WrappedKey;
use crate::backend::{BackendError, BackendErrorCode};
use crate::config_crypto::DataKey;
use crate::host::{AppHandle, Manager};

const DIRECTORY: &str = "app-auth";

/// The key of an unlocked library and the wrapped copy it was opened with.
#[derive(Clone, Debug)]
pub(crate) struct Unlocked {
    pub(crate) key: DataKey,
    pub(crate) wrapped: WrappedKey,
}

#[derive(Default)]
pub(crate) struct ConfigVaultState {
    unlocked: Mutex<HashMap<String, Unlocked>>,
}

/// The unlocked key of `library_id`, restoring a remembered session.
pub(crate) fn unlocked(app: &AppHandle, library_id: &str) -> Option<Unlocked> {
    let state = app.state::<ConfigVaultState>();
    if let Some(unlocked) = state.unlocked.lock().ok()?.get(library_id).cloned() {
        return Some(unlocked);
    }
    let session = read_file(app, library_id).session?;
    let key = DataKey::from_bytes(&crate::device_secret::unprotect(&decode(&session.key)?)?)?;
    let unlocked = Unlocked { key, wrapped: session.wrapped };
    state.unlocked.lock().ok()?.insert(library_id.to_string(), unlocked.clone());
    Some(unlocked)
}

pub(crate) fn is_unlocked(app: &AppHandle, library_id: &str) -> bool {
    unlocked(app, library_id).is_some()
}

/// Keeps `unlocked` in memory for the session.
pub(crate) fn unlock(app: &AppHandle, library_id: &str, unlocked: Unlocked) {
    if let Ok(mut keys) = app.state::<ConfigVaultState>().unlocked.lock() {
        keys.insert(library_id.to_string(), unlocked);
    }
    crate::library_config::config_changed();
}

/// Replaces the wrapped copy of an unlocked library (a new password).
pub(crate) fn update_wrapped(app: &AppHandle, library_id: &str, wrapped: &WrappedKey) {
    if let Ok(mut keys) = app.state::<ConfigVaultState>().unlocked.lock() {
        if let Some(unlocked) = keys.get_mut(library_id) {
            unlocked.wrapped = wrapped.clone();
        }
    }
    let mut file = read_file(app, library_id);
    if let Some(session) = file.session.as_mut() {
        session.wrapped = wrapped.clone();
        let _ = write_file(app, library_id, &file);
    }
}

/// Signs out: the key leaves memory and the remembered session is deleted.
/// Remembered credentials stay, as «Recordar datos» asked.
pub(crate) fn lock(app: &AppHandle, library_id: &str) {
    if let Ok(mut keys) = app.state::<ConfigVaultState>().unlocked.lock() {
        keys.remove(library_id);
    }
    forget_session(app, library_id);
    crate::library_config::config_changed();
}

// ---------- Remembered on this device ----------

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberedFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session: Option<RememberedSession>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    credentials: Option<RememberedCredentials>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberedSession {
    /// The data key sealed by `device_secret`, in base64.
    key: String,
    wrapped: WrappedKey,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberedCredentials {
    username: String,
    /// The password sealed by `device_secret`, in base64.
    password: String,
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode(text: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::STANDARD.decode(text).ok()
}

fn file_path(app: &AppHandle, library_id: &str) -> Option<PathBuf> {
    let key = library_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
    if key.is_empty() {
        return None;
    }
    app.path().app_data_dir().ok().map(|directory| directory.join(DIRECTORY).join(format!("{key}.json")))
}

fn read_file(app: &AppHandle, library_id: &str) -> RememberedFile {
    file_path(app, library_id)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_file(app: &AppHandle, library_id: &str, file: &RememberedFile) -> Result<(), BackendError> {
    let storage = || BackendError::new(BackendErrorCode::Storage, "No se pudo guardar el inicio de sesión en este equipo.", true);
    let path = file_path(app, library_id).ok_or_else(storage)?;
    if file.session.is_none() && file.credentials.is_none() {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| storage())?;
    }
    let text = serde_json::to_string(file).map_err(|_| storage())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(|_| storage())?;
    std::fs::rename(&temporary, &path).map_err(|_| storage())
}

/// «Recordar sesión»: the library opens on this device without signing in.
pub(crate) fn remember_session(app: &AppHandle, library_id: &str, unlocked: &Unlocked) -> Result<(), BackendError> {
    let mut file = read_file(app, library_id);
    file.session = Some(RememberedSession {
        key: encode(&crate::device_secret::protect(unlocked.key.bytes())?),
        wrapped: unlocked.wrapped.clone(),
    });
    write_file(app, library_id, &file)
}

pub(crate) fn forget_session(app: &AppHandle, library_id: &str) {
    let mut file = read_file(app, library_id);
    if file.session.take().is_some() {
        let _ = write_file(app, library_id, &file);
    }
}

/// «Recordar datos»: fills the Owner's user name and password next time.
pub(crate) fn remember_credentials(app: &AppHandle, library_id: &str, username: &str, password: &str) -> Result<(), BackendError> {
    let mut file = read_file(app, library_id);
    file.credentials = Some(RememberedCredentials {
        username: username.to_string(),
        password: encode(&crate::device_secret::protect(password.as_bytes())?),
    });
    write_file(app, library_id, &file)
}

pub(crate) fn forget_credentials(app: &AppHandle, library_id: &str) {
    let mut file = read_file(app, library_id);
    if file.credentials.take().is_some() {
        let _ = write_file(app, library_id, &file);
    }
}

/// The remembered user name and password, when they can be opened here.
pub(crate) fn remembered_credentials(app: &AppHandle, library_id: &str) -> Option<(String, String)> {
    let credentials = read_file(app, library_id).credentials?;
    let password = String::from_utf8(crate::device_secret::unprotect(&decode(&credentials.password)?)?).ok()?;
    Some((credentials.username, password))
}

/// Whether a session is remembered for the library on this device.
pub(crate) fn has_remembered_session(app: &AppHandle, library_id: &str) -> bool {
    read_file(app, library_id).session.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_remembered_file_keeps_only_what_was_asked() {
        let file = RememberedFile {
            session: None,
            credentials: Some(RememberedCredentials { username: "Owner".into(), password: "c2VsbGFkYQ==".into() }),
        };
        let text = serde_json::to_string(&file).expect("json");
        assert!(!text.contains("session") && text.contains("\"username\":\"Owner\""));
        let read = serde_json::from_str::<RememberedFile>(&text).expect("read");
        assert!(read.session.is_none() && read.credentials.is_some());
        assert!(serde_json::from_str::<RememberedFile>("{}").expect("empty").credentials.is_none());
    }
}
