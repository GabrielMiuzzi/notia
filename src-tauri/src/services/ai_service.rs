use serde::{Deserialize, Serialize};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpSettings {
    pub ollama_url: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHealthResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResult {
    pub answer: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelListResult {
    pub models: Vec<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use reqwest::{Client, Url};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::time::Duration;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const HEALTH_TIMEOUT_SECS: u64 = 15;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const CHAT_TIMEOUT_SECS: u64 = 180;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModelDescriptor>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct OllamaModelDescriptor {
    name: Option<String>,
    model: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct OllamaShowResponse {
    #[serde(default)]
    capabilities: Vec<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaChatRequest<'a> {
    model: &'a str,
    stream: bool,
    messages: &'a [AiChatMessage],
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: Option<OllamaChatResponseMessage>,
    error: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct OllamaChatResponseMessage {
    content: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|error| format!("No se pudo inicializar el cliente HTTP de IA: {error}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn build_endpoint(base_url: &str, path: &str) -> Result<Url, String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err("La URL de Ollama es obligatoria.".to_string());
    }

    let mut url = Url::parse(trimmed).map_err(|_| "La URL de Ollama no es valida.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("La URL de Ollama debe usar http o https.".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("La URL de Ollama no puede incluir credenciales embebidas.".to_string());
    }

    url.set_path(path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn with_auth(
    request: reqwest::RequestBuilder,
    settings: &AiHttpSettings,
) -> reqwest::RequestBuilder {
    let api_key = settings.api_key.trim();
    if api_key.is_empty() {
        return request;
    }

    request.bearer_auth(api_key)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn describe_request_error(error: reqwest::Error, fallback: &str) -> String {
    if error.is_timeout() {
        return "La IA excedio el tiempo de espera.".to_string();
    }

    if error.is_connect() {
        return "No se pudo conectar con la IA.".to_string();
    }

    let message = error.to_string();
    if message.trim().is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_default_model(payload: &OllamaTagsResponse) -> Option<String> {
    payload.models.iter().find_map(|model| {
        model
            .name
            .as_deref()
            .or(model.model.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn extract_model_name(model: &OllamaModelDescriptor) -> Option<String> {
    model
        .name
        .as_deref()
        .or(model.model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn is_likely_multimodal_model_name(model: &str) -> bool {
    let normalized = model.trim().to_lowercase();
    if normalized.is_empty() {
        return false;
    }

    [
        "vision",
        "vl",
        "llava",
        "bakllava",
        "moondream",
        "minicpm-v",
        "gemma3",
        "gemma4",
        "gemini",
        "glm-ocr",
        "qwen3.5",
    ]
    .iter()
    .any(|token| normalized.contains(token))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn read_error_detail(response: reqwest::Response) -> String {
    let status = response.status();
    let detail = response
        .text()
        .await
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    detail.unwrap_or_else(|| format!("La IA respondio con HTTP {status}."))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn check_ollama_health(settings: &AiHttpSettings) -> Result<AiHealthResult, String> {
    let client = build_client(HEALTH_TIMEOUT_SECS)?;
    let endpoint = build_endpoint(&settings.ollama_url, "/api/tags")?;
    let response = with_auth(
        client
            .get(endpoint)
            .header(reqwest::header::ACCEPT, "application/json"),
        settings,
    )
    .send()
    .await
    .map_err(|error| describe_request_error(error, "No se pudo conectar con la IA."))?;

    if !response.status().is_success() {
        return Err(read_error_detail(response).await);
    }

    let payload = response
        .json::<OllamaTagsResponse>()
        .await
        .map_err(|error| {
            describe_request_error(error, "La respuesta de IA no se pudo interpretar.")
        })?;
    let default_model = pick_default_model(&payload);

    Ok(if let Some(model) = default_model {
        AiHealthResult {
            ok: true,
            message: "Conexion correcta con Ollama.".to_string(),
            default_model: Some(model),
        }
    } else {
        AiHealthResult {
            ok: false,
            message: "Ollama respondio, pero no devolvio modelos disponibles.".to_string(),
            default_model: None,
        }
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn list_ollama_multimodal_models(
    settings: &AiHttpSettings,
) -> Result<AiModelListResult, String> {
    let client = build_client(HEALTH_TIMEOUT_SECS)?;
    let tags_endpoint = build_endpoint(&settings.ollama_url, "/api/tags")?;
    let response = with_auth(
        client
            .get(tags_endpoint)
            .header(reqwest::header::ACCEPT, "application/json"),
        settings,
    )
    .send()
    .await
    .map_err(|error| describe_request_error(error, "No se pudo conectar con la IA."))?;

    if !response.status().is_success() {
        return Err(read_error_detail(response).await);
    }

    let payload = response
        .json::<OllamaTagsResponse>()
        .await
        .map_err(|error| {
            describe_request_error(error, "La respuesta de IA no se pudo interpretar.")
        })?;

    let available_models: Vec<String> = payload
        .models
        .iter()
        .filter_map(extract_model_name)
        .collect();

    let likely_models: Vec<String> = available_models
        .iter()
        .filter(|model| is_likely_multimodal_model_name(model))
        .cloned()
        .collect();

    let models_to_verify = if likely_models.is_empty() {
        available_models
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
    } else {
        likely_models.clone()
    };

    let show_endpoint = build_endpoint(&settings.ollama_url, "/api/show")?;
    let mut verified_models: Vec<String> = Vec::new();

    for model in &models_to_verify {
        let show_response = match with_auth(
            client
                .post(show_endpoint.clone())
                .header(reqwest::header::ACCEPT, "application/json")
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .json(&serde_json::json!({ "model": model })),
            settings,
        )
        .send()
        .await
        {
            Ok(response) => response,
            Err(_) => continue,
        };

        if !show_response.status().is_success() {
            continue;
        }

        let show_payload = match show_response.json::<OllamaShowResponse>().await {
            Ok(payload) => payload,
            Err(_) => continue,
        };

        if show_payload
            .capabilities
            .iter()
            .any(|capability| capability == "vision")
        {
            verified_models.push(model.clone());
        }
    }

    if !verified_models.is_empty() {
        return Ok(AiModelListResult {
            models: verified_models,
        });
    }

    Ok(AiModelListResult {
        models: likely_models,
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn run_ollama_chat(
    settings: &AiHttpSettings,
    model: &str,
    messages: &[AiChatMessage],
) -> Result<AiChatResult, String> {
    let normalized_model = model.trim();
    if normalized_model.is_empty() {
        return Err("El modelo de Ollama es obligatorio.".to_string());
    }
    if messages.is_empty() {
        return Err("No hay mensajes para enviar a la IA.".to_string());
    }

    let client = build_client(CHAT_TIMEOUT_SECS)?;
    let endpoint = build_endpoint(&settings.ollama_url, "/api/chat")?;
    let response = with_auth(
        client
            .post(endpoint)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&OllamaChatRequest {
                model: normalized_model,
                stream: false,
                messages,
            }),
        settings,
    )
    .send()
    .await
    .map_err(|error| {
        describe_request_error(error, "No se pudo completar la consulta con la IA.")
    })?;

    if !response.status().is_success() {
        return Err(read_error_detail(response).await);
    }

    let payload = response
        .json::<OllamaChatResponse>()
        .await
        .map_err(|error| {
            describe_request_error(error, "La respuesta de IA no se pudo interpretar.")
        })?;

    if let Some(error_message) = payload
        .error
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Err(error_message);
    }

    let answer = payload
        .message
        .and_then(|message| message.content)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "La IA no devolvio contenido.".to_string())?;

    Ok(AiChatResult { answer })
}
