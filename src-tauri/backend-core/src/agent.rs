use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::catalog::{
    authorize_tool_call, project_tool_catalog, AuthorizationPrincipal, ToolCatalogProjection,
};
use super::context::BackendRequestContext;
use super::control::RequestControl;
use super::error::{BackendError, BackendErrorCode};
use super::events::{BackendEvent, BackendEventSink};
use super::formatting::channel_response;
use super::interaction::{ClarificationOption, ClarificationRequest, OperationToken};
use super::protocol::{
    AgentRequest, AgentResponse, BackendLimits, BackendMessage, ConfirmationDecision,
    MessageRole, MutationPreview, MutationPreviewAction, OperationStatus, PreviewHunk,
    ResumeDecision, ToolCall, ToolDefinition, ToolResult,
};
use super::runtime::InteractionRuntime;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRequest {
    pub context: BackendRequestContext,
    pub messages: Vec<ProviderMessage>,
    pub tools: Vec<ToolDefinition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMessage {
    pub role: ProviderMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ProviderToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderMessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderResponse {
    pub message: ProviderMessage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderStreamDelta {
    Thinking(String),
    Content(String),
}

/// Puerto de infraestructura para Ollama, un proveedor remoto o un mock.
/// Ningún método conoce Tauri, WebView, React ni la ejecución de una tool.
pub trait AgentProvider: Send + Sync {
    fn chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
    ) -> Result<ProviderResponse, BackendError>;

    fn stream_chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
        on_delta: &mut dyn FnMut(ProviderStreamDelta) -> Result<(), BackendError>,
    ) -> Result<ProviderResponse, BackendError>;

    fn tool_chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
    ) -> Result<ProviderResponse, BackendError>;
}

pub trait ToolExecutor: Send + Sync {
    fn execute(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<ToolResult, BackendError>;

    fn execute_confirmed(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
        _decision: &ConfirmationDecision,
        _preview: Option<&super::protocol::MutationPreview>,
    ) -> Result<ToolResult, BackendError> {
        self.execute(context, call)
    }

    /// Optional preview hook. It must not mutate state. Adapters that do not
    /// have a domain preview can leave it unset; confirmation then fails safe.
    fn preview(
        &self,
        _context: &BackendRequestContext,
        _call: &ToolCall,
    ) -> Result<Option<super::protocol::MutationPreview>, BackendError> {
        Ok(None)
    }
}

/// Hooks de estado mínimos. Los adaptadores pueden respaldarlos en `.notia`,
/// SQLite u otra persistencia sin que el loop conozca el formato.
pub trait AgentStateHooks: Send + Sync {
    fn load_response(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
    ) -> Result<Option<AgentResponse>, BackendError>;

    fn store_response(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        response: &AgentResponse,
    ) -> Result<(), BackendError>;

    fn load_tool_result(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        call_key: &str,
    ) -> Result<Option<ToolResult>, BackendError>;

    fn store_tool_result(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        call_key: &str,
        result: &ToolResult,
    ) -> Result<(), BackendError>;

    fn load_continuation(
        &self,
        _context: &BackendRequestContext,
        _idempotency_key: &str,
        _operation_id: &str,
    ) -> Result<Option<AgentContinuation>, BackendError> {
        Ok(None)
    }

    fn store_continuation(
        &self,
        _context: &BackendRequestContext,
        _idempotency_key: &str,
        _operation_id: &str,
        _continuation: &AgentContinuation,
    ) -> Result<(), BackendError> {
        Ok(())
    }

    fn clear_continuation(
        &self,
        _context: &BackendRequestContext,
        _idempotency_key: &str,
        _operation_id: &str,
    ) -> Result<(), BackendError> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContinuation {
    pub messages: Vec<ProviderMessage>,
    pub rounds: u32,
    pub pending_call: ToolCall,
    pub tool_results: Vec<ToolResult>,
    #[serde(default)]
    pub preview: Option<super::protocol::MutationPreview>,
}

#[derive(Debug, Default)]
pub struct NoopAgentState;

impl AgentStateHooks for NoopAgentState {
    fn load_response(
        &self,
        _: &BackendRequestContext,
        _: &str,
    ) -> Result<Option<AgentResponse>, BackendError> {
        Ok(None)
    }

    fn store_response(
        &self,
        _: &BackendRequestContext,
        _: &str,
        _: &AgentResponse,
    ) -> Result<(), BackendError> {
        Ok(())
    }

    fn load_tool_result(
        &self,
        _: &BackendRequestContext,
        _: &str,
        _: &str,
    ) -> Result<Option<ToolResult>, BackendError> {
        Ok(None)
    }

    fn store_tool_result(
        &self,
        _: &BackendRequestContext,
        _: &str,
        _: &str,
        _: &ToolResult,
    ) -> Result<(), BackendError> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct AgentRuntimeOptions {
    pub limits: BackendLimits,
    pub max_rounds: u32,
    pub max_provider_retries: u32,
    pub max_tool_retries: u32,
    pub max_empty_responses: u32,
    pub max_pending_action_corrections: u32,
    pub stream_final_response: bool,
    pub projection: ToolCatalogProjection,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentRunResult {
    Completed(AgentResponse),
    Waiting(OperationStatus),
}

impl Default for AgentRuntimeOptions {
    fn default() -> Self {
        let limits = BackendLimits::default();
        Self {
            max_rounds: limits.max_rounds,
            limits,
            max_provider_retries: 1,
            max_tool_retries: 1,
            max_empty_responses: 1,
            max_pending_action_corrections: 2,
            stream_final_response: true,
            projection: ToolCatalogProjection::Full,
        }
    }
}

#[derive(Debug, Clone)]
struct ExecutedTool {
    result: ToolResult,
    retry_count: u32,
}

pub fn run_agent(
    provider: &dyn AgentProvider,
    executor: &dyn ToolExecutor,
    state: &dyn AgentStateHooks,
    events: &dyn BackendEventSink,
    request: &AgentRequest,
    principal: &AuthorizationPrincipal,
    control: &RequestControl,
    options: &AgentRuntimeOptions,
) -> Result<AgentResponse, BackendError> {
    let result = run_agent_inner(
        provider, executor, state, events, request, principal, control, options, None, None, None,
    );
    if let Err(error) = &result {
        if error.code == BackendErrorCode::Cancelled {
            let _ = events.publish(BackendEvent::Cancelled {
                request_id: request.context.request_id.clone(),
            });
        }
    }
    result
}

/// Runs the provider loop with persisted interaction checkpoints. A tool that
/// requires confirmation is converted to a waiting response before its
/// executor is called. The continuation coordinator validates the decision;
/// this function intentionally does not infer domain mutations.
pub fn run_agent_with_interaction(
    provider: &dyn AgentProvider,
    executor: &dyn ToolExecutor,
    state: &dyn AgentStateHooks,
    events: &dyn BackendEventSink,
    request: &AgentRequest,
    principal: &AuthorizationPrincipal,
    control: &RequestControl,
    options: &AgentRuntimeOptions,
    interactions: &InteractionRuntime<'_>,
) -> Result<AgentRunResult, BackendError> {
    if let Some(status) =
        interactions.existing_status_for_request(&request.context, &request.idempotency_key, 0)?
    {
        if matches!(
            status.state,
            super::OperationState::WaitingClarification
                | super::OperationState::WaitingConfirmation
                | super::OperationState::WaitingPlan
        ) {
            return Ok(AgentRunResult::Waiting(status));
        }
    }
    match run_agent_inner(
        provider,
        executor,
        state,
        events,
        request,
        principal,
        control,
        options,
        Some(interactions),
        None,
        None,
    ) {
        Ok(response) => Ok(AgentRunResult::Completed(response)),
        Err(error) if error.code == BackendErrorCode::Conflict && error.operation_id.is_some() => {
            let operation = super::OperationToken {
                operation_id: error.operation_id.clone().expect("operation id"),
                generation: interactions
                    .next_operation_token(&request.context, error.operation_id.as_deref().expect("operation id"))
                    .generation
                    .saturating_sub(1),
            };
            let status = interactions.status_for_operation(
                &request.context,
                &operation,
                &request.idempotency_key,
                0,
            )?;
            Ok(AgentRunResult::Waiting(status))
        }
        Err(error) => Err(error),
    }
}

pub fn run_agent_with_resume(
    provider: &dyn AgentProvider,
    executor: &dyn ToolExecutor,
    state: &dyn AgentStateHooks,
    events: &dyn BackendEventSink,
    request: &AgentRequest,
    principal: &AuthorizationPrincipal,
    control: &RequestControl,
    options: &AgentRuntimeOptions,
    interactions: &InteractionRuntime<'_>,
    operation_id: &str,
    decision: ResumeDecision,
) -> Result<AgentRunResult, BackendError> {
    let continuation = state
        .load_continuation(&request.context, &request.idempotency_key, operation_id)?
        .ok_or_else(|| {
            BackendError::new(
                BackendErrorCode::NotFound,
                "No existe un checkpoint de continuación para la operación.",
                false,
            )
        })?;
    match run_agent_inner(
        provider,
        executor,
        state,
        events,
        request,
        principal,
        control,
        options,
        Some(interactions),
        Some(continuation),
        Some(decision),
    ) {
        Ok(response) => Ok(AgentRunResult::Completed(response)),
        Err(error) if error.code == BackendErrorCode::Conflict && error.operation_id.is_some() => {
            let operation = super::OperationToken {
                operation_id: error.operation_id.clone().expect("operation id"),
                generation: interactions
                    .next_operation_token(&request.context, error.operation_id.as_deref().expect("operation id"))
                    .generation
                    .saturating_sub(1),
            };
            let status = interactions.status_for_operation(
                &request.context,
                &operation,
                &request.idempotency_key,
                0,
            )?;
            Ok(AgentRunResult::Waiting(status))
        }
        Err(error) => Err(error),
    }
}

fn run_agent_inner(
    provider: &dyn AgentProvider,
    executor: &dyn ToolExecutor,
    state: &dyn AgentStateHooks,
    events: &dyn BackendEventSink,
    request: &AgentRequest,
    principal: &AuthorizationPrincipal,
    control: &RequestControl,
    options: &AgentRuntimeOptions,
    interactions: Option<&InteractionRuntime<'_>>,
    continuation: Option<AgentContinuation>,
    resume_decision: Option<ResumeDecision>,
) -> Result<AgentResponse, BackendError> {
    validate_runtime_request(request, principal, options)?;
    control.check()?;
    if let Some(previous) = state.load_response(&request.context, &request.idempotency_key)? {
        return Ok(previous);
    }

    let tools = project_tool_catalog(
        &request.context,
        principal,
        &request.tools,
        options.projection,
    )?;
    let mut messages = continuation
        .as_ref()
        .map(|value| value.messages.clone())
        .unwrap_or_else(|| {
            request
                .messages
                .iter()
                .map(provider_message_from_backend)
                .collect::<Vec<_>>()
        });
    let provider_request = |messages: &[ProviderMessage]| ProviderRequest {
        context: request.context.clone(),
        messages: messages.to_vec(),
        tools: tools.clone(),
    };
    let mut executed = HashMap::<String, ExecutedTool>::new();
    let mut tool_results = continuation
        .as_ref()
        .map(|value| value.tool_results.clone())
        .unwrap_or_default();
    let mut result_indexes = HashMap::<String, usize>::new();
    let mut rounds = continuation.as_ref().map(|value| value.rounds).unwrap_or(0);
    let mut empty_responses = 0;
    let mut pending_action_corrections = 0;
    let mut finance_corrections = 0;
    let mut had_tool_result = false;
    let mut event_count = 0usize;

    if let (Some(continuation), Some(decision)) = (continuation, resume_decision) {
        match decision {
            ResumeDecision::Confirmation(value) if !value.accepted => {
                let response = AgentResponse {
                    request_id: request.context.request_id.clone(),
                    changed: false,
                    rounds,
                    response: channel_response("La operación fue rechazada.".to_string()),
                    tool_results,
                };
                state.store_response(&request.context, &request.idempotency_key, &response)?;
                state.clear_continuation(
                    &request.context,
                    &request.idempotency_key,
                    &continuation.pending_call.id,
                )?;
                return Ok(response);
            }
            ResumeDecision::Confirmation(value) => {
                let pending_tool = tools
                    .iter()
                    .find(|tool| tool.name == continuation.pending_call.name)
                    .ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::Forbidden,
                            "La herramienta pendiente ya no está disponible para esta operación.",
                            false,
                        )
                    })?;
                authorize_tool_call(
                    &request.context,
                    principal,
                    pending_tool,
                    options.projection,
                )?;
                let call_key = tool_call_key(
                    &continuation.pending_call.name,
                    &continuation.pending_call.arguments,
                );
                let result = if let Some(result) = state.load_tool_result(
                    &request.context,
                    &request.idempotency_key,
                    &call_key,
                )? {
                    result
                } else {
                    let result = executor.execute_confirmed(
                        &request.context,
                    &continuation.pending_call,
                    &value,
                    continuation.preview.as_ref(),
                )?;
                    state.store_tool_result(
                        &request.context,
                        &request.idempotency_key,
                        &call_key,
                        &result,
                    )?;
                    result
                };
                append_tool_message(&mut messages, &continuation.pending_call, &result);
                tool_results.push(result);
            }
            ResumeDecision::Clarification(answer) => {
                messages.push(ProviderMessage {
                    role: ProviderMessageRole::User,
                    content: serde_json::json!({
                        "clarificationId": answer.clarification_id,
                        "answer": answer.answer,
                        "optionId": answer.option_id,
                    })
                    .to_string(),
                    images: Vec::new(),
                    tool_calls: Vec::new(),
                    tool_name: None,
                });
            }
            ResumeDecision::Plan(plan) => {
                if !plan.accepted {
                    let response = AgentResponse {
                        request_id: request.context.request_id.clone(),
                        changed: false,
                        rounds,
                        response: channel_response("El plan fue rechazado.".to_string()),
                        tool_results,
                    };
                    state.store_response(&request.context, &request.idempotency_key, &response)?;
                    state.clear_continuation(
                        &request.context,
                        &request.idempotency_key,
                        &continuation.pending_call.id,
                    )?;
                    return Ok(response);
                }
                messages.push(ProviderMessage {
                    role: ProviderMessageRole::User,
                    content: serde_json::json!({
                        "planId": plan.plan_id,
                        "accepted": plan.accepted,
                        "stepIds": plan.step_ids,
                    })
                    .to_string(),
                    images: Vec::new(),
                    tool_calls: Vec::new(),
                    tool_name: None,
                });
            }
        }
        state.clear_continuation(
            &request.context,
            &request.idempotency_key,
            &continuation.pending_call.id,
        )?;
    }

    emit(
        events,
        options,
        &mut event_count,
        BackendEvent::RequestReceived {
            request_id: request.context.request_id.clone(),
        },
    )?;

    while rounds < options.max_rounds.min(options.limits.max_rounds) {
        control.check()?;
        rounds += 1;
        emit(
            events,
            options,
            &mut event_count,
            BackendEvent::RoundStarted {
                request_id: request.context.request_id.clone(),
                round: rounds,
            },
        )?;
        let should_stream = options.stream_final_response && had_tool_result;
        let provider_request = provider_request(&messages);
        let mut streamed_content = false;
        let provider_response = call_provider_with_retry(
            provider,
            &provider_request,
            control,
            options.max_provider_retries,
            should_stream,
            events,
            options,
            &mut event_count,
            &mut streamed_content,
        )?;
        let provider_message = provider_response.message;
        let content = provider_message.content.trim().to_string();
        let calls = provider_message
            .tool_calls
            .iter()
            .enumerate()
            .map(|(index, call)| ToolCall {
                id: if call.id.trim().is_empty() {
                    format!("call-{rounds}-{index}")
                } else {
                    call.id.clone()
                },
                name: call.name.trim().to_string(),
                arguments: call.arguments.clone(),
                round: rounds,
            })
            .collect::<Vec<_>>();
        messages.push(provider_message);

        if calls.is_empty() {
            if content.is_empty() {
                if empty_responses < options.max_empty_responses && rounds < options.max_rounds {
                    empty_responses += 1;
                    messages.push(system_correction(
                        "La ronda anterior no devolvió contenido ni herramientas. Genera una respuesta útil o ejecuta la acción mediante las herramientas disponibles; no finalices vacío.",
                    ));
                    continue;
                }
                return fail(
                    events,
                    options,
                    &mut event_count,
                    request,
                    BackendError::new(
                        BackendErrorCode::ProviderUnavailable,
                        "La IA no devolvió contenido ni solicitó herramientas.",
                        false,
                    ),
                );
            }
            if !tools.is_empty() && contains_pending_action(&content) {
                if pending_action_corrections < options.max_pending_action_corrections
                    && rounds < options.max_rounds
                {
                    pending_action_corrections += 1;
                    messages.push(system_correction(
                        "La respuesta anuncia una acción pendiente pero no solicitó una herramienta. Ejecuta ahora la acción mediante las herramientas disponibles, respetando autorización y confirmaciones, o explica el resultado real sin prometerla.",
                    ));
                    continue;
                }
                return fail(
                    events,
                    options,
                    &mut event_count,
                    request,
                    BackendError::new(
                        BackendErrorCode::Conflict,
                        "El modelo anunció una acción pero no logró ejecutarla.",
                        false,
                    ),
                );
            }
            if request.context.scope == super::context::BackendScope::Finance && !tools.is_empty() {
                let facts = finance_turn_facts(request, &messages, &tool_results);
                if let Some(correction) = super::finance_answer::finance_answer_correction(&content, &facts) {
                    if finance_corrections < options.max_pending_action_corrections && rounds < options.max_rounds {
                        finance_corrections += 1;
                        messages.push(system_correction(correction.message));
                        continue;
                    }
                    if correction.blocking {
                        return fail(
                            events,
                            options,
                            &mut event_count,
                            request,
                            BackendError::new(
                                BackendErrorCode::Conflict,
                                "La respuesta informaba una operación financiera que no se ejecutó.",
                                false,
                            ),
                        );
                    }
                }
            }
            let content = verified_web_citations(content, &tool_results);
            let response = AgentResponse {
                request_id: request.context.request_id.clone(),
                changed: tool_results.iter().any(|result| result.changed),
                rounds,
                response: channel_response(content.clone()),
                tool_results,
            };
            if !streamed_content {
                emit(
                    events,
                    options,
                    &mut event_count,
                    BackendEvent::AssistantDelta {
                        request_id: request.context.request_id.clone(),
                        delta: content,
                    },
                )?;
            }
            state.store_response(&request.context, &request.idempotency_key, &response)?;
            emit(
                events,
                options,
                &mut event_count,
                BackendEvent::Completed {
                    request_id: request.context.request_id.clone(),
                    rounds,
                },
            )?;
            return Ok(response);
        }

        empty_responses = 0;
        pending_action_corrections = 0;
        let mut repeated_call = false;
        let mut seen_call_keys = HashSet::new();
        for call in calls {
            control.check()?;
            let Some(tool) = tools.iter().find(|tool| tool.name == call.name) else {
                let result = ToolResult {
                    call_id: call.id.clone(),
                    ok: false,
                    changed: false,
                    data: None,
                    error: Some(BackendError::new(
                        BackendErrorCode::Forbidden,
                        "La herramienta solicitada no está disponible para esta operación.",
                        false,
                    )),
                    preview: None,
                };
                append_tool_message(&mut messages, &call, &result);
                tool_results.push(result);
                continue;
            };
            let call_key = tool_call_key(&call.name, &call.arguments);
            let authorization =
                authorize_tool_call(&request.context, principal, tool, options.projection);
            let duplicate_in_round = !seen_call_keys.insert(call_key.clone());
            let prior = if let Some(value) = executed.get(&call_key) {
                Some(value.result.clone())
            } else {
                state.load_tool_result(&request.context, &request.idempotency_key, &call_key)?
            };
            let mut should_execute = prior.is_none();
            let mut retry_count = executed
                .get(&call_key)
                .map(|value| value.retry_count)
                .unwrap_or(0);
            if let Some(value) = prior.as_ref() {
                repeated_call = true;
                should_execute = !duplicate_in_round
                    && can_safely_retry(value)
                    && retry_count < options.max_tool_retries;
            }
            if should_execute && authorization.is_ok() {
                if let Some(interactions) = interactions {
                    if call.name == "request_user_clarification" {
                        let operation = interactions.next_operation_token(&request.context, &call.id);
                        let clarification = clarification_from_call(&call, operation)?;
                        state.store_continuation(
                            &request.context,
                            &request.idempotency_key,
                            &call.id,
                            &AgentContinuation {
                                messages: messages.clone(),
                                rounds,
                                pending_call: call.clone(),
                                tool_results: tool_results.clone(),
                                preview: None,
                            },
                        )?;
                        interactions.begin_clarification(
                            &request.context,
                            &request.idempotency_key,
                            clarification,
                            event_count as u64,
                        )?;
                        return Err(interaction_conflict(&call.id));
                    }
                    if call.name == "request_user_confirmation" {
                        let operation = interactions.next_operation_token(&request.context, &call.id);
                        let preview = confirmation_preview_from_call(&call, &operation)?;
                        state.store_continuation(
                            &request.context,
                            &request.idempotency_key,
                            &call.id,
                            &AgentContinuation {
                                messages: messages.clone(),
                                rounds,
                                pending_call: call.clone(),
                                tool_results: tool_results.clone(),
                                preview: Some(preview.clone()),
                            },
                        )?;
                        interactions.begin_confirmation_with_preview(
                            &request.context,
                            &request.idempotency_key,
                            tool,
                            &call,
                            Some(preview),
                            event_count as u64,
                        )?;
                        return Err(interaction_conflict(&call.id));
                    }
                    if matches!(
                        call.name.as_str(),
                        "set_agent_execution_plan"
                            | "set_task_execution_plan"
                            | "create_agent_plan"
                            | "update_agent_plan"
                    ) {
                        let operation = interactions.next_operation_token(&request.context, &call.id);
                        let plan = plan_from_call(&call)?;
                        state.store_continuation(
                            &request.context,
                            &request.idempotency_key,
                            &call.id,
                            &AgentContinuation {
                                messages: messages.clone(),
                                rounds,
                                pending_call: call.clone(),
                                tool_results: tool_results.clone(),
                                preview: None,
                            },
                        )?;
                        interactions.begin_plan(
                            &request.context,
                            &request.idempotency_key,
                            operation,
                            plan,
                            event_count as u64,
                        )?;
                        return Err(interaction_conflict(&call.id));
                    }
                }
            }
            let result = if should_execute {
                if prior.is_some() {
                    retry_count += 1;
                }
                // Preview validates the input before asking the user. Invalid
                // input returns to the model as a failed tool result instead
                // of a confirmation that could only fail after approval.
                let mut preflight_preview = None;
                let mut rejected_input = None;
                if tool.requires_confirmation && authorization.is_ok() && interactions.is_some() {
                    match executor.preview(&request.context, &call) {
                        Ok(preview) => preflight_preview = Some(preview),
                        Err(error) if error.code == BackendErrorCode::InvalidInput => {
                            rejected_input = Some(error)
                        }
                        Err(error) => return Err(error),
                    }
                }
                if tool.requires_confirmation && authorization.is_ok() && rejected_input.is_none() {
                    if let Some(interactions) = interactions {
                        let preview = preflight_preview.flatten();
                        state.store_continuation(
                            &request.context,
                            &request.idempotency_key,
                            &call.id,
                            &AgentContinuation {
                                messages: messages.clone(),
                                rounds,
                                pending_call: call.clone(),
                                tool_results: tool_results.clone(),
                                preview: preview.clone(),
                            },
                        )?;
                        let _ = interactions.begin_confirmation_with_preview(
                            &request.context,
                            &request.idempotency_key,
                            tool,
                            &call,
                            preview,
                            event_count as u64,
                        )?;
                    }
                    emit(
                        events,
                        options,
                        &mut event_count,
                        BackendEvent::ConfirmationRequired {
                            request_id: request.context.request_id.clone(),
                            operation_id: Some(call.id.clone()),
                        },
                    )?;
                    let mut error = BackendError::new(
                        BackendErrorCode::Conflict,
                        "La herramienta requiere confirmación antes de ejecutarse.",
                        true,
                    );
                    error.operation_id = Some(call.id.clone());
                    return Err(error);
                }
                emit(
                    events,
                    options,
                    &mut event_count,
                    BackendEvent::ToolStarted {
                        request_id: request.context.request_id.clone(),
                        tool_name: call.name.clone(),
                        round: rounds,
                    },
                )?;
                let result = match authorization.and_then(|()| rejected_input.map_or(Ok(()), Err)) {
                    Ok(()) => match executor.execute(&request.context, &call) {
                        Ok(mut value) => {
                            value.call_id = call.id.clone();
                            value
                        }
                        Err(error)
                            if matches!(
                                error.code,
                                BackendErrorCode::Cancelled | BackendErrorCode::Timeout
                            ) =>
                        {
                            return fail(events, options, &mut event_count, request, error);
                        }
                        Err(error) => ToolResult {
                            call_id: call.id.clone(),
                            ok: false,
                            changed: false,
                            data: None,
                            error: Some(error),
                            preview: None,
                        },
                    },
                    Err(error) => ToolResult {
                        call_id: call.id.clone(),
                        ok: false,
                        changed: false,
                        data: None,
                        error: Some(error),
                        preview: None,
                    },
                };
                options.limits.validate_result(&result)?;
                state.store_tool_result(
                    &request.context,
                    &request.idempotency_key,
                    &call_key,
                    &result,
                )?;
                executed.insert(
                    call_key.clone(),
                    ExecutedTool {
                        result: result.clone(),
                        retry_count,
                    },
                );
                result
            } else {
                prior.expect("a non-executed tool call has a stored result")
            };
            if result_indexes.contains_key(&call_key) {
                repeated_call = true;
                if let Some(index) = result_indexes.get(&call_key).copied() {
                    tool_results[index] = result.clone();
                }
            } else {
                result_indexes.insert(call_key, tool_results.len());
                tool_results.push(result.clone());
            }
            emit(
                events,
                options,
                &mut event_count,
                BackendEvent::ToolCompleted {
                    request_id: request.context.request_id.clone(),
                    tool_name: call.name.clone(),
                    round: rounds,
                    ok: result.ok,
                    changed: Some(result.changed),
                    operation_id: Some(call.id.clone()),
                },
            )?;
            append_tool_message(&mut messages, &call, &result);
            had_tool_result = true;
        }
        if repeated_call {
            messages.push(system_correction(
                "No repitas una llamada idéntica ya ejecutada en esta operación. Reutiliza el resultado disponible y responde con la evidencia obtenida.",
            ));
        }
    }

    fail(
        events,
        options,
        &mut event_count,
        request,
        BackendError::new(
            BackendErrorCode::Conflict,
            "El agente alcanzó el límite de rondas.",
            false,
        ),
    )
}

fn validate_runtime_request(
    request: &AgentRequest,
    principal: &AuthorizationPrincipal,
    options: &AgentRuntimeOptions,
) -> Result<(), BackendError> {
    options.limits.validate_request(request)?;
    principal.validate()?;
    if request.messages.is_empty() {
        return Err(BackendError::invalid_input(
            "El agente necesita al menos un mensaje.",
        ));
    }
    if options.max_rounds == 0 {
        return Err(BackendError::invalid_input(
            "El límite de rondas debe ser mayor que cero.",
        ));
    }
    if principal.library_id != request.context.library_id
        || principal.library_user_id != request.context.actor.library_user_id
    {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "El actor no pertenece a la biblioteca solicitada.",
            false,
        ));
    }
    if request.snapshot.as_ref().is_some_and(|snapshot| {
        snapshot.library_id != request.context.library_id || snapshot.scope != request.context.scope
    }) {
        return Err(BackendError::new(
            BackendErrorCode::Conflict,
            "El snapshot no pertenece al contexto solicitado.",
            false,
        ));
    }
    Ok(())
}

fn call_provider_with_retry(
    provider: &dyn AgentProvider,
    request: &ProviderRequest,
    control: &RequestControl,
    max_retries: u32,
    stream: bool,
    events: &dyn BackendEventSink,
    options: &AgentRuntimeOptions,
    event_count: &mut usize,
    streamed_content: &mut bool,
) -> Result<ProviderResponse, BackendError> {
    let mut attempts = 0;
    loop {
        control.check()?;
        let result = if stream {
            let mut on_delta = |delta: ProviderStreamDelta| match delta {
                ProviderStreamDelta::Thinking(summary) => emit(
                    events,
                    options,
                    event_count,
                    BackendEvent::ThinkingSummary {
                        request_id: request.context.request_id.clone(),
                        summary,
                    },
                ),
                ProviderStreamDelta::Content(delta) => {
                    *streamed_content = true;
                    emit(
                        events,
                        options,
                        event_count,
                        BackendEvent::AssistantDelta {
                            request_id: request.context.request_id.clone(),
                            delta,
                        },
                    )
                }
            };
            provider.stream_chat(request, control, &mut on_delta)
        } else if request.tools.is_empty() {
            provider.chat(request, control)
        } else {
            provider.tool_chat(request, control)
        };
        match result {
            Ok(response) => return Ok(response),
            Err(error) if error.retryable && attempts < max_retries && !*streamed_content => {
                attempts += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn provider_message_from_backend(message: &BackendMessage) -> ProviderMessage {
    let (content, attachment_images) =
        super::chat_attachments::compose_message(&message.content, &message.attachments);
    let images = message.images.iter().cloned().chain(attachment_images).collect();
    ProviderMessage {
        role: match message.role {
            MessageRole::System => ProviderMessageRole::System,
            MessageRole::User => ProviderMessageRole::User,
            MessageRole::Assistant => ProviderMessageRole::Assistant,
        },
        content,
        images,
        tool_calls: Vec::new(),
        tool_name: None,
    }
}

fn append_tool_message(messages: &mut Vec<ProviderMessage>, call: &ToolCall, result: &ToolResult) {
    let content = serde_json::to_string(result).unwrap_or_else(|_| "{\"ok\":false}".into());
    messages.push(ProviderMessage {
        role: ProviderMessageRole::Tool,
        content,
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_name: Some(call.name.clone()),
    });
}

/// What a finance turn executed, for the final answer verification.
fn finance_turn_facts(
    request: &AgentRequest,
    messages: &[ProviderMessage],
    tool_results: &[ToolResult],
) -> super::finance_answer::FinanceTurnFacts {
    let names = messages
        .iter()
        .flat_map(|message| message.tool_calls.iter())
        .map(|call| (call.id.as_str(), call.name.as_str()))
        .collect::<HashMap<_, _>>();
    let document_received = request.context.channel == super::context::BackendChannel::Telegram
        && (!request.attachments.is_empty() || request.messages.iter().any(|message| !message.images.is_empty() || !message.attachments.is_empty()));
    super::finance_answer::FinanceTurnFacts {
        mutation_executed: tool_results.iter().any(|result| result.changed),
        clarification_requested: names.values().any(|name| *name == "request_user_clarification"),
        document_received,
        changed_tools: tool_results
            .iter()
            .filter(|result| result.changed)
            .filter_map(|result| names.get(result.call_id.as_str()).map(|name| name.to_string()))
            .collect(),
    }
}

fn system_correction(content: &str) -> ProviderMessage {
    ProviderMessage {
        role: ProviderMessageRole::System,
        content: format!("Corrección interna del runtime. No la muestres al usuario.\n{content}"),
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_name: None,
    }
}

fn can_safely_retry(result: &ToolResult) -> bool {
    !result.ok && !result.changed && result.error.as_ref().is_some_and(|error| error.retryable)
}

fn interaction_conflict(operation_id: &str) -> BackendError {
    let mut error = BackendError::new(
        BackendErrorCode::Conflict,
        "La operación espera una decisión del usuario.",
        true,
    );
    error.operation_id = Some(operation_id.to_string());
    error
}

fn clarification_from_call(
    call: &ToolCall,
    operation: OperationToken,
) -> Result<ClarificationRequest, BackendError> {
    let question = call
        .arguments
        .get("question")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| BackendError::invalid_input("La aclaración necesita una pregunta."))?;
    let options = call
        .arguments
        .get("options")
        .cloned()
        .map(serde_json::from_value::<Vec<ClarificationOption>>)
        .transpose()
        .map_err(|_| BackendError::invalid_input("Las opciones de aclaración no son válidas."))?
        .unwrap_or_default();
    Ok(ClarificationRequest {
        clarification_id: call.id.clone(),
        operation,
        question: question.to_string(),
        options,
        allow_free_text: call
            .arguments
            .get("allowFreeText")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
    })
}

fn confirmation_preview_from_call(
    call: &ToolCall,
    operation: &OperationToken,
) -> Result<MutationPreview, BackendError> {
    let summary = call
        .arguments
        .get("question")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("El agente solicita confirmación.");
    Ok(MutationPreview {
        operation_id: operation.operation_id.clone(),
        summary: summary.to_string(),
        documents: Vec::new(),
        hunks: vec![PreviewHunk {
            id: call.id.clone(),
            document_path: "interaction".to_string(),
            start_line: 1,
            end_line: 1,
            old_text: String::new(),
            new_text: serde_json::to_string(&call.arguments)
                .map_err(|_| BackendError::invalid_input("La confirmación no es serializable."))?,
        }],
        allowed_actions: vec![
            MutationPreviewAction::ApplyAll,
            MutationPreviewAction::Reject,
            MutationPreviewAction::Cancel,
        ],
    })
}

/// Builds an execution plan from the model-facing schema: `steps` as plain
/// labels or objects with `label` (and optional `id`/`description`). The plan
/// identity, generation and statuses are always assigned by the backend. A
/// complete internal `plan` object is still accepted for replayed requests.
/// When the request used web search, the final answer may only cite URLs
/// returned by that search; any other URL is replaced before persisting.
fn verified_web_citations(content: String, tool_results: &[ToolResult]) -> String {
    let mut searched = false;
    let mut returned = HashSet::new();
    for result in tool_results {
        let Some(data) = result.data.as_ref() else { continue };
        if data.get("searchedQuery").is_none() {
            continue;
        }
        searched = true;
        for item in data
            .get("results")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(url) = item.get("url").and_then(serde_json::Value::as_str) {
                returned.insert(url.to_string());
            }
        }
    }
    if searched {
        super::web_search::strip_unverified_citations(&content, &returned)
    } else {
        content
    }
}

fn plan_from_call(call: &ToolCall) -> Result<super::ExecutionPlan, BackendError> {
    use super::interaction::{PlanStatus, PlanStep, PlanStepStatus};

    if let Some(plan) = call.arguments.get("plan") {
        return serde_json::from_value(plan.clone())
            .map_err(|_| BackendError::invalid_input("El plan de ejecución no es válido."));
    }
    let invalid = || BackendError::invalid_input("El plan de ejecución no es válido.");
    let steps = call
        .arguments
        .get("steps")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(invalid)?
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let (id, label) = match step {
                serde_json::Value::String(label) => (None, label.trim().to_string()),
                serde_json::Value::Object(object) => (
                    object
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                    object
                        .get("label")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_string(),
                ),
                _ => return Err(invalid()),
            };
            if label.is_empty() {
                return Err(invalid());
            }
            Ok(PlanStep {
                id: id.unwrap_or_else(|| format!("step-{}", index + 1)),
                label,
                operation_id: None,
                status: PlanStepStatus::Pending,
            })
        })
        .collect::<Result<Vec<_>, BackendError>>()?;
    let title = call
        .arguments
        .get("title")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Plan de ejecución")
        .to_string();
    Ok(super::ExecutionPlan {
        plan_id: call.id.clone(),
        generation: 1,
        title,
        status: PlanStatus::AwaitingApproval,
        steps,
    })
}

pub fn tool_call_key(name: &str, arguments: &serde_json::Value) -> String {
    format!("{}:{}", name.trim(), canonical_json(arguments))
}

fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(object) => {
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            let body = entries
                .into_iter()
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_default(),
                        canonical_json(value)
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
        serde_json::Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        _ => serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
    }
}

pub fn contains_pending_action(value: &str) -> bool {
    let without_code = value
        .split("```")
        .enumerate()
        .filter(|(index, _)| index % 2 == 0)
        .map(|(_, part)| part)
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    [
        "voy a insertar",
        "voy a crear",
        "voy a modificar",
        "voy a guardar",
        "ahora insertar",
        "ahora crear",
        "procederé a",
        "proceed to",
        "i will create",
        "i'm going to create",
    ]
    .iter()
    .any(|marker| without_code.contains(marker))
}

fn emit(
    events: &dyn BackendEventSink,
    options: &AgentRuntimeOptions,
    event_count: &mut usize,
    event: BackendEvent,
) -> Result<(), BackendError> {
    *event_count += 1;
    options.limits.validate_event_count(*event_count)?;
    events.publish(event)
}

fn fail(
    events: &dyn BackendEventSink,
    options: &AgentRuntimeOptions,
    event_count: &mut usize,
    request: &AgentRequest,
    error: BackendError,
) -> Result<AgentResponse, BackendError> {
    if error.code != BackendErrorCode::Cancelled {
        let _ = events.publish(BackendEvent::Failed {
            request_id: request.context.request_id.clone(),
            error: error.clone(),
        });
    }
    let _ = options.limits.validate_event_count(*event_count + 1);
    Err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::ToolPolicy;
    use crate::interaction::OperationReview;
    use crate::{
        BackendActor, BackendChannel, BackendScope, OperationState, PersistencePolicy, VecEventSink,
    };
    use std::sync::Mutex;

    fn request(tools: Vec<ToolDefinition>) -> AgentRequest {
        AgentRequest {
            context: BackendRequestContext {
                request_id: "request-1".into(),
                library_id: "library-1".into(),
                actor: BackendActor {
                    library_user_id: "user-owner".into(),
                    external_identity: None,
                },
                channel: BackendChannel::App,
                scope: BackendScope::Library,
                persistence_policy: PersistencePolicy::Persistent,
            },
            messages: vec![BackendMessage {
                role: MessageRole::User,
                content: "hola".into(),
                images: Vec::new(),
                attachments: Vec::new(),
            }],
            snapshot: None,
            tools,
            attachments: Vec::new(),
            idempotency_key: "idem-1".into(),
            prompt_name: None,
        }
    }

    fn tool(name: &str, read_only: bool) -> ToolDefinition {
        ToolDefinition {
            name: name.into(),
            description: "test".into(),
            input_schema: serde_json::json!({"type": "object"}),
            scopes: vec![BackendScope::Library],
            read_only,
            requires_confirmation: false,
        }
    }

    fn principal() -> AuthorizationPrincipal {
        AuthorizationPrincipal {
            library_id: "library-1".into(),
            library_user_id: "user-owner".into(),
            allowed_contexts: vec!["#Confidencial".into()],
            all_contexts: true,
        }
    }

    struct Provider {
        responses: Mutex<Vec<ProviderResponse>>,
        calls: Mutex<usize>,
    }

    impl Provider {
        fn next(&self) -> Result<ProviderResponse, BackendError> {
            *self.calls.lock().expect("calls") += 1;
            Ok(self.responses.lock().expect("responses").remove(0))
        }
    }

    impl AgentProvider for Provider {
        fn chat(
            &self,
            _: &ProviderRequest,
            _: &RequestControl,
        ) -> Result<ProviderResponse, BackendError> {
            self.next()
        }
        fn stream_chat(
            &self,
            _: &ProviderRequest,
            _: &RequestControl,
            on_delta: &mut dyn FnMut(ProviderStreamDelta) -> Result<(), BackendError>,
        ) -> Result<ProviderResponse, BackendError> {
            let response = self.next()?;
            if !response.message.content.is_empty() {
                on_delta(ProviderStreamDelta::Content(
                    response.message.content.clone(),
                ))?;
            }
            Ok(response)
        }
        fn tool_chat(
            &self,
            _: &ProviderRequest,
            _: &RequestControl,
        ) -> Result<ProviderResponse, BackendError> {
            self.next()
        }
    }

    struct Executor {
        executions: Mutex<usize>,
        result: ToolResult,
    }

    impl ToolExecutor for Executor {
        fn execute(
            &self,
            _: &BackendRequestContext,
            call: &ToolCall,
        ) -> Result<ToolResult, BackendError> {
            *self.executions.lock().expect("executions") += 1;
            let mut result = self.result.clone();
            result.call_id = call.id.clone();
            Ok(result)
        }
    }

    #[derive(Default)]
    struct InteractionState {
        review: Mutex<Option<OperationReview>>,
    }

    impl super::super::OperationStatePort for InteractionState {
        fn load_operation(
            &self,
            _: &BackendRequestContext,
            operation_id: &str,
            _: &str,
        ) -> Result<Option<OperationReview>, BackendError> {
            Ok(self
                .review
                .lock()
                .expect("review lock")
                .clone()
                .filter(|review| review.operation.operation_id == operation_id))
        }

        fn store_operation(
            &self,
            _: &BackendRequestContext,
            _: &str,
            review: &OperationReview,
        ) -> Result<(), BackendError> {
            *self.review.lock().expect("review lock") = Some(review.clone());
            Ok(())
        }

        fn load_operation_for_request(
            &self,
            _: &BackendRequestContext,
            _: &str,
        ) -> Result<Option<OperationReview>, BackendError> {
            Ok(self.review.lock().expect("review lock").clone())
        }
    }

    #[test]
    fn runs_tool_round_then_streams_the_final_response() {
        let provider = Provider {
            responses: Mutex::new(vec![
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: String::new(),
                        images: Vec::new(),
                        tool_calls: vec![ProviderToolCall {
                            id: "call-1".into(),
                            name: "read_library_documents".into(),
                            arguments: serde_json::json!({"documentId": "one"}),
                        }],
                        tool_name: None,
                    },
                },
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: "respuesta".into(),
                        images: Vec::new(),
                        tool_calls: Vec::new(),
                        tool_name: None,
                    },
                },
            ]),
            calls: Mutex::new(0),
        };
        let executor = Executor {
            executions: Mutex::new(0),
            result: ToolResult {
                call_id: String::new(),
                ok: true,
                changed: false,
                data: Some(serde_json::json!({"ok": true})),
                error: None,
                preview: None,
            },
        };
        let events = VecEventSink::default();
        let response = run_agent(
            &provider,
            &executor,
            &NoopAgentState,
            &events,
            &request(vec![tool("read_library_documents", true)]),
            &principal(),
            &RequestControl::new(None),
            &AgentRuntimeOptions::default(),
        )
        .expect("agent completes");
        assert_eq!(response.response.markdown, "respuesta");
        assert_eq!(*executor.executions.lock().expect("executions"), 1);
        assert!(events
            .events()
            .iter()
            .any(|event| matches!(event, BackendEvent::AssistantDelta { .. })));
    }

    #[test]
    fn does_not_execute_an_identical_mutation_twice() {
        let repeated_call = ProviderToolCall {
            id: "call-1".into(),
            name: "create_note".into(),
            arguments: serde_json::json!({"b": 2, "a": 1}),
        };
        let repeated_call_again = ProviderToolCall {
            id: "call-2".into(),
            name: "create_note".into(),
            arguments: serde_json::json!({"a": 1, "b": 2}),
        };
        let provider = Provider {
            responses: Mutex::new(vec![
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: String::new(),
                        images: Vec::new(),
                        tool_calls: vec![repeated_call],
                        tool_name: None,
                    },
                },
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: String::new(),
                        images: Vec::new(),
                        tool_calls: vec![repeated_call_again],
                        tool_name: None,
                    },
                },
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: "hecho".into(),
                        images: Vec::new(),
                        tool_calls: Vec::new(),
                        tool_name: None,
                    },
                },
            ]),
            calls: Mutex::new(0),
        };
        let executor = Executor {
            executions: Mutex::new(0),
            result: ToolResult {
                call_id: String::new(),
                ok: true,
                changed: true,
                data: None,
                error: None,
                preview: None,
            },
        };
        let mut options = AgentRuntimeOptions::default();
        options.stream_final_response = false;
        let response = run_agent(
            &provider,
            &executor,
            &NoopAgentState,
            &VecEventSink::default(),
            &request(vec![tool("create_note", false)]),
            &principal(),
            &RequestControl::new(None),
            &options,
        )
        .expect("agent completes");
        assert_eq!(response.response.markdown, "hecho");
        assert_eq!(*executor.executions.lock().expect("executions"), 1);
    }

    #[test]
    fn pauses_before_a_tool_that_requires_confirmation() {
        let provider = Provider {
            responses: Mutex::new(vec![ProviderResponse {
                message: ProviderMessage {
                    role: ProviderMessageRole::Assistant,
                    content: String::new(),
                    images: Vec::new(),
                    tool_calls: vec![ProviderToolCall {
                        id: "operation-1".into(),
                        name: "create_note".into(),
                        arguments: serde_json::json!({"path": "note.md"}),
                    }],
                    tool_name: None,
                },
            }]),
            calls: Mutex::new(0),
        };
        let executor = Executor {
            executions: Mutex::new(0),
            result: ToolResult {
                call_id: String::new(),
                ok: true,
                changed: true,
                data: None,
                error: None,
                preview: None,
            },
        };
        let mut request = request(vec![tool("create_note", false)]);
        request.tools[0].requires_confirmation = true;
        let events = VecEventSink::default();
        let error = run_agent(
            &provider,
            &executor,
            &NoopAgentState,
            &events,
            &request,
            &principal(),
            &RequestControl::new(None),
            &AgentRuntimeOptions::default(),
        )
        .expect_err("confirmation is required");
        assert_eq!(error.code, BackendErrorCode::Conflict);
        assert_eq!(error.operation_id.as_deref(), Some("operation-1"));
        assert_eq!(*executor.executions.lock().expect("executions"), 0);
        assert!(events.events().iter().any(|event| matches!(
            event,
            BackendEvent::ConfirmationRequired {
                operation_id: Some(operation_id),
                ..
            } if operation_id == "operation-1"
        )));
    }

    #[test]
    fn interactive_runtime_persists_waiting_confirmation_before_executor() {
        let provider = Provider {
            responses: Mutex::new(vec![ProviderResponse {
                message: ProviderMessage {
                    role: ProviderMessageRole::Assistant,
                    content: String::new(),
                    images: Vec::new(),
                    tool_calls: vec![ProviderToolCall {
                        id: "operation-1".into(),
                        name: "create_note".into(),
                        arguments: serde_json::json!({"path": "note.md"}),
                    }],
                    tool_name: None,
                },
            }]),
            calls: Mutex::new(0),
        };
        let executor = Executor {
            executions: Mutex::new(0),
            result: ToolResult {
                call_id: String::new(),
                ok: true,
                changed: true,
                data: None,
                error: None,
                preview: None,
            },
        };
        let mut request = request(vec![tool("create_note", false)]);
        request.tools[0].requires_confirmation = true;
        let state = InteractionState::default();
        let generations = crate::OperationGenerationCache::default();
        let interactions = crate::InteractionRuntime::new(&state, None, None, &generations);
        let result = run_agent_with_interaction(
            &provider,
            &executor,
            &NoopAgentState,
            &VecEventSink::default(),
            &request,
            &principal(),
            &RequestControl::new(None),
            &AgentRuntimeOptions::default(),
            &interactions,
        )
        .expect("waiting is a successful control result");
        assert!(
            matches!(result, AgentRunResult::Waiting(status) if status.state == OperationState::WaitingConfirmation)
        );
        assert_eq!(*executor.executions.lock().expect("executions"), 0);
        assert!(state.review.lock().expect("review lock").is_some());
    }

    #[test]
    fn retries_only_a_retryable_unchanged_tool_failure() {
        let call = ProviderToolCall {
            id: "call-1".into(),
            name: "read_library_documents".into(),
            arguments: serde_json::json!({}),
        };
        let provider = Provider {
            responses: Mutex::new(vec![
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: String::new(),
                        images: Vec::new(),
                        tool_calls: vec![call.clone()],
                        tool_name: None,
                    },
                },
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: String::new(),
                        images: Vec::new(),
                        tool_calls: vec![call],
                        tool_name: None,
                    },
                },
                ProviderResponse {
                    message: ProviderMessage {
                        role: ProviderMessageRole::Assistant,
                        content: "recovered".into(),
                        images: Vec::new(),
                        tool_calls: Vec::new(),
                        tool_name: None,
                    },
                },
            ]),
            calls: Mutex::new(0),
        };
        struct RetryExecutor {
            calls: Mutex<usize>,
        }
        impl ToolExecutor for RetryExecutor {
            fn execute(
                &self,
                _: &BackendRequestContext,
                call: &ToolCall,
            ) -> Result<ToolResult, BackendError> {
                let mut calls = self.calls.lock().expect("calls");
                *calls += 1;
                Ok(ToolResult {
                    call_id: call.id.clone(),
                    ok: false,
                    changed: false,
                    data: None,
                    error: Some(BackendError::new(
                        BackendErrorCode::ProviderUnavailable,
                        "temporary",
                        true,
                    )),
                    preview: None,
                })
            }
        }
        let executor = RetryExecutor {
            calls: Mutex::new(0),
        };
        let result = run_agent(
            &provider,
            &executor,
            &NoopAgentState,
            &VecEventSink::default(),
            &request(vec![tool("read_library_documents", true)]),
            &principal(),
            &RequestControl::new(None),
            &AgentRuntimeOptions::default(),
        )
        .expect("agent completes");
        assert_eq!(result.response.markdown, "recovered");
        assert_eq!(*executor.calls.lock().expect("calls"), 2);
    }

    #[test]
    fn validates_canonical_tool_keys_and_pending_action_corrections() {
        assert_eq!(
            tool_call_key("tool", &serde_json::json!({"b": 2, "a": 1})),
            tool_call_key("tool", &serde_json::json!({"a": 1, "b": 2}))
        );
        assert!(contains_pending_action("Ahora crearé la nota."));
        assert!(!contains_pending_action("```Ahora crearé la nota```"));
        assert_eq!(
            crate::catalog::tool_policy("get_finance_dashboard"),
            ToolPolicy::FinanceRead
        );
    }

    #[test]
    fn propagates_cancellation_and_publishes_a_cancelled_event() {
        struct CancellingProvider;
        impl AgentProvider for CancellingProvider {
            fn chat(
                &self,
                _: &ProviderRequest,
                control: &RequestControl,
            ) -> Result<ProviderResponse, BackendError> {
                control.cancel();
                Err(BackendError::cancelled())
            }
            fn stream_chat(
                &self,
                _: &ProviderRequest,
                _: &RequestControl,
                _: &mut dyn FnMut(ProviderStreamDelta) -> Result<(), BackendError>,
            ) -> Result<ProviderResponse, BackendError> {
                Err(BackendError::cancelled())
            }
            fn tool_chat(
                &self,
                _: &ProviderRequest,
                control: &RequestControl,
            ) -> Result<ProviderResponse, BackendError> {
                control.cancel();
                Err(BackendError::cancelled())
            }
        }
        let events = VecEventSink::default();
        let result = run_agent(
            &CancellingProvider,
            &Executor {
                executions: Mutex::new(0),
                result: ToolResult {
                    call_id: String::new(),
                    ok: true,
                    changed: false,
                    data: None,
                    error: None,
                    preview: None,
                },
            },
            &NoopAgentState,
            &events,
            &request(Vec::new()),
            &principal(),
            &RequestControl::new(None),
            &AgentRuntimeOptions::default(),
        );
        assert_eq!(
            result.expect_err("request is cancelled").code,
            BackendErrorCode::Cancelled
        );
        assert!(events
            .events()
            .iter()
            .any(|event| matches!(event, BackendEvent::Cancelled { .. })));
    }

    #[test]
    fn invalid_preview_input_returns_to_the_model_without_confirmation() {
        struct RejectingExecutor {
            executions: Mutex<usize>,
        }

        impl ToolExecutor for RejectingExecutor {
            fn execute(
                &self,
                _: &BackendRequestContext,
                _: &ToolCall,
            ) -> Result<ToolResult, BackendError> {
                *self.executions.lock().expect("executions") += 1;
                Err(BackendError::new(BackendErrorCode::Internal, "must not execute", false))
            }

            fn preview(
                &self,
                _: &BackendRequestContext,
                _: &ToolCall,
            ) -> Result<Option<crate::protocol::MutationPreview>, BackendError> {
                Err(BackendError::invalid_input("Falta accountId."))
            }
        }

        let message = |content: &str, tool_calls: Vec<ProviderToolCall>| ProviderResponse {
            message: ProviderMessage {
                role: ProviderMessageRole::Assistant,
                content: content.into(),
                images: Vec::new(),
                tool_calls,
                tool_name: None,
            },
        };
        let provider = Provider {
            responses: Mutex::new(vec![
                message(
                    "",
                    vec![ProviderToolCall {
                        id: "call-1".into(),
                        name: "create_note".into(),
                        arguments: serde_json::json!({"title": "x"}),
                    }],
                ),
                message("Falta la cuenta.", Vec::new()),
            ]),
            calls: Mutex::new(0),
        };
        let executor = RejectingExecutor {
            executions: Mutex::new(0),
        };
        let mut mutation = tool("create_note", false);
        mutation.requires_confirmation = true;
        let state = InteractionState::default();
        let generations = crate::interaction::OperationGenerationCache::default();
        let interactions = InteractionRuntime::new(&state, None, None, &generations);
        let result = run_agent_with_interaction(
            &provider,
            &executor,
            &NoopAgentState,
            &VecEventSink::default(),
            &request(vec![mutation]),
            &principal(),
            &RequestControl::new(None),
            &AgentRuntimeOptions::default(),
            &interactions,
        )
        .expect("agent completes");
        assert!(matches!(result, AgentRunResult::Completed(response) if response.response.markdown == "Falta la cuenta."));
        assert_eq!(*executor.executions.lock().expect("executions"), 0);
        assert!(state.review.lock().expect("review").is_none());
    }

    #[test]
    fn builds_a_plan_from_labels_or_step_objects() {
        let call = ToolCall {
            id: "call-plan".into(),
            name: "set_agent_execution_plan".into(),
            round: 1,
            arguments: serde_json::json!({
                "steps": ["Leer la nota", {"id": "write", "label": "Actualizar la nota"}]
            }),
        };
        let plan = plan_from_call(&call).expect("plan");
        assert_eq!(plan.plan_id, "call-plan");
        assert_eq!(plan.generation, 1);
        assert_eq!(plan.steps[0].id, "step-1");
        assert_eq!(plan.steps[1].id, "write");
        assert!(plan.validate().is_ok());
        let empty = ToolCall {
            arguments: serde_json::json!({"steps": ["  "]}),
            ..call
        };
        assert!(plan_from_call(&empty).is_err());
    }
}
