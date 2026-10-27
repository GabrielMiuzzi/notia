//! Folder contexts of a library (`.notia/folderContexts.json`): reading and
//! saving the assignments, and what a note's folder forces on it whenever
//! it is written, created, moved or opened: the folder's `contexto`, and
//! `publicado` in a folder a public space publishes. The rules are in
//! `backend-core::folder_contexts` and `backend-core::public_spaces`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::backend::folder_contexts::{self as rules, FolderContexts, FOLDER_CONTEXTS_PATH};
use crate::backend::note_ink::EntryChange;
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::AppHandle;
use crate::library_documents::with_documents;

/// The file changes only here; the short life covers a copy synced from
/// the host or edited by hand.
const CACHE_LIFETIME: Duration = Duration::from_secs(30);

struct Cached {
    contexts: FolderContexts,
    read_at: Instant,
}

static CACHE: Mutex<Option<HashMap<String, Cached>>> = Mutex::new(None);
/// Serializes the changes of the assignments.
static CHANGES: Mutex<()> = Mutex::new(());

fn read_stored(app: &AppHandle, library_id: &str) -> Result<FolderContexts, BackendError> {
    with_documents(app, library_id, |documents| documents.read(FOLDER_CONTEXTS_PATH))
        .map(|text| text.map(|text| FolderContexts::parse(&text)).unwrap_or_default())
}

/// The assignments of the library. An unreadable file leaves the notes free.
pub(crate) fn load(app: &AppHandle, library_id: &str) -> FolderContexts {
    let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let entries = cache.get_or_insert_with(HashMap::new);
    if let Some(cached) = entries.get(library_id).filter(|cached| cached.read_at.elapsed() < CACHE_LIFETIME) {
        return cached.contexts.clone();
    }
    let contexts = read_stored(app, library_id).unwrap_or_else(|error| {
        log::warn!("[notia:folder-contexts] no se pudieron leer los contextos de carpeta code={:?}", error.code);
        FolderContexts::default()
    });
    entries.insert(library_id.to_string(), Cached { contexts: contexts.clone(), read_at: Instant::now() });
    contexts
}

fn save(app: &AppHandle, library_id: &str, contexts: &FolderContexts) -> Result<(), BackendError> {
    with_documents(app, library_id, |documents| {
        let current = documents.read(FOLDER_CONTEXTS_PATH)?;
        documents.write(FOLDER_CONTEXTS_PATH, current.as_deref(), &contexts.to_json())
    })?;
    let mut cache = CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    cache
        .get_or_insert_with(HashMap::new)
        .insert(library_id.to_string(), Cached { contexts: contexts.clone(), read_at: Instant::now() });
    Ok(())
}

/// The context the note at `logical_path` must have, if its folder has one.
pub(crate) fn effective(app: &AppHandle, library_id: &str, logical_path: &str) -> Option<String> {
    if !rules::is_library_note(logical_path) {
        return None;
    }
    load(app, library_id).effective(logical_path).map(str::to_string)
}

/// `content` as its folder wants it: with the folder's context, and with
/// `publicado` when a public space publishes the folder (an existing
/// `publicado: false` stays). `None` when nothing changes.
pub(crate) fn enforced(app: &AppHandle, library_id: &str, logical_path: &str, content: &str) -> Option<String> {
    let with_context = effective(app, library_id, logical_path)
        .and_then(|tag| crate::backend::markdown_editing::with_context(content, &tag));
    let current = with_context.as_deref().unwrap_or(content);
    let with_published = crate::public_spaces::in_published_folder(app, library_id, logical_path)
        .then(|| crate::backend::public_spaces::with_published_property(current))
        .flatten();
    with_published.or(with_context)
}

/// `content` as it must be written at `logical_path`.
pub(crate) fn enforce(app: &AppHandle, library_id: &str, logical_path: &str, content: String) -> String {
    enforced(app, library_id, logical_path, &content).unwrap_or(content)
}

/// Rewrites each note of `paths` as its folder wants it ([`enforced`]),
/// only over the content just read. Returns how many changed; a note that
/// fails is logged and skipped.
pub(crate) fn stamp(app: &AppHandle, library_id: &str, paths: &[String]) -> usize {
    let mut changed = 0;
    for path in paths.iter().filter(|path| path.to_lowercase().ends_with(".md")) {
        let result = with_documents(app, library_id, |documents| {
            let Some(current) = documents.read(path)? else { return Ok(false) };
            let Some(updated) = enforced(app, library_id, path, &current) else {
                return Ok(false);
            };
            let revision = crate::filesystem::types::content_revision(&current);
            documents.adapter.write_locator(&documents.locator(path)?, &updated, Some(&revision))?;
            Ok(true)
        });
        match result {
            Ok(true) => changed += 1,
            Ok(false) => {}
            Err(error) => log::warn!("[notia:folder-contexts] una nota no tomó las propiedades de su carpeta code={:?}", error.code),
        }
    }
    changed
}

/// Files of the library index inside `entry` (the entry itself for a file).
pub(crate) fn indexed_inside(app: &AppHandle, library_id: &str, entry: &str) -> Vec<String> {
    match crate::library_inventory::inventory_files(app, library_id) {
        Ok((files, _)) => files.into_iter().filter(|path| rules::relocated(path, entry, entry).is_some()).collect(),
        Err(error) => {
            log::warn!("[notia:folder-contexts] no se pudo leer el índice code={:?}", error.code);
            Vec::new()
        }
    }
}

/// Files of `change`'s source before an explorer operation runs: the index
/// is rebuilt after it, so the paths are read while they are still there.
pub(crate) fn files_before(app: &AppHandle, library_id: &str, change: &EntryChange) -> Vec<String> {
    match change {
        EntryChange::Delete { .. } => Vec::new(),
        EntryChange::Move { from, .. } | EntryChange::Copy { from, .. } => indexed_inside(app, library_id, from),
    }
}

/// After an explorer operation: the assignments follow the folders and the
/// notes that arrived in a folder take what it forces.
pub(crate) fn apply_entry_change(app: &AppHandle, library_id: &str, change: &EntryChange, files_before: &[String]) {
    {
        let _guard = CHANGES.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut contexts = match read_stored(app, library_id) {
            Ok(contexts) => contexts,
            Err(error) => {
                log::warn!("[notia:folder-contexts] los contextos de carpeta no siguieron a la carpeta code={:?}", error.code);
                return;
            }
        };
        if contexts.follow(change) {
            if let Err(error) = save(app, library_id, &contexts) {
                log::warn!("[notia:folder-contexts] los contextos de carpeta no siguieron a la carpeta code={:?}", error.code);
            }
        }
    }
    let (EntryChange::Move { from, to } | EntryChange::Copy { from, to }) = change else { return };
    let targets: Vec<String> = files_before.iter().filter_map(|path| rules::relocated(path, from, to)).collect();
    stamp(app, library_id, &targets);
}

/// After the explorer created the note `logical_path`.
pub(crate) fn apply_to_new_note(app: &AppHandle, library_id: &str, logical_path: &str) {
    stamp(app, library_id, &[logical_path.to_string()]);
}

/// The tag of the library's catalog that matches `tag`, as the catalog
/// writes it.
fn catalog_tag(app: &AppHandle, library_id: &str, tag: &str) -> Option<String> {
    let tag = crate::backend::library_config::normalize_context_tag(tag)?;
    let config = crate::library_config::read_library_config(app, library_id)
        .ok()
        .flatten()
        .unwrap_or_else(crate::backend::library_config::default_library_config);
    config
        .get("contexts")
        .and_then(serde_json::Value::as_array)?
        .iter()
        .filter_map(|context| context.get("tag")?.as_str())
        .find(|candidate| candidate.eq_ignore_ascii_case(&tag))
        .map(str::to_string)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderContextPayload {
    library_id: String,
    /// The folder as the explorer shows it.
    path: String,
    /// `None` removes the folder's context.
    #[serde(default)]
    context: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderContextResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Notes inside that changed their context.
    rewritten: usize,
}

fn set_folder_context(app: &AppHandle, payload: FolderContextPayload) -> Result<usize, BackendError> {
    let folder = crate::library_session::resolve_logical_path(app, &payload.library_id, &payload.path)?;
    let tag = match payload.context.as_deref().map(str::trim).filter(|tag| !tag.is_empty()) {
        Some(tag) => Some(
            catalog_tag(app, &payload.library_id, tag)
                .ok_or_else(|| BackendError::invalid_input("Ese contexto no está en la biblioteca."))?,
        ),
        None => None,
    };
    {
        let _guard = CHANGES.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut contexts = read_stored(app, &payload.library_id)?;
        let changed = contexts
            .set(&folder, tag.as_deref())
            .map_err(|message| BackendError::new(BackendErrorCode::InvalidInput, message, false))?;
        if !changed {
            return Ok(0);
        }
        save(app, &payload.library_id, &contexts)?;
    }
    let files = indexed_inside(app, &payload.library_id, &folder);
    let rewritten = stamp(app, &payload.library_id, &files);
    if rewritten > 0 {
        crate::library_session::reindex_in_background(app, &payload.library_id);
    }
    Ok(rewritten)
}

/// Assigns a context to a folder of the explorer, or removes it, and
/// rewrites the notes inside that must take it.
pub(crate) fn library_set_folder_context(app: AppHandle, payload: FolderContextPayload) -> FolderContextResult {
    match set_folder_context(&app, payload) {
        Ok(rewritten) => FolderContextResult { ok: true, error: None, rewritten },
        Err(error) => FolderContextResult { ok: false, error: Some(error.message), rewritten: 0 },
    }
}
