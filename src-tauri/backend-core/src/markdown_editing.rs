//! Deterministic semantic Markdown plans.
//!
//! This module deliberately operates on source text and ports only. Building a
//! preview never calls a write port; applying one validates the captured source
//! and delegates the final revision check to the atomic document port.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::error::{BackendError, BackendErrorCode};
use super::library_tools::{
    compute_document_revision, AtomicWriteRequest, DocumentContent, DocumentLocatorDto,
    LibraryDocumentPort, LibraryDocumentReadPort, RecoverableAtomicWritePort, RevisionRequest,
    WriteReceipt, MAX_DOCUMENT_CHARS,
};

pub const MAX_MARKDOWN_HUNKS: usize = 200;
pub const MAX_MULTI_DOCUMENT_EDITS: usize = 20;
pub const MAX_MARKDOWN_TAG_CHARS: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditRequest {
    pub operation_id: String,
    pub locator: DocumentLocatorDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<u64>,
    pub operation: MarkdownOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocumentEdit {
    pub locator: DocumentLocatorDto,
    pub operation: MarkdownOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum MarkdownOperation {
    SetFrontmatter {
        key: String,
        value: String,
    },
    RemoveFrontmatter {
        key: String,
    },
    AddWikilink {
        target: String,
        alias: Option<String>,
    },
    ReplaceWikilink {
        anchor_id: String,
        target: String,
        alias: Option<String>,
    },
    AddTag {
        tag: String,
    },
    RemoveTag {
        tag: String,
    },
    SetFact {
        key: String,
        value: String,
    },
    RemoveFact {
        key: String,
    },
    InsertTemplate {
        name: String,
        body: String,
    },
    ReplaceTemplate {
        anchor_id: String,
        body: String,
    },
    InsertBlock {
        language: String,
        content: String,
    },
    ReplaceBlock {
        anchor_id: String,
        language: String,
        content: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MarkdownAnchorKind {
    Document,
    Frontmatter,
    Wikilink,
    Tag,
    Fact,
    Template,
    Block,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownAnchor {
    pub id: String,
    pub kind: MarkdownAnchorKind,
    pub label: String,
    pub ordinal: usize,
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_line: u32,
    pub end_line: u32,
    pub fingerprint: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownHunk {
    pub id: String,
    pub anchor: MarkdownAnchor,
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownFormatValidation {
    pub valid: bool,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditPreview {
    pub operation_id: String,
    pub document_id: String,
    pub locator: DocumentLocatorDto,
    pub expected_revision: u64,
    pub current_revision: u64,
    pub old_content: String,
    pub new_content: String,
    pub anchors: Vec<MarkdownAnchor>,
    pub hunks: Vec<MarkdownHunk>,
    pub format: MarkdownFormatValidation,
}

pub type SemanticMarkdownPreview = MarkdownEditPreview;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDocumentMarkdownEditRequest {
    pub operation_id: String,
    pub edits: Vec<MarkdownDocumentEdit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDocumentMarkdownPreview {
    pub operation_id: String,
    pub previews: Vec<MarkdownEditPreview>,
    pub documents: Vec<MarkdownPreviewDocument>,
    pub hunks: Vec<MarkdownHunk>,
    pub format: MarkdownFormatValidation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownPreviewDocument {
    pub document_id: String,
    pub path: String,
    pub expected_revision: u64,
    pub current_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownApplyResult {
    pub changed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<WriteReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDocumentMarkdownApplyResult {
    pub changed: bool,
    pub receipts: Vec<WriteReceipt>,
}

#[derive(Debug, Clone)]
struct LineSpan {
    start: usize,
    end: usize,
    text_end: usize,
    text: String,
}

#[derive(Debug, Clone)]
struct FrontmatterField {
    key: String,
    line: LineSpan,
    value_start: usize,
    value_end: usize,
    value: String,
}

#[derive(Debug, Clone)]
struct Frontmatter {
    close_start: usize,
    fields: Vec<FrontmatterField>,
}

#[derive(Debug, Clone)]
struct MarkupSpan {
    start: usize,
    end: usize,
    label: String,
    ordinal: usize,
}

#[derive(Debug, Clone)]
struct BlockSpan {
    start: usize,
    end: usize,
    language: String,
    ordinal: usize,
}

#[derive(Debug, Clone)]
struct EditPlan {
    kind: MarkdownAnchorKind,
    label: String,
    ordinal: usize,
    start: usize,
    end: usize,
    replacement: String,
}

pub fn validate_markdown_format(source: &str) -> Result<MarkdownFormatValidation, BackendError> {
    if source.chars().count() > MAX_DOCUMENT_CHARS {
        return Err(BackendError::invalid_input(
            "El documento Markdown supera el límite de tamaño.",
        ));
    }
    let mut diagnostics = Vec::new();
    let lines = line_spans(source);
    let mut in_fence: Option<(char, usize)> = None;
    for line in &lines {
        if let Some((character, length)) = fence_marker(&line.text) {
            match in_fence {
                Some((open_character, open_length))
                    if character == open_character && length >= open_length =>
                {
                    in_fence = None;
                }
                None => in_fence = Some((character, length)),
                _ => {}
            }
        }
    }
    if let Some((character, _)) = in_fence {
        diagnostics.push(format!("Bloque fenced sin cierre ({character})."));
    }
    if frontmatter(source).is_err() {
        diagnostics.push("Frontmatter sin cierre o con una entrada inválida.".into());
    }
    if semantic_ranges(source, "[[", "]]", MarkdownAnchorKind::Wikilink).is_err()
        || semantic_ranges(source, "{{", "}}", MarkdownAnchorKind::Template).is_err()
    {
        diagnostics.push("Markdown con delimitador semántico sin cierre.".into());
    }
    let result = MarkdownFormatValidation {
        valid: diagnostics.is_empty(),
        diagnostics,
    };
    if result.valid {
        Ok(result)
    } else {
        Err(BackendError::invalid_input(result.diagnostics.join(" ")))
    }
}

pub fn preview_markdown_edit(
    source: &str,
    request: &MarkdownEditRequest,
) -> Result<MarkdownEditPreview, BackendError> {
    request.locator.validate()?;
    validate_operation_id(&request.operation_id)?;
    validate_markdown_format(source)?;
    let current_revision = compute_document_revision(source);
    if let Some(expected_revision) = request.expected_revision {
        if expected_revision != current_revision {
            return Err(revision_conflict(
                &request.operation_id,
                expected_revision,
                current_revision,
            ));
        }
    }
    let plan = plan_operation(source, &request.locator, &request.operation)?;
    let new_content = replace_range(source, plan.start, plan.end, &plan.replacement)?;
    if new_content.chars().count() > MAX_DOCUMENT_CHARS {
        return Err(BackendError::invalid_input(
            "El documento Markdown supera el límite de tamaño.",
        ));
    }
    let new_format = validate_markdown_format(&new_content)?;
    let anchor = make_anchor(
        &request.locator,
        &plan.kind,
        &plan.label,
        plan.ordinal,
        source,
        plan.start,
        plan.end,
    );
    let old_text = source[plan.start..plan.end].to_string();
    let new_text = plan.replacement;
    let hunk = MarkdownHunk {
        id: hunk_id(&anchor, &new_text),
        anchor: anchor.clone(),
        old_text,
        new_text,
    };
    Ok(MarkdownEditPreview {
        operation_id: request.operation_id.clone(),
        document_id: document_id_from_locator(&request.locator),
        locator: request.locator.clone(),
        expected_revision: current_revision,
        current_revision,
        old_content: source.to_string(),
        new_content,
        anchors: vec![anchor],
        hunks: vec![hunk],
        format: new_format,
    })
}

pub fn preview_markdown_edit_from_port(
    port: &dyn LibraryDocumentReadPort,
    request: &MarkdownEditRequest,
) -> Result<MarkdownEditPreview, BackendError> {
    let document = port.read_document(&request.locator)?;
    preview_document_edit(&document, request)
}

pub fn preview_multi_document_markdown_edit(
    port: &dyn LibraryDocumentReadPort,
    request: &MultiDocumentMarkdownEditRequest,
) -> Result<MultiDocumentMarkdownPreview, BackendError> {
    validate_operation_id(&request.operation_id)?;
    if request.edits.is_empty() || request.edits.len() > MAX_MULTI_DOCUMENT_EDITS {
        return Err(BackendError::invalid_input(
            "La operación multi-documento no tiene un tamaño válido.",
        ));
    }
    let mut library_id: Option<&str> = None;
    let mut paths = HashSet::new();
    let mut previews = Vec::with_capacity(request.edits.len());
    for (index, edit) in request.edits.iter().enumerate() {
        if library_id.is_none() {
            library_id = Some(edit.locator.library_id.as_str());
        }
        if library_id != Some(edit.locator.library_id.as_str()) {
            return Err(scope_error(
                "Una operación multi-documento no puede cruzar bibliotecas.",
            ));
        }
        if !paths.insert(edit.locator.path().to_string()) {
            return Err(BackendError::invalid_input(
                "Una operación multi-documento repite una ruta.",
            ));
        }
        let document = port.read_document(&edit.locator)?;
        let child = MarkdownEditRequest {
            operation_id: child_operation_id(&request.operation_id, index, edit.locator.path()),
            locator: edit.locator.clone(),
            expected_revision: None,
            operation: edit.operation.clone(),
        };
        previews.push(preview_document_edit(&document, &child)?);
    }
    let documents = previews
        .iter()
        .map(|preview| MarkdownPreviewDocument {
            document_id: preview.document_id.clone(),
            path: preview.locator.path().to_string(),
            expected_revision: preview.expected_revision,
            current_revision: preview.current_revision,
        })
        .collect::<Vec<_>>();
    let hunks = previews
        .iter()
        .flat_map(|preview| preview.hunks.clone())
        .collect::<Vec<_>>();
    if hunks.len() > MAX_MARKDOWN_HUNKS {
        return Err(BackendError::invalid_input(
            "El preview Markdown supera el límite de hunks.",
        ));
    }
    Ok(MultiDocumentMarkdownPreview {
        operation_id: request.operation_id.clone(),
        previews,
        documents,
        hunks,
        format: MarkdownFormatValidation {
            valid: true,
            diagnostics: Vec::new(),
        },
    })
}

pub fn apply_markdown_preview(
    port: &dyn RecoverableAtomicWritePort,
    preview: &MarkdownEditPreview,
    selected_hunk_ids: &[String],
) -> Result<MarkdownApplyResult, BackendError> {
    validate_preview(preview)?;
    let selected = selected_hunks(&preview.hunks, selected_hunk_ids)?;
    if selected.is_empty() {
        return Ok(MarkdownApplyResult {
            changed: false,
            receipt: None,
        });
    }
    let content = apply_hunks(&preview.old_content, selected)?;
    validate_markdown_format(&content)?;
    let receipt = port.write_atomic(&AtomicWriteRequest {
        operation_id: preview.operation_id.clone(),
        locator: preview.locator.clone(),
        content,
        expected_revision: preview.expected_revision,
    })?;
    Ok(MarkdownApplyResult {
        changed: true,
        receipt: Some(receipt),
    })
}

/// Materializes a previously reviewed preview without touching storage.
/// Adapters use this helper when their native write port is not expressed as a
/// `RecoverableAtomicWritePort`; the caller must still enforce the current
/// revision immediately before persisting the returned source.
pub fn materialize_markdown_preview(
    preview: &MarkdownEditPreview,
    selected_hunk_ids: &[String],
) -> Result<Option<String>, BackendError> {
    validate_preview(preview)?;
    let selected = selected_hunks(&preview.hunks, selected_hunk_ids)?;
    if selected.is_empty() {
        return Ok(None);
    }
    let content = apply_hunks(&preview.old_content, selected)?;
    validate_markdown_format(&content)?;
    Ok(Some(content))
}

pub fn apply_multi_document_markdown_preview(
    port: &dyn LibraryDocumentPort,
    preview: &MultiDocumentMarkdownPreview,
    selected_hunk_ids: &[String],
) -> Result<MultiDocumentMarkdownApplyResult, BackendError> {
    if preview.previews.is_empty() || preview.previews.len() > MAX_MULTI_DOCUMENT_EDITS {
        return Err(BackendError::invalid_input(
            "El preview multi-document no tiene un tamaño válido.",
        ));
    }
    let selected = selected_hunk_set(&preview.hunks, selected_hunk_ids)?;
    if selected.is_empty() {
        return Ok(MultiDocumentMarkdownApplyResult {
            changed: false,
            receipts: Vec::new(),
        });
    }
    // Preflight every document before the first write. This prevents a known
    // stale sibling from allowing a partial multi-document mutation.
    for document in &preview.previews {
        if document
            .hunks
            .iter()
            .any(|hunk| selected.contains(&hunk.id))
        {
            let check = port.check_revision(&RevisionRequest {
                locator: document.locator.clone(),
                expected_revision: document.expected_revision,
            })?;
            if !check.matches {
                return Err(revision_conflict(
                    &document.operation_id,
                    document.expected_revision,
                    check.current_revision,
                ));
            }
        }
    }
    let mut receipts = Vec::new();
    for document in &preview.previews {
        let ids = document
            .hunks
            .iter()
            .filter(|hunk| selected.contains(&hunk.id))
            .map(|hunk| hunk.id.clone())
            .collect::<Vec<_>>();
        if !ids.is_empty() {
            receipts.push(
                apply_markdown_preview(port, document, &ids)?
                    .receipt
                    .ok_or_else(|| {
                        BackendError::new(
                            BackendErrorCode::Internal,
                            "La aplicación Markdown no devolvió un receipt.",
                            true,
                        )
                    })?,
            );
        }
    }
    Ok(MultiDocumentMarkdownApplyResult {
        changed: !receipts.is_empty(),
        receipts,
    })
}

fn preview_document_edit(
    document: &DocumentContent,
    request: &MarkdownEditRequest,
) -> Result<MarkdownEditPreview, BackendError> {
    if document.locator != request.locator {
        return Err(scope_error(
            "El documento leído no coincide con el locator solicitado.",
        ));
    }
    if let Some(expected_revision) = request.expected_revision {
        if expected_revision != document.revision {
            return Err(revision_conflict(
                &request.operation_id,
                expected_revision,
                document.revision,
            ));
        }
    }
    let mut source_request = request.clone();
    source_request.expected_revision = None;
    let preview = preview_markdown_edit(&document.content, &source_request)?;
    Ok(MarkdownEditPreview {
        document_id: document.document_id.clone(),
        current_revision: document.revision,
        expected_revision: document.revision,
        ..preview
    })
}

fn plan_operation(
    source: &str,
    locator: &DocumentLocatorDto,
    operation: &MarkdownOperation,
) -> Result<EditPlan, BackendError> {
    match operation {
        MarkdownOperation::SetFrontmatter { key, value } => {
            let key = valid_key(key)?;
            valid_value(value)?;
            let newline = newline_for(source);
            if let Some(metadata) = frontmatter(source)? {
                if let Some(field) = metadata.fields.iter().find(|field| field.key == key) {
                    return Ok(EditPlan {
                        kind: MarkdownAnchorKind::Frontmatter,
                        label: key.clone(),
                        ordinal: field_ordinal(&metadata.fields, &key),
                        start: field.line.start,
                        end: field.line.end,
                        replacement: format!("{}: {}{}", key, serialize_value(value), newline),
                    });
                }
                return Ok(EditPlan {
                    kind: MarkdownAnchorKind::Frontmatter,
                    label: key.clone(),
                    ordinal: metadata.fields.len(),
                    start: metadata.close_start,
                    end: metadata.close_start,
                    replacement: format!("{}: {}{}", key, serialize_value(value), newline),
                });
            }
            Ok(EditPlan {
                kind: MarkdownAnchorKind::Frontmatter,
                label: key.clone(),
                ordinal: 0,
                start: 0,
                end: 0,
                replacement: format!(
                    "---{newline}{key}: {}{newline}---{newline}",
                    serialize_value(value)
                ),
            })
        }
        MarkdownOperation::RemoveFrontmatter { key } => {
            let key = valid_key(key)?;
            let metadata = frontmatter(source)?.ok_or_else(|| {
                BackendError::invalid_input("La propiedad de frontmatter no existe.")
            })?;
            let field = metadata
                .fields
                .iter()
                .find(|field| field.key == key)
                .ok_or_else(|| {
                    BackendError::invalid_input("La propiedad de frontmatter no existe.")
                })?;
            Ok(EditPlan {
                kind: MarkdownAnchorKind::Frontmatter,
                label: key.clone(),
                ordinal: field_ordinal(&metadata.fields, &key),
                start: field.line.start,
                end: field.line.end,
                replacement: String::new(),
            })
        }
        MarkdownOperation::AddTag { tag } => edit_tag(source, tag, true),
        MarkdownOperation::RemoveTag { tag } => edit_tag(source, tag, false),
        MarkdownOperation::SetFact { key, value } => edit_fact(source, key, Some(value)),
        MarkdownOperation::RemoveFact { key } => edit_fact(source, key, None),
        MarkdownOperation::AddWikilink { target, alias } => {
            let target = valid_wikilink_target(target)?;
            let text = wikilink_text(&target, alias.as_deref())?;
            append_plan(source, MarkdownAnchorKind::Wikilink, target, text)
        }
        MarkdownOperation::ReplaceWikilink {
            anchor_id,
            target,
            alias,
        } => {
            let target = valid_wikilink_target(target)?;
            let spans = wikilinks(source)?;
            let (span, anchor) = find_markup_anchor(
                locator,
                source,
                &spans,
                MarkdownAnchorKind::Wikilink,
                anchor_id,
            )?;
            Ok(EditPlan {
                kind: MarkdownAnchorKind::Wikilink,
                label: target.clone(),
                ordinal: anchor.ordinal,
                start: span.start,
                end: span.end,
                replacement: wikilink_text(&target, alias.as_deref())?,
            })
        }
        MarkdownOperation::InsertTemplate { name, body } => {
            let name = valid_name(name)?;
            valid_value(body)?;
            append_plan(
                source,
                MarkdownAnchorKind::Template,
                name.clone(),
                template_text(&name, body),
            )
        }
        MarkdownOperation::ReplaceTemplate { anchor_id, body } => {
            valid_value(body)?;
            let spans = templates(source)?;
            let (span, anchor) = find_markup_anchor(
                locator,
                source,
                &spans,
                MarkdownAnchorKind::Template,
                anchor_id,
            )?;
            Ok(EditPlan {
                kind: MarkdownAnchorKind::Template,
                label: span.label.clone(),
                ordinal: anchor.ordinal,
                start: span.start,
                end: span.end,
                replacement: template_text(&span.label, body),
            })
        }
        MarkdownOperation::InsertBlock { language, content } => {
            let language = valid_name(language)?;
            valid_value(content)?;
            append_plan(
                source,
                MarkdownAnchorKind::Block,
                language.clone(),
                block_text(&language, content),
            )
        }
        MarkdownOperation::ReplaceBlock {
            anchor_id,
            language,
            content,
        } => {
            let language = valid_name(language)?;
            valid_value(content)?;
            let blocks = blocks(source);
            let (span, anchor) = find_block_anchor(locator, source, &blocks, anchor_id)?;
            Ok(EditPlan {
                kind: MarkdownAnchorKind::Block,
                label: language.clone(),
                ordinal: anchor.ordinal,
                start: span.start,
                end: span.end,
                replacement: block_text(&language, content),
            })
        }
    }
}

fn edit_tag(source: &str, tag: &str, add: bool) -> Result<EditPlan, BackendError> {
    let tag = valid_tag(tag)?;
    let Some(metadata) = frontmatter(source)? else {
        if !add {
            return Err(BackendError::invalid_input("El tag no existe."));
        }
        let newline = newline_for(source);
        return Ok(EditPlan {
            kind: MarkdownAnchorKind::Tag,
            label: tag.clone(),
            ordinal: 0,
            start: 0,
            end: 0,
            replacement: format!("---{newline}tags: [{tag}]{newline}---{newline}"),
        });
    };
    let field = metadata.fields.iter().find(|field| field.key == "tags");
    let (mut tags, field) = match field {
        Some(field) => (parse_tags(&field.value)?, Some(field)),
        None => (Vec::new(), None),
    };
    let existing = tags.iter().any(|value| value.eq_ignore_ascii_case(&tag));
    if add && existing {
        return Err(BackendError::invalid_input("El tag ya existe."));
    }
    if !add && !existing {
        return Err(BackendError::invalid_input("El tag no existe."));
    }
    if add {
        tags.push(tag.clone());
    } else {
        tags.retain(|value| !value.eq_ignore_ascii_case(&tag));
    }
    tags.sort();
    tags.dedup();
    let value = format!("[{}]", tags.join(", "));
    if let Some(field) = field {
        Ok(EditPlan {
            kind: MarkdownAnchorKind::Tag,
            label: tag,
            ordinal: 0,
            start: field.value_start,
            end: field.value_end,
            replacement: value,
        })
    } else {
        let newline = newline_for(source);
        Ok(EditPlan {
            kind: MarkdownAnchorKind::Tag,
            label: tag,
            ordinal: 0,
            start: metadata.close_start,
            end: metadata.close_start,
            replacement: format!("tags: {}{}", value, newline),
        })
    }
}

fn edit_fact(source: &str, key: &str, value: Option<&String>) -> Result<EditPlan, BackendError> {
    let key = valid_fact_key(key)?;
    let lines = line_spans(source);
    let mut found = None;
    let mut ordinal = 0;
    for line in &lines {
        if let Some((candidate, value_start)) = fact_parts(line, source) {
            if candidate == key {
                found = Some((line.clone(), value_start));
                break;
            }
            ordinal += 1;
        }
    }
    match (found, value) {
        (Some((line, value_start)), Some(value)) => {
            valid_value(value)?;
            Ok(EditPlan {
                kind: MarkdownAnchorKind::Fact,
                label: key,
                ordinal,
                start: value_start,
                end: line.text_end,
                replacement: value.clone(),
            })
        }
        (Some((line, _)), None) => Ok(EditPlan {
            kind: MarkdownAnchorKind::Fact,
            label: key,
            ordinal,
            start: line.start,
            end: line.end,
            replacement: String::new(),
        }),
        (None, Some(value)) => {
            valid_value(value)?;
            append_plan(
                source,
                MarkdownAnchorKind::Fact,
                key.clone(),
                format!("{key}:: {value}"),
            )
        }
        (None, None) => Err(BackendError::invalid_input("El fact no existe.")),
    }
}

fn append_plan(
    source: &str,
    kind: MarkdownAnchorKind,
    label: String,
    text: String,
) -> Result<EditPlan, BackendError> {
    let prefix = if source.is_empty() || source.ends_with('\n') {
        String::new()
    } else {
        newline_for(source).to_string()
    };
    let suffix = if text.ends_with('\n') {
        String::new()
    } else {
        newline_for(source).to_string()
    };
    Ok(EditPlan {
        kind,
        label,
        ordinal: 0,
        start: source.len(),
        end: source.len(),
        replacement: format!("{prefix}{text}{suffix}"),
    })
}

fn find_markup_anchor(
    locator: &DocumentLocatorDto,
    source: &str,
    spans: &[MarkupSpan],
    kind: MarkdownAnchorKind,
    anchor_id: &str,
) -> Result<(MarkupSpan, MarkdownAnchor), BackendError> {
    for span in spans {
        let anchor = make_anchor(
            locator,
            &kind,
            &span.label,
            span.ordinal,
            source,
            span.start,
            span.end,
        );
        if anchor.id == anchor_id {
            return Ok((span.clone(), anchor));
        }
    }
    Err(BackendError::invalid_input("El anchor Markdown no existe."))
}

fn find_block_anchor(
    locator: &DocumentLocatorDto,
    source: &str,
    spans: &[BlockSpan],
    anchor_id: &str,
) -> Result<(BlockSpan, MarkdownAnchor), BackendError> {
    for span in spans {
        let anchor = make_anchor(
            locator,
            &MarkdownAnchorKind::Block,
            &span.language,
            span.ordinal,
            source,
            span.start,
            span.end,
        );
        if anchor.id == anchor_id {
            return Ok((span.clone(), anchor));
        }
    }
    Err(BackendError::invalid_input("El anchor Markdown no existe."))
}

fn validate_preview(preview: &MarkdownEditPreview) -> Result<(), BackendError> {
    if preview.hunks.is_empty() || preview.hunks.len() > MAX_MARKDOWN_HUNKS {
        return Err(BackendError::invalid_input(
            "El preview Markdown no tiene un tamaño válido.",
        ));
    }
    validate_markdown_format(&preview.old_content)?;
    validate_markdown_format(&preview.new_content)?;
    preview.locator.validate()
}

fn selected_hunks<'a>(
    hunks: &'a [MarkdownHunk],
    selected_ids: &[String],
) -> Result<Vec<&'a MarkdownHunk>, BackendError> {
    let selected = selected_hunk_set(hunks, selected_ids)?;
    Ok(hunks
        .iter()
        .filter(|hunk| selected.contains(&hunk.id))
        .collect())
}

fn selected_hunk_set(
    hunks: &[MarkdownHunk],
    selected_ids: &[String],
) -> Result<HashSet<String>, BackendError> {
    let known = hunks
        .iter()
        .map(|hunk| hunk.id.clone())
        .collect::<HashSet<_>>();
    let selected = selected_ids.iter().cloned().collect::<HashSet<_>>();
    if selected.len() != selected_ids.len() || selected.iter().any(|id| !known.contains(id)) {
        return Err(BackendError::invalid_input(
            "La selección contiene un hunk desconocido o repetido.",
        ));
    }
    if selected_ids.is_empty() {
        return Ok(known);
    }
    Ok(selected)
}

fn apply_hunks(source: &str, hunks: Vec<&MarkdownHunk>) -> Result<String, BackendError> {
    let mut ranges = hunks
        .into_iter()
        .map(|hunk| {
            let start = hunk.anchor.start_byte;
            let end = hunk.anchor.end_byte;
            if start > end || end > source.len() || &source[start..end] != hunk.old_text {
                return Err(BackendError::new(
                    BackendErrorCode::Conflict,
                    "El anchor del preview ya no coincide con el documento.",
                    true,
                ));
            }
            Ok((start, end, hunk.new_text.as_str()))
        })
        .collect::<Result<Vec<_>, BackendError>>()?;
    ranges.sort_by_key(|range| range.0);
    if ranges.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err(BackendError::invalid_input(
            "Los hunks seleccionados se superponen.",
        ));
    }
    let mut result = source.to_string();
    for (start, end, replacement) in ranges.into_iter().rev() {
        result.replace_range(start..end, replacement);
    }
    Ok(result)
}

fn make_anchor(
    locator: &DocumentLocatorDto,
    kind: &MarkdownAnchorKind,
    label: &str,
    ordinal: usize,
    source: &str,
    start: usize,
    end: usize,
) -> MarkdownAnchor {
    let text = &source[start.min(source.len())..end.min(source.len())];
    let kind_name = format!("{kind:?}").to_lowercase();
    let identity = format!("{}|{}|{}|{}", locator.path(), kind_name, label, ordinal);
    let id = format!("anchor-{:016x}", stable_hash(&identity));
    MarkdownAnchor {
        id,
        kind: kind.clone(),
        label: label.to_string(),
        ordinal,
        start_byte: start,
        end_byte: end,
        start_line: line_number_at(source, start) as u32,
        end_line: line_number_at(source, end.max(start)) as u32,
        fingerprint: stable_hash(text),
    }
}

fn hunk_id(anchor: &MarkdownAnchor, new_text: &str) -> String {
    format!(
        "hunk-{:016x}",
        stable_hash(&format!("{}|{}", anchor.id, new_text))
    )
}

/// Adds the frontmatter properties every library note carries when they are
/// missing (`createdAt`, `nextPage`, `previousPage`, `contexto`). Returns
/// `None` when nothing changes, for empty documents and for malformed
/// frontmatter, which is never rewritten implicitly.
pub fn ensure_markdown_defaults(source: &str, created_at_ms: u64) -> Option<String> {
    if source.is_empty() {
        return None;
    }
    let metadata = frontmatter(source).ok()?;
    let newline = newline_for(source);
    let present = metadata
        .as_ref()
        .map(|metadata| {
            metadata
                .fields
                .iter()
                .map(|field| field.key.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let defaults = [
        ("createdAt", created_at_ms.to_string()),
        ("nextPage", "N/A".to_string()),
        ("previousPage", "N/A".to_string()),
        (
            "contexto",
            crate::library_config::DEFAULT_CONTEXT_TAG.to_string(),
        ),
    ];
    let missing = defaults
        .iter()
        .filter(|(key, _)| !present.iter().any(|existing| existing == key))
        .map(|(key, value)| format!("{key}: {}{newline}", serialize_value(value)))
        .collect::<String>();
    if missing.is_empty() {
        return None;
    }
    match metadata {
        Some(metadata) => {
            replace_range(source, metadata.close_start, metadata.close_start, &missing).ok()
        }
        None => Some(format!("---{newline}{missing}---{newline}{source}")),
    }
}

fn replace_range(
    source: &str,
    start: usize,
    end: usize,
    replacement: &str,
) -> Result<String, BackendError> {
    if start > end
        || end > source.len()
        || !source.is_char_boundary(start)
        || !source.is_char_boundary(end)
    {
        return Err(BackendError::invalid_input(
            "El rango Markdown no es válido.",
        ));
    }
    let mut result = source.to_string();
    result.replace_range(start..end, replacement);
    Ok(result)
}

fn frontmatter(source: &str) -> Result<Option<Frontmatter>, BackendError> {
    let lines = line_spans(source);
    if lines.first().is_none_or(|line| line.text != "---") {
        return Ok(None);
    }
    let close = lines
        .iter()
        .skip(1)
        .find(|line| line.text == "---" || line.text == "...")
        .ok_or_else(|| BackendError::invalid_input("El frontmatter no tiene cierre."))?;
    let mut fields = Vec::new();
    for line in lines
        .iter()
        .skip(1)
        .take_while(|line| line.start < close.start)
    {
        if line.text.trim().is_empty() || line.text.trim_start().starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.text.split_once(':') else {
            return Err(BackendError::invalid_input(
                "El frontmatter contiene una entrada inválida.",
            ));
        };
        let key = valid_key(key)?;
        let value_start = line.start + line.text.find(':').unwrap_or(0) + 1;
        let value_start = value_start
            + source[value_start..]
                .bytes()
                .take_while(|byte| *byte == b' ' || *byte == b'\t')
                .count();
        fields.push(FrontmatterField {
            key,
            line: line.clone(),
            value_start,
            value_end: line.text_end,
            value: value.trim().trim_matches('"').to_string(),
        });
    }
    Ok(Some(Frontmatter {
        close_start: close.start,
        fields,
    }))
}

fn wikilinks(source: &str) -> Result<Vec<MarkupSpan>, BackendError> {
    let ranges = semantic_ranges(source, "[[", "]]", MarkdownAnchorKind::Wikilink)?;
    Ok(ranges
        .into_iter()
        .filter_map(|(start, end, value)| {
            let label = value
                .split('|')
                .next()
                .unwrap_or_default()
                .split('#')
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            (!label.is_empty()).then_some((start, end, label))
        })
        .enumerate()
        .map(|(ordinal, (start, end, label))| MarkupSpan {
            start,
            end,
            label,
            ordinal,
        })
        .collect::<Vec<_>>())
}

fn templates(source: &str) -> Result<Vec<MarkupSpan>, BackendError> {
    let ranges = semantic_ranges(source, "{{", "}}", MarkdownAnchorKind::Template)?;
    Ok(ranges
        .into_iter()
        .filter_map(|(start, end, value)| {
            let label = value.trim().trim_start_matches('/').trim().to_string();
            (!label.is_empty()).then_some((start, end, label))
        })
        .enumerate()
        .map(|(ordinal, (start, end, label))| MarkupSpan {
            start,
            end,
            label,
            ordinal,
        })
        .collect())
}

fn semantic_ranges(
    source: &str,
    open: &str,
    close: &str,
    _kind: MarkdownAnchorKind,
) -> Result<Vec<(usize, usize, String)>, BackendError> {
    let mut ranges = Vec::new();
    let mut cursor: usize = 0;
    let mut in_fence: Option<(char, usize)> = None;
    for line in line_spans(source) {
        if let Some((character, length)) = fence_marker(&line.text) {
            match in_fence {
                Some((open_character, open_length))
                    if character == open_character && length >= open_length =>
                {
                    in_fence = None;
                }
                None => in_fence = Some((character, length)),
                _ => {}
            }
            continue;
        }
        if in_fence.is_some() {
            continue;
        }
        let mut position = line.start;
        while let Some(relative) = source[position..line.text_end].find(open) {
            let start = position + relative;
            let value_start = start + open.len();
            let Some(relative_end) = source[value_start..line.text_end].find(close) else {
                return Err(BackendError::invalid_input(
                    "Markdown con delimitador semántico sin cierre.",
                ));
            };
            let end = value_start + relative_end + close.len();
            ranges.push((
                start,
                end,
                source[value_start..end - close.len()].to_string(),
            ));
            position = end;
            cursor = cursor.saturating_add(1);
            if cursor > MAX_MARKDOWN_HUNKS {
                return Err(BackendError::invalid_input(
                    "El documento contiene demasiados elementos semánticos.",
                ));
            }
        }
    }
    Ok(ranges)
}

fn blocks(source: &str) -> Vec<BlockSpan> {
    let lines = line_spans(source);
    let mut result = Vec::new();
    let mut opening: Option<(LineSpan, char, usize, String)> = None;
    for line in lines {
        if let Some((open_line, character, length, language)) = &opening {
            if fence_marker(&line.text).is_some_and(|(close_character, close_length)| {
                close_character == *character && close_length >= *length
            }) {
                result.push(BlockSpan {
                    start: open_line.start,
                    end: line.end,
                    language: language.clone(),
                    ordinal: result.len(),
                });
                opening = None;
            }
        } else if let Some((character, length)) = fence_marker(&line.text) {
            let trimmed = line.text.trim_start();
            let language = trimmed[length..].trim().to_string();
            opening = Some((line, character, length, language));
        }
    }
    result
}

fn fact_parts(line: &LineSpan, source: &str) -> Option<(String, usize)> {
    let trimmed_start = line.text.len() - line.text.trim_start().len();
    let value = &line.text[trimmed_start..];
    let (key, _) = value.split_once("::")?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    let delimiter = line.start + trimmed_start + value.find("::")? + 2;
    let value_start = delimiter
        + source[delimiter..line.text_end]
            .bytes()
            .take_while(|byte| *byte == b' ' || *byte == b'\t')
            .count();
    Some((key.to_string(), value_start))
}

fn parse_tags(value: &str) -> Result<Vec<String>, BackendError> {
    let value = value.trim();
    let body = value
        .strip_prefix('[')
        .and_then(|body| body.strip_suffix(']'))
        .unwrap_or(value);
    body.split(',')
        .filter(|tag| !tag.trim().is_empty())
        .map(|tag| valid_tag(tag.trim().trim_matches(['\'', '"'])))
        .collect()
}

fn line_spans(source: &str) -> Vec<LineSpan> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, character) in source.char_indices() {
        if character == '\n' {
            let end = index + 1;
            let text_end =
                index - usize::from(index > start && source.as_bytes()[index - 1] == b'\r');
            lines.push(LineSpan {
                start,
                end,
                text_end,
                text: source[start..text_end].to_string(),
            });
            start = end;
        }
    }
    if start < source.len() || source.is_empty() {
        lines.push(LineSpan {
            start,
            end: source.len(),
            text_end: source.len(),
            text: source[start..].to_string(),
        });
    }
    lines
}

fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let character = trimmed.chars().next()?;
    if character != '`' && character != '~' {
        return None;
    }
    let length = trimmed
        .chars()
        .take_while(|value| *value == character)
        .count();
    (length >= 3).then_some((character, length))
}

fn newline_for(source: &str) -> &'static str {
    if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn serialize_value(value: &str) -> String {
    if value.contains('#') || value.contains(':') || value.contains('[') || value.contains(']') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn template_text(name: &str, body: &str) -> String {
    format!("{{{{{name}}}}}\n{body}\n{{{{/{name}}}}}")
}

fn block_text(language: &str, content: &str) -> String {
    let mut fence_length = 3;
    for line in content.lines() {
        let run = line
            .chars()
            .take_while(|character| *character == '`')
            .count();
        fence_length = fence_length.max(run + 1);
    }
    let fence = "`".repeat(fence_length);
    format!("{fence}{language}\n{content}\n{fence}")
}

fn wikilink_text(target: &str, alias: Option<&str>) -> Result<String, BackendError> {
    if let Some(alias) = alias {
        valid_value(alias)?;
        Ok(format!("[[{target}|{alias}]]"))
    } else {
        Ok(format!("[[{target}]]"))
    }
}

fn valid_key(value: &str) -> Result<String, BackendError> {
    let value = value.trim();
    if value.is_empty()
        || value
            .chars()
            .any(|character| character.is_control() || character == ':')
    {
        return Err(BackendError::invalid_input(
            "La clave Markdown no es válida.",
        ));
    }
    Ok(value.to_string())
}

fn valid_fact_key(value: &str) -> Result<String, BackendError> {
    let value = valid_key(value)?;
    if value.contains('\n') {
        return Err(BackendError::invalid_input(
            "La clave del fact no es válida.",
        ));
    }
    Ok(value)
}

fn valid_name(value: &str) -> Result<String, BackendError> {
    let value = valid_key(value)?;
    if value.contains("{{") || value.contains("}}") {
        return Err(BackendError::invalid_input(
            "El nombre Markdown no es válido.",
        ));
    }
    Ok(value)
}

fn valid_value(value: &str) -> Result<(), BackendError> {
    if value
        .chars()
        .any(|character| character == '\0' || character == '\r')
    {
        return Err(BackendError::invalid_input(
            "El contenido Markdown no es válido.",
        ));
    }
    Ok(())
}

fn valid_tag(value: &str) -> Result<String, BackendError> {
    let value = value.trim().trim_start_matches('#');
    if value.is_empty()
        || value.chars().count() > MAX_MARKDOWN_TAG_CHARS
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        || value.contains('/')
        || value.contains("..")
    {
        return Err(BackendError::invalid_input("El tag Markdown no es válido."));
    }
    Ok(value.to_string())
}

fn valid_wikilink_target(value: &str) -> Result<String, BackendError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().any(char::is_control)
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.contains('\\')
        || value.contains("://")
        || value.split('/').any(|part| part == "." || part == "..")
    {
        return Err(BackendError::invalid_input(
            "El destino del wikilink no es válido.",
        ));
    }
    Ok(value.to_string())
}

fn document_id_from_locator(locator: &DocumentLocatorDto) -> String {
    locator.path().to_string()
}

fn field_ordinal(fields: &[FrontmatterField], key: &str) -> usize {
    fields
        .iter()
        .position(|field| field.key == key)
        .unwrap_or(0)
}

fn child_operation_id(parent: &str, index: usize, path: &str) -> String {
    format!("{parent}:{index}-{:016x}", stable_hash(path))
}

fn validate_operation_id(operation_id: &str) -> Result<(), BackendError> {
    if operation_id.trim().is_empty()
        || operation_id.chars().count() > 200
        || operation_id.chars().any(char::is_control)
    {
        return Err(BackendError::invalid_input("operationId no es válido."));
    }
    Ok(())
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

fn scope_error(message: &'static str) -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, message, false)
}

fn stable_hash(value: &str) -> u64 {
    compute_document_revision(value)
}

fn line_number_at(source: &str, byte_offset: usize) -> usize {
    source[..byte_offset.min(source.len())]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_tools::{DocumentKind, InMemoryLibrary, SeedDocument};

    fn locator(path: &str) -> DocumentLocatorDto {
        DocumentLocatorDto::new("library-a", path, None, None).expect("locator")
    }

    fn request(path: &str, operation: MarkdownOperation) -> MarkdownEditRequest {
        MarkdownEditRequest {
            operation_id: "markdown-op".into(),
            locator: locator(path),
            expected_revision: None,
            operation,
        }
    }

    fn library() -> InMemoryLibrary {
        let library = InMemoryLibrary::new("library-a").expect("library");
        library
            .add_document(SeedDocument {
                document_id: "doc-a".into(),
                locator: locator("notes/a.md"),
                title: "A".into(),
                kind: DocumentKind::Markdown,
                content: "---\ntags: [one]\npriority: low\n---\n# A\n\nSee [[B]].\n\nstatus:: draft\n\n```rust\n[[not-a-link]]\n```\n".into(),
                modified_at: None,
            })
            .expect("document");
        library
            .add_document(SeedDocument {
                document_id: "doc-b".into(),
                locator: locator("notes/b.md"),
                title: "B".into(),
                kind: DocumentKind::Markdown,
                content: "# B\n".into(),
                modified_at: None,
            })
            .expect("document");
        library
    }

    #[test]
    fn anchors_are_stable_and_preview_does_not_mutate() {
        let library = library();
        let request = request(
            "notes/a.md",
            MarkdownOperation::SetFrontmatter {
                key: "priority".into(),
                value: "high".into(),
            },
        );
        let first = preview_markdown_edit_from_port(&library, &request).expect("preview");
        let second = preview_markdown_edit_from_port(&library, &request).expect("preview");
        assert_eq!(first.anchors, second.anchors);
        assert_eq!(first.hunks, second.hunks);
        assert_eq!(
            library
                .read_document(&locator("notes/a.md"))
                .unwrap()
                .content,
            first.old_content
        );
    }

    #[test]
    fn malformed_markdown_is_rejected_before_preview() {
        let result = preview_markdown_edit(
            "# title\n```rust\nmissing close",
            &request("notes/a.md", MarkdownOperation::AddTag { tag: "x".into() }),
        );
        assert_eq!(result.unwrap_err().code, BackendErrorCode::InvalidInput);
    }

    #[test]
    fn semantic_targets_reject_traversal() {
        let result = preview_markdown_edit(
            "# title\n",
            &request(
                "notes/a.md",
                MarkdownOperation::AddWikilink {
                    target: "../secret".into(),
                    alias: None,
                },
            ),
        );
        assert!(result.is_err());
        let tag = preview_markdown_edit(
            "# title\n",
            &request(
                "notes/a.md",
                MarkdownOperation::AddTag {
                    tag: "../secret".into(),
                },
            ),
        );
        assert!(tag.is_err());
    }

    #[test]
    fn fenced_semantics_are_not_treated_as_document_markup() {
        let preview = preview_markdown_edit(
            "```md\n[[code-only]]\n```\n",
            &request(
                "notes/a.md",
                MarkdownOperation::AddWikilink {
                    target: "real-note".into(),
                    alias: None,
                },
            ),
        )
        .expect("preview");
        assert!(preview
            .anchors
            .iter()
            .all(|anchor| anchor.label != "code-only"));
    }

    #[test]
    fn markdown_defaults_fill_only_missing_properties() {
        let source = "---\ncontexto: \"#Laboral\"\n---\nCuerpo\n";
        let updated = ensure_markdown_defaults(source, 42).expect("defaults");
        assert_eq!(
            updated,
            "---\ncontexto: \"#Laboral\"\ncreatedAt: 42\nnextPage: N/A\npreviousPage: N/A\n---\nCuerpo\n"
        );
        assert_eq!(ensure_markdown_defaults(&updated, 7), None);
    }

    #[test]
    fn markdown_defaults_create_frontmatter_and_skip_empty_or_malformed_documents() {
        assert_eq!(
            ensure_markdown_defaults("Hola\r\n", 1).expect("created"),
            "---\r\ncreatedAt: 1\r\nnextPage: N/A\r\npreviousPage: N/A\r\ncontexto: \"#Personal\"\r\n---\r\nHola\r\n"
        );
        assert_eq!(ensure_markdown_defaults("", 1), None);
        assert_eq!(ensure_markdown_defaults("---\nsin cierre\n", 1), None);
    }

    #[test]
    fn adding_a_tag_creates_list_frontmatter_without_mutation() {
        let preview = preview_markdown_edit(
            "# title\n",
            &request(
                "notes/a.md",
                MarkdownOperation::AddTag { tag: "work".into() },
            ),
        )
        .expect("preview");
        assert!(preview.new_content.starts_with("---\ntags: [work]"));
        assert_eq!(preview.old_content, "# title\n");
    }

    #[test]
    fn materializing_a_preview_is_bounded_to_selected_hunks() {
        let preview = preview_markdown_edit(
            "# title\n",
            &request(
                "notes/a.md",
                MarkdownOperation::AddTag { tag: "work".into() },
            ),
        )
        .expect("preview");
        let selected = materialize_markdown_preview(
            &preview,
            &[preview.hunks[0].id.clone()],
        )
        .expect("materialized")
        .expect("selected hunk");
        assert_eq!(selected, preview.new_content);
        assert!(materialize_markdown_preview(&preview, &[])
            .expect("empty selection")
            .is_none());
    }

    #[test]
    fn stale_revision_and_selected_hunk_are_safe() {
        let library = library();
        let mut request = request(
            "notes/a.md",
            MarkdownOperation::SetFact {
                key: "status".into(),
                value: "ready".into(),
            },
        );
        let preview = preview_markdown_edit_from_port(&library, &request).expect("preview");
        library
            .write_atomic(&AtomicWriteRequest {
                operation_id: "other".into(),
                locator: locator("notes/a.md"),
                content: "# changed\n".into(),
                expected_revision: preview.expected_revision,
            })
            .expect("other write");
        let error = apply_markdown_preview(&library, &preview, &[]).expect_err("stale");
        assert_eq!(error.code, BackendErrorCode::Conflict);
        request.expected_revision = Some(preview.expected_revision);
        assert!(preview_markdown_edit_from_port(&library, &request).is_err());
    }

    #[test]
    fn multi_document_preview_and_apply_are_isolated() {
        let library = library();
        let preview = preview_multi_document_markdown_edit(
            &library,
            &MultiDocumentMarkdownEditRequest {
                operation_id: "multi".into(),
                edits: vec![
                    MarkdownDocumentEdit {
                        locator: locator("notes/a.md"),
                        operation: MarkdownOperation::AddTag { tag: "two".into() },
                    },
                    MarkdownDocumentEdit {
                        locator: locator("notes/b.md"),
                        operation: MarkdownOperation::SetFrontmatter {
                            key: "title".into(),
                            value: "B".into(),
                        },
                    },
                ],
            },
        )
        .expect("multi preview");
        assert_eq!(preview.previews.len(), 2);
        assert_eq!(
            library
                .read_document(&locator("notes/b.md"))
                .unwrap()
                .content,
            "# B\n"
        );
        let result = apply_multi_document_markdown_preview(&library, &preview, &[]).expect("apply");
        assert!(result.changed);
        assert!(library
            .read_document(&locator("notes/a.md"))
            .unwrap()
            .content
            .contains("two"));
        assert!(library
            .read_document(&locator("notes/b.md"))
            .unwrap()
            .content
            .starts_with("---"));
    }
}
