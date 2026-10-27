//! Public spaces: read-only websites, one per port, that publish library
//! folders and notes with the `#Publico` context in a GitBook-like layout.
//! This module holds the rules: the stored settings, which notes a space
//! shows, its automatic index, the page HTML and the search.

pub mod index;
pub mod render;
pub mod search;
pub mod site;

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The only context a public space shows.
pub const PUBLIC_CONTEXT_TAG: &str = "#Publico";
/// Property of the notes of a published folder: `false` leaves the note
/// out of the site.
pub const PUBLISHED_PROPERTY: &str = "publicado";
pub const MAX_SPACES: usize = 16;
pub const MAX_ITEMS: usize = 200;
const MAX_NAME_CHARS: usize = 80;
const FIRST_PORT: u16 = 52490;
const MIN_PORT: u16 = 1024;

/// Whether the note says it must not be shown (`publicado: false`). A
/// note without the property is shown.
pub fn is_unpublished(source: &str) -> bool {
    crate::page_links::frontmatter_value(source, PUBLISHED_PROPERTY)
        .is_some_and(|value| matches!(value.trim().to_lowercase().as_str(), "false" | "no" | "0"))
}

/// The note with `publicado: true` when it does not have the property.
pub fn with_published_property(source: &str) -> Option<String> {
    crate::markdown_editing::with_missing_property(source, PUBLISHED_PROPERTY, "true")
}

/// Whether the note at `path` is inside a folder one of `spaces` publishes.
pub fn in_published_folder(spaces: &[PublicSpace], library_id: &str, path: &str) -> bool {
    path.to_lowercase().ends_with(".md")
        && spaces.iter().filter(|space| space.enabled && space.library_id == library_id).any(|space| {
            let folders: Vec<SpaceItem> = space.items.iter().filter(|item| item.kind == ItemKind::Folder).cloned().collect();
            in_items(&folders, path)
        })
}

/// Whether `tag` is the public context.
pub fn is_public_context(tag: Option<&str>) -> bool {
    tag.is_some_and(|tag| tag.trim().trim_matches(['"', '\'']).eq_ignore_ascii_case(PUBLIC_CONTEXT_TAG))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Folder,
    File,
}

/// A folder or a note a space publishes, by its logical path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpaceItem {
    pub path: String,
    pub kind: ItemKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSpace {
    pub id: String,
    pub name: String,
    pub library_id: String,
    pub port: u16,
    pub enabled: bool,
    pub items: Vec<SpaceItem>,
}

/// A logical path a space may publish: no empty, `.`, `..` or hidden
/// segments and nothing of the Task Manager workspace.
pub fn publishable_path(path: &str) -> Option<String> {
    let path = path.trim().replace('\\', "/");
    let path = path.trim_matches('/');
    if path.is_empty() || path.contains("//") {
        return None;
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.iter().any(|segment| segment.trim().is_empty() || *segment == "." || *segment == ".." || segment.starts_with('.')) {
        return None;
    }
    let root = segments[0];
    if root.eq_ignore_ascii_case("task-manager") || root.eq_ignore_ascii_case("task-mannager") {
        return None;
    }
    Some(path.to_string())
}

fn normalize_id(value: Option<&Value>, index: usize) -> String {
    let id: String = value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(32)
        .collect::<String>()
        .to_ascii_lowercase();
    if id.is_empty() { format!("espacio-{}", index + 1) } else { id }
}

fn normalize_items(value: Option<&Value>) -> Vec<SpaceItem> {
    let mut seen = HashSet::new();
    let items = value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|item| {
            let kind = match item.get("kind").and_then(Value::as_str)? {
                "folder" => ItemKind::Folder,
                "file" => ItemKind::File,
                _ => return None,
            };
            let path = publishable_path(item.get("path")?.as_str()?)?;
            if kind == ItemKind::File && !path.to_lowercase().ends_with(".md") {
                return None;
            }
            seen.insert(path.to_lowercase()).then_some(SpaceItem { path, kind })
        })
        .take(MAX_ITEMS)
        .collect::<Vec<_>>();
    // What a published folder already holds is not listed again.
    let folders: Vec<SpaceItem> = items.iter().filter(|item| item.kind == ItemKind::Folder).cloned().collect();
    items
        .into_iter()
        .filter(|item| !folders.iter().any(|folder| folder.path != item.path && is_covered(std::slice::from_ref(folder), &item.path)))
        .collect()
}

/// The stored spaces, valid: ids unique, ports in range, items publishable.
/// Repeated ports are kept here; saving rejects them (see [`validate`]).
pub fn normalize_public_spaces(value: &Value) -> Value {
    let mut ids = HashSet::new();
    let spaces: Vec<PublicSpace> = value
        .get("spaces")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|space| space.is_object())
        .take(MAX_SPACES)
        .enumerate()
        .filter_map(|(index, space)| {
            let id = normalize_id(space.get("id"), index);
            if !ids.insert(id.clone()) {
                return None;
            }
            let library_id = space.get("libraryId").and_then(Value::as_str).unwrap_or_default().trim().to_string();
            if library_id.is_empty() {
                return None;
            }
            let name: String = space.get("name").and_then(Value::as_str).unwrap_or_default().trim().chars().take(MAX_NAME_CHARS).collect();
            let port = space
                .get("port")
                .and_then(Value::as_u64)
                .and_then(|port| u16::try_from(port).ok())
                .filter(|port| *port >= MIN_PORT)
                .unwrap_or(FIRST_PORT + index as u16);
            Some(PublicSpace {
                id,
                name: if name.is_empty() { "Espacio público".to_string() } else { name },
                library_id,
                port,
                enabled: space.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                items: normalize_items(space.get("items")),
            })
        })
        .collect();
    json!({ "spaces": spaces })
}

/// The spaces of a normalized section.
pub fn spaces_of(section: &Value) -> Vec<PublicSpace> {
    section.get("spaces").cloned().and_then(|spaces| serde_json::from_value(spaces).ok()).unwrap_or_default()
}

/// Why the spaces cannot be saved: two spaces on one port, or a port other
/// services of this device already use.
pub fn validate(spaces: &[PublicSpace], reserved_ports: &[(u16, &str)]) -> Result<(), String> {
    let mut used: Vec<(u16, &str)> = Vec::new();
    for space in spaces {
        if let Some((_, service)) = reserved_ports.iter().find(|(port, _)| *port == space.port) {
            return Err(format!("El puerto {} ya lo usa {service}.", space.port));
        }
        if let Some((_, other)) = used.iter().find(|(port, _)| *port == space.port) {
            return Err(format!("«{}» y «{other}» no pueden usar el mismo puerto {}.", space.name, space.port));
        }
        used.push((space.port, space.name.as_str()));
    }
    Ok(())
}

/// A port no space, nor the reserved services, uses.
pub fn free_port(spaces: &[PublicSpace], reserved_ports: &[u16]) -> u16 {
    (FIRST_PORT..u16::MAX)
        .find(|port| !reserved_ports.contains(port) && spaces.iter().all(|space| space.port != *port))
        .unwrap_or(FIRST_PORT)
}

/// Whether `path` (a folder or a note) is already published by `items`:
/// it is one of them, or it is inside one of their folders.
pub fn is_covered(items: &[SpaceItem], path: &str) -> bool {
    let lower = path.trim_matches('/').to_lowercase();
    items.iter().any(|item| {
        let root = item.path.to_lowercase();
        lower == root || (item.kind == ItemKind::Folder && lower.starts_with(&format!("{root}/")))
    })
}

/// Whether the note at `path` belongs to `items`: inside a folder item or
/// one of the file items.
pub fn in_items(items: &[SpaceItem], path: &str) -> bool {
    let lower = path.to_lowercase();
    items.iter().any(|item| {
        let root = item.path.to_lowercase();
        match item.kind {
            ItemKind::File => lower == root,
            ItemKind::Folder => lower.starts_with(&format!("{root}/")),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_spaces_keep_only_what_can_be_published() {
        let normalized = normalize_public_spaces(&json!({ "spaces": [
            { "id": "Curso", "name": " Curso ", "libraryId": "lib", "port": 52500, "items": [
                { "path": "Cursos/programacion/", "kind": "folder" },
                { "path": "cursos/programacion", "kind": "folder" },
                { "path": ".agent/memory", "kind": "folder" },
                { "path": "task-manager/default", "kind": "folder" },
                { "path": "Notas/../x.md", "kind": "file" },
                { "path": "Notas/foto.png", "kind": "file" },
                { "path": "Notas/guia.md", "kind": "file" },
                { "path": "Cursos/programacion/backend", "kind": "folder" },
                { "path": "Cursos/programacion/backend/go.md", "kind": "file" },
            ] },
            { "id": "curso", "libraryId": "lib" },
            { "name": "Sin biblioteca" },
            { "libraryId": "lib", "port": 80, "enabled": false },
        ] }));
        let spaces = spaces_of(&normalized);
        assert_eq!(spaces.len(), 2);
        assert_eq!(spaces[0].id, "curso");
        assert_eq!(spaces[0].name, "Curso");
        assert_eq!(
            spaces[0].items,
            vec![
                SpaceItem { path: "Cursos/programacion".into(), kind: ItemKind::Folder },
                SpaceItem { path: "Notas/guia.md".into(), kind: ItemKind::File },
            ]
        );
        assert_eq!(spaces[1].id, "espacio-4");
        assert_eq!(spaces[1].name, "Espacio público");
        assert_eq!(spaces[1].port, FIRST_PORT + 3);
        assert!(!spaces[1].enabled);
    }

    #[test]
    fn what_a_published_folder_holds_is_already_covered() {
        let items = [SpaceItem { path: "Cursos/programacion".into(), kind: ItemKind::Folder }, SpaceItem { path: "Notas/guia.md".into(), kind: ItemKind::File }];
        assert!(is_covered(&items, "Cursos/programacion"));
        assert!(is_covered(&items, "cursos/programacion/backend"));
        assert!(is_covered(&items, "Cursos/programacion/backend/go.md"));
        assert!(is_covered(&items, "Notas/guia.md"));
        assert!(!is_covered(&items, "Cursos/programacion-2"));
        assert!(!is_covered(&items, "Notas"));
        assert!(!is_covered(&items, "Notas/otra.md"));
    }

    #[test]
    fn notes_of_a_published_folder_carry_publicado() {
        let space = |enabled| PublicSpace {
            id: "a".into(),
            name: "A".into(),
            library_id: "lib".into(),
            port: 52500,
            enabled,
            items: vec![SpaceItem { path: "Curso".into(), kind: ItemKind::Folder }, SpaceItem { path: "Notas/guia.md".into(), kind: ItemKind::File }],
        };
        assert!(in_published_folder(&[space(true)], "lib", "Curso/tema/uno.md"));
        assert!(!in_published_folder(&[space(true)], "lib", "Curso/imagen.png"));
        assert!(!in_published_folder(&[space(true)], "lib", "Notas/guia.md"));
        assert!(!in_published_folder(&[space(true)], "otra", "Curso/uno.md"));
        assert!(!in_published_folder(&[space(false)], "lib", "Curso/uno.md"));
        assert!(is_unpublished("---\npublicado: false\n---\n"));
        assert!(is_unpublished("---\nPublicado: \"no\"\n---\n"));
        assert!(!is_unpublished("---\npublicado: true\n---\n"));
        assert!(!is_unpublished("Sin propiedades"));
    }

    #[test]
    fn two_spaces_never_share_a_port() {
        let space = |name: &str, port| PublicSpace { id: name.into(), name: name.into(), library_id: "lib".into(), port, enabled: true, items: vec![] };
        assert!(validate(&[space("A", 52500), space("B", 52501)], &[(52471, "el tablero publicado")]).is_ok());
        assert_eq!(validate(&[space("A", 52500), space("B", 52500)], &[]), Err("«B» y «A» no pueden usar el mismo puerto 52500.".into()));
        assert_eq!(validate(&[space("A", 52471)], &[(52471, "el tablero publicado")]), Err("El puerto 52471 ya lo usa el tablero publicado.".into()));
        assert_eq!(free_port(&[space("A", FIRST_PORT)], &[FIRST_PORT + 1]), FIRST_PORT + 2);
    }

    #[test]
    fn only_the_public_context_and_the_items_count() {
        assert!(is_public_context(Some("#publico")));
        assert!(is_public_context(Some(" \"#Publico\" ")));
        assert!(!is_public_context(Some("#Personal")));
        assert!(!is_public_context(None));
        let items = [SpaceItem { path: "Cursos/programacion".into(), kind: ItemKind::Folder }, SpaceItem { path: "Notas/guia.md".into(), kind: ItemKind::File }];
        assert!(in_items(&items, "Cursos/programacion/backend/go.md"));
        assert!(in_items(&items, "notas/guia.md"));
        assert!(!in_items(&items, "Cursos/programacion-2/x.md"));
        assert!(!in_items(&items, "Notas/otra.md"));
    }
}
