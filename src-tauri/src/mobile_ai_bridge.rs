use crate::notia_timer::NotiaTimer;
#[cfg(target_os = "android")]
use crate::services::ai_service::contains_sensitive_web_query_data;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Emitter, Manager, State, Wry,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamEventPayload {
    pub request_id: String,
    #[serde(flatten)]
    pub event: AiStreamEvent,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type", content = "payload")]
pub enum AiStreamEvent {
    Thinking { delta: String },
    Delta { delta: String },
    Done { answer: String },
    Error { message: String },
}

pub struct AndroidAiBridgeState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAndroidAiChatStreamingPayload {
    pub request_id: String,
    pub ollama_url: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub think: serde_json::Value,
    pub prompt: String,
    #[serde(default)]
    pub previous_messages: Vec<AiMessagePayload>,
    #[serde(default)]
    pub long_term_memories: Vec<String>,
    #[serde(default)]
    pub files: Vec<AiInlineFilePayload>,
    #[serde(default)]
    pub image: Option<AiImagePayload>,
    #[serde(default)]
    pub selected_context_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAndroidAiChatStreamingPayload {
    pub request_id: String,
}

impl AndroidAiBridgeState {
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiMessagePayload {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    images: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiInlineFilePayload {
    path: String,
    name: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiImagePayload {
    name: String,
    mime_type: String,
    base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAndroidAiHealthPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAndroidAiChatPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    model: String,
    #[serde(default)]
    think: serde_json::Value,
    prompt: String,
    #[serde(default)]
    previous_messages: Vec<AiMessagePayload>,
    #[serde(default)]
    long_term_memories: Vec<String>,
    #[serde(default)]
    files: Vec<AiInlineFilePayload>,
    #[serde(default)]
    image: Option<AiImagePayload>,
    #[serde(default)]
    selected_context_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAndroidAiToolChatPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    model: String,
    #[serde(default)]
    think: serde_json::Value,
    messages: serde_json::Value,
    tools: serde_json::Value,
    #[serde(default)]
    timeout_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAndroidAiWebSearchPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    query: String,
    #[serde(default = "default_android_web_search_max_results")]
    max_results: u32,
}

fn default_android_web_search_max_results() -> u32 {
    5
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidAiHealthResponse {
    ok: bool,
    message: Option<String>,
    default_model: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidAiChatResponse {
    answer: Option<String>,
    error: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidAiModelListResponse {
    models: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidAiHealthResult {
    ok: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidAiChatResult {
    answer: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidAiModelListResult {
    pub models: Vec<String>,
}

#[tauri::command]
pub fn check_android_ai_health(
    state: State<'_, AndroidAiBridgeState>,
    payload: CheckAndroidAiHealthPayload,
) -> Result<AndroidAiHealthResult, String> {
    #[cfg(target_os = "android")]
    {
        let _timer =
            NotiaTimer::new("check_android_ai_health").with_meta("endpoint_configured=true");
        if payload.ollama_url.trim().is_empty() {
            return Err("La URL de Ollama es obligatoria.".to_string());
        }

        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };

        let response = handle
            .run_mobile_plugin::<AndroidAiHealthResponse>(
                "healthCheck",
                serde_json::json!({
                    "ollamaUrl": payload.ollama_url,
                    "apiKey": payload.api_key,
                }),
            )
            .map_err(|error| format!("No se pudo verificar Ollama en Android: {error}"))?;

        return Ok(AndroidAiHealthResult {
            ok: response.ok,
            message: response
                .message
                .unwrap_or_else(|| "No se pudo conectar con la IA.".to_string()),
            default_model: response.default_model,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let CheckAndroidAiHealthPayload {
            ollama_url,
            api_key,
        } = payload;
        let _ = (ollama_url, api_key);
        Err("La verificacion AI Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub fn run_android_ai_chat(
    state: State<'_, AndroidAiBridgeState>,
    payload: RunAndroidAiChatPayload,
) -> Result<AndroidAiChatResult, String> {
    #[cfg(target_os = "android")]
    {
        let _timer =
            NotiaTimer::new("run_android_ai_chat").with_meta(format!("model={}", payload.model));
        if payload.ollama_url.trim().is_empty() {
            return Err("La URL de Ollama es obligatoria.".to_string());
        }
        if payload.model.trim().is_empty() {
            return Err("El modelo de Ollama es obligatorio.".to_string());
        }
        if payload.prompt.trim().is_empty() {
            return Err("No hay prompt para enviar a la IA.".to_string());
        }

        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };

        let response = handle
            .run_mobile_plugin::<AndroidAiChatResponse>(
                "chat",
                serde_json::json!({
                    "ollamaUrl": payload.ollama_url,
                    "apiKey": payload.api_key,
                    "model": payload.model,
                    "think": payload.think,
                    "prompt": payload.prompt,
                    "previousMessages": payload.previous_messages,
                    "longTermMemories": payload.long_term_memories,
                    "files": payload.files,
                    "image": payload.image,
                    "selectedContextMode": payload.selected_context_mode,
                }),
            )
            .map_err(|error| format!("No se pudo ejecutar el chat AI en Android: {error}"))?;

        if let Some(error_message) = response.error.filter(|value| !value.trim().is_empty()) {
            return Err(error_message);
        }

        let answer = response
            .answer
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "La IA no devolvio contenido.".to_string())?;

        return Ok(AndroidAiChatResult { answer });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let RunAndroidAiChatPayload {
            ollama_url,
            api_key,
            model,
            think,
            prompt,
            previous_messages,
            long_term_memories,
            files,
            image,
            selected_context_mode,
        } = payload;
        let _ = (
            ollama_url,
            api_key,
            model,
            think,
            prompt,
            previous_messages,
            long_term_memories,
            files,
            image,
            selected_context_mode,
        );
        Err("El chat AI Android solo esta disponible en Android.".to_string())
    }
}

fn emit_ai_stream_event(window: &tauri::Window, request_id: &str, event: AiStreamEvent) {
    let payload = AiStreamEventPayload {
        request_id: request_id.to_string(),
        event,
    };
    let _ = window.emit("notia-ai-chat-stream", payload);
}

#[tauri::command]
pub async fn run_android_ai_chat_streaming(
    window: tauri::Window,
    state: State<'_, AndroidAiBridgeState>,
    payload: RunAndroidAiChatStreamingPayload,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _timer = NotiaTimer::new("run_android_ai_chat_streaming")
            .with_meta(format!("model={}", payload.model));
        let request_id = payload.request_id.clone();

        if payload.ollama_url.trim().is_empty() {
            emit_ai_stream_event(
                &window,
                &request_id,
                AiStreamEvent::Error {
                    message: "La URL de Ollama es obligatoria.".to_string(),
                },
            );
            return Err("La URL de Ollama es obligatoria.".to_string());
        }
        if payload.model.trim().is_empty() {
            emit_ai_stream_event(
                &window,
                &request_id,
                AiStreamEvent::Error {
                    message: "El modelo de Ollama es obligatorio.".to_string(),
                },
            );
            return Err("El modelo de Ollama es obligatorio.".to_string());
        }
        if payload.prompt.trim().is_empty() {
            emit_ai_stream_event(
                &window,
                &request_id,
                AiStreamEvent::Error {
                    message: "No hay prompt para enviar a la IA.".to_string(),
                },
            );
            return Err("No hay prompt para enviar a la IA.".to_string());
        }

        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            emit_ai_stream_event(
                &window,
                &request_id,
                AiStreamEvent::Error {
                    message: "El bridge AI de Android no esta disponible.".to_string(),
                },
            );
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };

        let response = handle
            .run_mobile_plugin::<AndroidAiChatResponse>(
                "chatStreaming",
                serde_json::json!({
                    "requestId": payload.request_id,
                    "ollamaUrl": payload.ollama_url,
                    "apiKey": payload.api_key,
                    "model": payload.model,
                    "think": payload.think,
                    "prompt": payload.prompt,
                    "previousMessages": payload.previous_messages,
                    "longTermMemories": payload.long_term_memories,
                    "files": payload.files,
                    "image": payload.image,
                    "selectedContextMode": payload.selected_context_mode,
                }),
            )
            .map_err(|error| {
                emit_ai_stream_event(
                    &window,
                    &request_id,
                    AiStreamEvent::Error {
                        message: format!("No se pudo iniciar el streaming: {error}"),
                    },
                );
                format!("No se pudo iniciar el streaming en Android: {error}")
            })?;

        if let Some(error_message) = response.error.filter(|value| !value.trim().is_empty()) {
            emit_ai_stream_event(
                &window,
                &request_id,
                AiStreamEvent::Error {
                    message: error_message.clone(),
                },
            );
            return Err(error_message);
        }

        let answer = response.answer.unwrap_or_default().trim().to_string();
        emit_ai_stream_event(&window, &request_id, AiStreamEvent::Done { answer });
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = window;
        let _ = state;
        let RunAndroidAiChatStreamingPayload {
            request_id,
            ollama_url,
            api_key,
            model,
            think,
            prompt,
            previous_messages,
            long_term_memories,
            files,
            image,
            selected_context_mode,
        } = payload;
        let _ = (
            request_id,
            ollama_url,
            api_key,
            model,
            think,
            prompt,
            previous_messages,
            long_term_memories,
            files,
            image,
            selected_context_mode,
        );
        Err("El streaming AI Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub fn cancel_android_ai_chat_streaming(
    state: State<'_, AndroidAiBridgeState>,
    payload: CancelAndroidAiChatStreamingPayload,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let request_id = payload.request_id.trim();
        if request_id.is_empty() {
            return Err("El identificador de streaming es obligatorio.".to_string());
        }
        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };
        handle
            .run_mobile_plugin::<serde_json::Value>(
                "cancelStreaming",
                serde_json::json!({ "requestId": request_id }),
            )
            .map_err(|error| format!("No se pudo cancelar el streaming en Android: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (state, payload);
        Err("La cancelacion del streaming AI Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub fn list_android_ai_models(
    state: State<'_, AndroidAiBridgeState>,
    payload: CheckAndroidAiHealthPayload,
) -> Result<AndroidAiModelListResult, String> {
    #[cfg(target_os = "android")]
    {
        let _timer =
            NotiaTimer::new("list_android_ai_models").with_meta("endpoint_configured=true");
        if payload.ollama_url.trim().is_empty() {
            return Err("La URL de Ollama es obligatoria.".to_string());
        }

        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };

        let response = handle
            .run_mobile_plugin::<AndroidAiModelListResponse>(
                "listModels",
                serde_json::json!({
                    "ollamaUrl": payload.ollama_url,
                    "apiKey": payload.api_key,
                }),
            )
            .map_err(|error| format!("No se pudieron listar los modelos en Android: {error}"))?;

        return Ok(AndroidAiModelListResult {
            models: response.models.unwrap_or_default(),
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let CheckAndroidAiHealthPayload {
            ollama_url,
            api_key,
        } = payload;
        let _ = (ollama_url, api_key);
        Err("El listado de modelos AI Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub fn run_android_ai_tool_chat(
    state: State<'_, AndroidAiBridgeState>,
    payload: RunAndroidAiToolChatPayload,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let _timer = NotiaTimer::new("run_android_ai_tool_chat")
            .with_meta(format!("model={}", payload.model));
        let timeout_seconds = payload.timeout_seconds.unwrap_or(600);
        if !(1..=600).contains(&timeout_seconds) {
            return Err(
                "El tiempo de espera de herramientas debe estar entre 1 y 600 segundos."
                    .to_string(),
            );
        }

        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };

        return handle
            .run_mobile_plugin::<serde_json::Value>(
                "toolChat",
                serde_json::json!({
                    "ollamaUrl": payload.ollama_url,
                    "apiKey": payload.api_key,
                    "model": payload.model,
                    "think": payload.think,
                    "messagesJson": payload.messages.to_string(),
                    "toolsJson": payload.tools.to_string(),
                    "timeoutSeconds": timeout_seconds,
                }),
            )
            .map_err(|error| {
                format!("No se pudo ejecutar la ronda de herramientas en Android: {error}")
            });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (state, payload);
        Err("La ronda de herramientas de Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub fn run_android_ai_web_search(
    state: State<'_, AndroidAiBridgeState>,
    payload: RunAndroidAiWebSearchPayload,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let query = payload.query.trim();
        if contains_sensitive_web_query_data(query) {
            return Err(
                "La busqueda web fue bloqueada porque la consulta no es publica y segura."
                    .to_string(),
            );
        }
        let max_results = payload.max_results.clamp(1, 10);
        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al bridge AI de Android.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El bridge AI de Android no esta disponible.".to_string());
        };
        return handle
            .run_mobile_plugin::<serde_json::Value>(
                "webSearch",
                serde_json::json!({
                    "ollamaUrl": payload.ollama_url,
                    "apiKey": payload.api_key,
                    "query": query,
                    "maxResults": max_results,
                }),
            )
            .map_err(|error| format!("No se pudo completar la busqueda web en Android: {error}"));
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (state, payload);
        Err("La busqueda web Android solo esta disponible en Android.".to_string())
    }
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

#[cfg(test)]
mod tests {
    use super::{
        AiStreamEvent, AiStreamEventPayload, AndroidAiModelListResult,
        CancelAndroidAiChatStreamingPayload, CheckAndroidAiHealthPayload, RunAndroidAiChatPayload,
        RunAndroidAiChatStreamingPayload, RunAndroidAiToolChatPayload,
        RunAndroidAiWebSearchPayload,
    };

    #[test]
    fn android_chat_fixture_accepts_shared_camel_case_contract() {
        let payload: RunAndroidAiChatPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "model": "qwen3:test",
            "prompt": "consulta",
            "previousMessages": [],
            "longTermMemories": [],
            "files": [],
            "selectedContextMode": "direct",
        }))
        .expect("android chat payload should deserialize");

        assert_eq!(payload.model, "qwen3:test");
        assert_eq!(payload.selected_context_mode, "direct");
    }

    #[test]
    fn android_health_fixture_accepts_default_credential_field() {
        let payload: CheckAndroidAiHealthPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
        }))
        .expect("android health payload should deserialize");

        assert_eq!(payload.ollama_url, "https://ollama.com");
        assert!(payload.api_key.is_empty());
    }

    #[test]
    fn android_tool_and_web_fixtures_keep_optional_limits() {
        let tool_payload: RunAndroidAiToolChatPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "model": "qwen3:test",
            "messages": [],
            "tools": [],
        }))
        .expect("android tool payload should deserialize");
        let web_payload: RunAndroidAiWebSearchPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "query": "public Rust release notes",
        }))
        .expect("android web search payload should deserialize");

        assert!(tool_payload.timeout_seconds.is_none());
        assert_eq!(web_payload.max_results, 5);
    }

    #[test]
    fn android_stream_event_fixture_preserves_request_correlation() {
        let event = AiStreamEventPayload {
            request_id: "request-1".to_string(),
            event: AiStreamEvent::Delta {
                delta: "respuesta".to_string(),
            },
        };
        let serialized = serde_json::to_value(event).expect("stream event should serialize");

        assert_eq!(serialized["requestId"], "request-1");
        assert_eq!(serialized["type"], "delta");
        assert_eq!(serialized["payload"]["delta"], "respuesta");
    }

    #[test]
    fn android_streaming_and_cancel_fixtures_cover_shared_multimodal_fields() {
        let payload: RunAndroidAiChatStreamingPayload = serde_json::from_value(serde_json::json!({
            "requestId": "request-1",
            "ollamaUrl": "https://ollama.com",
            "model": "qwen3:test",
            "prompt": "consulta",
            "previousMessages": [{ "role": "user", "content": "anterior", "images": ["base64"] }],
            "longTermMemories": ["preferencia"],
            "files": [{ "path": "docs/a.md", "name": "a.md", "content": "texto" }],
            "image": { "name": "foto.jpg", "mimeType": "image/jpeg", "base64": "base64" },
            "selectedContextMode": "index",
        }))
        .expect("android streaming payload should deserialize");
        let cancel: CancelAndroidAiChatStreamingPayload =
            serde_json::from_value(serde_json::json!({
                "requestId": "request-1",
            }))
            .expect("android cancel payload should deserialize");

        assert_eq!(payload.request_id, "request-1");
        assert_eq!(payload.previous_messages.len(), 1);
        assert_eq!(payload.files[0].path, "docs/a.md");
        assert_eq!(
            payload.image.as_ref().map(|image| image.mime_type.as_str()),
            Some("image/jpeg")
        );
        assert_eq!(payload.selected_context_mode, "index");
        assert_eq!(cancel.request_id, "request-1");
    }

    #[test]
    fn android_model_result_and_stream_events_are_serializable_contracts() {
        let models = serde_json::to_value(AndroidAiModelListResult {
            models: vec!["qwen3:test".to_string()],
        })
        .expect("android model list should serialize");
        assert_eq!(models["models"][0], "qwen3:test");

        let events = [
            AiStreamEvent::Thinking {
                delta: "pensando".to_string(),
            },
            AiStreamEvent::Delta {
                delta: "respuesta".to_string(),
            },
            AiStreamEvent::Done {
                answer: "final".to_string(),
            },
            AiStreamEvent::Error {
                message: "fallo".to_string(),
            },
        ];
        let serialized: Vec<serde_json::Value> = events
            .into_iter()
            .map(|event| {
                serde_json::to_value(AiStreamEventPayload {
                    request_id: "request-1".to_string(),
                    event,
                })
                .expect("android event should serialize")
            })
            .collect();

        assert_eq!(
            serialized
                .iter()
                .map(|event| event["type"].as_str())
                .collect::<Vec<_>>(),
            vec![Some("thinking"), Some("delta"), Some("done"), Some("error"),]
        );
    }
}
