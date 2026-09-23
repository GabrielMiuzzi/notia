use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use super::error::BackendError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum BackendEvent {
    RequestReceived {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    PhaseChanged {
        #[serde(rename = "requestId")]
        request_id: String,
        phase: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        round: Option<u32>,
    },
    RoundStarted {
        #[serde(rename = "requestId")]
        request_id: String,
        round: u32,
    },
    ThinkingSummary {
        #[serde(rename = "requestId")]
        request_id: String,
        summary: String,
    },
    AssistantDelta {
        #[serde(rename = "requestId")]
        request_id: String,
        delta: String,
    },
    ToolStarted {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        round: u32,
    },
    ToolCompleted {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        round: u32,
        ok: bool,
        changed: Option<bool>,
        /// Tool call id; for confirmed mutations it is also the operation id
        /// used to review or undo the change.
        #[serde(rename = "operationId", default, skip_serializing_if = "Option::is_none")]
        operation_id: Option<String>,
    },
    ClarificationRequired {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "clarificationId")]
        clarification_id: Option<String>,
    },
    ConfirmationRequired {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "operationId")]
        operation_id: Option<String>,
    },
    Progress {
        #[serde(rename = "requestId")]
        request_id: String,
        label: String,
        completed: u64,
        total: Option<u64>,
    },
    Result {
        #[serde(rename = "requestId")]
        request_id: String,
        changed: bool,
    },
    Cancelled {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Completed {
        #[serde(rename = "requestId")]
        request_id: String,
        rounds: u32,
    },
    Failed {
        #[serde(rename = "requestId")]
        request_id: String,
        error: BackendError,
    },
}

impl BackendEvent {
    pub fn request_id(&self) -> &str {
        match self {
            Self::RequestReceived { request_id }
            | Self::PhaseChanged { request_id, .. }
            | Self::RoundStarted { request_id, .. }
            | Self::ThinkingSummary { request_id, .. }
            | Self::AssistantDelta { request_id, .. }
            | Self::ToolStarted { request_id, .. }
            | Self::ToolCompleted { request_id, .. }
            | Self::ClarificationRequired { request_id, .. }
            | Self::ConfirmationRequired { request_id, .. }
            | Self::Progress { request_id, .. }
            | Self::Result { request_id, .. }
            | Self::Cancelled { request_id }
            | Self::Completed { request_id, .. }
            | Self::Failed { request_id, .. } => request_id,
        }
    }
}

pub trait BackendEventSink: Send + Sync {
    fn publish(&self, event: BackendEvent) -> Result<(), BackendError>;
}

#[derive(Debug, Default)]
pub struct NoopEventSink;

impl BackendEventSink for NoopEventSink {
    fn publish(&self, _event: BackendEvent) -> Result<(), BackendError> {
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct VecEventSink {
    events: Arc<Mutex<Vec<BackendEvent>>>,
}

impl VecEventSink {
    pub fn events(&self) -> Vec<BackendEvent> {
        self.events
            .lock()
            .map(|events| events.clone())
            .unwrap_or_default()
    }
}

impl BackendEventSink for VecEventSink {
    fn publish(&self, event: BackendEvent) -> Result<(), BackendError> {
        self.events
            .lock()
            .map_err(|_| {
                BackendError::new(
                    super::error::BackendErrorCode::Internal,
                    "No se pudo publicar el evento.",
                    true,
                )
            })?
            .push(event);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{BackendEvent, BackendEventSink, VecEventSink};

    #[test]
    fn records_only_safe_progress_metadata() {
        let sink = VecEventSink::default();
        sink.publish(BackendEvent::ToolStarted {
            request_id: "request-1".to_string(),
            tool_name: "read_library_documents".to_string(),
            round: 1,
        })
        .expect("event publishes");
        assert_eq!(sink.events().len(), 1);
    }
}
