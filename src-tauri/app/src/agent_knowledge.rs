//! Background knowledge tasks: naming a new chat after its first turn,
//! organizing the agent files (`rules.md`, `memory.md`, `thoughts.md`,
//! `biography.md`, `talk.md`, `people.md`) together, in one model call,
//! each time one of them changes, in the periodic review and when one is
//! full. Prompts and parsing live in `backend_core::agent_knowledge`. The
//! agent itself saves to them with its `add_agent_*` tools and the
//! reflection after each turn; the organization is a separate model call
//! without tools and without the memory context.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::host::AppHandle;

use crate::agent_workspace::AgentItem;
use crate::backend::agent_knowledge as knowledge;
use crate::backend::BackendError;

/// A chat title is short.
const TITLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);
/// Organizing reads every agent file and may write the whole biography
/// again, which takes long with large files.
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

/// Libraries whose agent files are being organized, and whether they
/// changed again meanwhile (then the organization runs once more).
fn organizing() -> &'static Mutex<HashMap<String, bool>> {
    static ORGANIZING: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    ORGANIZING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Saves that arrive together (the tools of a turn, then its reflection)
/// wait this long, so one organization reads them all.
const ORGANIZE_DELAY: std::time::Duration = std::time::Duration::from_secs(20);

/// Organizes every agent file of `.agent/memory` together in the
/// background after any of them changes, without delaying the turn that
/// saved it. One run per library at a time; a change during a run
/// schedules one more.
pub(crate) fn schedule_organization(app: &AppHandle, library_id: &str) {
    let key = library_id.to_string();
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
        std::thread::sleep(ORGANIZE_DELAY);
        match organize(&app, &key) {
            Ok(true) => log::info!("[notia:memory] archivos del agente organizados"),
            Ok(false) => {}
            Err(error) => log::warn!("[notia:memory] no se pudieron organizar los archivos del agente: {}", error.message),
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

/// The periodic review of the agent files: repairs their format and then
/// organizes them together in the background (duplicates merged within and
/// across files, contradictions settled, a file grown past its size brought
/// back to it, the biography written). Runs the same organization as a
/// save, so it never overlaps one.
pub(crate) fn review_agent_files(app: &AppHandle, library_id: &str) {
    match crate::agent_workspace::normalize_agent_files(app, library_id) {
        Ok(0) => {}
        Ok(count) => log::info!("[notia:memory] revisión: {count} archivos del agente con el formato reparado"),
        Err(error) => log::error!("[notia:memory] la revisión no pudo reparar los archivos del agente: {:?}", error.code),
    }
    schedule_organization(app, library_id);
}

/// Organizes the agent files now, waiting for the model: a full file is
/// brought back within its target and waiting biography facts are told.
/// Returns whether it wrote.
pub(crate) fn organize_now(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    organize(app, library_id)
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
/// person's life, traits of how they talk and who the people they mention
/// are. The files are then organized together, as after any save. The turn
/// does not wait for it.
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
            "[notia:memory] reflexión: {} memorias, {} pensamientos, {} datos de biografía, {} rasgos de habla, {} personas y {} mejoras nuevos",
            added[0], added[1], added[2], added[3], added[4], added[5]
        ),
        Err(error) => log::error!("[notia:memory] no se pudo reflexionar sobre el turno: {:?}", error.code),
    });
}

/// The biography as it reads now: the story and the facts still to tell.
fn biography_text(biography: &crate::backend::agent_workspace::Biography) -> String {
    [biography.story.clone()]
        .into_iter()
        .chain(biography.notes.iter().map(|note| format!("- {note}")))
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Asks the model what the turn taught and saves it. Returns how many
/// memories, thoughts, facts of the biography, traits of talk, people and
/// improvements it added.
fn reflect(app: &AppHandle, library_id: &str, transcript: &str) -> Result<[usize; 6], BackendError> {
    let files = crate::agent_workspace::agent_files(app, library_id)?;
    let improvements = crate::agent_workspace::improvements(app, library_id)?;
    let biography = biography_text(&files.biography);
    let (_, now) = crate::local_time::local_now();
    let known = knowledge::KnownKnowledge {
        memories: &files.memories,
        thoughts: &files.thoughts,
        biography: &biography,
        talk: &files.talk,
        people: &files.people,
        improvements: &improvements,
    };
    let (system, user) = knowledge::reflection_messages(transcript, known, &now);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let Some(reflection) = knowledge::parse_reflection(&answer) else {
        return Ok([0; 6]);
    };
    let lists = [
        (AgentItem::Memory, &reflection.memories, "memoria"),
        (AgentItem::Thought, &reflection.thoughts, "pensamientos"),
        (AgentItem::Biography, &reflection.biography, "biografía"),
        (AgentItem::Talk, &reflection.talk, "forma de hablar"),
        (AgentItem::Person, &reflection.people, "personas"),
    ];
    let mut added = [0; 5];
    for (index, (item, values, file)) in lists.into_iter().enumerate() {
        for value in values {
            match crate::agent_workspace::append_agent_item(app, library_id, item, value) {
                Ok(true) => added[index] += 1,
                Ok(false) => {}
                Err(error) => log::error!("[notia:memory] un dato de la reflexión ({file}) no se guardó: {:?}", error.code),
            }
        }
    }
    if added.iter().any(|count| *count > 0) {
        schedule_organization(app, library_id);
    }
    // `improve.md` is not organized: nothing reads it into a prompt.
    let mut improved = 0;
    for (kind, text) in &reflection.improvements {
        match crate::agent_workspace::append_improvement(app, library_id, *kind, text) {
            Ok(true) => improved += 1,
            Ok(false) => {}
            Err(error) => log::error!("[notia:memory] una mejora de la reflexión no se guardó: {:?}", error.code),
        }
    }
    Ok([added[0], added[1], added[2], added[3], added[4], improved])
}

/// Saves a thought Notia keeps by itself (for example, a message it sent)
/// and organizes the agent files afterwards. Returns whether it wrote.
pub(crate) fn keep_thought(app: &AppHandle, library_id: &str, thought: &str) -> Result<bool, BackendError> {
    let changed = crate::agent_workspace::append_agent_item(app, library_id, AgentItem::Thought, thought)?;
    if changed {
        schedule_organization(app, library_id);
    }
    Ok(changed)
}

/// Asks the model to organize every agent file of `.agent/memory` in one
/// call (`backend_core::agent_knowledge::organize_files_messages`) and
/// saves what it changed when no file changed meanwhile. Invalid
/// operations leave the list files as they were, and a story that is not
/// usable leaves the biography facts waiting for the next run. Returns
/// whether it wrote.
fn organize(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    let files = crate::agent_workspace::agent_files(app, library_id)?;
    if !files.needs_organization() {
        return Ok(false);
    }
    let (_, now) = crate::local_time::local_now();
    let (system, user) = knowledge::organize_files_messages(&files, &now);
    let answer = crate::backend_runtime::complete_text(app, library_id, &system, &user, ORGANIZE_TIMEOUT)?;
    let Some(organization) = knowledge::parse_organization(&answer, &files, &crate::local_time::thought_stamp()) else {
        log::warn!("[notia:memory] la organización de los archivos del agente no devolvió un JSON válido");
        return Ok(false);
    };
    if organization.lists.is_none() {
        log::warn!("[notia:memory] las operaciones de la organización no eran válidas; las listas quedan como estaban");
    }
    if files.biography.needs_writing() && organization.biography.is_none() {
        log::warn!("[notia:memory] la biografía escrita por el modelo no se usó; los datos siguen pendientes");
    }
    crate::agent_workspace::replace_agent_files_if_unchanged(app, library_id, &files, &organization)
}
