//! Background knowledge tasks after a chat turn: naming a new chat and
//! learning long-term memories (then reorganizing rules and memories). The
//! chat turn schedules them; prompts and parsing live in
//! `backend_core::agent_knowledge`.

use crate::host::AppHandle;

use crate::backend::agent_knowledge as knowledge;
use crate::backend::BackendError;

/// Names a new chat from its first message and saves the title in the chat
/// file. Returns the title, or `None` when the model gave none.
pub(crate) fn title_chat(app: &AppHandle, library_id: &str, logical_path: &str, prompt: &str) -> Result<Option<String>, BackendError> {
    if prompt.trim().is_empty() {
        return Ok(None);
    }
    let (system, user) = knowledge::title_messages(prompt);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user)?;
    let Some(title) = knowledge::sanitize_title(&answer) else {
        return Ok(None);
    };
    crate::chat_history::set_title(app, library_id, logical_path, &title)?;
    Ok(Some(title))
}

/// Learns durable facts about the user from a turn, stores the new ones and
/// reorganizes rules and memories. Returns how many memories were added.
pub(crate) fn learn_from_turn(
    app: &AppHandle,
    library_id: &str,
    prompt: &str,
    assistant_reply: &str,
    previous: &[knowledge::TurnMessage<'_>],
) -> Result<usize, BackendError> {
    if prompt.trim().is_empty() || assistant_reply.trim().is_empty() {
        return Ok(0);
    }
    let existing = crate::agent_workspace::memories(app, library_id)?;
    let (system, user) = knowledge::memory_messages(&existing, previous, prompt, assistant_reply);
    let learned = knowledge::parse_memory_list(&crate::backend_runtime::complete_text(app, library_id, &system, &user)?);
    if learned.is_empty() {
        return Ok(0);
    }
    let before = existing.len();
    let merged = crate::agent_workspace::save_memories(app, library_id, existing.into_iter().chain(learned).collect())?;
    let added = merged.len().saturating_sub(before);
    // Reorganizing is best effort: a model that does not return the
    // expected JSON leaves the saved memories untouched.
    let rules = crate::agent_workspace::rules(app, library_id)?;
    let (system, user) = knowledge::organize_messages(&rules, &merged);
    if let Ok(answer) = crate::backend_runtime::complete_text(app, library_id, &system, &user) {
        if let Some((organized_rules, organized_memories)) = knowledge::parse_organized(&answer) {
            if !organized_memories.is_empty() {
                crate::agent_workspace::save_rules(app, library_id, organized_rules)?;
                crate::agent_workspace::save_memories(app, library_id, organized_memories)?;
            }
        }
    }
    Ok(added)
}
