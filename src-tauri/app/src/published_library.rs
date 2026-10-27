//! What a published Task Manager page sees of the library besides its
//! boards: the notes whose context is the context of a published board.
//!
//! A guest can browse those notes as a tree, open and edit them, create
//! new ones (always with the board's context), rename, move and delete
//! them, and see their graph. Every read and write checks the note against
//! the published contexts here, never in the page; a write that changes a
//! note's context is refused. Paths cross the boundary as
//! `published-vault/<logical path>`, so the host path never leaks.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use notia_backend_core::library_graph::{frontmatter_context, note_context, GraphModelDto};
use notia_backend_core::library_tree::{LibraryNodeKind, LibraryTreeNodeDto};
use notia_backend_core::task_board_plan::fold;
use notia_backend_core::task_manager_ui::DEFAULT_CONTEXT_TAG;
use notia_backend_core::{BackendError, BackendErrorCode};
use serde::Deserialize;
use serde_json::Value;

use crate::filesystem::types::{OperationResult, WriteLibraryFileResult};
use crate::host::AppHandle;
use crate::library_registry::LibraryBindingRegistry;
use crate::library_session::{LibraryDocumentPayload, LibraryDocumentReadDto};
use crate::task_manager_commands::TaskManagerBackendState;

/// The library root as the published page names it.
pub(crate) const PUBLISHED_VAULT_ALIAS: &str = "published-vault";
const MAX_NOTE_NAME_CHARS: usize = 160;

/// What a published session may reach in the library.
#[derive(Debug, Clone)]
pub(crate) struct PublishedLibraryScope {
    pub library_id: String,
    /// Contexts of the published boards, folded for comparison.
    pub contexts: BTreeSet<String>,
    /// The contexts as the boards spell them, first the active board's.
    pub context_tags: Vec<String>,
    /// Tickets of the published boards, by logical path.
    pub ticket_paths: HashSet<String>,
}

fn forbidden(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, message, false)
}

fn invalid(message: &str) -> BackendError {
    BackendError::invalid_input(message)
}

/// Logical path behind an identity the page sends (`published-vault/...`,
/// a bare logical path, or the alias alone for the root).
pub(crate) fn logical_path_of(identity: &str) -> Result<String, BackendError> {
    let value = identity.trim().replace('\\', "/");
    let value = value.trim_matches('/');
    let logical = value
        .strip_prefix(PUBLISHED_VAULT_ALIAS)
        .map(|rest| rest.trim_start_matches('/'))
        .unwrap_or(value);
    if logical.contains("://") || logical.starts_with('/') || logical.as_bytes().get(1) == Some(&b':') {
        return Err(forbidden("La ruta está fuera de la biblioteca publicada."));
    }
    if logical.split('/').any(|segment| segment == "." || segment == "..") {
        return Err(forbidden("La ruta está fuera de la biblioteca publicada."));
    }
    Ok(logical.to_string())
}

/// Whether the page sent an identity of the published library (the alias
/// alone or `published-vault/...`), as opposed to a ticket's logical path.
pub(crate) fn is_alias_path(identity: &str) -> bool {
    let value = identity.trim().replace('\\', "/");
    let value = value.trim_start_matches('/');
    value == PUBLISHED_VAULT_ALIAS || value.starts_with(&format!("{PUBLISHED_VAULT_ALIAS}/"))
}

/// `published-vault/<logical>`; the alias alone for the root.
pub(crate) fn alias_path(logical: &str) -> String {
    let logical = logical.trim_matches('/');
    if logical.is_empty() {
        PUBLISHED_VAULT_ALIAS.to_string()
    } else {
        format!("{PUBLISHED_VAULT_ALIAS}/{logical}")
    }
}

/// Hidden folders (`.notia`, `.agent`) and the Task Manager indexes never
/// show.
fn is_private_path(logical: &str) -> bool {
    logical.split('/').any(|segment| segment.starts_with('.'))
}

fn is_task_root(segment: &str) -> bool {
    segment.eq_ignore_ascii_case("task-manager") || segment.eq_ignore_ascii_case("task-mannager")
}

fn in_task_workspace(logical: &str) -> bool {
    logical.split('/').next().is_some_and(is_task_root)
}

/// The scope of a published session: the contexts of its boards and their
/// tickets, from the scoped snapshot (never from the page).
pub(crate) fn scope(
    app: &AppHandle,
    state: &TaskManagerBackendState,
    registry: &LibraryBindingRegistry,
    library_id: &str,
    library_user_id: &str,
    board_ids: Vec<String>,
    active_board: Option<&str>,
) -> Result<PublishedLibraryScope, BackendError> {
    if board_ids.is_empty() {
        return Err(forbidden("La publicación no tiene tableros."));
    }
    let read = crate::task_manager_commands::task_manager_snapshot_for_publication(
        app,
        state,
        registry,
        library_id,
        library_user_id,
        board_ids,
    )?;
    let snapshot = read.snapshot;
    let mut boards = snapshot.boards.clone();
    // The active board's context comes first: a new note takes it.
    if let Some(active) = active_board.map(fold) {
        boards.sort_by_key(|board| fold(&board.name) != active);
    }
    let mut context_tags = Vec::new();
    for board in &boards {
        let tag = board.context.clone().unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string());
        if !context_tags.iter().any(|known: &String| fold(known) == fold(&tag)) {
            context_tags.push(tag);
        }
    }
    Ok(PublishedLibraryScope {
        library_id: library_id.to_string(),
        contexts: context_tags.iter().map(|tag| fold(tag)).collect(),
        context_tags,
        ticket_paths: snapshot.tickets.into_iter().map(|ticket| ticket.summary.logical_path).collect(),
    })
}

impl PublishedLibraryScope {
    fn allows_context(&self, context: Option<&str>) -> bool {
        context.is_some_and(|tag| self.contexts.contains(&fold(tag)))
    }

    /// Whether a note with `context` at `logical` is visible: a ticket of a
    /// published board, or a note outside the Task Manager folder with one
    /// of the published contexts.
    fn admits(&self, logical: &str, context: Option<&str>) -> bool {
        if is_private_path(logical) {
            return false;
        }
        if in_task_workspace(logical) {
            return self.ticket_paths.contains(logical);
        }
        self.allows_context(context)
    }

    /// Context a new note gets: the one the page asks for when it is one of
    /// the published boards', else the active board's.
    fn context_for_new(&self, requested: Option<&str>) -> String {
        requested
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .and_then(|tag| self.context_tags.iter().find(|known| fold(known) == fold(tag)))
            .or_else(|| self.context_tags.first())
            .cloned()
            .unwrap_or_else(|| DEFAULT_CONTEXT_TAG.to_string())
    }
}

/// The visible notes with their context, by logical path.
fn visible_notes(app: &AppHandle, scope: &PublishedLibraryScope, revision: u64) -> Result<BTreeMap<String, Option<String>>, BackendError> {
    let graph = crate::library_graph::cached_graph(app, &scope.library_id, revision)?;
    let boards = crate::library_graph::board_contexts(app, &scope.library_id);
    Ok(graph
        .sources
        .iter()
        .filter_map(|(path, content)| {
            let context = note_context(path, content, &boards);
            scope.admits(path, context.as_deref()).then(|| (path.clone(), context))
        })
        .collect())
}

/// Whether the note at `logical` is visible now, reading it from disk.
fn visible_note_context(app: &AppHandle, scope: &PublishedLibraryScope, logical: &str) -> Result<Option<String>, BackendError> {
    if logical.is_empty() || !logical.to_ascii_lowercase().ends_with(".md") || is_private_path(logical) {
        return Err(forbidden("La nota no está en la biblioteca publicada."));
    }
    if in_task_workspace(logical) {
        return if scope.ticket_paths.contains(logical) {
            Ok(crate::task_manager_commands::board_context_of_document(app, &scope.library_id, logical))
        } else {
            Err(forbidden("La nota no está en la biblioteca publicada."))
        };
    }
    let text = crate::library_session::read_library_text(app, &scope.library_id, logical)
        .map_err(|_| forbidden("La nota no está en la biblioteca publicada."))?;
    let context = frontmatter_context(&text);
    if scope.allows_context(context.as_deref()) {
        Ok(context)
    } else {
        Err(forbidden("La nota no está en la biblioteca publicada."))
    }
}

/// The logical path of a note the guest may read and write (its strokes
/// included), or `Forbidden`.
pub(crate) fn authorized_note(app: &AppHandle, scope: &PublishedLibraryScope, identity: &str) -> Result<String, BackendError> {
    let logical = logical_path_of(identity)?;
    visible_note_context(app, scope, &logical)?;
    Ok(logical)
}

/// Whether every visible note under `folder` is the whole of it: a folder
/// the guest may rename, move or delete.
fn folder_is_fully_visible(app: &AppHandle, scope: &PublishedLibraryScope, folder: &str) -> Result<bool, BackendError> {
    let (files, _) = crate::library_inventory::inventory_files(app, &scope.library_id)?;
    let prefix = format!("{}/", folder.trim_matches('/'));
    let visible = visible_notes(app, scope, 0)?;
    let mut any = false;
    for file in files.iter().filter(|file| file.starts_with(&prefix)) {
        any = true;
        if !visible.contains_key(file) {
            return Ok(false);
        }
    }
    Ok(any)
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/// Folders and notes under `under` (a logical folder; empty, the root),
/// folders first, by name, every folder with its children.
pub(crate) fn tree_of(paths: &[String], under: &str) -> Vec<LibraryTreeNodeDto> {
    let under = under.trim_matches('/');
    let prefix = if under.is_empty() { String::new() } else { format!("{under}/") };
    let mut folders = BTreeSet::new();
    let mut files = Vec::new();
    for path in paths {
        let Some(rest) = path.strip_prefix(&prefix) else { continue };
        if rest.is_empty() {
            continue;
        }
        match rest.split_once('/') {
            Some((folder, _)) => {
                folders.insert(folder.to_string());
            }
            None => files.push(rest.to_string()),
        }
    }
    let mut nodes = folders
        .into_iter()
        .map(|name| {
            let logical = format!("{prefix}{name}");
            let children = tree_of(paths, &logical);
            LibraryTreeNodeDto {
                id: alias_path(&logical),
                name,
                path: Some(alias_path(&logical)),
                node_type: LibraryNodeKind::Folder,
                expanded: Some(false),
                has_children: Some(!children.is_empty()),
                children: Some(children),
                created_at: None,
                modified_at: None,
                next_page: None,
                previous_page: None,
                context: None,
            }
        })
        .collect::<Vec<_>>();
    nodes.sort_by_key(|node| node.name.to_lowercase());
    files.sort_by_key(|name| name.to_lowercase());
    nodes.extend(files.into_iter().map(|name| {
        let logical = format!("{prefix}{name}");
        LibraryTreeNodeDto {
            id: alias_path(&logical),
            name,
            path: Some(alias_path(&logical)),
            node_type: LibraryNodeKind::File,
            expanded: None,
            has_children: None,
            children: None,
            created_at: None,
            modified_at: None,
            next_page: None,
            previous_page: None,
            context: None,
        }
    }));
    nodes
}

/// `library_read_directory` of the publication: the visible notes under a
/// folder, with every subfolder already loaded.
pub(crate) fn read_directory(app: &AppHandle, scope: &PublishedLibraryScope, identity: &str) -> Result<Vec<LibraryTreeNodeDto>, BackendError> {
    let under = logical_path_of(identity)?;
    let paths = visible_notes(app, scope, 0)?.into_keys().collect::<Vec<_>>();
    let mut nodes = tree_of(&paths, &under);
    notia_backend_core::folder_contexts::mark_tree(&mut nodes, &under, &crate::folder_contexts::load(app, &scope.library_id));
    Ok(nodes)
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/// `library_read_document` of the publication: a visible note, with its
/// context locked so the editor shows it but never changes it.
pub(crate) fn read_document(
    app: &AppHandle,
    scope: &PublishedLibraryScope,
    identity: &str,
    markdown_defaults: bool,
) -> Result<LibraryDocumentReadDto, BackendError> {
    let logical = logical_path_of(identity)?;
    let context = visible_note_context(app, scope, &logical)?;
    let result = crate::library_session::read_document(
        app,
        LibraryDocumentPayload {
            library_id: scope.library_id.clone(),
            path: logical.clone(),
            content: None,
            expected_revision: None,
            create_if_missing: false,
            markdown_defaults,
            base_content: None,
        },
    );
    Ok(LibraryDocumentReadDto {
        locked_context_source: context.is_some().then_some(crate::library_session::LockedContextSource::Board),
        locked_context: context,
        // The published page never reaches `.agent`: its notes are the boards'.
        read_only: None,
        logical_path: result.ok.then(|| logical.clone()),
        ok: result.ok,
        content: result.content,
        revision: result.revision,
        error: result.error,
    })
}

/// The context a written note must keep: the one it has, or the board's
/// for a new one. `None` when the content changes it.
pub(crate) fn kept_context<'a>(current: Option<&'a str>, content: &str, scope: &'a PublishedLibraryScope) -> Option<String> {
    let written = frontmatter_context(content);
    match current {
        Some(current) => written.filter(|tag| fold(tag) == fold(current)),
        None => written.filter(|tag| scope.allows_context(Some(tag))),
    }
}

/// `library_write_document` of the publication: writes a visible note, or
/// creates one with a published context, refusing a content that changes
/// the note's context.
pub(crate) fn write_document(
    app: &AppHandle,
    scope: &PublishedLibraryScope,
    identity: &str,
    content: String,
    expected_revision: Option<String>,
    create_if_missing: bool,
) -> Result<WriteLibraryFileResult, BackendError> {
    let logical = logical_path_of(identity)?;
    if in_task_workspace(&logical) && !scope.ticket_paths.contains(&logical) {
        return Err(forbidden("La nota no está en la biblioteca publicada."));
    }
    let existing = visible_note_context(app, scope, &logical);
    let current = match existing {
        Ok(context) => context,
        Err(error) => {
            // A note that is not there yet is created with the board's context.
            let is_new = create_if_missing
                && expected_revision.is_none()
                && !in_task_workspace(&logical)
                && !crate::library_session::read_library_text(app, &scope.library_id, &logical).is_ok();
            if !is_new {
                return Err(error);
            }
            None
        }
    };
    if kept_context(current.as_deref(), &content, scope).is_none() {
        return Err(invalid("El contexto de la nota lo define el tablero publicado y no se puede cambiar."));
    }
    Ok(crate::library_session::library_write_document(
        app.clone(),
        LibraryDocumentPayload {
            library_id: scope.library_id.clone(),
            path: logical,
            content: Some(content),
            expected_revision,
            create_if_missing,
            markdown_defaults: false,
            base_content: None,
        },
    ))
}

// ---------------------------------------------------------------------------
// Explorer operations
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishedEntryPayload {
    /// `create`, `delete`, `rename` or `paste`.
    pub action: String,
    /// Entry, parent folder for `create`, destination folder for `paste`.
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    /// `note` or `folder` for `create`.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    /// Context a new note takes; one of the published boards', else the
    /// active board's.
    #[serde(default)]
    pub contexto: Option<String>,
}

/// A note or folder name the explorer accepts.
pub(crate) fn validate_entry_name(name: &str) -> Result<String, BackendError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NOTE_NAME_CHARS {
        return Err(invalid("El nombre no es válido."));
    }
    if name == "." || name == ".." || name.starts_with('.') || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err(invalid("El nombre no puede tener separadores ni empezar con punto."));
    }
    if name.chars().any(char::is_control) {
        return Err(invalid("El nombre no es válido."));
    }
    Ok(name.to_string())
}

/// Frontmatter of a note the guest creates.
pub(crate) fn new_note_content(context: &str) -> String {
    format!("---\ncontexto: \"{}\"\n---\n", context.replace('"', ""))
}

/// Whether the guest may change (rename, move, delete) the entry at
/// `logical`: a visible note, or a folder whose notes are all visible.
fn ensure_editable_entry(app: &AppHandle, scope: &PublishedLibraryScope, logical: &str) -> Result<(), BackendError> {
    if logical.is_empty() || is_private_path(logical) || in_task_workspace(logical) {
        return Err(forbidden("Esa entrada no se puede cambiar desde el tablero publicado."));
    }
    if logical.to_ascii_lowercase().ends_with(".md") {
        visible_note_context(app, scope, logical)?;
        return Ok(());
    }
    if folder_is_fully_visible(app, scope, logical)? {
        Ok(())
    } else {
        Err(forbidden("La carpeta tiene notas de otros contextos: no se puede cambiar desde el tablero publicado."))
    }
}

/// A folder the guest may create in or move into: the root, or a folder
/// outside the Task Manager and the hidden folders.
fn ensure_target_folder(logical: &str) -> Result<(), BackendError> {
    if logical.is_empty() {
        return Ok(());
    }
    if is_private_path(logical) || in_task_workspace(logical) {
        return Err(forbidden("Esa carpeta no está en la biblioteca publicada."));
    }
    Ok(())
}

/// The context a folder forces on the notes inside it, when it has one.
/// A guest only writes there when it is one of the published contexts:
/// otherwise the note would leave the publication.
fn folder_context_for_guest(app: &AppHandle, scope: &PublishedLibraryScope, folder: &str) -> Result<Option<String>, BackendError> {
    let probe = if folder.is_empty() { "nota.md".to_string() } else { format!("{folder}/nota.md") };
    match crate::folder_contexts::effective(app, &scope.library_id, &probe) {
        Some(tag) if !scope.allows_context(Some(&tag)) => {
            Err(forbidden("Esa carpeta tiene un contexto que no está en el tablero publicado."))
        }
        context => Ok(context),
    }
}

/// `library_mutate_entry` of the publication.
pub(crate) fn mutate_entry(app: &AppHandle, scope: &PublishedLibraryScope, payload: PublishedEntryPayload) -> Result<OperationResult, BackendError> {
    let logical = logical_path_of(&payload.path)?;
    match payload.action.as_str() {
        "create" => {
            ensure_target_folder(&logical)?;
            let kind = payload.kind.as_deref().unwrap_or("note");
            let name = validate_entry_name(payload.name.as_deref().unwrap_or_default())?;
            match kind {
                "folder" => Ok(crate::library_session::mutate_entry_at(app, &scope.library_id, "create", &logical, Some(&name), Some("folder"), None, None)),
                "note" => {
                    let file = if name.to_ascii_lowercase().ends_with(".md") { name } else { format!("{name}.md") };
                    let note = if logical.is_empty() { file } else { format!("{logical}/{file}") };
                    if crate::library_session::read_library_text(app, &scope.library_id, &note).is_ok() {
                        return Err(invalid("Ya existe una nota con ese nombre."));
                    }
                    let context = folder_context_for_guest(app, scope, &logical)?
                        .unwrap_or_else(|| scope.context_for_new(payload.contexto.as_deref()));
                    let result = crate::library_session::library_write_document(
                        app.clone(),
                        LibraryDocumentPayload {
                            library_id: scope.library_id.clone(),
                            path: note,
                            content: Some(new_note_content(&context)),
                            expected_revision: None,
                            create_if_missing: true,
                            markdown_defaults: false,
                            base_content: None,
                        },
                    );
                    if result.ok {
                        crate::library_session::reindex_in_background(app, &scope.library_id);
                    }
                    Ok(OperationResult { ok: result.ok, error: result.error })
                }
                _ => Err(invalid("Desde el tablero publicado solo se crean notas y carpetas.")),
            }
        }
        "rename" => {
            ensure_editable_entry(app, scope, &logical)?;
            let name = validate_entry_name(payload.name.as_deref().unwrap_or_default())?;
            Ok(crate::library_session::mutate_entry_at(app, &scope.library_id, "rename", &logical, Some(&name), None, None, None))
        }
        "delete" => {
            ensure_editable_entry(app, scope, &logical)?;
            Ok(crate::library_session::mutate_entry_at(app, &scope.library_id, "delete", &logical, None, None, None, None))
        }
        "paste" => {
            ensure_target_folder(&logical)?;
            folder_context_for_guest(app, scope, &logical)?;
            let source = logical_path_of(payload.source_path.as_deref().unwrap_or_default())?;
            ensure_editable_entry(app, scope, &source)?;
            let mode = payload.mode.as_deref().unwrap_or("move");
            if mode != "move" && mode != "copy" {
                return Err(invalid("La operación no es válida."));
            }
            Ok(crate::library_session::mutate_entry_at(app, &scope.library_id, "paste", &logical, None, None, Some(&source), Some(mode)))
        }
        _ => Err(invalid("La operación no es válida.")),
    }
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

fn aliased(mut model: GraphModelDto) -> GraphModelDto {
    for node in &mut model.nodes {
        node.id = alias_path(&node.id);
        node.path = alias_path(&node.path);
        for neighbor in &mut node.neighbors {
            *neighbor = alias_path(neighbor);
        }
    }
    for path in &mut model.summary.top_connected {
        *path = alias_path(path);
    }
    for edge in &mut model.edges {
        edge.source_path = alias_path(&edge.source_path);
        edge.target_path = alias_path(&edge.target_path);
        edge.id = format!("{}<=>{}", edge.source_path, edge.target_path);
    }
    model
}

/// `backend_library_graph` of the publication: the graph of the visible
/// notes, with the paths the page names.
pub(crate) fn graph(app: &AppHandle, scope: &PublishedLibraryScope, revision: u64) -> Result<GraphModelDto, BackendError> {
    let visible = visible_notes(app, scope, revision)?;
    let graph = crate::library_graph::cached_graph(app, &scope.library_id, revision)?;
    let restricted = notia_backend_core::library_graph::restrict_graph_model(&graph.model, |path| visible.contains_key(path));
    Ok(aliased(notia_backend_core::library_graph::graph_view_model(&restricted)))
}

/// `backend_library_graph_search` of the publication.
pub(crate) fn graph_search(app: &AppHandle, scope: &PublishedLibraryScope, revision: u64, query: &str, max_results: usize) -> Result<Value, BackendError> {
    let visible = visible_notes(app, scope, revision)?;
    let graph = crate::library_graph::cached_graph(app, &scope.library_id, revision)?;
    let restricted = notia_backend_core::library_graph::restrict_graph_model(&graph.model, |path| visible.contains_key(path));
    let model = notia_backend_core::library_graph::graph_view_model(&restricted);
    let sources = graph
        .sources
        .iter()
        .filter(|(path, _)| visible.contains_key(path.as_str()))
        .map(|(path, content)| (path.clone(), content.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut results = notia_backend_core::library_graph::search_library_graph(&model, &sources, query, max_results);
    for result in &mut results {
        result.path = alias_path(&result.path);
    }
    serde_json::to_value(results).map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo serializar la búsqueda.", true))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope_with(contexts: &[&str], tickets: &[&str]) -> PublishedLibraryScope {
        PublishedLibraryScope {
            library_id: "lib".into(),
            contexts: contexts.iter().map(|tag| fold(tag)).collect(),
            context_tags: contexts.iter().map(|tag| tag.to_string()).collect(),
            ticket_paths: tickets.iter().map(|path| path.to_string()).collect(),
        }
    }

    #[test]
    fn paths_cross_the_boundary_with_the_alias_and_never_leave_the_library() {
        assert_eq!(logical_path_of("published-vault/Ideas/Nota.md").unwrap(), "Ideas/Nota.md");
        assert_eq!(logical_path_of("published-vault").unwrap(), "");
        assert_eq!(logical_path_of("Ideas/Nota.md").unwrap(), "Ideas/Nota.md");
        assert!(logical_path_of("published-vault/../secreto.md").is_err());
        assert!(logical_path_of("C:/Users/x/nota.md").is_err());
        assert!(logical_path_of("content://x/y").is_err());
        assert_eq!(alias_path(""), "published-vault");
        assert_eq!(alias_path("Ideas/Nota.md"), "published-vault/Ideas/Nota.md");
        assert!(is_alias_path("published-vault"));
        assert!(is_alias_path("published-vault/Ideas/Nota.md"));
        assert!(!is_alias_path("published-vaulted/Nota.md"));
        assert!(!is_alias_path("task-manager/tasks/default/Informe.md"));
    }

    #[test]
    fn only_notes_of_the_published_contexts_and_the_published_tickets_are_visible() {
        let scope = scope_with(&["#Laboral"], &["task-manager/tasks/default/Informe.md"]);
        assert!(scope.admits("Ideas/Plan.md", Some("#laboral")));
        assert!(!scope.admits("Ideas/Plan.md", Some("#Personal")));
        assert!(!scope.admits("Ideas/Plan.md", None));
        assert!(scope.admits("task-manager/tasks/default/Informe.md", Some("#Laboral")));
        assert!(!scope.admits("task-manager/tasks/otro/Secreta.md", Some("#Laboral")));
        assert!(!scope.admits(".agent/memory/memory.md", Some("#Laboral")));
        assert!(!scope.admits("Ideas/.notia/ink/x.md", Some("#Laboral")));
    }

    #[test]
    fn the_tree_groups_the_visible_notes_by_folder() {
        let paths = vec![
            "Ideas/Plan.md".to_string(),
            "Ideas/Q1/Metas.md".to_string(),
            "Raíz.md".to_string(),
            "task-manager/tasks/default/Informe.md".to_string(),
        ];
        let tree = tree_of(&paths, "");
        assert_eq!(tree.iter().map(|node| node.name.as_str()).collect::<Vec<_>>(), ["Ideas", "task-manager", "Raíz.md"]);
        let ideas = &tree[0];
        assert_eq!(ideas.path.as_deref(), Some("published-vault/Ideas"));
        let children = ideas.children.as_ref().unwrap();
        assert_eq!(children.iter().map(|node| node.name.as_str()).collect::<Vec<_>>(), ["Q1", "Plan.md"]);
        assert_eq!(children[1].id, "published-vault/Ideas/Plan.md");
        assert_eq!(tree_of(&paths, "published-vault/Ideas/Q1").len(), 0);
        assert_eq!(tree_of(&paths, "Ideas/Q1")[0].name, "Metas.md");
    }

    #[test]
    fn a_write_keeps_the_context_and_a_new_note_takes_a_published_one() {
        let scope = scope_with(&["#Laboral", "#Facultad"], &[]);
        assert_eq!(kept_context(Some("#Laboral"), "---\ncontexto: \"#laboral\"\n---\nHola", &scope).as_deref(), Some("#laboral"));
        assert!(kept_context(Some("#Laboral"), "---\ncontexto: \"#Personal\"\n---\n", &scope).is_none());
        assert!(kept_context(Some("#Laboral"), "Sin frontmatter", &scope).is_none());
        assert_eq!(kept_context(None, "---\ncontexto: \"#Facultad\"\n---\n", &scope).as_deref(), Some("#Facultad"));
        assert!(kept_context(None, "---\ncontexto: \"#Personal\"\n---\n", &scope).is_none());
        assert_eq!(scope.context_for_new(Some("#facultad")), "#Facultad");
        assert_eq!(scope.context_for_new(Some("#Personal")), "#Laboral");
        assert_eq!(scope.context_for_new(None), "#Laboral");
        assert_eq!(new_note_content("#Laboral"), "---\ncontexto: \"#Laboral\"\n---\n");
    }

    #[test]
    fn entry_names_are_plain() {
        assert_eq!(validate_entry_name("  Nota nueva ").unwrap(), "Nota nueva");
        assert!(validate_entry_name("").is_err());
        assert!(validate_entry_name(".oculta").is_err());
        assert!(validate_entry_name("a/b").is_err());
        assert!(validate_entry_name("a\\b").is_err());
    }
}
