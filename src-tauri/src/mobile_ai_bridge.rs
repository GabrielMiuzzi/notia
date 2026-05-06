use crate::notia_timer::NotiaTimer;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use std::sync::Mutex;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, State, Wry,
};

pub struct AndroidAiBridgeState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
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
        let _timer = NotiaTimer::new("check_android_ai_health")
            .with_meta(format!("url={}", payload.ollama_url));
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

#[tauri::command]
pub fn list_android_ai_models(
    state: State<'_, AndroidAiBridgeState>,
    payload: CheckAndroidAiHealthPayload,
) -> Result<AndroidAiModelListResult, String> {
    #[cfg(target_os = "android")]
    {
        let _timer = NotiaTimer::new("list_android_ai_models")
            .with_meta(format!("url={}", payload.ollama_url));
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
