//! Library explorer tree as the interface renders it.
//!
//! Desktop and Android adapters read folders in their own shape; this module
//! turns their nodes into one contract and applies the explorer order:
//! folders first, then notes chained by `previousPage` / `nextPage` (each
//! chain placed by the creation date of its head), then the notes without
//! links by creation date and name.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::page_links::extract_link_path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTreeNodeDto {
    pub id: String,
    pub name: String,
    /// Opaque identity of the entry: a filesystem path on desktop, a SAF
    /// document URI on Android. The interface passes it back unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "type")]
    pub node_type: LibraryNodeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_children: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<LibraryTreeNodeDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_page: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_page: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryNodeKind {
    Folder,
    File,
}

/// Forward slashes and single separators for filesystem paths; SAF URIs
/// (`content://`) are opaque and returned as they are.
pub fn normalize_entry_path(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with("content://") {
        return trimmed.to_string();
    }
    let forward = trimmed.replace('\\', "/");
    let (prefix, rest) = match forward.strip_prefix("//") {
        Some(rest) => ("//", rest),
        None => ("", forward.as_str()),
    };
    let mut collapsed = String::with_capacity(rest.len());
    let mut previous_slash = false;
    for character in rest.chars() {
        if character == '/' {
            if !previous_slash {
                collapsed.push('/');
            }
            previous_slash = true;
        } else {
            collapsed.push(character);
            previous_slash = false;
        }
    }
    format!("{prefix}{collapsed}")
}

/// Logical path inside the library for an entry identity the explorer
/// shows (the library root followed by the relative path, as desktop paths
/// and Android visible paths are built) or for a path that is already
/// logical. `None` when the identity points outside the library.
pub fn library_logical_path(library_root: &str, identity: &str) -> Option<String> {
    let root = normalize_entry_path(library_root);
    let root = root.trim_end_matches('/');
    let value = normalize_entry_path(identity);
    let value = value.trim_end_matches('/');
    if root.is_empty() || value.is_empty() {
        return None;
    }
    if value == root {
        return Some(String::new());
    }
    if let Some(relative) = value.strip_prefix(root).and_then(|rest| rest.strip_prefix('/')) {
        return Some(relative.to_string());
    }
    let absolute = value.starts_with('/')
        || value.contains("://")
        || value.as_bytes().get(1) == Some(&b':');
    (!absolute).then(|| value.to_string())
}

/// Identity the explorer shows for a logical path of the library.
pub fn library_visible_path(library_root: &str, logical_path: &str) -> String {
    let root = normalize_entry_path(library_root);
    let root = root.trim_end_matches('/');
    let logical = logical_path.trim().trim_matches('/');
    if logical.is_empty() {
        root.to_string()
    } else {
        format!("{root}/{logical}")
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let escaped = (bytes[index] == b'%' && index + 3 <= bytes.len())
            .then(|| std::str::from_utf8(&bytes[index + 1..index + 3]).ok())
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                decoded.push(byte);
                index += 3;
            }
            None => {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_string())
}

/// Folder name shown for a library: the last segment of the path, or of
/// the document id encoded in an Android tree URI.
pub fn library_display_name(path: &str) -> String {
    let source = if path.starts_with("content://") {
        percent_decode(path.rsplit('/').next().unwrap_or_default())
    } else {
        path.to_string()
    };
    source
        .split(['/', '\\'])
        .filter(|segment| !segment.trim().is_empty())
        .last()
        .map(|segment| segment.trim().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Normalizes a sibling list and its folders recursively: duplicate ids in
/// the same list are dropped (Android can list the root as its own child),
/// folders always carry `expanded`, `hasChildren` and a children list, and
/// the explorer order is applied.
pub fn normalize_tree(nodes: Vec<LibraryTreeNodeDto>) -> Vec<LibraryTreeNodeDto> {
    let mut seen = HashSet::new();
    let nodes = nodes
        .into_iter()
        .filter(|node| seen.insert(node.id.clone()))
        .map(|mut node| {
            node.path = node.path.as_deref().map(normalize_entry_path);
            match node.node_type {
                LibraryNodeKind::Folder => {
                    let children = normalize_tree(node.children.take().unwrap_or_default());
                    node.expanded = Some(node.expanded.unwrap_or(false));
                    node.has_children = Some(node.has_children.unwrap_or(false) || !children.is_empty());
                    node.children = Some(children);
                }
                LibraryNodeKind::File => {
                    node.expanded = None;
                    node.has_children = None;
                    node.children = None;
                }
            }
            node
        })
        .collect::<Vec<_>>();
    sort_siblings(nodes)
}

/// Children of a folder read without its descendants: folders keep whether
/// they have children but drop the loaded lists.
pub fn shallow_listing(nodes: Vec<LibraryTreeNodeDto>) -> Vec<LibraryTreeNodeDto> {
    normalize_tree(nodes)
        .into_iter()
        .map(|mut node| {
            if node.node_type == LibraryNodeKind::Folder {
                node.children = Some(Vec::new());
            }
            node
        })
        .collect()
}

fn created_at(node: &LibraryTreeNodeDto) -> i64 {
    node.created_at.or(node.modified_at).unwrap_or(i64::MAX)
}

fn stem(name: &str) -> String {
    let lower = name.to_lowercase();
    lower.strip_suffix(".md").map(str::to_string).unwrap_or(lower)
}

fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn compare_names(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase().cmp(&right.to_lowercase())
}

/// Resolves a page link to a sibling by exact path or by file name.
fn linked_sibling(reference: Option<&str>, by_path: &HashMap<&str, usize>, paths: &[String]) -> Option<usize> {
    let reference = reference?.trim();
    if reference.is_empty() || reference == "N/A" {
        return None;
    }
    if let Some(index) = by_path.get(reference) {
        return Some(*index);
    }
    let target = stem(&extract_link_path(reference)?);
    paths
        .iter()
        .position(|path| !path.is_empty() && stem(base_name(path)) == target)
}

fn sort_siblings(nodes: Vec<LibraryTreeNodeDto>) -> Vec<LibraryTreeNodeDto> {
    let (folders, files): (Vec<_>, Vec<_>) = nodes
        .into_iter()
        .partition(|node| node.node_type == LibraryNodeKind::Folder);

    let paths = files
        .iter()
        .map(|node| node.path.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    let by_path = paths
        .iter()
        .enumerate()
        .filter(|(_, path)| !path.is_empty())
        .map(|(index, path)| (path.as_str(), index))
        .collect::<HashMap<_, _>>();
    let next = |index: usize| linked_sibling(files[index].next_page.as_deref(), &by_path, &paths);
    let previous = |index: usize| linked_sibling(files[index].previous_page.as_deref(), &by_path, &paths);

    let mut visited = vec![false; files.len()];
    let mut chains = Vec::<Vec<usize>>::new();
    let mut loose = Vec::<usize>::new();
    for index in 0..files.len() {
        if visited[index] || paths[index].is_empty() {
            continue;
        }
        if next(index).is_none() && previous(index).is_none() {
            visited[index] = true;
            loose.push(index);
            continue;
        }
        // Walk back to the head of the chain, then forward from the node.
        let mut chain = Vec::new();
        let mut current = Some(index);
        while let Some(position) = current {
            if visited[position] {
                break;
            }
            visited[position] = true;
            chain.insert(0, position);
            current = previous(position);
        }
        let mut forward = next(index);
        while let Some(position) = forward {
            if visited[position] {
                break;
            }
            visited[position] = true;
            chain.push(position);
            forward = next(position);
        }
        chains.push(chain);
    }
    for (index, done) in visited.iter().enumerate() {
        if !done {
            loose.push(index);
        }
    }

    chains.sort_by(|left, right| {
        let (left_head, right_head) = (&files[left[0]], &files[right[0]]);
        created_at(left_head)
            .cmp(&created_at(right_head))
            .then_with(|| compare_names(&left_head.name, &right_head.name))
    });
    loose.sort_by(|left, right| {
        let (left, right) = (&files[*left], &files[*right]);
        created_at(left)
            .cmp(&created_at(right))
            .then_with(|| compare_names(&left.name, &right.name))
    });

    let order = chains.into_iter().flatten().chain(loose).collect::<Vec<_>>();
    let mut slots = files.into_iter().map(Some).collect::<Vec<_>>();
    folders
        .into_iter()
        .chain(order.into_iter().filter_map(|index| slots[index].take()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, created: i64) -> LibraryTreeNodeDto {
        LibraryTreeNodeDto {
            id: name.to_string(),
            name: name.to_string(),
            path: Some(format!("C:\\\\lib\\\\{name}")),
            node_type: LibraryNodeKind::File,
            expanded: None,
            has_children: None,
            children: None,
            created_at: Some(created),
            modified_at: None,
            next_page: None,
            previous_page: None,
        }
    }

    fn folder(name: &str, children: Vec<LibraryTreeNodeDto>) -> LibraryTreeNodeDto {
        LibraryTreeNodeDto {
            node_type: LibraryNodeKind::Folder,
            children: Some(children),
            ..file(name, 0)
        }
    }

    fn names(nodes: &[LibraryTreeNodeDto]) -> Vec<&str> {
        nodes.iter().map(|node| node.name.as_str()).collect()
    }

    #[test]
    fn normalizes_paths_but_keeps_saf_uris() {
        assert_eq!(normalize_entry_path(" C:\\\\lib\\\\a.md "), "C:/lib/a.md");
        assert_eq!(normalize_entry_path("//server//share/x"), "//server/share/x");
        let uri = "content://com.android.externalstorage.documents/tree/primary%3ANotas";
        assert_eq!(normalize_entry_path(uri), uri);
    }

    #[test]
    fn folders_first_then_page_chains_then_loose_notes() {
        let mut first = file("a.md", 30);
        first.next_page = Some("[[b]]".into());
        let mut second = file("b.md", 10);
        second.previous_page = Some("[[a]]".into());
        let nodes = normalize_tree(vec![
            file("z.md", 5),
            second,
            folder("docs", vec![file("y.md", 2), file("x.md", 1)]),
            first,
            file("z.md", 99),
        ]);
        assert_eq!(names(&nodes), vec!["docs", "a.md", "b.md", "z.md"]);
        let docs = nodes[0].children.as_ref().unwrap();
        assert_eq!(names(docs), vec!["x.md", "y.md"]);
        assert_eq!(nodes[0].expanded, Some(false));
        assert_eq!(nodes[0].has_children, Some(true));
        assert_eq!(nodes[3].path.as_deref(), Some("C:/lib/z.md"));
    }

    #[test]
    fn logical_paths_come_from_the_library_root() {
        assert_eq!(library_logical_path(r"C:\lib", "C:/lib/notas/a.md").as_deref(), Some("notas/a.md"));
        assert_eq!(library_logical_path("C:/lib/", "C:/lib").as_deref(), Some(""));
        assert_eq!(library_logical_path("C:/lib", "notas/a.md").as_deref(), Some("notas/a.md"));
        assert_eq!(library_logical_path("C:/lib", "C:/other/a.md"), None);
        assert_eq!(library_logical_path("C:/lib", "C:/library/a.md"), None);
        let tree = "content://com.android.externalstorage.documents/tree/primary%3ANotas";
        assert_eq!(library_logical_path(tree, &format!("{tree}/x/y.md")).as_deref(), Some("x/y.md"));
        assert_eq!(library_logical_path(tree, "content://otro/tree/z"), None);
        assert_eq!(library_visible_path("C:/lib/", "/x/y.md"), "C:/lib/x/y.md");
        assert_eq!(library_visible_path(tree, ""), tree);
    }

    #[test]
    fn display_names_come_from_the_last_folder() {
        assert_eq!(library_display_name(r"C:\Users\ana\Notas"), "Notas");
        assert_eq!(library_display_name("/home/ana/notas/"), "notas");
        assert_eq!(
            library_display_name("content://com.android.externalstorage.documents/tree/primary%3ADocs%2FNotas"),
            "Notas"
        );
        assert_eq!(
            library_display_name("content://com.android.externalstorage.documents/tree/primary%3ANotas"),
            "primary:Notas"
        );
    }

    #[test]
    fn shallow_listing_keeps_has_children_without_descendants() {
        let nodes = shallow_listing(vec![folder("docs", vec![file("a.md", 1)])]);
        assert_eq!(nodes[0].has_children, Some(true));
        assert_eq!(nodes[0].children.as_deref(), Some(&[][..]));
    }
}
