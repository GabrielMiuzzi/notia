//! Background knowledge tasks: naming a new chat after its first turn and
//! organizing `memory.md` each time it changes. Prompts and parsing live in
//! `backend_core::agent_knowledge`. The agent itself saves memories with its
//! `add_agent_memory` tool; the organization is a separate model call
//! without tools and without the memory context.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

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

/// Libraries whose memories are being organized, and whether memory.md
/// changed again meanwhile (then it runs once more).
fn organizing() -> &'static Mutex<HashMap<String, bool>> {
    static ORGANIZING: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    ORGANIZING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Organizes the memories of the library in the background, without
/// delaying the turn that saved them. One run per library at a time; a
/// change during a run schedules one more.
pub(crate) fn schedule_memory_organization(app: &AppHandle, library_id: &str) {
    {
        let Ok(mut running) = organizing().lock() else { return };
        if let Some(again) = running.get_mut(library_id) {
            *again = true;
            return;
        }
        running.insert(library_id.to_string(), false);
    }
    let app = app.clone();
    let library_id = library_id.to_string();
    std::thread::spawn(move || loop {
        match organize_memories(&app, &library_id) {
            Ok(true) => log::info!("[notia:memory] memorias organizadas"),
            Ok(false) => {}
            Err(error) => log::warn!("[notia:memory] no se pudieron organizar las memorias: {}", error.message),
        }
        let Ok(mut running) = organizing().lock() else { return };
        if running.get(&library_id).copied().unwrap_or(false) {
            running.insert(library_id.clone(), false);
        } else {
            running.remove(&library_id);
            return;
        }
    });
}

/// Asks the model to organize `memory.md` and saves the result when the file
/// did not change meanwhile. Returns whether it wrote.
fn organize_memories(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    let memories = crate::agent_workspace::memories(app, library_id)?;
    if memories.len() < 2 {
        return Ok(false);
    }
    let (system, user) = knowledge::organize_memories_messages(&memories);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user)?;
    let Some(organized) = knowledge::parse_organized_memories(&answer, &memories) else {
        return Ok(false);
    };
    crate::agent_workspace::replace_memories_if_unchanged(app, library_id, &memories, organized)
}
