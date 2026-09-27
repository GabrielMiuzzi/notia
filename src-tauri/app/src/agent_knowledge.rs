//! Background knowledge tasks: naming a new chat after its first turn,
//! organizing `memory.md` and `thoughts.md` each time they change, and
//! rewriting them when they are full. Prompts and parsing live in
//! `backend_core::agent_knowledge`. The agent itself saves memories and
//! thoughts with its `add_agent_memory` and `add_agent_thought` tools; the
//! organization is a separate model call without tools and without the
//! memory context.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::host::AppHandle;

use crate::agent_workspace::AgentItem;
use crate::backend::agent_knowledge as knowledge;
use crate::backend::agent_workspace::{ItemBudget, MEMORY_TARGET, THOUGHTS_TARGET};
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

/// The agent file an organization works on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Knowledge {
    Memories,
    Thoughts,
}

/// Files being organized, per library, and whether they changed again
/// meanwhile (then the organization runs once more).
fn organizing() -> &'static Mutex<HashMap<(String, Knowledge), bool>> {
    static ORGANIZING: OnceLock<Mutex<HashMap<(String, Knowledge), bool>>> = OnceLock::new();
    ORGANIZING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Organizes the memories of the library in the background, without
/// delaying the turn that saved them.
pub(crate) fn schedule_memory_organization(app: &AppHandle, library_id: &str) {
    schedule(app, library_id, Knowledge::Memories);
}

/// Organizes the agent's thoughts in the background after each save.
pub(crate) fn schedule_thoughts_organization(app: &AppHandle, library_id: &str) {
    schedule(app, library_id, Knowledge::Thoughts);
}

/// One run per library and file at a time; a change during a run
/// schedules one more.
fn schedule(app: &AppHandle, library_id: &str, kind: Knowledge) {
    let key = (library_id.to_string(), kind);
    {
        let Ok(mut running) = organizing().lock() else { return };
        if let Some(again) = running.get_mut(&key) {
            *again = true;
            return;
        }
        running.insert(key.clone(), false);
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        let result = match kind {
            Knowledge::Memories => organize_memories(&app, &key.0, None),
            Knowledge::Thoughts => organize_thoughts(&app, &key.0),
        };
        match result {
            Ok(true) => log::info!("[notia:memory] {kind:?} organizados"),
            Ok(false) => {}
            Err(error) => log::warn!("[notia:memory] no se pudieron organizar {kind:?}: {}", error.message),
        }
        let Ok(mut running) = organizing().lock() else { return };
        if running.get(&key).copied().unwrap_or(false) {
            running.insert(key.clone(), false);
        } else {
            running.remove(&key);
            return;
        }
    });
}

/// Rewrites a full `memory.md` within `MEMORY_TARGET`, waiting for the
/// model. Returns whether it wrote.
pub(crate) fn compact_memories(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    organize_memories(app, library_id, Some(MEMORY_TARGET))
}

/// Rewrites a full `thoughts.md` within `THOUGHTS_TARGET`, waiting for the
/// model. Returns whether it wrote.
pub(crate) fn compact_thoughts(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    organize_thoughts(app, library_id)
}

/// Saves a thought Notia keeps by itself (for example, a message it sent)
/// and organizes the thoughts afterwards. Returns whether it wrote.
pub(crate) fn keep_thought(app: &AppHandle, library_id: &str, thought: &str) -> Result<bool, BackendError> {
    let changed = crate::agent_workspace::append_agent_item(app, library_id, AgentItem::Thought, thought)?;
    if changed {
        schedule_thoughts_organization(app, library_id);
    }
    Ok(changed)
}

/// Asks the model to organize `memory.md` (within `budget`, when full) and
/// saves the result when the file did not change meanwhile. Returns whether
/// it wrote.
fn organize_memories(app: &AppHandle, library_id: &str, budget: Option<ItemBudget>) -> Result<bool, BackendError> {
    let memories = crate::agent_workspace::memories(app, library_id)?;
    if memories.len() < 2 {
        return Ok(false);
    }
    let (system, user) = knowledge::organize_memories_messages(&memories, budget);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user)?;
    let Some(organized) = knowledge::parse_organized_memories(&answer, &memories, budget) else {
        return Ok(false);
    };
    crate::agent_workspace::replace_memories_if_unchanged(app, library_id, &memories, organized)
}

/// Asks the model to reorganize `thoughts.md` within `THOUGHTS_TARGET` and
/// saves the result when the file did not change meanwhile. Returns whether
/// it wrote.
fn organize_thoughts(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    let thoughts = crate::agent_workspace::thoughts(app, library_id)?;
    if thoughts.len() < 2 {
        return Ok(false);
    }
    let (_, now) = crate::local_time::local_now();
    let (system, user) = knowledge::organize_thoughts_messages(&thoughts, &now, THOUGHTS_TARGET);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user)?;
    let Some(organized) = knowledge::parse_organized_thoughts(&answer, &thoughts, THOUGHTS_TARGET) else {
        return Ok(false);
    };
    crate::agent_workspace::replace_thoughts_if_unchanged(app, library_id, &thoughts, &organized)
}
