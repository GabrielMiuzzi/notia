//! Chat history files of a library (`chat/chats/*.md`): folder structure,
//! creation, reads, full saves and appends of the last turn. The document
//! format lives in `backend_core::chat_history`.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager};

use crate::backend::chat_history::{
    self as history, ChatImagePreview, StoredChatDocument, CHAT_HISTORY_DIRECTORY, CHAT_ROOT_DIRECTORY,
};
use crate::backend::chat_turn::{self, ContextSelection, ViewContext};
use crate::backend::{BackendError, BackendErrorCode};
use crate::library_documents::{inventory_paths, with_documents};
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const MAX_NAME_ATTEMPTS: usize = 10_000;
const MAX_PREVIEW_SOURCE_BYTES: usize = 64 * 1024 * 1024;
/// Chats whose documents are read to show their titles or to match a view.
/// Android reads each file through SAF, so it only reads the most recent.
#[cfg(target_os = "android")]
const READ_CHATS_LIMIT: usize = 8;
#[cfg(not(target_os = "android"))]
const READ_CHATS_LIMIT: usize = usize::MAX;

/// Libraries whose chat folders were prepared in this session.
#[derive(Default)]
pub(crate) struct ChatHistoryState {
    prepared: Mutex<HashSet<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateChatPayload {
    library_id: String,
    /// Local time of the device, `YYYY-MM-DD-HH-MM-SS`.
    local_stamp: String,
    long_term_memory_enabled: bool,
    context_memory_enabled: bool,
    context_memory_message_count: u32,
    /// Context files of the composer when the chat starts with a message.
    #[serde(default)]
    context: Option<ContextSelection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadChatPayload {
    library_id: String,
    logical_path: String,
    fallback_title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveChatPayload {
    library_id: String,
    logical_path: String,
    document: StoredChatDocument,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatPreviewPayload {
    source: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatedChat {
    logical_path: String,
    /// Path of the chat as the explorer shows it.
    path: String,
    /// The new chat, with context files as the explorer shows them.
    document: StoredChatDocument,
}

fn internal() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación del chat.", true)
}

async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, BackendError> + Send + 'static,
) -> Result<T, BackendError> {
    crate::host::async_runtime::spawn_blocking(run).await.map_err(|_| internal())?
}

/// Chat files live directly in `chat/chats` and are Markdown.
fn validate_chat_path(logical_path: &str) -> Result<String, BackendError> {
    let path = crate::backend::LogicalPathDto::new(logical_path)?.as_str().to_string();
    let name = path
        .strip_prefix(CHAT_HISTORY_DIRECTORY)
        .and_then(|rest| rest.strip_prefix('/'))
        .filter(|name| !name.contains('/') && name.to_ascii_lowercase().ends_with(".md"));
    match name {
        Some(_) => Ok(path),
        None => Err(BackendError::invalid_input("La ruta del chat no es válida.")),
    }
}

/// Creates `chat/` and `chat/chats/` and marks every chat file as
/// confidential, once per library and session.
pub(crate) fn ensure_structure(app: &AppHandle, library_id: &str) -> Result<(), BackendError> {
    let state = app.state::<ChatHistoryState>();
    if state.prepared.lock().map_err(|_| internal())?.contains(library_id) {
        return Ok(());
    }
    {
        let registry = app.state::<LibraryBindingRegistry>();
        let picker = app.state::<AndroidDirectoryPickerState>();
        for (parent, name) in [("", CHAT_ROOT_DIRECTORY), (CHAT_ROOT_DIRECTORY, "chats")] {
            crate::filesystem::commands::ensure_library_folder(registry.inner(), picker.inner(), library_id, parent, name)?;
        }
    }
    let files = inventory_paths(app, library_id, CHAT_ROOT_DIRECTORY)?;
    with_documents(app, library_id, |documents| {
        for path in files.iter().filter(|path| {
            let lowered = path.to_ascii_lowercase();
            [".md", ".markdown", ".txt"].iter().any(|extension| lowered.ends_with(extension))
        }) {
            if let Some(current) = documents.read(path)? {
                let next = crate::backend::agent_workspace::with_confidential_context(&current);
                documents.write(path, Some(&current), &next)?;
            }
        }
        Ok(())
    })?;
    state.prepared.lock().map_err(|_| internal())?.insert(library_id.to_string());
    Ok(())
}

/// Context files are stored relative to the library; files outside it keep
/// the path the interface gave.
fn stored_document(app: &AppHandle, library_id: &str, document: &StoredChatDocument) -> StoredChatDocument {
    let mut stored = document.clone();
    stored.selected_context_files = document
        .selected_context_files
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(|path| crate::library_session::resolve_logical_path(app, library_id, path).unwrap_or_else(|_| path.to_string()))
        .collect();
    stored
}

fn is_library_relative(path: &str) -> bool {
    !(path.starts_with(['/', '\\']) ||path.contains("://") || path.as_bytes().get(1) == Some(&b':'))
}

/// The chat as the interface shows it: context files as explorer paths.
pub(crate) fn visible_document(app: &AppHandle, library_id: &str, mut document: StoredChatDocument) -> StoredChatDocument {
    document.selected_context_files = document
        .selected_context_files
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(|path| {
            if is_library_relative(path) {
                crate::library_session::visible_path(app, library_id, path)
            } else {
                path.to_string()
            }
        })
        .collect();
    document
}

fn save(app: &AppHandle, library_id: &str, logical_path: &str, document: &StoredChatDocument) -> Result<(), BackendError> {
    let document = stored_document(app, library_id, document);
    document.validate()?;
    with_documents(app, library_id, |documents| {
        let current = documents.read(logical_path)?;
        documents.write(logical_path, current.as_deref(), &history::serialize_chat_document(&document))
    })
}

/// Logical path of a chat from the path the interface holds.
pub(crate) fn chat_logical_path(app: &AppHandle, library_id: &str, identity: &str) -> Result<String, BackendError> {
    validate_chat_path(&crate::library_session::resolve_logical_path(app, library_id, identity)?)
}

/// Reads a chat, with context files as explorer paths.
pub(crate) fn load(app: &AppHandle, library_id: &str, logical_path: &str, fallback_title: &str) -> Result<StoredChatDocument, BackendError> {
    let source = with_documents(app, library_id, |documents| documents.read(logical_path))?
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "No se encontró el chat.", false))?;
    Ok(visible_document(app, library_id, history::parse_chat_document(&source, fallback_title)))
}

/// Appends the last turn when the file still matches the chat; otherwise
/// (or when the file changed meanwhile) rewrites the whole document.
pub(crate) fn append_turn(app: &AppHandle, library_id: &str, logical_path: &str, document: &StoredChatDocument) -> Result<bool, BackendError> {
    let document = stored_document(app, library_id, document);
    document.validate()?;
    let appended = with_documents(app, library_id, |documents| {
        let Some(source) = documents.read(logical_path)? else {
            return Ok(false);
        };
        let Some(next) = history::append_chat_messages(&source, &document) else {
            return Ok(false);
        };
        let revision = crate::backend::compute_document_revision(&source);
        Ok(documents
            .adapter
            .write_locator_at_revision(&documents.locator(logical_path)?, &next, revision)
            .is_ok())
    })?;
    if !appended {
        save(app, library_id, logical_path, &document)?;
    }
    Ok(appended)
}

/// Saves a whole chat.
pub(crate) fn save_chat(app: &AppHandle, library_id: &str, logical_path: &str, document: &StoredChatDocument) -> Result<(), BackendError> {
    save(app, library_id, logical_path, document)
}

/// Renames a chat (the title shown in the list), keeping its messages.
pub(crate) fn set_title(app: &AppHandle, library_id: &str, logical_path: &str, title: &str) -> Result<(), BackendError> {
    let logical_path = validate_chat_path(logical_path)?;
    let source = with_documents(app, library_id, |documents| documents.read(&logical_path))?
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "No se encontró el chat.", false))?;
    let mut document = history::parse_chat_document(&source, title);
    if document.title == title {
        return Ok(());
    }
    document.title = title.to_string();
    save(app, library_id, &logical_path, &document)
}

/// Creates a chat with a free name from the device's local time. A chat
/// created to send a message takes the composer's context settings.
pub(crate) fn create(app: &AppHandle, payload: &CreateChatPayload) -> Result<CreatedChat, BackendError> {
    ensure_structure(app, &payload.library_id)?;
    let (logical_path, document) = with_documents(app, &payload.library_id, |documents| {
        for suffix in 1..MAX_NAME_ATTEMPTS {
            let (file_name, title) = history::new_chat_names(&payload.local_stamp, suffix)?;
            let logical_path = format!("{CHAT_HISTORY_DIRECTORY}/{file_name}");
            let locator = documents.locator(&logical_path)?;
            if documents.adapter.exists_locator(&locator)? {
                continue;
            }
            let document = StoredChatDocument::new(
                title,
                payload.long_term_memory_enabled,
                payload.context_memory_enabled,
                payload.context_memory_message_count,
            );
            documents.adapter.create_text_locator(&locator, &history::serialize_chat_document(&document))?;
            return Ok((logical_path, document));
        }
        Err(BackendError::new(BackendErrorCode::Conflict, "No se pudo reservar un nombre para el chat.", true))
    })?;
    let mut document = document;
    if let Some(context) = &payload.context {
        let before = document.clone();
        chat_turn::prepare_new_chat(&mut document, context);
        if document != before {
            save(app, &payload.library_id, &logical_path, &document)?;
        }
    }
    Ok(CreatedChat {
        path: crate::library_session::visible_path(app, &payload.library_id, &logical_path),
        logical_path,
        document,
    })
}

pub(crate) async fn backend_create_chat(app: AppHandle, payload: CreateChatPayload) -> Result<CreatedChat, BackendError> {
    blocking(move || create(&app, &payload)).await
}

pub(crate) async fn backend_load_chat(app: AppHandle, payload: LoadChatPayload) -> Result<StoredChatDocument, BackendError> {
    blocking(move || {
        let logical_path = chat_logical_path(&app, &payload.library_id, &payload.logical_path)?;
        load(&app, &payload.library_id, &logical_path, &payload.fallback_title)
    })
    .await
}

pub(crate) async fn backend_save_chat(app: AppHandle, payload: SaveChatPayload) -> Result<(), BackendError> {
    blocking(move || {
        let logical_path = chat_logical_path(&app, &payload.library_id, &payload.logical_path)?;
        save(&app, &payload.library_id, &logical_path, &payload.document)
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListChatsPayload {
    library_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatListItem {
    /// Logical path, stable across platforms.
    id: String,
    /// Path of the chat as the explorer shows it.
    file_path: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MatchChatPayload {
    library_id: String,
    #[serde(flatten)]
    context: ViewContext,
    /// Chat open now; it wins a tie.
    #[serde(default)]
    selected: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewContextPayload {
    library_id: String,
    logical_path: String,
    #[serde(flatten)]
    context: ViewContext,
}

/// Chats of the library, newest first: logical and explorer paths.
async fn chat_files(app: &AppHandle, library_id: &str) -> Result<Vec<(String, String)>, BackendError> {
    let nodes = match crate::library_session::read_directory(app, library_id, CHAT_HISTORY_DIRECTORY).await {
        Ok(nodes) => nodes,
        Err(error) if error.code == BackendErrorCode::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut files = nodes
        .into_iter()
        .filter(|node| node.node_type == crate::backend::library_tree::LibraryNodeKind::File)
        .filter(|node| node.name.to_ascii_lowercase().ends_with(".md"))
        .map(|node| (format!("{CHAT_HISTORY_DIRECTORY}/{}", node.name), node.id))
        .collect::<Vec<_>>();
    files.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(files)
}

/// The stored chat, with its context files as stored (library-relative).
fn stored_chat(app: &AppHandle, library_id: &str, logical_path: &str) -> Option<StoredChatDocument> {
    let source = with_documents(app, library_id, |documents| documents.read(logical_path)).ok()??;
    Some(history::parse_chat_document(&source, chat_turn::DEFAULT_CHAT_TITLE))
}

fn file_stem(logical_path: &str) -> String {
    let name = logical_path.rsplit('/').next().unwrap_or(logical_path);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem).to_string()
}

/// Chats of the library with their titles, newest first.
pub(crate) async fn backend_list_chats(app: AppHandle, payload: ListChatsPayload) -> Result<Vec<ChatListItem>, BackendError> {
    let files = chat_files(&app, &payload.library_id).await?;
    blocking(move || {
        Ok(files
            .into_iter()
            .enumerate()
            .map(|(index, (logical_path, file_path))| {
                let title = (index < READ_CHATS_LIMIT)
                    .then(|| stored_chat(&app, &payload.library_id, &logical_path))
                    .flatten()
                    .map(|document| document.title)
                    .unwrap_or_else(|| file_stem(&logical_path));
                ChatListItem { id: logical_path, file_path, title }
            })
            .collect())
    })
    .await
}

/// The chat that best fits the context of a view, as the explorer shows it.
pub(crate) async fn backend_match_chat(app: AppHandle, payload: MatchChatPayload) -> Result<Option<String>, BackendError> {
    if payload.context.scope_key.is_none() && payload.context.files.is_empty() {
        return Ok(None);
    }
    let files = chat_files(&app, &payload.library_id).await?;
    blocking(move || {
        let library_id = payload.library_id.as_str();
        let mut context = payload.context.clone();
        context.files = context
            .files
            .iter()
            .map(|path| crate::library_session::resolve_logical_path(&app, library_id, path).unwrap_or_else(|_| path.clone()))
            .collect();
        let prefix = chat_turn::board_prefix(&context);
        let scores = files
            .iter()
            .take(READ_CHATS_LIMIT)
            .filter_map(|(logical_path, file_path)| {
                let document = stored_chat(&app, library_id, logical_path)?;
                Some((file_path.clone(), chat_turn::context_match_score(&document, &context, prefix.as_deref())))
            })
            .collect::<Vec<_>>();
        Ok(chat_turn::best_match(&scores, payload.selected.as_deref()))
    })
    .await
}

/// A chat opened from a view takes that view's context; returns the chat.
pub(crate) async fn backend_set_chat_context(app: AppHandle, payload: ViewContextPayload) -> Result<StoredChatDocument, BackendError> {
    blocking(move || {
        let logical_path = chat_logical_path(&app, &payload.library_id, &payload.logical_path)?;
        let mut document = load(&app, &payload.library_id, &logical_path, chat_turn::DEFAULT_CHAT_TITLE)?;
        if chat_turn::apply_view_context(&mut document, &payload.context) {
            save(&app, &payload.library_id, &logical_path, &document)?;
        }
        Ok(document)
    })
    .await
}

/// Images attached to a chat document shown in the editor.
pub(crate) async fn backend_chat_image_previews(payload: ChatPreviewPayload) -> Result<Vec<ChatImagePreview>, BackendError> {
    if payload.source.len() > MAX_PREVIEW_SOURCE_BYTES {
        return Err(BackendError::invalid_input("El chat supera el límite permitido."));
    }
    blocking(move || {
        Ok(history::chat_image_previews(
            &payload.source,
            payload.limit.unwrap_or(history::DEFAULT_IMAGE_PREVIEW_LIMIT),
        ))
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClassifyFilePayload {
    name: String,
    #[serde(default)]
    media_type: String,
    byte_length: u64,
}

/// Whether a picked file can be attached, and how the interface must read
/// it (image, PDF pages or text).
pub(crate) fn backend_classify_chat_file(
    payload: ClassifyFilePayload,
) -> Result<crate::backend::chat_attachments::MessageAttachmentKind, BackendError> {
    crate::backend::chat_attachments::classify_file(&payload.name, &payload.media_type, payload.byte_length)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_paths_stay_in_the_history_folder() {
        assert!(validate_chat_path("chat/chats/Chat-1.md").is_ok());
        for path in ["chat/chats/sub/Chat.md", "chat/Chat.md", "chat/chats/Chat.txt", "chat/chats/../x.md"] {
            assert!(validate_chat_path(path).is_err(), "{path}");
        }
    }
}
