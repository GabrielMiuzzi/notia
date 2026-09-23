use super::context::BackendRequestContext;
use super::error::BackendError;
use super::paths::{
    authorize_agent_path, normalize_prompt_file_name, AgentPathKind, ScopedAgentPath,
    ScopedLibraryPath, DEFAULT_PROMPT_FILE,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryDescriptor {
    pub library_id: String,
    pub logical_path: String,
    pub android_tree_uri: Option<String>,
}

/// Abstracción mínima de bibliotecas. Las implementaciones concretas pueden
/// usar filesystem desktop, SAF Android o una futura biblioteca montada en
/// backend, pero el runtime no conoce ninguna de esas plataformas.
pub trait LibraryRepository: Send + Sync {
    fn resolve_library(&self, library_id: &str) -> Result<LibraryDescriptor, BackendError>;
}

/// Puerto de lectura/escritura lógica para documentos. La validación de rutas,
/// URI tree/document, atomicidad y límites pertenece a cada adaptador seguro.
pub trait DocumentRepository: Send + Sync {
    fn read_text(&self, library_id: &str, logical_path: &str) -> Result<String, BackendError>;
    fn write_text(
        &self,
        library_id: &str,
        logical_path: &str,
        content: &str,
    ) -> Result<(), BackendError>;
}

/// Filesystem-neutral document port with a library-bound path. Implementations
/// must not turn the path back into a process-global or user-global path.
pub trait ScopedDocumentRepository: Send + Sync {
    fn read_text(&self, path: &ScopedLibraryPath) -> Result<String, BackendError>;
    fn write_text(&self, path: &ScopedLibraryPath, content: &str) -> Result<(), BackendError>;
}

/// Port for `.agent` files. A `ScopedAgentPath` can only be created after the
/// request library, actor, path and memory policy have been checked.
pub trait AgentFileRepository: Send + Sync {
    fn read(&self, path: &ScopedAgentPath) -> Result<Option<String>, BackendError>;
    fn write(&self, path: &ScopedAgentPath, content: &str) -> Result<(), BackendError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSkill {
    pub path: String,
    pub content: String,
}

/// Estado persistente del agente. No presupone `.notia`, SQLite ni un
/// transporte: esas decisiones corresponden a la implementación de biblioteca.
pub trait AgentStateRepository: Send + Sync {
    fn load_prompt(
        &self,
        library_id: &str,
        prompt_name: &str,
    ) -> Result<Option<String>, BackendError>;
    fn load_memory(
        &self,
        library_id: &str,
        library_user_id: &str,
    ) -> Result<Option<String>, BackendError>;
    fn save_memory(
        &self,
        library_id: &str,
        library_user_id: &str,
        content: &str,
    ) -> Result<(), BackendError>;

    fn load_rules(&self, _library_id: &str) -> Result<Option<String>, BackendError> {
        Ok(None)
    }

    fn load_skills(&self, _library_id: &str) -> Result<Vec<AgentSkill>, BackendError> {
        Ok(Vec::new())
    }

    /// Synchronizes the persisted default prompt visualizer. The embedded
    /// prompt remains the execution source; this is a storage-side effect.
    fn synchronize_default_prompt(
        &self,
        _library_id: &str,
        _content: &str,
    ) -> Result<(), BackendError> {
        Ok(())
    }
}

pub fn load_prompt_for_context(
    state: &dyn AgentStateRepository,
    context: &BackendRequestContext,
    prompt_name: &str,
) -> Result<Option<String>, BackendError> {
    let prompt_name = normalize_prompt_file_name(prompt_name);
    let path = format!(".agent/promps/{prompt_name}");
    let authorized = authorize_agent_path(context, &path)?;
    debug_assert_eq!(authorized.path().kind(), AgentPathKind::Prompt);
    if prompt_name == DEFAULT_PROMPT_FILE {
        return Ok(None);
    }
    state.load_prompt(authorized.library_id(), prompt_name)
}

pub fn load_rules_for_context(
    state: &dyn AgentStateRepository,
    context: &BackendRequestContext,
) -> Result<Option<String>, BackendError> {
    let authorized = authorize_agent_path(context, ".agent/memory/rules.md")?;
    debug_assert_eq!(authorized.path().kind(), AgentPathKind::Rules);
    state.load_rules(authorized.library_id())
}

pub fn load_skills_for_context(
    state: &dyn AgentStateRepository,
    context: &BackendRequestContext,
) -> Result<Vec<AgentSkill>, BackendError> {
    let skills = state.load_skills(&context.library_id)?;
    skills
        .into_iter()
        .map(|skill| {
            let authorized = authorize_agent_path(context, &skill.path)?;
            if authorized.path().kind() != AgentPathKind::Skill {
                return Err(BackendError::invalid_input(
                    "El puerto devolvió una ruta de skill no autorizada.",
                ));
            }
            Ok(skill)
        })
        .collect()
}

pub fn load_memory_for_context(
    state: &dyn AgentStateRepository,
    context: &BackendRequestContext,
) -> Result<Option<String>, BackendError> {
    let authorized = authorize_agent_path(context, ".agent/memory/memory.md")?;
    debug_assert_eq!(authorized.path().kind(), AgentPathKind::Memory);
    state.load_memory(authorized.library_id(), authorized.library_user_id())
}

pub fn save_memory_for_context(
    state: &dyn AgentStateRepository,
    context: &BackendRequestContext,
    content: &str,
) -> Result<(), BackendError> {
    let authorized = authorize_agent_path(context, ".agent/memory/memory.md")?;
    debug_assert_eq!(authorized.path().kind(), AgentPathKind::Memory);
    state.save_memory(
        authorized.library_id(),
        authorized.library_user_id(),
        content,
    )
}

pub fn synchronize_default_prompt_for_context(
    state: &dyn AgentStateRepository,
    context: &BackendRequestContext,
    content: &str,
) -> Result<(), BackendError> {
    let path = authorize_agent_path(context, ".agent/promps/default.md")?;
    debug_assert_eq!(path.path().kind(), AgentPathKind::Prompt);
    state.synchronize_default_prompt(path.library_id(), content)
}

pub trait BackendClock: Send + Sync {
    fn now_unix_ms(&self) -> i64;
}

#[derive(Debug, Default)]
pub struct SystemClock;

impl BackendClock for SystemClock {
    fn now_unix_ms(&self) -> i64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::{BackendClock, SystemClock};

    #[test]
    fn system_clock_returns_a_non_negative_timestamp() {
        assert!(SystemClock.now_unix_ms() >= 0);
    }
}
