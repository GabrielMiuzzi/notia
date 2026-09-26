//! GitBook blocks the editor draws: what the note's expressions, conditions,
//! page links, files, images and reusable content resolve to in its library.
//! The rules live in `backend::gitbook_blocks`; this reads the library files.

use serde::Deserialize;

use crate::backend::gitbook_blocks::{resolve_blocks, BlockLibrary, BlockResolveRequest, BlockResolveResponse};
use crate::backend::{BackendError, BackendErrorCode, DocumentLocatorDto, MAX_EXPORT_INPUT_BYTES};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::host::{AppHandle, Manager};
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

/// The files of one library, as the blocks read them.
pub(crate) struct LibraryFiles<'a> {
    library_id: String,
    adapter: TauriFilesystemDocumentAdapter<'a>,
    /// Folder of the library, to give the paths the explorer shows.
    root: Option<String>,
}

impl<'a> LibraryFiles<'a> {
    pub(crate) fn new(library_id: &str, adapter: TauriFilesystemDocumentAdapter<'a>, root: Option<String>) -> Self {
        Self { library_id: library_id.to_string(), adapter, root }
    }

    fn locator(&self, logical_path: &str) -> Option<DocumentLocatorDto> {
        DocumentLocatorDto::new(&self.library_id, logical_path, None, None).ok()
    }
}

impl BlockLibrary for LibraryFiles<'_> {
    fn read_text(&mut self, logical_path: &str) -> Option<String> {
        let locator = self.locator(logical_path)?;
        self.adapter.read_locator(&locator).ok()
    }

    fn exists(&mut self, logical_path: &str) -> bool {
        self.locator(logical_path).is_some_and(|locator| self.adapter.exists_locator(&locator).unwrap_or(false))
    }

    fn visible_path(&self, logical_path: &str) -> String {
        match &self.root {
            Some(root) => notia_backend_core::library_tree::library_visible_path(root, logical_path),
            None => logical_path.to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownBlocksPayload {
    library_id: String,
    /// The note, as the explorer shows it.
    path: String,
    /// The note as the editor has it, saved or not: its `vars:` count.
    source: String,
    #[serde(flatten)]
    request: BlockResolveRequest,
}

pub(crate) async fn markdown_blocks_resolve(
    app: AppHandle,
    payload: MarkdownBlocksPayload,
) -> Result<BlockResolveResponse, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || resolve(&app, payload))
        .await
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron leer los bloques de la nota.", true))?
}

fn resolve(app: &AppHandle, payload: MarkdownBlocksPayload) -> Result<BlockResolveResponse, BackendError> {
    if payload.source.len() > MAX_EXPORT_INPUT_BYTES {
        return Err(BackendError::invalid_input("La nota es demasiado grande."));
    }
    let current = crate::library_session::resolve_logical_path(app, &payload.library_id, &payload.path)?;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), &payload.library_id, picker.inner())?;
    let root = crate::library_catalog::catalog_library(app, &payload.library_id).map(|library| library.path);
    let mut files = LibraryFiles::new(&payload.library_id, adapter, root);
    Ok(resolve_blocks(&payload.request, &payload.source, &current, &mut files))
}
