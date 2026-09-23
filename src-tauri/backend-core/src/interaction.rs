use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::context::BackendRequestContext;
use super::error::{BackendError, BackendErrorCode};
use super::isolation::InFlightRegistry;
use super::protocol::{
    ConfirmationDecision, MutationPreview, MutationPreviewAction, OperationState, ToolCall,
    ToolDefinition, ToolResult,
};

const MAX_INTERACTION_TEXT: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationToken {
    pub operation_id: String,
    pub generation: u64,
}

impl OperationToken {
    pub fn validate(&self) -> Result<(), BackendError> {
        validate_identifier("operationId", &self.operation_id, 256)?;
        if self.generation == 0 {
            return Err(BackendError::invalid_input(
                "La generación de la operación debe ser mayor que cero.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationOption {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationRequest {
    pub clarification_id: String,
    pub operation: OperationToken,
    pub question: String,
    #[serde(default)]
    pub options: Vec<ClarificationOption>,
    pub allow_free_text: bool,
}

impl ClarificationRequest {
    pub fn validate(&self) -> Result<(), BackendError> {
        validate_identifier("clarificationId", &self.clarification_id, 256)?;
        self.operation.validate()?;
        validate_identifier("question", &self.question, MAX_INTERACTION_TEXT)?;
        let mut ids = std::collections::HashSet::new();
        for option in &self.options {
            validate_identifier("optionId", &option.id, 256)?;
            validate_identifier("optionLabel", &option.label, MAX_INTERACTION_TEXT)?;
            if !ids.insert(&option.id) {
                return Err(BackendError::invalid_input(
                    "La aclaración contiene opciones repetidas.",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationAnswer {
    pub clarification_id: String,
    pub operation: OperationToken,
    pub answer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationRequest {
    pub operation: OperationToken,
    pub preview: MutationPreview,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmationSelection {
    Reject,
    ApplyAll,
    ApplySelected,
}

pub fn transition_operation_state(
    from: OperationState,
    to: OperationState,
) -> Result<OperationState, BackendError> {
    let valid = matches!(
        (from, to),
        (OperationState::Pending, OperationState::Running)
            | (
                OperationState::Pending,
                OperationState::WaitingClarification
            )
            | (OperationState::Pending, OperationState::WaitingConfirmation)
            | (OperationState::Pending, OperationState::WaitingPlan)
            | (OperationState::Pending, OperationState::Cancelled)
            | (OperationState::Pending, OperationState::Failed)
            | (
                OperationState::Running,
                OperationState::WaitingClarification
            )
            | (OperationState::Running, OperationState::WaitingConfirmation)
            | (OperationState::Running, OperationState::WaitingPlan)
            | (OperationState::Running, OperationState::Completed)
            | (OperationState::Running, OperationState::Cancelled)
            | (OperationState::Running, OperationState::Failed)
            | (
                OperationState::WaitingClarification,
                OperationState::Running
            )
            | (
                OperationState::WaitingClarification,
                OperationState::Cancelled
            )
            | (OperationState::WaitingClarification, OperationState::Failed)
            | (OperationState::WaitingConfirmation, OperationState::Running)
            | (
                OperationState::WaitingConfirmation,
                OperationState::Cancelled
            )
            | (OperationState::WaitingConfirmation, OperationState::Failed)
            | (OperationState::WaitingPlan, OperationState::Running)
            | (OperationState::WaitingPlan, OperationState::Cancelled)
            | (OperationState::WaitingPlan, OperationState::Failed)
    ) || from == to;
    if valid {
        Ok(to)
    } else {
        Err(BackendError::new(
            BackendErrorCode::Conflict,
            "La transición de la operación no es válida.",
            false,
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanStatus {
    Draft,
    AwaitingApproval,
    Running,
    Completed,
    Blocked,
    Rejected,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlanStepStatus {
    Pending,
    Running,
    Completed,
    Blocked,
    Rejected,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    pub status: PlanStepStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPlan {
    pub plan_id: String,
    pub generation: u64,
    pub title: String,
    pub status: PlanStatus,
    pub steps: Vec<PlanStep>,
}

impl ExecutionPlan {
    pub fn validate(&self) -> Result<(), BackendError> {
        validate_identifier("planId", &self.plan_id, 256)?;
        validate_identifier("title", &self.title, MAX_INTERACTION_TEXT)?;
        if self.generation == 0 || self.steps.is_empty() {
            return Err(BackendError::invalid_input(
                "El plan debe tener una generación y al menos un paso.",
            ));
        }
        let mut ids = std::collections::HashSet::new();
        for step in &self.steps {
            validate_identifier("stepId", &step.id, 256)?;
            validate_identifier("stepLabel", &step.label, MAX_INTERACTION_TEXT)?;
            if !ids.insert(&step.id) {
                return Err(BackendError::invalid_input(
                    "El plan contiene pasos duplicados.",
                ));
            }
        }
        Ok(())
    }

    pub fn set_status(&mut self, status: PlanStatus) -> Result<(), BackendError> {
        self.validate()?;
        if !valid_plan_transition(self.status, status) {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "La transición del plan no es válida.",
                false,
            ));
        }
        self.status = status;
        Ok(())
    }

    pub fn set_step_status(
        &mut self,
        step_id: &str,
        status: PlanStepStatus,
    ) -> Result<(), BackendError> {
        self.validate()?;
        let step = self
            .steps
            .iter_mut()
            .find(|step| step.id == step_id)
            .ok_or_else(|| {
                BackendError::new(BackendErrorCode::NotFound, "El paso no existe.", false)
            })?;
        if !valid_step_transition(step.status, status) {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "La transición del paso no es válida.",
                false,
            ));
        }
        step.status = status;
        Ok(())
    }
}

fn valid_plan_transition(from: PlanStatus, to: PlanStatus) -> bool {
    matches!(
        (from, to),
        (PlanStatus::Draft, PlanStatus::AwaitingApproval)
            | (PlanStatus::AwaitingApproval, PlanStatus::Running)
            | (PlanStatus::AwaitingApproval, PlanStatus::Rejected)
            | (PlanStatus::Running, PlanStatus::Completed)
            | (PlanStatus::Running, PlanStatus::Blocked)
            | (PlanStatus::Running, PlanStatus::Cancelled)
    ) || from == to
}

fn valid_step_transition(from: PlanStepStatus, to: PlanStepStatus) -> bool {
    matches!(
        (from, to),
        (PlanStepStatus::Pending, PlanStepStatus::Running)
            | (PlanStepStatus::Pending, PlanStepStatus::Cancelled)
            | (PlanStepStatus::Running, PlanStepStatus::Completed)
            | (PlanStepStatus::Running, PlanStepStatus::Blocked)
            | (PlanStepStatus::Running, PlanStepStatus::Cancelled)
    ) || from == to
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationReview {
    pub operation: OperationToken,
    pub state: OperationState,
    pub changed: bool,
    pub can_undo: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<MutationPreview>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clarification: Option<ClarificationRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<ExecutionPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRequest {
    pub operation: OperationToken,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub operation: OperationToken,
    pub result: ToolResult,
}

pub fn validate_clarification_answer(
    request: &ClarificationRequest,
    answer: &ClarificationAnswer,
) -> Result<String, BackendError> {
    request.operation.validate()?;
    if request.clarification_id != answer.clarification_id || request.operation != answer.operation
    {
        return stale_interaction("La respuesta de aclaración ya no corresponde a la operación.");
    }
    let answer_text = answer.answer.trim();
    if answer_text.chars().count() > MAX_INTERACTION_TEXT
        || answer_text.chars().any(char::is_control)
    {
        return Err(BackendError::invalid_input(
            "La respuesta de aclaración no es válida.",
        ));
    }
    if let Some(option_id) = &answer.option_id {
        if request.options.iter().all(|option| &option.id != option_id) {
            return Err(BackendError::invalid_input(
                "La opción de aclaración no es válida.",
            ));
        }
    } else if !request.allow_free_text || answer_text.is_empty() {
        return Err(BackendError::invalid_input(
            "La aclaración requiere una opción válida.",
        ));
    }
    Ok(answer_text.to_string())
}

pub fn validate_confirmation(
    decision: &ConfirmationDecision,
    request: &ConfirmationRequest,
    current_revisions: &BTreeMap<String, u64>,
) -> Result<ConfirmationSelection, BackendError> {
    request.operation.validate()?;
    if decision.operation_id != request.operation.operation_id
        || request.preview.operation_id != request.operation.operation_id
    {
        return stale_interaction("La decisión de confirmación ya no corresponde a la operación.");
    }
    if !decision.accepted && !decision.hunk_ids.is_empty() {
        return Err(BackendError::invalid_input(
            "Una decisión rechazada no puede seleccionar cambios.",
        ));
    }
    let selection = if !decision.accepted {
        ConfirmationSelection::Reject
    } else if decision.hunk_ids.is_empty() {
        ConfirmationSelection::ApplyAll
    } else {
        if decision
            .hunk_ids
            .iter()
            .any(|id| request.preview.hunks.iter().all(|hunk| &hunk.id != id))
            || has_duplicates(&decision.hunk_ids)
        {
            return Err(BackendError::invalid_input(
                "La confirmación contiene un hunk desconocido o repetido.",
            ));
        }
        ConfirmationSelection::ApplySelected
    };
    let action = match selection {
        ConfirmationSelection::Reject => MutationPreviewAction::Reject,
        ConfirmationSelection::ApplyAll => MutationPreviewAction::ApplyAll,
        ConfirmationSelection::ApplySelected => MutationPreviewAction::ApplySelected,
    };
    if !request.preview.allowed_actions.is_empty()
        && !request.preview.allowed_actions.contains(&action)
    {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La acción no está permitida para este preview.",
            false,
        ));
    }
    ensure_preview_revisions(&request.preview, current_revisions)?;
    Ok(selection)
}

pub fn ensure_preview_revisions(
    preview: &MutationPreview,
    current_revisions: &BTreeMap<String, u64>,
) -> Result<(), BackendError> {
    for document in &preview.documents {
        let current = current_revisions.get(&document.path).ok_or_else(|| {
            revision_conflict(
                &preview.operation_id,
                &document.path,
                document.expected_revision,
                None,
            )
        })?;
        if *current != document.expected_revision {
            return Err(revision_conflict(
                &preview.operation_id,
                &document.path,
                document.expected_revision,
                Some(*current),
            ));
        }
    }
    Ok(())
}

fn revision_conflict(
    operation_id: &str,
    path: &str,
    expected: u64,
    current: Option<u64>,
) -> BackendError {
    let mut error = BackendError::new(
        BackendErrorCode::Conflict,
        format!("La revisión de {path} cambió mientras se revisaba la operación."),
        true,
    );
    error.operation_id = Some(operation_id.to_string());
    let _ = (expected, current);
    error
}

fn stale_interaction<T>(message: &str) -> Result<T, BackendError> {
    Err(BackendError::new(BackendErrorCode::Conflict, message, true))
}

fn has_duplicates(values: &[String]) -> bool {
    let mut seen = std::collections::HashSet::new();
    values.iter().any(|value| !seen.insert(value))
}

fn validate_identifier(field: &str, value: &str, max_chars: usize) -> Result<(), BackendError> {
    if value.trim().is_empty()
        || value.chars().count() > max_chars
        || value.chars().any(char::is_control)
    {
        return Err(BackendError::invalid_input(format!(
            "{field} no es válido."
        )));
    }
    Ok(())
}

/// A lease that accepts results only while the claimed generation remains
/// current. The registry is memory-only coordination; persistence belongs to
/// an adapter implementing the operation state port.
pub struct OperationLease<'a> {
    registry: &'a InFlightRegistry,
    key: String,
    token: OperationToken,
}

impl<'a> OperationLease<'a> {
    pub fn token(&self) -> &OperationToken {
        &self.token
    }

    pub fn accepts_result(&self) -> bool {
        self.registry.is_active(&self.key, self.token.generation)
    }

    pub fn accept_result<T>(&self, result: T) -> Result<T, BackendError> {
        if self.accepts_result() {
            Ok(result)
        } else {
            Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El resultado pertenece a una generación obsoleta.",
                true,
            ))
        }
    }
}

impl Drop for OperationLease<'_> {
    fn drop(&mut self) {
        self.registry.finish(&self.key, self.token.generation);
    }
}

pub fn begin_operation<'a>(
    registry: &'a InFlightRegistry,
    key: impl Into<String>,
    token: OperationToken,
) -> Result<OperationLease<'a>, BackendError> {
    token.validate()?;
    let key = key.into();
    if registry.begin(key.clone(), token.generation) {
        return Ok(OperationLease {
            registry,
            key,
            token,
        });
    }
    let message = if registry.is_active(&key, token.generation) {
        "La operación ya está en curso."
    } else {
        "La operación fue reemplazada por una generación más reciente."
    };
    Err(BackendError::new(BackendErrorCode::Conflict, message, true))
}

/// Trait for adapters that persist operation checkpoints. The core does not
/// provide a backing store and never treats a missing checkpoint as success.
pub trait OperationStatePort: Send + Sync {
    fn load_operation(
        &self,
        context: &BackendRequestContext,
        operation_id: &str,
        idempotency_key: &str,
    ) -> Result<Option<OperationReview>, BackendError>;

    fn store_operation(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        review: &OperationReview,
    ) -> Result<(), BackendError>;

    fn load_operation_for_request(
        &self,
        _context: &BackendRequestContext,
        _idempotency_key: &str,
    ) -> Result<Option<OperationReview>, BackendError> {
        Ok(None)
    }
}

pub trait RevisionPort: Send + Sync {
    fn current_revision(
        &self,
        context: &BackendRequestContext,
        logical_path: &str,
    ) -> Result<Option<u64>, BackendError>;
}

pub trait OperationReviewPort: Send + Sync {
    fn prepare_operation(
        &self,
        _context: &BackendRequestContext,
        _operation: &OperationToken,
        _tool: &ToolDefinition,
        _call: &ToolCall,
    ) -> Result<Option<MutationPreview>, BackendError> {
        Ok(None)
    }

    fn review_operation(
        &self,
        context: &BackendRequestContext,
        operation: &OperationToken,
    ) -> Result<OperationReview, BackendError>;

    fn undo_operation(
        &self,
        context: &BackendRequestContext,
        request: &UndoRequest,
    ) -> Result<UndoResult, BackendError>;
}

const DEFAULT_GENERATION_CAPACITY: usize = 1024;

#[derive(Debug)]
pub struct OperationGenerationCache {
    generations: Mutex<BTreeMap<String, u64>>,
    capacity: usize,
}

impl Default for OperationGenerationCache {
    fn default() -> Self {
        Self::with_capacity(DEFAULT_GENERATION_CAPACITY)
    }
}

impl OperationGenerationCache {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            generations: Mutex::new(BTreeMap::new()),
            capacity: capacity.max(1),
        }
    }

    pub fn observe(&self, operation_id: &str, generation: u64) -> Result<(), BackendError> {
        if generation == 0 || operation_id.trim().is_empty() {
            return Err(BackendError::invalid_input(
                "La identidad de operación no es válida.",
            ));
        }
        let mut generations = self.generations.lock().map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo proteger la generación.",
                true,
            )
        })?;
        if generations
            .get(operation_id)
            .is_some_and(|current| generation < *current)
        {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "La generación de la operación es obsoleta.",
                true,
            ));
        }
        generations.insert(operation_id.to_string(), generation);
        while generations.len() > self.capacity {
            let Some(oldest) = generations.keys().next().cloned() else {
                break;
            };
            generations.remove(&oldest);
        }
        Ok(())
    }

    pub fn accepts(&self, operation_id: &str, generation: u64) -> bool {
        self.generations
            .lock()
            .ok()
            .and_then(|values| values.get(operation_id).copied())
            .is_some_and(|current| current == generation)
    }

    pub fn next_generation(&self, operation_id: &str) -> u64 {
        self.generations
            .lock()
            .ok()
            .and_then(|values| values.get(operation_id).copied())
            .unwrap_or(0)
            .saturating_add(1)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::protocol::{PreviewDocument, PreviewHunk};

    fn token(generation: u64) -> OperationToken {
        OperationToken {
            operation_id: "operation-1".into(),
            generation,
        }
    }

    fn preview() -> MutationPreview {
        MutationPreview {
            operation_id: "operation-1".into(),
            summary: "edit".into(),
            documents: vec![PreviewDocument {
                path: "note.md".into(),
                expected_revision: 4,
                current_revision: 4,
            }],
            hunks: vec![PreviewHunk {
                id: "hunk-1".into(),
                document_path: "note.md".into(),
                start_line: 1,
                end_line: 1,
                old_text: "old".into(),
                new_text: "new".into(),
            }],
            allowed_actions: vec![
                MutationPreviewAction::ApplyAll,
                MutationPreviewAction::ApplySelected,
                MutationPreviewAction::Reject,
            ],
        }
    }

    #[test]
    fn accepts_only_current_clarification_answers() {
        let request = ClarificationRequest {
            clarification_id: "clarification-1".into(),
            operation: token(2),
            question: "Which one?".into(),
            options: vec![ClarificationOption {
                id: "one".into(),
                label: "One".into(),
            }],
            allow_free_text: false,
        };
        let answer = ClarificationAnswer {
            clarification_id: "clarification-1".into(),
            operation: token(1),
            answer: "One".into(),
            option_id: Some("one".into()),
        };
        assert_eq!(
            validate_clarification_answer(&request, &answer)
                .expect_err("stale answer")
                .code,
            BackendErrorCode::Conflict
        );
    }

    #[test]
    fn validates_confirmation_selection_and_revisions() {
        let request = ConfirmationRequest {
            operation: token(1),
            preview: preview(),
        };
        let decision = ConfirmationDecision {
            operation_id: "operation-1".into(),
            accepted: true,
            hunk_ids: vec!["hunk-1".into()],
        };
        let revisions = BTreeMap::from([(String::from("note.md"), 4)]);
        assert_eq!(
            validate_confirmation(&decision, &request, &revisions).expect("selection"),
            ConfirmationSelection::ApplySelected
        );
        let stale = BTreeMap::from([(String::from("note.md"), 5)]);
        assert_eq!(
            validate_confirmation(&decision, &request, &stale)
                .expect_err("revision conflict")
                .code,
            BackendErrorCode::Conflict
        );
    }

    #[test]
    fn plan_transitions_are_deterministic() {
        let mut plan = ExecutionPlan {
            plan_id: "plan-1".into(),
            generation: 1,
            title: "Plan".into(),
            status: PlanStatus::Draft,
            steps: vec![PlanStep {
                id: "step-1".into(),
                label: "Write".into(),
                operation_id: None,
                status: PlanStepStatus::Pending,
            }],
        };
        plan.set_status(PlanStatus::AwaitingApproval)
            .expect("review");
        plan.set_status(PlanStatus::Running).expect("start");
        plan.set_step_status("step-1", PlanStepStatus::Running)
            .expect("step start");
        plan.set_step_status("step-1", PlanStepStatus::Completed)
            .expect("step complete");
        assert!(plan.set_status(PlanStatus::Draft).is_err());
    }

    #[test]
    fn operation_states_cannot_reopen_terminal_results() {
        assert_eq!(
            transition_operation_state(OperationState::Running, OperationState::Completed)
                .expect("completion"),
            OperationState::Completed
        );
        assert_eq!(
            transition_operation_state(OperationState::Completed, OperationState::Running)
                .expect_err("terminal state cannot reopen")
                .code,
            BackendErrorCode::Conflict
        );
    }

    #[test]
    fn rejects_results_from_a_replaced_generation() {
        let registry = InFlightRegistry::default();
        let first = begin_operation(&registry, "operation-1", token(1)).expect("first lease");
        let second = begin_operation(&registry, "operation-1", token(2)).expect("replacement");
        assert!(!first.accepts_result());
        assert_eq!(
            first.accept_result("old").expect_err("stale result").code,
            BackendErrorCode::Conflict
        );
        assert_eq!(second.accept_result("new").expect("current result"), "new");
    }

    #[test]
    fn generation_cache_rejects_older_observations() {
        let cache = OperationGenerationCache::default();
        cache.observe("operation-1", 3).expect("generation");
        assert_eq!(
            cache
                .observe("operation-1", 2)
                .expect_err("stale generation")
                .code,
            BackendErrorCode::Conflict
        );
        assert!(cache.accepts("operation-1", 3));
    }
}
