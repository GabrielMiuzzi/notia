use serde::{Deserialize, Serialize};

use super::error::BackendError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendChannel {
    App,
    Telegram,
    Meeting,
    Published,
    Multichat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendScope {
    Library,
    Document,
    TaskManager,
    Graph,
    Finance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PersistencePolicy {
    Persistent,
    EphemeralNoMemory,
    PublishedNoMemory,
}

impl PersistencePolicy {
    pub fn allows_memory(&self) -> bool {
        matches!(self, Self::Persistent)
    }
}

/// Identifier of the owner user seeded in every library database. Owner-only
/// capabilities (agent memory and rules) are keyed on this identity.
pub const OWNER_LIBRARY_USER_ID: &str = "user-owner";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendActor {
    pub library_user_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_identity: Option<ExternalIdentity>,
}

impl BackendActor {
    pub fn is_library_owner(&self) -> bool {
        self.library_user_id == OWNER_LIBRARY_USER_ID
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalIdentity {
    pub provider: String,
    pub user_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendRequestContext {
    pub request_id: String,
    pub library_id: String,
    pub actor: BackendActor,
    pub channel: BackendChannel,
    pub scope: BackendScope,
    pub persistence_policy: PersistencePolicy,
}

impl BackendRequestContext {
    pub fn validate(&self) -> Result<(), BackendError> {
        validate_identifier("requestId", &self.request_id, 128)?;
        validate_identifier("libraryId", &self.library_id, 512)?;
        validate_identifier("libraryUserId", &self.actor.library_user_id, 128)?;

        if let Some(identity) = &self.actor.external_identity {
            validate_identifier("external provider", &identity.provider, 64)?;
            validate_identifier("external userId", &identity.user_id, 256)?;
        }

        if self.channel == BackendChannel::Published
            && self.persistence_policy != PersistencePolicy::PublishedNoMemory
        {
            return Err(BackendError::invalid_input(
                "Un canal publicado debe usar una política sin memoria publicada.",
            ));
        }
        if self.persistence_policy == PersistencePolicy::PublishedNoMemory
            && self.channel != BackendChannel::Published
        {
            return Err(BackendError::invalid_input(
                "La política publicada solo puede usarse en un canal publicado.",
            ));
        }
        if self.channel == BackendChannel::Telegram {
            let Some(identity) = &self.actor.external_identity else {
                return Err(BackendError::invalid_input(
                    "Las solicitudes Telegram necesitan identidad externa.",
                ));
            };
            if !identity.provider.eq_ignore_ascii_case("telegram") {
                return Err(BackendError::invalid_input(
                    "La identidad externa no corresponde al canal Telegram.",
                ));
            }
        }

        Ok(())
    }
}

fn validate_identifier(field: &str, value: &str, max_chars: usize) -> Result<(), BackendError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_chars
        || trimmed.chars().any(char::is_control)
    {
        return Err(BackendError::invalid_input(format!(
            "{field} no es valido."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        BackendActor, BackendChannel, BackendRequestContext, BackendScope, PersistencePolicy,
    };

    fn context() -> BackendRequestContext {
        BackendRequestContext {
            request_id: "request-1".to_string(),
            library_id: "library-1".to_string(),
            actor: BackendActor {
                library_user_id: "user-owner".to_string(),
                external_identity: None,
            },
            channel: BackendChannel::App,
            scope: BackendScope::Library,
            persistence_policy: PersistencePolicy::Persistent,
        }
    }

    #[test]
    fn validates_the_tenant_and_actor_context() {
        assert!(context().validate().is_ok());
    }

    #[test]
    fn rejects_an_empty_library_id() {
        let mut value = context();
        value.library_id = "  ".to_string();
        assert!(value.validate().is_err());
    }

    #[test]
    fn keeps_the_versioned_json_shape_stable() {
        let value = serde_json::to_value(context()).expect("context serializes");
        assert_eq!(value["requestId"], "request-1");
        assert_eq!(value["libraryId"], "library-1");
        assert_eq!(value["actor"]["libraryUserId"], "user-owner");
        assert_eq!(value["channel"], "app");
        assert_eq!(value["persistencePolicy"], "persistent");
    }

    #[test]
    fn requires_published_policy_for_published_channel() {
        let mut value = context();
        value.channel = BackendChannel::Published;
        assert!(value.validate().is_err());
        value.persistence_policy = PersistencePolicy::PublishedNoMemory;
        assert!(value.validate().is_ok());
    }

    #[test]
    fn binds_telegram_to_a_telegram_external_identity() {
        let mut value = context();
        value.channel = BackendChannel::Telegram;
        assert!(value.validate().is_err());
        value.actor.external_identity = Some(super::ExternalIdentity {
            provider: "telegram".to_string(),
            user_id: "chat-user".to_string(),
            chat_id: Some(42),
        });
        assert!(value.validate().is_ok());
    }
}
