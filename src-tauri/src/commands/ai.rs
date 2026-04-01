use serde::Deserialize;

use crate::services::ai_service::{AiChatMessage, AiChatResult, AiHealthResult};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::services::ai_service::AiHttpSettings;

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
    messages: Vec<AiChatMessage>,
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
        return crate::services::ai_service::run_ollama_chat(&settings, &payload.model, &payload.messages)
            .await;
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let RunDesktopAiChatPayload {
            ollama_url,
            api_key,
            model,
            messages,
        } = payload;
        let _ = (ollama_url, api_key, model, messages);
        Err("El chat AI de desktop no esta disponible en esta plataforma.".to_string())
    }
}
