use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::services::ai_service::AiHttpSettings;
use crate::services::ai_service::{AiChatMessage, AiChatResult, AiHealthResult, AiModelListResult};

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
        return crate::services::ai_service::list_ollama_multimodal_models(&settings).await;
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
