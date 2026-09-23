//! Background knowledge tasks after a chat turn: naming a new chat and
//! learning long-term memories (then reorganizing rules and memories). The
//! backend calls the model and writes the results; the interface only asks
//! for them. Prompts and parsing live in `backend_core::agent_knowledge`.

use serde::Deserialize;
use tauri::AppHandle;

use crate::backend::agent_knowledge as knowledge;
use crate::backend::{BackendError, BackendErrorCode};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TitlePayload {
    library_id: String,
    logical_path: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnMessagePayload {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LearnPayload {
    library_id: String,
    prompt: String,
    assistant_reply: String,
    #[serde(default)]
    previous_messages: Vec<TurnMessagePayload>,
}

async fn blocking<T: Send + 'static>(run: impl FnOnce() -> Result<T, BackendError> + Send + 'static) -> Result<T, BackendError> {
    tauri::async_runtime::spawn_blocking(run).await.map_err(|_| {
        BackendError::new(BackendErrorCode::Internal, "No se pudo completar la tarea del agente.", true)
    })?
}

/// Names a new chat from its first message and saves the title in the chat
/// file. Returns the title, or `None` when the model gave none.
#[tauri::command]
pub(crate) async fn backend_title_chat(app: AppHandle, payload: TitlePayload) -> Result<Option<String>, BackendError> {
    blocking(move || {
        if payload.prompt.trim().is_empty() {
            return Ok(None);
        }
        let (system, user) = knowledge::title_messages(&payload.prompt);
        let answer = crate::backend_runtime::complete_text(&app, &payload.library_id, &system, &user)?;
        let Some(title) = knowledge::sanitize_title(&answer) else {
            return Ok(None);
        };
        crate::chat_history::set_title(&app, &payload.library_id, &payload.logical_path, &title)?;
        Ok(Some(title))
    })
    .await
}

/// Learns durable facts about the user from a turn, stores the new ones and
/// reorganizes rules and memories. Returns how many memories were added.
#[tauri::command]
pub(crate) async fn backend_learn_from_turn(app: AppHandle, payload: LearnPayload) -> Result<usize, BackendError> {
    blocking(move || {
        if payload.prompt.trim().is_empty() || payload.assistant_reply.trim().is_empty() {
            return Ok(0);
        }
        let library_id = payload.library_id.as_str();
        let existing = crate::agent_workspace::memories(&app, library_id)?;
        let previous = payload
            .previous_messages
            .iter()
            .filter(|message| matches!(message.role.as_str(), "user" | "assistant"))
            .map(|message| knowledge::TurnMessage { role: &message.role, content: &message.content })
            .collect::<Vec<_>>();
        let (system, user) = knowledge::memory_messages(&existing, &previous, &payload.prompt, &payload.assistant_reply);
        let learned = knowledge::parse_memory_list(&crate::backend_runtime::complete_text(&app, library_id, &system, &user)?);
        if learned.is_empty() {
            return Ok(0);
        }
        let before = existing.len();
        let merged = crate::agent_workspace::save_memories(&app, library_id, existing.into_iter().chain(learned).collect())?;
        let added = merged.len().saturating_sub(before);
        // Reorganizing is best effort: a model that does not return the
        // expected JSON leaves the saved memories untouched.
        let rules = crate::agent_workspace::rules(&app, library_id)?;
        let (system, user) = knowledge::organize_messages(&rules, &merged);
        if let Ok(answer) = crate::backend_runtime::complete_text(&app, library_id, &system, &user) {
            if let Some((organized_rules, organized_memories)) = knowledge::parse_organized(&answer) {
                if !organized_memories.is_empty() {
                    crate::agent_workspace::save_rules(&app, library_id, organized_rules)?;
                    crate::agent_workspace::save_memories(&app, library_id, organized_memories)?;
                }
            }
        }
        Ok(added)
    })
    .await
}
