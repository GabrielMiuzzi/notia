//! Optional reads and change-only writes of library documents by logical
//! path, shared by the backend features that own files inside a library.

use crate::host::{AppHandle, Manager};

use crate::backend::{
    BackendError, BackendErrorCode, DocumentLocatorDto, InventoryRequest, LibraryDocumentReadPort, LogicalPathDto,
};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const MAX_INVENTORY_PATHS: usize = 500;

pub(crate) struct Documents<'a> {
    library_id: String,
    pub(crate) adapter: TauriFilesystemDocumentAdapter<'a>,
}

impl Documents<'_> {
    pub(crate) fn locator(&self, path: &str) -> Result<DocumentLocatorDto, BackendError> {
        DocumentLocatorDto::new(&self.library_id, path, None, None)
    }

    pub(crate) fn read(&self, path: &str) -> Result<Option<String>, BackendError> {
        let locator = self.locator(path)?;
        if !self.adapter.exists_locator(&locator)? {
            return Ok(None);
        }
        match self.adapter.read_locator(&locator) {
            Ok(content) => Ok(Some(content)),
            Err(error) if error.code == BackendErrorCode::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Writes `content` when it differs from `current` (`None` = missing).
    pub(crate) fn write(&self, path: &str, current: Option<&str>, content: &str) -> Result<(), BackendError> {
        if current == Some(content) {
            return Ok(());
        }
        self.adapter.upsert_text_locator(&self.locator(path)?, content)
    }
}

pub(crate) fn with_documents<T>(
    app: &AppHandle,
    library_id: &str,
    run: impl FnOnce(&Documents<'_>) -> Result<T, BackendError>,
) -> Result<T, BackendError> {
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let documents = Documents {
        library_id: library_id.to_string(),
        adapter: TauriFilesystemDocumentAdapter::for_library(registry.inner(), library_id, picker.inner())?,
    };
    run(&documents)
}

/// Logical paths under `prefix` in the library inventory.
pub(crate) fn inventory_paths(app: &AppHandle, library_id: &str, prefix: &str) -> Result<Vec<String>, BackendError> {
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    let reader = crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
        registry.inner(),
        library_id,
        picker.inner(),
    )?
    .with_app(app.clone());
    match reader.inventory(&InventoryRequest {
        library_id: library_id.to_string(),
        prefix: Some(LogicalPathDto::new(prefix)?),
        offset: 0,
        limit: MAX_INVENTORY_PATHS,
    }) {
        Ok(page) => Ok(page.items.into_iter().map(|item| item.locator.logical_path.as_str().to_string()).collect()),
        Err(error) if matches!(error.code, BackendErrorCode::NotFound) => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}
