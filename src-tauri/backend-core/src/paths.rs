use super::context::BackendRequestContext;
use super::error::{BackendError, BackendErrorCode};

pub const AGENT_DIRECTORY: &str = ".agent";
pub const PROMPTS_DIRECTORY: &str = "promps";
pub const MEMORY_DIRECTORY: &str = "memory";
pub const SKILLS_DIRECTORY: &str = "skills";
pub const DEFAULT_PROMPT_FILE: &str = "default.md";
pub const RULES_FILE: &str = "rules.md";
pub const MEMORY_FILE: &str = "memory.md";

const MAX_LOGICAL_PATH_CHARS: usize = 4096;
const MAX_PATH_SEGMENT_CHARS: usize = 255;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct LogicalLibraryPath(String);

impl LogicalLibraryPath {
    pub fn new(path: &str) -> Result<Self, BackendError> {
        validate_logical_library_path(path)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentPathKind {
    Prompt,
    Rules,
    Memory,
    Skill,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentPath {
    path: LogicalLibraryPath,
    kind: AgentPathKind,
}

impl AgentPath {
    pub fn as_str(&self) -> &str {
        self.path.as_str()
    }

    pub fn kind(&self) -> AgentPathKind {
        self.kind
    }

    pub fn logical_path(&self) -> &LogicalLibraryPath {
        &self.path
    }
}

/// A path carrying the exact library and actor scope that authorized it.
/// Adapters must use this value instead of reconstructing scope from a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopedAgentPath {
    library_id: String,
    library_user_id: String,
    path: AgentPath,
}

impl ScopedAgentPath {
    pub fn library_id(&self) -> &str {
        &self.library_id
    }

    pub fn library_user_id(&self) -> &str {
        &self.library_user_id
    }

    pub fn path(&self) -> &AgentPath {
        &self.path
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopedLibraryPath {
    library_id: String,
    path: LogicalLibraryPath,
}

impl ScopedLibraryPath {
    pub fn library_id(&self) -> &str {
        &self.library_id
    }

    pub fn path(&self) -> &LogicalLibraryPath {
        &self.path
    }
}

pub fn validate_logical_library_path(path: &str) -> Result<LogicalLibraryPath, BackendError> {
    let path = path.trim();
    if path.is_empty()
        || path.chars().count() > MAX_LOGICAL_PATH_CHARS
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains("://")
        || path.chars().any(char::is_control)
        || is_windows_drive_path(path)
    {
        return Err(invalid_path("La ruta de biblioteca no es válida."));
    }

    let mut segments = path.split('/');
    if segments.any(|segment| {
        segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.chars().count() > MAX_PATH_SEGMENT_CHARS
            || segment.contains(':')
    }) {
        return Err(invalid_path("La ruta de biblioteca no es válida."));
    }

    Ok(LogicalLibraryPath(path.to_string()))
}

pub fn validate_agent_path(path: &str) -> Result<AgentPath, BackendError> {
    let logical_path = validate_logical_library_path(path)?;
    let segments = logical_path.as_str().split('/').collect::<Vec<_>>();
    let (kind, valid) = match segments.as_slice() {
        [AGENT_DIRECTORY, PROMPTS_DIRECTORY, file] if is_markdown_file_name(file) => {
            (AgentPathKind::Prompt, true)
        }
        [AGENT_DIRECTORY, MEMORY_DIRECTORY, RULES_FILE] => (AgentPathKind::Rules, true),
        [AGENT_DIRECTORY, MEMORY_DIRECTORY, MEMORY_FILE] => (AgentPathKind::Memory, true),
        [AGENT_DIRECTORY, SKILLS_DIRECTORY, skill, rest @ ..]
            if !skill.is_empty()
                && (rest.is_empty() || !rest.iter().any(|value| value.is_empty())) =>
        {
            (AgentPathKind::Skill, true)
        }
        _ => (AgentPathKind::Prompt, false),
    };

    if !valid {
        return Err(invalid_path("La ruta del agente no está autorizada."));
    }
    Ok(AgentPath {
        path: logical_path,
        kind,
    })
}

pub fn normalize_prompt_file_name(file_name: &str) -> &str {
    let file_name = file_name.trim();
    if is_markdown_file_name(file_name) {
        file_name
    } else {
        DEFAULT_PROMPT_FILE
    }
}

pub fn authorize_library_path(
    context: &BackendRequestContext,
    library_id: &str,
    path: &str,
) -> Result<ScopedLibraryPath, BackendError> {
    context.validate()?;
    if library_id != context.library_id {
        return Err(scope_error(
            "La ruta no pertenece a la biblioteca solicitada.",
        ));
    }
    Ok(ScopedLibraryPath {
        library_id: context.library_id.clone(),
        path: validate_logical_library_path(path)?,
    })
}

pub fn authorize_agent_path(
    context: &BackendRequestContext,
    path: &str,
) -> Result<ScopedAgentPath, BackendError> {
    authorize_agent_path_for(
        context,
        &context.library_id,
        &context.actor.library_user_id,
        path,
    )
}

pub fn authorize_agent_path_for(
    context: &BackendRequestContext,
    library_id: &str,
    library_user_id: &str,
    path: &str,
) -> Result<ScopedAgentPath, BackendError> {
    context.validate()?;
    if library_id != context.library_id || library_user_id != context.actor.library_user_id {
        return Err(scope_error(
            "La ruta del agente no pertenece a la biblioteca o usuario solicitados.",
        ));
    }
    let path = validate_agent_path(path)?;
    if path.kind == AgentPathKind::Memory
        && (!context.persistence_policy.allows_memory()
            || !context.actor.is_library_owner())
    {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La memoria del agente no está disponible para esta operación.",
            false,
        ));
    }
    Ok(ScopedAgentPath {
        library_id: context.library_id.clone(),
        library_user_id: context.actor.library_user_id.clone(),
        path,
    })
}

fn is_markdown_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && !file_name.contains('/')
        && file_name.len() >= 4
        && file_name[file_name.len() - 3..].eq_ignore_ascii_case(".md")
}

fn is_windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn invalid_path(message: &'static str) -> BackendError {
    BackendError::new(BackendErrorCode::InvalidInput, message, false)
}

fn scope_error(message: &'static str) -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BackendActor, BackendChannel, BackendScope, PersistencePolicy};

    fn context(policy: PersistencePolicy, user: &str) -> BackendRequestContext {
        BackendRequestContext {
            request_id: "request-1".into(),
            library_id: "library-a".into(),
            actor: BackendActor {
                library_user_id: user.into(),
                external_identity: None,
            },
            // A published policy only exists on the published channel.
            channel: if policy == PersistencePolicy::PublishedNoMemory {
                BackendChannel::Published
            } else {
                BackendChannel::App
            },
            scope: BackendScope::Library,
            persistence_policy: policy,
        }
    }

    #[test]
    fn accepts_allowed_library_and_agent_paths() {
        assert_eq!(
            validate_logical_library_path("notes/project.md")
                .expect("logical path")
                .as_str(),
            "notes/project.md"
        );
        assert_eq!(
            validate_agent_path(".agent/promps/custom.md")
                .expect("prompt path")
                .kind(),
            AgentPathKind::Prompt
        );
        assert_eq!(
            validate_agent_path(".agent/skills/review/SKILL.md")
                .expect("skill path")
                .kind(),
            AgentPathKind::Skill
        );
    }

    #[test]
    fn rejects_traversal_absolute_paths_and_uri_like_values() {
        for path in [
            "../outside.md",
            "notes/../../outside.md",
            "notes\\..\\outside.md",
            "/absolute.md",
            "C:/outside.md",
            "content://tree/library/document/1",
        ] {
            assert!(validate_logical_library_path(path).is_err(), "{path}");
        }
        assert!(validate_agent_path(".agent/skills/../memory.md").is_err());
    }

    #[test]
    fn binds_paths_to_the_request_library_and_user() {
        let context = context(PersistencePolicy::Persistent, "user-owner");
        let scoped =
            authorize_agent_path(&context, ".agent/memory/memory.md").expect("owner memory path");
        assert_eq!(scoped.library_id(), "library-a");
        assert_eq!(scoped.library_user_id(), "user-owner");
        assert!(authorize_library_path(&context, "library-b", "notes/a.md").is_err());
        assert!(authorize_agent_path_for(
            &context,
            "library-a",
            "user-other",
            ".agent/memory/memory.md"
        )
        .is_err());
    }

    #[test]
    fn denies_memory_for_ephemeral_published_and_non_owner_requests() {
        for policy in [
            PersistencePolicy::EphemeralNoMemory,
            PersistencePolicy::PublishedNoMemory,
        ] {
            assert!(authorize_agent_path(
                &context(policy, "user-owner"),
                ".agent/memory/memory.md"
            )
            .is_err());
        }
        assert!(authorize_agent_path(
            &context(PersistencePolicy::Persistent, "user-other"),
            ".agent/memory/memory.md"
        )
        .is_err());
        assert!(authorize_agent_path(
            &context(PersistencePolicy::PublishedNoMemory, "user-owner"),
            ".agent/memory/rules.md"
        )
        .is_ok());
    }
}
