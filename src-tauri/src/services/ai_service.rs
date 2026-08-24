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
use futures::StreamExt;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use reqwest::{Client, Url};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::time::Duration;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const HEALTH_TIMEOUT_SECS: u64 = 15;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const CHAT_TIMEOUT_SECS: u64 = 180;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
const TOOL_CHAT_TIMEOUT_SECS: u64 = 600;

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
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaChatRequest<'a> {
    model: &'a str,
    stream: bool,
    think: &'a serde_json::Value,
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
#[derive(Debug, Deserialize)]
struct OllamaChatStreamChunk {
    message: Option<OllamaChatStreamMessage>,
    error: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, Deserialize)]
struct OllamaChatStreamMessage {
    content: Option<String>,
    thinking: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub enum AiChatStreamDelta {
    Thinking(String),
    Content(String),
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
pub async fn list_ollama_models(settings: &AiHttpSettings) -> Result<AiModelListResult, String> {
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

    let mut available_models: Vec<String> = payload
        .models
        .iter()
        .filter_map(extract_model_name)
        .collect();
    available_models.sort_unstable();
    available_models.dedup();

    Ok(AiModelListResult {
        models: available_models,
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn run_ollama_chat(
    settings: &AiHttpSettings,
    model: &str,
    messages: &[AiChatMessage],
    think: &serde_json::Value,
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
                think,
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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn run_ollama_tool_chat(
    settings: &AiHttpSettings,
    model: &str,
    messages: &serde_json::Value,
    tools: &serde_json::Value,
    think: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let normalized_model = model.trim();
    if normalized_model.is_empty() {
        return Err("El modelo de Ollama es obligatorio.".to_string());
    }
    if !messages.as_array().is_some_and(|items| !items.is_empty()) {
        return Err("No hay mensajes para enviar a la IA.".to_string());
    }
    if !tools.as_array().is_some_and(|items| !items.is_empty()) {
        return Err("No hay herramientas para enviar a la IA.".to_string());
    }

    let client = build_client(TOOL_CHAT_TIMEOUT_SECS)?;
    let endpoint = build_endpoint(&settings.ollama_url, "/api/chat")?;
    let response = with_auth(
        client
            .post(endpoint)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&serde_json::json!({
                "model": normalized_model,
                "stream": false,
                "think": think,
                "messages": messages,
                "tools": tools,
            })),
        settings,
    )
    .send()
    .await
    .map_err(|error| {
        describe_request_error(error, "No se pudo completar la consulta con herramientas.")
    })?;

    if !response.status().is_success() {
        return Err(read_error_detail(response).await);
    }

    response.json::<serde_json::Value>().await.map_err(|error| {
        describe_request_error(
            error,
            "La respuesta de herramientas no se pudo interpretar.",
        )
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn stream_ollama_chat<F>(
    settings: &AiHttpSettings,
    model: &str,
    messages: &[AiChatMessage],
    think: &serde_json::Value,
    mut on_delta: F,
) -> Result<String, String>
where
    F: FnMut(AiChatStreamDelta),
{
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
            .header(reqwest::header::ACCEPT, "application/x-ndjson")
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&OllamaChatRequest {
                model: normalized_model,
                stream: true,
                think,
                messages,
            }),
        settings,
    )
    .send()
    .await
    .map_err(|error| describe_request_error(error, "No se pudo iniciar el stream de IA."))?;

    if !response.status().is_success() {
        return Err(read_error_detail(response).await);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::<u8>::new();
    let mut answer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| describe_request_error(error, "Se interrumpio el stream de IA."))?;
        buffer.extend_from_slice(&chunk);

        while let Some(line_end) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=line_end).collect::<Vec<_>>();
            process_stream_line(&line, &mut answer, &mut on_delta)?;
        }
    }

    if !buffer.is_empty() {
        process_stream_line(&buffer, &mut answer, &mut on_delta)?;
    }

    if answer.trim().is_empty() {
        return Err("La IA no devolvio contenido.".to_string());
    }
    Ok(answer.trim().to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn process_stream_line<F>(line: &[u8], answer: &mut String, on_delta: &mut F) -> Result<(), String>
where
    F: FnMut(AiChatStreamDelta),
{
    let line = std::str::from_utf8(line)
        .map_err(|_| "Ollama devolvio texto UTF-8 invalido.".to_string())?
        .trim();
    if line.is_empty() {
        return Ok(());
    }
    let payload: OllamaChatStreamChunk = serde_json::from_str(line)
        .map_err(|error| format!("No se pudo interpretar un fragmento de IA: {error}"))?;
    if let Some(error) = payload.error.filter(|value| !value.trim().is_empty()) {
        return Err(error);
    }
    if let Some(message) = payload.message {
        if let Some(thinking) = message.thinking.filter(|value| !value.is_empty()) {
            on_delta(AiChatStreamDelta::Thinking(thinking));
        }
        if let Some(content) = message.content.filter(|value| !value.is_empty()) {
            answer.push_str(&content);
            on_delta(AiChatStreamDelta::Content(content));
        }
    }
    Ok(())
}

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod stream_tests {
    use super::{process_stream_line, AiChatStreamDelta};

    #[test]
    fn separates_thinking_and_answer_deltas() {
        let mut answer = String::new();
        let mut deltas = Vec::new();
        process_stream_line(
            br#"{"message":{"thinking":"Analizando...","content":"Respuesta"}}"#,
            &mut answer,
            &mut |delta| match delta {
                AiChatStreamDelta::Thinking(value) => deltas.push(("thinking", value)),
                AiChatStreamDelta::Content(value) => deltas.push(("content", value)),
            },
        )
        .expect("el fragmento debe ser valido");

        assert_eq!(answer, "Respuesta");
        assert_eq!(
            deltas,
            vec![
                ("thinking", "Analizando...".to_string()),
                ("content", "Respuesta".to_string()),
            ]
        );
    }
}
