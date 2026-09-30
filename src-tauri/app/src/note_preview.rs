//! The card a link between notes shows on hover (`backend::note_preview`):
//! reads the linked note and when the library index saw it change.

use serde::Deserialize;

use crate::backend::note_preview::{note_link_preview, NoteLinkPreview};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::AppHandle;
use crate::library_documents::with_documents;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotePreviewPayload {
    library_id: String,
    /// The linked note, as the explorer shows it.
    path: String,
}

fn preview(app: &AppHandle, payload: NotePreviewPayload) -> Result<NoteLinkPreview, BackendError> {
    let logical_path = crate::library_session::resolve_logical_path(app, &payload.library_id, &payload.path)?;
    if !logical_path.to_ascii_lowercase().ends_with(".md") {
        return Err(BackendError::invalid_input("Solo las notas Markdown tienen vista previa."));
    }
    let source = with_documents(app, &payload.library_id, |documents| documents.read(&logical_path))?
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La nota ya no existe.", false))?;
    let modified = crate::library_inventory::file_modified_at(app, &payload.library_id, &logical_path);
    Ok(note_link_preview(&logical_path, &source, modified, now_ms()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis().min(i64::MAX as u128) as i64)
}

pub(crate) async fn markdown_note_preview(app: AppHandle, payload: NotePreviewPayload) -> Result<NoteLinkPreview, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || preview(&app, payload))
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo leer la nota.", true))?
}
