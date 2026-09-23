//! Tauri-independent contracts and deterministic implementations for library tools.
//!
//! The adapters that know how to open a desktop path or an Android SAF document
//! belong outside this module. The core only accepts a logical path and keeps
//! the tree grant separate from the resolved document URI.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};

use serde::{Deserialize, Serialize};

use super::context::BackendScope;
use super::error::{BackendError, BackendErrorCode};
use super::protocol::ToolDefinition;

pub const MAX_LOGICAL_PATH_CHARS: usize = 4096;
pub const MAX_PATH_SEGMENT_CHARS: usize = 255;
pub const MAX_INVENTORY_ITEMS: usize = 500;
pub const MAX_SEARCH_RESULTS: usize = 50;
pub const MAX_READ_DOCUMENTS: usize = 20;
pub const MAX_DOCUMENT_CHARS: usize = 500_000;
/// Reading a document for display may include persisted image attachments.
/// Writes and agent mutations keep the smaller limit above, while the larger
/// read-only bound prevents an attachment from making an otherwise valid chat
/// impossible to open without allowing an unbounded allocation.
pub const MAX_READ_DOCUMENT_CHARS: usize = 16 * 1024 * 1024;
/// Chat transcripts under `chat/chats/` persist their image attachments as
/// Base64, so writing them uses the read bound: otherwise a chat with one
/// photo could be opened but never saved again.
pub const CHAT_HISTORY_PREFIX: &str = "chat/chats/";

/// Largest document the backend writes at `logical_path`: the read bound for
/// chat transcripts, `MAX_DOCUMENT_CHARS` for everything else.
pub fn max_write_document_chars(logical_path: &str) -> usize {
    let is_chat_transcript = logical_path.starts_with(CHAT_HISTORY_PREFIX)
        && logical_path.to_ascii_lowercase().ends_with(".md");
    if is_chat_transcript {
        MAX_READ_DOCUMENT_CHARS
    } else {
        MAX_DOCUMENT_CHARS
    }
}
pub const MAX_COMPARE_LINES: usize = 100;
pub const MAX_REFERENCE_RESULTS: usize = 50;
pub const MAX_SEARCH_CANDIDATES: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LogicalPathDto(String);

impl LogicalPathDto {
    pub fn new(path: &str) -> Result<Self, BackendError> {
        let path = path.trim();
        if path.is_empty()
            || path.chars().count() > MAX_LOGICAL_PATH_CHARS
            || path.starts_with('/')
            || path.starts_with('\\')
            || path.contains('\\')
            || path.contains("://")
            || path.chars().any(char::is_control)
            || is_windows_drive_path(path)
        {
            return Err(invalid_path());
        }

        if path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.chars().count() > MAX_PATH_SEGMENT_CHARS
                || segment.contains(':')
        }) {
            return Err(invalid_path());
        }

        Ok(Self(path.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<&str> for LogicalPathDto {
    type Error = BackendError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl TryFrom<String> for LogicalPathDto {
    type Error = BackendError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(&value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AndroidTreeUriDto(String);

impl AndroidTreeUriDto {
    pub fn new(uri: &str) -> Result<Self, BackendError> {
        validate_android_uri(uri, "/tree/", false)?;
        let tree_id = uri
            .split_once("/tree/")
            .map(|(_, value)| value)
            .unwrap_or_default();
        if tree_id.is_empty() || tree_id.contains('/') {
            return Err(invalid_uri());
        }
        Ok(Self(uri.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<&str> for AndroidTreeUriDto {
    type Error = BackendError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AndroidDocumentUriDto(String);

impl AndroidDocumentUriDto {
    pub fn new(uri: &str) -> Result<Self, BackendError> {
        validate_android_uri(uri, "/document/", true)?;
        let document_id = uri
            .split_once("/document/")
            .map(|(_, value)| value)
            .unwrap_or_default();
        if document_id.is_empty() || document_id.contains('/') {
            return Err(invalid_uri());
        }
        Ok(Self(uri.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns whether both opaque URIs address the same SAF authority.
    ///
    /// Tree/document containment cannot be inferred safely by string prefix:
    /// Android encodes document IDs and a descendant document URI does not
    /// repeat the tree URI. The SAF adapter must verify containment through
    /// `DocumentsContract` before opening the document.
    pub fn has_same_authority(&self, tree: &AndroidTreeUriDto) -> bool {
        uri_authority(&self.0) == uri_authority(tree.as_str())
    }
}

impl TryFrom<&str> for AndroidDocumentUriDto {
    type Error = BackendError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

/// A document identity used by every library port. The three location fields
/// are intentionally distinct: logical paths are not filesystem paths and a
/// tree URI is never a file document URI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLocatorDto {
    pub library_id: String,
    pub logical_path: LogicalPathDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub android_tree_uri: Option<AndroidTreeUriDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub android_document_uri: Option<AndroidDocumentUriDto>,
}

impl DocumentLocatorDto {
    pub fn new(
        library_id: &str,
        logical_path: &str,
        android_tree_uri: Option<&str>,
        android_document_uri: Option<&str>,
    ) -> Result<Self, BackendError> {
        let locator = Self {
            library_id: non_empty_identifier("libraryId", library_id)?,
            logical_path: LogicalPathDto::new(logical_path)?,
            android_tree_uri: android_tree_uri.map(AndroidTreeUriDto::new).transpose()?,
            android_document_uri: android_document_uri
                .map(AndroidDocumentUriDto::new)
                .transpose()?,
        };
        locator.validate()?;
        Ok(locator)
    }

    pub fn validate(&self) -> Result<(), BackendError> {
        non_empty_identifier("libraryId", &self.library_id)?;
        LogicalPathDto::new(self.logical_path.as_str())?;
        if let (Some(tree), Some(document)) = (&self.android_tree_uri, &self.android_document_uri) {
            if !document.has_same_authority(tree) {
                return Err(scope_error(
                    "El documento Android no pertenece a la autoridad de la biblioteca.",
                ));
            }
        }
        Ok(())
    }

    pub fn path(&self) -> &str {
        self.logical_path.as_str()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDescriptorDto {
    pub library_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub android_tree_uri: Option<AndroidTreeUriDto>,
}

impl LibraryDescriptorDto {
    pub fn new(library_id: &str, android_tree_uri: Option<&str>) -> Result<Self, BackendError> {
        Ok(Self {
            library_id: non_empty_identifier("libraryId", library_id)?,
            android_tree_uri: android_tree_uri.map(AndroidTreeUriDto::new).transpose()?,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Markdown,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeedDocument {
    pub document_id: String,
    pub locator: DocumentLocatorDto,
    pub title: String,
    pub kind: DocumentKind,
    pub content: String,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchRequest {
    pub library_id: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub titles: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub kind: Option<DocumentKind>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExactSearchRequest {
    pub library_id: String,
    pub query: String,
    #[serde(default)]
    pub document_ids: Vec<String>,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "default_search_limit")]
    pub max_results: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSearchRequest {
    pub library_id: String,
    pub query: String,
    #[serde(default)]
    pub document_ids: Vec<String>,
    #[serde(default = "default_search_limit")]
    pub max_results: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryRequest {
    pub library_id: String,
    #[serde(default)]
    pub prefix: Option<LogicalPathDto>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_inventory_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSearchHit {
    pub document_id: String,
    pub title: String,
    pub logical_path: LogicalPathDto,
    pub kind: DocumentKind,
    pub score: u32,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFragment {
    pub document_id: String,
    pub title: String,
    pub logical_path: LogicalPathDto,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub score: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedPage<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentContent {
    pub document_id: String,
    pub locator: DocumentLocatorDto,
    pub content: String,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    pub document_id: String,
    pub locator: DocumentLocatorDto,
    pub title: String,
    pub kind: DocumentKind,
    pub size_chars: usize,
    pub modified_at: Option<i64>,
    pub revision: u64,
    pub tags: Vec<String>,
    pub frontmatter: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceMatch {
    pub document_id: String,
    pub title: String,
    pub logical_path: LogicalPathDto,
    pub line: usize,
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReferences {
    pub document_id: String,
    pub outgoing: Vec<ReferenceMatch>,
    pub incoming: Vec<ReferenceMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDocumentsRequest {
    pub library_id: String,
    pub left_document_id: String,
    pub right_document_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineDifference {
    pub line: usize,
    pub left: Option<String>,
    pub right: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentComparison {
    pub left_document_id: String,
    pub right_document_id: String,
    pub same: bool,
    pub differences: Vec<LineDifference>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexRequest {
    pub library_id: String,
    #[serde(default)]
    pub document_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexResult {
    pub generation: u64,
    pub document_ids: Vec<String>,
    pub paths: Vec<LogicalPathDto>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewReplaceRequest {
    pub operation_id: String,
    pub locator: DocumentLocatorDto,
    pub replacement: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWritePreview {
    pub operation_id: String,
    pub document_id: String,
    pub locator: DocumentLocatorDto,
    pub expected_revision: u64,
    pub current_revision: u64,
    pub old_content: String,
    pub new_content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtomicWriteRequest {
    pub operation_id: String,
    pub locator: DocumentLocatorDto,
    pub content: String,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    pub operation_id: String,
    pub document_id: String,
    pub revision: u64,
    pub recovered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryState {
    Applied,
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionCheck {
    pub document_id: String,
    pub expected_revision: u64,
    pub current_revision: u64,
    pub matches: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevisionRequest {
    pub locator: DocumentLocatorDto,
    pub expected_revision: u64,
}

pub trait LibraryDocumentReadPort: Send + Sync {
    fn search_documents(
        &self,
        request: &DocumentSearchRequest,
    ) -> Result<BoundedPage<DocumentSearchHit>, BackendError>;
    fn search_context(
        &self,
        request: &ContextSearchRequest,
    ) -> Result<BoundedPage<SearchFragment>, BackendError>;
    fn search_exact(
        &self,
        request: &ExactSearchRequest,
    ) -> Result<BoundedPage<SearchFragment>, BackendError>;
    fn read_document(&self, locator: &DocumentLocatorDto) -> Result<DocumentContent, BackendError>;
    fn read_documents(
        &self,
        library_id: &str,
        document_ids: &[String],
    ) -> Result<Vec<DocumentContent>, BackendError>;
    fn metadata(&self, locator: &DocumentLocatorDto) -> Result<DocumentMetadata, BackendError>;
    fn references(
        &self,
        locator: &DocumentLocatorDto,
        max_results: usize,
    ) -> Result<DocumentReferences, BackendError>;
    fn compare(
        &self,
        request: &CompareDocumentsRequest,
    ) -> Result<DocumentComparison, BackendError>;
    fn inventory(
        &self,
        request: &InventoryRequest,
    ) -> Result<BoundedPage<DocumentMetadata>, BackendError>;
}

pub trait LibraryIndexPort: Send + Sync {
    fn reindex(&self, request: &ReindexRequest) -> Result<ReindexResult, BackendError>;
    fn index_cache_len(&self) -> usize;
}

pub trait DocumentRevisionPort: Send + Sync {
    fn check_revision(&self, request: &RevisionRequest) -> Result<RevisionCheck, BackendError>;
}

/// A write port must validate the expected revision and make the replacement
/// all-or-nothing. Implementations may use a temporary file and rename or a
/// provider transaction; callers never receive a partial write as success.
pub trait AtomicDocumentWritePort: Send + Sync {
    fn preview_replace(
        &self,
        request: &PreviewReplaceRequest,
    ) -> Result<DocumentWritePreview, BackendError>;
    fn apply_preview(&self, preview: &DocumentWritePreview) -> Result<WriteReceipt, BackendError>;
}

/// Recovery is explicit so a provider interruption can be reconciled without
/// blindly repeating a mutation that may already have reached durable storage.
pub trait RecoverableAtomicWritePort: AtomicDocumentWritePort {
    fn write_atomic(&self, request: &AtomicWriteRequest) -> Result<WriteReceipt, BackendError>;
    fn recover_write(
        &self,
        operation_id: &str,
    ) -> Result<(RecoveryState, Option<WriteReceipt>), BackendError>;
}

pub trait LibraryDocumentPort:
    LibraryDocumentReadPort + LibraryIndexPort + DocumentRevisionPort + RecoverableAtomicWritePort
{
}

impl<T> LibraryDocumentPort for T where
    T: LibraryDocumentReadPort
        + LibraryIndexPort
        + DocumentRevisionPort
        + RecoverableAtomicWritePort
{
}

#[derive(Debug, Clone)]
struct StoredDocument {
    document_id: String,
    locator: DocumentLocatorDto,
    title: String,
    kind: DocumentKind,
    content: String,
    modified_at: Option<i64>,
    revision: u64,
}

#[derive(Debug, Clone)]
pub struct IndexedDocument {
    pub title: String,
    pub tags: Vec<String>,
    pub frontmatter: BTreeMap<String, String>,
    pub kind: DocumentKind,
}

#[derive(Debug, Clone)]
struct CacheValue {
    generation: u64,
    revision: u64,
    value: IndexedDocument,
}

/// Bounded index cache keyed by library and logical path. The generation and
/// revision checks prevent late results from repopulating stale entries.
#[derive(Debug)]
pub struct DocumentIndexCache {
    entries: Mutex<HashMap<String, CacheValue>>,
    capacity: usize,
}

impl DocumentIndexCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            capacity: capacity.max(1),
        }
    }

    pub fn get(
        &self,
        library_id: &str,
        path: &str,
        generation: u64,
        revision: u64,
    ) -> Option<IndexedDocument> {
        let key = cache_key(library_id, path);
        let entries = self.entries.lock().ok()?;
        entries.get(&key).and_then(|entry| {
            (entry.generation == generation && entry.revision == revision)
                .then(|| entry.value.clone())
        })
    }

    fn insert(
        &self,
        library_id: &str,
        path: &str,
        generation: u64,
        revision: u64,
        value: IndexedDocument,
    ) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        let key = cache_key(library_id, path);
        entries.insert(
            key.clone(),
            CacheValue {
                generation,
                revision,
                value,
            },
        );
        while entries.len() > self.capacity {
            if let Some(oldest) = entries.keys().next().cloned() {
                entries.remove(&oldest);
            } else {
                break;
            }
        }
    }

    pub fn invalidate_document(&self, library_id: &str, path: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(&cache_key(library_id, path));
        }
    }

    pub fn invalidate_library(&self, library_id: &str) {
        let prefix = format!("{library_id}\u{1f}");
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|key, _| !key.starts_with(&prefix));
        }
    }

    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }
}

#[derive(Debug)]
struct MemoryState {
    documents: BTreeMap<String, StoredDocument>,
    generation: u64,
    applied_writes: HashMap<String, WriteReceipt>,
    previews: HashMap<String, DocumentWritePreview>,
}

/// Deterministic reference implementation used by backend-core tests and by
/// future non-Tauri adapters. It intentionally models one library per instance.
#[derive(Debug, Clone)]
pub struct InMemoryLibrary {
    library_id: Arc<String>,
    state: Arc<RwLock<MemoryState>>,
    cache: Arc<DocumentIndexCache>,
}

impl InMemoryLibrary {
    pub fn new(library_id: &str) -> Result<Self, BackendError> {
        Ok(Self {
            library_id: Arc::new(non_empty_identifier("libraryId", library_id)?),
            state: Arc::new(RwLock::new(MemoryState {
                documents: BTreeMap::new(),
                generation: 1,
                applied_writes: HashMap::new(),
                previews: HashMap::new(),
            })),
            cache: Arc::new(DocumentIndexCache::new(256)),
        })
    }

    pub fn add_document(&self, seed: SeedDocument) -> Result<u64, BackendError> {
        self.ensure_locator(&seed.locator)?;
        validate_identifier("documentId", &seed.document_id, 200)?;
        if seed.content.chars().count() > MAX_DOCUMENT_CHARS {
            return Err(BackendError::invalid_input(
                "El documento supera el límite de tamaño.",
            ));
        }
        let revision = compute_document_revision(&seed.content);
        let fallback_title = title_from_path(seed.locator.path());
        let mut state = write_state(&self.state)?;
        state.generation = state.generation.saturating_add(1);
        state.documents.insert(
            seed.document_id.clone(),
            StoredDocument {
                document_id: seed.document_id,
                locator: seed.locator,
                title: if seed.title.trim().is_empty() {
                    fallback_title
                } else {
                    seed.title
                },
                kind: seed.kind,
                content: seed.content,
                modified_at: seed.modified_at,
                revision,
            },
        );
        // The value is invalid regardless of whether this replaced an entry.
        self.cache.invalidate_library(&self.library_id);
        Ok(revision)
    }

    pub fn generation(&self) -> Result<u64, BackendError> {
        Ok(read_state(&self.state)?.generation)
    }

    pub fn cache(&self) -> &DocumentIndexCache {
        &self.cache
    }

    fn ensure_library_id(&self, library_id: &str) -> Result<(), BackendError> {
        if library_id != self.library_id.as_str() {
            return Err(scope_error(
                "La operación no pertenece a la biblioteca solicitada.",
            ));
        }
        Ok(())
    }

    fn ensure_locator(&self, locator: &DocumentLocatorDto) -> Result<(), BackendError> {
        locator.validate()?;
        self.ensure_library_id(&locator.library_id)
    }

    fn document_by_locator<'a>(
        &self,
        state: &'a MemoryState,
        locator: &DocumentLocatorDto,
    ) -> Result<&'a StoredDocument, BackendError> {
        self.ensure_locator(locator)?;
        let document = state
            .documents
            .values()
            .find(|document| document.locator.path() == locator.path())
            .ok_or_else(|| not_found("El documento no existe en la biblioteca."))?;
        if locator.android_tree_uri.is_some()
            && locator.android_tree_uri != document.locator.android_tree_uri
        {
            return Err(scope_error(
                "El árbol Android no pertenece a la biblioteca autorizada.",
            ));
        }
        if locator.android_document_uri.is_some()
            && locator.android_document_uri != document.locator.android_document_uri
        {
            return Err(scope_error(
                "El documento Android no pertenece a la ruta autorizada.",
            ));
        }
        Ok(document)
    }

    fn document_by_id<'a>(
        &self,
        state: &'a MemoryState,
        library_id: &str,
        document_id: &str,
    ) -> Result<&'a StoredDocument, BackendError> {
        self.ensure_library_id(library_id)?;
        validate_identifier("documentId", document_id, 200)?;
        state
            .documents
            .get(document_id)
            .ok_or_else(|| not_found("El documento no existe en la biblioteca."))
    }

    fn indexed(&self, document: &StoredDocument, generation: u64) -> IndexedDocument {
        if let Some(value) = self.cache.get(
            &self.library_id,
            document.locator.path(),
            generation,
            document.revision,
        ) {
            return value;
        }
        let (frontmatter, tags) = parse_frontmatter(&document.content);
        let value = IndexedDocument {
            title: document.title.clone(),
            tags,
            frontmatter,
            kind: document.kind,
        };
        self.cache.insert(
            &self.library_id,
            document.locator.path(),
            generation,
            document.revision,
            value.clone(),
        );
        value
    }

    fn content_for_id<'a>(
        &self,
        state: &'a MemoryState,
        document_id: &str,
    ) -> Result<&'a StoredDocument, BackendError> {
        self.document_by_id(state, self.library_id.as_str(), document_id)
    }
}

impl LibraryDocumentReadPort for InMemoryLibrary {
    fn search_documents(
        &self,
        request: &DocumentSearchRequest,
    ) -> Result<BoundedPage<DocumentSearchHit>, BackendError> {
        self.ensure_library_id(&request.library_id)?;
        let limit = bounded_limit(request.limit, MAX_SEARCH_RESULTS);
        let query = request.query.trim().to_lowercase();
        let titles = request
            .titles
            .iter()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        let tags = request
            .tags
            .iter()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        let state = read_state(&self.state)?;
        let generation = state.generation;
        let mut hits = state
            .documents
            .values()
            .take(MAX_SEARCH_CANDIDATES)
            .filter_map(|document| {
                let indexed = self.indexed(document, generation);
                if request.kind.is_some_and(|kind| kind != indexed.kind)
                    || (!titles.is_empty()
                        && !titles.iter().any(|title| {
                            indexed.title.to_lowercase().contains(title)
                                || document.locator.path().to_lowercase().contains(title)
                        }))
                    || (!tags.is_empty()
                        && !tags
                            .iter()
                            .all(|tag| indexed.tags.iter().any(|item| item == tag)))
                {
                    return None;
                }
                let haystack = format!(
                    "{} {} {} {}",
                    indexed.title.to_lowercase(),
                    document.locator.path().to_lowercase(),
                    indexed.tags.join(" "),
                    indexed
                        .frontmatter
                        .values()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" ")
                );
                let score = if query.is_empty() {
                    1
                } else {
                    let score = query_terms(&query)
                        .iter()
                        .filter(|term| haystack.contains(term.as_str()))
                        .count() as u32;
                    if score == 0 {
                        return None;
                    }
                    score
                };
                Some(DocumentSearchHit {
                    document_id: document.document_id.clone(),
                    title: indexed.title,
                    logical_path: document.locator.logical_path.clone(),
                    kind: document.kind,
                    score,
                    revision: document.revision,
                })
            })
            .collect::<Vec<_>>();
        hits.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.logical_path.as_str().cmp(right.logical_path.as_str()))
        });
        Ok(page(hits, request.offset, limit))
    }

    fn search_context(
        &self,
        request: &ContextSearchRequest,
    ) -> Result<BoundedPage<SearchFragment>, BackendError> {
        self.ensure_library_id(&request.library_id)?;
        let query = request.query.trim().to_lowercase();
        if query.is_empty() {
            return Err(BackendError::invalid_input(
                "La consulta de búsqueda es obligatoria.",
            ));
        }
        let allowed = request.document_ids.iter().collect::<HashSet<_>>();
        let limit = bounded_limit(request.max_results, MAX_SEARCH_RESULTS);
        let state = read_state(&self.state)?;
        let mut fragments = Vec::new();
        let query_terms = query_terms(&query);
        for document in state.documents.values().take(MAX_SEARCH_CANDIDATES) {
            if !allowed.is_empty() && !allowed.contains(&document.document_id) {
                continue;
            }
            for (line_number, line) in document.content.lines().enumerate() {
                let lower = line.to_lowercase();
                let score = query_terms
                    .iter()
                    .filter(|term| lower.contains(term.as_str()))
                    .count() as u32;
                if score == 0 {
                    continue;
                }
                fragments.push(SearchFragment {
                    document_id: document.document_id.clone(),
                    title: document.title.clone(),
                    logical_path: document.locator.logical_path.clone(),
                    content: line.chars().take(1200).collect(),
                    start_line: line_number + 1,
                    end_line: line_number + 1,
                    score,
                });
                if fragments.len() >= limit {
                    break;
                }
            }
            if fragments.len() >= limit {
                break;
            }
        }
        fragments.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.logical_path.as_str().cmp(right.logical_path.as_str()))
                .then_with(|| left.start_line.cmp(&right.start_line))
        });
        Ok(page(fragments, 0, limit))
    }

    fn search_exact(
        &self,
        request: &ExactSearchRequest,
    ) -> Result<BoundedPage<SearchFragment>, BackendError> {
        self.ensure_library_id(&request.library_id)?;
        if request.query.is_empty() {
            return Err(BackendError::invalid_input(
                "La consulta exacta es obligatoria.",
            ));
        }
        let allowed = request.document_ids.iter().collect::<HashSet<_>>();
        let needle = if request.case_sensitive {
            request.query.clone()
        } else {
            request.query.to_lowercase()
        };
        let state = read_state(&self.state)?;
        let mut matches = Vec::new();
        let result_limit = bounded_limit(request.max_results, MAX_SEARCH_RESULTS);
        for document in state.documents.values().take(MAX_SEARCH_CANDIDATES) {
            if !allowed.is_empty() && !allowed.contains(&document.document_id) {
                continue;
            }
            let haystack = if request.case_sensitive {
                document.content.clone()
            } else {
                document.content.to_lowercase()
            };
            let mut start = 0;
            while let Some(found) = haystack[start..].find(&needle) {
                let absolute = start + found;
                matches.push(SearchFragment {
                    document_id: document.document_id.clone(),
                    title: document.title.clone(),
                    logical_path: document.locator.logical_path.clone(),
                    content: context_line(&document.content, absolute),
                    start_line: line_number_at(&document.content, absolute),
                    end_line: line_number_at(&document.content, absolute),
                    score: 1,
                });
                if matches.len() >= result_limit {
                    let total = matches.len();
                    return Ok(page(matches, 0, total));
                }
                start = absolute.saturating_add(needle.len().max(1));
                if start >= haystack.len() {
                    break;
                }
            }
        }
        Ok(page(matches, 0, result_limit))
    }

    fn read_document(&self, locator: &DocumentLocatorDto) -> Result<DocumentContent, BackendError> {
        let state = read_state(&self.state)?;
        let document = self.document_by_locator(&state, locator)?;
        Ok(DocumentContent {
            document_id: document.document_id.clone(),
            locator: document.locator.clone(),
            content: document.content.clone(),
            revision: document.revision,
        })
    }

    fn read_documents(
        &self,
        library_id: &str,
        document_ids: &[String],
    ) -> Result<Vec<DocumentContent>, BackendError> {
        self.ensure_library_id(library_id)?;
        if document_ids.len() > MAX_READ_DOCUMENTS {
            return Err(BackendError::invalid_input(
                "Se excedió el límite de documentos por lectura.",
            ));
        }
        let state = read_state(&self.state)?;
        document_ids
            .iter()
            .map(|document_id| {
                let document = self.document_by_id(&state, library_id, document_id)?;
                Ok(DocumentContent {
                    document_id: document.document_id.clone(),
                    locator: document.locator.clone(),
                    content: document.content.clone(),
                    revision: document.revision,
                })
            })
            .collect()
    }

    fn metadata(&self, locator: &DocumentLocatorDto) -> Result<DocumentMetadata, BackendError> {
        let state = read_state(&self.state)?;
        let document = self.document_by_locator(&state, locator)?;
        let indexed = self.indexed(document, state.generation);
        Ok(DocumentMetadata {
            document_id: document.document_id.clone(),
            locator: document.locator.clone(),
            title: indexed.title,
            kind: indexed.kind,
            size_chars: document.content.chars().count(),
            modified_at: document.modified_at,
            revision: document.revision,
            tags: indexed.tags,
            frontmatter: indexed.frontmatter,
        })
    }

    fn references(
        &self,
        locator: &DocumentLocatorDto,
        max_results: usize,
    ) -> Result<DocumentReferences, BackendError> {
        let state = read_state(&self.state)?;
        let target = self.document_by_locator(&state, locator)?;
        let target_keys = document_reference_keys(target);
        let limit = bounded_limit(max_results, MAX_REFERENCE_RESULTS);
        let outgoing = parse_wikilinks(target)
            .into_iter()
            .take(limit)
            .map(|(target_name, line)| ReferenceMatch {
                document_id: target.document_id.clone(),
                title: target.title.clone(),
                logical_path: target.locator.logical_path.clone(),
                line,
                target: target_name,
            })
            .collect();
        let mut incoming = Vec::new();
        for document in state.documents.values() {
            if document.document_id == target.document_id {
                continue;
            }
            for (reference, line) in parse_wikilinks(document) {
                if target_keys.contains(&reference_key(&reference)) {
                    incoming.push(ReferenceMatch {
                        document_id: document.document_id.clone(),
                        title: document.title.clone(),
                        logical_path: document.locator.logical_path.clone(),
                        line,
                        target: reference,
                    });
                    if incoming.len() >= limit {
                        break;
                    }
                }
            }
            if incoming.len() >= limit {
                break;
            }
        }
        Ok(DocumentReferences {
            document_id: target.document_id.clone(),
            outgoing,
            incoming,
        })
    }

    fn compare(
        &self,
        request: &CompareDocumentsRequest,
    ) -> Result<DocumentComparison, BackendError> {
        self.ensure_library_id(&request.library_id)?;
        let state = read_state(&self.state)?;
        let left = self.content_for_id(&state, &request.left_document_id)?;
        let right = self.content_for_id(&state, &request.right_document_id)?;
        let left_lines = left.content.lines().collect::<Vec<_>>();
        let right_lines = right.content.lines().collect::<Vec<_>>();
        let max_lines = left_lines.len().max(right_lines.len());
        let mut differences = Vec::new();
        for index in 0..max_lines {
            let left_line = left_lines.get(index).map(|line| (*line).to_string());
            let right_line = right_lines.get(index).map(|line| (*line).to_string());
            if left_line != right_line {
                if differences.len() == MAX_COMPARE_LINES {
                    break;
                }
                differences.push(LineDifference {
                    line: index + 1,
                    left: left_line,
                    right: right_line,
                });
            }
        }
        Ok(DocumentComparison {
            left_document_id: left.document_id.clone(),
            right_document_id: right.document_id.clone(),
            same: left.content == right.content,
            truncated: differences.len() == MAX_COMPARE_LINES && max_lines > MAX_COMPARE_LINES,
            differences,
        })
    }

    fn inventory(
        &self,
        request: &InventoryRequest,
    ) -> Result<BoundedPage<DocumentMetadata>, BackendError> {
        self.ensure_library_id(&request.library_id)?;
        if let Some(prefix) = &request.prefix {
            LogicalPathDto::new(prefix.as_str())?;
        }
        let limit = bounded_limit(request.limit, MAX_INVENTORY_ITEMS);
        let state = read_state(&self.state)?;
        let mut documents = state
            .documents
            .values()
            .filter(|document| {
                request.prefix.as_ref().is_none_or(|prefix| {
                    document.locator.path() == prefix.as_str()
                        || document
                            .locator
                            .path()
                            .starts_with(&format!("{}/", prefix.as_str()))
                })
            })
            .map(|document| {
                let indexed = self.indexed(document, state.generation);
                DocumentMetadata {
                    document_id: document.document_id.clone(),
                    locator: document.locator.clone(),
                    title: indexed.title,
                    kind: indexed.kind,
                    size_chars: document.content.chars().count(),
                    modified_at: document.modified_at,
                    revision: document.revision,
                    tags: indexed.tags,
                    frontmatter: indexed.frontmatter,
                }
            })
            .collect::<Vec<_>>();
        documents.sort_by(|left, right| left.locator.path().cmp(right.locator.path()));
        Ok(page(documents, request.offset, limit))
    }
}

impl LibraryIndexPort for InMemoryLibrary {
    fn reindex(&self, request: &ReindexRequest) -> Result<ReindexResult, BackendError> {
        self.ensure_library_id(&request.library_id)?;
        if request.document_ids.len() > MAX_INVENTORY_ITEMS {
            return Err(BackendError::invalid_input(
                "Se excedió el límite de reindexación.",
            ));
        }
        let mut state = write_state(&self.state)?;
        let selected_ids = if request.document_ids.is_empty() {
            state.documents.keys().cloned().collect::<Vec<_>>()
        } else {
            for id in &request.document_ids {
                self.document_by_id(&state, &request.library_id, id)?;
            }
            request.document_ids.clone()
        };
        let paths = selected_ids
            .iter()
            .filter_map(|id| state.documents.get(id))
            .map(|document| document.locator.logical_path.clone())
            .collect::<Vec<_>>();
        state.generation = state.generation.saturating_add(1);
        self.cache.invalidate_library(&self.library_id);
        Ok(ReindexResult {
            generation: state.generation,
            document_ids: selected_ids,
            paths,
        })
    }

    fn index_cache_len(&self) -> usize {
        self.cache.len()
    }
}

impl DocumentRevisionPort for InMemoryLibrary {
    fn check_revision(&self, request: &RevisionRequest) -> Result<RevisionCheck, BackendError> {
        let state = read_state(&self.state)?;
        let document = self.document_by_locator(&state, &request.locator)?;
        Ok(RevisionCheck {
            document_id: document.document_id.clone(),
            expected_revision: request.expected_revision,
            current_revision: document.revision,
            matches: request.expected_revision == document.revision,
        })
    }
}

impl AtomicDocumentWritePort for InMemoryLibrary {
    fn preview_replace(
        &self,
        request: &PreviewReplaceRequest,
    ) -> Result<DocumentWritePreview, BackendError> {
        validate_identifier("operationId", &request.operation_id, 200)?;
        if request.replacement.chars().count() > MAX_DOCUMENT_CHARS {
            return Err(BackendError::invalid_input(
                "El documento supera el límite de tamaño.",
            ));
        }
        let state = read_state(&self.state)?;
        let document = self.document_by_locator(&state, &request.locator)?;
        let preview = DocumentWritePreview {
            operation_id: request.operation_id.clone(),
            document_id: document.document_id.clone(),
            locator: document.locator.clone(),
            expected_revision: document.revision,
            current_revision: document.revision,
            old_content: document.content.clone(),
            new_content: request.replacement.clone(),
        };
        drop(state);
        let mut state = write_state(&self.state)?;
        state
            .previews
            .insert(preview.operation_id.clone(), preview.clone());
        Ok(preview)
    }

    fn apply_preview(&self, preview: &DocumentWritePreview) -> Result<WriteReceipt, BackendError> {
        let state = read_state(&self.state)?;
        if state.previews.get(&preview.operation_id) != Some(preview) {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "El preview ya no está vigente.",
                true,
            ));
        }
        drop(state);
        let request = AtomicWriteRequest {
            operation_id: preview.operation_id.clone(),
            locator: preview.locator.clone(),
            content: preview.new_content.clone(),
            expected_revision: preview.expected_revision,
        };
        self.write_atomic(&request)
    }
}

impl RecoverableAtomicWritePort for InMemoryLibrary {
    fn write_atomic(&self, request: &AtomicWriteRequest) -> Result<WriteReceipt, BackendError> {
        validate_identifier("operationId", &request.operation_id, 200)?;
        if request.content.chars().count() > MAX_DOCUMENT_CHARS {
            return Err(BackendError::invalid_input(
                "El documento supera el límite de tamaño.",
            ));
        }
        let mut state = write_state(&self.state)?;
        if let Some(receipt) = state.applied_writes.get(&request.operation_id) {
            return Ok(receipt.clone());
        }
        let document = self.document_by_locator(&state, &request.locator)?;
        if document.revision != request.expected_revision {
            return Err(revision_conflict(
                &request.operation_id,
                request.expected_revision,
                document.revision,
            ));
        }
        let document_id = document.document_id.clone();
        let path = document.locator.path().to_string();
        let next_revision = compute_document_revision(&request.content);
        let stored = state
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| not_found("El documento no existe en la biblioteca."))?;
        stored.content = request.content.clone();
        stored.revision = next_revision;
        state.generation = state.generation.saturating_add(1);
        let receipt = WriteReceipt {
            operation_id: request.operation_id.clone(),
            document_id,
            revision: next_revision,
            recovered: false,
        };
        state
            .applied_writes
            .insert(request.operation_id.clone(), receipt.clone());
        state.previews.remove(&request.operation_id);
        drop(state);
        self.cache.invalidate_document(&self.library_id, &path);
        Ok(receipt)
    }

    fn recover_write(
        &self,
        operation_id: &str,
    ) -> Result<(RecoveryState, Option<WriteReceipt>), BackendError> {
        validate_identifier("operationId", operation_id, 200)?;
        let state = read_state(&self.state)?;
        Ok(match state.applied_writes.get(operation_id) {
            Some(receipt) => (RecoveryState::Applied, Some(receipt.clone())),
            None => (RecoveryState::NotFound, None),
        })
    }
}

pub fn compute_document_revision(content: &str) -> u64 {
    // FNV-1a is stable across processes and platforms and does not require a
    // crypto dependency in the Tauri-independent core.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub fn validate_document_locator(
    locator: &DocumentLocatorDto,
    expected_library_id: &str,
) -> Result<(), BackendError> {
    locator.validate()?;
    if locator.library_id != expected_library_id {
        return Err(scope_error(
            "El documento no pertenece a la biblioteca activa.",
        ));
    }
    Ok(())
}

pub fn validate_logical_path(path: &str) -> Result<LogicalPathDto, BackendError> {
    LogicalPathDto::new(path)
}

pub fn validate_android_tree_uri(uri: &str) -> Result<AndroidTreeUriDto, BackendError> {
    AndroidTreeUriDto::new(uri)
}

pub fn validate_android_document_uri(uri: &str) -> Result<AndroidDocumentUriDto, BackendError> {
    AndroidDocumentUriDto::new(uri)
}

pub fn library_tool_contracts() -> Vec<ToolDefinition> {
    let library_scopes = vec![
        BackendScope::Library,
        BackendScope::Document,
        BackendScope::Graph,
    ];
    vec![
        tool(
            "search_library_documents",
            "Busca documentos por metadata sin devolver el cuerpo.",
            json_object(),
        ),
        tool(
            "search_library_context",
            "Busca fragmentos acotados dentro de documentos autorizados.",
            json_object(),
        ),
        tool(
            "search_library_exact",
            "Busca una expresión exacta con ruta y líneas.",
            json_object(),
        ),
        tool(
            "read_library_documents",
            "Lee documentos identificados y autorizados.",
            json_object(),
        ),
        tool(
            "get_document_metadata",
            "Devuelve metadata y frontmatter sin el cuerpo.",
            json_object(),
        ),
        tool(
            "find_document_references",
            "Devuelve referencias entrantes y salientes.",
            json_object(),
        ),
        tool(
            "compare_documents",
            "Compara dos documentos por líneas.",
            json_object(),
        ),
        tool(
            "reindex_changed_documents",
            "Invalida y reindexa documentos seleccionados.",
            json_object(),
        ),
    ]
    .into_iter()
    .map(|mut definition| {
        definition.scopes = library_scopes.clone();
        definition
    })
    .collect()
}

/// Mutation tools are kept separate from the read-only catalog so callers can
/// apply their own confirmation and preview policy without accidentally
/// exposing a write as a search capability.
pub fn library_mutation_tool_contracts() -> Vec<ToolDefinition> {
    let scopes = vec![
        BackendScope::Library,
        BackendScope::Document,
        BackendScope::Graph,
    ];
    let tools = [
        (
            "preview_markdown_edit",
            "Prepara un preview semántico Markdown sin escribir el documento.",
            true,
        ),
        (
            "apply_markdown_edit",
            "Aplica hunks Markdown seleccionados después de verificar anchors y revisión.",
            false,
        ),
        (
            "preview_multi_document_markdown_edit",
            "Prepara un preview aislado para varios documentos de la misma biblioteca.",
            true,
        ),
        (
            "apply_multi_document_markdown_edit",
            "Aplica un preview multi-documento verificando todas las revisiones antes de escribir.",
            false,
        ),
        (
            "export_document",
            "Prepara o escribe una exportación PDF, DOCX o binaria acotada y recuperable.",
            false,
        ),
    ]
    .into_iter()
    .map(|(name, description, read_only)| ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: json_object(),
        scopes: scopes.clone(),
        read_only,
        requires_confirmation: !read_only,
    })
    .collect::<Vec<_>>();
    tools
}

fn tool(name: &str, description: &str, input_schema: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema,
        scopes: Vec::new(),
        read_only: true,
        requires_confirmation: false,
    }
}

fn json_object() -> serde_json::Value {
    serde_json::json!({"type": "object"})
}

fn page<T>(items: Vec<T>, offset: usize, limit: usize) -> BoundedPage<T> {
    let total = items.len();
    let items = items
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    BoundedPage {
        has_more: offset.saturating_add(items.len()) < total,
        items,
        total,
        offset,
        limit,
    }
}

fn parse_frontmatter(content: &str) -> (BTreeMap<String, String>, Vec<String>) {
    let mut values = BTreeMap::new();
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return (values, Vec::new());
    }
    for line in lines {
        if line == "---" {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        values.insert(key.to_string(), value.trim().trim_matches('"').to_string());
    }
    let tags = values
        .get("tags")
        .map(|value| {
            value
                .trim_matches(['[', ']'])
                .split(',')
                .map(|tag| tag.trim().trim_matches(['\'', '"']).to_lowercase())
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .unwrap_or_default();
    (values, tags)
}

fn parse_wikilinks(document: &StoredDocument) -> Vec<(String, usize)> {
    let mut references = Vec::new();
    let mut search_from = 0;
    while let Some(start) = document.content[search_from..].find("[[") {
        let start = search_from + start;
        let Some(end_offset) = document.content[start + 2..].find("]]") else {
            break;
        };
        let end = start + 2 + end_offset;
        let raw = document.content[start + 2..end].trim();
        let target = raw
            .split('|')
            .next()
            .unwrap_or_default()
            .split('#')
            .next()
            .unwrap_or_default()
            .trim();
        if !target.is_empty() {
            references.push((target.to_string(), line_number_at(&document.content, start)));
        }
        search_from = end.saturating_add(2);
        if search_from >= document.content.len() {
            break;
        }
    }
    references
}

fn document_reference_keys(document: &StoredDocument) -> HashSet<String> {
    let mut keys = HashSet::new();
    keys.insert(reference_key(document.title.as_str()));
    keys.insert(reference_key(document.locator.path()));
    if let Some(file_name) = document.locator.path().rsplit('/').next() {
        keys.insert(reference_key(file_name));
        keys.insert(reference_key(file_name.trim_end_matches(".md")));
    }
    keys
}

fn reference_key(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches(".md")
        .to_lowercase()
}

fn context_line(content: &str, byte_offset: usize) -> String {
    let start = content[..byte_offset.min(content.len())]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let end = content[byte_offset.min(content.len())..]
        .find('\n')
        .map(|index| byte_offset.min(content.len()) + index)
        .unwrap_or(content.len());
    content[start..end].chars().take(1200).collect()
}

fn line_number_at(content: &str, byte_offset: usize) -> usize {
    content[..byte_offset.min(content.len())]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}

fn title_from_path(path: &str) -> String {
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .to_string()
}

fn query_terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn cache_key(library_id: &str, path: &str) -> String {
    format!("{library_id}\u{1f}{path}")
}

fn default_search_limit() -> usize {
    8
}

fn default_inventory_limit() -> usize {
    100
}

fn bounded_limit(requested: usize, maximum: usize) -> usize {
    requested.clamp(1, maximum)
}

fn read_state(
    state: &RwLock<MemoryState>,
) -> Result<std::sync::RwLockReadGuard<'_, MemoryState>, BackendError> {
    state.read().map_err(|_| {
        BackendError::new(
            BackendErrorCode::Internal,
            "No se pudo leer el estado de la biblioteca.",
            true,
        )
    })
}

fn write_state(
    state: &RwLock<MemoryState>,
) -> Result<std::sync::RwLockWriteGuard<'_, MemoryState>, BackendError> {
    state.write().map_err(|_| {
        BackendError::new(
            BackendErrorCode::Internal,
            "No se pudo actualizar el estado de la biblioteca.",
            true,
        )
    })
}

fn validate_android_uri(uri: &str, marker: &str, document: bool) -> Result<(), BackendError> {
    let trimmed = uri.trim();
    if trimmed != uri {
        return Err(invalid_uri());
    }
    let rest = trimmed.strip_prefix("content://").ok_or_else(invalid_uri)?;
    let authority = rest.split('/').next().unwrap_or_default();
    if authority.is_empty()
        || authority
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
        || trimmed.chars().any(char::is_control)
        || trimmed.contains('\\')
        || !trimmed.contains(marker)
        || (!document && trimmed.contains("/document/"))
    {
        return Err(invalid_uri());
    }
    if trimmed
        .split('/')
        .any(|segment| segment == "." || segment == "..")
    {
        return Err(invalid_uri());
    }
    Ok(())
}

fn uri_authority(uri: &str) -> Option<&str> {
    uri.strip_prefix("content://")?.split('/').next()
}

fn non_empty_identifier(field: &str, value: &str) -> Result<String, BackendError> {
    validate_identifier(field, value, 200)?;
    Ok(value.trim().to_string())
}

fn validate_identifier(field: &str, value: &str, maximum: usize) -> Result<(), BackendError> {
    if value.trim().is_empty()
        || value.chars().count() > maximum
        || value.chars().any(char::is_control)
    {
        return Err(BackendError::invalid_input(format!(
            "{field} no es válido."
        )));
    }
    Ok(())
}

fn is_windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn invalid_path() -> BackendError {
    BackendError::invalid_input("La ruta lógica de biblioteca no es válida.")
}

fn invalid_uri() -> BackendError {
    BackendError::invalid_input("La URI Android no es válida.")
}

fn scope_error(message: &'static str) -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, message, false)
}

fn not_found(message: &'static str) -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, message, false)
}

fn revision_conflict(operation_id: &str, expected: u64, current: u64) -> BackendError {
    let mut error = BackendError::new(
        BackendErrorCode::Conflict,
        format!("La revisión cambió: se esperaba {expected} y se encontró {current}."),
        true,
    );
    error.operation_id = Some(operation_id.to_string());
    error
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locator(library_id: &str, path: &str) -> DocumentLocatorDto {
        DocumentLocatorDto::new(library_id, path, None, None).expect("valid locator")
    }

    fn android_locator(document_uri: Option<&str>) -> DocumentLocatorDto {
        DocumentLocatorDto::new(
            "library-a",
            "notes/a.md",
            Some("content://provider/tree/root"),
            document_uri,
        )
        .expect("valid Android locator")
    }

    fn library() -> InMemoryLibrary {
        let library = InMemoryLibrary::new("library-a").expect("library");
        library
            .add_document(SeedDocument {
                document_id: "doc-a".into(),
                locator: locator("library-a", "notes/a.md"),
                title: "Alpha".into(),
                kind: DocumentKind::Markdown,
                content: "---\ntags: [one, two]\n---\n# Alpha\nSee [[Beta]].".into(),
                modified_at: Some(1),
            })
            .expect("document");
        library
            .add_document(SeedDocument {
                document_id: "doc-b".into(),
                locator: locator("library-a", "notes/b.md"),
                title: "Beta".into(),
                kind: DocumentKind::Markdown,
                content: "# Beta\nBack to [[Alpha]].".into(),
                modified_at: Some(2),
            })
            .expect("document");
        library
    }

    #[test]
    fn rejects_traversal_synthetic_and_absolute_paths() {
        for path in [
            "../outside.md",
            "notes/../../outside.md",
            "notes\\..\\outside.md",
            "/absolute.md",
            "C:/outside.md",
            "content://provider/tree/root/notes/a.md",
        ] {
            assert!(LogicalPathDto::new(path).is_err(), "{path}");
        }
    }

    #[test]
    fn distinguishes_tree_and_document_uris_without_decoding_them() {
        let tree = AndroidTreeUriDto::new("content://provider/tree/root").expect("tree");
        assert!(AndroidDocumentUriDto::new("content://provider/tree/root").is_err());
        assert!(AndroidTreeUriDto::new("content://provider/tree/root/document/root%2Fa").is_err());
        let document =
            AndroidDocumentUriDto::new("content://provider/tree/root/document/root%2Fnotes%2Fa.md")
                .expect("document");
        assert!(document.has_same_authority(&tree));
        assert!(DocumentLocatorDto::new(
            "library-a",
            "notes/a.md",
            Some("content://provider-a/tree/root"),
            Some("content://provider-b/document/root%2Fa.md"),
        )
        .is_err());
    }

    #[test]
    fn keeps_libraries_isolated() {
        let library = library();
        assert!(library
            .read_document(&locator("library-b", "notes/a.md"))
            .is_err());
        assert!(library
            .read_documents("library-b", &["doc-a".into()])
            .is_err());
        assert!(library
            .search_documents(&DocumentSearchRequest {
                library_id: "library-b".into(),
                query: "alpha".into(),
                titles: Vec::new(),
                tags: Vec::new(),
                kind: None,
                offset: 0,
                limit: 10,
            })
            .is_err());
    }

    #[test]
    fn searches_reads_metadata_and_references_with_bounds() {
        let library = library();
        let search = library
            .search_documents(&DocumentSearchRequest {
                library_id: "library-a".into(),
                query: "alpha".into(),
                titles: Vec::new(),
                tags: vec!["one".into()],
                kind: Some(DocumentKind::Markdown),
                offset: 0,
                limit: 1000,
            })
            .expect("search");
        assert_eq!(search.items.len(), 1);
        let metadata = library
            .metadata(&locator("library-a", "notes/a.md"))
            .expect("metadata");
        assert_eq!(
            metadata.frontmatter.get("tags").map(String::as_str),
            Some("[one, two]")
        );
        assert_eq!(metadata.tags, ["one", "two"]);
        let references = library
            .references(&locator("library-a", "notes/a.md"), 50)
            .expect("references");
        assert_eq!(references.outgoing[0].target, "Beta");
        assert_eq!(references.incoming[0].document_id, "doc-b");
        assert_eq!(library.index_cache_len(), 2);
    }

    #[test]
    fn revisions_and_stale_previews_are_rejected() {
        let library = library();
        let current = library
            .read_document(&locator("library-a", "notes/a.md"))
            .expect("read")
            .revision;
        let preview = library
            .preview_replace(&PreviewReplaceRequest {
                operation_id: "op-1".into(),
                locator: locator("library-a", "notes/a.md"),
                replacement: "new content".into(),
            })
            .expect("preview");
        assert_eq!(preview.expected_revision, current);
        library
            .write_atomic(&AtomicWriteRequest {
                operation_id: "op-other".into(),
                locator: locator("library-a", "notes/a.md"),
                content: "changed elsewhere".into(),
                expected_revision: current,
            })
            .expect("other write");
        let error = library.apply_preview(&preview).expect_err("stale preview");
        assert_eq!(error.code, BackendErrorCode::Conflict);
        let check = library
            .check_revision(&RevisionRequest {
                locator: locator("library-a", "notes/a.md"),
                expected_revision: current,
            })
            .expect("revision check");
        assert!(!check.matches);
    }

    #[test]
    fn invalidates_index_cache_after_mutation_and_reindex() {
        let library = library();
        let _ = library
            .metadata(&locator("library-a", "notes/a.md"))
            .expect("metadata");
        assert!(library.index_cache_len() > 0);
        let revision = library
            .read_document(&locator("library-a", "notes/a.md"))
            .expect("read")
            .revision;
        library
            .write_atomic(&AtomicWriteRequest {
                operation_id: "op-cache".into(),
                locator: locator("library-a", "notes/a.md"),
                content: "# Updated".into(),
                expected_revision: revision,
            })
            .expect("write");
        assert_eq!(library.index_cache_len(), 0);
        let _ = library
            .metadata(&locator("library-a", "notes/a.md"))
            .expect("metadata after write");
        let generation = library.generation().expect("generation");
        let result = library
            .reindex(&ReindexRequest {
                library_id: "library-a".into(),
                document_ids: vec!["doc-a".into()],
            })
            .expect("reindex");
        assert!(result.generation > generation);
        assert_eq!(library.index_cache_len(), 0);
    }

    #[test]
    fn bounded_inventory_and_atomic_recovery_are_deterministic() {
        let library = library();
        let inventory = library
            .inventory(&InventoryRequest {
                library_id: "library-a".into(),
                prefix: Some(LogicalPathDto::new("notes").expect("prefix")),
                offset: 0,
                limit: 1,
            })
            .expect("inventory");
        assert_eq!(inventory.items.len(), 1);
        assert!(inventory.has_more);
        let revision = library
            .read_document(&locator("library-a", "notes/a.md"))
            .expect("read")
            .revision;
        let receipt = library
            .write_atomic(&AtomicWriteRequest {
                operation_id: "op-recover".into(),
                locator: locator("library-a", "notes/a.md"),
                content: "atomic".into(),
                expected_revision: revision,
            })
            .expect("write");
        let recovered = library.recover_write("op-recover").expect("recover");
        assert_eq!(recovered.0, RecoveryState::Applied);
        assert_eq!(recovered.1, Some(receipt));
        assert_eq!(
            library.recover_write("missing").expect("missing").0,
            RecoveryState::NotFound
        );
    }

    #[test]
    fn only_chat_transcripts_get_the_larger_write_bound() {
        assert_eq!(max_write_document_chars("chat/chats/2026.md"), MAX_READ_DOCUMENT_CHARS);
        assert_eq!(max_write_document_chars("notas/a.md"), MAX_DOCUMENT_CHARS);
        assert_eq!(max_write_document_chars("chat/chats/imagen.png"), MAX_DOCUMENT_CHARS);
        assert_eq!(max_write_document_chars("chat/otra/a.md"), MAX_DOCUMENT_CHARS);
    }

    #[test]
    fn exposes_read_only_library_tool_contracts() {
        let tools = library_tool_contracts();
        assert!(tools
            .iter()
            .all(|tool| tool.read_only && !tool.requires_confirmation));
        assert!(tools
            .iter()
            .any(|tool| tool.name == "reindex_changed_documents"));
    }

    #[test]
    fn android_locator_keeps_separate_logical_and_document_values() {
        let locator = android_locator(Some(
            "content://provider/tree/root/document/root%2Fnotes%2Fa.md",
        ));
        assert_eq!(locator.path(), "notes/a.md");
        assert_ne!(
            locator.path(),
            locator.android_tree_uri.as_ref().unwrap().as_str()
        );
        assert_ne!(
            locator.path(),
            locator.android_document_uri.as_ref().unwrap().as_str()
        );
    }
}
