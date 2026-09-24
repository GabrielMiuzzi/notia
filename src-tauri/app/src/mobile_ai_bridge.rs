#[cfg(target_os = "android")]
use crate::mobile_continuity::ContinuityState;
#[cfg(target_os = "android")]
use crate::mobile_continuity::{begin_android_work, end_android_work};
use crate::notia_timer::NotiaTimer;
#[cfg(target_os = "android")]
use serde::Deserialize;
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use crate::host::plugin::PluginHandle;
use crate::host::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Wry,
};

pub struct AndroidAiBridgeState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
    #[cfg(target_os = "android")]
    streams: AndroidStreamRouter,
}

/// Event of a backend-owned Android stream.
#[cfg(target_os = "android")]
pub(crate) enum AndroidStreamEvent {
    Thinking(String),
    Content(String),
    Done(Result<serde_json::Value, String>),
}

/// Maximum concurrent backend streams routed through the bridge channel.
#[cfg(target_os = "android")]
const MAX_ANDROID_STREAMS: usize = 16;

/// Routes stream deltas from one app-wide IPC channel to the waiting request.
/// Tauri never unregisters mobile channels, so a single long-lived channel is
/// used instead of one per request; routes are removed when a stream ends.
#[cfg(target_os = "android")]
#[derive(Default)]
struct AndroidStreamRouter {
    routes: std::sync::Arc<Mutex<std::collections::HashMap<String, std::sync::mpsc::Sender<AndroidStreamEvent>>>>,
    channel: std::sync::OnceLock<crate::host::ipc::Channel<serde_json::Value>>,
}

#[cfg(target_os = "android")]
impl AndroidStreamRouter {
    fn channel(&self) -> crate::host::ipc::Channel<serde_json::Value> {
        self.channel
            .get_or_init(|| {
                let routes = std::sync::Arc::clone(&self.routes);
                crate::host::ipc::Channel::new(move |body| {
                    let crate::host::ipc::InvokeResponseBody::Json(text) = body else {
                        return Ok(());
                    };
                    let Ok(message) = serde_json::from_str::<serde_json::Value>(&text) else {
                        return Ok(());
                    };
                    let request_id = message.get("requestId").and_then(serde_json::Value::as_str);
                    let delta = message
                        .get("delta")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string);
                    let (Some(request_id), Some(delta)) = (request_id, delta) else {
                        return Ok(());
                    };
                    let event = match message.get("type").and_then(serde_json::Value::as_str) {
                        Some("thinking") => AndroidStreamEvent::Thinking(delta),
                        Some("content") => AndroidStreamEvent::Content(delta),
                        _ => return Ok(()),
                    };
                    if let Some(sender) = routes.lock().ok().and_then(|routes| routes.get(request_id).cloned()) {
                        let _ = sender.send(event);
                    }
                    Ok(())
                })
            })
            .clone()
    }
}

impl AndroidAiBridgeState {
    #[cfg(target_os = "android")]
    fn with_handle(handle: PluginHandle<Wry>) -> Self {
        Self {
            handle: Mutex::new(Some(handle)),
            streams: AndroidStreamRouter::default(),
        }
    }

    #[cfg(target_os = "android")]
    fn unavailable() -> Self {
        Self {
            handle: Mutex::new(None),
            streams: AndroidStreamRouter::default(),
        }
    }

    #[cfg(not(target_os = "android"))]
    fn empty() -> Self {
        Self {}
    }
}

/// Invokes one AI bridge command for the backend runtime. The plugin handle
/// is cloned out of the state lock before the blocking HTTP call, so
/// concurrent requests never wait on each other's network I/O.
#[cfg(target_os = "android")]
pub(crate) fn call_android_ai_plugin(
    app: &crate::host::AppHandle,
    command: &str,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let handle = app
        .try_state::<AndroidAiBridgeState>()
        .ok_or_else(|| "El bridge AI de Android no esta disponible.".to_string())?
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?
        .clone()
        .ok_or_else(|| "El bridge AI de Android no esta disponible.".to_string())?;
    let continuity = app.try_state::<ContinuityState>();
    let continuity_started = continuity
        .as_ref()
        .is_some_and(|state| begin_android_work(state.inner(), Some("dataSync")));
    let result = handle
        .run_mobile_plugin::<serde_json::Value>(command, payload)
        .map_err(|error| format!("No se pudo ejecutar la IA en Android: {error}"));
    if continuity_started {
        if let Some(state) = continuity.as_ref() {
            end_android_work(state.inner());
        }
    }
    result
}

/// Runs a raw `/api/chat` stream for the backend runtime. Deltas and the
/// final result arrive on `events`; the route is removed when the call ends.
#[cfg(target_os = "android")]
pub(crate) fn stream_android_raw_chat(
    app: &crate::host::AppHandle,
    request_id: &str,
    mut payload: serde_json::Value,
    events: std::sync::mpsc::Sender<AndroidStreamEvent>,
) {
    let state = match app.try_state::<AndroidAiBridgeState>() {
        Some(state) => state,
        None => {
            let _ = events.send(AndroidStreamEvent::Done(Err(
                "El bridge AI de Android no esta disponible.".to_string(),
            )));
            return;
        }
    };
    let registered = state.streams.routes.lock().ok().is_some_and(|mut routes| {
        if routes.len() >= MAX_ANDROID_STREAMS {
            return false;
        }
        routes.insert(request_id.to_string(), events.clone());
        true
    });
    if !registered {
        let _ = events.send(AndroidStreamEvent::Done(Err(
            "Hay demasiadas respuestas de IA en curso en Android.".to_string(),
        )));
        return;
    }
    if let Some(object) = payload.as_object_mut() {
        object.insert("requestId".to_string(), serde_json::Value::String(request_id.to_string()));
        object.insert(
            "onEvent".to_string(),
            serde_json::to_value(state.streams.channel()).unwrap_or(serde_json::Value::Null),
        );
    }
    let result = call_android_ai_plugin(app, "rawChatStreaming", payload);
    if let Ok(mut routes) = state.streams.routes.lock() {
        routes.remove(request_id);
    }
    let _ = events.send(AndroidStreamEvent::Done(result));
}

/// Disconnects a backend stream started with `stream_android_raw_chat`.
#[cfg(target_os = "android")]
pub(crate) fn cancel_android_raw_chat(app: &crate::host::AppHandle, request_id: &str) {
    let _ = call_android_ai_plugin(
        app,
        "cancelStreaming",
        serde_json::json!({ "requestId": request_id }),
    );
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-ai")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                match api.register_android_plugin("com.gabriel.notia", "AiBridgePlugin") {
                    Ok(handle) => {
                        app.manage(AndroidAiBridgeState::with_handle(handle));
                    }
                    Err(error) => {
                        log::error!(
                            "[notia:ai_bridge] Android plugin not available, continuing without AI bridge: {error}"
                        );
                        app.manage(AndroidAiBridgeState::unavailable());
                    }
                }
            }

            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(AndroidAiBridgeState::empty());
            }

            Ok(())
        })
        .build()
}
