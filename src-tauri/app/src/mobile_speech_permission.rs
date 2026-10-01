use crate::host::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Wry,
};

#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use crate::host::plugin::{PermissionState, PluginHandle};

pub struct AndroidSpeechPermissionState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
}

impl AndroidSpeechPermissionState {
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
struct MicrophonePermissionResponse {
    microphone: PermissionState,
}

#[cfg(target_os = "android")]
fn permission_state(
    state: &AndroidSpeechPermissionState,
    command: &str,
) -> Result<PermissionState, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo consultar el permiso del microfono.".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "El permiso de microfono no esta disponible en Android.".to_string())?;
    handle
        .run_mobile_plugin::<MicrophonePermissionResponse>(command, ())
        .map(|response| response.microphone)
        .map_err(|error| format!("No se pudo gestionar el permiso del microfono: {error}"))
}

#[cfg(target_os = "android")]
pub fn check_microphone_permission(
    state: &AndroidSpeechPermissionState,
) -> Result<PermissionState, String> {
    permission_state(state, "checkPermissions")
}

#[cfg(target_os = "android")]
pub fn ensure_microphone_permission(state: &AndroidSpeechPermissionState) -> Result<(), String> {
    let current = check_microphone_permission(state)?;
    let resolved = match current {
        PermissionState::Granted => current,
        PermissionState::Prompt | PermissionState::PromptWithRationale => {
            permission_state(state, "requestPermissions")?
        }
        PermissionState::Denied => PermissionState::Denied,
    };
    if resolved == PermissionState::Granted {
        Ok(())
    } else {
        Err("Notia necesita permiso de microfono para transcribir audio offline.".to_string())
    }
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct ExtractAssetAnswer {
    ok: bool,
    #[serde(default)]
    bytes: u64,
}

/// Copies the speech model `asset` packed in the APK to `destination`,
/// inside the app's private data, and returns its size. Blocks until the
/// copy ends: a model is hundreds of megabytes.
#[cfg(target_os = "android")]
pub fn extract_asset(
    state: &AndroidSpeechPermissionState,
    asset: &str,
    destination: &std::path::Path,
) -> Result<u64, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudieron preparar los modelos de voz.".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "Los modelos de voz no están disponibles en este Android.".to_string())?;
    let answer = handle
        .run_mobile_plugin::<ExtractAssetAnswer>(
            "extractAsset",
            serde_json::json!({ "asset": asset, "destination": destination.to_string_lossy() }),
        )
        .map_err(|_| "No se pudo copiar un modelo de voz del paquete.".to_string())?;
    if answer.ok {
        Ok(answer.bytes)
    } else {
        Err("No se pudo copiar un modelo de voz del paquete. Revisá el espacio libre.".to_string())
    }
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-speech-permission")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                match api.register_android_plugin("com.gabriel.notia", "SpeechPermissionPlugin") {
                    Ok(handle) => app.manage(AndroidSpeechPermissionState::with_handle(handle)),
                    Err(error) => {
                        log::error!(
                            "[notia:speech_permission] Android plugin unavailable: {error}"
                        );
                        app.manage(AndroidSpeechPermissionState::unavailable())
                    }
                };
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(AndroidSpeechPermissionState::empty());
            }
            Ok(())
        })
        .build()
}
