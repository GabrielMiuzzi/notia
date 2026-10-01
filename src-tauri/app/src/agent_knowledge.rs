//! Background knowledge tasks: naming a new chat after its first turn,
//! organizing the agent files (`rules.md`, `memory.md`, `thoughts.md`,
//! `biography.md`, `talk.md`) each time they change and in the periodic
//! review, and rewriting them when they are full. Prompts and parsing live
//! in `backend_core::agent_knowledge`. The agent itself saves to them with
//! its `add_agent_*` tools and the reflection after each turn; the
//! organization is a separate model call without tools and without the
//! memory context.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::host::AppHandle;

use crate::agent_workspace::AgentItem;
use crate::backend::agent_knowledge as knowledge;
use crate::backend::agent_workspace::{
    ItemBudget, BIOGRAPHY_STORY_TARGET, MAX_RULE_CHARS, MEMORY_TARGET, RULES_TARGET, TALK, THOUGHTS_TARGET,
};
use crate::backend::BackendError;

/// A chat title is short.
const TITLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);
/// Organizing writes the whole memory or thoughts file again, which may be
/// long with large files.
const ORGANIZE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// Names a new chat from its first message and saves the title in the chat
/// file. Returns the title, or `None` when the model gave none.
pub(crate) fn title_chat(app: &AppHandle, library_id: &str, logical_path: &str, prompt: &str) -> Result<Option<String>, BackendError> {
    if prompt.trim().is_empty() {
        return Ok(None);
    }
    let (system, user) = knowledge::title_messages(prompt);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, TITLE_TIMEOUT)?;
    let Some(title) = knowledge::sanitize_title(&answer) else {
        return Ok(None);
    };
    crate::chat_history::set_title(app, library_id, logical_path, &title)?;
    Ok(Some(title))
}

/// The agent file an organization works on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Knowledge {
    Rules,
    Memories,
    Thoughts,
    Biography,
    Talk,
}

impl Knowledge {
    const ALL: [Knowledge; 5] = [Self::Rules, Self::Memories, Self::Thoughts, Self::Biography, Self::Talk];
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

/// Organizes the rules the agent added in the background after each save.
pub(crate) fn schedule_rules_organization(app: &AppHandle, library_id: &str) {
    schedule(app, library_id, Knowledge::Rules);
}

/// Organizes the person's biography in the background after each save.
pub(crate) fn schedule_biography_organization(app: &AppHandle, library_id: &str) {
    schedule(app, library_id, Knowledge::Biography);
}

/// Organizes the notes on how the person talks after each save.
pub(crate) fn schedule_talk_organization(app: &AppHandle, library_id: &str) {
    schedule(app, library_id, Knowledge::Talk);
}

/// The periodic review of the agent files: repairs their format and then
/// organizes each one in the background (duplicates merged, contradictions
/// settled, a file grown past its size brought back to it). Runs the same
/// organizations as a save, so it never overlaps one.
pub(crate) fn review_agent_files(app: &AppHandle, library_id: &str) {
    match crate::agent_workspace::normalize_agent_files(app, library_id) {
        Ok(0) => {}
        Ok(count) => log::info!("[notia:memory] revisión: {count} archivos del agente con el formato reparado"),
        Err(error) => log::error!("[notia:memory] la revisión no pudo reparar los archivos del agente: {:?}", error.code),
    }
    for kind in Knowledge::ALL {
        schedule(app, library_id, kind);
    }
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
            Knowledge::Rules => organize_rules(&app, &key.0, false),
            Knowledge::Memories => organize_memories(&app, &key.0, false),
            Knowledge::Thoughts => organize_thoughts(&app, &key.0),
            Knowledge::Biography => write_biography(&app, &key.0),
            Knowledge::Talk => organize_talk(&app, &key.0),
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
    organize_memories(app, library_id, true)
}

/// Rewrites a full rules block within `RULES_TARGET`, waiting for the
/// model. Returns whether it wrote.
pub(crate) fn compact_rules(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    organize_rules(app, library_id, true)
}

/// Rewrites a full `talk.md` within its target, waiting for the model.
/// Returns whether it wrote.
pub(crate) fn compact_talk(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    organize_talk(app, library_id)
}

/// Tells the facts waiting in a full `biography.md`, waiting for the
/// model. Returns whether it wrote.
pub(crate) fn write_biography_now(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    write_biography(app, library_id)
}

/// Rewrites a full `thoughts.md` within `THOUGHTS_TARGET`, waiting for the
/// model. Returns whether it wrote.
pub(crate) fn compact_thoughts(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    organize_thoughts(app, library_id)
}

/// Requests already reflected on, so one that ends twice (an answer, then
/// a late cancel) is read once.
fn reflected() -> &'static Mutex<std::collections::VecDeque<String>> {
    static REFLECTED: OnceLock<Mutex<std::collections::VecDeque<String>>> = OnceLock::new();
    REFLECTED.get_or_init(|| Mutex::new(std::collections::VecDeque::new()))
}

const MAX_REFLECTED_REQUESTS: usize = 256;

/// Reads a finished turn in the background and saves what it taught: new
/// memories about the person, the agent's own thoughts, facts of the
/// person's life and traits of how they talk. Each file is then organized
/// as after any save. The turn does not wait for it.
pub(crate) fn schedule_reflection(app: &AppHandle, library_id: &str, idempotency_key: &str, transcript: String) {
    {
        let Ok(mut reflected) = reflected().lock() else { return };
        if reflected.iter().any(|known| known == idempotency_key) {
            return;
        }
        reflected.push_back(idempotency_key.to_string());
        while reflected.len() > MAX_REFLECTED_REQUESTS {
            reflected.pop_front();
        }
    }
    let app = app.clone();
    let library_id = library_id.to_string();
    std::thread::spawn(move || match reflect(&app, &library_id, &transcript) {
        Ok(added) => log::info!(
            "[notia:memory] reflexión: {} memorias, {} pensamientos, {} datos de biografía y {} rasgos de habla nuevos",
            added[0], added[1], added[2], added[3]
        ),
        Err(error) => log::error!("[notia:memory] no se pudo reflexionar sobre el turno: {:?}", error.code),
    });
}

/// Asks the model what the turn taught and saves it. Returns how many
/// memories, thoughts, facts of the biography and traits of talk it added.
fn reflect(app: &AppHandle, library_id: &str, transcript: &str) -> Result<[usize; 4], BackendError> {
    let memories = crate::agent_workspace::memories(app, library_id)?;
    let thoughts = crate::agent_workspace::thoughts(app, library_id)?;
    let biography = crate::agent_workspace::biography(app, library_id)?;
    let biography = [biography.story.clone()]
        .into_iter()
        .chain(biography.notes.iter().map(|note| format!("- {note}")))
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let talk = crate::agent_workspace::list_items(app, library_id, TALK)?;
    let (_, now) = crate::local_time::local_now();
    let known = knowledge::KnownKnowledge { memories: &memories, thoughts: &thoughts, biography: &biography, talk: &talk };
    let (system, user) = knowledge::reflection_messages(transcript, known, &now);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let Some(reflection) = knowledge::parse_reflection(&answer) else {
        return Ok([0; 4]);
    };
    let lists = [
        (AgentItem::Memory, &reflection.memories, Knowledge::Memories),
        (AgentItem::Thought, &reflection.thoughts, Knowledge::Thoughts),
        (AgentItem::Biography, &reflection.biography, Knowledge::Biography),
        (AgentItem::Talk, &reflection.talk, Knowledge::Talk),
    ];
    let mut added = [0; 4];
    for (index, (item, values, kind)) in lists.into_iter().enumerate() {
        for value in values {
            match crate::agent_workspace::append_agent_item(app, library_id, item, value) {
                Ok(true) => added[index] += 1,
                Ok(false) => {}
                Err(error) => log::error!("[notia:memory] un dato de la reflexión ({kind:?}) no se guardó: {:?}", error.code),
            }
        }
        if added[index] > 0 {
            schedule(app, library_id, kind);
        }
    }
    Ok(added)
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

/// The size an organization must bring `items` back to: `target` when the
/// file is full (`compact`) or already grew past it, none otherwise.
fn size_budget(items: &[String], target: ItemBudget, compact: bool) -> Option<ItemBudget> {
    (compact || !target.fits(items)).then_some(target)
}

/// Asks the model to organize `memory.md` (within `MEMORY_TARGET` when it
/// is full or grew past it) and saves the result when the file did not
/// change meanwhile. Returns whether it wrote.
fn organize_memories(app: &AppHandle, library_id: &str, compact: bool) -> Result<bool, BackendError> {
    let memories = crate::agent_workspace::memories(app, library_id)?;
    if memories.len() < 2 {
        return Ok(false);
    }
    let budget = size_budget(&memories, MEMORY_TARGET, compact);
    let (system, user) = knowledge::organize_memories_messages(&memories, budget);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
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
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let Some(organized) = knowledge::parse_organized_thoughts(&answer, &thoughts, THOUGHTS_TARGET) else {
        return Ok(false);
    };
    crate::agent_workspace::replace_thoughts_if_unchanged(app, library_id, &thoughts, &organized)
}

/// Asks the model to organize the rules the agent added (within
/// `RULES_TARGET` when they are full or grew past it) and saves the result
/// when `rules.md` did not change meanwhile. Returns whether it wrote.
fn organize_rules(app: &AppHandle, library_id: &str, compact: bool) -> Result<bool, BackendError> {
    let rules = crate::agent_workspace::rules(app, library_id)?;
    if rules.len() < 2 {
        return Ok(false);
    }
    let budget = size_budget(&rules, RULES_TARGET, compact);
    let (system, user) = knowledge::organize_rules_messages(&rules, budget);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let limit = budget.unwrap_or(crate::backend::agent_workspace::RULES_LIMIT);
    let Some(organized) = knowledge::parse_organized_list(&answer, "rules", &rules, MAX_RULE_CHARS, limit) else {
        return Ok(false);
    };
    crate::agent_workspace::replace_rules_if_unchanged(app, library_id, &rules, &organized)
}

/// Asks the model to organize `talk.md` within its target and saves the
/// result when the file did not change meanwhile. Returns whether it wrote.
fn organize_talk(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    let items = crate::agent_workspace::list_items(app, library_id, TALK)?;
    if items.len() < 2 {
        return Ok(false);
    }
    let (system, user) = knowledge::organize_talk_messages(&items, TALK.target);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let Some(organized) = knowledge::parse_organized_list(&answer, "talk", &items, TALK.max_item_chars, TALK.target) else {
        return Ok(false);
    };
    crate::agent_workspace::replace_list_if_unchanged(app, library_id, TALK, &items, &organized)
}

/// Asks the model to write `biography.md` again as a book, with the facts
/// waiting woven into the story, and saves it when the file did not change
/// meanwhile. When the story and the facts would pass
/// `BIOGRAPHY_STORY_TARGET`, the story is also shortened. A rejected answer
/// leaves the facts waiting for the next try. Returns whether it wrote.
fn write_biography(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    let biography = crate::agent_workspace::biography(app, library_id)?;
    if !biography.needs_writing() {
        return Ok(false);
    }
    let pending_chars = biography.story.chars().count() + biography.notes.iter().map(|note| note.chars().count()).sum::<usize>();
    let compact = pending_chars > BIOGRAPHY_STORY_TARGET;
    let (system, user) = knowledge::write_biography_messages(&biography, compact);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let Some(story) = knowledge::parse_biography_story(&answer, &biography, compact) else {
        log::warn!("[notia:memory] la biografía escrita por el modelo no se usó; los datos siguen pendientes");
        return Ok(false);
    };
    crate::agent_workspace::replace_biography_if_unchanged(app, library_id, &biography, story)
}
