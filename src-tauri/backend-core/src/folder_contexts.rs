//! Contexts assigned to library folders. A folder with a context forces it
//! on every note inside it, also in its subfolders unless one of them has
//! its own. The assignments live in `.notia/folderContexts.json` by logical
//! folder path and follow the folders when they are renamed, moved, copied
//! or deleted.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::library_config::normalize_context_tag;
use crate::library_tree::{LibraryNodeKind, LibraryTreeNodeDto};
use crate::note_ink::EntryChange;

/// Where the assignments of a library are kept.
pub const FOLDER_CONTEXTS_PATH: &str = ".notia/folderContexts.json";
const VERSION: u64 = 1;

/// Folders whose notes are not ordinary library notes: the hidden ones and
/// the Task Manager workspace, whose tickets take the board context.
fn is_reserved_folder(folder: &str) -> bool {
    let mut segments = folder.split('/');
    let root = segments.next().unwrap_or_default();
    root.eq_ignore_ascii_case("task-manager")
        || root.eq_ignore_ascii_case("task-mannager")
        || folder.split('/').any(|segment| segment.starts_with('.'))
}

/// The folder as stored: trimmed of slashes, without empty, `.` or `..`
/// segments. Hidden folders and the Task Manager workspace are rejected.
pub fn folder_key(folder: &str) -> Result<String, &'static str> {
    let folder = folder.trim().trim_matches('/');
    if folder.is_empty() {
        return Err("La raíz de la biblioteca no puede tener un contexto.");
    }
    if folder.split('/').any(|segment| segment.trim().is_empty() || segment == "." || segment == ".." || segment.contains('\\')) {
        return Err("La carpeta no es válida.");
    }
    if is_reserved_folder(folder) {
        return Err("Esa carpeta no puede tener un contexto.");
    }
    Ok(folder.to_string())
}

fn same_path(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

/// `path` itself or something inside it, without distinguishing case.
fn within(path: &str, folder: &str) -> bool {
    let (path, folder) = (path.to_lowercase(), folder.to_lowercase());
    path == folder || path.starts_with(&format!("{folder}/"))
}

/// Where `path` goes when the entry `from` becomes `to`. `None` when it is
/// not inside `from`.
pub fn relocated(path: &str, from: &str, to: &str) -> Option<String> {
    let (path, from, to) = (path.trim_matches('/'), from.trim_matches('/'), to.trim_matches('/'));
    within(path, from).then(|| format!("{to}{}", path.chars().skip(from.chars().count()).collect::<String>()))
}

/// Whether a note at `path` is one the folder contexts apply to.
pub fn is_library_note(path: &str) -> bool {
    let path = path.trim_matches('/');
    let parent = path.rsplit_once('/').map_or("", |(parent, _)| parent);
    path.to_lowercase().ends_with(".md") && !parent.is_empty() && !is_reserved_folder(parent)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FolderContexts {
    folders: BTreeMap<String, String>,
}

impl FolderContexts {
    /// The stored assignments. A missing or damaged file means none: the
    /// notes are then free, never blocked by a file nobody can read.
    pub fn parse(text: &str) -> Self {
        let folders = serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|value| value.get("folders").and_then(Value::as_object).cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(folder, tag)| Some((folder_key(&folder).ok()?, normalize_context_tag(tag.as_str()?)?)))
            .collect();
        Self { folders }
    }

    pub fn to_json(&self) -> String {
        let folders: Map<String, Value> =
            self.folders.iter().map(|(folder, tag)| (folder.clone(), Value::String(tag.clone()))).collect();
        let value = json!({ "version": VERSION, "folders": folders });
        serde_json::to_string_pretty(&value).unwrap_or_default() + "\n"
    }

    pub fn is_empty(&self) -> bool {
        self.folders.is_empty()
    }

    /// The assignments, by folder.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.folders.iter().map(|(folder, tag)| (folder.as_str(), tag.as_str()))
    }

    /// The context assigned to `folder` itself.
    pub fn own(&self, folder: &str) -> Option<&str> {
        let folder = folder.trim().trim_matches('/');
        self.folders.iter().find(|(key, _)| same_path(key, folder)).map(|(_, tag)| tag.as_str())
    }

    /// The context a note at `path` must have: the one of its nearest
    /// folder with an assignment. `None` when it is free.
    pub fn effective(&self, path: &str) -> Option<&str> {
        if !is_library_note(path) {
            return None;
        }
        let mut folder = path.trim_matches('/');
        while let Some((parent, _)) = folder.rsplit_once('/') {
            if let Some(tag) = self.own(parent) {
                return Some(tag);
            }
            folder = parent;
        }
        None
    }

    /// Assigns `tag` to `folder`, or removes its assignment with `None`.
    /// Returns whether anything changed.
    pub fn set(&mut self, folder: &str, tag: Option<&str>) -> Result<bool, &'static str> {
        let folder = folder_key(folder)?;
        let previous = self.folders.keys().find(|key| same_path(key, &folder)).cloned();
        let removed = previous.and_then(|key| self.folders.remove(&key).map(|tag| (key, tag)));
        match tag {
            Some(tag) => {
                let tag = normalize_context_tag(tag).ok_or("El contexto no es válido.")?;
                let changed = removed.as_ref().is_none_or(|(_, previous)| previous != &tag);
                self.folders.insert(folder, tag);
                Ok(changed)
            }
            None => Ok(removed.is_some()),
        }
    }

    /// Folders with their own assignment strictly inside `folder`.
    pub fn assigned_inside(&self, folder: &str) -> Vec<String> {
        let folder = folder.trim().trim_matches('/');
        self.folders.keys().filter(|key| !same_path(key, folder) && within(key, folder)).cloned().collect()
    }

    /// The assignments follow an explorer operation on `change`. Returns
    /// whether anything changed.
    pub fn follow(&mut self, change: &EntryChange) -> bool {
        let source = change.source().trim_matches('/');
        let affected: Vec<(String, String)> = self
            .folders
            .iter()
            .filter(|(folder, _)| within(folder, source))
            .map(|(folder, tag)| (folder.clone(), tag.clone()))
            .collect();
        if affected.is_empty() {
            return false;
        }
        for (folder, tag) in affected {
            match change {
                EntryChange::Delete { .. } => {
                    self.folders.remove(&folder);
                }
                EntryChange::Move { to, .. } | EntryChange::Copy { to, .. } => {
                    if matches!(change, EntryChange::Move { .. }) {
                        self.folders.remove(&folder);
                    }
                    let rest: String = folder.chars().skip(source.chars().count()).collect();
                    if let Ok(target) = folder_key(&format!("{}{rest}", to.trim_matches('/'))) {
                        self.folders.insert(target, tag);
                    }
                }
            }
        }
        true
    }
}

/// Marks the folders of an explorer tree read from the folder `parent`
/// (logical path, empty for the root) with their own context.
pub fn mark_tree(nodes: &mut [LibraryTreeNodeDto], parent: &str, contexts: &FolderContexts) {
    if contexts.is_empty() {
        return;
    }
    let parent = parent.trim_matches('/');
    for node in nodes.iter_mut().filter(|node| node.node_type == LibraryNodeKind::Folder) {
        let logical = if parent.is_empty() { node.name.clone() } else { format!("{parent}/{}", node.name) };
        node.context = contexts.own(&logical).map(str::to_string);
        if let Some(children) = node.children.as_mut() {
            mark_tree(children, &logical, contexts);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contexts(pairs: &[(&str, &str)]) -> FolderContexts {
        let mut contexts = FolderContexts::default();
        for (folder, tag) in pairs {
            contexts.set(folder, Some(tag)).unwrap();
        }
        contexts
    }

    #[test]
    fn a_note_takes_the_context_of_its_nearest_folder_with_one() {
        let contexts = contexts(&[("Trabajo", "#Laboral"), ("Trabajo/Privado", "Confidencial")]);
        assert_eq!(contexts.effective("Trabajo/plan.md"), Some("#Laboral"));
        assert_eq!(contexts.effective("Trabajo/Q1/plan.md"), Some("#Laboral"));
        assert_eq!(contexts.effective("trabajo/privado/claves.md"), Some("#Confidencial"));
        assert_eq!(contexts.effective("Otros/plan.md"), None);
        assert_eq!(contexts.effective("plan.md"), None);
        // Only notes: a diagram or an image keeps no frontmatter.
        assert_eq!(contexts.effective("Trabajo/flujo.mmd"), None);
    }

    #[test]
    fn hidden_folders_the_task_manager_and_the_root_cannot_have_one() {
        let mut contexts = FolderContexts::default();
        assert!(contexts.set("", Some("#Laboral")).is_err());
        assert!(contexts.set(".agent", Some("#Laboral")).is_err());
        assert!(contexts.set("Notas/.ocultas", Some("#Laboral")).is_err());
        assert!(contexts.set("task-manager/default", Some("#Laboral")).is_err());
        assert!(contexts.set("Task-Mannager", Some("#Laboral")).is_err());
        assert!(contexts.set("Notas/../x", Some("#Laboral")).is_err());
        assert!(contexts.set("Notas", Some("dos palabras")).is_err());
        assert!(contexts.is_empty());
    }

    #[test]
    fn setting_and_clearing_report_a_change_only_when_there_is_one() {
        let mut contexts = FolderContexts::default();
        assert_eq!(contexts.set("Notas/", Some("Laboral")), Ok(true));
        assert_eq!(contexts.set("notas", Some("#Laboral")), Ok(false));
        assert_eq!(contexts.own("NOTAS"), Some("#Laboral"));
        assert_eq!(contexts.set("Notas", Some("#Personal")), Ok(true));
        assert_eq!(contexts.set("Notas", None), Ok(true));
        assert_eq!(contexts.set("Notas", None), Ok(false));
    }

    #[test]
    fn the_file_keeps_the_assignments_and_ignores_what_it_cannot_read() {
        let contexts = contexts(&[("Trabajo", "#Laboral")]);
        assert_eq!(FolderContexts::parse(&contexts.to_json()), contexts);
        let damaged = r##"{"version":1,"folders":{"Trabajo":"#Laboral",".agent":"#Laboral","Otros":7,"Mal":"a b"}}"##;
        assert_eq!(FolderContexts::parse(damaged), contexts);
        assert!(FolderContexts::parse("no es json").is_empty());
    }

    #[test]
    fn assignments_follow_renames_moves_copies_and_deletes() {
        let mut moved = contexts(&[("Trabajo", "#Laboral"), ("Trabajo/Privado", "#Confidencial"), ("Trabajos", "#Personal")]);
        assert!(moved.follow(&EntryChange::Move { from: "Trabajo".into(), to: "Archivo/Trabajo".into() }));
        assert_eq!(moved, contexts(&[("Archivo/Trabajo", "#Laboral"), ("Archivo/Trabajo/Privado", "#Confidencial"), ("Trabajos", "#Personal")]));

        let mut copied = contexts(&[("Trabajo", "#Laboral")]);
        assert!(copied.follow(&EntryChange::Copy { from: "Trabajo".into(), to: "Copia/Trabajo".into() }));
        assert_eq!(copied, contexts(&[("Trabajo", "#Laboral"), ("Copia/Trabajo", "#Laboral")]));

        let mut deleted = contexts(&[("Trabajo", "#Laboral"), ("Trabajo/Privado", "#Confidencial")]);
        assert!(deleted.follow(&EntryChange::Delete { entry: "Trabajo".into() }));
        assert!(deleted.is_empty());

        let mut untouched = contexts(&[("Trabajo", "#Laboral")]);
        assert!(!untouched.follow(&EntryChange::Move { from: "Trabajo/plan.md".into(), to: "plan.md".into() }));
    }

    #[test]
    fn the_tree_shows_the_context_of_each_folder_with_one() {
        let node = |name: &str, kind: LibraryNodeKind, children: Option<Vec<LibraryTreeNodeDto>>| LibraryTreeNodeDto {
            id: name.into(), name: name.into(), path: None, node_type: kind, expanded: None, has_children: None,
            children, created_at: None, modified_at: None, next_page: None, previous_page: None, context: None,
        };
        let mut nodes = vec![node(
            "Trabajo",
            LibraryNodeKind::Folder,
            Some(vec![node("Privado", LibraryNodeKind::Folder, Some(vec![])), node("plan.md", LibraryNodeKind::File, None)]),
        )];
        mark_tree(&mut nodes, "", &contexts(&[("Trabajo/Privado", "#Confidencial")]));
        let children = nodes[0].children.as_ref().unwrap();
        assert_eq!(nodes[0].context, None);
        assert_eq!(children[0].context.as_deref(), Some("#Confidencial"));
        assert_eq!(children[1].context, None);
        let mut listed = vec![node("Privado", LibraryNodeKind::Folder, None)];
        mark_tree(&mut listed, "Trabajo", &contexts(&[("Trabajo/Privado", "#Confidencial")]));
        assert_eq!(listed[0].context.as_deref(), Some("#Confidencial"));
    }

    #[test]
    fn paths_inside_a_moved_entry_follow_it() {
        assert_eq!(relocated("Trabajo/Q1/a.md", "trabajo", "Archivo/Trabajo").as_deref(), Some("Archivo/Trabajo/Q1/a.md"));
        assert_eq!(relocated("Trabajo/a.md", "Trabajo/a.md", "a.md").as_deref(), Some("a.md"));
        assert_eq!(relocated("Trabajos/a.md", "Trabajo", "X"), None);
    }
}
