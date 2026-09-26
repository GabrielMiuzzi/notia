//! Page mode of a note. It is a property of the note (`pageMode: true`), so
//! each note opens as it was left; the editor sends the note it shows and
//! gets it back with the property written or removed.

use serde::{Deserialize, Serialize};

use crate::backend::{set_note_page_mode, BackendError, MAX_DOCUMENT_CHARS};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotePageModePayload {
    /// The note as the editor has it, frontmatter included.
    source: String,
    enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotePageModeResult {
    source: String,
    page_mode: bool,
}

pub(crate) fn markdown_set_page_mode(payload: NotePageModePayload) -> Result<NotePageModeResult, BackendError> {
    if payload.source.chars().count() > MAX_DOCUMENT_CHARS {
        return Err(BackendError::invalid_input("El documento Markdown supera el límite de tamaño."));
    }
    let source = set_note_page_mode(&payload.source, payload.enabled)?;
    Ok(NotePageModeResult { source, page_mode: payload.enabled })
}
