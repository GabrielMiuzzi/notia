//! Commands of the Mermaid diagram editor. The rules live in
//! `backend_core::mermaid`; nothing is read or written here: the editor's
//! tab saves the source like any other text document.

use serde::Deserialize;

use crate::backend::mermaid::{self, MermaidEdit, MermaidEditResult, MermaidModel};
use crate::backend::BackendError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MermaidDocumentPayload {
    source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MermaidEditPayload {
    source: String,
    edit: MermaidEdit,
}

/// What a diagram source holds, as the editor shows it.
pub(crate) fn mermaid_document(payload: MermaidDocumentPayload) -> Result<MermaidModel, BackendError> {
    mermaid::read_model(&payload.source)
}

/// The source with the person's edit, its model and what to select.
pub(crate) fn mermaid_edit(payload: MermaidEditPayload) -> Result<MermaidEditResult, BackendError> {
    mermaid::apply_edit(&payload.source, payload.edit)
}
