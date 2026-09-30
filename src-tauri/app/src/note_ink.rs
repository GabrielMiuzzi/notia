//! Handwriting over a note, kept in `.notia/ink/<note>.json` of its library
//! (the rules live in `backend::note_ink`), and the diagrams a note saves
//! next to itself (`backend::note_diagram`). Reads and writes go through the
//! library's document adapter, so they work on Windows and Android (SAF).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::backend::note_diagram::{diagram_bytes, diagram_destination_path, DiagramFormat};
use crate::backend::note_ink::{self, EntryChange, InkDocument, InkStroke, StrokeInput};
use crate::backend::{BackendError, BackendErrorCode, DocumentLocatorDto, MAX_EXPORT_NAME_ATTEMPTS};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::host::{AppHandle, Manager};
use crate::library_documents::{inventory_paths, with_documents};
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

/// One change of a strokes file at a time, so two quick strokes never
/// overwrite each other.
static INK_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InkNotePayload {
    library_id: String,
    /// The note, as the explorer shows it.
    path: String,
    /// Strokes of the pages (page mode) or of the continuous sheet.
    #[serde(default)]
    paged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InkAddPayload {
    library_id: String,
    path: String,
    stroke: StrokeInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InkRemovePayload {
    library_id: String,
    path: String,
    ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InkRestorePayload {
    library_id: String,
    path: String,
    strokes: Vec<InkStroke>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InkErasePayload {
    library_id: String,
    path: String,
    #[serde(default)]
    page: Option<u32>,
    points: Vec<[f64; 2]>,
    radius: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InkStrokesResult {
    strokes: Vec<InkStroke>,
}

fn ink_path(app: &AppHandle, library_id: &str, note_path: &str) -> Result<String, BackendError> {
    let logical_path = crate::library_session::resolve_logical_path(app, library_id, note_path)?;
    note_ink::ink_document_path(&logical_path)
}

fn read(app: &AppHandle, library_id: &str, note_path: &str) -> Result<InkDocument, BackendError> {
    let path = ink_path(app, library_id, note_path)?;
    with_documents(app, library_id, |documents| note_ink::parse_document(documents.read(&path)?.as_deref()))
}

/// Reads the strokes file, applies `change` and writes it back.
fn update<T>(
    app: &AppHandle,
    library_id: &str,
    note_path: &str,
    change: impl FnOnce(&mut InkDocument) -> Result<T, BackendError>,
) -> Result<T, BackendError> {
    let path = ink_path(app, library_id, note_path)?;
    let _guard = INK_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    with_documents(app, library_id, |documents| {
        let current = documents.read(&path)?;
        let mut document = note_ink::parse_document(current.as_deref())?;
        let result = change(&mut document)?;
        if current.is_some() || !document.strokes.is_empty() {
            documents.write(&path, current.as_deref(), &note_ink::serialize_document(&document)?)?;
        }
        Ok(result)
    })
}

async fn blocking<T: Send + 'static>(
    run: impl FnOnce() -> Result<T, BackendError> + Send + 'static,
) -> Result<T, BackendError> {
    crate::host::async_runtime::spawn_blocking(run)
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron guardar los trazos.", true))?
}

pub(crate) async fn markdown_ink_load(app: AppHandle, payload: InkNotePayload) -> Result<InkStrokesResult, BackendError> {
    blocking(move || {
        let document = read(&app, &payload.library_id, &payload.path)?;
        Ok(InkStrokesResult { strokes: note_ink::strokes_on(&document, payload.paged) })
    })
    .await
}

/// Saves a stroke and returns it as kept: smoothed and simplified.
pub(crate) async fn markdown_ink_add(app: AppHandle, payload: InkAddPayload) -> Result<InkStroke, BackendError> {
    blocking(move || {
        let stroke = note_ink::prepare_stroke(payload.stroke)?;
        update(&app, &payload.library_id, &payload.path, |document| {
            note_ink::add_stroke(document, stroke.clone())?;
            Ok(stroke)
        })
    })
    .await
}

pub(crate) async fn markdown_ink_remove(app: AppHandle, payload: InkRemovePayload) -> Result<InkStrokesResult, BackendError> {
    blocking(move || {
        update(&app, &payload.library_id, &payload.path, |document| {
            Ok(InkStrokesResult { strokes: note_ink::remove_strokes(document, &payload.ids) })
        })
    })
    .await
}

pub(crate) async fn markdown_ink_restore(app: AppHandle, payload: InkRestorePayload) -> Result<InkStrokesResult, BackendError> {
    blocking(move || {
        update(&app, &payload.library_id, &payload.path, |document| {
            note_ink::restore_strokes(document, payload.strokes.clone())?;
            Ok(InkStrokesResult { strokes: payload.strokes })
        })
    })
    .await
}

/// Takes out what the eraser touched and returns it, so undo can put it back.
pub(crate) async fn markdown_ink_erase(app: AppHandle, payload: InkErasePayload) -> Result<InkStrokesResult, BackendError> {
    blocking(move || {
        update(&app, &payload.library_id, &payload.path, |document| {
            Ok(InkStrokesResult { strokes: note_ink::erase(document, payload.page, &payload.points, payload.radius)? })
        })
    })
    .await
}

/// Before an explorer operation: whether the strokes may follow it. A paste
/// onto a name already taken fails, and must not touch that entry's strokes.
pub(crate) fn plan_entry_change(
    app: &AppHandle,
    library_id: &str,
    action: &str,
    logical_path: &str,
    name: Option<&str>,
    source: Option<&str>,
    mode: Option<&str>,
) -> Option<EntryChange> {
    let change = note_ink::entry_change(action, logical_path, name, source, mode)?;
    if let EntryChange::Move { to, .. } | EntryChange::Copy { to, .. } = &change {
        let taken = with_documents(app, library_id, |documents| documents.adapter.exists_locator(&documents.locator(to)?))
            .unwrap_or(true);
        if taken {
            return None;
        }
    }
    Some(change)
}

/// After the explorer operation succeeded: the strokes of the entry's notes
/// are moved, copied or deleted with them. A failure leaves the strokes
/// where they were and is only logged; the note itself already changed.
pub(crate) fn apply_entry_change(app: &AppHandle, library_id: &str, change: &EntryChange) {
    let _guard = INK_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let source = change.source();
    let files = match note_ink::ink_document_path(source) {
        Ok(own) => Ok(vec![own]),
        Err(_) => inventory_paths(app, library_id, note_ink::ink_folder_of(source).trim_end_matches('/'))
            .map(|paths| paths.into_iter().filter(|path| path.starts_with(&note_ink::ink_folder_of(source))).collect()),
    };
    let result = files.and_then(|files| {
        with_documents(app, library_id, |documents| {
            for path in files {
                let Some(text) = documents.read(&path)? else { continue };
                match change {
                    EntryChange::Delete { .. } => documents.adapter.delete_locator(&documents.locator(&path)?)?,
                    EntryChange::Move { from, to } | EntryChange::Copy { from, to } => {
                        let Some(target) = note_ink::relocated_ink_path(&path, from, to) else { continue };
                        documents.write(&target, None, &text)?;
                        if matches!(change, EntryChange::Move { .. }) {
                            documents.adapter.delete_locator(&documents.locator(&path)?)?;
                        }
                    }
                }
            }
            Ok(())
        })
    });
    if let Err(error) = result {
        log::warn!("[notia:ink] los trazos no siguieron a la nota: {}", error.message);
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagramExportPayload {
    library_id: String,
    /// The note, as the explorer shows it.
    path: String,
    format: DiagramFormat,
    /// SVG markup, or the PNG in base64.
    data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagramExportResult {
    /// Where the diagram went, as the explorer shows it.
    path: String,
}

fn export_diagram(app: &AppHandle, payload: DiagramExportPayload) -> Result<DiagramExportResult, BackendError> {
    let note = crate::library_session::resolve_logical_path(app, &payload.library_id, &payload.path)?;
    let bytes = diagram_bytes(payload.format, &payload.data)?;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let writer = TauriFilesystemDocumentAdapter::for_library(registry.inner(), &payload.library_id, picker.inner())?;
    let root = crate::library_catalog::catalog_library(app, &payload.library_id).map(|library| library.path);
    for attempt in 1..=MAX_EXPORT_NAME_ATTEMPTS {
        let destination = diagram_destination_path(&note, payload.format, attempt)?;
        let locator = DocumentLocatorDto::new(&payload.library_id, &destination, None, None)?;
        if writer.exists_locator(&locator)? {
            continue;
        }
        match writer.write_binary_locator(&locator, &bytes) {
            Ok(()) => {
                let path = match &root {
                    Some(root) => notia_backend_core::library_tree::library_visible_path(root, &destination),
                    None => destination,
                };
                crate::library_session::reindex_in_background(app, &payload.library_id);
                return Ok(DiagramExportResult { path });
            }
            Err(error) if error.code == BackendErrorCode::Conflict => continue,
            Err(error) => return Err(error),
        }
    }
    Err(BackendError::new(BackendErrorCode::Conflict, "Ya existen demasiados diagramas de esta nota en la carpeta.", false))
}

pub(crate) async fn markdown_export_diagram(app: AppHandle, payload: DiagramExportPayload) -> Result<DiagramExportResult, BackendError> {
    blocking(move || export_diagram(&app, payload)).await
}
