//! Preferences of this device (publication server, voice models) stored by
//! the backend in the app data directory, so backend services read them
//! without the WebView. The rules live in `backend_core::device_preferences`.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::backend::device_preferences::normalize_device_preferences;
use crate::backend::{BackendError, BackendErrorCode};

const FILE: &str = "device-preferences.json";
const MAX_BYTES: u64 = 256 * 1024;

#[derive(Default)]
pub(crate) struct DevicePreferencesState {
    lock: Mutex<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DevicePreferences {
    /// `false` until the preferences were saved once; the client may then
    /// migrate the copy older versions kept in the WebView.
    initialized: bool,
    preferences: Value,
}

fn storage() -> BackendError {
    BackendError::new(BackendErrorCode::Storage, "No se pudieron guardar las preferencias del dispositivo.", true)
}

fn file(app: &AppHandle) -> Result<PathBuf, BackendError> {
    app.path().app_data_dir().map(|directory| directory.join(FILE)).map_err(|_| storage())
}

fn read(app: &AppHandle) -> Option<Value> {
    let path = file(app).ok()?;
    if std::fs::metadata(&path).ok()?.len() > MAX_BYTES {
        return None;
    }
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Normalized preferences of one section (`taskManagerPublication`,
/// `qwen3Asr`, `qwen3Tts`); defaults when nothing was saved.
pub(crate) fn section(app: &AppHandle, key: &str) -> Value {
    normalize_device_preferences(&read(app).unwrap_or(Value::Null))[key].clone()
}

#[tauri::command]
pub(crate) fn backend_device_preferences(app: AppHandle) -> DevicePreferences {
    let stored = read(&app);
    DevicePreferences {
        initialized: stored.is_some(),
        preferences: normalize_device_preferences(&stored.unwrap_or(Value::Null)),
    }
}

#[tauri::command]
pub(crate) fn backend_save_device_preferences(app: AppHandle, preferences: Value) -> Result<Value, BackendError> {
    let state = app.state::<DevicePreferencesState>();
    let _guard = state.lock.lock().map_err(|_| storage())?;
    // Sections not sent keep their stored value.
    let mut merged = read(&app).filter(Value::is_object).unwrap_or_else(|| Value::Object(Default::default()));
    if let (Some(target), Some(source)) = (merged.as_object_mut(), preferences.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    let normalized = normalize_device_preferences(&merged);
    let path = file(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| storage())?;
    }
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_string_pretty(&normalized).map_err(|_| storage())?).map_err(|_| storage())?;
    std::fs::rename(&temporary, &path).map_err(|_| storage())?;
    Ok(normalized)
}
