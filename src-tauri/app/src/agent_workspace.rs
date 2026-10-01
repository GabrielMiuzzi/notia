//! The library's `.agent` workspace exposed to the interface: folder
//! structure, the visual copy of the default prompt, custom prompts and the
//! selected one, rules added by the agent, persistent memories, the agent's
//! own thoughts, the person's biography and their way of talking. The
//! content rules live in `backend_core::agent_workspace`.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager};

use crate::backend::agent_workspace as workspace;
use crate::backend::{
    BackendError, BackendErrorCode,
};
use crate::library_documents::{inventory_paths, with_documents, Documents};
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const SELECTION_FILE: &str = "agent-prompt-selection.json";
const MAX_SELECTION_BYTES: u64 = 64 * 1024;

/// Libraries whose workspace was prepared in this session, and the lock
/// that serializes workspace writes and the selection file.
#[derive(Default)]
pub(crate) struct AgentWorkspaceState {
    prepared: Mutex<HashSet<String>>,
    lock: Mutex<()>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentLibraryPayload {
    library_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPromptPayload {
    library_id: String,
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentItemsPayload {
    library_id: String,
    items: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPromptOption {
    pub(crate) file_name: String,
    pub(crate) name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPromptList {
    pub(crate) prompts: Vec<AgentPromptOption>,
    selected: String,
}

fn internal() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación del agente.", true)
}

async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, BackendError> + Send + 'static,
) -> Result<T, BackendError> {
    crate::host::async_runtime::spawn_blocking(run).await.map_err(|_| internal())?
}

fn is_agent_text_file(path: &str) -> bool {
    let lowered = path.to_ascii_lowercase();
    [".md", ".markdown", ".txt"].iter().any(|extension| lowered.ends_with(extension))
}

/// Folders, rules (with personal facts moved to memory), memory, the visual
/// default prompt and the confidential context of every agent file.
fn prepare_workspace(app: &AppHandle, library_id: &str) -> Result<(), BackendError> {
    {
        let registry = app.state::<LibraryBindingRegistry>();
        let picker = app.state::<AndroidDirectoryPickerState>();
        for folder in workspace::AGENT_FOLDERS {
            let (parent, name) = folder.rsplit_once('/').unwrap_or(("", folder));
            crate::filesystem::commands::ensure_library_folder(
                registry.inner(),
                picker.inner(),
                library_id,
                parent,
                name,
            )?;
        }
    }
    with_documents(app, library_id, |documents| {
        let rules = documents.read(workspace::RULES_PATH)?;
        let (rules_body, misclassified) =
            workspace::migrate_misclassified_rules(rules.as_deref().map(workspace::document_body).unwrap_or(""));
        documents.write(
            workspace::RULES_PATH,
            rules.as_deref(),
            &workspace::with_confidential_context(&rules_body),
        )?;

        let memory = documents.read(workspace::MEMORY_PATH)?;
        let mut memories = workspace::parse_memory_items(memory.as_deref().map(workspace::document_body).unwrap_or(""));
        memories.extend(misclassified);
        let memory_content = workspace::with_confidential_context(&workspace::render_memories(&workspace::merge_memories(memories)));
        let unchanged_memory = memory.as_deref().is_some_and(|current| {
            workspace::parse_memory_items(workspace::document_body(current))
                == workspace::parse_memory_items(workspace::document_body(&memory_content))
                && workspace::with_confidential_context(current) == *current
        });
        if !unchanged_memory {
            documents.write(workspace::MEMORY_PATH, memory.as_deref(), &memory_content)?;
        }
        write_missing_lists(documents)?;

        let default_prompt = documents.read(workspace::DEFAULT_PROMPT_PATH)?;
        documents.write(
            workspace::DEFAULT_PROMPT_PATH,
            default_prompt.as_deref(),
            crate::backend::DEFAULT_AGENT_PROMPT,
        )?;
        Ok(())
    })?;
    let files = inventory_paths(app, library_id, workspace::AGENT_DIRECTORY)?;
    with_documents(app, library_id, |documents| {
        for path in files.iter().filter(|path| is_agent_text_file(path)) {
            if path.eq_ignore_ascii_case(workspace::DEFAULT_PROMPT_PATH) {
                continue;
            }
            if let Some(current) = documents.read(path)? {
                documents.write(path, Some(&current), &workspace::with_confidential_context(&current))?;
            }
        }
        Ok(())
    })
}

/// Prepares the workspace once per library and session.
pub(crate) fn ensure_workspace(app: &AppHandle, library_id: &str) -> Result<(), BackendError> {
    let state = app.state::<AgentWorkspaceState>();
    let _guard = state.lock.lock().map_err(|_| internal())?;
    if state.prepared.lock().map_err(|_| internal())?.contains(library_id) {
        return Ok(());
    }
    prepare_workspace(app, library_id)?;
    state.prepared.lock().map_err(|_| internal())?.insert(library_id.to_string());
    Ok(())
}

/// Forgets the prepared mark so the next access rebuilds the workspace.
pub(crate) fn forget_library(app: &AppHandle, library_id: &str) {
    if let Ok(mut prepared) = app.state::<AgentWorkspaceState>().prepared.lock() {
        prepared.remove(library_id);
    }
}

fn selection_file(app: &AppHandle) -> Result<PathBuf, BackendError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(SELECTION_FILE))
        .map_err(|_| BackendError::new(BackendErrorCode::Storage, "No se pudo acceder a la selección de prompts.", true))
}

fn read_selections(app: &AppHandle) -> HashMap<String, String> {
    let Ok(path) = selection_file(app) else {
        return HashMap::new();
    };
    if std::fs::metadata(&path).map(|metadata| metadata.len() > MAX_SELECTION_BYTES).unwrap_or(true) {
        return HashMap::new();
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Prompt file selected for the library on this device.
pub(crate) fn selected_prompt(app: &AppHandle, library_id: &str) -> String {
    read_selections(app)
        .get(library_id)
        .map(|name| workspace::normalize_prompt_file_name(name))
        .unwrap_or_else(|| workspace::DEFAULT_PROMPT_FILE.to_string())
}

fn save_selection(app: &AppHandle, library_id: &str, file_name: &str) -> Result<(), BackendError> {
    let mut selections = read_selections(app);
    selections.insert(library_id.to_string(), workspace::normalize_prompt_file_name(file_name));
    let path = selection_file(app)?;
    let storage = || BackendError::new(BackendErrorCode::Storage, "No se pudo guardar la selección de prompt.", true);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| storage())?;
    }
    let text = serde_json::to_string_pretty(&selections).map_err(|_| storage())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(|_| storage())?;
    std::fs::rename(&temporary, &path).map_err(|_| storage())
}

pub(crate) fn list_prompts(app: &AppHandle, library_id: &str) -> Result<AgentPromptList, BackendError> {
    ensure_workspace(app, library_id)?;
    let prefix = format!("{}/", workspace::PROMPTS_DIRECTORY);
    let names = inventory_paths(app, library_id, workspace::PROMPTS_DIRECTORY)?
        .into_iter()
        .filter_map(|path| path.strip_prefix(&prefix).map(str::to_string))
        .filter(|name| !name.contains('/') && name.to_ascii_lowercase().ends_with(".md"));
    let prompts = workspace::prompt_file_names(names)
        .into_iter()
        .map(|file_name| AgentPromptOption {
            name: file_name[..file_name.len() - 3].to_string(),
            file_name,
        })
        .collect::<Vec<_>>();
    let selected = selected_prompt(app, library_id);
    let selected = if prompts.iter().any(|prompt| prompt.file_name == selected) {
        selected
    } else {
        workspace::DEFAULT_PROMPT_FILE.to_string()
    };
    Ok(AgentPromptList { prompts, selected })
}

fn validate_items(items: &[String]) -> Result<(), BackendError> {
    if items.len() > workspace::MAX_MEMORIES || items.iter().any(|item| item.chars().count() > workspace::MAX_RULE_CHARS) {
        return Err(BackendError::invalid_input("La lista del agente no es válida o supera el límite."));
    }
    Ok(())
}

fn with_workspace_lock<T>(app: &AppHandle, run: impl FnOnce() -> Result<T, BackendError>) -> Result<T, BackendError> {
    let state = app.state::<AgentWorkspaceState>();
    let _guard = state.lock.lock().map_err(|_| internal())?;
    run()
}

pub(crate) async fn backend_agent_prompts(
    app: AppHandle,
    payload: AgentLibraryPayload,
) -> Result<AgentPromptList, BackendError> {
    blocking(move || list_prompts(&app, &payload.library_id)).await
}

pub(crate) async fn backend_select_agent_prompt(
    app: AppHandle,
    payload: AgentPromptPayload,
) -> Result<String, BackendError> {
    blocking(move || {
        app.state::<LibraryBindingRegistry>().lookup(&payload.library_id)?;
        with_workspace_lock(&app, || save_selection(&app, &payload.library_id, &payload.file_name))?;
        Ok(selected_prompt(&app, &payload.library_id))
    })
    .await
}

/// Memories saved in `memory.md`.
pub(crate) fn memories(app: &AppHandle, library_id: &str) -> Result<Vec<String>, BackendError> {
    ensure_workspace(app, library_id)?;
    with_documents(app, library_id, |documents| {
        Ok(documents
            .read(workspace::MEMORY_PATH)?
            .map(|content| workspace::parse_memory_items(workspace::document_body(&content)))
            .unwrap_or_default())
    })
}

/// Replaces the memories with `next` only when `memory.md` still holds
/// `expected`, so a memory saved meanwhile is never overwritten. Returns
/// whether it wrote.
pub(crate) fn replace_memories_if_unchanged(
    app: &AppHandle,
    library_id: &str,
    expected: &[String],
    next: Vec<String>,
) -> Result<bool, BackendError> {
    validate_items(&next)?;
    let next = workspace::merge_memories(next);
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let current = documents.read(workspace::MEMORY_PATH)?;
            let saved = current
                .as_deref()
                .map(|content| workspace::parse_memory_items(workspace::document_body(content)))
                .unwrap_or_default();
            if saved != expected || saved == next {
                return Ok(false);
            }
            documents.write(
                workspace::MEMORY_PATH,
                current.as_deref(),
                &workspace::with_confidential_context(&workspace::render_memories(&next)),
            )?;
            Ok(true)
        })
    })
}

/// Replaces the memories (deduplicated and capped).
pub(crate) fn save_memories(app: &AppHandle, library_id: &str, items: Vec<String>) -> Result<Vec<String>, BackendError> {
    validate_items(&items)?;
    ensure_workspace(app, library_id)?;
    let memories = workspace::merge_memories(items);
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let current = documents.read(workspace::MEMORY_PATH)?;
            documents.write(
                workspace::MEMORY_PATH,
                current.as_deref(),
                &workspace::with_confidential_context(&workspace::render_memories(&memories)),
            )
        })
    })?;
    Ok(memories)
}

pub(crate) async fn backend_save_agent_memories(app: AppHandle, payload: AgentItemsPayload) -> Result<Vec<String>, BackendError> {
    blocking(move || {
        let saved = save_memories(&app, &payload.library_id, payload.items)?;
        if !saved.is_empty() {
            crate::agent_knowledge::schedule_memory_organization(&app, &payload.library_id);
        }
        Ok(saved)
    })
    .await
}

fn read_items(documents: &Documents<'_>, path: &str) -> Result<(Option<String>, Vec<String>), BackendError> {
    let current = documents.read(path)?;
    let items = current
        .as_deref()
        .map(|content| workspace::parse_memory_items(workspace::document_body(content)))
        .unwrap_or_default();
    Ok((current, items))
}

/// Writes the empty thoughts, biography and talk files that are missing.
/// Returns whether it wrote any.
fn write_missing_lists(documents: &Documents<'_>) -> Result<bool, BackendError> {
    let empty = [
        (workspace::THOUGHTS_PATH, workspace::render_thoughts(&[])),
        (workspace::BIOGRAPHY_PATH, workspace::Biography::default().render()),
        (workspace::TALK.path, workspace::TALK.render(&[])),
    ];
    let mut wrote = false;
    for (path, body) in empty {
        if documents.read(path)?.is_none() {
            documents.write(path, None, &workspace::with_confidential_context(&body))?;
            wrote = true;
        }
    }
    Ok(wrote)
}

/// Creates `thoughts.md`, `biography.md` and `talk.md` again when they are
/// missing (deleted or never made). Unlike the session preparation, it
/// looks at the files every time. Returns whether it wrote.
pub(crate) fn ensure_agent_list_files(app: &AppHandle, library_id: &str) -> Result<bool, BackendError> {
    with_workspace_lock(app, || with_documents(app, library_id, write_missing_lists))
}

/// The agent's thoughts saved in `thoughts.md`.
pub(crate) fn thoughts(app: &AppHandle, library_id: &str) -> Result<Vec<String>, BackendError> {
    with_documents(app, library_id, |documents| read_items(documents, workspace::THOUGHTS_PATH).map(|(_, items)| items))
}

/// Replaces the thoughts with `next` only when `thoughts.md` still holds
/// `expected`, so a thought saved meanwhile is never lost. Returns whether
/// it wrote.
pub(crate) fn replace_thoughts_if_unchanged(
    app: &AppHandle,
    library_id: &str,
    expected: &[String],
    next: &[String],
) -> Result<bool, BackendError> {
    if !workspace::THOUGHTS_LIMIT.fits(next) {
        return Err(BackendError::invalid_input("Los pensamientos del agente superan el límite."));
    }
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let (current, saved) = read_items(documents, workspace::THOUGHTS_PATH)?;
            if saved != expected || saved == next {
                return Ok(false);
            }
            documents.write(
                workspace::THOUGHTS_PATH,
                current.as_deref(),
                &workspace::with_confidential_context(&workspace::render_thoughts(next)),
            )?;
            Ok(true)
        })
    })
}

/// Items of a list file of the agent (`talk.md`).
pub(crate) fn list_items(app: &AppHandle, library_id: &str, file: workspace::AgentListFile) -> Result<Vec<String>, BackendError> {
    with_documents(app, library_id, |documents| read_items(documents, file.path).map(|(_, items)| items))
}

/// Replaces the items of `file` with `next` only when it still holds
/// `expected`, so an item saved meanwhile is never lost. Returns whether it
/// wrote.
pub(crate) fn replace_list_if_unchanged(
    app: &AppHandle,
    library_id: &str,
    file: workspace::AgentListFile,
    expected: &[String],
    next: &[String],
) -> Result<bool, BackendError> {
    if !file.limit.fits(next) || next.iter().any(|item| item.chars().count() > file.max_item_chars) {
        return Err(BackendError::invalid_input("La lista del agente supera el límite."));
    }
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let (current, saved) = read_items(documents, file.path)?;
            if saved != expected || saved == next {
                return Ok(false);
            }
            documents.write(file.path, current.as_deref(), &workspace::with_confidential_context(&file.render(next)))?;
            Ok(true)
        })
    })
}

fn read_biography(documents: &Documents<'_>) -> Result<(Option<String>, workspace::Biography), BackendError> {
    let current = documents.read(workspace::BIOGRAPHY_PATH)?;
    let biography = workspace::Biography::parse(current.as_deref().map(workspace::document_body).unwrap_or(""));
    Ok((current, biography))
}

/// The person's biography: its story and the facts still to tell.
pub(crate) fn biography(app: &AppHandle, library_id: &str) -> Result<workspace::Biography, BackendError> {
    with_documents(app, library_id, |documents| read_biography(documents).map(|(_, biography)| biography))
}

/// Writes `story` as the biography, with every fact told, only when the
/// file still holds `expected`, so a fact added meanwhile is never lost.
/// Returns whether it wrote.
pub(crate) fn replace_biography_if_unchanged(
    app: &AppHandle,
    library_id: &str,
    expected: &workspace::Biography,
    story: String,
) -> Result<bool, BackendError> {
    if story.chars().count() > workspace::BIOGRAPHY_STORY_LIMIT {
        return Err(BackendError::invalid_input("La biografía supera el límite."));
    }
    let next = workspace::Biography { story, notes: Vec::new() };
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let (current, saved) = read_biography(documents)?;
            if saved != *expected || saved == next {
                return Ok(false);
            }
            documents.write(workspace::BIOGRAPHY_PATH, current.as_deref(), &workspace::with_confidential_context(&next.render()))?;
            Ok(true)
        })
    })
}

fn append_biography_locked(app: &AppHandle, library_id: &str, fact: &str) -> Result<Appended, BackendError> {
    with_documents(app, library_id, |documents| {
        let (current, biography) = read_biography(documents)?;
        let next = match biography.with_note(fact) {
            workspace::BiographyAppend::Added(next) => next,
            workspace::BiographyAppend::Unchanged => return Ok(Appended::Changed(false)),
            workspace::BiographyAppend::Full => return Ok(Appended::Full),
        };
        documents.write(workspace::BIOGRAPHY_PATH, current.as_deref(), &workspace::with_confidential_context(&next.render()))?;
        Ok(Appended::Changed(true))
    })
}

/// Rules the agent added, without the managed default block.
pub(crate) fn rules(app: &AppHandle, library_id: &str) -> Result<Vec<String>, BackendError> {
    with_documents(app, library_id, |documents| {
        Ok(workspace::ia_rules(documents.read(workspace::RULES_PATH)?.as_deref().map(workspace::document_body).unwrap_or("")))
    })
}

/// Replaces the rules the agent added with `next` only when `rules.md`
/// still holds `expected`. Returns whether it wrote.
pub(crate) fn replace_rules_if_unchanged(
    app: &AppHandle,
    library_id: &str,
    expected: &[String],
    next: &[String],
) -> Result<bool, BackendError> {
    if !workspace::RULES_LIMIT.fits(next) || next.iter().any(|rule| rule.chars().count() > workspace::MAX_RULE_CHARS) {
        return Err(BackendError::invalid_input("Las reglas del agente superan el límite."));
    }
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let current = documents.read(workspace::RULES_PATH)?;
            let body = current.as_deref().map(workspace::document_body).unwrap_or("");
            let saved = workspace::ia_rules(body);
            if saved != expected || saved == next {
                return Ok(false);
            }
            let next_body = workspace::replace_ia_rules(body, next);
            documents.write(workspace::RULES_PATH, current.as_deref(), &workspace::with_confidential_context(&next_body))?;
            Ok(true)
        })
    })
}

/// Rewrites each agent file whose text is not in its canonical form (a
/// hand edit, an old version, stray markers), keeping every item: the rules
/// with the current default block, and the memory, thoughts, biography and
/// talk as clean deduplicated lists, and the biography's story and facts to
/// tell, each with its version marker and the confidential context. Returns how many files it rewrote.
pub(crate) fn normalize_agent_files(app: &AppHandle, library_id: &str) -> Result<usize, BackendError> {
    ensure_workspace(app, library_id)?;
    let canonical = |path: &str, body: &str| match path {
        workspace::RULES_PATH => workspace::canonical_rules(body),
        workspace::MEMORY_PATH => workspace::render_memories(&workspace::merge_memories(workspace::parse_memory_items(body))),
        workspace::THOUGHTS_PATH => workspace::render_thoughts(&workspace::parse_memory_items(body)),
        workspace::BIOGRAPHY_PATH => workspace::Biography::parse(body).render(),
        _ => workspace::TALK.render(&workspace::parse_memory_items(body)),
    };
    let comparable = |text: &str| text.replace("\r\n", "\n").trim().to_string();
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let mut rewritten = 0;
            for path in [
                workspace::RULES_PATH,
                workspace::MEMORY_PATH,
                workspace::THOUGHTS_PATH,
                workspace::BIOGRAPHY_PATH,
                workspace::TALK.path,
            ] {
                let Some(current) = documents.read(path)? else { continue };
                let next = workspace::with_confidential_context(&canonical(path, workspace::document_body(&current)));
                if comparable(&next) != comparable(&current) {
                    documents.write(path, Some(&current), &next)?;
                    rewritten += 1;
                }
            }
            Ok(rewritten)
        })
    })
}

/// Result of adding one item to a bounded agent file.
enum Appended {
    Changed(bool),
    /// The file has no room: it must be rewritten first.
    Full,
}

fn append_memory_locked(app: &AppHandle, library_id: &str, value: &str) -> Result<Appended, BackendError> {
    with_documents(app, library_id, |documents| {
        let (current, mut memories) = read_items(documents, workspace::MEMORY_PATH)?;
        if memories.iter().any(|memory| memory.eq_ignore_ascii_case(value)) {
            return Ok(Appended::Changed(false));
        }
        if !workspace::MEMORY_LIMIT.fits_one_more(&memories, value) {
            return Ok(Appended::Full);
        }
        memories.push(value.to_string());
        documents.write(
            workspace::MEMORY_PATH,
            current.as_deref(),
            &workspace::with_confidential_context(&workspace::render_memories(&memories)),
        )?;
        Ok(Appended::Changed(true))
    })
}

fn append_thought_locked(app: &AppHandle, library_id: &str, stamped: &str) -> Result<Appended, BackendError> {
    with_documents(app, library_id, |documents| {
        let (current, thoughts) = read_items(documents, workspace::THOUGHTS_PATH)?;
        let next = workspace::with_thought(&thoughts, stamped.to_string());
        if !workspace::THOUGHTS_LIMIT.fits(&next) {
            return Ok(Appended::Full);
        }
        documents.write(
            workspace::THOUGHTS_PATH,
            current.as_deref(),
            &workspace::with_confidential_context(&workspace::render_thoughts(&next)),
        )?;
        Ok(Appended::Changed(true))
    })
}

/// Adds an item under the workspace lock. When the file is full, the model
/// rewrites it (`rewrite`, run without the lock because it calls the model)
/// and the item is added once more; a file still full is an error, so
/// nothing is dropped silently.
fn append_bounded(
    app: &AppHandle,
    append: impl Fn() -> Result<Appended, BackendError>,
    rewrite: impl FnOnce() -> Result<bool, BackendError>,
    full: &str,
) -> Result<bool, BackendError> {
    if let Appended::Changed(changed) = with_workspace_lock(app, &append)? {
        return Ok(changed);
    }
    if let Err(error) = rewrite() {
        log::error!("[notia:memory] no se pudo reescribir un archivo lleno del agente: {:?}", error.code);
    }
    match with_workspace_lock(app, &append)? {
        Appended::Changed(changed) => Ok(changed),
        Appended::Full => Err(BackendError::invalid_input(full)),
    }
}

fn append_list_locked(
    app: &AppHandle,
    library_id: &str,
    file: workspace::AgentListFile,
    value: &str,
) -> Result<Appended, BackendError> {
    with_documents(app, library_id, |documents| {
        let (current, mut items) = read_items(documents, file.path)?;
        if items.iter().any(|item| item.eq_ignore_ascii_case(value)) {
            return Ok(Appended::Changed(false));
        }
        if !file.limit.fits_one_more(&items, value) {
            return Ok(Appended::Full);
        }
        items.push(value.to_string());
        documents.write(file.path, current.as_deref(), &workspace::with_confidential_context(&file.render(&items)))?;
        Ok(Appended::Changed(true))
    })
}

fn append_rule_locked(app: &AppHandle, library_id: &str, rule: &str) -> Result<Appended, BackendError> {
    with_documents(app, library_id, |documents| {
        let current = documents.read(workspace::RULES_PATH)?;
        let body = match workspace::append_rule(current.as_deref().map(workspace::document_body).unwrap_or(""), rule) {
            workspace::RuleAppend::Added(body) => body,
            workspace::RuleAppend::Unchanged => return Ok(Appended::Changed(false)),
            workspace::RuleAppend::Full => return Ok(Appended::Full),
        };
        documents.write(workspace::RULES_PATH, current.as_deref(), &workspace::with_confidential_context(&body))?;
        Ok(Appended::Changed(true))
    })
}

/// Persists a rule, memory, thought, part of the biography or trait of the
/// person's way of talking requested by the agent tool, with the same
/// format the interface reads. A thought is dated here. A full file is
/// rewritten by the model before adding. Returns whether the file changed.
pub(crate) fn append_agent_item(app: &AppHandle, library_id: &str, kind: AgentItem, value: &str) -> Result<bool, BackendError> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > workspace::MAX_RULE_CHARS {
        return Err(BackendError::invalid_input("El contenido de memoria no es válido o supera el límite."));
    }
    ensure_workspace(app, library_id)?;
    match kind {
        AgentItem::Rule => append_bounded(
            app,
            || append_rule_locked(app, library_id, &value),
            || crate::agent_knowledge::compact_rules(app, library_id),
            "Las reglas del agente están llenas y no se pudieron reorganizar. Probá de nuevo más tarde.",
        ),
        AgentItem::Memory => append_bounded(
            app,
            || append_memory_locked(app, library_id, &value),
            || crate::agent_knowledge::compact_memories(app, library_id),
            "La memoria del agente está llena y no se pudo reorganizar. Probá de nuevo más tarde.",
        ),
        AgentItem::Thought => {
            let stamped = workspace::stamp_thought(&crate::local_time::thought_stamp(), &value).ok_or_else(|| {
                BackendError::invalid_input(format!(
                    "Un pensamiento debe ser una oración breve de hasta {} caracteres.",
                    workspace::MAX_THOUGHT_CHARS
                ))
            })?;
            append_bounded(
                app,
                || append_thought_locked(app, library_id, &stamped),
                || crate::agent_knowledge::compact_thoughts(app, library_id),
                "Tus pensamientos están llenos y no se pudieron reorganizar. Probá de nuevo más tarde.",
            )
        }
        AgentItem::Biography => {
            if value.chars().count() > workspace::MAX_BIOGRAPHY_NOTE_CHARS {
                return Err(BackendError::invalid_input(format!(
                    "Cada dato de la biografía debe ser una oración breve de hasta {} caracteres.",
                    workspace::MAX_BIOGRAPHY_NOTE_CHARS
                )));
            }
            append_bounded(
                app,
                || append_biography_locked(app, library_id, &value),
                || crate::agent_knowledge::write_biography_now(app, library_id),
                "La biografía tiene demasiados datos sin contar y no se pudo escribir. Probá de nuevo más tarde.",
            )
        }
        AgentItem::Talk => {
            if value.chars().count() > workspace::TALK.max_item_chars {
                return Err(BackendError::invalid_input(format!(
                    "Cada rasgo debe ser una oración breve de hasta {} caracteres.",
                    workspace::TALK.max_item_chars
                )));
            }
            append_bounded(
                app,
                || append_list_locked(app, library_id, workspace::TALK, &value),
                || crate::agent_knowledge::compact_talk(app, library_id),
                "El archivo del agente está lleno y no se pudo reorganizar. Probá de nuevo más tarde.",
            )
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum AgentItem {
    Rule,
    Memory,
    Thought,
    Biography,
    Talk,
}
