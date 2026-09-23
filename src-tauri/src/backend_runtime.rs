//! Productive Tauri wiring for the backend-core agent runtime.
//!
//! This module is deliberately an adapter: authorization, interaction state
//! transitions and the provider loop remain in `backend-core`. Tauri only
//! resolves the native principal, supplies platform-bound document reads and
//! publishes versioned events.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use notia_backend_core::{
    AgentContinuation, AgentProvider, AgentResponse, AgentStateHooks, BackendError, BackendErrorCode,
    BackendLimits, BackendRequest, BackendRequestContext, BackendSnapshot,
    AgentRequest, BackendRequestEnvelope, BackendResponse, BackendResponseEnvelope, BackendScope,
    DocumentContent, DocumentLocatorDto, DocumentSearchRequest, ExactSearchRequest,
    CompareDocumentsRequest, ContextSearchRequest, LibraryDocumentReadPort, MutationPreview,
    MutationPreviewAction,
    OperationGenerationCache, PreviewDocument, PreviewHunk,
    OperationReview, OperationReviewPort, OperationStatePort, OperationToken, PersistencePolicy,
    ProviderMessage, ProviderMessageRole, ProviderRequest, ProviderResponse, ProviderStreamDelta,
    RequestControl, RequestControlRegistry, RevisionPort, ToolCall, ToolExecutor, ToolResult, UndoRequest, UndoResult,
    AgentRuntimeOptions, InteractionRuntime, ToolCatalogProjection,
    project_canonical_tool_catalog, ResumeDecision, MarkdownEditPreview, MarkdownEditRequest,
    MultiDocumentMarkdownEditRequest, MultiDocumentMarkdownPreview, materialize_markdown_preview, preview_markdown_edit,
    preview_multi_document_markdown_edit, WebSearchReservation, WebSearchTracker,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::finance_agent_inputs;
use crate::backend_ollama::{platform_ollama_transport, OllamaAgentProvider, OllamaProviderConfig};
use crate::backend_tauri::{
    BackendEventStore as TauriBackendEventStore, EventStreamKey, TauriBackendEventSink,
};
use crate::library_registry::{LibraryBindingRegistry, LibraryBindingRoot};
use crate::library_users::backend_authorization_principal;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

/// Host-owned runtime state. Every field is shared so a request can run on a
/// blocking worker while other transport calls (cancel, status, replay) are
/// served concurrently against the same journal, controls and events.
#[derive(Debug, Default, Clone)]
pub(crate) struct BackendRuntimeState {
    journal: Arc<BackendJournal>,
    generations: Arc<OperationGenerationCache>,
    events: Arc<TauriBackendEventStore>,
    controls: Arc<RequestControlRegistry>,
    provider: Arc<Mutex<Option<BackendProviderSettings>>>,
}

impl BackendRuntimeState {
    /// Uses the library's saved AI settings (`ia` section of its
    /// configuration), so a backend worker can run without the WebView.
    pub(crate) fn configure_from_library_config(&self, config: &Value) -> Result<(), BackendError> {
        let settings = provider_settings_from_config(config)?;
        *self
            .provider
            .lock()
            .map_err(|_| internal_error("No se pudo configurar el proveedor backend."))? = Some(settings);
        Ok(())
    }

    /// Events of one request after `after_sequence`, for a backend observer.
    pub(crate) fn request_events(
        &self,
        context: &notia_backend_core::BackendRequestContext,
        after_sequence: u64,
    ) -> Result<Vec<notia_backend_core::BackendEventEnvelope>, BackendError> {
        self.events.replay_since(
            &EventStreamKey::from_parts(&context.library_id, &context.actor.library_user_id, &context.request_id),
            after_sequence,
        )
    }

    fn interactions<'a>(
        &'a self,
        revisions: Option<&'a dyn RevisionPort>,
    ) -> InteractionRuntime<'a> {
        InteractionRuntime::new(
            self.journal.as_ref(),
            Some(self.journal.as_ref()),
            revisions,
            self.generations.as_ref(),
        )
        .with_control_registry(Arc::clone(&self.controls))
    }

    /// Cancels every active run of a library whose binding was revoked.
    pub(crate) fn cancel_library_runs(&self, library_id: &str) -> Result<usize, BackendError> {
        self.controls.cancel_library(library_id)
    }
}

#[derive(Debug, Clone)]
struct BackendProviderSettings {
    ollama_url: String,
    model: String,
    api_key: String,
    think: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigureBackendProviderPayload {
    pub(crate) ollama_url: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) think: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplayBackendEventsPayload {
    pub(crate) request_id: String,
    pub(crate) library_id: String,
    pub(crate) library_user_id: String,
    #[serde(default)]
    pub(crate) after_sequence: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
struct JournalKey {
    library_id: String,
    library_user_id: String,
    idempotency_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct JournalRecord {
    context: Option<BackendRequestContext>,
    request: Option<AgentRequest>,
    operation: Option<OperationReview>,
    response: Option<AgentResponse>,
    tool_results: HashMap<String, ToolResult>,
    continuation: Option<AgentContinuation>,
    /// Pre-mutation state of documents changed by confirmed operations,
    /// keyed by operation id. Enables a verified undo of the latest change.
    #[serde(default)]
    undo: HashMap<String, DocumentUndoEntry>,
}

/// State needed to revert one document mutation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentUndoEntry {
    logical_path: String,
    /// Content before the mutation; `None` when the operation created it.
    previous_content: Option<String>,
    /// Revision right after the mutation; `None` when it deleted the file.
    resulting_revision: Option<u64>,
}

/// Documents larger than this are not kept for undo; the operation simply
/// stays non-undoable instead of bloating the journal.
const MAX_UNDO_CONTENT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Default)]
struct BackendJournal {
    records: Mutex<HashMap<JournalKey, JournalRecord>>,
}

const MAX_JOURNAL_RECORD_BYTES: usize = 8 * 1024 * 1024;
const MAX_JOURNAL_RECORDS: usize = 256;

impl BackendJournal {
    /// Stores the undo entry of a completed document mutation and marks the
    /// matching operation as undoable.
    fn store_undo(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        operation_id: &str,
        entry: DocumentUndoEntry,
    ) -> Result<(), BackendError> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        let key = Self::key(context, idempotency_key);
        let record = records.entry(key.clone()).or_default();
        record.undo.insert(operation_id.to_string(), entry);
        if let Some(review) = record
            .operation
            .as_mut()
            .filter(|review| review.operation.operation_id == operation_id)
        {
            review.can_undo = true;
        }
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn undo_entry(
        &self,
        context: &BackendRequestContext,
        operation_id: &str,
    ) -> Result<(JournalKey, DocumentUndoEntry), BackendError> {
        let (key, record) = self.record_for_operation(context, operation_id)?;
        record
            .undo
            .get(operation_id)
            .cloned()
            .map(|entry| (key, entry))
            .ok_or_else(|| {
                BackendError::new(
                    BackendErrorCode::Conflict,
                    "La operación no tiene un estado previo para deshacer.",
                    false,
                )
            })
    }

    fn finish_undo(&self, key: &JournalKey, operation_id: &str) -> Result<(), BackendError> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        if let Some(record) = records.get_mut(key) {
            record.undo.remove(operation_id);
            if let Some(review) = record.operation.as_mut() {
                if review.operation.operation_id == operation_id {
                    review.can_undo = false;
                }
            }
        }
        Ok(())
    }

    fn trim_records(records: &mut HashMap<JournalKey, JournalRecord>, preserve: &JournalKey) {
        while records.len() > MAX_JOURNAL_RECORDS {
            let eviction_key = records
                .keys()
                .find(|key| *key != preserve)
                .cloned();
            let Some(eviction_key) = eviction_key else { break; };
            records.remove(&eviction_key);
        }
    }

    fn key(context: &BackendRequestContext, idempotency_key: &str) -> JournalKey {
        JournalKey {
            library_id: context.library_id.clone(),
            library_user_id: context.actor.library_user_id.clone(),
            idempotency_key: idempotency_key.to_string(),
        }
    }

    fn record_for_operation(
        &self,
        context: &BackendRequestContext,
        operation_id: &str,
    ) -> Result<(JournalKey, JournalRecord), BackendError> {
        let records = self.records.lock().map_err(|_| internal_error("No se pudo leer el journal backend."))?;
        records
            .iter()
            .find_map(|(key, record)| {
                record.operation.as_ref().and_then(|operation| {
                    (key.library_id == context.library_id
                        && key.library_user_id == context.actor.library_user_id
                        && operation.operation.operation_id == operation_id)
                        .then(|| (key.clone(), record.clone()))
                })
            })
            .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La operación no existe.", false))
    }

    fn store_request(
        &self,
        request: &AgentRequest,
    ) -> Result<(), BackendError> {
        let mut records = self.records.lock().map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        let key = Self::key(&request.context, &request.idempotency_key);
        let record = records
            .entry(key.clone())
            .or_default();
        record.context = Some(request.context.clone());
        record.request = Some(request.clone());
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn load_request(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
    ) -> Result<AgentRequest, BackendError> {
        self.records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .and_then(|record| record.request.clone())
            .ok_or_else(|| BackendError::new(
                BackendErrorCode::NotFound,
                "No existe el request necesario para reanudar la operación.",
                true,
            ))
    }

    fn hydrate_record(
        &self,
        app: &AppHandle,
        registry: &LibraryBindingRegistry,
        context: &BackendRequestContext,
        idempotency_key: &str,
    ) -> Result<(), BackendError> {
        let key = Self::key(context, idempotency_key);
        if self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .contains_key(&key)
        {
            return Ok(());
        }
        let storage = JournalStorage::open(app, registry, &context.library_id)?;
        let Some(serialized) = crate::database::load_backend_operation_record(
            &storage.connection,
            &context.actor.library_user_id,
            idempotency_key,
        )
        .map_err(|_| storage_error("No se pudo leer el journal backend."))?
        else {
            return Ok(());
        };
        if serialized.len() > MAX_JOURNAL_RECORD_BYTES {
            return Err(BackendError::invalid_input("El journal backend supera el límite de tamaño."));
        }
        let record = serde_json::from_str::<JournalRecord>(&serialized)
            .map_err(|_| storage_error("El journal backend está corrupto."))?;
        let mut records = self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        records.insert(key.clone(), record);
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn persist_record(
        &self,
        app: &AppHandle,
        registry: &LibraryBindingRegistry,
        context: &BackendRequestContext,
        idempotency_key: &str,
    ) -> Result<(), BackendError> {
        let record = self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .cloned();
        let Some(record) = record else { return Ok(()); };
        let serialized = serde_json::to_string(&record)
            .map_err(|_| internal_error("No se pudo serializar el journal backend."))?;
        if serialized.len() > MAX_JOURNAL_RECORD_BYTES {
            return Err(BackendError::invalid_input("El journal backend supera el límite de tamaño."));
        }
        let storage = JournalStorage::open(app, registry, &context.library_id)?;
        crate::database::save_backend_operation_record(
            &storage.connection,
            &context.actor.library_user_id,
            idempotency_key,
            &serialized,
        )
        .map_err(|_| storage_error("No se pudo guardar el journal backend."))?;
        storage.commit(app)
    }
}

/// SQLite connection of the library that owns a journal record. Desktop uses
/// the canonical `.notia` database; Android works on the plugin-managed copy
/// and must sync it back through SAF before a write counts as persisted.
struct JournalStorage {
    connection: rusqlite::Connection,
    #[cfg(target_os = "android")]
    tree_uri: String,
}

impl JournalStorage {
    fn open(
        app: &AppHandle,
        registry: &LibraryBindingRegistry,
        library_id: &str,
    ) -> Result<Self, BackendError> {
        let binding = registry.lookup(library_id)?;
        match binding.root {
            #[cfg(not(target_os = "android"))]
            Some(LibraryBindingRoot::Desktop { canonical_root }) => {
                let _ = app;
                let connection = crate::database::open_existing_library_connection_rw(&canonical_root)
                    .map_err(|_| storage_error("No se pudo abrir la base de datos de la biblioteca."))?;
                crate::database::migrate(&connection)
                    .map_err(|_| storage_error("No se pudo actualizar el journal backend."))?;
                Ok(Self { connection })
            }
            #[cfg(target_os = "android")]
            Some(LibraryBindingRoot::Android { tree_uri }) => {
                let connection =
                    crate::database::open_mobile_library_connection(app, tree_uri.as_str())
                        .map_err(|_| storage_error(
                            "No se pudo abrir la base de datos de la biblioteca. Volvé a autorizar la carpeta.",
                        ))?;
                Ok(Self {
                    connection,
                    tree_uri: tree_uri.as_str().to_string(),
                })
            }
            _ => Err(BackendError::new(
                BackendErrorCode::Unsupported,
                "La biblioteca no tiene un almacenamiento compatible con esta plataforma.",
                true,
            )),
        }
    }

    fn commit(self, app: &AppHandle) -> Result<(), BackendError> {
        #[cfg(target_os = "android")]
        {
            drop(self.connection);
            crate::database::sync_mobile_library_connection(app, &self.tree_uri).map_err(|_| {
                storage_error("No se pudo sincronizar el journal backend. Volvé a autorizar la carpeta.")
            })?;
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (self, app);
        }
        Ok(())
    }
}

impl AgentStateHooks for BackendJournal {
    fn load_response(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
    ) -> Result<Option<AgentResponse>, BackendError> {
        Ok(self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .and_then(|record| record.response.clone()))
    }

    fn store_response(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        response: &AgentResponse,
    ) -> Result<(), BackendError> {
        let mut records = self.records.lock().map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        let key = Self::key(context, idempotency_key);
        let record = records.entry(key.clone()).or_default();
        record.context = Some(context.clone());
        record.response = Some(response.clone());
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn load_tool_result(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        call_key: &str,
    ) -> Result<Option<ToolResult>, BackendError> {
        Ok(self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .and_then(|record| record.tool_results.get(call_key).cloned()))
    }

    fn store_tool_result(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        call_key: &str,
        result: &ToolResult,
    ) -> Result<(), BackendError> {
        let mut records = self.records.lock().map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        let key = Self::key(context, idempotency_key);
        let record = records.entry(key.clone()).or_default();
        record.context = Some(context.clone());
        record.tool_results.insert(call_key.to_string(), result.clone());
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn load_continuation(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        operation_id: &str,
    ) -> Result<Option<AgentContinuation>, BackendError> {
        Ok(self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .and_then(|record| record.continuation.clone())
            .filter(|continuation| continuation.pending_call.id == operation_id))
    }

    fn store_continuation(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        operation_id: &str,
        continuation: &AgentContinuation,
    ) -> Result<(), BackendError> {
        if continuation.pending_call.id != operation_id {
            return Err(BackendError::invalid_input(
                "El checkpoint no corresponde a la operación.",
            ));
        }
        let mut records = self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        let key = Self::key(context, idempotency_key);
        let record = records.entry(key.clone()).or_default();
        record.context = Some(context.clone());
        record.continuation = Some(continuation.clone());
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn clear_continuation(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        operation_id: &str,
    ) -> Result<(), BackendError> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        if let Some(record) = records.get_mut(&Self::key(context, idempotency_key)) {
            if record
                .continuation
                .as_ref()
                .is_some_and(|continuation| continuation.pending_call.id == operation_id)
            {
                record.continuation = None;
            }
        }
        Ok(())
    }
}

impl OperationStatePort for BackendJournal {
    fn load_operation(
        &self,
        context: &BackendRequestContext,
        operation_id: &str,
        idempotency_key: &str,
    ) -> Result<Option<OperationReview>, BackendError> {
        Ok(self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .and_then(|record| record.operation.clone())
            .filter(|review| review.operation.operation_id == operation_id))
    }

    fn store_operation(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
        review: &OperationReview,
    ) -> Result<(), BackendError> {
        let mut records = self.records.lock().map_err(|_| internal_error("No se pudo escribir el journal backend."))?;
        let key = Self::key(context, idempotency_key);
        let record = records.entry(key.clone()).or_default();
        record.context = Some(context.clone());
        record.operation = Some(review.clone());
        Self::trim_records(&mut records, &key);
        Ok(())
    }

    fn load_operation_for_request(
        &self,
        context: &BackendRequestContext,
        idempotency_key: &str,
    ) -> Result<Option<OperationReview>, BackendError> {
        Ok(self
            .records
            .lock()
            .map_err(|_| internal_error("No se pudo leer el journal backend."))?
            .get(&Self::key(context, idempotency_key))
            .and_then(|record| record.operation.clone()))
    }
}

impl OperationReviewPort for BackendJournal {
    fn review_operation(
        &self,
        context: &BackendRequestContext,
        operation: &OperationToken,
    ) -> Result<OperationReview, BackendError> {
        self.record_for_operation(context, &operation.operation_id)
            .and_then(|(_, record)| record.operation.ok_or_else(|| {
                BackendError::new(BackendErrorCode::NotFound, "La revisión no existe.", false)
            }))
    }

    fn undo_operation(
        &self,
        _context: &BackendRequestContext,
        _request: &UndoRequest,
    ) -> Result<UndoResult, BackendError> {
        Err(BackendError::new(
            BackendErrorCode::Unsupported,
            "El undo todavía no tiene un adaptador nativo para esta operación.",
            false,
        ))
    }
}

struct TauriRevisionPort {
    app: AppHandle,
}

/// Review/undo port with filesystem access. Review data comes from the
/// journal; undo restores the recorded state only when the document still has
/// the revision the operation produced, so later edits are never overwritten.
struct TauriOperationReviewPort {
    app: AppHandle,
    journal: Arc<BackendJournal>,
}

impl OperationReviewPort for TauriOperationReviewPort {
    fn review_operation(
        &self,
        context: &BackendRequestContext,
        operation: &OperationToken,
    ) -> Result<OperationReview, BackendError> {
        self.journal.review_operation(context, operation)
    }

    fn undo_operation(
        &self,
        context: &BackendRequestContext,
        request: &UndoRequest,
    ) -> Result<UndoResult, BackendError> {
        let operation_id = &request.operation.operation_id;
        let (key, entry) = self.journal.undo_entry(context, operation_id)?;
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        let locator = DocumentLocatorDto::new(&context.library_id, &entry.logical_path, None, None)?;
        let reader = crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
            registry.inner(),
            &context.library_id,
            picker.inner(),
        )
        .map(|reader| reader.with_app(self.app.clone()))?;
        let current = match reader.read_document(&locator) {
            Ok(document) => Some(document),
            Err(error) if error.code == BackendErrorCode::NotFound => None,
            Err(error) => return Err(error),
        };
        if current.as_ref().map(|document| document.revision) != entry.resulting_revision {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El documento cambió después de la operación; no se deshace para no perder esos cambios.",
                false,
            ));
        }
        let writer = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
            registry.inner(),
            &context.library_id,
            picker.inner(),
        )?;
        match (&entry.previous_content, current) {
            (None, Some(_)) => writer.delete_locator(&locator)?,
            (Some(content), Some(current)) => {
                writer.write_locator_at_revision(&locator, content, current.revision)?
            }
            (Some(content), None) => writer.create_text_locator(&locator, content)?,
            (None, None) => {}
        }
        self.journal.finish_undo(&key, operation_id)?;
        let _ = crate::agent_history::mark_undone(&self.app, &context.library_id, operation_id);
        Ok(UndoResult {
            operation: request.operation.clone(),
            result: ToolResult {
                call_id: operation_id.clone(),
                ok: true,
                changed: true,
                data: Some(json!({
                    "path": entry.logical_path,
                    "restored": entry.previous_content.is_some(),
                    "deleted": entry.previous_content.is_none(),
                })),
                error: None,
                preview: None,
            },
        })
    }
}

/// Maximum number of skill files loaded into one system prompt.
const MAX_AGENT_SKILLS: usize = 16;
/// Maximum characters read from one agent file (prompt, rules, memory, skill).
const MAX_AGENT_FILE_CHARS: usize = 40_000;
/// Maximum characters of the composed system prompt.
const MAX_SYSTEM_PROMPT_CHARS: usize = 100_000;

/// `.agent` storage of one library through the platform document adapters
/// (canonical desktop root or SAF tree/document resolution on Android).
struct TauriAgentStateRepository {
    app: AppHandle,
}

impl TauriAgentStateRepository {
    fn read_optional(&self, library_id: &str, logical_path: &str) -> Result<Option<String>, BackendError> {
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        let reader = crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
            registry.inner(),
            library_id,
            picker.inner(),
        )
        .map(|reader| reader.with_app(self.app.clone()))?;
        let locator = DocumentLocatorDto::new(library_id, logical_path, None, None)?;
        match reader.read_document(&locator) {
            Ok(document) => {
                let body = notia_backend_core::strip_frontmatter(&document.content).trim();
                if body.chars().count() > MAX_AGENT_FILE_CHARS {
                    return Err(BackendError::invalid_input(
                        "Un archivo del agente supera el límite permitido.",
                    ));
                }
                Ok((!body.is_empty()).then(|| body.to_string()))
            }
            Err(error) if error.code == BackendErrorCode::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
}

impl notia_backend_core::AgentStateRepository for TauriAgentStateRepository {
    fn load_prompt(&self, library_id: &str, prompt_name: &str) -> Result<Option<String>, BackendError> {
        self.read_optional(library_id, &format!(".agent/promps/{prompt_name}"))
    }

    fn load_memory(&self, library_id: &str, _library_user_id: &str) -> Result<Option<String>, BackendError> {
        // The core only asks for memory after checking the owner and the
        // persistence policy; memory is stored once per library.
        self.read_optional(library_id, ".agent/memory/memory.md")
    }

    fn save_memory(&self, _library_id: &str, _library_user_id: &str, _content: &str) -> Result<(), BackendError> {
        // Memory writes go through the confirmed `add_agent_memory` tool.
        Err(unsupported("La memoria del agente solo se modifica con una herramienta confirmada."))
    }

    fn load_rules(&self, library_id: &str) -> Result<Option<String>, BackendError> {
        self.read_optional(library_id, ".agent/memory/rules.md")
    }

    fn load_skills(&self, library_id: &str) -> Result<Vec<notia_backend_core::AgentSkill>, BackendError> {
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        let reader = crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
            registry.inner(),
            library_id,
            picker.inner(),
        )
        .map(|reader| reader.with_app(self.app.clone()))?;
        let page = match reader.inventory(&notia_backend_core::InventoryRequest {
            library_id: library_id.to_string(),
            prefix: Some(notia_backend_core::LogicalPathDto::new(".agent/skills")?),
            offset: 0,
            limit: MAX_AGENT_SKILLS,
        }) {
            Ok(page) => page,
            Err(error) if error.code == BackendErrorCode::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut skills = Vec::new();
        for item in page.items {
            let path = item.locator.logical_path.as_str().to_string();
            if !path.to_ascii_lowercase().ends_with(".md") {
                continue;
            }
            if let Some(content) = self.read_optional(library_id, &path)? {
                skills.push(notia_backend_core::AgentSkill { path, content });
            }
        }
        Ok(skills)
    }
}

/// Builds the system prompt once per request from the embedded defaults and
/// the library's `.agent` files through the core prompt policy.
fn compose_request_system_prompt(
    app: &AppHandle,
    request: &AgentRequest,
    visible_tools: &[notia_backend_core::ToolDefinition],
) -> Result<String, BackendError> {
    let repository = TauriAgentStateRepository { app: app.clone() };
    let mut parts = notia_backend_core::load_prompt_parts_with_request(
        &repository,
        &request.context,
        &notia_backend_core::PromptLoadRequest {
            // Without an explicit prompt, the one selected for the library
            // on this device applies (also for Telegram and Meeting).
            prompt_name: request
                .prompt_name
                .clone()
                .map(|name| notia_backend_core::agent_workspace::normalize_prompt_file_name(&name))
                .unwrap_or_else(|| crate::agent_workspace::selected_prompt(app, &request.context.library_id)),
            default_prompt: notia_backend_core::DEFAULT_AGENT_PROMPT.to_string(),
            default_rules: notia_backend_core::DEFAULT_AGENT_RULES.to_string(),
            synchronize_default_prompt: false,
        },
    )?;
    let format = notia_backend_core::response_format_for_channel(&request.context.channel);
    parts.rules = parts
        .rules
        .map(|rules| notia_backend_core::resolve_rules_for_format(&rules, format))
        .filter(|rules| !rules.is_empty());
    let mut system = notia_backend_core::compose_system_prompt(&parts, &request.context);
    let guidance = notia_backend_core::scope_guidance(
        &request.context,
        visible_tools,
        request.snapshot.as_ref(),
        &utc_today(),
    );
    if !guidance.is_empty() {
        system.push_str("\n\n");
        system.push_str(&guidance);
    }
    system.push_str(&format!(
        "\n\nContexto backend: scope {:?}, canal {:?}, política {:?}. No afirmes mutaciones sin receipt.",
        request.context.scope,
        request.context.channel,
        request.context.persistence_policy,
    ));
    if system.chars().count() > MAX_SYSTEM_PROMPT_CHARS {
        return Err(BackendError::invalid_input(
            "El prompt compuesto supera el límite permitido.",
        ));
    }
    Ok(system)
}

/// Replaces any client-supplied system message with the backend-owned prompt.
struct AuthoritativePromptProvider<'a, T> {
    inner: &'a T,
    system_prompt: String,
}

impl<'a, T: AgentProvider> AuthoritativePromptProvider<'a, T> {
    fn request(&self, request: &ProviderRequest) -> Result<ProviderRequest, BackendError> {
        let mut messages = request
            .messages
            .iter()
            .filter(|message| message.role != ProviderMessageRole::System)
            .cloned()
            .collect::<Vec<_>>();
        messages.insert(
            0,
            ProviderMessage {
                role: ProviderMessageRole::System,
                content: self.system_prompt.clone(),
                images: Vec::new(),
                tool_calls: Vec::new(),
                tool_name: None,
            },
        );
        Ok(ProviderRequest {
            context: request.context.clone(),
            messages,
            tools: request.tools.clone(),
        })
    }
}

impl<'a, T: AgentProvider> AgentProvider for AuthoritativePromptProvider<'a, T> {
    fn chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
    ) -> Result<ProviderResponse, BackendError> {
        self.inner.chat(&self.request(request)?, control)
    }

    fn stream_chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
        on_delta: &mut dyn FnMut(ProviderStreamDelta) -> Result<(), BackendError>,
    ) -> Result<ProviderResponse, BackendError> {
        self.inner.stream_chat(&self.request(request)?, control, on_delta)
    }

    fn tool_chat(
        &self,
        request: &ProviderRequest,
        control: &RequestControl,
    ) -> Result<ProviderResponse, BackendError> {
        self.inner.tool_chat(&self.request(request)?, control)
    }
}

impl RevisionPort for TauriRevisionPort {
    fn current_revision(
        &self,
        context: &BackendRequestContext,
        logical_path: &str,
    ) -> Result<Option<u64>, BackendError> {
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        let reader = crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
            registry.inner(),
            &context.library_id,
            picker.inner(),
        )
        .map(|reader| reader.with_app(self.app.clone()))?;
        let locator = DocumentLocatorDto::new(&context.library_id, logical_path, None, None)?;
        reader
            .read_document(&locator)
            .map(|document| Some(document.revision))
    }
}

struct TauriBackendToolExecutor {
    app: AppHandle,
    snapshot: Option<BackendSnapshot>,
    web_search_tracker: Mutex<WebSearchTracker>,
    /// Control of the owning request; blocking provider calls made by tools
    /// honour the same cancellation and deadline as the agent loop.
    control: RequestControl,
    journal: Arc<BackendJournal>,
    idempotency_key: String,
}

/// Documents a single multi-document apply may touch.
const MAX_MULTI_DOCUMENT_APPLY: usize = 20;

impl TauriBackendToolExecutor {
    fn supported_tool_names() -> &'static [&'static str] {
        &[
            "request_user_clarification",
            "request_user_confirmation",
            "search_web",
            "set_agent_execution_plan",
            "set_task_execution_plan",
            "create_agent_plan",
            "update_agent_plan",
            "get_workspace_context",
            "add_agent_memory",
            "add_agent_rule",
            "read_library_documents",
            "search_library_documents",
            "search_library_context",
            "search_library_exact",
            "get_document_metadata",
            "find_document_references",
            "compare_documents",
            "read_active_markdown_document",
            "create_library_note",
            "replace_library_document",
            "delete_library_document",
            "preview_markdown_edit",
            "apply_markdown_edit",
            "preview_multi_document_markdown_edit",
            "apply_multi_document_markdown_edit",
            "reindex_changed_documents",
            "export_document",
            "search_task_tickets",
            "read_task_tickets",
            "read_all_task_tickets",
            "search_task_context",
            "get_task_manager_options",
            "get_task_board_summary",
            "create_task_ticket",
            "replace_task_content",
            "add_task_comment",
            "add_task_subtask",
            "move_task_group",
            "change_task_state",
            "change_task_priority",
            "update_task_fields",
            "bulk_update_tasks",
            "duplicate_task",
            "archive_task",
            "restore_task",
            "create_task_group",
            "delete_task_group",
            "get_finance_dashboard",
            "get_finance_full_snapshot",
            "get_finance_dollar_quotes",
            "get_finance_inflation_indices",
            "get_finance_historical_dollar_quotes",
            "get_finance_record",
            "list_finance_movements",
            "list_finance_records",
            "list_finance_accounts",
            "list_finance_categories",
            "search_finance_categories",
            "list_finance_services",
            "list_finance_service_occurrences",
            "list_finance_service_invoices",
            "list_finance_audits",
            "get_finance_net_worth",
            "list_finance_net_worth_history",
            "list_finance_investments",
            "list_finance_installment_plans",
            "list_finance_installments",
            "list_finance_purchases",
            "list_finance_salaries",
            "list_finance_price_history",
            "list_finance_credit_card_statements",
            "list_finance_artifacts",
            "extract_finance_document",
            "save_finance_account",
            "save_finance_category",
            "save_finance_transaction",
            "create_finance_transaction",
            "save_finance_service",
            "save_finance_service_occurrence",
            "save_finance_service_invoice",
            "create_finance_service",
            "create_finance_service_occurrence",
            "create_finance_service_invoice",
            "create_finance_savings_movement",
            "create_finance_savings_exchange",
            "create_finance_category",
            "create_finance_purchase",
            "create_finance_salary",
            "create_finance_credit_card_statement",
            "save_finance_savings_reserve",
            "save_finance_savings_movement",
            "save_finance_savings_exchange",
            "save_finance_purchase",
            "save_finance_salary",
            "save_finance_credit_card_statement",
            "save_finance_installment_plan",
            "save_finance_investment",
            "link_finance_savings_account",
            "set_finance_service_active",
            "delete_finance_record",
            "reverse_finance_transaction",
            "update_finance_transaction_status",
            "clear_finance_data",
            "audit_finance_month",
            "preview_finance_audit_proposal",
            "apply_finance_audit_proposal",
        ]
    }

    fn reader<'a>(
        &'a self,
        library_id: &str,
    ) -> Result<crate::library_document_adapter::TauriLibraryDocumentReadAdapter<'a>, BackendError>
    {
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        crate::library_document_adapter::TauriLibraryDocumentReadAdapter::for_library(
            registry.inner(),
            library_id,
            picker.inner(),
        )
        .map(|reader| reader.with_app(self.app.clone()))
    }

    fn paths(arguments: &Value) -> Vec<String> {
        arguments
            .get("paths")
            .or_else(|| arguments.get("logicalPaths"))
            .and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default()
    }

    fn ids(arguments: &Value) -> Vec<String> {
        arguments
            .get("documentIds")
            .or_else(|| arguments.get("ids"))
            .and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default()
    }

    /// Non-empty trimmed strings of an array argument, bounded to `limit`.
    fn string_list(arguments: &Value, name: &str, limit: usize) -> Vec<String> {
        arguments
            .get(name)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .take(limit)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn text(arguments: &Value, name: &str) -> String {
        arguments
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string()
    }

    fn first_text(arguments: &Value, primary: &str, fallback: &str) -> String {
        let value = Self::text(arguments, primary);
        if value.is_empty() {
            Self::text(arguments, fallback)
        } else {
            value
        }
    }

    /// Logical path given explicitly as `path`, `logicalPath` or
    /// `relativePath` (the name used by the canonical tool schemas).
    fn explicit_path(arguments: &Value) -> Option<String> {
        ["path", "logicalPath", "relativePath"]
            .into_iter()
            .map(|name| Self::text(arguments, name))
            .find(|value| !value.is_empty())
    }

    fn locator(
        context: &BackendRequestContext,
        arguments: &Value,
    ) -> Result<DocumentLocatorDto, BackendError> {
        let path = Self::explicit_path(arguments).ok_or_else(|| {
            BackendError::invalid_input("La mutación documental necesita una ruta lógica.")
        })?;
        DocumentLocatorDto::new(&context.library_id, &path, None, None)
    }

    /// Resolves an existing document by explicit path or by the opaque
    /// `documentId` returned from search results. Ids are resolved through the
    /// library inventory, never interpreted as paths.
    fn existing_document_locator(
        &self,
        context: &BackendRequestContext,
        arguments: &Value,
    ) -> Result<DocumentLocatorDto, BackendError> {
        if Self::explicit_path(arguments).is_some() {
            return Self::locator(context, arguments);
        }
        let document_id = Self::text(arguments, "documentId");
        if document_id.is_empty() {
            return Err(BackendError::invalid_input(
                "La operación documental necesita documentId o una ruta lógica.",
            ));
        }
        self.reader(&context.library_id)?
            .read_documents(&context.library_id, &[document_id])?
            .into_iter()
            .next()
            .map(|document| document.locator)
            .ok_or_else(|| {
                BackendError::new(BackendErrorCode::NotFound, "El documento no existe.", false)
            })
    }

    fn markdown_edit_request(
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<MarkdownEditRequest, BackendError> {
        let locator = Self::locator(context, &call.arguments)?;
        let operation_value = call
            .arguments
            .get("operation")
            .or_else(|| call.arguments.get("edit"))
            .cloned()
            .ok_or_else(|| BackendError::invalid_input("La edición Markdown necesita una operación."))?;
        let operation = serde_json::from_value(operation_value)
            .map_err(|_| BackendError::invalid_input("La operación Markdown no es válida."))?;
        Ok(MarkdownEditRequest {
            operation_id: call.id.clone(),
            locator,
            expected_revision: call
                .arguments
                .get("expectedRevision")
                .and_then(Value::as_u64),
            operation,
        })
    }

    fn preview_markdown_tool(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Value, BackendError> {
        let request = Self::markdown_edit_request(context, call)?;
        let document = self.reader(&context.library_id)?.read_document(&request.locator)?;
        serde_json::to_value(preview_markdown_edit(&document.content, &request)?)
            .map_err(|_| invalid_result())
    }

    /// Builds a multi-document request from the canonical tool schema
    /// (`edits[{path, operation}]`). Returns `None` for the legacy shape with
    /// explicit locators.
    fn path_based_multi_edit(
        context: &BackendRequestContext,
        arguments: &Value,
    ) -> Result<Option<MultiDocumentMarkdownEditRequest>, BackendError> {
        let Some(edits) = arguments.get("edits").and_then(Value::as_array) else {
            return Ok(None);
        };
        if !edits.iter().all(|edit| edit.get("path").is_some()) {
            return Ok(None);
        }
        let edits = edits
            .iter()
            .map(|edit| {
                let operation = edit
                    .get("operation")
                    .cloned()
                    .ok_or_else(|| BackendError::invalid_input("Cada edición necesita una operación."))?;
                Ok(notia_backend_core::MarkdownDocumentEdit {
                    locator: Self::locator(context, edit)?,
                    operation: serde_json::from_value(operation).map_err(|_| {
                        BackendError::invalid_input("La operación Markdown no es válida.")
                    })?,
                })
            })
            .collect::<Result<Vec<_>, BackendError>>()?;
        Ok(Some(MultiDocumentMarkdownEditRequest {
            operation_id: String::new(),
            edits,
        }))
    }

    fn preview_multi_markdown_tool(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Value, BackendError> {
        let mut request = match Self::path_based_multi_edit(context, &call.arguments)? {
            Some(request) => request,
            None => {
                let value = call
                    .arguments
                    .get("request")
                    .cloned()
                    .unwrap_or_else(|| call.arguments.clone());
                serde_json::from_value::<MultiDocumentMarkdownEditRequest>(value).map_err(|_| {
                    BackendError::invalid_input("La edición multi-documento no es válida.")
                })?
            }
        };
        request.operation_id = call.id.clone();
        for edit in &mut request.edits {
            if edit.locator.library_id != context.library_id {
                return Err(BackendError::new(
                    BackendErrorCode::Forbidden,
                    "La edición multi-documento cruza la biblioteca activa.",
                    false,
                ));
            }
            let path = edit.locator.logical_path.as_str().to_string();
            edit.locator = DocumentLocatorDto::new(&context.library_id, &path, None, None)?;
        }
        let reader = self.reader(&context.library_id)?;
        serde_json::to_value(preview_multi_document_markdown_edit(&reader, &request)?)
            .map_err(|_| invalid_result())
    }

    fn apply_markdown_tool(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Value, BackendError> {
        let preview_value = call
            .arguments
            .get("preview")
            .cloned()
            .unwrap_or_else(|| call.arguments.clone());
        let mut preview = serde_json::from_value::<MarkdownEditPreview>(preview_value)
            .map_err(|_| BackendError::invalid_input("El preview Markdown no es válido."))?;
        if preview.locator.library_id != context.library_id {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "El preview Markdown no pertenece a la biblioteca activa.",
                false,
            ));
        }
        let path = preview.locator.logical_path.as_str().to_string();
        preview.locator = DocumentLocatorDto::new(&context.library_id, &path, None, None)?;
        let selected_hunk_ids = call
            .arguments
            .get("selectedHunkIds")
            .or_else(|| call.arguments.get("hunkIds"))
            .and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_default();
        let Some(content) = materialize_markdown_preview(&preview, &selected_hunk_ids)? else {
            return Ok(json!({ "changed": false, "operationId": preview.operation_id }));
        };
        let reader = self.reader(&context.library_id)?;
        let current = reader.read_document(&preview.locator)?;
        if current.revision != preview.expected_revision {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El documento Markdown cambió desde el preview.",
                true,
            ));
        }
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        let writer = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
            registry.inner(),
            &context.library_id,
            picker.inner(),
        )?;
        writer.write_locator_at_revision(&preview.locator, &content, preview.expected_revision)?;
        Ok(json!({
            "changed": true,
            "operationId": preview.operation_id,
            "path": preview.locator.logical_path.as_str(),
            "revision": crate::backend::compute_document_revision(&content),
        }))
    }

    fn multi_markdown_preview(call: &ToolCall) -> Result<MultiDocumentMarkdownPreview, BackendError> {
        let value = call
            .arguments
            .get("preview")
            .cloned()
            .unwrap_or_else(|| call.arguments.clone());
        let preview = serde_json::from_value::<MultiDocumentMarkdownPreview>(value)
            .map_err(|_| BackendError::invalid_input("El preview multi-documento no es válido."))?;
        if preview.previews.is_empty() || preview.previews.len() > MAX_MULTI_DOCUMENT_APPLY {
            return Err(BackendError::invalid_input(
                "El preview multi-documento no tiene un tamaño válido.",
            ));
        }
        Ok(preview)
    }

    /// Applies a multi-document preview all-or-nothing: every document is
    /// materialized and its revision verified before the first write, and
    /// documents already written are restored if a later write fails.
    fn apply_multi_markdown_tool(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Value, BackendError> {
        let preview = Self::multi_markdown_preview(call)?;
        let selected = call
            .arguments
            .get("selectedHunkIds")
            .or_else(|| call.arguments.get("hunkIds"))
            .and_then(Value::as_array)
            .map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_default();
        let known = preview
            .previews
            .iter()
            .flat_map(|document| document.hunks.iter().map(|hunk| hunk.id.as_str()))
            .collect::<std::collections::HashSet<_>>();
        if selected.iter().any(|id| !known.contains(id.as_str())) {
            return Err(BackendError::invalid_input(
                "Se seleccionó un hunk que no pertenece al preview.",
            ));
        }
        let reader = self.reader(&context.library_id)?;
        let mut planned = Vec::new();
        for document in &preview.previews {
            if document.locator.library_id != context.library_id {
                return Err(BackendError::new(
                    BackendErrorCode::Forbidden,
                    "El preview Markdown no pertenece a la biblioteca activa.",
                    false,
                ));
            }
            let mut document = document.clone();
            let path = document.locator.logical_path.as_str().to_string();
            document.locator = DocumentLocatorDto::new(&context.library_id, &path, None, None)?;
            let ids = if selected.is_empty() {
                Vec::new()
            } else {
                let ids = document
                    .hunks
                    .iter()
                    .filter(|hunk| selected.contains(&hunk.id))
                    .map(|hunk| hunk.id.clone())
                    .collect::<Vec<_>>();
                if ids.is_empty() {
                    continue;
                }
                ids
            };
            let Some(content) = materialize_markdown_preview(&document, &ids)? else {
                continue;
            };
            let current = reader.read_document(&document.locator)?;
            if current.revision != document.expected_revision {
                return Err(BackendError::new(
                    BackendErrorCode::Conflict,
                    format!("El documento {path} cambió desde el preview; no se aplicó ningún cambio."),
                    true,
                ));
            }
            planned.push((document.locator, current.content, content));
        }
        let registry = self.app.state::<LibraryBindingRegistry>();
        let picker = self.app.state::<AndroidDirectoryPickerState>();
        let writer = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
            registry.inner(),
            &context.library_id,
            picker.inner(),
        )?;
        let mut written: Vec<&(DocumentLocatorDto, String, String)> = Vec::new();
        for entry in &planned {
            let (locator, original, content) = entry;
            let revision = crate::backend::compute_document_revision(original);
            if let Err(error) = writer.write_locator_at_revision(locator, content, revision) {
                let not_restored = written
                    .iter()
                    .rev()
                    .filter(|(locator, original, content)| {
                        writer
                            .write_locator_at_revision(
                                locator,
                                original,
                                crate::backend::compute_document_revision(content),
                            )
                            .is_err()
                    })
                    .map(|(locator, _, _)| locator.logical_path.as_str().to_string())
                    .collect::<Vec<_>>();
                let message = if not_restored.is_empty() {
                    format!("{} No se aplicó ningún cambio.", error.message)
                } else {
                    format!(
                        "{} Quedaron modificados sin poder revertirse: {}.",
                        error.message,
                        not_restored.join(", ")
                    )
                };
                return Err(BackendError::new(error.code, message, error.retryable));
            }
            written.push(entry);
        }
        Ok(json!({
            "changed": !planned.is_empty(),
            "operationId": preview.operation_id,
            "documents": planned
                .iter()
                .map(|(locator, _, content)| json!({
                    "path": locator.logical_path.as_str(),
                    "revision": crate::backend::compute_document_revision(content),
                }))
                .collect::<Vec<_>>(),
        }))
    }

    fn finance_context(
        &self,
        context: &BackendRequestContext,
    ) -> Result<crate::finance::FinanceContext, BackendError> {
        let registry = self.app.state::<LibraryBindingRegistry>();
        let binding = registry.lookup(&context.library_id)?;
        let (library_path, android_directory_uri) = match binding.root {
            Some(LibraryBindingRoot::Desktop { canonical_root }) => {
                (canonical_root.to_string_lossy().to_string(), None)
            }
            Some(LibraryBindingRoot::Android { tree_uri }) => {
                (String::new(), Some(tree_uri.as_str().to_string()))
            }
            None => {
                return Err(BackendError::new(
                    BackendErrorCode::NotFound,
                    "La biblioteca no está disponible.",
                    true,
                ))
            }
        };
        let source = match context.channel {
            notia_backend_core::BackendChannel::Telegram => "telegram",
            notia_backend_core::BackendChannel::Published => "public-url",
            _ => "app",
        };
        Ok(crate::finance::FinanceContext {
            library_path,
            android_directory_uri,
            actor_library_user_id: context.actor.library_user_id.clone(),
            source: source.to_string(),
        })
    }

    fn page_limit(arguments: &Value, name: &str, default: usize) -> usize {
        arguments
            .get(name)
            .and_then(Value::as_u64)
            .unwrap_or(default as u64)
            .min(50) as usize
    }

    fn optional_text(arguments: &Value, name: &str) -> Option<String> {
        arguments
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn finance_record(arguments: &Value) -> Value {
        let mut record = arguments
            .get("record")
            .cloned()
            .unwrap_or_else(|| arguments.clone());
        if let Some(object) = record.as_object_mut() {
            let missing_id = object
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .is_none_or(str::is_empty);
            if missing_id {
                object.insert("id".to_string(), Value::String(uuid::Uuid::new_v4().to_string()));
            }
        }
        record
    }

    fn finance_period(
        arguments: &Value,
        name: &str,
        required: bool,
    ) -> Result<Option<String>, BackendError> {
        let Some(value) = arguments.get(name) else {
            if required {
                return Err(BackendError::invalid_input(format!(
                    "La consulta financiera necesita {name}."
                )));
            }
            return Ok(None);
        };
        let period = value.as_str().map(str::trim).unwrap_or_default();
        if !crate::finance::valid_service_period(period) {
            return Err(BackendError::invalid_input(format!(
                "{name} debe tener formato YYYY-MM."
            )));
        }
        Ok(Some(period.to_string()))
    }

    fn finance_date(arguments: &Value, name: &str) -> Result<Option<String>, BackendError> {
        let value = Self::optional_text(arguments, name);
        if let Some(date) = value.as_deref() {
            let valid = date.len() == 10
                && date.is_ascii()
                && date.as_bytes().get(4) == Some(&b'-')
                && date.as_bytes().get(7) == Some(&b'-')
                && date[0..4].parse::<u16>().is_ok()
                && (1..=12).contains(&date[5..7].parse::<u8>().unwrap_or_default())
                && (1..=31).contains(&date[8..10].parse::<u8>().unwrap_or_default());
            if !valid {
                return Err(BackendError::invalid_input(format!("{name} debe tener formato YYYY-MM-DD.")));
            }
        }
        Ok(value)
    }

    fn finance_id(arguments: &Value, name: &str) -> Result<String, BackendError> {
        let value = arguments
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if value.is_empty() {
            return Err(BackendError::invalid_input(format!(
                "La consulta financiera necesita {name}."
            )));
        }
        if value.chars().count() > 128 || value.chars().any(char::is_control) {
            return Err(BackendError::invalid_input(format!(
                "{name} no es válido."
            )));
        }
        Ok(value.to_string())
    }

    /// Accounts and categories of the current month used to resolve agent
    /// references by name before any finance write.
    fn finance_dashboard(
        &self,
        finance_context: &crate::finance::FinanceContext,
    ) -> Result<crate::finance::FinanceDashboard, BackendError> {
        crate::finance::finance_get_dashboard(
            self.app.clone(),
            finance_context.clone(),
            utc_today()[..7].to_string(),
        )
        .map_err(Self::finance_error)
    }

    /// Validates a finance creation before confirmation. Invalid input and
    /// duplicates return `InvalidInput`, which the agent loop hands back to
    /// the model instead of asking the user to confirm a doomed write.
    fn finance_create_preview(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Option<(String, Value)>, BackendError> {
        use finance_agent_inputs::CreateOrExisting;
        let name = call.name.as_str();
        if !matches!(
            name,
            "create_finance_category"
                | "create_finance_service"
                | "create_finance_transaction"
                | "create_finance_purchase"
                | "create_finance_salary"
                | "create_finance_credit_card_statement"
        ) {
            return Ok(None);
        }
        let rejected = |error: finance_agent_inputs::AgentInputError| {
            BackendError::invalid_input(format!(
                "{}: {} Campos: {}.",
                error.error,
                error.instruction,
                error.invalid_fields.join(", ")
            ))
        };
        let duplicate = |kind: &str, id: &str, entity_name: &str| {
            BackendError::invalid_input(format!(
                "Ya existe {kind} '{entity_name}' (id {id}); usá ese ID en lugar de crearla de nuevo."
            ))
        };
        let finance_context = self.finance_context(context)?;
        let dashboard = self.finance_dashboard(&finance_context)?;
        let account_name = |id: &str| {
            dashboard
                .accounts
                .iter()
                .find(|account| account.id == id)
                .map(|account| account.name.clone())
                .unwrap_or_else(|| id.to_string())
        };
        let source_reference = Self::agent_source_reference(context, call);
        let (summary, record) = match name {
            "create_finance_category" => {
                match finance_agent_inputs::build_category(&call.arguments, &dashboard.categories)
                    .map_err(rejected)?
                {
                    CreateOrExisting::Existing(category) => {
                        return Err(duplicate("la categoría", &category.id, &category.name))
                    }
                    CreateOrExisting::Create(category) => (
                        format!(
                            "Crear la categoría {} para {}.",
                            category.name,
                            if category.kind == "expense" { "gastos" } else { "ingresos" }
                        ),
                        serde_json::to_value(category),
                    ),
                }
            }
            "create_finance_service" => {
                let services =
                    crate::finance::finance_list_services(self.app.clone(), finance_context.clone())
                        .map_err(Self::finance_error)?;
                match finance_agent_inputs::build_service(
                    &call.arguments,
                    &dashboard.categories,
                    &services,
                )
                .map_err(rejected)?
                {
                    CreateOrExisting::Existing(service) => {
                        return Err(duplicate("el servicio", &service.id, &service.name))
                    }
                    CreateOrExisting::Create(service) => (
                        format!(
                            "Crear el servicio mensual {} por {} {}.",
                            service.name, service.expected_amount, service.currency
                        ),
                        serde_json::to_value(service),
                    ),
                }
            }
            "create_finance_transaction" => {
                let draft = self.transaction_draft(context, call, &finance_context, &dashboard)?.map_err(rejected)?;
                if let Some(existing) = self.existing_finance_transaction(&finance_context, &draft)? {
                    return Err(BackendError::invalid_input(format!(
                        "Ese movimiento ya fue registrado (id {}); no lo registres de nuevo.",
                        existing.id
                    )));
                }
                let transaction = &draft.transaction;
                let kind = match transaction.transaction_type.as_str() {
                    "income" => "ingreso",
                    "expense" => "gasto",
                    "transfer" => "transferencia",
                    _ => "ajuste",
                };
                let service = draft
                    .service
                    .as_ref()
                    .map(|service| format!(" (pago de {})", service.name))
                    .unwrap_or_default();
                (
                    format!(
                        "Registrar {kind} de {} {} en {}: {}{service}.",
                        transaction.amount,
                        transaction.currency,
                        account_name(&transaction.account_id),
                        transaction.description
                    ),
                    serde_json::to_value(transaction),
                )
            }
            "create_finance_purchase" => {
                let services =
                    crate::finance::finance_list_services(self.app.clone(), finance_context.clone())
                        .map_err(Self::finance_error)?;
                let purchase = finance_agent_inputs::build_purchase(
                    &call.arguments,
                    &dashboard.accounts,
                    &dashboard.categories,
                    &services,
                    &source_reference,
                    &utc_today(),
                )
                .map_err(rejected)?;
                (
                    format!(
                        "Guardar ticket de {}: {} producto(s), total {} {}, en {}.",
                        purchase.merchant_name,
                        purchase.items.len(),
                        purchase.total_amount,
                        purchase.currency,
                        account_name(&purchase.account_id)
                    ),
                    serde_json::to_value(purchase),
                )
            }
            "create_finance_salary" => {
                let salary = finance_agent_inputs::build_salary(
                    &call.arguments,
                    &dashboard.accounts,
                    &source_reference,
                )
                .map_err(rejected)?;
                (
                    format!(
                        "Guardar recibo de sueldo de {}, período {}, neto {} {}, en {}.",
                        salary.employer,
                        salary.period,
                        salary.net_amount,
                        salary.currency,
                        account_name(&salary.account_id)
                    ),
                    serde_json::to_value(salary),
                )
            }
            _ => {
                let statement = finance_agent_inputs::build_credit_card_statement(
                    &call.arguments,
                    &dashboard.accounts,
                    &source_reference,
                )
                .map_err(rejected)?;
                (
                    format!(
                        "Guardar resumen de {}, período {}, total {} {}, en {}.",
                        statement.issuer,
                        statement.period,
                        statement.total_due,
                        statement.currency,
                        account_name(&statement.account_id)
                    ),
                    serde_json::to_value(statement),
                )
            }
        };
        Ok(Some((summary, record.map_err(|_| invalid_result())?)))
    }

    /// Document and pre-mutation content of an undoable document tool.
    fn undo_target(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Option<(DocumentLocatorDto, Option<String>)>, BackendError> {
        let locator = match call.name.as_str() {
            "create_library_note" => return Ok(Some((Self::locator(context, &call.arguments)?, None))),
            "replace_library_document" | "delete_library_document" => {
                self.existing_document_locator(context, &call.arguments)?
            }
            "apply_markdown_edit" => {
                let preview = call.arguments.get("preview").unwrap_or(&call.arguments);
                let path = preview
                    .pointer("/locator/logicalPath")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if path.is_empty() {
                    return Ok(None);
                }
                DocumentLocatorDto::new(&context.library_id, path, None, None)?
            }
            _ => return Ok(None),
        };
        let previous = self.reader(&context.library_id)?.read_document(&locator)?;
        Ok(Some((locator, Some(previous.content))))
    }

    /// Records the undo entry after a successful document mutation. Large
    /// documents are skipped: the operation stays non-undoable.
    fn record_undo(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
        locator: &DocumentLocatorDto,
        previous_content: Option<String>,
    ) -> Result<(), BackendError> {
        if previous_content
            .as_ref()
            .is_some_and(|content| content.len() > MAX_UNDO_CONTENT_BYTES)
        {
            return Ok(());
        }
        let resulting = match self.reader(&context.library_id)?.read_document(locator) {
            Ok(document) => Some(document),
            Err(error) if error.code == BackendErrorCode::NotFound => None,
            Err(error) => return Err(error),
        };
        let logical_path = locator.logical_path.as_str().to_string();
        // The history is what the interface lists and diffs; a failure to
        // write it must not undo or hide an applied change.
        let _ = crate::agent_history::record(
            &self.app,
            context,
            &call.id,
            &logical_path,
            Self::history_summary(&call.name, &logical_path),
            previous_content.clone(),
            resulting.as_ref().map(|document| document.content.clone()),
        );
        self.journal.store_undo(
            context,
            &self.idempotency_key,
            &call.id,
            DocumentUndoEntry {
                logical_path,
                previous_content,
                resulting_revision: resulting.map(|document| document.revision),
            },
        )
    }

    fn history_summary(tool: &str, logical_path: &str) -> String {
        let action = match tool {
            "create_library_note" => "Creación de",
            "delete_library_document" => "Eliminación de",
            "export_document" => "Exportación a",
            _ => "Edición de",
        };
        format!("{action} {logical_path}")
    }

    /// Records a transaction requested by the agent, once per evidence
    /// reference, and marks the paid service month.
    fn create_finance_transaction(&self, context: &BackendRequestContext, call: &ToolCall) -> Result<Value, BackendError> {
        let finance_context = self.finance_context(context)?;
        let dashboard = self.finance_dashboard(&finance_context)?;
        let draft = match self.transaction_draft(context, call, &finance_context, &dashboard)? {
            Ok(draft) => draft,
            Err(error) => return Ok(error.to_value()),
        };
        if let Some(existing) = self.existing_finance_transaction(&finance_context, &draft)? {
            return Ok(json!({ "ok": true, "changed": false, "duplicate": true, "transaction": existing }));
        }
        let saved = match crate::finance::finance_save_transaction(
            self.app.clone(),
            crate::finance::SaveTransactionPayload {
                context: finance_context.clone(),
                transaction: draft.transaction.clone(),
            },
        )
        .map_err(Self::finance_error)
        {
            Ok(saved) => saved,
            // A storage error can arrive after the commit (for example while
            // syncing the Android copy): report success only if the record
            // is really there.
            Err(error) if error.code == BackendErrorCode::Storage => {
                match self.existing_finance_transaction(&finance_context, &draft) {
                    Ok(Some(saved)) => saved,
                    _ => return Err(error),
                }
            }
            Err(error) => return Err(error),
        };
        let Some(service) = draft.service else {
            return Ok(json!({ "ok": true, "changed": true, "transaction": saved }));
        };
        // The payment marks the service's month as paid; a failure is
        // reported so the user can fix the occurrence, never hidden.
        let occurrence = crate::finance::finance_save_service_occurrence(
            self.app.clone(),
            crate::finance::SaveFinanceServiceOccurrencePayload {
                context: finance_context,
                occurrence: crate::finance::FinanceServiceOccurrence {
                    id: uuid::Uuid::new_v4().to_string(),
                    service_id: service.id.clone(),
                    period: saved.effective_date[..7].to_string(),
                    expected_amount: service.expected_amount.clone(),
                    paid_amount: Some(saved.amount.clone()),
                    effective_date: Some(saved.effective_date.clone()),
                    status: "current".to_string(),
                    transaction_id: Some(saved.id.clone()),
                    artifact_id: None,
                    source_reference: saved.source_reference.clone(),
                    raw_source: saved.raw_source.clone(),
                    actor_library_user_id: saved.actor_library_user_id.clone(),
                    source: saved.source.clone(),
                    created_at: None,
                    updated_at: None,
                },
                reason: None,
            },
        );
        Ok(match occurrence {
            Ok(occurrence) => json!({ "ok": true, "changed": true, "transaction": saved, "occurrence": occurrence }),
            Err(error) => json!({
                "ok": false,
                "changed": true,
                "error": "finance-service-occurrence-save-failed",
                "message": "El gasto se guardó, pero no pudo asociarse a la ocurrencia del servicio. Revisá la ocurrencia antes de reintentar.",
                "transaction": saved,
                "occurrenceError": error.message,
            }),
        })
    }

    /// Transaction requested by the agent with its references resolved and
    /// the evidence reference that makes a retried call idempotent.
    fn transaction_draft(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
        finance_context: &crate::finance::FinanceContext,
        dashboard: &crate::finance::FinanceDashboard,
    ) -> Result<Result<finance_agent_inputs::TransactionDraft, finance_agent_inputs::AgentInputError>, BackendError> {
        let services = crate::finance::finance_list_services(self.app.clone(), finance_context.clone())
            .map_err(Self::finance_error)?;
        Ok(finance_agent_inputs::build_transaction(
            &call.arguments,
            &dashboard.accounts,
            &dashboard.categories,
            &services,
            &utc_today(),
            context.channel == notia_backend_core::BackendChannel::Telegram,
        )
        .map(|mut draft| {
            if draft.transaction.source_reference.is_none() {
                draft.transaction.source_reference = Some(Self::agent_source_reference(context, call));
            }
            draft.transaction.source = finance_context.source.clone();
            draft.transaction.actor_library_user_id = Some(context.actor.library_user_id.clone());
            draft
        }))
    }

    fn existing_finance_transaction(
        &self,
        finance_context: &crate::finance::FinanceContext,
        draft: &finance_agent_inputs::TransactionDraft,
    ) -> Result<Option<crate::finance::FinanceTransaction>, BackendError> {
        let Some(reference) = draft.transaction.source_reference.as_deref() else {
            return Ok(None);
        };
        let transactions = crate::finance::finance_list_all_transactions(self.app.clone(), finance_context.clone())
            .map_err(Self::finance_error)?;
        Ok(finance_agent_inputs::existing_transaction(&transactions, reference).cloned())
    }

    /// Stable evidence reference for a record created from chat without an
    /// attachment; retries of the same tool call reuse it.
    fn agent_source_reference(context: &BackendRequestContext, call: &ToolCall) -> String {
        format!("agent:{}:{}", context.request_id, call.id)
    }

    fn finance_error(error: crate::finance::FinanceCommandError) -> BackendError {
        let (code, retryable) = match error.code {
            "notFound" => (BackendErrorCode::NotFound, false),
            "conflict" => (BackendErrorCode::Conflict, false),
            "validation" => (BackendErrorCode::InvalidInput, false),
            _ => (BackendErrorCode::Storage, true),
        };
        BackendError::new(code, error.message, retryable)
    }

    fn append_agent_file(
        &self,
        context: &BackendRequestContext,
        kind: crate::agent_workspace::AgentItem,
        value: &str,
    ) -> Result<Value, BackendError> {
        if !context.persistence_policy.allows_memory() {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La política de esta superficie no permite persistir memoria del agente.",
                false,
            ));
        }
        if !context.actor.is_library_owner() {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "Solo el propietario puede modificar la memoria del agente.",
                false,
            ));
        }
        let changed = crate::agent_workspace::append_agent_item(&self.app, &context.library_id, kind, value)?;
        Ok(json!({ "changed": changed }))
    }

    fn document_mutation_preview(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Option<(DocumentLocatorDto, String, String, u64)>, BackendError> {
        if !matches!(
            call.name.as_str(),
            "create_library_note" | "replace_library_document" | "delete_library_document"
        ) {
            return Ok(None);
        }
        let locator = if call.name == "create_library_note" {
            Self::locator(context, &call.arguments)?
        } else {
            self.existing_document_locator(context, &call.arguments)?
        };
        let current = self.reader(&context.library_id)?.read_document(&locator);
        match call.name.as_str() {
            "create_library_note" => {
                match current {
                    Ok(existing) => {
                        return Err(BackendError::new(
                            BackendErrorCode::Conflict,
                            format!("El documento ya existe: {}", existing.locator.logical_path.as_str()),
                            true,
                        ));
                    }
                    Err(error) if error.code == BackendErrorCode::NotFound => {}
                    Err(error) => return Err(error),
                }
                Ok(Some((
                    locator,
                    String::new(),
                    Self::text(&call.arguments, "content"),
                    0,
                )))
            }
            "replace_library_document" => {
                let document = current?;
                Ok(Some((
                    locator,
                    document.content,
                    Self::text(&call.arguments, "content"),
                    document.revision,
                )))
            }
            "delete_library_document" => {
                let document = current?;
                Ok(Some((locator, document.content, String::new(), document.revision)))
            }
            _ => Ok(None),
        }
    }
}

impl ToolExecutor for TauriBackendToolExecutor {
    fn execute_confirmed(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
        decision: &notia_backend_core::ConfirmationDecision,
        preview: Option<&MutationPreview>,
    ) -> Result<ToolResult, BackendError> {
        if call.name == "request_user_confirmation" {
            return Ok(ToolResult {
                call_id: call.id.clone(),
                ok: true,
                changed: false,
                data: Some(json!({ "accepted": decision.accepted })),
                error: None,
                preview: None,
            });
        }
        let Some(preview) = preview else {
            return self.execute(context, call);
        };
        if matches!(
            call.name.as_str(),
            "replace_library_document" | "delete_library_document"
        ) {
            let mut call = call.clone();
            if let Some(document) = preview.documents.first() {
                if let Some(arguments) = call.arguments.as_object_mut() {
                    arguments.insert(
                        "expectedRevision".to_string(),
                        Value::String(document.expected_revision.to_string()),
                    );
                }
            }
            let _ = decision;
            return self.execute(context, &call);
        }
        if matches!(call.name.as_str(), "apply_markdown_edit" | "apply_multi_document_markdown_edit")
            && !decision.hunk_ids.is_empty()
        {
            let mut call = call.clone();
            if let Some(arguments) = call.arguments.as_object_mut() {
                arguments.insert(
                    "selectedHunkIds".to_string(),
                    serde_json::to_value(&decision.hunk_ids).map_err(|_| invalid_result())?,
                );
            }
            return self.execute(context, &call);
        }
        self.execute(context, call)
    }

    fn preview(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<Option<MutationPreview>, BackendError> {
        if call.name == "apply_markdown_edit" {
            let preview_value = call
                .arguments
                .get("preview")
                .cloned()
                .unwrap_or_else(|| call.arguments.clone());
            let preview = serde_json::from_value::<MarkdownEditPreview>(preview_value)
                .map_err(|_| BackendError::invalid_input("El preview Markdown no es válido."))?;
            return Ok(Some(MutationPreview {
                operation_id: call.id.clone(),
                summary: format!("Aplicar edición Markdown en {}", preview.locator.logical_path.as_str()),
                documents: vec![PreviewDocument {
                    path: preview.locator.logical_path.as_str().to_string(),
                    expected_revision: preview.expected_revision,
                    current_revision: preview.current_revision,
                }],
                hunks: preview
                    .hunks
                    .iter()
                    .map(|hunk| PreviewHunk {
                        id: hunk.id.clone(),
                        document_path: preview.locator.logical_path.as_str().to_string(),
                        start_line: hunk.anchor.start_line,
                        end_line: hunk.anchor.end_line,
                        old_text: hunk.old_text.clone(),
                        new_text: hunk.new_text.clone(),
                    })
                    .collect(),
                allowed_actions: vec![
                    MutationPreviewAction::ApplyAll,
                    MutationPreviewAction::ApplySelected,
                    MutationPreviewAction::Reject,
                    MutationPreviewAction::Cancel,
                ],
            }));
        }
        if call.name == "apply_multi_document_markdown_edit" {
            let preview = Self::multi_markdown_preview(call)?;
            return Ok(Some(MutationPreview {
                operation_id: call.id.clone(),
                summary: format!("Aplicar edición Markdown en {} documentos", preview.previews.len()),
                documents: preview
                    .previews
                    .iter()
                    .map(|document| PreviewDocument {
                        path: document.locator.logical_path.as_str().to_string(),
                        expected_revision: document.expected_revision,
                        current_revision: document.current_revision,
                    })
                    .collect(),
                hunks: preview
                    .previews
                    .iter()
                    .flat_map(|document| {
                        let path = document.locator.logical_path.as_str().to_string();
                        document.hunks.iter().map(move |hunk| PreviewHunk {
                            id: hunk.id.clone(),
                            document_path: path.clone(),
                            start_line: hunk.anchor.start_line,
                            end_line: hunk.anchor.end_line,
                            old_text: hunk.old_text.clone(),
                            new_text: hunk.new_text.clone(),
                        })
                    })
                    .collect(),
                allowed_actions: vec![
                    MutationPreviewAction::ApplyAll,
                    MutationPreviewAction::ApplySelected,
                    MutationPreviewAction::Reject,
                    MutationPreviewAction::Cancel,
                ],
            }));
        }
        if let Some((summary, record)) = self.finance_create_preview(context, call)? {
            return Ok(Some(MutationPreview {
                operation_id: call.id.clone(),
                summary,
                documents: Vec::new(),
                hunks: vec![PreviewHunk {
                    id: call.id.clone(),
                    document_path: format!("finance:{}", context.library_id),
                    start_line: 1,
                    end_line: 1,
                    old_text: String::new(),
                    new_text: serde_json::to_string_pretty(&record).map_err(|_| invalid_result())?,
                }],
                allowed_actions: vec![
                    MutationPreviewAction::ApplyAll,
                    MutationPreviewAction::Reject,
                    MutationPreviewAction::Cancel,
                ],
            }));
        }
        if call.name.starts_with("save_finance_")
            || call.name.starts_with("create_finance_")
            || matches!(
                call.name.as_str(),
                "set_finance_service_active"
                    | "link_finance_savings_account"
                    | "delete_finance_record"
                    | "reverse_finance_transaction"
                    | "update_finance_transaction_status"
                    | "clear_finance_data"
                    | "extract_finance_document"
                    | "apply_finance_audit_proposal"
            )
        {
            return Ok(Some(MutationPreview {
                operation_id: call.id.clone(),
                summary: format!("Guardar registro financiero: {}", call.name),
                documents: Vec::new(),
                hunks: vec![PreviewHunk {
                    id: call.id.clone(),
                    document_path: format!("finance:{}", context.library_id),
                    start_line: 1,
                    end_line: 1,
                    old_text: String::new(),
                    new_text: serde_json::to_string(&call.arguments)
                        .map_err(|_| invalid_result())?,
                }],
                allowed_actions: vec![
                    MutationPreviewAction::ApplyAll,
                    MutationPreviewAction::Reject,
                    MutationPreviewAction::Cancel,
                ],
            }));
        }
        if matches!(
            call.name.as_str(),
            "export_document"
                | "create_task_ticket"
                | "replace_task_content"
                | "add_task_comment"
                | "add_task_subtask"
                | "move_task_group"
                | "change_task_state"
                | "change_task_priority"
                | "update_task_fields"
                | "bulk_update_tasks"
                | "duplicate_task"
                | "archive_task"
                | "restore_task"
                | "create_task_group"
                | "delete_task_group"
        ) {
            return Ok(Some(MutationPreview {
                operation_id: call.id.clone(),
                summary: if call.name == "export_document" {
                    format!(
                        "Exportar {} a {}.",
                        Self::text(&call.arguments, "path"),
                        Self::text(&call.arguments, "format").to_uppercase()
                    )
                } else {
                    task_mutation_summary(&notia_backend_core::task_mutation_from_tool(
                        &call.name,
                        &call.arguments,
                        &mut || "preview".to_string(),
                        0,
                    )?)
                },
                documents: Vec::new(),
                hunks: vec![PreviewHunk {
                    id: call.id.clone(),
                    document_path: if call.name == "export_document" {
                        format!("export:{}", context.library_id)
                    } else {
                        format!("task-manager:{}", context.library_id)
                    },
                    start_line: 1,
                    end_line: 1,
                    old_text: String::new(),
                    new_text: serde_json::to_string(&call.arguments)
                        .map_err(|_| invalid_result())?,
                }],
                allowed_actions: vec![
                    MutationPreviewAction::ApplyAll,
                    MutationPreviewAction::Reject,
                    MutationPreviewAction::Cancel,
                ],
            }));
        }
        let Some((locator, old_content, new_content, revision)) =
            self.document_mutation_preview(context, call)?
        else {
            return Ok(None);
        };
        Ok(Some(MutationPreview {
            operation_id: call.id.clone(),
            summary: format!("Mutación documental: {}", call.name),
            documents: vec![PreviewDocument {
                path: locator.logical_path.as_str().to_string(),
                expected_revision: revision,
                current_revision: revision,
            }],
            hunks: vec![PreviewHunk {
                id: call.id.clone(),
                document_path: locator.logical_path.as_str().to_string(),
                start_line: 1,
                end_line: old_content.lines().count().max(1) as u32,
                old_text: old_content,
                new_text: new_content,
            }],
            allowed_actions: vec![
                MutationPreviewAction::ApplyAll,
                MutationPreviewAction::Reject,
                MutationPreviewAction::Cancel,
            ],
        }))
    }

    fn execute(
        &self,
        context: &BackendRequestContext,
        call: &ToolCall,
    ) -> Result<ToolResult, BackendError> {
        let reader = self.reader(&context.library_id)?;
        let undo_target = self.undo_target(context, call)?;
        let data = match call.name.as_str() {
            "search_web" => {
                let request = notia_backend_core::sanitize_web_search_request(
                    &Self::text(&call.arguments, "query"),
                    call.arguments.get("maxResults").and_then(Value::as_u64).map(|value| value as u32),
                    call.arguments.get("freshness").and_then(Value::as_str),
                    &call
                        .arguments
                        .get("domains")
                        .and_then(Value::as_array)
                        .map(|values| values.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
                        .unwrap_or_default(),
                )?;
                match self
                    .web_search_tracker
                    .lock()
                    .map_err(|_| internal_error("No se pudo proteger el límite de búsqueda web."))?
                    .reserve(&request)
                {
                    WebSearchReservation::Duplicate => {
                        return Err(BackendError::new(
                            BackendErrorCode::Conflict,
                            "La búsqueda web ya fue realizada en esta solicitud.",
                            false,
                        ));
                    }
                    WebSearchReservation::LimitReached => {
                        return Err(BackendError::new(
                            BackendErrorCode::Conflict,
                            "La solicitud alcanzó el límite de búsquedas web únicas.",
                            false,
                        ));
                    }
                    WebSearchReservation::New => {}
                }
                let settings = self
                    .app
                    .state::<BackendRuntimeState>()
                    .provider
                    .lock()
                    .map_err(|_| internal_error("No se pudo leer la configuración del proveedor backend."))?
                    .clone()
                    .ok_or_else(|| BackendError::new(BackendErrorCode::ProviderUnavailable, "El proveedor de búsqueda no está configurado.", true))?;
                let response = crate::backend_ollama::search_web(
                    &self.app,
                    &crate::services::ai_service::AiHttpSettings {
                        ollama_url: settings.ollama_url,
                        api_key: settings.api_key,
                    },
                    &request.query,
                    request.max_results,
                    &self.control,
                )
                .map_err(|error| match error.code {
                    BackendErrorCode::Cancelled | BackendErrorCode::Timeout | BackendErrorCode::InvalidInput => error,
                    _ => BackendError::new(BackendErrorCode::ProviderUnavailable, "El proveedor de búsqueda no está disponible.", true),
                })?;
                let results = response
                    .results
                    .into_iter()
                    .enumerate()
                    .map(|(index, result)| {
                        let source_name = result.source_name;
                        let url = result.url;
                        json!({
                            "rank": index + 1,
                            "title": result.title,
                            "url": url.clone(),
                            "snippet": result.snippet,
                            "sourceName": source_name.clone(),
                            "publishedAt": result.published_at,
                            "verification": "unverified",
                            "verificationScore": 0,
                            "citation": format!("[{}] {} — {}", index + 1, source_name, url),
                        })
                    })
                    .collect::<Vec<_>>();
                json!({
                    "ok": true,
                    "changed": false,
                    "searchedQuery": request.query,
                    "consistency": if results.len() < 2 { "insufficient" } else { "mixed" },
                    "results": results,
                })
            }
            "get_workspace_context" => serde_json::to_value(
                self.snapshot
                    .as_ref()
                    .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "El snapshot de workspace no está disponible.", false))?,
            )
            .map_err(|_| invalid_result())?,
            "read_library_documents" => {
                let ids = Self::ids(&call.arguments);
                let documents = if ids.is_empty() {
                    let paths = Self::paths(&call.arguments);
                    paths
                        .iter()
                        .map(|path| {
                            let locator = DocumentLocatorDto::new(
                                &context.library_id,
                                path,
                                None,
                                None,
                            )?;
                            reader.read_document(&locator)
                        })
                        .collect::<Result<Vec<DocumentContent>, BackendError>>()?
                } else {
                    reader.read_documents(&context.library_id, &ids)?
                };
                json!({ "documents": documents })
            }
            "search_library_documents" => {
                let page = reader.search_documents(&DocumentSearchRequest {
                    library_id: context.library_id.clone(),
                    query: Self::text(&call.arguments, "query"),
                    titles: Self::string_list(&call.arguments, "titles", 20),
                    tags: Self::string_list(&call.arguments, "tags", 12),
                    kind: match Self::text(&call.arguments, "type").as_str() {
                        "markdown" => Some(notia_backend_core::DocumentKind::Markdown),
                        "text" => Some(notia_backend_core::DocumentKind::Text),
                        _ => None,
                    },
                    offset: call.arguments.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize,
                    limit: Self::page_limit(&call.arguments, "limit", 20),
                })?;
                serde_json::to_value(page).map_err(|_| invalid_result())?
            }
            "search_library_context" => {
                let page = reader.search_context(&ContextSearchRequest {
                    library_id: context.library_id.clone(),
                    query: Self::text(&call.arguments, "query"),
                    document_ids: Self::ids(&call.arguments),
                    max_results: Self::page_limit(&call.arguments, "maxResults", 20),
                })?;
                serde_json::to_value(page).map_err(|_| invalid_result())?
            }
            "search_library_exact" => {
                let page = reader.search_exact(&ExactSearchRequest {
                    library_id: context.library_id.clone(),
                    query: Self::text(&call.arguments, "query"),
                    document_ids: Self::ids(&call.arguments),
                    case_sensitive: call
                        .arguments
                        .get("caseSensitive")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    max_results: Self::page_limit(&call.arguments, "maxResults", 20),
                })?;
                serde_json::to_value(page).map_err(|_| invalid_result())?
            }
            "get_document_metadata" => {
                let locator = self.existing_document_locator(context, &call.arguments)?;
                serde_json::to_value(reader.metadata(&locator)?).map_err(|_| invalid_result())?
            }
            "find_document_references" => {
                let locator = self.existing_document_locator(context, &call.arguments)?;
                let references = reader.references(
                    &locator,
                    Self::page_limit(&call.arguments, "maxResults", 50),
                )?;
                serde_json::to_value(references).map_err(|_| invalid_result())?
            }
            "compare_documents" => {
                let left_document_id = Self::text(&call.arguments, "leftDocumentId");
                let right_document_id = Self::text(&call.arguments, "rightDocumentId");
                if left_document_id.is_empty() || right_document_id.is_empty() {
                    return Err(BackendError::invalid_input(
                        "La comparación necesita dos documentId.",
                    ));
                }
                let comparison = reader.compare(&CompareDocumentsRequest {
                    library_id: context.library_id.clone(),
                    left_document_id,
                    right_document_id,
                })?;
                serde_json::to_value(comparison).map_err(|_| invalid_result())?
            }
            "preview_markdown_edit" => self.preview_markdown_tool(context, call)?,
            "apply_markdown_edit" => self.apply_markdown_tool(context, call)?,
            "apply_multi_document_markdown_edit" => self.apply_multi_markdown_tool(context, call)?,
            "reindex_changed_documents" => {
                let (indexed, generation) =
                    crate::library_inventory::reindex_library(&self.app, &context.library_id)?;
                json!({ "ok": true, "indexed": indexed, "generation": generation })
            }
            "preview_multi_document_markdown_edit" => {
                self.preview_multi_markdown_tool(context, call)?
            }
            "export_document" => {
                let format = match Self::text(&call.arguments, "format").to_ascii_lowercase().as_str() {
                    "pdf" => crate::backend::ExportFormat::Pdf,
                    "docx" => crate::backend::ExportFormat::Docx,
                    _ => return Err(BackendError::invalid_input("El formato de exportación no es válido.")),
                };
                let registry = self.app.state::<LibraryBindingRegistry>();
                let picker = self.app.state::<AndroidDirectoryPickerState>();
                let receipt = crate::filesystem::adapter::export_library_document(
                    registry.inner(),
                    picker.inner(),
                    &context.library_id,
                    &Self::text(&call.arguments, "path"),
                    format,
                )?;
                json!({
                    "destinationLogicalPath": receipt.destination_logical_path,
                    "byteLength": receipt.byte_length,
                    "contentFingerprint": receipt.content_fingerprint,
                })
            }
            "get_finance_dollar_quotes" => {
                let result = tauri::async_runtime::block_on(
                    crate::services::finance_external::dollar_quotes(),
                )
                .map_err(|message| BackendError::new(
                    BackendErrorCode::ProviderUnavailable,
                    message,
                    true,
                ))?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "get_finance_inflation_indices" => {
                let result = tauri::async_runtime::block_on(
                    crate::services::finance_external::inflation_indices(),
                )
                .map_err(|message| BackendError::new(
                    BackendErrorCode::ProviderUnavailable,
                    message,
                    true,
                ))?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "get_finance_historical_dollar_quotes" => {
                let from = Self::finance_date(&call.arguments, "from")?;
                let to = Self::finance_date(&call.arguments, "to")?;
                let result = tauri::async_runtime::block_on(
                    crate::services::finance_external::historical_dollar_quotes(
                        from.as_deref(),
                        to.as_deref(),
                    ),
                )
                .map_err(|message| BackendError::new(
                    BackendErrorCode::ProviderUnavailable,
                    message,
                    true,
                ))?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "extract_finance_document" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "artifactId": Self::text(&call.arguments, "artifactId"),
                    "filePath": Self::text(&call.arguments, "filePath"),
                    "documentType": Self::text(&call.arguments, "documentType"),
                });
                let payload = serde_json::from_value::<crate::services::finance_extraction::ExtractFinanceDocumentPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La extracción financiera no es válida."))?;
                let result = tauri::async_runtime::block_on(async {
                    tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        crate::services::finance_extraction::extract_finance_document(
                            self.app.clone(),
                            payload,
                        ),
                    )
                    .await
                    .map_err(|_| "La extracción financiera agotó el tiempo de espera.".to_string())?
                })
                .map_err(Self::finance_error)?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "get_finance_full_snapshot" => {
                let month = Self::finance_period(&call.arguments, "month", true)?
                    .ok_or_else(|| BackendError::invalid_input("El snapshot financiero necesita un mes."))?;
                let as_of = Self::optional_text(&call.arguments, "asOf")
                    .unwrap_or_else(|| format!("{month}-01"));
                let finance_context = self.finance_context(context)?;
                let dashboard = crate::finance::finance_get_dashboard(
                    self.app.clone(),
                    finance_context,
                    month.clone(),
                ).map_err(Self::finance_error)?;
                let all_movements = crate::finance::finance_list_all_transactions(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let all_savings_movements = crate::finance::finance_list_all_savings_movements(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let services = crate::finance::finance_list_services(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let service_occurrences = crate::finance::finance_list_all_service_occurrences(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let service_occurrence_versions = crate::finance::finance_list_all_service_occurrence_versions(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let service_invoices = crate::finance::finance_list_service_invoices(
                    self.app.clone(),
                    self.finance_context(context)?,
                    None,
                ).map_err(Self::finance_error)?;
                let purchases = crate::finance_records::finance_list_purchases(
                    self.app.clone(),
                    crate::finance_records::ListPeriodPayload {
                        context: self.finance_context(context)?,
                        from: None,
                        to: None,
                        merchant_id: None,
                        product_id: None,
                    },
                ).map_err(Self::finance_error)?;
                let salaries = crate::finance_records::finance_list_salaries(
                    self.app.clone(),
                    crate::finance_records::ListPeriodPayload {
                        context: self.finance_context(context)?,
                        from: None,
                        to: None,
                        merchant_id: None,
                        product_id: None,
                    },
                ).map_err(Self::finance_error)?;
                let statements = crate::finance_records::finance_list_credit_card_statements(
                    self.app.clone(),
                    crate::finance_records::ListPeriodPayload {
                        context: self.finance_context(context)?,
                        from: None,
                        to: None,
                        merchant_id: None,
                        product_id: None,
                    },
                ).map_err(Self::finance_error)?;
                let price_history = crate::finance_records::finance_list_price_history(
                    self.app.clone(),
                    crate::finance_records::ListPeriodPayload {
                        context: self.finance_context(context)?,
                        from: None,
                        to: None,
                        merchant_id: None,
                        product_id: None,
                    },
                ).map_err(Self::finance_error)?;
                let installment_plans = crate::finance_records::finance_list_installment_plans(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let installments = crate::finance_records::finance_list_installments(
                    self.app.clone(),
                    crate::finance_records::ListInstallmentsPayload {
                        context: self.finance_context(context)?,
                        plan_id: None,
                    },
                ).map_err(Self::finance_error)?;
                let investments = crate::finance_records::finance_list_investments(
                    self.app.clone(),
                    crate::finance_records::ListInvestmentsPayload {
                        context: self.finance_context(context)?,
                        active: None,
                    },
                ).map_err(Self::finance_error)?;
                let runs = crate::finance::finance_list_audit_runs(
                    self.app.clone(),
                    self.finance_context(context)?,
                    Some(month.clone()),
                    None,
                ).map_err(Self::finance_error)?;
                let proposals = crate::finance::finance_list_audit_proposals(
                    self.app.clone(),
                    self.finance_context(context)?,
                    Some(month.clone()),
                    None,
                ).map_err(Self::finance_error)?;
                let net_worth = crate::finance_records::finance_get_net_worth(
                    self.app.clone(),
                    self.finance_context(context)?,
                    as_of,
                ).map_err(Self::finance_error)?;
                let net_worth_history = crate::finance_records::finance_list_net_worth_history(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                let artifacts = crate::services::finance_extraction::list_finance_artifacts(
                    self.app.clone(),
                    self.finance_context(context)?,
                ).map_err(Self::finance_error)?;
                json!({
                    "ok": true,
                    "month": month,
                    "dashboard": dashboard,
                    "allMovements": all_movements,
                    "allSavingsMovements": all_savings_movements,
                    "services": services,
                    "serviceOccurrences": service_occurrences,
                    "serviceOccurrenceVersions": service_occurrence_versions,
                    "serviceInvoices": service_invoices,
                    "purchases": purchases,
                    "salaries": salaries,
                    "creditCardStatements": statements,
                    "priceHistory": price_history,
                    "installmentPlans": installment_plans,
                    "installments": installments,
                    "investments": investments,
                    "audits": { "runs": runs, "proposals": proposals },
                    "netWorth": net_worth,
                    "netWorthHistory": net_worth_history,
                    "artifacts": artifacts,
                })
            }
            "get_finance_dashboard" => {
                let month = Self::finance_period(&call.arguments, "month", true)?
                    .ok_or_else(|| BackendError::invalid_input("El dashboard financiero necesita un mes."))?;
                let result = crate::finance::finance_get_dashboard(
                    self.app.clone(),
                    self.finance_context(context)?,
                    month,
                )
                .map_err(Self::finance_error)?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "add_agent_memory" => self.append_agent_file(
                context,
                crate::agent_workspace::AgentItem::Memory,
                &Self::first_text(&call.arguments, "memory", "content"),
            )?,
            "add_agent_rule" => self.append_agent_file(
                context,
                crate::agent_workspace::AgentItem::Rule,
                &Self::text(&call.arguments, "rule"),
            )?,
            "get_finance_record" => {
                let entity = Self::text(&call.arguments, "entity");
                if !entity.is_empty() && entity != "movements" {
                    return Err(BackendError::invalid_input(
                        "El runtime Tauri solo admite registros financieros de tipo movements.",
                    ));
                }
                let result = crate::finance::finance_get_transaction(
                    self.app.clone(),
                    crate::finance::GetFinanceRecordPayload {
                        context: self.finance_context(context)?,
                        id: Self::finance_id(&call.arguments, "id")?,
                    },
                )
                .map_err(Self::finance_error)?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "list_finance_accounts" => serde_json::to_value(
                crate::finance::finance_list_accounts(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?,
            )
            .map_err(|_| invalid_result())?,
            "list_finance_categories" => serde_json::to_value(
                crate::finance::finance_list_categories(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?,
            )
            .map_err(|_| invalid_result())?,
            "search_finance_categories" => {
                let query = Self::text(&call.arguments, "query").to_lowercase();
                let categories = crate::finance::finance_list_categories(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?;
                serde_json::to_value(categories.into_iter().filter(|category| {
                    query.is_empty()
                        || category.name.to_lowercase().contains(&query)
                        || category
                            .description
                            .as_deref()
                            .is_some_and(|description| description.to_lowercase().contains(&query))
                }).collect::<Vec<_>>()).map_err(|_| invalid_result())?
            }
            "list_finance_movements" => {
                let month = Self::finance_period(&call.arguments, "month", true)?
                    .ok_or_else(|| BackendError::invalid_input("La lista de movimientos necesita un mes."))?;
                let result = crate::finance::finance_get_dashboard(
                    self.app.clone(),
                    self.finance_context(context)?,
                    month.clone(),
                )
                .map_err(Self::finance_error)?;
                json!({ "month": month, "movements": result.transactions })
            }
            "list_finance_records" => {
                let entity = Self::text(&call.arguments, "entity");
                let items = match entity.as_str() {
                    "accounts" | "categories" | "movements" => {
                        let month = Self::finance_period(&call.arguments, "month", true)?
                            .ok_or_else(|| BackendError::invalid_input("La consulta financiera necesita un mes."))?;
                        let dashboard = crate::finance::finance_get_dashboard(
                            self.app.clone(),
                            self.finance_context(context)?,
                            month,
                        )
                        .map_err(Self::finance_error)?;
                        match entity.as_str() {
                            "accounts" => serde_json::to_value(dashboard.accounts),
                            "categories" => serde_json::to_value(dashboard.categories),
                            _ => serde_json::to_value(dashboard.transactions),
                        }
                    }
                    "services" => serde_json::to_value(crate::finance::finance_list_services(
                        self.app.clone(),
                        self.finance_context(context)?,
                    ).map_err(Self::finance_error)?),
                    "service_occurrences" => {
                        if let Some(period) = Self::finance_period(&call.arguments, "period", false)? {
                            serde_json::to_value(crate::finance::finance_list_service_occurrences(
                                self.app.clone(),
                                self.finance_context(context)?,
                                period,
                            ).map_err(Self::finance_error)?)
                        } else {
                            serde_json::to_value(crate::finance::finance_list_all_service_occurrences(
                                self.app.clone(),
                                self.finance_context(context)?,
                            ).map_err(Self::finance_error)?)
                        }
                    }
                    "service_invoices" => serde_json::to_value(crate::finance::finance_list_service_invoices(
                        self.app.clone(),
                        self.finance_context(context)?,
                        Self::finance_period(&call.arguments, "period", false)?,
                    ).map_err(Self::finance_error)?),
                    _ => return Err(BackendError::invalid_input("La entidad financiera no está disponible en el backend.")),
                }
                .map_err(|_| invalid_result())?;
                let items = items.as_array().cloned().unwrap_or_default();
                let offset = call.arguments.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
                let limit = Self::page_limit(&call.arguments, "limit", 50);
                let total = items.len();
                json!({
                    "ok": true,
                    "entity": entity,
                    "items": items.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),
                    "total": total,
                    "offset": offset,
                    "limit": limit,
                    "hasMore": offset.saturating_add(limit) < total,
                })
            }
            "list_finance_services" => {
                let result = crate::finance::finance_list_services(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?;
                json!({ "services": result })
            }
            "list_finance_service_occurrences" => {
                let period = Self::finance_period(&call.arguments, "period", true)?
                    .ok_or_else(|| BackendError::invalid_input("La lista de ocurrencias necesita un período."))?;
                let result = crate::finance::finance_list_service_occurrences(
                    self.app.clone(),
                    self.finance_context(context)?,
                    period.clone(),
                )
                .map_err(Self::finance_error)?;
                json!({ "period": period, "occurrences": result })
            }
            "list_finance_service_invoices" => {
                let period = Self::finance_period(&call.arguments, "period", false)?;
                let result = crate::finance::finance_list_service_invoices(
                    self.app.clone(),
                    self.finance_context(context)?,
                    period.clone(),
                )
                .map_err(Self::finance_error)?;
                json!({ "period": period, "invoices": result })
            }
            "list_finance_artifacts" => serde_json::to_value(
                crate::services::finance_extraction::list_finance_artifacts(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?,
            )
            .map_err(|_| invalid_result())?,
            "list_finance_audits" => {
                let period = Self::finance_period(&call.arguments, "period", false)?;
                let status = Some(Self::text(&call.arguments, "status")).filter(|value| !value.is_empty());
                let proposal_type = Self::optional_text(&call.arguments, "proposalType");
                let finance_context = self.finance_context(context)?;
                let runs = crate::finance::finance_list_audit_runs(
                    self.app.clone(),
                    finance_context,
                    period.clone(),
                    status.clone(),
                )
                .map_err(Self::finance_error)?;
                let proposals = crate::finance::finance_list_audit_proposals(
                    self.app.clone(),
                    self.finance_context(context)?,
                    period,
                    status,
                )
                .map_err(Self::finance_error)?;
                let proposals = proposals.into_iter().filter(|proposal| {
                    proposal_type.as_deref().is_none_or(|kind| proposal.proposal_type == kind)
                }).collect::<Vec<_>>();
                json!({ "runs": runs, "proposals": proposals })
            }
            "audit_finance_month" => {
                let period = Self::finance_period(&call.arguments, "period", true)?
                    .ok_or_else(|| BackendError::invalid_input("La auditoría necesita un período."))?;
                let reason = Self::optional_text(&call.arguments, "reason");
                let trigger_fingerprint = format!(
                    "backend-audit:{}:{}",
                    period,
                    reason.as_deref().unwrap_or("manual")
                );
                let result = crate::finance::finance_run_audit(
                    self.app.clone(),
                    crate::finance::RunFinanceAuditPayload {
                        context: self.finance_context(context)?,
                        period,
                        trigger_fingerprint,
                        reason,
                    },
                ).map_err(Self::finance_error)?;
                serde_json::to_value(result).map_err(|_| invalid_result())?
            }
            "preview_finance_audit_proposal" => {
                let proposal_id = Self::text(&call.arguments, "proposalId");
                if proposal_id.is_empty() {
                    return Err(BackendError::invalid_input("El preview necesita proposalId."));
                }
                let proposals = crate::finance::finance_list_audit_proposals(
                    self.app.clone(),
                    self.finance_context(context)?,
                    None,
                    None,
                ).map_err(Self::finance_error)?;
                let proposal = proposals.into_iter().find(|proposal| proposal.id == proposal_id)
                    .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La propuesta de auditoría no existe.", true))?;
                if let Some(expected_type) = Self::optional_text(&call.arguments, "proposalType") {
                    if proposal.proposal_type != expected_type {
                        return Err(BackendError::invalid_input("El tipo de propuesta no coincide."));
                    }
                }
                if proposal.status != "pending" {
                    return Err(BackendError::new(
                        BackendErrorCode::Conflict,
                        "La propuesta de auditoría ya no está pendiente.",
                        true,
                    ));
                }
                let current_data = serde_json::from_str::<Value>(&proposal.current_data)
                    .unwrap_or_else(|_| Value::String(proposal.current_data.clone()));
                let suggested_change = serde_json::from_str::<Value>(&proposal.suggested_change)
                    .unwrap_or_else(|_| Value::String(proposal.suggested_change.clone()));
                let proposal_type = proposal.proposal_type.clone();
                let period = proposal.period.clone();
                let service_id = proposal.service_id.clone();
                let reason = proposal.reason.clone();
                let evidence = proposal.evidence.clone();
                let data_fingerprint = proposal.data_fingerprint.clone();
                json!({
                    "ok": true,
                    "changed": false,
                    "proposalType": proposal_type.clone(),
                    "period": period.clone(),
                    "proposal": proposal,
                    "preview": {
                        "proposalType": proposal_type.clone(),
                        "period": period.clone(),
                        "serviceId": service_id,
                        "reason": reason,
                        "evidence": evidence,
                        "dataFingerprint": data_fingerprint.clone(),
                        "currentData": current_data,
                        "suggestedChange": suggested_change,
                    },
                    "expectedDataFingerprint": data_fingerprint,
                })
            }
            "apply_finance_audit_proposal" => {
                let proposal_id = Self::text(&call.arguments, "proposalId");
                let expected_data_fingerprint = Self::optional_text(&call.arguments, "expectedDataFingerprint");
                let decision = Self::text(&call.arguments, "decision");
                if proposal_id.is_empty() || expected_data_fingerprint.is_none() || decision.is_empty() {
                    return Err(BackendError::invalid_input("La decisión necesita propuesta, huella y decisión."));
                }
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "proposalId": proposal_id,
                    "decision": decision,
                    "expectedDataFingerprint": expected_data_fingerprint,
                    "resolutionAssignments": call.arguments.get("resolutionAssignments").cloned(),
                });
                let payload = serde_json::from_value::<crate::finance::DecideFinanceAuditProposalPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La decisión de auditoría no es válida."))?;
                crate::finance::finance_decide_audit_proposal(self.app.clone(), payload)
                    .map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true })
            }
            "get_finance_net_worth" => {
                let as_of = Self::text(&call.arguments, "asOf");
                if as_of.is_empty() {
                    return Err(BackendError::invalid_input("El patrimonio necesita una fecha."));
                }
                serde_json::to_value(crate::finance_records::finance_get_net_worth(
                    self.app.clone(),
                    self.finance_context(context)?,
                    as_of,
                ).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "list_finance_net_worth_history" => serde_json::to_value(
                crate::finance_records::finance_list_net_worth_history(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?,
            ).map_err(|_| invalid_result())?,
            "list_finance_installment_plans" => serde_json::to_value(
                crate::finance_records::finance_list_installment_plans(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?,
            ).map_err(|_| invalid_result())?,
            "list_finance_installments" => {
                let plan_id = call
                    .arguments
                    .get("planId")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                serde_json::to_value(crate::finance_records::finance_list_installments(
                    self.app.clone(),
                    crate::finance_records::ListInstallmentsPayload {
                        context: self.finance_context(context)?,
                        plan_id,
                    },
                ).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "list_finance_investments" => {
                serde_json::to_value(crate::finance_records::finance_list_investments(
                    self.app.clone(),
                    crate::finance_records::ListInvestmentsPayload {
                        context: self.finance_context(context)?,
                        active: call.arguments.get("active").and_then(Value::as_bool),
                    },
                ).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "list_finance_purchases" | "list_finance_salaries" | "list_finance_price_history"
            | "list_finance_credit_card_statements" => {
                let payload = crate::finance_records::ListPeriodPayload {
                    context: self.finance_context(context)?,
                    from: Self::optional_text(&call.arguments, "from"),
                    to: Self::optional_text(&call.arguments, "to"),
                    merchant_id: Self::optional_text(&call.arguments, "merchantId"),
                    product_id: Self::optional_text(&call.arguments, "productId"),
                };
                let result = match call.name.as_str() {
                    "list_finance_purchases" => serde_json::to_value(
                        crate::finance_records::finance_list_purchases(self.app.clone(), payload)
                            .map_err(Self::finance_error)?,
                    ),
                    "list_finance_salaries" => serde_json::to_value(
                        crate::finance_records::finance_list_salaries(self.app.clone(), payload)
                            .map_err(Self::finance_error)?,
                    ),
                    "list_finance_price_history" => serde_json::to_value(
                        crate::finance_records::finance_list_price_history(self.app.clone(), payload)
                            .map_err(Self::finance_error)?,
                    ),
                    "list_finance_credit_card_statements" => serde_json::to_value(
                        crate::finance_records::finance_list_credit_card_statements(
                            self.app.clone(),
                            payload,
                        )
                        .map_err(Self::finance_error)?,
                    ),
                    _ => unreachable!("finance list tool was checked above"),
                };
                result.map_err(|_| invalid_result())?
            }
            "save_finance_account" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "account": record });
                let payload = serde_json::from_value::<crate::finance::SaveAccountPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La cuenta financiera no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_account(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_category" => {
                let finance_context = self.finance_context(context)?;
                let dashboard = self.finance_dashboard(&finance_context)?;
                match finance_agent_inputs::build_category(&call.arguments, &dashboard.categories) {
                    Err(error) => error.to_value(),
                    Ok(finance_agent_inputs::CreateOrExisting::Existing(category)) => {
                        json!({ "ok": true, "changed": false, "duplicate": true, "category": category })
                    }
                    Ok(finance_agent_inputs::CreateOrExisting::Create(category)) => {
                        let saved = crate::finance::finance_save_category(
                            self.app.clone(),
                            crate::finance::SaveCategoryPayload { context: finance_context, category },
                        )
                        .map_err(Self::finance_error)?;
                        json!({ "ok": true, "changed": true, "category": saved })
                    }
                }
            }
            "save_finance_category" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "category": record });
                let payload = serde_json::from_value::<crate::finance::SaveCategoryPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La categoría financiera no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_category(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_transaction" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "transaction": record });
                let payload = serde_json::from_value::<crate::finance::SaveTransactionPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El movimiento financiero no es válido."))?;
                serde_json::to_value(crate::finance::finance_save_transaction(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_transaction" => self.create_finance_transaction(context, call)?,
            "create_finance_service" => {
                let finance_context = self.finance_context(context)?;
                let dashboard = self.finance_dashboard(&finance_context)?;
                let services = crate::finance::finance_list_services(self.app.clone(), finance_context.clone())
                    .map_err(Self::finance_error)?;
                match finance_agent_inputs::build_service(&call.arguments, &dashboard.categories, &services) {
                    Err(error) => error.to_value(),
                    Ok(finance_agent_inputs::CreateOrExisting::Existing(service)) => {
                        json!({ "ok": true, "changed": false, "duplicate": true, "service": service })
                    }
                    Ok(finance_agent_inputs::CreateOrExisting::Create(service)) => {
                        let saved = crate::finance::finance_save_service(
                            self.app.clone(),
                            crate::finance::SaveFinanceServicePayload { context: finance_context, service },
                        )
                        .map_err(Self::finance_error)?;
                        json!({ "ok": true, "changed": true, "service": saved })
                    }
                }
            }
            "save_finance_service" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "service": record });
                let payload = serde_json::from_value::<crate::finance::SaveFinanceServicePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El servicio financiero no es válido."))?;
                serde_json::to_value(crate::finance::finance_save_service(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_service_occurrence" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "occurrence": {
                        "id": uuid::Uuid::new_v4().to_string(),
                        "serviceId": Self::text(&call.arguments, "serviceId"),
                        "period": Self::text(&call.arguments, "period"),
                        "expectedAmount": Self::text(&call.arguments, "expectedAmount"),
                        "paidAmount": Self::optional_text(&call.arguments, "paidAmount"),
                        "effectiveDate": Self::optional_text(&call.arguments, "effectiveDate"),
                        "status": if Self::text(&call.arguments, "status") == "accepted" {
                            "accepted"
                        } else if Self::optional_text(&call.arguments, "paidAmount").is_some() {
                            "current"
                        } else {
                            "pending"
                        },
                        "transactionId": Self::optional_text(&call.arguments, "transactionId"),
                        "artifactId": Self::optional_text(&call.arguments, "artifactId"),
                        "sourceReference": Self::optional_text(&call.arguments, "sourceReference"),
                        "rawSource": Self::optional_text(&call.arguments, "rawSource"),
                        "actorLibraryUserId": context.actor.library_user_id.clone(),
                        "source": "backend",
                        "createdAt": Value::Null,
                        "updatedAt": Value::Null,
                    },
                    "reason": Self::optional_text(&call.arguments, "reason"),
                });
                let payload = serde_json::from_value::<crate::finance::SaveFinanceServiceOccurrencePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La ocurrencia financiera no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_service_occurrence(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_service_occurrence" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "occurrence": record });
                let payload = serde_json::from_value::<crate::finance::SaveFinanceServiceOccurrencePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La ocurrencia financiera no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_service_occurrence(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_service_invoice" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "invoice": {
                        "id": uuid::Uuid::new_v4().to_string(),
                        "serviceId": Self::optional_text(&call.arguments, "serviceId"),
                        "period": Self::text(&call.arguments, "period"),
                        "dueDate": Self::optional_text(&call.arguments, "dueDate"),
                        "provider": Self::optional_text(&call.arguments, "provider"),
                        "amount": Self::text(&call.arguments, "amount"),
                        "currency": Self::text(&call.arguments, "currency"),
                        "transactionId": Self::optional_text(&call.arguments, "transactionId"),
                        "artifactId": Self::optional_text(&call.arguments, "artifactId"),
                        "validationStatus": "pending",
                        "sourceReference": Self::optional_text(&call.arguments, "sourceReference"),
                        "rawExtraction": Self::optional_text(&call.arguments, "rawExtraction"),
                        "createdAt": Value::Null,
                        "updatedAt": Value::Null,
                    },
                });
                let payload = serde_json::from_value::<crate::finance::SaveFinanceServiceInvoicePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La factura financiera no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_service_invoice(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_service_invoice" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "invoice": record });
                let payload = serde_json::from_value::<crate::finance::SaveFinanceServiceInvoicePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La factura financiera no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_service_invoice(self.app.clone(), payload).map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "set_finance_service_active" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "id": Self::text(&call.arguments, "serviceId"),
                    "active": call.arguments.get("active").and_then(Value::as_bool).unwrap_or(false),
                });
                let payload = serde_json::from_value::<crate::finance::SetFinanceServiceActivePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El estado del servicio financiero no es válido."))?;
                crate::finance::finance_set_service_active(self.app.clone(), payload)
                    .map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true })
            }
            "link_finance_savings_account" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "reserveId": Self::text(&call.arguments, "reserveId"),
                    "accountId": Self::text(&call.arguments, "accountId"),
                });
                let payload = serde_json::from_value::<crate::finance::LinkSavingsAccountPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El vínculo de ahorro no es válido."))?;
                crate::finance::finance_link_savings_account(self.app.clone(), payload)
                    .map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true })
            }
            "delete_finance_record" => {
                let entity = Self::text(&call.arguments, "entity");
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "id": Self::text(&call.arguments, "id"),
                });
                let payload = serde_json::from_value::<crate::finance::DeleteFinanceEntityPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El registro financiero no es válido."))?;
                match entity.as_str() {
                    "transaction" => crate::finance::finance_delete_transaction(self.app.clone(), payload),
                    "account" => crate::finance::finance_delete_account(self.app.clone(), payload),
                    "category" => crate::finance::finance_delete_category(self.app.clone(), payload),
                    _ => return Err(BackendError::invalid_input("La entidad financiera no se puede eliminar.")),
                }
                .map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true, "entity": entity })
            }
            "clear_finance_data" => {
                crate::finance::finance_clear_all_data(
                    self.app.clone(),
                    self.finance_context(context)?,
                )
                .map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true, "scope": "all-finance-data" })
            }
            "reverse_finance_transaction" => {
                let id = Self::text(&call.arguments, "transactionId");
                let reason = Self::text(&call.arguments, "reason");
                if id.is_empty() || reason.is_empty() {
                    return Err(BackendError::invalid_input("La reversión necesita movimiento y motivo."));
                }
                let context_for_read = self.finance_context(context)?;
                let mut transaction = crate::finance::finance_get_transaction(
                    self.app.clone(),
                    crate::finance::GetFinanceRecordPayload {
                        context: context_for_read.clone(),
                        id: id.clone(),
                    },
                ).map_err(Self::finance_error)?;
                transaction.status = "discarded".to_string();
                let saved = crate::finance::finance_save_transaction(
                    self.app.clone(),
                    crate::finance::SaveTransactionPayload {
                        context: context_for_read,
                        transaction,
                    },
                ).map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true, "transactionId": id, "reason": reason, "record": saved })
            }
            "update_finance_transaction_status" => {
                let id = Self::text(&call.arguments, "transactionId");
                let status = Self::text(&call.arguments, "status");
                if id.is_empty() || status.is_empty() {
                    return Err(BackendError::invalid_input("La actualización necesita movimiento y estado."));
                }
                let finance_context = self.finance_context(context)?;
                let mut transaction = crate::finance::finance_get_transaction(
                    self.app.clone(),
                    crate::finance::GetFinanceRecordPayload {
                        context: finance_context.clone(),
                        id: id.clone(),
                    },
                ).map_err(Self::finance_error)?;
                transaction.status = status.clone();
                let saved = crate::finance::finance_save_transaction(
                    self.app.clone(),
                    crate::finance::SaveTransactionPayload {
                        context: finance_context,
                        transaction,
                    },
                ).map_err(Self::finance_error)?;
                json!({ "ok": true, "changed": true, "transactionId": id, "status": status, "record": saved })
            }
            "save_finance_savings_reserve" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "reserve": record });
                let payload = serde_json::from_value::<crate::finance::SaveSavingsReservePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La reserva de ahorro no es válida."))?;
                serde_json::to_value(crate::finance::finance_save_savings_reserve(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_savings_movement" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "movement": {
                        "id": uuid::Uuid::new_v4().to_string(),
                        "reserveId": Self::text(&call.arguments, "reserveId"),
                        "accountId": Self::optional_text(&call.arguments, "accountId"),
                        "movementType": Self::text(&call.arguments, "movementType"),
                        "amount": Self::text(&call.arguments, "amount"),
                        "currency": Self::text(&call.arguments, "currency"),
                        "effectiveDate": Self::text(&call.arguments, "effectiveDate"),
                        "description": Self::text(&call.arguments, "description"),
                        "reason": Self::optional_text(&call.arguments, "reason"),
                        "source": "backend",
                        "status": "confirmed",
                        "actorUserId": Value::Null,
                        "actorLibraryUserId": context.actor.library_user_id.clone(),
                        "linkedTransactionId": Self::optional_text(&call.arguments, "linkedTransactionId"),
                    },
                });
                let payload = serde_json::from_value::<crate::finance::SaveSavingsMovementPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El movimiento de ahorro no es válido."))?;
                serde_json::to_value(crate::finance::finance_save_savings_movement(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_savings_movement" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "movement": record });
                let payload = serde_json::from_value::<crate::finance::SaveSavingsMovementPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El movimiento de ahorro no es válido."))?;
                serde_json::to_value(crate::finance::finance_save_savings_movement(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_savings_exchange" => {
                let payload = serde_json::json!({
                    "context": self.finance_context(context)?,
                    "exchange": {
                        "id": uuid::Uuid::new_v4().to_string(),
                        "reserveId": Self::first_text(&call.arguments, "reserveId", "reserve"),
                        "sourceAccountId": Self::first_text(&call.arguments, "sourceAccountId", "sourceAccount"),
                        "sourceAmount": Self::text(&call.arguments, "sourceAmount"),
                        "sourceCurrency": Self::text(&call.arguments, "sourceCurrency"),
                        "savingsAmount": Self::text(&call.arguments, "savingsAmount"),
                        "savingsCurrency": Self::text(&call.arguments, "savingsCurrency"),
                        "effectiveDate": Self::text(&call.arguments, "effectiveDate"),
                        "description": Self::text(&call.arguments, "description"),
                        "actorUserId": Value::Null,
                        "sourceReference": Self::optional_text(&call.arguments, "sourceReference"),
                        "rawSource": Self::optional_text(&call.arguments, "rawSource"),
                    },
                });
                let payload = serde_json::from_value::<crate::finance::SaveSavingsExchangePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El intercambio de ahorro no es válido."))?;
                serde_json::to_value(crate::finance::finance_save_savings_exchange(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_savings_exchange" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "exchange": record });
                let payload = serde_json::from_value::<crate::finance::SaveSavingsExchangePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El intercambio de ahorro no es válido."))?;
                serde_json::to_value(crate::finance::finance_save_savings_exchange(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_purchase" => {
                let finance_context = self.finance_context(context)?;
                let dashboard = self.finance_dashboard(&finance_context)?;
                let services = crate::finance::finance_list_services(self.app.clone(), finance_context.clone())
                    .map_err(Self::finance_error)?;
                match finance_agent_inputs::build_purchase(
                    &call.arguments,
                    &dashboard.accounts,
                    &dashboard.categories,
                    &services,
                    &Self::agent_source_reference(context, call),
                    &utc_today(),
                ) {
                    Err(error) => error.to_value(),
                    Ok(purchase) => {
                        let saved = crate::finance_records::finance_save_purchase(
                            self.app.clone(),
                            crate::finance_records::SavePurchasePayload { context: finance_context, purchase },
                        )
                        .map_err(Self::finance_error)?;
                        json!({ "ok": true, "changed": true, "purchase": saved })
                    }
                }
            }
            "save_finance_purchase" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "purchase": record });
                let payload = serde_json::from_value::<crate::finance_records::SavePurchasePayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La compra financiera no es válida."))?;
                serde_json::to_value(crate::finance_records::finance_save_purchase(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_salary" => {
                let finance_context = self.finance_context(context)?;
                let dashboard = self.finance_dashboard(&finance_context)?;
                match finance_agent_inputs::build_salary(
                    &call.arguments,
                    &dashboard.accounts,
                    &Self::agent_source_reference(context, call),
                ) {
                    Err(error) => error.to_value(),
                    Ok(salary) => {
                        let saved = crate::finance_records::finance_save_salary(
                            self.app.clone(),
                            crate::finance_records::SaveSalaryPayload { context: finance_context, salary },
                        )
                        .map_err(Self::finance_error)?;
                        json!({ "ok": true, "changed": true, "salary": saved })
                    }
                }
            }
            "save_finance_salary" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "salary": record });
                let payload = serde_json::from_value::<crate::finance_records::SaveSalaryPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El sueldo financiero no es válido."))?;
                serde_json::to_value(crate::finance_records::finance_save_salary(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "create_finance_credit_card_statement" => {
                let finance_context = self.finance_context(context)?;
                let dashboard = self.finance_dashboard(&finance_context)?;
                match finance_agent_inputs::build_credit_card_statement(
                    &call.arguments,
                    &dashboard.accounts,
                    &Self::agent_source_reference(context, call),
                ) {
                    Err(error) => error.to_value(),
                    Ok(statement) => {
                        let saved = crate::finance_records::finance_save_credit_card_statement(
                            self.app.clone(),
                            crate::finance_records::SaveCreditCardStatementPayload { context: finance_context, statement },
                        )
                        .map_err(Self::finance_error)?;
                        json!({ "ok": true, "changed": true, "statement": saved })
                    }
                }
            }
            "save_finance_credit_card_statement" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "statement": record });
                let payload = serde_json::from_value::<crate::finance_records::SaveCreditCardStatementPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El resumen de tarjeta no es válido."))?;
                serde_json::to_value(crate::finance_records::finance_save_credit_card_statement(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_installment_plan" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "plan": record });
                let payload = serde_json::from_value::<crate::finance_records::SaveInstallmentPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("El plan de cuotas no es válido."))?;
                serde_json::to_value(crate::finance_records::finance_save_installment_plan(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "save_finance_investment" => {
                let record = Self::finance_record(&call.arguments);
                let payload = serde_json::json!({ "context": self.finance_context(context)?, "investment": record });
                let payload = serde_json::from_value::<crate::finance_records::SaveInvestmentPayload>(payload)
                    .map_err(|_| BackendError::invalid_input("La inversión no es válida."))?;
                serde_json::to_value(crate::finance_records::finance_save_investment(self.app.clone(), payload)
                    .map_err(Self::finance_error)?).map_err(|_| invalid_result())?
            }
            "read_active_markdown_document" => {
                // The active document comes from the request snapshot; an
                // explicit path is only accepted when it is that document.
                let active_path = self
                    .snapshot
                    .as_ref()
                    .and_then(|snapshot| snapshot.active_document.as_ref())
                    .map(|document| document.path.clone())
                    .ok_or_else(|| {
                        BackendError::invalid_input("No hay un documento activo en esta vista.")
                    })?;
                if Self::explicit_path(&call.arguments)
                    .is_some_and(|requested| requested != active_path)
                {
                    return Err(BackendError::new(
                        BackendErrorCode::Forbidden,
                        "Solo se puede leer el documento activo con esta herramienta.",
                        false,
                    ));
                }
                let locator = DocumentLocatorDto::new(&context.library_id, &active_path, None, None)?;
                serde_json::to_value(reader.read_document(&locator)?).map_err(|_| invalid_result())?
            }
            "create_library_note" => {
                let locator = Self::locator(context, &call.arguments)?;
                let content = Self::text(&call.arguments, "content");
                if content.is_empty() {
                    return Err(BackendError::invalid_input(
                        "La creación documental necesita contenido.",
                    ));
                }
                let registry = self.app.state::<LibraryBindingRegistry>();
                let picker = self.app.state::<AndroidDirectoryPickerState>();
                let adapter = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
                    registry.inner(),
                    &context.library_id,
                    picker.inner(),
                )?;
                adapter.create_text_locator(&locator, &content)?;
                json!({ "path": locator.logical_path.as_str(), "created": true })
            }
            "replace_library_document" => {
                let locator = self.existing_document_locator(context, &call.arguments)?;
                let content = Self::text(&call.arguments, "content");
                // Tools report backend-core revisions (numbers); the editor
                // may still send the platform `sha256:` form.
                let expected = call.arguments.get("expectedRevision");
                let core_revision = expected.and_then(|value| {
                    value
                        .as_u64()
                        .or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
                });
                let platform_revision = expected
                    .and_then(Value::as_str)
                    .filter(|text| text.starts_with("sha256:"));
                let registry = self.app.state::<LibraryBindingRegistry>();
                let picker = self.app.state::<AndroidDirectoryPickerState>();
                let adapter = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
                    registry.inner(),
                    &context.library_id,
                    picker.inner(),
                )?;
                match core_revision {
                    Some(revision) => adapter.write_locator_at_revision(&locator, &content, revision)?,
                    None => adapter.write_locator(&locator, &content, platform_revision)?,
                }
                json!({ "path": locator.logical_path.as_str(), "updated": true })
            }
            "delete_library_document" => {
                let locator = self.existing_document_locator(context, &call.arguments)?;
                let registry = self.app.state::<LibraryBindingRegistry>();
                let picker = self.app.state::<AndroidDirectoryPickerState>();
                let adapter = crate::filesystem::adapter::TauriFilesystemDocumentAdapter::for_library(
                    registry.inner(),
                    &context.library_id,
                    picker.inner(),
                )?;
                adapter.delete_locator(&locator)?;
                json!({ "path": locator.logical_path.as_str(), "deleted": true })
            }
            "search_task_tickets"
            | "read_task_tickets"
            | "read_all_task_tickets"
            | "search_task_context"
            | "get_task_manager_options"
            | "get_task_board_summary" => {
                let task_state = self.app.state::<crate::task_manager_commands::TaskManagerBackendState>();
                let registry = self.app.state::<LibraryBindingRegistry>();
                crate::task_manager_commands::execute_backend_read_tool(
                    &self.app,
                    task_state.inner(),
                    registry.inner(),
                    &context.library_id,
                    &context.actor.library_user_id,
                    call.name.as_str(),
                    &call.arguments,
                )?
            }
            "create_task_ticket"
            | "replace_task_content"
            | "add_task_comment"
            | "add_task_subtask"
            | "move_task_group"
            | "change_task_state"
            | "change_task_priority"
            | "update_task_fields"
            | "bulk_update_tasks"
            | "duplicate_task"
            | "archive_task"
            | "restore_task"
            | "create_task_group"
            | "delete_task_group" => {
                let task_state = self.app.state::<crate::task_manager_commands::TaskManagerBackendState>();
                let registry = self.app.state::<LibraryBindingRegistry>();
                crate::task_manager_commands::execute_backend_mutation_tool(
                    &self.app,
                    task_state.inner(),
                    registry.inner(),
                    &context.library_id,
                    &context.actor.library_user_id,
                    &call.id,
                    call.name.as_str(),
                    &call.arguments,
                )?
            }
            _ => {
                return Err(BackendError::new(
                    BackendErrorCode::Unsupported,
                    "La tool todavía no tiene un adaptador backend disponible.",
                    false,
                ))
            }
        };
        if let Some((locator, previous_content)) = undo_target {
            if data.get("changed").and_then(Value::as_bool) != Some(false) {
                self.record_undo(context, call, &locator, previous_content)?;
            }
        }
        // A mutating tool reports its real outcome; validation errors,
        // duplicates and declines must not be counted as changes.
        let reported_changed = data.get("changed").and_then(Value::as_bool);
        let reported_ok = data.get("ok").and_then(Value::as_bool).unwrap_or(true);
        Ok(ToolResult {
            call_id: call.id.clone(),
            ok: reported_ok,
            changed: reported_changed.unwrap_or(reported_ok) && matches!(
                call.name.as_str(),
                "create_library_note"
                    | "replace_library_document"
                    | "delete_library_document"
                    | "export_document"
                    | "apply_markdown_edit"
                    | "apply_multi_document_markdown_edit"
                    | "add_agent_memory"
                    | "add_agent_rule"
                    | "save_finance_account"
                    | "save_finance_category"
                    | "save_finance_transaction"
                    | "create_finance_transaction"
                    | "save_finance_service"
                    | "save_finance_service_occurrence"
                    | "save_finance_service_invoice"
                    | "create_finance_service"
                    | "create_finance_service_occurrence"
                    | "create_finance_service_invoice"
                    | "set_finance_service_active"
                    | "link_finance_savings_account"
                    | "delete_finance_record"
                    | "reverse_finance_transaction"
                    | "update_finance_transaction_status"
                    | "clear_finance_data"
                    | "extract_finance_document"
                    | "save_finance_savings_reserve"
                    | "create_finance_savings_movement"
                    | "save_finance_savings_movement"
                    | "create_finance_savings_exchange"
                    | "save_finance_savings_exchange"
                    | "save_finance_purchase"
                    | "create_finance_purchase"
                    | "save_finance_salary"
                    | "create_finance_salary"
                    | "save_finance_credit_card_statement"
                    | "create_finance_credit_card_statement"
                    | "save_finance_installment_plan"
                    | "save_finance_investment"
                    | "audit_finance_month"
                    | "apply_finance_audit_proposal"
                    | "create_task_ticket"
                    | "replace_task_content"
                    | "add_task_comment"
                    | "add_task_subtask"
                    | "move_task_group"
                    | "change_task_state"
                    | "change_task_priority"
                    | "update_task_fields"
                    | "bulk_update_tasks"
                    | "duplicate_task"
                    | "archive_task"
                    | "restore_task"
                    | "create_task_group"
                    | "delete_task_group"
            ),
            data: Some(data),
            error: None,
            preview: None,
        })
    }
}

#[tauri::command]
pub(crate) fn configure_backend_provider(
    payload: ConfigureBackendProviderPayload,
    state: State<'_, BackendRuntimeState>,
) -> Result<(), BackendError> {
    let ollama_url = payload.ollama_url.trim();
    let model = payload.model.trim();
    if ollama_url.is_empty() || model.is_empty() {
        return Err(BackendError::invalid_input(
            "La configuración del proveedor backend es incompleta.",
        ));
    }
    if !(ollama_url.starts_with("http://") || ollama_url.starts_with("https://")) {
        return Err(BackendError::invalid_input("La URL de Ollama no es válida."));
    }
    if payload.api_key.chars().count() > 4096 {
        return Err(BackendError::invalid_input("La credencial del proveedor supera el límite permitido."));
    }
    *state
        .provider
        .lock()
        .map_err(|_| internal_error("No se pudo configurar el proveedor backend."))? =
        Some(BackendProviderSettings {
            ollama_url: ollama_url.to_string(),
            model: model.to_string(),
            api_key: payload.api_key,
            think: payload.think,
        });
    Ok(())
}

/// Replays the events of one request after `afterSequence`. The caller must
/// be an authorized user of the library that owns the stream.
#[tauri::command]
pub(crate) fn replay_backend_events(
    app: AppHandle,
    payload: ReplayBackendEventsPayload,
    state: State<'_, BackendRuntimeState>,
    registry: State<'_, LibraryBindingRegistry>,
) -> Result<Vec<notia_backend_core::BackendEventEnvelope>, BackendError> {
    for (field, value) in [
        ("requestId", &payload.request_id),
        ("libraryId", &payload.library_id),
        ("libraryUserId", &payload.library_user_id),
    ] {
        if value.trim().is_empty() || value.chars().count() > 512 || value.chars().any(char::is_control) {
            return Err(BackendError::invalid_input(format!("{field} no es válido.")));
        }
    }
    backend_authorization_principal(
        &app,
        registry.inner(),
        &payload.library_id,
        &payload.library_user_id,
    )?;
    state.events.replay_since(
        &EventStreamKey::from_parts(
            &payload.library_id,
            &payload.library_user_id,
            &payload.request_id,
        ),
        payload.after_sequence,
    )
}

/// Executes a backend request on a blocking worker. The agent loop performs
/// network and filesystem I/O for minutes; running it on the command thread
/// would block the WebView and every concurrent cancel/status/replay call.
/// The run is owned by the backend: hiding, reloading or destroying the
/// WebView does not cancel it, and a client re-attaches by request identity.
#[tauri::command]
pub(crate) async fn run_backend_request(
    app: AppHandle,
    envelope: BackendRequestEnvelope,
) -> Result<BackendResponseEnvelope, BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BackendRuntimeState>().inner().clone();
        let registry = app.state::<LibraryBindingRegistry>();
        execute_backend_request(&app, envelope, &state, registry.inner())
    })
    .await
    .map_err(|_| internal_error("El worker del runtime backend terminó de forma inesperada."))?
}

pub(crate) fn execute_backend_request(
    app: &AppHandle,
    envelope: BackendRequestEnvelope,
    state: &BackendRuntimeState,
    registry: &LibraryBindingRegistry,
) -> Result<BackendResponseEnvelope, BackendError> {
    envelope.protocol_version.validate()?;
    envelope.request.validate(&BackendLimits::default())?;
    let protocol_version = envelope.protocol_version;
    let mut resume_decision: Option<(String, ResumeDecision)> = None;
    let mut request = match envelope.request {
        BackendRequest::Run(request) => request,
        BackendRequest::Resume(resume) => {
            backend_authorization_principal(
                app,
                registry,
                &resume.context.library_id,
                &resume.context.actor.library_user_id,
            )?;
            state
                .journal
                .hydrate_record(app, registry, &resume.context, &resume.idempotency_key)?;
            let response = state.interactions(None).handle_resume(&resume)?;
            let should_continue = matches!(
                &response,
                BackendResponse::Resumed { status, .. }
                    if matches!(status.state, notia_backend_core::OperationState::Running)
            );
            if !should_continue {
                state.journal.clear_continuation(
                    &resume.context,
                    &resume.idempotency_key,
                    &resume.operation.operation_id,
                )?;
                state
                    .journal
                    .persist_record(app, registry, &resume.context, &resume.idempotency_key)?;
                return Ok(BackendResponseEnvelope {
                    protocol_version,
                    response,
                });
            }
            resume_decision = Some((resume.operation.operation_id.clone(), resume.decision.clone()));
            state
                .journal
                .load_request(&resume.context, &resume.idempotency_key)?
        }
        other => {
            let (context, idempotency_key) = request_identity(&other);
            backend_authorization_principal(
                app,
                registry,
                &context.library_id,
                &context.actor.library_user_id,
            )?;
            state
                .journal
                .hydrate_record(app, registry, context, idempotency_key)?;
            if let BackendRequest::GetOperation(status) = &other {
                if status.operation.is_none() {
                    if let Some(response) = state.journal.load_response(context, idempotency_key)? {
                        return Ok(BackendResponseEnvelope {
                            protocol_version,
                            response: BackendResponse::Result { response },
                        });
                    }
                }
            }
            let review_port = TauriOperationReviewPort {
                app: app.clone(),
                journal: Arc::clone(&state.journal),
            };
            let response = InteractionRuntime::new(
                state.journal.as_ref(),
                Some(&review_port),
                None,
                state.generations.as_ref(),
            )
            .with_control_registry(Arc::clone(&state.controls))
            .handle_request(&other, &BackendLimits::default())?
                .ok_or_else(|| unsupported("La operación backend no pudo ser procesada."))?;
            state
                .journal
                .persist_record(app, registry, context, idempotency_key)?;
            return Ok(BackendResponseEnvelope {
                protocol_version,
                response,
            });
        }
    };
    let principal = backend_authorization_principal(
        app,
        registry,
        &request.context.library_id,
        &request.context.actor.library_user_id,
    )?;
    let requested_tool_names = request
        .tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
    let available_tool_names = TauriBackendToolExecutor::supported_tool_names();
    let requested_tool_names = if requested_tool_names.is_empty() {
        available_tool_names
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>()
    } else {
        requested_tool_names
            .into_iter()
            .filter(|name| available_tool_names.iter().any(|available| *available == name))
            .collect::<Vec<_>>()
    };
    state
        .journal
        .hydrate_record(app, registry, &request.context, &request.idempotency_key)?;
    request.tools = project_canonical_tool_catalog(
        &request.context,
        &principal,
        &requested_tool_names,
        ToolCatalogProjection::Full,
    )?;
    state.journal.store_request(&request)?;
    let provider_settings = state
        .provider
        .lock()
        .map_err(|_| internal_error("No se pudo leer la configuración del proveedor backend."))?
        .clone()
        .ok_or_else(|| BackendError::new(BackendErrorCode::ProviderUnavailable, "El proveedor backend no está configurado.", true))?;
    let provider = OllamaAgentProvider::with_transport(
        OllamaProviderConfig::new(
            crate::services::ai_service::AiHttpSettings {
                ollama_url: provider_settings.ollama_url,
                api_key: provider_settings.api_key,
            },
            provider_settings.model,
            provider_settings.think,
        )?,
        platform_ollama_transport(app),
    );
    let mut options = AgentRuntimeOptions::default();
    options.projection = if matches!(request.context.persistence_policy, PersistencePolicy::PublishedNoMemory)
    {
        ToolCatalogProjection::PublishedTaskManager
    } else if matches!(request.context.scope, BackendScope::Graph) {
        ToolCatalogProjection::ReadOnly
    } else {
        ToolCatalogProjection::Full
    };
    let visible_tools = notia_backend_core::project_tool_catalog(
        &request.context,
        &principal,
        &request.tools,
        options.projection,
    )?;
    let provider = AuthoritativePromptProvider {
        inner: &provider,
        system_prompt: compose_request_system_prompt(app, &request, &visible_tools)?,
    };
    let control = RequestControl::new(Some(std::time::Duration::from_secs(600)));
    let executor = TauriBackendToolExecutor {
        app: app.clone(),
        snapshot: request.snapshot.clone(),
        web_search_tracker: Mutex::new(WebSearchTracker::default()),
        control: control.clone(),
        journal: Arc::clone(&state.journal),
        idempotency_key: request.idempotency_key.clone(),
    };
    let revisions = TauriRevisionPort { app: app.clone() };
    let interactions = state.interactions(Some(&revisions));
    let sink = TauriBackendEventSink::for_request(app.clone(), Arc::clone(&state.events), &request.context);
    let result = if let Some((operation_id, decision)) = resume_decision {
        interactions.register_control(&request.context, control.clone())?;
        interactions
            .run_agent_with_resume(
                &provider,
                &executor,
                state.journal.as_ref(),
                &sink,
                &request,
                &principal,
                &control,
                &options,
                &operation_id,
                decision,
            )
            .map(|result| match result {
                notia_backend_core::AgentRunResult::Completed(response) => {
                    BackendResponse::Result { response }
                }
                notia_backend_core::AgentRunResult::Waiting(status) => {
                    BackendResponse::Operation { status }
                }
            })
    } else {
        interactions.run_agent_request(
            &provider,
            &executor,
            state.journal.as_ref(),
            &sink,
            &request,
            &principal,
            &control,
            &options,
        )
    };
    // A waiting run keeps no active control: a later cancel targets the
    // stored interaction instead of a worker that already returned.
    let _ = interactions.unregister_control(&request.context);
    state
        .journal
        .persist_record(app, registry, &request.context, &request.idempotency_key)?;
    let response = result?;
    Ok(BackendResponseEnvelope {
        protocol_version,
        response,
    })
}

/// Provider settings from the `ia` section of a library configuration.
fn provider_settings_from_config(config: &Value) -> Result<BackendProviderSettings, BackendError> {
    let ia = config.get("ia").cloned().unwrap_or(Value::Null);
    let text = |key: &str| ia.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let (ollama_url, model) = (text("ollamaUrl"), text("selectedModel"));
    if ollama_url.is_empty() || model.is_empty() {
        return Err(BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "Configurá la URL de Ollama y el modelo en Configuración.",
            false,
        ));
    }
    let think = if ia.get("thinkingEnabled").and_then(Value::as_bool) != Some(false) {
        Value::String(ia.get("thinkingLevel").and_then(Value::as_str).unwrap_or("medium").to_string())
    } else {
        Value::Bool(false)
    };
    Ok(BackendProviderSettings { ollama_url, model, api_key: text("apiKey"), think })
}

/// One completion without tools for a background task of the library
/// (titles, memories), with the library's saved AI settings.
pub(crate) fn complete_text(app: &AppHandle, library_id: &str, system: &str, user: &str) -> Result<String, BackendError> {
    let config = crate::library_config::read_library_config(app, library_id)?.unwrap_or(Value::Null);
    let settings = provider_settings_from_config(&config)?;
    let provider = OllamaAgentProvider::with_transport(
        OllamaProviderConfig::new(
            crate::services::ai_service::AiHttpSettings { ollama_url: settings.ollama_url, api_key: settings.api_key },
            settings.model,
            Value::Bool(false),
        )?,
        platform_ollama_transport(app),
    );
    let message = |role, content: &str| notia_backend_core::ProviderMessage {
        role,
        content: content.to_string(),
        images: Vec::new(),
        tool_calls: Vec::new(),
        tool_name: None,
    };
    let request = notia_backend_core::ProviderRequest {
        context: BackendRequestContext {
            request_id: uuid::Uuid::new_v4().simple().to_string(),
            library_id: library_id.to_string(),
            actor: notia_backend_core::BackendActor { library_user_id: "user-owner".to_string(), external_identity: None },
            channel: notia_backend_core::BackendChannel::App,
            scope: BackendScope::Library,
            persistence_policy: PersistencePolicy::EphemeralNoMemory,
        },
        messages: vec![
            message(notia_backend_core::ProviderMessageRole::System, system),
            message(notia_backend_core::ProviderMessageRole::User, user),
        ],
        tools: Vec::new(),
    };
    let control = RequestControl::new(Some(std::time::Duration::from_secs(180)));
    use notia_backend_core::AgentProvider as _;
    Ok(provider.chat(&request, &control)?.message.content)
}

fn internal_error(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, message, true)
}

/// User-facing name of a serde enum value (e.g. `Pendiente`).
fn serde_label(value: &impl Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Human-readable confirmation text for a Task Manager mutation.
fn task_mutation_summary(mutation: &notia_backend_core::TaskMutationDto) -> String {
    use notia_backend_core::TaskMutationDto as Mutation;
    match mutation {
        Mutation::CreateTicket { title, .. } => format!("Crear el ticket «{title}»."),
        Mutation::ReplaceTicketContent { ticket_id, .. } => {
            format!("Reemplazar el contenido del ticket {ticket_id}.")
        }
        Mutation::AddComment { ticket_id, body, .. } => {
            format!("Comentar en el ticket {ticket_id}: «{body}».")
        }
        Mutation::AddSubtask {
            parent_ticket_id,
            title,
            ..
        } => format!("Crear la subtarea «{title}» en el ticket {parent_ticket_id}."),
        Mutation::MoveTicket { ticket_id, group_id } => match group_id {
            Some(group_id) => format!("Mover el ticket {ticket_id} al grupo {group_id}."),
            None => format!("Quitar el grupo del ticket {ticket_id}."),
        },
        Mutation::ChangeState { ticket_id, state } => {
            format!("Cambiar el estado del ticket {ticket_id} a {}.", serde_label(state))
        }
        Mutation::ChangePriority {
            ticket_id,
            priority,
        } => format!("Cambiar la prioridad del ticket {ticket_id} a {}.", serde_label(priority)),
        Mutation::UpdateTicket { ticket_id, .. } => format!("Actualizar campos del ticket {ticket_id}."),
        Mutation::BulkUpdate { ticket_ids, .. } => {
            format!("Actualizar {} tickets con los mismos campos.", ticket_ids.len())
        }
        Mutation::DuplicateTicket { ticket_id, .. } => format!("Duplicar el ticket {ticket_id}."),
        Mutation::ArchiveTicket { ticket_id } => format!("Archivar el ticket {ticket_id}."),
        Mutation::RestoreTicket { ticket_id } => format!("Restaurar el ticket {ticket_id}."),
        Mutation::CreateGroup { name, color, .. } => {
            format!("Crear el grupo «{name}» con color {color}.")
        }
        Mutation::DeleteGroup { group_id, .. } => format!("Eliminar el grupo {group_id}."),
        other => format!("Aplicar la mutación de Task Manager {other:?}."),
    }
}

/// Current UTC date as `YYYY-MM-DD`.
fn utc_today() -> String {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();
    crate::task_manager_store::format_iso_timestamp(now_ms)[..10].to_string()
}

fn storage_error(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Storage, message, true)
}

fn invalid_result() -> BackendError {
    BackendError::new(
        BackendErrorCode::Internal,
        "El backend no pudo serializar el resultado de la tool.",
        true,
    )
}

fn unsupported(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Unsupported, message, false)
}

fn request_identity(request: &BackendRequest) -> (&BackendRequestContext, &str) {
    match request {
        BackendRequest::Run(request) => (&request.context, &request.idempotency_key),
        BackendRequest::Resume(request) => (&request.context, &request.idempotency_key),
        BackendRequest::Cancel(request) => (&request.context, &request.idempotency_key),
        BackendRequest::GetOperation(request) => (&request.context, &request.idempotency_key),
        BackendRequest::Review(request) => (&request.context, &request.idempotency_key),
        BackendRequest::Undo(request) => (&request.context, &request.idempotency_key),
    }
}

#[cfg(test)]
mod tests {
    use super::TauriBackendToolExecutor;

    /// A supported tool missing from the canonical catalog makes every run
    /// fail during projection; one without an argument schema is unusable
    /// by the model.
    #[test]
    fn every_supported_tool_is_in_the_catalog_with_an_argument_schema() {
        let catalog = notia_backend_core::canonical_tool_catalog();
        for name in TauriBackendToolExecutor::supported_tool_names() {
            let tool = catalog
                .iter()
                .find(|tool| tool.name == *name)
                .unwrap_or_else(|| panic!("tool missing from catalog: {name}"));
            assert!(
                tool.input_schema["properties"].is_object(),
                "tool without argument schema: {name}"
            );
        }
    }
}
