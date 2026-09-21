use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Wry,
};

#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

/// Rust-side handle for the Android foreground continuity plugin.
///
/// The WebView starts/ends "work" around long operations (speech capture,
/// AI requests, Telegram processing) so the OS keeps the process alive while
/// the activity is hidden. Failures degrade gracefully: continuity is a best
/// effort guarantee, never a blocker for the operation itself.
pub struct ContinuityState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
}

impl ContinuityState {
    #[cfg(target_os = "android")]
    fn with_handle(handle: PluginHandle<Wry>) -> Self {
        Self {
            handle: Mutex::new(Some(handle)),
        }
    }

    #[cfg(target_os = "android")]
    fn unavailable() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }

    #[cfg(not(target_os = "android"))]
    fn empty() -> Self {
        Self {}
    }
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContinuityResponse {
    ok: bool,
    #[serde(default)]
    active_work: Option<i64>,
    #[serde(default)]
    error: Option<String>,
}

/// Declares a long operation to Android. `work_kind` is `microphone` for
/// speech capture or `dataSync` for network/AI work.
#[cfg(target_os = "android")]
fn run_continuity(
    state: &ContinuityState,
    command: &str,
    work_kind: Option<&str>,
) -> Result<bool, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al servicio de continuidad.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Ok(false);
    };
    let payload = serde_json::json!({ "workKind": work_kind.unwrap_or("dataSync") });
    let response = handle
        .run_mobile_plugin::<ContinuityResponse>(command, payload)
        .map_err(|error| {
            format!("No se pudo gestionar la continuidad en segundo plano: {error}")
        })?;
    if !response.ok {
        log::warn!(
            "[notia:continuity] {} reported an error: {}",
            command,
            response.error.unwrap_or_else(|| "sin detalle".to_string())
        );
    }
    Ok(response.ok)
}

#[cfg(target_os = "android")]
pub fn begin_android_work(state: &ContinuityState, work_kind: Option<&str>) -> bool {
    run_continuity(state, "beginWork", work_kind).unwrap_or(false)
}

#[cfg(target_os = "android")]
pub fn end_android_work(state: &ContinuityState) -> bool {
    run_continuity(state, "endWork", None).unwrap_or(false)
}

#[cfg(target_os = "android")]
pub fn is_android_work_active(state: &ContinuityState) -> bool {
    let guard = match state.handle.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    let Some(handle) = guard.as_ref() else {
        return false;
    };
    let Ok(response) =
        handle.run_mobile_plugin::<ContinuityResponse>("workStatus", serde_json::json!({}))
    else {
        return false;
    };
    response.active_work.unwrap_or(0) > 0
}

#[cfg(not(target_os = "android"))]
pub fn begin_android_work(_state: &ContinuityState, _work_kind: Option<&str>) -> bool {
    true
}

#[cfg(not(target_os = "android"))]
pub fn end_android_work(_state: &ContinuityState) -> bool {
    true
}

#[cfg(not(target_os = "android"))]
pub fn is_android_work_active(_state: &ContinuityState) -> bool {
    false
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-continuity")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                match api.register_android_plugin("com.gabriel.notia", "ContinuityPlugin") {
                    Ok(handle) => {
                        app.manage(ContinuityState {
                            handle: Mutex::new(Some(handle)),
                        });
                    }
                    Err(error) => {
                        log::error!("[notia:continuity] Android plugin unavailable: {error}");
                        app.manage(ContinuityState::unavailable());
                    }
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
                app.manage(ContinuityState::empty());
            }
            Ok(())
        })
        .build()
}
