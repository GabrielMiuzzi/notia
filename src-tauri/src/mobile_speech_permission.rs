use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Wry,
};

#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use tauri::plugin::{PermissionState, PluginHandle};

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
