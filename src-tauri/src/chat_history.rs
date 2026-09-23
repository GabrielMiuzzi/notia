//! Chat history files of a library (`chat/chats/*.md`): folder structure,
//! creation, reads, full saves and appends of the last turn. The document
//! format lives in `backend_core::chat_history`.

use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::backend::chat_history::{
    self as history, ChatImagePreview, StoredChatDocument, CHAT_HISTORY_DIRECTORY, CHAT_ROOT_DIRECTORY,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::library_documents::{inventory_paths, with_documents};
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const MAX_NAME_ATTEMPTS: usize = 10_000;
const MAX_PREVIEW_SOURCE_BYTES: usize = 64 * 1024 * 1024;

/// Libraries whose chat folders were prepared in this session.
#[derive(Default)]
pub(crate) struct ChatHistoryState {
    prepared: Mutex<HashSet<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatLibraryPayload {
    library_id: String,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppendedChat {
    appended: bool,
}

fn internal() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación del chat.", true)
}

async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, BackendError> + Send + 'static,
) -> Result<T, BackendError> {
    tauri::async_runtime::spawn_blocking(run).await.map_err(|_| internal())?
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
fn ensure_structure(app: &AppHandle, library_id: &str) -> Result<(), BackendError> {
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

fn save(app: &AppHandle, library_id: &str, logical_path: &str, document: &StoredChatDocument) -> Result<(), BackendError> {
    document.validate()?;
    with_documents(app, library_id, |documents| {
        let current = documents.read(logical_path)?;
        documents.write(logical_path, current.as_deref(), &history::serialize_chat_document(document))
    })
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

#[tauri::command]
pub(crate) async fn backend_ensure_chat_structure(app: AppHandle, payload: ChatLibraryPayload) -> Result<(), BackendError> {
    blocking(move || ensure_structure(&app, &payload.library_id)).await
}

/// Creates an empty chat with a free name from the device's local time.
#[tauri::command]
pub(crate) async fn backend_create_chat(app: AppHandle, payload: CreateChatPayload) -> Result<CreatedChat, BackendError> {
    blocking(move || {
        ensure_structure(&app, &payload.library_id)?;
        with_documents(&app, &payload.library_id, |documents| {
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
                return Ok(CreatedChat { logical_path });
            }
            Err(BackendError::new(BackendErrorCode::Conflict, "No se pudo reservar un nombre para el chat.", true))
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn backend_load_chat(app: AppHandle, payload: LoadChatPayload) -> Result<StoredChatDocument, BackendError> {
    blocking(move || {
        let logical_path = validate_chat_path(&payload.logical_path)?;
        let source = with_documents(&app, &payload.library_id, |documents| documents.read(&logical_path))?
            .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "No se encontró el chat.", false))?;
        Ok(history::parse_chat_document(&source, &payload.fallback_title))
    })
    .await
}

#[tauri::command]
pub(crate) async fn backend_save_chat(app: AppHandle, payload: SaveChatPayload) -> Result<(), BackendError> {
    blocking(move || {
        let logical_path = validate_chat_path(&payload.logical_path)?;
        save(&app, &payload.library_id, &logical_path, &payload.document)
    })
    .await
}

/// Appends the last turn when the file still matches the chat; otherwise
/// (or when the file changed meanwhile) rewrites the whole document.
#[tauri::command]
pub(crate) async fn backend_append_chat(app: AppHandle, payload: SaveChatPayload) -> Result<AppendedChat, BackendError> {
    blocking(move || {
        let logical_path = validate_chat_path(&payload.logical_path)?;
        payload.document.validate()?;
        let appended = with_documents(&app, &payload.library_id, |documents| {
            let Some(source) = documents.read(&logical_path)? else {
                return Ok(false);
            };
            let Some(next) = history::append_chat_messages(&source, &payload.document) else {
                return Ok(false);
            };
            let revision = crate::backend::compute_document_revision(&source);
            Ok(documents
                .adapter
                .write_locator_at_revision(&documents.locator(&logical_path)?, &next, revision)
                .is_ok())
        })?;
        if !appended {
            save(&app, &payload.library_id, &logical_path, &payload.document)?;
        }
        Ok(AppendedChat { appended })
    })
    .await
}

/// Images attached to a chat document shown in the editor.
#[tauri::command]
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
#[tauri::command]
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
