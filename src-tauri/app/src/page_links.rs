//! Bidirectional `nextPage` / `previousPage` links. The editor updates the
//! note it shows; the backend checks cycles and rewrites the opposite link of
//! the previous and new targets with revision checks.

use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager};

use crate::backend::page_links::{extract_link_path, frontmatter_value, resolve_link_path, same_path};
use crate::backend::{
    materialize_markdown_preview, preview_markdown_edit, BackendError, BackendErrorCode, DocumentLocatorDto,
    MarkdownEditRequest, MarkdownOperation,
};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const MAX_CHAIN_DEPTH: usize = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageLinkPayload {
    library_id: String,
    logical_path: String,
    /// `nextPage` or `previousPage`.
    key: String,
    #[serde(default)]
    old_value: String,
    #[serde(default)]
    new_value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageLinkResult {
    /// Value the current note must keep (`N/A` when it is not a link).
    current_value: String,
    changed: bool,
    error: Option<String>,
}

struct Documents<'a> {
    library_id: String,
    adapter: TauriFilesystemDocumentAdapter<'a>,
}

impl Documents<'_> {
    fn read(&self, path: &str) -> Option<String> {
        let locator = DocumentLocatorDto::new(&self.library_id, path, None, None).ok()?;
        self.adapter.read_locator(&locator).ok()
    }

    /// Sets `key` in the note at `path` if it still has the content read.
    fn set(&self, path: &str, source: &str, key: &str, value: &str) -> Result<(), BackendError> {
        let locator = DocumentLocatorDto::new(&self.library_id, path, None, None)?;
        let preview = preview_markdown_edit(
            source,
            &MarkdownEditRequest {
                operation_id: format!("page-link-{}", uuid::Uuid::new_v4()),
                locator: locator.clone(),
                expected_revision: None,
                operation: MarkdownOperation::SetFrontmatter { key: key.to_string(), value: value.to_string() },
            },
        )?;
        let Some(next) = materialize_markdown_preview(&preview, &[])? else {
            return Ok(());
        };
        self.adapter
            .write_locator_at_revision(&locator, &next, crate::backend::compute_document_revision(source))
    }
}

/// Whether linking `current` to `target` closes a loop of pages.
fn creates_cycle(documents: &Documents<'_>, current: &str, target: &str) -> bool {
    let mut pending = vec![target.to_string()];
    let mut visited = std::collections::HashSet::new();
    while let Some(path) = pending.pop() {
        if same_path(&path, current) {
            return true;
        }
        if !visited.insert(path.to_lowercase()) || visited.len() > MAX_CHAIN_DEPTH {
            continue;
        }
        let Some(source) = documents.read(&path) else {
            continue;
        };
        for key in ["nextPage", "previousPage"] {
            if let Some(next) = frontmatter_value(&source, key)
                .and_then(|value| extract_link_path(&value))
                .and_then(|reference| resolve_link_path(&reference, &path))
            {
                pending.push(next);
            }
        }
    }
    false
}

pub(crate) async fn backend_sync_page_link(
    app: AppHandle,
    payload: PageLinkPayload,
) -> Result<PageLinkResult, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || sync_page_link(&app, payload))
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo sincronizar el enlace.", true))?
}

fn sync_page_link(app: &AppHandle, payload: PageLinkPayload) -> Result<PageLinkResult, BackendError> {
    let (key, opposite) = match payload.key.as_str() {
        "nextPage" => ("nextPage", "previousPage"),
        "previousPage" => ("previousPage", "nextPage"),
        _ => return Err(BackendError::invalid_input("El enlace de página no es válido.")),
    };
    let logical_path = crate::library_session::resolve_logical_path(app, &payload.library_id, &payload.logical_path)?;
    let current = crate::backend::LogicalPathDto::new(&logical_path)?.as_str().to_string();
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let documents = Documents {
        library_id: payload.library_id.clone(),
        adapter: TauriFilesystemDocumentAdapter::for_library(registry.inner(), &payload.library_id, picker.inner())?,
    };
    let old_target = extract_link_path(&payload.old_value).and_then(|reference| resolve_link_path(&reference, &current));
    let new_reference = extract_link_path(&payload.new_value);
    let new_target = new_reference.as_deref().and_then(|reference| resolve_link_path(reference, &current));
    let current_value = if new_target.is_some() { payload.new_value.trim().to_string() } else { "N/A".to_string() };
    if old_target.as_deref().map(str::to_lowercase) == new_target.as_deref().map(str::to_lowercase) {
        return Ok(PageLinkResult { current_value, changed: false, error: None });
    }
    if let Some(target) = new_target.as_deref() {
        if creates_cycle(&documents, &current, target) {
            return Ok(PageLinkResult {
                current_value: payload.old_value,
                changed: false,
                error: Some("No se puede crear un ciclo de páginas.".to_string()),
            });
        }
    }
    let mut problems = Vec::new();
    if let Some(old) = old_target.as_deref() {
        if let Some(source) = documents.read(old) {
            let points_back = frontmatter_value(&source, opposite)
                .and_then(|value| extract_link_path(&value))
                .and_then(|reference| resolve_link_path(&reference, old))
                .is_some_and(|path| same_path(&path, &current));
            if points_back && documents.set(old, &source, opposite, "N/A").is_err() {
                problems.push(old.to_string());
            }
        }
    }
    if let Some(target) = new_target.as_deref() {
        if let Some(source) = documents.read(target) {
            let name = current.rsplit('/').next().unwrap_or(&current);
            if documents.set(target, &source, opposite, &format!("[[{name}]]")).is_err() {
                problems.push(target.to_string());
            }
        }
    }
    let _ = key;
    Ok(PageLinkResult {
        current_value,
        changed: true,
        error: (!problems.is_empty()).then(|| format!("No se pudo actualizar el enlace en: {}.", problems.join(", "))),
    })
}
