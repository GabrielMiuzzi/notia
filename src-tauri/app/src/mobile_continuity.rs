use crate::host::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Wry,
};

#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use crate::host::plugin::PluginHandle;

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

/// Opens an https address in the device's browser.
#[cfg(target_os = "android")]
pub fn open_android_url(state: &ContinuityState, url: &str) -> Result<(), String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo abrir el navegador.".to_string())?;
    let handle = guard.as_ref().ok_or_else(|| "No se pudo abrir el navegador.".to_string())?;
    let response = handle
        .run_mobile_plugin::<ContinuityResponse>("openUrl", serde_json::json!({ "url": url }))
        .map_err(|_| "No se pudo abrir el navegador.".to_string())?;
    if response.ok {
        Ok(())
    } else {
        Err(response.error.unwrap_or_else(|| "No se pudo abrir el navegador.".to_string()))
    }
}

/// Copies a secret marked as sensitive; Android clears it after
/// `clear_after_ms` if the clipboard still holds it.
#[cfg(target_os = "android")]
pub fn copy_android_secret(state: &ContinuityState, text: &str, clear_after_ms: u64) -> Result<(), String> {
    let failed = || "No se pudo copiar al portapapeles.".to_string();
    let guard = state.handle.lock().map_err(|_| failed())?;
    let handle = guard.as_ref().ok_or_else(failed)?;
    let response = handle
        .run_mobile_plugin::<ContinuityResponse>(
            "copySecret",
            serde_json::json!({ "text": text, "clearAfterMs": clear_after_ms }),
        )
        .map_err(|_| failed())?;
    if response.ok {
        Ok(())
    } else {
        Err(response.error.unwrap_or_else(failed))
    }
}

#[cfg(not(target_os = "android"))]
pub fn begin_android_work(_state: &ContinuityState, _work_kind: Option<&str>) -> bool {
    true
}

#[cfg(not(target_os = "android"))]
pub fn end_android_work(_state: &ContinuityState) -> bool {
    true
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
