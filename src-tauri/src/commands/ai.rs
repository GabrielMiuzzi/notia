use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::services::ai_service::AiHttpSettings;
use crate::services::ai_service::{
    AiChatMessage, AiChatResult, AiHealthResult, AiModelDetailsResult, AiModelListResult,
    AiWebSearchResponse,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckDesktopAiHealthPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDesktopAiChatPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    model: String,
    #[serde(default)]
    think: serde_json::Value,
    #[serde(default)]
    messages: Vec<AiChatMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDesktopAiChatStreamingPayload {
    request_id: String,
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    model: String,
    #[serde(default)]
    think: serde_json::Value,
    #[serde(default)]
    messages: Vec<AiChatMessage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDesktopAiToolChatPayload {
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopAiStreamEventPayload {
    request_id: String,
    #[serde(flatten)]
    event: DesktopAiStreamEvent,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "type", content = "payload")]
enum DesktopAiStreamEvent {
    Thinking { delta: String },
    Delta { delta: String },
    Done { answer: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDesktopAiModelsPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectDesktopAiModelPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDesktopAiWebSearchPayload {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    query: String,
    #[serde(default = "default_web_search_max_results")]
    max_results: u32,
}

fn default_web_search_max_results() -> u32 {
    5
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_ai_settings(ollama_url: String, api_key: String) -> AiHttpSettings {
    AiHttpSettings {
        ollama_url,
        api_key,
    }
}

#[tauri::command]
pub async fn check_desktop_ai_health(
    payload: CheckDesktopAiHealthPayload,
) -> Result<AiHealthResult, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        return crate::services::ai_service::check_ollama_health(&settings).await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let CheckDesktopAiHealthPayload {
            ollama_url,
            api_key,
        } = payload;
        let _ = (ollama_url, api_key);
        Err("La verificacion AI de desktop no esta disponible en esta plataforma.".to_string())
    }
}

#[tauri::command]
pub async fn run_desktop_ai_chat(payload: RunDesktopAiChatPayload) -> Result<AiChatResult, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        return crate::services::ai_service::run_ollama_chat(
            &settings,
            &payload.model,
            &payload.messages,
            &payload.think,
        )
        .await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let RunDesktopAiChatPayload {
            ollama_url,
            api_key,
            model,
            think,
            messages,
        } = payload;
        let _ = (ollama_url, api_key, model, think, messages);
        Err("El chat AI de desktop no esta disponible en esta plataforma.".to_string())
    }
}

#[tauri::command]
pub async fn run_desktop_ai_tool_chat(
    payload: RunDesktopAiToolChatPayload,
) -> Result<serde_json::Value, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let timeout_seconds = payload.timeout_seconds.unwrap_or(600);
        if !(1..=600).contains(&timeout_seconds) {
            return Err(
                "El tiempo de espera de herramientas debe estar entre 1 y 600 segundos."
                    .to_string(),
            );
        }
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        return crate::services::ai_service::run_ollama_tool_chat(
            &settings,
            &payload.model,
            &payload.messages,
            &payload.tools,
            &payload.think,
            timeout_seconds,
        )
        .await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = payload;
        Err(
            "El chat con herramientas de desktop no esta disponible en esta plataforma."
                .to_string(),
        )
    }
}

#[tauri::command]
pub async fn run_desktop_ai_chat_streaming(
    window: tauri::Window,
    payload: RunDesktopAiChatStreamingPayload,
) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        let request_id = payload.request_id;
        let event_window = window.clone();
        let event_request_id = request_id.clone();
        let answer = crate::services::ai_service::stream_ollama_chat(
            &settings,
            &payload.model,
            &payload.messages,
            &payload.think,
            move |delta| {
                let event = match delta {
                    crate::services::ai_service::AiChatStreamDelta::Thinking(delta) => {
                        DesktopAiStreamEvent::Thinking { delta }
                    }
                    crate::services::ai_service::AiChatStreamDelta::Content(delta) => {
                        DesktopAiStreamEvent::Delta { delta }
                    }
                };
                let _ = event_window.emit(
                    "notia-ai-chat-stream",
                    DesktopAiStreamEventPayload {
                        request_id: event_request_id.clone(),
                        event,
                    },
                );
                Ok(())
            },
        )
        .await?;
        let _ = window.emit(
            "notia-ai-chat-stream",
            DesktopAiStreamEventPayload {
                request_id,
                event: DesktopAiStreamEvent::Done { answer },
            },
        );
        return Ok(());
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = (window, payload);
        Err("El streaming AI de desktop no esta disponible en esta plataforma.".to_string())
    }
}

#[tauri::command]
pub async fn list_desktop_ai_models(
    payload: ListDesktopAiModelsPayload,
) -> Result<AiModelListResult, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        return crate::services::ai_service::list_ollama_models(&settings).await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let ListDesktopAiModelsPayload {
            ollama_url,
            api_key,
        } = payload;
        let _ = (ollama_url, api_key);
        Err("El listado AI de desktop no esta disponible en esta plataforma.".to_string())
    }
}

#[tauri::command]
pub async fn inspect_desktop_ai_model(
    payload: InspectDesktopAiModelPayload,
) -> Result<AiModelDetailsResult, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        return crate::services::ai_service::inspect_ollama_model(&settings, &payload.model).await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = payload;
        Err("La inspeccion AI de desktop no esta disponible en esta plataforma.".to_string())
    }
}

#[tauri::command]
pub async fn run_desktop_ai_web_search(
    payload: RunDesktopAiWebSearchPayload,
) -> Result<AiWebSearchResponse, String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let settings = build_ai_settings(payload.ollama_url, payload.api_key);
        return crate::services::ai_service::search_ollama_web(
            &settings,
            &payload.query,
            payload.max_results,
        )
        .await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = payload;
        Err("La busqueda web nativa de desktop no esta disponible en esta plataforma.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CheckDesktopAiHealthPayload, DesktopAiStreamEvent, DesktopAiStreamEventPayload,
        InspectDesktopAiModelPayload, ListDesktopAiModelsPayload, RunDesktopAiChatPayload,
        RunDesktopAiChatStreamingPayload, RunDesktopAiToolChatPayload,
        RunDesktopAiWebSearchPayload,
    };

    #[test]
    fn desktop_chat_fixture_accepts_camel_case_transport_fields() {
        let payload: RunDesktopAiChatStreamingPayload = serde_json::from_value(serde_json::json!({
            "requestId": "request-1",
            "ollamaUrl": "https://ollama.com",
            "apiKey": "fixture-key",
            "model": "qwen3:test",
            "think": "medium",
            "messages": [],
        }))
        .expect("streaming payload should deserialize");

        assert_eq!(payload.request_id, "request-1");
        assert_eq!(payload.ollama_url, "https://ollama.com");
        assert_eq!(payload.api_key, "fixture-key");
    }

    #[test]
    fn desktop_health_and_model_fixtures_accept_shared_fields() {
        let health: CheckDesktopAiHealthPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
        }))
        .expect("health payload should deserialize");
        let models: ListDesktopAiModelsPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
        }))
        .expect("models payload should deserialize");
        let inspect: InspectDesktopAiModelPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "model": "qwen3:test",
        }))
        .expect("inspect payload should deserialize");
        let chat: RunDesktopAiChatPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "model": "qwen3:test",
            "messages": [],
        }))
        .expect("chat payload should deserialize");

        assert!(health.api_key.is_empty());
        assert!(models.api_key.is_empty());
        assert_eq!(inspect.model, "qwen3:test");
        assert_eq!(chat.model, "qwen3:test");
    }

    #[test]
    fn desktop_tool_fixture_keeps_optional_timeout_and_json_fields() {
        let payload: RunDesktopAiToolChatPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "model": "qwen3:test",
            "messages": [{"role": "user", "content": "hola"}],
            "tools": [],
            "timeoutSeconds": 90,
        }))
        .expect("tool payload should deserialize");

        assert_eq!(payload.timeout_seconds, Some(90));
        assert!(payload.messages.is_array());
        assert!(payload.tools.is_array());
    }

    #[test]
    fn desktop_web_search_fixture_defaults_and_clamps_at_service_boundary() {
        let payload: RunDesktopAiWebSearchPayload = serde_json::from_value(serde_json::json!({
            "ollamaUrl": "https://ollama.com",
            "query": "public Rust release notes",
        }))
        .expect("web search payload should deserialize");

        assert_eq!(payload.max_results, 5);
        assert_eq!(payload.query, "public Rust release notes");
    }

    #[test]
    fn desktop_stream_events_keep_camel_case_and_discriminated_payloads() {
        let events = [
            DesktopAiStreamEvent::Thinking {
                delta: "pensando".to_string(),
            },
            DesktopAiStreamEvent::Delta {
                delta: "respuesta".to_string(),
            },
            DesktopAiStreamEvent::Done {
                answer: "final".to_string(),
            },
        ];

        let serialized: Vec<serde_json::Value> = events
            .into_iter()
            .map(|event| {
                serde_json::to_value(DesktopAiStreamEventPayload {
                    request_id: "request-1".to_string(),
                    event,
                })
                .expect("stream event should serialize")
            })
            .collect();

        assert_eq!(serialized[0]["requestId"], "request-1");
        assert_eq!(serialized[0]["type"], "thinking");
        assert_eq!(serialized[0]["payload"]["delta"], "pensando");
        assert_eq!(serialized[1]["type"], "delta");
        assert_eq!(serialized[2]["type"], "done");
        assert_eq!(serialized[2]["payload"]["answer"], "final");
    }
}
