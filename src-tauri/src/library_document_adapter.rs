//! Read-only library facade for the backend-core document port.
//!
//! Library roots are owned by `LibraryBindingRegistry`. Request locators can
//! select a logical Markdown path, but their roots and SAF URIs are ignored.
//! The inventory remains the bounded candidate source; document bodies are read
//! one at a time and are never loaded as a corpus.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, Connection};

use crate::backend::{
    BackendError, BackendErrorCode, BoundedPage, CompareDocumentsRequest, ContextSearchRequest,
    DocumentComparison, DocumentContent, DocumentKind, DocumentLocatorDto, DocumentMetadata,
    DocumentReferences, DocumentSearchHit, DocumentSearchRequest, ExactSearchRequest,
    InventoryRequest, LibraryDocumentReadPort, LineDifference, LogicalPathDto, ReferenceMatch,
    SearchFragment, MAX_COMPARE_LINES, MAX_INVENTORY_ITEMS, MAX_READ_DOCUMENTS,
    MAX_READ_DOCUMENT_CHARS, MAX_REFERENCE_RESULTS, MAX_SEARCH_CANDIDATES, MAX_SEARCH_RESULTS,
};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::{LibraryBinding, LibraryBindingRegistry, LibraryBindingRoot};
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const MARKDOWN_EXTENSION: &str = ".md";
const MAX_FRAGMENT_CHARS: usize = 1200;

pub(crate) struct TauriLibraryDocumentReadAdapter<'a> {
    library_id: String,
    binding_generation: u64,
    registry: LibraryBindingRegistry,
    documents: TauriFilesystemDocumentAdapter<'a>,
    /// Needed on Android to open the SAF-backed SQLite copy of the library.
    app: Option<tauri::AppHandle>,
}

impl<'a> TauriLibraryDocumentReadAdapter<'a> {
    pub(crate) fn for_library(
        registry: &LibraryBindingRegistry,
        library_id: &str,
        android_picker_state: &'a AndroidDirectoryPickerState,
    ) -> Result<Self, BackendError> {
        let binding = registry.lookup(library_id)?;
        let documents = TauriFilesystemDocumentAdapter::for_library(
            registry,
            library_id,
            android_picker_state,
        )?;
        Ok(Self {
            library_id: binding.library_id,
            binding_generation: binding.generation,
            registry: registry.clone(),
            documents,
            app: None,
        })
    }

    /// Enables inventory queries on Android, where the library database is
    /// reached through the SQLite plugin instead of a filesystem path.
    pub(crate) fn with_app(mut self, app: tauri::AppHandle) -> Self {
        self.app = Some(app);
        self
    }

    fn binding(&self) -> Result<LibraryBinding, BackendError> {
        let binding = self.registry.lookup(&self.library_id)?;
        if binding.generation != self.binding_generation {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "La referencia de la biblioteca quedo obsoleta.",
                true,
            ));
        }
        Ok(binding)
    }

    fn ensure_library(&self, library_id: &str) -> Result<LibraryBinding, BackendError> {
        if library_id != self.library_id {
            return Err(BackendError::new(
                BackendErrorCode::Forbidden,
                "La operacion no pertenece a la biblioteca autorizada.",
                false,
            ));
        }
        self.binding()
    }

    fn open_inventory(&self) -> Result<(Connection, u64), BackendError> {
        let binding = self.binding()?;
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            let Some(LibraryBindingRoot::Desktop { canonical_root }) = binding.root else {
                return Err(unsupported(
                    "La consulta SQLite de una biblioteca SAF todavia no esta disponible.",
                ));
            };
            let connection = crate::database::open_existing_library_connection(&canonical_root)
                .map_err(storage_error)?;
            let generation = active_inventory_generation(&connection)?;
            return Ok((connection, generation));
        }
        #[cfg(target_os = "android")]
        {
            let (Some(app), Some(LibraryBindingRoot::Android { tree_uri })) =
                (self.app.as_ref(), binding.root)
            else {
                return Err(unsupported(
                    "La consulta SQLite de la biblioteca movil no esta disponible.",
                ));
            };
            let connection = crate::database::open_mobile_library_connection(app, tree_uri.as_str())
                .map_err(storage_error)?;
            let generation = active_inventory_generation(&connection)?;
            Ok((connection, generation))
        }
        #[cfg(target_os = "ios")]
        {
            let _ = binding;
            Err(unsupported(
                "La consulta SQLite de la biblioteca movil todavia no esta disponible.",
            ))
        }
    }

    fn markdown_locator(&self, path: &str) -> Result<DocumentLocatorDto, BackendError> {
        let logical_path = LogicalPathDto::new(path)?;
        if !is_markdown_path(logical_path.as_str()) {
            return Err(unsupported("Esta fachada solo admite documentos Markdown."));
        }
        // Deliberately omit request-provided tree/document URIs. The registry
        // is the only source of the library root and Android grant.
        DocumentLocatorDto::new(&self.library_id, logical_path.as_str(), None, None)
    }

    fn read_path(&self, path: &str) -> Result<DocumentContent, BackendError> {
        let locator = self.markdown_locator(path)?;
        let content = self.documents.read_locator(&locator)?;
        ensure_content_bound(&content)?;
        Ok(DocumentContent {
            document_id: document_id(&self.library_id, locator.path()),
            locator,
            revision: crate::backend::compute_document_revision(&content),
            content,
        })
    }

    fn metadata_for_path(&self, path: &str) -> Result<DocumentMetadata, BackendError> {
        let content = self.read_path(path)?;
        Ok(metadata_from_content(&content, None))
    }

    fn metadata_for_content(
        &self,
        content: &DocumentContent,
        modified_at: Option<i64>,
    ) -> DocumentMetadata {
        metadata_from_content(content, modified_at)
    }

    fn metadata_for_row(&self, row: &InventoryRow) -> Result<DocumentMetadata, BackendError> {
        let content = self.read_path(&row.path)?;
        // Inventory revisions are hints only. Content is authoritative when a
        // file changed after the incremental snapshot.
        Ok(self.metadata_for_content(&content, row.modified_at))
    }

    fn inventory_rows(
        &self,
        prefix: Option<&LogicalPathDto>,
        query: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<InventoryRow>, usize), BackendError> {
        let (connection, generation) = self.open_inventory()?;
        let prefix = prefix.map(LogicalPathDto::as_str);
        let escaped_prefix = prefix.map(sql_prefix_pattern);
        let query = query.map(str::trim).filter(|value| !value.is_empty());
        let offset = offset.min(i64::MAX as usize) as i64;
        let total: usize = connection
            .query_row(
                "SELECT COUNT(*) FROM library_inventory
                 WHERE generation=?1 AND entry_type='file'
                   AND lower(path) LIKE '%.md'
                   AND (?2 IS NULL OR path=?2 OR path LIKE ?3 ESCAPE '\\')
                   AND (?4 IS NULL OR lower(name) LIKE '%' || lower(?4) || '%'
                        OR lower(path) LIKE '%' || lower(?4) || '%')",
                params![generation as i64, prefix, escaped_prefix.as_deref(), query,],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| inventory_error(error.to_string()))?
            .max(0) as usize;
        let mut statement = connection
            .prepare(
                "SELECT path,modified_at FROM library_inventory
                 WHERE generation=?1 AND entry_type='file'
                   AND lower(path) LIKE '%.md'
                   AND (?2 IS NULL OR path=?2 OR path LIKE ?3 ESCAPE '\\')
                   AND (?4 IS NULL OR lower(name) LIKE '%' || lower(?4) || '%'
                        OR lower(path) LIKE '%' || lower(?4) || '%')
                 ORDER BY path COLLATE NOCASE LIMIT ?5 OFFSET ?6",
            )
            .map_err(|error| inventory_error(error.to_string()))?;
        let rows = statement
            .query_map(
                params![
                    generation as i64,
                    prefix,
                    escaped_prefix.as_deref(),
                    query,
                    limit as i64,
                    offset,
                ],
                |row| {
                    Ok(InventoryRow {
                        path: row.get(0)?,
                        modified_at: row.get(1)?,
                    })
                },
            )
            .map_err(|error| inventory_error(error.to_string()))?;
        let rows = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| inventory_error(error.to_string()))?;
        Ok((rows, total))
    }

    fn rows_for_ids(
        &self,
        library_id: &str,
        ids: &[String],
    ) -> Result<Vec<InventoryRow>, BackendError> {
        self.ensure_library(library_id)?;
        if ids.len() > MAX_READ_DOCUMENTS {
            return Err(BackendError::invalid_input(
                "Se excedio el limite de documentos por lectura.",
            ));
        }
        let mut rows = Vec::with_capacity(ids.len());
        let (connection, generation) = self.open_inventory()?;
        for id in ids {
            let path = path_from_document_id(&self.library_id, id)?;
            let row = connection
                .query_row(
                    "SELECT path,modified_at
                     FROM library_inventory
                     WHERE path=?1 AND entry_type='file' AND lower(path) LIKE '%.md'
                       AND generation=?2",
                    params![path, generation as i64],
                    |row| {
                        Ok(InventoryRow {
                            path: row.get(0)?,
                            modified_at: row.get(1)?,
                        })
                    },
                )
                .map_err(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => {
                        not_found("El documento no existe en el inventario.")
                    }
                    other => inventory_error(other.to_string()),
                })?;
            rows.push(row);
        }
        Ok(rows)
    }
}

impl LibraryDocumentReadPort for TauriLibraryDocumentReadAdapter<'_> {
    fn search_documents(
        &self,
        request: &DocumentSearchRequest,
    ) -> Result<BoundedPage<DocumentSearchHit>, BackendError> {
        self.ensure_library(&request.library_id)?;
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
        let (rows, _) = self.inventory_rows(None, None, 0, MAX_SEARCH_CANDIDATES)?;
        let mut hits = Vec::new();
        for row in rows {
            let metadata = self.metadata_for_row(&row)?;
            if request.kind.is_some_and(|kind| kind != metadata.kind)
                || (!titles.is_empty()
                    && !titles.iter().any(|title| {
                        metadata.title.to_lowercase().contains(title)
                            || metadata.locator.path().to_lowercase().contains(title)
                    }))
                || (!tags.is_empty()
                    && !tags
                        .iter()
                        .all(|tag| metadata.tags.iter().any(|item| item == tag)))
            {
                continue;
            }
            let haystack = format!(
                "{} {} {} {}",
                metadata.title.to_lowercase(),
                metadata.locator.path().to_lowercase(),
                metadata.tags.join(" "),
                metadata
                    .frontmatter
                    .values()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" ")
            );
            let score = if query.is_empty() {
                1
            } else {
                query
                    .split_whitespace()
                    .filter(|term| haystack.contains(term))
                    .count() as u32
            };
            if !query.is_empty() && score == 0 {
                continue;
            }
            hits.push(DocumentSearchHit {
                document_id: metadata.document_id,
                title: metadata.title,
                logical_path: metadata.locator.logical_path,
                kind: metadata.kind,
                score,
                revision: metadata.revision,
            });
        }
        hits.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.logical_path.as_str().cmp(right.logical_path.as_str()))
        });
        Ok(page(
            hits,
            request.offset,
            bounded_limit(request.limit, MAX_SEARCH_RESULTS),
        ))
    }

    fn search_context(
        &self,
        request: &ContextSearchRequest,
    ) -> Result<BoundedPage<SearchFragment>, BackendError> {
        self.ensure_library(&request.library_id)?;
        let query = request.query.trim().to_lowercase();
        if query.is_empty() {
            return Err(BackendError::invalid_input(
                "La consulta de busqueda es obligatoria.",
            ));
        }
        let allowed = request.document_ids.iter().collect::<HashSet<_>>();
        let limit = bounded_limit(request.max_results, MAX_SEARCH_RESULTS);
        let (rows, _) = self.inventory_rows(None, None, 0, MAX_SEARCH_CANDIDATES)?;
        let terms = query.split_whitespace().collect::<Vec<_>>();
        let mut fragments = Vec::new();
        for row in rows {
            let content = self.read_path(&row.path)?;
            let metadata = self.metadata_for_content(&content, row.modified_at);
            if !allowed.is_empty() && !allowed.contains(&metadata.document_id) {
                continue;
            }
            for (line_number, line) in content.content.lines().enumerate() {
                let lower = line.to_lowercase();
                let score = terms.iter().filter(|term| lower.contains(**term)).count() as u32;
                if score == 0 {
                    continue;
                }
                fragments.push(SearchFragment {
                    document_id: metadata.document_id.clone(),
                    title: metadata.title.clone(),
                    logical_path: metadata.locator.logical_path.clone(),
                    content: line.chars().take(MAX_FRAGMENT_CHARS).collect(),
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
        self.ensure_library(&request.library_id)?;
        if request.query.is_empty() {
            return Err(BackendError::invalid_input(
                "La consulta exacta es obligatoria.",
            ));
        }
        let allowed = request.document_ids.iter().collect::<HashSet<_>>();
        let limit = bounded_limit(request.max_results, MAX_SEARCH_RESULTS);
        let needle = if request.case_sensitive {
            request.query.clone()
        } else {
            request.query.to_lowercase()
        };
        let (rows, _) = self.inventory_rows(None, None, 0, MAX_SEARCH_CANDIDATES)?;
        let mut matches = Vec::new();
        for row in rows {
            let content = self.read_path(&row.path)?;
            let metadata = self.metadata_for_content(&content, row.modified_at);
            if !allowed.is_empty() && !allowed.contains(&metadata.document_id) {
                continue;
            }
            let haystack = if request.case_sensitive {
                content.content.clone()
            } else {
                content.content.to_lowercase()
            };
            let mut start = 0;
            while let Some(found) = haystack[start..].find(&needle) {
                let absolute = start + found;
                let line = content.content[..absolute].matches('\n').count() + 1;
                let line_content = content
                    .content
                    .lines()
                    .nth(line.saturating_sub(1))
                    .unwrap_or_default()
                    .chars()
                    .take(MAX_FRAGMENT_CHARS)
                    .collect();
                matches.push(SearchFragment {
                    document_id: metadata.document_id.clone(),
                    title: metadata.title.clone(),
                    logical_path: metadata.locator.logical_path.clone(),
                    content: line_content,
                    start_line: line,
                    end_line: line,
                    score: 1,
                });
                if matches.len() >= limit {
                    return Ok(page(matches, 0, limit));
                }
                start = absolute.saturating_add(needle.len().max(1));
                if start >= haystack.len() {
                    break;
                }
            }
        }
        Ok(page(matches, 0, limit))
    }

    fn read_document(&self, locator: &DocumentLocatorDto) -> Result<DocumentContent, BackendError> {
        self.ensure_library(&locator.library_id)?;
        self.read_path(locator.path())
    }

    fn read_documents(
        &self,
        library_id: &str,
        document_ids: &[String],
    ) -> Result<Vec<DocumentContent>, BackendError> {
        let rows = self.rows_for_ids(library_id, document_ids)?;
        rows.iter().map(|row| self.read_path(&row.path)).collect()
    }

    fn metadata(&self, locator: &DocumentLocatorDto) -> Result<DocumentMetadata, BackendError> {
        self.ensure_library(&locator.library_id)?;
        self.metadata_for_path(locator.path())
    }

    fn references(
        &self,
        locator: &DocumentLocatorDto,
        max_results: usize,
    ) -> Result<DocumentReferences, BackendError> {
        self.ensure_library(&locator.library_id)?;
        let target = self.read_path(locator.path())?;
        let target_metadata = self.metadata_for_content(&target, None);
        let target_keys = document_reference_keys(&target_metadata);
        let limit = bounded_limit(max_results, MAX_REFERENCE_RESULTS);
        let outgoing = parse_wikilinks(&target.content, limit)
            .into_iter()
            .map(|(target, line)| ReferenceMatch {
                document_id: target_metadata.document_id.clone(),
                title: target_metadata.title.clone(),
                logical_path: target_metadata.locator.logical_path.clone(),
                line,
                target,
            })
            .collect();

        let (rows, _) = self.inventory_rows(None, None, 0, MAX_SEARCH_CANDIDATES)?;
        let mut incoming = Vec::new();
        for row in rows {
            if row.path == target_metadata.locator.path() {
                continue;
            }
            let document = self.read_path(&row.path)?;
            let metadata = self.metadata_for_content(&document, row.modified_at);
            for (target, line) in parse_wikilinks(&document.content, limit) {
                if target_keys.contains(&reference_key(&target)) {
                    incoming.push(ReferenceMatch {
                        document_id: metadata.document_id.clone(),
                        title: metadata.title.clone(),
                        logical_path: metadata.locator.logical_path.clone(),
                        line,
                        target,
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
            document_id: target_metadata.document_id,
            outgoing,
            incoming,
        })
    }

    fn compare(
        &self,
        request: &CompareDocumentsRequest,
    ) -> Result<DocumentComparison, BackendError> {
        let rows = self.rows_for_ids(
            &request.library_id,
            &[
                request.left_document_id.clone(),
                request.right_document_id.clone(),
            ],
        )?;
        let left = self.read_path(&rows[0].path)?;
        let right = self.read_path(&rows[1].path)?;
        let mut left_lines = left.content.lines();
        let mut right_lines = right.content.lines();
        let mut differences = Vec::new();
        let mut truncated = false;
        let mut line_number = 1;

        loop {
            let left_line = left_lines.next();
            let right_line = right_lines.next();
            if left_line.is_none() && right_line.is_none() {
                break;
            }
            if left_line != right_line {
                if differences.len() == MAX_COMPARE_LINES {
                    truncated = true;
                    break;
                }
                differences.push(LineDifference {
                    line: line_number,
                    left: left_line.map(str::to_string),
                    right: right_line.map(str::to_string),
                });
            }
            line_number += 1;
        }

        Ok(DocumentComparison {
            left_document_id: left.document_id,
            right_document_id: right.document_id,
            same: left.content == right.content,
            differences,
            truncated,
        })
    }

    fn inventory(
        &self,
        request: &InventoryRequest,
    ) -> Result<BoundedPage<DocumentMetadata>, BackendError> {
        self.ensure_library(&request.library_id)?;
        let limit = bounded_limit(request.limit, MAX_INVENTORY_ITEMS);
        let (rows, total) =
            self.inventory_rows(request.prefix.as_ref(), None, request.offset, limit)?;
        let mut items = Vec::with_capacity(rows.len());
        for row in &rows {
            items.push(self.metadata_for_row(row)?);
        }
        Ok(BoundedPage {
            has_more: request.offset.saturating_add(items.len()) < total,
            items,
            total,
            offset: request.offset,
            limit,
        })
    }
}

#[derive(Debug)]
struct InventoryRow {
    path: String,
    modified_at: Option<i64>,
}

fn active_inventory_generation(connection: &Connection) -> Result<u64, BackendError> {
    let generation = connection
        .query_row(
            "SELECT active_generation FROM library_inventory_state WHERE id=1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| inventory_error(error.to_string()))?;
    if generation < 0 {
        return Err(inventory_error(
            "La generacion del inventario no es valida.".to_string(),
        ));
    }
    Ok(generation as u64)
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
        if !key.is_empty() {
            values.insert(key.to_string(), value.trim().trim_matches('"').to_string());
        }
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

fn markdown_title(path: &str, frontmatter: &BTreeMap<String, String>, content: &str) -> String {
    if let Some(title) = frontmatter
        .get("title")
        .filter(|value| !value.trim().is_empty())
    {
        return title.trim().to_string();
    }
    if let Some(title) = content.lines().find_map(|line| {
        line.strip_prefix("# ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }) {
        return title.to_string();
    }
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(MARKDOWN_EXTENSION)
        .to_string()
}

fn metadata_from_content(content: &DocumentContent, modified_at: Option<i64>) -> DocumentMetadata {
    let (frontmatter, tags) = parse_frontmatter(&content.content);
    DocumentMetadata {
        document_id: content.document_id.clone(),
        locator: content.locator.clone(),
        title: markdown_title(content.locator.path(), &frontmatter, &content.content),
        kind: DocumentKind::Markdown,
        size_chars: content.content.chars().count(),
        modified_at,
        revision: content.revision,
        tags,
        frontmatter,
    }
}

fn document_id(library_id: &str, path: &str) -> String {
    format!("{library_id}:{path}")
}

fn parse_wikilinks(content: &str, limit: usize) -> Vec<(String, usize)> {
    let mut references = Vec::new();
    let mut search_from = 0;
    while let Some(start_offset) = content[search_from..].find("[[") {
        let start = search_from + start_offset;
        let Some(end_offset) = content[start + 2..].find("]]") else {
            break;
        };
        let end = start + 2 + end_offset;
        let raw = content[start + 2..end].trim();
        let target = raw
            .split('|')
            .next()
            .unwrap_or_default()
            .split('#')
            .next()
            .unwrap_or_default()
            .trim();
        if !target.is_empty() {
            references.push((target.to_string(), line_number_at(content, start)));
            if references.len() >= limit {
                break;
            }
        }
        search_from = end.saturating_add(2);
        if search_from >= content.len() {
            break;
        }
    }
    references
}

fn document_reference_keys(metadata: &DocumentMetadata) -> HashSet<String> {
    let mut keys = HashSet::new();
    keys.insert(reference_key(&metadata.title));
    keys.insert(reference_key(metadata.locator.path()));
    if let Some(file_name) = metadata.locator.path().rsplit('/').next() {
        keys.insert(reference_key(file_name));
        keys.insert(reference_key(
            file_name.trim_end_matches(MARKDOWN_EXTENSION),
        ));
    }
    keys
}

fn reference_key(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches(MARKDOWN_EXTENSION)
        .to_lowercase()
}

fn line_number_at(content: &str, byte_offset: usize) -> usize {
    content[..byte_offset.min(content.len())]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}

fn path_from_document_id(library_id: &str, id: &str) -> Result<String, BackendError> {
    let path = id.strip_prefix(&format!("{library_id}:")).ok_or_else(|| {
        BackendError::new(
            BackendErrorCode::Forbidden,
            "El documento no pertenece a la biblioteca autorizada.",
            false,
        )
    })?;
    LogicalPathDto::new(path).map(|path| path.as_str().to_string())
}

fn is_markdown_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(MARKDOWN_EXTENSION)
}

fn sql_prefix_pattern(prefix: &str) -> String {
    let escaped = prefix
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("{escaped}/%")
}

fn ensure_content_bound(content: &str) -> Result<(), BackendError> {
    if content.chars().count() > MAX_READ_DOCUMENT_CHARS {
        Err(BackendError::invalid_input(
            "El documento supera el limite de tamano.",
        ))
    } else {
        Ok(())
    }
}

fn bounded_limit(value: usize, maximum: usize) -> usize {
    value.clamp(1, maximum)
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

fn unsupported(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Unsupported, message, false)
}

fn not_found(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, message, true)
}

fn storage_error(_message: String) -> BackendError {
    BackendError::new(
        BackendErrorCode::Storage,
        "No se pudo acceder al inventario de la biblioteca.",
        true,
    )
}

fn inventory_error(message: String) -> BackendError {
    let _ = message;
    BackendError::new(
        BackendErrorCode::Storage,
        "No se pudo consultar el inventario de la biblioteca.",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::TauriLibraryDocumentReadAdapter;
    use crate::backend::{
        BackendErrorCode, CompareDocumentsRequest, DocumentLocatorDto, DocumentSearchRequest,
        InventoryRequest, LibraryDocumentReadPort, LogicalPathDto,
    };
    use crate::library_registry::LibraryBindingRegistry;
    use crate::mobile_directory_picker::AndroidDirectoryPickerState;
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn fixture() -> (PathBuf, LibraryBindingRegistry, AndroidDirectoryPickerState) {
        let id = TEST_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("notia-library-read-{id}"));
        std::fs::create_dir_all(root.join(".notia")).expect("root");
        std::fs::create_dir_all(root.join("notes")).expect("notes");
        std::fs::write(
            root.join("notes/one.md"),
            "---\ntitle: One\ntags: [alpha]\n---\nhello alpha\n",
        )
        .expect("one");
        std::fs::write(root.join("notes/two.md"), "# Two\nhello beta\n").expect("two");
        let connection = Connection::open(root.join(".notia/notia.db")).expect("database");
        connection
            .execute_batch(
                "CREATE TABLE library_inventory_state(id INTEGER PRIMARY KEY, active_generation INTEGER NOT NULL, staging_generation INTEGER);
                 CREATE TABLE library_inventory(path TEXT PRIMARY KEY, entry_type TEXT NOT NULL, name TEXT NOT NULL, parent_path TEXT, size_bytes INTEGER, modified_at INTEGER, revision INTEGER NOT NULL, generation INTEGER NOT NULL, indexed_at TEXT NOT NULL);
                 INSERT INTO library_inventory_state(id,active_generation) VALUES(1,7);
                 INSERT INTO library_inventory(path,entry_type,name,revision,generation,indexed_at) VALUES
                   ('notes/one.md','file','one.md',1,7,'now'), ('notes/two.md','file','two.md',0,7,'now'), ('notes/old.md','file','old.md',99,6,'now');",
            )
            .expect("inventory");
        let registry = LibraryBindingRegistry::default();
        registry
            .register_desktop_root("library-one", &root)
            .expect("binding");
        let state = {
            #[cfg(target_os = "android")]
            {
                AndroidDirectoryPickerState::unavailable()
            }
            #[cfg(not(target_os = "android"))]
            {
                AndroidDirectoryPickerState::empty()
            }
        };
        (root, registry, state)
    }

    #[test]
    fn reads_bounded_metadata_and_uses_current_revision_over_stale_inventory() {
        let (root, registry, state) = fixture();
        let adapter =
            TauriLibraryDocumentReadAdapter::for_library(&registry, "library-one", &state)
                .expect("adapter");
        let metadata = adapter
            .metadata(
                &crate::backend::DocumentLocatorDto::new(
                    "library-one",
                    "notes/one.md",
                    Some("content://other/tree/untrusted"),
                    None,
                )
                .expect("locator"),
            )
            .expect("metadata");
        assert_eq!(metadata.title, "One");
        assert_eq!(metadata.tags, vec!["alpha"]);
        assert_ne!(metadata.revision, 1);
        std::fs::write(
            root.join("notes/attachment-chat.md"),
            "x".repeat(crate::backend::MAX_DOCUMENT_CHARS + 1),
        )
        .expect("attachment chat");
        adapter
            .read_document(
                &crate::backend::DocumentLocatorDto::new(
                    "library-one",
                    "notes/attachment-chat.md",
                    None,
                    None,
                )
                .expect("attachment chat locator"),
            )
            .expect("read-only display bound accepts persisted attachment metadata");

        std::fs::write(
            root.join("notes/oversized.md"),
            "x".repeat(super::MAX_READ_DOCUMENT_CHARS + 1),
        )
        .expect("oversized");
        let error = adapter
            .metadata(
                &crate::backend::DocumentLocatorDto::new(
                    "library-one",
                    "notes/oversized.md",
                    None,
                    None,
                )
                .expect("oversized locator"),
            )
            .expect_err("bounded content");
        assert_eq!(error.code, BackendErrorCode::InvalidInput);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn bounds_search_and_inventory_without_loading_all_entries() {
        let (root, registry, state) = fixture();
        let adapter =
            TauriLibraryDocumentReadAdapter::for_library(&registry, "library-one", &state)
                .expect("adapter");
        let search = adapter
            .search_documents(&DocumentSearchRequest {
                library_id: "library-one".into(),
                query: String::new(),
                titles: Vec::new(),
                tags: Vec::new(),
                kind: None,
                offset: 0,
                limit: usize::MAX,
            })
            .expect("search");
        assert_eq!(search.items.len(), 2);
        assert!(search
            .items
            .iter()
            .all(|item| item.logical_path.as_str().ends_with(".md")));
        let page = adapter
            .inventory(&InventoryRequest {
                library_id: "library-one".into(),
                prefix: Some(LogicalPathDto::new("notes").expect("prefix")),
                offset: 1,
                limit: usize::MAX,
            })
            .expect("inventory page");
        assert_eq!(page.limit, super::MAX_INVENTORY_ITEMS);
        assert_eq!(page.total, 2);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_unknown_revoked_traversal_and_stale_bindings() {
        let (root, registry, state) = fixture();
        let unknown = TauriLibraryDocumentReadAdapter::for_library(&registry, "missing", &state)
            .err()
            .expect("unknown");
        assert_eq!(unknown.code, BackendErrorCode::NotFound);
        let adapter =
            TauriLibraryDocumentReadAdapter::for_library(&registry, "library-one", &state)
                .expect("adapter");
        assert!(
            crate::backend::DocumentLocatorDto::new("library-one", "../secret.md", None, None)
                .is_err()
        );
        registry.revoke("library-one").expect("revoke");
        assert_eq!(
            adapter
                .search_documents(&DocumentSearchRequest {
                    library_id: "library-one".into(),
                    query: String::new(),
                    titles: Vec::new(),
                    tags: Vec::new(),
                    kind: None,
                    offset: 0,
                    limit: 1,
                })
                .expect_err("revoked")
                .code,
            BackendErrorCode::Forbidden
        );
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn references_read_current_markdown_and_bound_outgoing_and_incoming_matches() {
        let (root, registry, state) = fixture();
        let adapter =
            TauriLibraryDocumentReadAdapter::for_library(&registry, "library-one", &state)
                .expect("adapter");
        let outgoing = (0..(super::MAX_REFERENCE_RESULTS + 5))
            .map(|_| "[[Two]]")
            .collect::<Vec<_>>()
            .join("\n");
        let incoming = (0..(super::MAX_REFERENCE_RESULTS + 5))
            .map(|_| "[[One]]")
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(root.join("notes/one.md"), outgoing).expect("one");
        std::fs::write(root.join("notes/two.md"), incoming).expect("two");

        let locator = DocumentLocatorDto::new(
            "library-one",
            "notes/one.md",
            Some("content://other/tree/untrusted"),
            None,
        )
        .expect("locator");
        let references = adapter
            .references(&locator, usize::MAX)
            .expect("references");

        assert_eq!(references.outgoing.len(), super::MAX_REFERENCE_RESULTS);
        assert_eq!(references.incoming.len(), super::MAX_REFERENCE_RESULTS);
        assert_eq!(references.outgoing[0].target, "Two");
        assert_eq!(references.outgoing[49].line, 50);
        assert_eq!(
            references.incoming[0].document_id,
            "library-one:notes/two.md"
        );
        assert_eq!(references.incoming[49].line, 50);
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn compare_reads_current_documents_and_reports_bounded_line_differences() {
        let (root, registry, state) = fixture();
        let adapter =
            TauriLibraryDocumentReadAdapter::for_library(&registry, "library-one", &state)
                .expect("adapter");
        let left = (0..(super::MAX_COMPARE_LINES + 1))
            .map(|line| format!("left-{line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let right = (0..(super::MAX_COMPARE_LINES + 1))
            .map(|line| format!("right-{line}"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(root.join("notes/one.md"), left).expect("left");
        std::fs::write(root.join("notes/two.md"), right).expect("right");

        let comparison = adapter
            .compare(&CompareDocumentsRequest {
                library_id: "library-one".into(),
                left_document_id: "library-one:notes/one.md".into(),
                right_document_id: "library-one:notes/two.md".into(),
            })
            .expect("comparison");

        assert!(!comparison.same);
        assert_eq!(comparison.differences.len(), super::MAX_COMPARE_LINES);
        assert!(comparison.truncated);
        assert_eq!(comparison.differences[0].line, 1);
        assert_eq!(comparison.differences[99].line, super::MAX_COMPARE_LINES);
        assert_eq!(comparison.differences[0].left.as_deref(), Some("left-0"));
        assert_eq!(comparison.differences[0].right.as_deref(), Some("right-0"));

        let error = adapter
            .compare(&CompareDocumentsRequest {
                library_id: "other-library".into(),
                left_document_id: "other-library:notes/one.md".into(),
                right_document_id: "other-library:notes/two.md".into(),
            })
            .expect_err("library isolation");
        assert_eq!(error.code, BackendErrorCode::Forbidden);
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
