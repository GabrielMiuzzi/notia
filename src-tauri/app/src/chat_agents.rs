//! Agents and dynamics a chat can add: the files under `.agent/promps` and
//! `.agent/dynamics`, their names and descriptions, and the agents and
//! dynamic of a chat ready for a turn. The rules of the rounds live in
//! `backend_core::chat_agents`; `ai_chat` runs them.

use serde::{Deserialize, Serialize};

use notia_backend_core::chat_agents::{self as rules, ChatAgent, DYNAMICS_DIRECTORY};

use crate::backend::BackendError;
use crate::host::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogPayload {
    library_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAgentOptionDto {
    file_name: String,
    name: String,
    description: String,
    /// Two letters of the agent's avatar; empty for a dynamic.
    initials: String,
    /// The file can be read and is not empty.
    valid: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAgentCatalogDto {
    dynamics: Vec<ChatAgentOptionDto>,
    agents: Vec<ChatAgentOptionDto>,
}

/// Source of a library file, if it exists.
fn read_source(app: &AppHandle, library_id: &str, logical_path: &str) -> Result<Option<String>, BackendError> {
    crate::library_documents::with_documents(app, library_id, |documents| documents.read(logical_path))
}

/// Source of an agent file; `default.md` is the embedded Notia prompt.
fn agent_source(app: &AppHandle, library_id: &str, file_name: &str) -> Result<Option<String>, BackendError> {
    if file_name.eq_ignore_ascii_case(notia_backend_core::agent_workspace::DEFAULT_PROMPT_FILE) {
        return Ok(Some(crate::backend::DEFAULT_AGENT_PROMPT.to_string()));
    }
    read_source(app, library_id, &format!("{}/{file_name}", notia_backend_core::agent_workspace::PROMPTS_DIRECTORY))
}

fn option(file_name: String, source: Option<String>, with_initials: bool) -> ChatAgentOptionDto {
    let body = source
        .as_deref()
        .map(|source| notia_backend_core::prompt::strip_frontmatter(source).trim().to_string())
        .unwrap_or_default();
    let name = rules::display_name(&file_name, &body);
    ChatAgentOptionDto {
        description: source.as_deref().map(rules::description).unwrap_or_default(),
        initials: if with_initials { rules::initials(&name) } else { String::new() },
        valid: !body.is_empty(),
        name,
        file_name,
    }
}

fn catalog(app: &AppHandle, library_id: &str) -> Result<ChatAgentCatalogDto, BackendError> {
    // Creates `.agent/`, its prompts and the dynamics folder when missing.
    crate::agent_workspace::ensure_workspace(app, library_id)?;
    let prefix = format!("{DYNAMICS_DIRECTORY}/");
    let mut dynamics = crate::library_documents::inventory_paths(app, library_id, DYNAMICS_DIRECTORY)?
        .into_iter()
        .filter_map(|path| path.strip_prefix(&prefix).map(str::to_string))
        .filter(|name| rules::is_valid_markdown_file_name(name))
        .map(|file_name| {
            let source = read_source(app, library_id, &format!("{DYNAMICS_DIRECTORY}/{file_name}")).ok().flatten();
            option(file_name, source, false)
        })
        .collect::<Vec<_>>();
    dynamics.sort_by_key(|dynamic| dynamic.name.to_lowercase());
    let agents = crate::agent_workspace::list_prompts(app, library_id)?
        .prompts
        .into_iter()
        .map(|prompt| {
            let source = agent_source(app, library_id, &prompt.file_name).ok().flatten();
            option(prompt.file_name, source, true)
        })
        .collect();
    Ok(ChatAgentCatalogDto { dynamics, agents })
}

/// The agents of a chat that can speak, in the chat's order. An agent whose
/// file was removed or emptied is left out of the turn.
pub(crate) fn chat_agents(app: &AppHandle, library_id: &str, files: &[String]) -> Vec<ChatAgent> {
    files
        .iter()
        .filter_map(|file_name| {
            let source = agent_source(app, library_id, file_name).ok().flatten()?;
            let body = notia_backend_core::prompt::strip_frontmatter(&source).trim().to_string();
            if body.is_empty() {
                log::warn!("[notia:chat] an agent of the chat has no prompt and does not speak");
                return None;
            }
            Some(ChatAgent { name: rules::display_name(file_name, &body), file_name: file_name.clone() })
        })
        .collect()
}

/// Text of the chat's dynamic, if it still exists.
pub(crate) fn chat_dynamic(app: &AppHandle, library_id: &str, file_name: Option<&str>) -> Option<String> {
    let file_name = file_name.filter(|name| rules::is_valid_markdown_file_name(name))?;
    let source = read_source(app, library_id, &format!("{DYNAMICS_DIRECTORY}/{file_name}")).ok().flatten()?;
    Some(notia_backend_core::prompt::strip_frontmatter(&source).trim().to_string()).filter(|body| !body.is_empty())
}

/// Dynamics and agents a chat of the library can add.
pub(crate) async fn chat_agents_catalog(app: AppHandle, payload: CatalogPayload) -> Result<ChatAgentCatalogDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || catalog(&app, &payload.library_id))
        .await
        .map_err(|_| BackendError::new(crate::backend::BackendErrorCode::Internal, "No se pudieron leer los agentes.", true))?
}
