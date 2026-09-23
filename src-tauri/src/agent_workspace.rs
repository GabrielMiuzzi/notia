//! The library's `.agent` workspace exposed to the interface: folder
//! structure, the visual copy of the default prompt, custom prompts and the
//! selected one, rules added by the agent and persistent memories. The
//! content rules live in `backend_core::agent_workspace`.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::backend::agent_workspace as workspace;
use crate::backend::{
    BackendError, BackendErrorCode,
};
use crate::library_documents::{inventory_paths, with_documents};
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const SELECTION_FILE: &str = "agent-prompt-selection.json";
const MAX_SELECTION_BYTES: u64 = 64 * 1024;
const MAX_PROMPT_CHARS: usize = 200_000;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRulePayload {
    library_id: String,
    rule: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPromptOption {
    file_name: String,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentPromptList {
    prompts: Vec<AgentPromptOption>,
    selected: String,
}

fn internal() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación del agente.", true)
}

async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, BackendError> + Send + 'static,
) -> Result<T, BackendError> {
    tauri::async_runtime::spawn_blocking(run).await.map_err(|_| internal())?
}

fn is_agent_text_file(path: &str) -> bool {
    let lowered = path.to_ascii_lowercase();
    [".md", ".markdown", ".txt"].iter().any(|extension| lowered.ends_with(extension))
}

/// Folders, rules (with personal facts moved to memory), memory, the legacy
/// memory migration, the visual default prompt and the confidential context
/// of every agent file.
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
        if let Some(legacy) = documents.read(workspace::LEGACY_MEMORY_PATH)? {
            let legacy_items = workspace::parse_memory_items(workspace::document_body(&legacy));
            // The backup marks the one-time migration; the legacy file is
            // never read again so two memory sources cannot diverge.
            if !legacy_items.is_empty() && documents.read(workspace::LEGACY_MEMORY_BACKUP_PATH)?.is_none() {
                documents.write(
                    workspace::LEGACY_MEMORY_BACKUP_PATH,
                    None,
                    &workspace::legacy_memory_backup(&legacy),
                )?;
                memories.extend(legacy_items);
            }
        }
        let memory_content = workspace::with_confidential_context(&workspace::render_memories(&workspace::merge_memories(memories)));
        let unchanged_memory = memory.as_deref().is_some_and(|current| {
            workspace::parse_memory_items(workspace::document_body(current))
                == workspace::parse_memory_items(workspace::document_body(&memory_content))
                && workspace::with_confidential_context(current) == *current
        });
        if !unchanged_memory {
            documents.write(workspace::MEMORY_PATH, memory.as_deref(), &memory_content)?;
        }

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
fn ensure_workspace(app: &AppHandle, library_id: &str) -> Result<(), BackendError> {
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

fn list_prompts(app: &AppHandle, library_id: &str) -> Result<AgentPromptList, BackendError> {
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

fn load_prompt(app: &AppHandle, library_id: &str, file_name: &str) -> Result<String, BackendError> {
    let file_name = workspace::normalize_prompt_file_name(file_name);
    // The default prompt runs from the embedded text; `default.md` only
    // shows it.
    if file_name.eq_ignore_ascii_case(workspace::DEFAULT_PROMPT_FILE) {
        return Ok(crate::backend::DEFAULT_AGENT_PROMPT.to_string());
    }
    ensure_workspace(app, library_id)?;
    let content = with_documents(app, library_id, |documents| {
        documents.read(&format!("{}/{file_name}", workspace::PROMPTS_DIRECTORY))
    })?;
    let body = content.as_deref().map(workspace::document_body).unwrap_or("").trim();
    if body.chars().count() > MAX_PROMPT_CHARS {
        return Err(BackendError::invalid_input("El prompt supera el límite permitido."));
    }
    Ok(if body.is_empty() { crate::backend::DEFAULT_AGENT_PROMPT.to_string() } else { body.to_string() })
}

fn validate_items(items: &[String]) -> Result<(), BackendError> {
    if items.len() > 500 || items.iter().any(|item| item.chars().count() > workspace::MAX_RULE_CHARS) {
        return Err(BackendError::invalid_input("La lista del agente no es válida o supera el límite."));
    }
    Ok(())
}

fn with_workspace_lock<T>(app: &AppHandle, run: impl FnOnce() -> Result<T, BackendError>) -> Result<T, BackendError> {
    let state = app.state::<AgentWorkspaceState>();
    let _guard = state.lock.lock().map_err(|_| internal())?;
    run()
}

#[tauri::command]
pub(crate) async fn backend_agent_prompts(
    app: AppHandle,
    payload: AgentLibraryPayload,
) -> Result<AgentPromptList, BackendError> {
    blocking(move || list_prompts(&app, &payload.library_id)).await
}

#[tauri::command]
pub(crate) async fn backend_agent_prompt(app: AppHandle, payload: AgentPromptPayload) -> Result<String, BackendError> {
    blocking(move || load_prompt(&app, &payload.library_id, &payload.file_name)).await
}

#[tauri::command]
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

/// Persistent memories of the library.
pub(crate) fn memories(app: &AppHandle, library_id: &str) -> Result<Vec<String>, BackendError> {
    ensure_workspace(app, library_id)?;
    with_documents(app, library_id, |documents| {
        Ok(documents
            .read(workspace::MEMORY_PATH)?
            .map(|content| workspace::parse_memory_items(workspace::document_body(&content)))
            .unwrap_or_default())
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

/// Rules the agent added to the library.
pub(crate) fn rules(app: &AppHandle, library_id: &str) -> Result<Vec<String>, BackendError> {
    ensure_workspace(app, library_id)?;
    with_documents(app, library_id, |documents| {
        let current = documents.read(workspace::RULES_PATH)?;
        Ok(workspace::ia_rules(current.as_deref().map(workspace::document_body).unwrap_or("")))
    })
}

/// Replaces the rules the agent added; the managed defaults stay.
pub(crate) fn save_rules(app: &AppHandle, library_id: &str, items: Vec<String>) -> Result<Vec<String>, BackendError> {
    validate_items(&items)?;
    ensure_workspace(app, library_id)?;
    with_workspace_lock(app, || {
        with_documents(app, library_id, |documents| {
            let current = documents.read(workspace::RULES_PATH)?;
            let body = workspace::replace_ia_rules(current.as_deref().map(workspace::document_body).unwrap_or(""), &items);
            documents.write(workspace::RULES_PATH, current.as_deref(), &workspace::with_confidential_context(&body))?;
            Ok(workspace::ia_rules(&body))
        })
    })
}

#[tauri::command]
pub(crate) async fn backend_agent_memories(app: AppHandle, payload: AgentLibraryPayload) -> Result<Vec<String>, BackendError> {
    blocking(move || memories(&app, &payload.library_id)).await
}

#[tauri::command]
pub(crate) async fn backend_save_agent_memories(app: AppHandle, payload: AgentItemsPayload) -> Result<Vec<String>, BackendError> {
    blocking(move || save_memories(&app, &payload.library_id, payload.items)).await
}

#[tauri::command]
pub(crate) async fn backend_agent_rules(app: AppHandle, payload: AgentLibraryPayload) -> Result<Vec<String>, BackendError> {
    blocking(move || rules(&app, &payload.library_id)).await
}

#[tauri::command]
pub(crate) async fn backend_save_agent_rules(app: AppHandle, payload: AgentItemsPayload) -> Result<Vec<String>, BackendError> {
    blocking(move || save_rules(&app, &payload.library_id, payload.items)).await
}

/// Adds one rule to the library rules; used by the local interface.
#[tauri::command]
pub(crate) async fn backend_append_agent_rule(app: AppHandle, payload: AgentRulePayload) -> Result<bool, BackendError> {
    blocking(move || {
        if payload.rule.chars().count() > workspace::MAX_RULE_CHARS {
            return Err(BackendError::invalid_input("La regla supera el límite permitido."));
        }
        ensure_workspace(&app, &payload.library_id)?;
        with_workspace_lock(&app, || append_rule_locked(&app, &payload.library_id, &payload.rule))
    })
    .await
}

fn append_rule_locked(app: &AppHandle, library_id: &str, rule: &str) -> Result<bool, BackendError> {
    with_documents(app, library_id, |documents| {
        let current = documents.read(workspace::RULES_PATH)?;
        let Some(body) = workspace::append_rule(current.as_deref().map(workspace::document_body).unwrap_or(""), rule) else {
            return Ok(false);
        };
        documents.write(workspace::RULES_PATH, current.as_deref(), &workspace::with_confidential_context(&body))?;
        Ok(true)
    })
}

/// Persists a rule or memory requested by the agent tool, with the same
/// format the interface reads. Returns whether the file changed.
pub(crate) fn append_agent_item(app: &AppHandle, library_id: &str, kind: AgentItem, value: &str) -> Result<bool, BackendError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > workspace::MAX_RULE_CHARS {
        return Err(BackendError::invalid_input("El contenido de memoria no es válido o supera el límite."));
    }
    ensure_workspace(app, library_id)?;
    with_workspace_lock(app, || match kind {
        AgentItem::Rule => append_rule_locked(app, library_id, value),
        AgentItem::Memory => with_documents(app, library_id, |documents| {
            let current = documents.read(workspace::MEMORY_PATH)?;
            let mut memories = current
                .as_deref()
                .map(|content| workspace::parse_memory_items(workspace::document_body(content)))
                .unwrap_or_default();
            if memories.iter().any(|memory| memory.eq_ignore_ascii_case(value)) {
                return Ok(false);
            }
            if memories.len() >= workspace::MAX_MEMORIES {
                return Err(BackendError::invalid_input("La memoria del agente alcanzó el límite de elementos."));
            }
            memories.push(value.to_string());
            documents.write(
                workspace::MEMORY_PATH,
                current.as_deref(),
                &workspace::with_confidential_context(&workspace::render_memories(&memories)),
            )?;
            Ok(true)
        }),
    })
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum AgentItem {
    Rule,
    Memory,
}
