use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendErrorCode {
    InvalidInput,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    Cancelled,
    Timeout,
    ProviderUnavailable,
    Storage,
    Unsupported,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendError {
    pub code: BackendErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
}

impl BackendError {
    pub fn new(code: BackendErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            operation_id: None,
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(BackendErrorCode::InvalidInput, message, false)
    }

    pub fn cancelled() -> Self {
        Self::new(
            BackendErrorCode::Cancelled,
            "La operación fue cancelada.",
            true,
        )
    }

    pub fn timeout() -> Self {
        Self::new(
            BackendErrorCode::Timeout,
            "La operación superó el tiempo permitido.",
            true,
        )
    }
}

impl Display for BackendError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for BackendError {}

#[cfg(test)]
mod tests {
    use super::{BackendError, BackendErrorCode};

    #[test]
    fn serializes_safe_structured_errors() {
        let error = BackendError::new(BackendErrorCode::Conflict, "conflicto", true);
        let value = serde_json::to_value(error).expect("error serializes");
        assert_eq!(value["code"], "conflict");
        assert_eq!(value["retryable"], true);
        assert!(value.get("operationId").is_none());
    }
}
