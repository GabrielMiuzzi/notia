//! Ollama adapter for the Tauri host.
//!
//! The backend core only knows `AgentProvider`. This module owns the Ollama
//! configuration and translates that provider contract to the existing native
//! Ollama service without exposing Tauri types to the core.

#[cfg(not(target_os = "android"))]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use notia_backend_core::{
    AgentProvider, BackendError, BackendErrorCode, ProviderMessage, ProviderMessageRole,
    ProviderRequest, ProviderResponse, ProviderStreamDelta, ProviderToolCall, RequestControl,
};
use serde_json::{json, Value};

use crate::services::ai_service::{
    AiChatMessage, AiChatResult, AiChatStreamDelta, AiHttpSettings, AiToolCall, AiToolCallFunction,
    AiWebSearchResponse,
};

const STREAM_POLL_INTERVAL: Duration = Duration::from_millis(20);
const DEFAULT_TOOL_TIMEOUT_SECS: u64 = 600;

#[derive(Clone)]
pub struct OllamaProviderConfig {
    settings: AiHttpSettings,
    model: String,
    think: Value,
    tool_timeout_secs: u64,
}

impl OllamaProviderConfig {
    pub fn new(
        settings: AiHttpSettings,
        model: impl Into<String>,
        think: Value,
    ) -> Result<Self, BackendError> {
        Self::with_tool_timeout(settings, model, think, DEFAULT_TOOL_TIMEOUT_SECS)
    }

    pub fn with_tool_timeout(
        settings: AiHttpSettings,
        model: impl Into<String>,
        think: Value,
        tool_timeout_secs: u64,
    ) -> Result<Self, BackendError> {
        if !(1..=600).contains(&tool_timeout_secs) {
            return Err(BackendError::invalid_input(
                "El tiempo de espera de herramientas debe estar entre 1 y 600 segundos.",
            ));
        }
        Ok(Self {
            settings,
            model: model.into(),
            think,
            tool_timeout_secs,
        })
    }
}

/// Port used by the provider adapter. The native implementation delegates to
/// `services::ai_service`; tests can use a deterministic mock at this boundary.
pub trait OllamaTransport: Send + Sync {
    fn chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &[AiChatMessage],
        think: &Value,
        control: &RequestControl,
    ) -> Result<AiChatResult, BackendError>;

    fn tool_chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &Value,
        tools: &Value,
        think: &Value,
        timeout_secs: u64,
        control: &RequestControl,
    ) -> Result<Value, BackendError>;

    fn stream_chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &[AiChatMessage],
        think: &Value,
        control: &RequestControl,
        on_delta: &mut dyn FnMut(AiChatStreamDelta) -> Result<(), BackendError>,
    ) -> Result<String, BackendError>;
}

/// Transport of the current platform. Desktop talks to Ollama over the native
/// Rust HTTP client; Android goes through the Kotlin AI bridge, which owns the
/// platform network stack and foreground-work continuity.
#[cfg(not(target_os = "android"))]
pub type PlatformOllamaTransport = NativeOllamaTransport;
#[cfg(target_os = "android")]
pub type PlatformOllamaTransport = AndroidOllamaTransport;

#[cfg(not(target_os = "android"))]
pub fn platform_ollama_transport(_app: &tauri::AppHandle) -> PlatformOllamaTransport {
    NativeOllamaTransport
}

#[cfg(target_os = "android")]
pub fn platform_ollama_transport(app: &tauri::AppHandle) -> PlatformOllamaTransport {
    AndroidOllamaTransport { app: app.clone() }
}

/// Runs an Ollama web search on the platform transport and returns sanitized,
/// bounded results. The query must already be sanitized by the caller.
pub fn search_web(
    app: &tauri::AppHandle,
    settings: &AiHttpSettings,
    query: &str,
    max_results: u32,
    control: &RequestControl,
) -> Result<AiWebSearchResponse, BackendError> {
    if settings.api_key.trim().is_empty() {
        return Err(BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "La busqueda web de Ollama requiere una API key configurada.",
            false,
        ));
    }
    if crate::services::ai_service::contains_sensitive_web_query_data(query) {
        return Err(BackendError::invalid_input(
            "La busqueda web fue bloqueada porque la consulta no es publica y segura.",
        ));
    }
    let max_results = max_results.clamp(1, 10);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let settings = settings.clone();
        let query = query.trim().to_string();
        run_with_control(
            move || {
                tauri::async_runtime::block_on(crate::services::ai_service::search_ollama_web(
                    &settings,
                    &query,
                    max_results,
                ))
            },
            control,
        )
    }
    #[cfg(target_os = "android")]
    {
        let app = app.clone();
        let payload = json!({
            "ollamaUrl": settings.ollama_url,
            "apiKey": settings.api_key,
            "query": query.trim(),
            "maxResults": max_results,
        });
        let raw = run_with_control(
            move || crate::mobile_ai_bridge::call_android_ai_plugin(&app, "webSearch", payload),
            control,
        )?;
        crate::services::ai_service::normalize_web_search_payload(raw, max_results)
            .map_err(map_service_error)
    }
}

#[cfg(not(target_os = "android"))]
pub struct NativeOllamaTransport;

#[cfg(not(target_os = "android"))]
impl OllamaTransport for NativeOllamaTransport {
    fn chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &[AiChatMessage],
        think: &Value,
        control: &RequestControl,
    ) -> Result<AiChatResult, BackendError> {
        let settings = settings.clone();
        let model = model.to_string();
        let messages = messages.to_vec();
        let think = think.clone();
        run_with_control(
            move || {
                tauri::async_runtime::block_on(crate::services::ai_service::run_ollama_chat(
                    &settings, &model, &messages, &think,
                ))
            },
            control,
        )
    }

    fn tool_chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &Value,
        tools: &Value,
        think: &Value,
        timeout_secs: u64,
        control: &RequestControl,
    ) -> Result<Value, BackendError> {
        let settings = settings.clone();
        let model = model.to_string();
        let messages = messages.clone();
        let tools = tools.clone();
        let think = think.clone();
        run_with_control(
            move || {
                tauri::async_runtime::block_on(crate::services::ai_service::run_ollama_tool_chat(
                    &settings,
                    &model,
                    &messages,
                    &tools,
                    &think,
                    timeout_secs,
                ))
            },
            control,
        )
    }

    fn stream_chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &[AiChatMessage],
        think: &Value,
        control: &RequestControl,
        on_delta: &mut dyn FnMut(AiChatStreamDelta) -> Result<(), BackendError>,
    ) -> Result<String, BackendError> {
        control.check()?;

        enum StreamMessage {
            Delta(AiChatStreamDelta),
            Done(Result<String, String>),
        }

        let (sender, receiver) = mpsc::channel();
        let cancellation = Arc::new(AtomicBool::new(false));
        let worker_cancellation = Arc::clone(&cancellation);
        let settings = settings.clone();
        let model = model.to_string();
        let messages = messages.to_vec();
        let think = think.clone();

        std::thread::spawn(move || {
            let sender_for_delta = sender.clone();
            let result = tauri::async_runtime::block_on(
                crate::services::ai_service::stream_ollama_chat_with_cancellation(
                    &settings,
                    &model,
                    &messages,
                    &think,
                    worker_cancellation,
                    move |delta| {
                        sender_for_delta
                            .send(StreamMessage::Delta(delta))
                            .map_err(|_| "El consumidor del stream se desconecto.".to_string())
                    },
                ),
            );
            let _ = sender.send(StreamMessage::Done(result));
        });

        loop {
            match receiver.recv_timeout(STREAM_POLL_INTERVAL) {
                Ok(StreamMessage::Delta(delta)) => {
                    if let Err(error) = control.check() {
                        cancellation.store(true, Ordering::Release);
                        return Err(error);
                    }
                    if let Err(error) = on_delta(delta) {
                        cancellation.store(true, Ordering::Release);
                        return Err(error);
                    }
                }
                Ok(StreamMessage::Done(result)) => {
                    // An empty answer is not a transport failure: the agent
                    // decides how to continue (see `run_agent`).
                    let result = match result {
                        Err(error) if error == EMPTY_ANSWER => Ok(String::new()),
                        other => other,
                    };
                    return result.map_err(map_service_error).and_then(|answer| {
                        control.check()?;
                        Ok(answer)
                    });
                }
                Err(RecvTimeoutError::Timeout) => {
                    if let Err(error) = control.check() {
                        cancellation.store(true, Ordering::Release);
                        return Err(error);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(BackendError::new(
                        BackendErrorCode::Internal,
                        "El stream de Ollama se cerro sin una respuesta.",
                        true,
                    ));
                }
            }
        }
    }
}

/// Android transport over the Kotlin AI bridge. The bridge call is blocking
/// and not interruptible, so cancellation and timeout are enforced by
/// abandoning the worker result; nothing from an abandoned call is used.
#[cfg(target_os = "android")]
pub struct AndroidOllamaTransport {
    app: tauri::AppHandle,
}

#[cfg(target_os = "android")]
impl OllamaTransport for AndroidOllamaTransport {
    fn chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &[AiChatMessage],
        think: &Value,
        control: &RequestControl,
    ) -> Result<AiChatResult, BackendError> {
        let messages = serde_json::to_value(messages).map_err(|_| {
            BackendError::invalid_input("Los mensajes no se pudieron serializar para Ollama.")
        })?;
        let response = self.tool_chat(
            settings,
            model,
            &messages,
            &Value::Array(Vec::new()),
            think,
            DEFAULT_TOOL_TIMEOUT_SECS,
            control,
        )?;
        if response
            .get("error")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(map_service_error(
                "Ollama no pudo completar la solicitud.".to_string(),
            ));
        }
        let answer = response
            .pointer("/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        if answer.is_empty() {
            return Err(BackendError::new(
                BackendErrorCode::ProviderUnavailable,
                "La IA no devolvio contenido.",
                true,
            ));
        }
        Ok(AiChatResult { answer })
    }

    fn tool_chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &Value,
        tools: &Value,
        think: &Value,
        timeout_secs: u64,
        control: &RequestControl,
    ) -> Result<Value, BackendError> {
        let app = self.app.clone();
        let payload = json!({
            "ollamaUrl": settings.ollama_url,
            "apiKey": settings.api_key,
            "model": model,
            "think": think,
            "messagesJson": messages.to_string(),
            "toolsJson": tools.to_string(),
            "timeoutSeconds": timeout_secs,
        });
        run_with_control(
            move || crate::mobile_ai_bridge::call_android_ai_plugin(&app, "toolChat", payload),
            control,
        )
    }

    fn stream_chat(
        &self,
        settings: &AiHttpSettings,
        model: &str,
        messages: &[AiChatMessage],
        think: &Value,
        control: &RequestControl,
        on_delta: &mut dyn FnMut(AiChatStreamDelta) -> Result<(), BackendError>,
    ) -> Result<String, BackendError> {
        use crate::mobile_ai_bridge::AndroidStreamEvent;

        control.check()?;
        let request_id = uuid::Uuid::new_v4().to_string();
        let payload = json!({
            "ollamaUrl": settings.ollama_url,
            "apiKey": settings.api_key,
            "model": model,
            "think": think,
            "messagesJson": serde_json::to_string(messages).map_err(|_| {
                BackendError::invalid_input("Los mensajes no se pudieron serializar para Ollama.")
            })?,
            "timeoutSeconds": DEFAULT_TOOL_TIMEOUT_SECS,
        });
        let (sender, receiver) = mpsc::channel();
        let app = self.app.clone();
        let worker_request_id = request_id.clone();
        std::thread::spawn(move || {
            crate::mobile_ai_bridge::stream_android_raw_chat(&app, &worker_request_id, payload, sender);
        });
        let cancel = |error: BackendError| {
            crate::mobile_ai_bridge::cancel_android_raw_chat(&self.app, &request_id);
            Err(error)
        };
        loop {
            match receiver.recv_timeout(STREAM_POLL_INTERVAL) {
                Ok(AndroidStreamEvent::Thinking(delta)) => {
                    if let Err(error) = control.check().and_then(|()| on_delta(AiChatStreamDelta::Thinking(delta))) {
                        return cancel(error);
                    }
                }
                Ok(AndroidStreamEvent::Content(delta)) => {
                    if let Err(error) = control.check().and_then(|()| on_delta(AiChatStreamDelta::Content(delta))) {
                        return cancel(error);
                    }
                }
                Ok(AndroidStreamEvent::Done(result)) => {
                    let value = result.map_err(map_service_error)?;
                    if value.get("ok").and_then(Value::as_bool) == Some(false) {
                        let message = value
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("Ollama no pudo completar la solicitud.")
                            .to_string();
                        return Err(map_service_error(message));
                    }
                    control.check()?;
                    let answer = value
                        .get("answer")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_string();
                    return Ok(answer);
                }
                Err(RecvTimeoutError::Timeout) => {
                    if let Err(error) = control.check() {
                        return cancel(error);
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(BackendError::new(
                        BackendErrorCode::Internal,
                        "El stream de Ollama se cerro sin una respuesta.",
                        true,
                    ));
                }
            }
        }
    }
}

pub struct OllamaAgentProvider<T = PlatformOllamaTransport> {
    config: OllamaProviderConfig,
    transport: T,
}

impl<T> OllamaAgentProvider<T> {
    pub fn with_transport(config: OllamaProviderConfig, transport: T) -> Self {
        Self { config, transport }
    }
}

impl<T: OllamaTransport> AgentProvider for OllamaAgentProvider<T> {
    fn chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
    ) -> Result<ProviderResponse, BackendError> {
        control.check()?;
        let messages = translate_messages(&request.messages);
        let answer = self.transport.chat(
            &self.config.settings,
            &self.config.model,
            &messages,
            &self.config.think,
            control,
        )?;
        control.check()?;
        Ok(ProviderResponse {
            message: ProviderMessage {
                role: ProviderMessageRole::Assistant,
                content: answer.answer,
                images: Vec::new(),
                tool_calls: Vec::new(),
                tool_name: None,
            },
        })
    }

    fn stream_chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
        on_delta: &mut dyn FnMut(ProviderStreamDelta) -> Result<(), BackendError>,
    ) -> Result<ProviderResponse, BackendError> {
        control.check()?;
        let messages = translate_messages(&request.messages);
        let answer = self.transport.stream_chat(
            &self.config.settings,
            &self.config.model,
            &messages,
            &self.config.think,
            control,
            &mut |delta| {
                control.check()?;
                on_delta(match delta {
                    AiChatStreamDelta::Thinking(value) => ProviderStreamDelta::Thinking(value),
                    AiChatStreamDelta::Content(value) => ProviderStreamDelta::Content(value),
                })
            },
        )?;
        control.check()?;
        Ok(ProviderResponse {
            message: ProviderMessage {
                role: ProviderMessageRole::Assistant,
                content: answer,
                images: Vec::new(),
                tool_calls: Vec::new(),
                tool_name: None,
            },
        })
    }

    fn tool_chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
    ) -> Result<ProviderResponse, BackendError> {
        control.check()?;
        let messages =
            serde_json::to_value(translate_messages(&request.messages)).map_err(|_| {
                BackendError::invalid_input("Los mensajes no se pudieron serializar para Ollama.")
            })?;
        let tools = translate_tools(&request.tools);
        let response = self.transport.tool_chat(
            &self.config.settings,
            &self.config.model,
            &messages,
            &tools,
            &self.config.think,
            self.config.tool_timeout_secs,
            control,
        )?;
        control.check()?;
        translate_tool_response(response).map_err(map_service_error)
    }
}

fn translate_messages(messages: &[ProviderMessage]) -> Vec<AiChatMessage> {
    messages
        .iter()
        .map(|message| AiChatMessage {
            role: match message.role {
                ProviderMessageRole::System => "system",
                ProviderMessageRole::User => "user",
                ProviderMessageRole::Assistant => "assistant",
                ProviderMessageRole::Tool => "tool",
            }
            .to_string(),
            content: message.content.clone(),
            // Vision attachments are part of the backend protocol. Do not
            // silently drop them when crossing the Ollama adapter boundary.
            images: message.images.clone(),
            tool_calls: message
                .tool_calls
                .iter()
                .map(|call| AiToolCall {
                    function: AiToolCallFunction {
                        name: call.name.clone(),
                        arguments: call.arguments.clone(),
                    },
                })
                .collect(),
            tool_name: message.tool_name.clone(),
        })
        .collect()
}

fn translate_tools(tools: &[notia_backend_core::ToolDefinition]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    }
                })
            })
            .collect(),
    )
}

fn translate_tool_response(payload: Value) -> Result<ProviderResponse, String> {
    if payload
        .get("error")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("Ollama devolvio un error al procesar la solicitud.".to_string());
    }

    let message = payload
        .get("message")
        .and_then(Value::as_object)
        .ok_or_else(|| "La respuesta de herramientas de Ollama no es valida.".to_string())?;
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .enumerate()
                .map(|(index, call)| {
                    let function =
                        call.get("function")
                            .and_then(Value::as_object)
                            .ok_or_else(|| {
                                "La respuesta de herramientas de Ollama no es valida.".to_string()
                            })?;
                    let name = function
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .ok_or_else(|| {
                            "La respuesta de herramientas de Ollama no es valida.".to_string()
                        })?;
                    Ok(ProviderToolCall {
                        id: call
                            .get("id")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(ToOwned::to_owned)
                            .unwrap_or_else(|| format!("ollama-call-{}", index + 1)),
                        name: name.to_string(),
                        arguments: function
                            .get("arguments")
                            .cloned()
                            .unwrap_or_else(|| json!({})),
                    })
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .transpose()?
        .unwrap_or_default();

    Ok(ProviderResponse {
        message: ProviderMessage {
            role: ProviderMessageRole::Assistant,
            content,
            images: Vec::new(),
            tool_calls,
            tool_name: None,
        },
    })
}

/// Runs blocking provider work on a worker thread while polling the request
/// control, so cancellation and the request deadline are honoured even when
/// the underlying call cannot be interrupted.
fn run_with_control<T, F>(work: F, control: &RequestControl) -> Result<T, BackendError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    control.check()?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(work());
    });

    loop {
        match receiver.recv_timeout(STREAM_POLL_INTERVAL) {
            Ok(result) => return result.map_err(map_service_error),
            Err(RecvTimeoutError::Timeout) => control.check()?,
            Err(RecvTimeoutError::Disconnected) => {
                return Err(BackendError::new(
                    BackendErrorCode::Internal,
                    "La llamada a Ollama se cerro sin una respuesta.",
                    true,
                ));
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
const EMPTY_ANSWER: &str = "La IA no devolvio contenido.";

/// Short provider detail safe to show: the `error` field of an Ollama JSON
/// body or a one-line message, without credentials or URLs.
fn provider_detail(error: &str) -> Option<String> {
    let detail = serde_json::from_str::<Value>(error)
        .ok()
        .and_then(|value| value.get("error").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| error.to_string());
    let detail = detail.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = detail.to_lowercase();
    let unsafe_detail = ["http", "bearer", "key", "token", "secret", "password"]
        .iter()
        .any(|marker| lower.contains(marker));
    (!detail.is_empty() && !unsafe_detail).then(|| detail.chars().take(160).collect())
}

fn map_service_error(error: String) -> BackendError {
    let normalized = error.to_lowercase();
    if normalized.contains("cancel") || normalized.contains("cancelad") {
        return BackendError::cancelled();
    }
    if normalized.contains("tiempo de espera") || normalized.contains("timeout") {
        return BackendError::timeout();
    }
    if normalized.contains("url de ollama")
        || normalized.contains("modelo de ollama")
        || normalized.contains("no hay mensajes")
        || normalized.contains("no hay herramientas")
        || normalized.contains("tiempo de espera de herramientas")
    {
        return BackendError::invalid_input(safe_validation_message(&normalized));
    }
    if normalized.contains("unauthorized") {
        return BackendError::invalid_input(
            "Ollama rechazó la credencial. Revisá la API key en Configuración → IA.",
        );
    }
    if normalized.contains("not found") && normalized.contains("model") {
        return BackendError::invalid_input(
            "El modelo seleccionado no existe en el servidor de Ollama configurado.",
        );
    }
    if normalized.contains("no se pudo conectar")
        || normalized.contains("se interrumpio el stream")
        || normalized.contains("consumidor del stream")
    {
        return BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "No se pudo conectar con Ollama.",
            true,
        );
    }
    BackendError::new(
        BackendErrorCode::ProviderUnavailable,
        match provider_detail(&error) {
            Some(detail) => format!("Ollama no pudo completar la solicitud: {detail}"),
            None => "Ollama no pudo completar la solicitud.".to_string(),
        },
        false,
    )
}

fn safe_validation_message(normalized_error: &str) -> &'static str {
    if normalized_error.contains("url de ollama es obligatoria") {
        "La URL de Ollama es obligatoria."
    } else if normalized_error.contains("url de ollama no es valida") {
        "La URL de Ollama no es valida."
    } else if normalized_error.contains("url de ollama debe usar") {
        "La URL de Ollama debe usar http o https."
    } else if normalized_error.contains("credenciales embebidas") {
        "La URL de Ollama no puede incluir credenciales embebidas."
    } else if normalized_error.contains("modelo de ollama") {
        "El modelo de Ollama es obligatorio."
    } else if normalized_error.contains("no hay herramientas") {
        "No hay herramientas para enviar a la IA."
    } else if normalized_error.contains("tiempo de espera de herramientas") {
        "El tiempo de espera de herramientas no es valido."
    } else {
        "Los datos enviados a Ollama no son validos."
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use notia_backend_core::{
        BackendActor, BackendChannel, BackendRequestContext, BackendScope, ProviderMessage,
        ProviderMessageRole, ToolDefinition,
    };

    const TOOL_RESPONSE_FIXTURE: &str = include_str!("fixtures/ollama-tool-response.json");

    struct MockTransport {
        seen_messages: Arc<Mutex<Vec<AiChatMessage>>>,
        seen_tools: Arc<Mutex<Option<Value>>>,
        response: Value,
    }

    impl OllamaTransport for MockTransport {
        fn chat(
            &self,
            _: &AiHttpSettings,
            _: &str,
            messages: &[AiChatMessage],
            _: &Value,
            _: &RequestControl,
        ) -> Result<AiChatResult, BackendError> {
            *self.seen_messages.lock().expect("messages lock") = messages.to_vec();
            Ok(AiChatResult {
                answer: "respuesta mock".to_string(),
            })
        }

        fn tool_chat(
            &self,
            _: &AiHttpSettings,
            _: &str,
            messages: &Value,
            tools: &Value,
            _: &Value,
            _: u64,
            _: &RequestControl,
        ) -> Result<Value, BackendError> {
            *self.seen_messages.lock().expect("messages lock") =
                serde_json::from_value(messages.clone()).expect("messages fixture");
            *self.seen_tools.lock().expect("tools lock") = Some(tools.clone());
            Ok(self.response.clone())
        }

        fn stream_chat(
            &self,
            _: &AiHttpSettings,
            _: &str,
            messages: &[AiChatMessage],
            _: &Value,
            _: &RequestControl,
            on_delta: &mut dyn FnMut(AiChatStreamDelta) -> Result<(), BackendError>,
        ) -> Result<String, BackendError> {
            *self.seen_messages.lock().expect("messages lock") = messages.to_vec();
            on_delta(AiChatStreamDelta::Thinking("pensando".to_string()))?;
            on_delta(AiChatStreamDelta::Content("respuesta".to_string()))?;
            Ok("respuesta".to_string())
        }
    }

    fn config() -> OllamaProviderConfig {
        OllamaProviderConfig::new(
            AiHttpSettings {
                ollama_url: "https://ollama.test".to_string(),
                api_key: "secret-fixture-key".to_string(),
            },
            "qwen3:test",
            json!("medium"),
        )
        .expect("valid config")
    }

    fn request(with_tools: bool) -> ProviderRequest {
        ProviderRequest {
            context: BackendRequestContext {
                request_id: "request-1".to_string(),
                library_id: "library-1".to_string(),
                actor: BackendActor {
                    library_user_id: "user-owner".to_string(),
                    external_identity: None,
                },
                channel: BackendChannel::App,
                scope: BackendScope::Library,
                persistence_policy: notia_backend_core::PersistencePolicy::Persistent,
            },
            messages: vec![ProviderMessage {
                role: ProviderMessageRole::User,
                content: "lee la nota".to_string(),
                images: Vec::new(),
                tool_calls: Vec::new(),
                tool_name: None,
            }],
            tools: if with_tools {
                vec![ToolDefinition {
                    name: "read_note".to_string(),
                    description: "Lee una nota".to_string(),
                    input_schema: json!({
                        "type": "object",
                        "properties": {"path": {"type": "string"}}
                    }),
                    scopes: vec![BackendScope::Library],
                    read_only: true,
                    requires_confirmation: false,
                }]
            } else {
                Vec::new()
            },
        }
    }

    #[test]
    fn translates_messages_and_tools_without_calling_real_ollama() {
        let seen_messages = Arc::new(Mutex::new(Vec::new()));
        let seen_tools = Arc::new(Mutex::new(None));
        let transport = MockTransport {
            seen_messages: Arc::clone(&seen_messages),
            seen_tools: Arc::clone(&seen_tools),
            response: serde_json::from_str(TOOL_RESPONSE_FIXTURE).expect("tool fixture"),
        };
        let provider = OllamaAgentProvider::with_transport(config(), transport);
        let response = provider
            .tool_chat(&request(true), &RequestControl::new(None))
            .expect("mock tool response");

        assert_eq!(seen_messages.lock().expect("messages lock")[0].role, "user");
        assert_eq!(
            seen_messages.lock().expect("messages lock")[0].content,
            "lee la nota"
        );
        assert_eq!(
            seen_tools
                .lock()
                .expect("tools lock")
                .as_ref()
                .expect("tools")[0]["type"],
            "function"
        );
        assert_eq!(response.message.tool_calls[0].id, "ollama-call-1");
        assert_eq!(response.message.tool_calls[0].name, "read_note");
        assert_eq!(
            response.message.tool_calls[0].arguments["path"],
            "notes/example.md"
        );
    }

    #[test]
    fn translates_stream_deltas_and_final_content() {
        let transport = MockTransport {
            seen_messages: Arc::new(Mutex::new(Vec::new())),
            seen_tools: Arc::new(Mutex::new(None)),
            response: Value::Null,
        };
        let provider = OllamaAgentProvider::with_transport(config(), transport);
        let mut deltas = Vec::new();
        let response = provider
            .stream_chat(&request(false), &RequestControl::new(None), &mut |delta| {
                deltas.push(delta);
                Ok(())
            })
            .expect("mock stream response");

        assert_eq!(response.message.content, "respuesta");
        assert_eq!(
            deltas,
            vec![
                ProviderStreamDelta::Thinking("pensando".to_string()),
                ProviderStreamDelta::Content("respuesta".to_string()),
            ]
        );
    }

    #[test]
    fn checks_control_before_transport_and_maps_provider_errors_structurally() {
        let transport = MockTransport {
            seen_messages: Arc::new(Mutex::new(Vec::new())),
            seen_tools: Arc::new(Mutex::new(None)),
            response: Value::Null,
        };
        let provider = OllamaAgentProvider::with_transport(config(), transport);
        let control = RequestControl::new(None);
        control.cancel();
        assert_eq!(
            provider
                .chat(&request(false), &control)
                .expect_err("cancelled request")
                .code,
            BackendErrorCode::Cancelled
        );
        assert_eq!(
            map_service_error("No se pudo conectar con la IA. api_key=secret".to_string()).code,
            BackendErrorCode::ProviderUnavailable
        );
        assert_eq!(
            map_service_error("{\"error\":\"unauthorized\"}".to_string()).code,
            BackendErrorCode::InvalidInput
        );
        assert_eq!(
            map_service_error("{\"error\":\"model 'x' not found\"}".to_string()).code,
            BackendErrorCode::InvalidInput
        );
        assert!(map_service_error("{\"error\":\"context length exceeded\"}".to_string())
            .message
            .ends_with("context length exceeded"));
        assert!(!map_service_error("bad Bearer abc".to_string()).message.contains("abc"));
        assert!(
            !map_service_error("No se pudo conectar con la IA. api_key=secret".to_string())
                .message
                .contains("secret")
        );
    }
}
