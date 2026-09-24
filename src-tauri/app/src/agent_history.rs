//! History of the document changes the agent applied in each library, kept
//! by the backend so the interface can list them, show their diff and know
//! which were undone after a restart. Undo itself uses the request journal.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager};

use crate::backend::{BackendError, BackendErrorCode, BackendRequestContext};

const MAX_ENTRIES: usize = 100;
/// Larger documents keep their history entry without the diff sources.
const MAX_SOURCE_BYTES: usize = 128 * 1024;

#[derive(Default)]
pub(crate) struct AgentHistoryState {
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEntry {
    operation_id: String,
    library_user_id: String,
    logical_path: String,
    summary: String,
    status: String,
    applied_at: u64,
    #[serde(default)]
    undone_at: Option<u64>,
    #[serde(default)]
    previous_source: Option<String>,
    #[serde(default)]
    next_source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryEntry {
    operation_id: String,
    logical_path: String,
    /// Path of the document as the explorer shows it.
    path: String,
    summary: String,
    status: String,
    applied_at: u64,
    undone_at: Option<u64>,
    has_diff: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryDiff {
    operation_id: String,
    summary: String,
    logical_path: String,
    path: String,
    previous_source: String,
    next_source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryPayload {
    library_id: String,
    #[serde(default)]
    operation_id: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn history_file(app: &AppHandle, library_id: &str) -> Result<PathBuf, BackendError> {
    let key = library_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(96)
        .collect::<String>();
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("agent-history").join(format!("{key}.json")))
        .map_err(|_| storage())
}

fn storage() -> BackendError {
    BackendError::new(BackendErrorCode::Storage, "No se pudo acceder al historial del agente.", true)
}

fn read_entries(app: &AppHandle, library_id: &str) -> Vec<StoredEntry> {
    history_file(app, library_id)
        .ok()
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_entries(app: &AppHandle, library_id: &str, entries: &[StoredEntry]) -> Result<(), BackendError> {
    let file = history_file(app, library_id)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|_| storage())?;
    }
    let text = serde_json::to_string(entries).map_err(|_| storage())?;
    let temporary = file.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(|_| storage())?;
    std::fs::rename(&temporary, &file).map_err(|_| storage())
}

fn bounded(source: Option<String>) -> Option<String> {
    source.filter(|text| text.len() <= MAX_SOURCE_BYTES)
}

/// Records an applied change; the newest entries are kept.
pub(crate) fn record(
    app: &AppHandle,
    context: &BackendRequestContext,
    operation_id: &str,
    logical_path: &str,
    summary: String,
    previous_source: Option<String>,
    next_source: Option<String>,
) -> Result<(), BackendError> {
    let state = app.state::<AgentHistoryState>();
    let _guard = state.lock.lock().map_err(|_| storage())?;
    let mut entries = read_entries(app, &context.library_id);
    entries.retain(|entry| entry.operation_id != operation_id);
    entries.insert(
        0,
        StoredEntry {
            operation_id: operation_id.to_string(),
            library_user_id: context.actor.library_user_id.clone(),
            logical_path: logical_path.to_string(),
            summary,
            status: "applied".to_string(),
            applied_at: now_ms(),
            undone_at: None,
            previous_source: bounded(previous_source),
            next_source: bounded(next_source),
        },
    );
    entries.truncate(MAX_ENTRIES);
    write_entries(app, &context.library_id, &entries)
}

/// Marks an entry as undone after the journal restored the document.
pub(crate) fn mark_undone(app: &AppHandle, library_id: &str, operation_id: &str) -> Result<(), BackendError> {
    let state = app.state::<AgentHistoryState>();
    let _guard = state.lock.lock().map_err(|_| storage())?;
    let mut entries = read_entries(app, library_id);
    let Some(entry) = entries.iter_mut().find(|entry| entry.operation_id == operation_id) else {
        return Ok(());
    };
    entry.status = "undone".to_string();
    entry.undone_at = Some(now_ms());
    write_entries(app, library_id, &entries)
}

pub(crate) fn backend_agent_history(app: AppHandle, payload: HistoryPayload) -> Result<Vec<HistoryEntry>, BackendError> {
    app.state::<crate::library_registry::LibraryBindingRegistry>().lookup(&payload.library_id)?;
    Ok(read_entries(&app, &payload.library_id)
        .into_iter()
        .map(|entry| HistoryEntry {
            has_diff: entry.next_source.is_some() || entry.previous_source.is_some(),
            operation_id: entry.operation_id,
            path: crate::library_session::visible_path(&app, &payload.library_id, &entry.logical_path),
            logical_path: entry.logical_path,
            summary: entry.summary,
            status: entry.status,
            applied_at: entry.applied_at,
            undone_at: entry.undone_at,
        })
        .collect())
}

pub(crate) fn backend_agent_history_diff(app: AppHandle, payload: HistoryPayload) -> Result<Option<HistoryDiff>, BackendError> {
    app.state::<crate::library_registry::LibraryBindingRegistry>().lookup(&payload.library_id)?;
    let operation_id = payload.operation_id.unwrap_or_default();
    Ok(read_entries(&app, &payload.library_id)
        .into_iter()
        .find(|entry| entry.operation_id == operation_id)
        .filter(|entry| entry.previous_source.is_some() || entry.next_source.is_some())
        .map(|entry| HistoryDiff {
            operation_id: entry.operation_id,
            summary: entry.summary,
            path: crate::library_session::visible_path(&app, &payload.library_id, &entry.logical_path),
            logical_path: entry.logical_path,
            previous_source: entry.previous_source.unwrap_or_default(),
            next_source: entry.next_source.unwrap_or_default(),
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_sources_are_not_kept_for_the_diff() {
        assert_eq!(bounded(Some("a".into())).as_deref(), Some("a"));
        assert_eq!(bounded(Some("a".repeat(MAX_SOURCE_BYTES + 1))), None);
    }
}
