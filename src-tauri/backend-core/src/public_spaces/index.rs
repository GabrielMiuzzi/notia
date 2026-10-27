//! The automatic index of a public space, as GitBook shows a space: groups
//! with a title and nested pages. A published folder gives its own notes
//! as the first pages and one group per subfolder; inside, a subfolder is a
//! page (its cover note, the one named like it or `README`/`index`) with
//! the rest as children. Pages follow the reading order: the
//! `nextPage` chains, each starting by its creation date.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Serialize;

use super::{ItemKind, SpaceItem};

/// A published note, as the index needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedPage {
    pub path: String,
    pub title: String,
    pub created_at: Option<i64>,
    /// Logical path of its `nextPage`, already resolved.
    pub next: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavEntry {
    /// The page it opens; `None` for a folder without a cover note.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<NavEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavGroup {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub entries: Vec<NavEntry>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceIndex {
    pub groups: Vec<NavGroup>,
    /// Every page in the order the index shows them; previous and next.
    pub order: Vec<String>,
    /// Group and parent titles of each page, for its breadcrumb.
    #[serde(skip)]
    pub trail: HashMap<String, Vec<String>>,
}

impl SpaceIndex {
    pub fn neighbours(&self, path: &str) -> (Option<&str>, Option<&str>) {
        let Some(position) = self.order.iter().position(|candidate| candidate == path) else {
            return (None, None);
        };
        let previous = position.checked_sub(1).and_then(|index| self.order.get(index)).map(String::as_str);
        (previous, self.order.get(position + 1).map(String::as_str))
    }
}

/// Lower case letters and digits only, accents removed: `¿Qué es?` and
/// `que-es` are the same name.
pub fn comparable_name(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            other => other,
        })
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

/// The id of a heading: lower case letters and digits joined by `-`,
/// accents removed (`Instalación rápida` → `instalacion-rapida`).
pub fn slug(value: &str) -> String {
    value
        .split(|character: char| !character.is_alphanumeric())
        .map(comparable_name)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// A folder name as a title: separators become spaces and the first letter
/// is upper case (`programacion-general` → `Programacion general`).
pub fn folder_title(name: &str) -> String {
    let spaced = name.replace(['-', '_'], " ");
    let mut characters = spaced.trim().chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => name.to_string(),
    }
}

fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").or_else(|| name.strip_suffix(".MD")).unwrap_or(name)
}

/// Position of each page in the reading order: chains of `nextPage` in the
/// space, each from its first page, ordered by its creation date; pages in
/// a cycle go last.
fn reading_order(pages: &[IndexedPage]) -> HashMap<String, usize> {
    let by_path: HashMap<String, &IndexedPage> = pages.iter().map(|page| (page.path.to_lowercase(), page)).collect();
    let next_of = |page: &IndexedPage| page.next.as_ref().and_then(|next| by_path.get(&next.to_lowercase()).copied());
    let pointed: HashSet<String> = pages.iter().filter_map(|page| next_of(page).map(|next| next.path.to_lowercase())).collect();
    let key = |page: &&IndexedPage| (page.created_at.unwrap_or(i64::MAX), page.path.to_lowercase());
    let mut heads: Vec<&IndexedPage> = pages.iter().filter(|page| !pointed.contains(&page.path.to_lowercase())).collect();
    heads.sort_by_key(key);
    let mut rest: Vec<&IndexedPage> = pages.iter().collect();
    rest.sort_by_key(key);
    let mut positions = HashMap::new();
    for start in heads.into_iter().chain(rest) {
        let mut current = Some(start);
        while let Some(page) = current {
            if positions.contains_key(&page.path) {
                break;
            }
            positions.insert(page.path.clone(), positions.len());
            current = next_of(page);
        }
    }
    positions
}

#[derive(Default)]
struct Folder {
    notes: Vec<String>,
    folders: BTreeMap<String, Folder>,
}

impl Folder {
    fn insert(&mut self, relative: &str, path: &str) {
        match relative.split_once('/') {
            Some((folder, rest)) => self.folders.entry(folder.to_string()).or_default().insert(rest, path),
            None => self.notes.push(path.to_string()),
        }
    }
}

struct Builder<'a> {
    titles: HashMap<&'a str, &'a str>,
    positions: HashMap<String, usize>,
}

impl Builder<'_> {
    fn position(&self, path: &str) -> usize {
        self.positions.get(path).copied().unwrap_or(usize::MAX)
    }

    fn title(&self, path: &str) -> String {
        self.titles.get(path).map_or_else(|| stem(path).to_string(), |title| title.to_string())
    }

    fn first_position(&self, folder: &Folder) -> usize {
        folder
            .notes
            .iter()
            .map(|note| self.position(note))
            .chain(folder.folders.values().map(|child| self.first_position(child)))
            .min()
            .unwrap_or(usize::MAX)
    }

    /// The cover of a folder: the note named like it, or `README`/`index`.
    fn cover<'f>(&self, name: &str, folder: &'f Folder) -> Option<&'f String> {
        let wanted = comparable_name(name);
        folder
            .notes
            .iter()
            .find(|note| comparable_name(stem(note)) == wanted)
            .or_else(|| folder.notes.iter().find(|note| matches!(comparable_name(stem(note)).as_str(), "readme" | "index")))
    }

    /// Notes and subfolders of `folder` (without `skip`), in reading order.
    fn entries(&self, folder: &Folder, skip: Option<&String>) -> Vec<NavEntry> {
        let mut entries: Vec<(usize, NavEntry)> = folder
            .notes
            .iter()
            .filter(|note| Some(*note) != skip)
            .map(|note| (self.position(note), NavEntry { path: Some(note.clone()), title: self.title(note), children: vec![] }))
            .chain(folder.folders.iter().map(|(name, child)| (self.first_position(child), self.folder_entry(name, child))))
            .collect();
        entries.sort_by(|(left, a), (right, b)| left.cmp(right).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
        entries.into_iter().map(|(_, entry)| entry).collect()
    }

    fn folder_entry(&self, name: &str, folder: &Folder) -> NavEntry {
        let cover = self.cover(name, folder);
        NavEntry {
            path: cover.cloned(),
            title: cover.map_or_else(|| folder_title(name), |cover| self.title(cover)),
            children: self.entries(folder, cover),
        }
    }
}

fn collect_order(entries: &[NavEntry], trail: &mut Vec<String>, index: &mut SpaceIndex) {
    for entry in entries {
        if let Some(path) = &entry.path {
            index.order.push(path.clone());
            index.trail.insert(path.clone(), trail.clone());
        }
        trail.push(entry.title.clone());
        collect_order(&entry.children, trail, index);
        trail.pop();
    }
}

/// The index of a space publishing `items`, over its published `pages`.
pub fn build_index(items: &[SpaceItem], pages: &[IndexedPage]) -> SpaceIndex {
    let builder = Builder {
        titles: pages.iter().map(|page| (page.path.as_str(), page.title.as_str())).collect(),
        positions: reading_order(pages),
    };
    let mut loose: Vec<String> = Vec::new();
    let mut groups: Vec<NavGroup> = Vec::new();
    let mut placed: HashSet<String> = HashSet::new();
    for item in items {
        let root = item.path.to_lowercase();
        match item.kind {
            ItemKind::File => {
                if let Some(page) = pages.iter().find(|page| page.path.to_lowercase() == root) {
                    if placed.insert(page.path.to_lowercase()) {
                        loose.push(page.path.clone());
                    }
                }
            }
            ItemKind::Folder => {
                let mut folder = Folder::default();
                for page in pages {
                    let lower = page.path.to_lowercase();
                    if lower.starts_with(&format!("{root}/")) && placed.insert(lower) {
                        folder.insert(&page.path[item.path.len() + 1..], &page.path);
                    }
                }
                loose.extend(folder.notes.iter().cloned());
                let mut subfolders: Vec<(usize, NavGroup)> = folder
                    .folders
                    .iter()
                    .map(|(name, child)| {
                        let cover = builder.cover(name, child);
                        let mut entries = builder.entries(child, cover);
                        if let Some(cover) = cover {
                            entries.insert(0, NavEntry { path: Some(cover.clone()), title: builder.title(cover), children: vec![] });
                        }
                        (builder.first_position(child), NavGroup { title: Some(folder_title(name)), entries })
                    })
                    .collect();
                subfolders.sort_by_key(|(position, _)| *position);
                groups.extend(subfolders.into_iter().map(|(_, group)| group));
            }
        }
    }
    loose.sort_by_key(|path| builder.position(path));
    let mut index = SpaceIndex::default();
    if !loose.is_empty() {
        let entries = loose.iter().map(|path| NavEntry { path: Some(path.clone()), title: builder.title(path), children: vec![] }).collect();
        groups.insert(0, NavGroup { title: None, entries });
    }
    for group in &groups {
        let mut trail: Vec<String> = group.title.iter().cloned().collect();
        collect_order(&group.entries, &mut trail, &mut index);
    }
    index.groups = groups;
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(path: &str, title: &str, created_at: i64, next: Option<&str>) -> IndexedPage {
        IndexedPage { path: path.into(), title: title.into(), created_at: Some(created_at), next: next.map(String::from) }
    }

    fn entry(path: Option<&str>, title: &str, children: Vec<NavEntry>) -> NavEntry {
        NavEntry { path: path.map(String::from), title: title.into(), children }
    }

    const ROOT: &str = "Cursos/programacion";

    /// The course of the library, reduced: an index note at the root, one
    /// subfolder per group, covers named like their folder, a chain across
    /// folders and creation dates out of order.
    fn course() -> Vec<IndexedPage> {
        let p = |relative: &str| format!("{ROOT}/{relative}");
        vec![
            page(&p("Indice.md"), "Table of contents", 1, Some(&p("programacion-general/conceptos/Conceptos.md"))),
            page(&p("programacion-general/conceptos/Conceptos.md"), "Conceptos", 2, Some(&p("programacion-general/conceptos/introduccion.md"))),
            page(&p("programacion-general/conceptos/introduccion.md"), "Introduccion", 9, Some(&p("programacion-general/conceptos/que-es/¿Que es.md"))),
            page(&p("programacion-general/conceptos/que-es/¿Que es.md"), "¿Que es?", 4, Some(&p("programacion-general/conceptos/que-es/compilados.md"))),
            page(&p("programacion-general/conceptos/que-es/compilados.md"), "Compilados", 5, Some(&p("programacion-general/conceptos/algoritmos.md"))),
            page(&p("programacion-general/conceptos/algoritmos.md"), "Algoritmos", 3, Some(&p("backend/go-springboot.md"))),
            page(&p("backend/go-springboot.md"), "Go Springboot", 7, Some(&p("documentacion/diagramas.md"))),
            page(&p("documentacion/diagramas.md"), "Diagramas", 8, None),
            page(&p("documentacion/manuales.md"), "Manuales", 6, None),
        ]
    }

    #[test]
    fn a_folder_gives_its_notes_first_and_one_group_per_subfolder() {
        let index = build_index(&[SpaceItem { path: ROOT.into(), kind: ItemKind::Folder }], &course());
        let p = |relative: &str| Some(format!("{ROOT}/{relative}"));
        let groups: Vec<(Option<&str>, Vec<NavEntry>)> =
            index.groups.iter().map(|group| (group.title.as_deref(), group.entries.clone())).collect();
        assert_eq!(groups[0], (None, vec![entry(p("Indice.md").as_deref(), "Table of contents", vec![])]));
        assert_eq!(
            groups[1],
            (
                Some("Programacion general"),
                vec![entry(
                    p("programacion-general/conceptos/Conceptos.md").as_deref(),
                    "Conceptos",
                    vec![
                        entry(p("programacion-general/conceptos/introduccion.md").as_deref(), "Introduccion", vec![]),
                        entry(
                            p("programacion-general/conceptos/que-es/¿Que es.md").as_deref(),
                            "¿Que es?",
                            vec![entry(p("programacion-general/conceptos/que-es/compilados.md").as_deref(), "Compilados", vec![])]
                        ),
                        entry(p("programacion-general/conceptos/algoritmos.md").as_deref(), "Algoritmos", vec![]),
                    ]
                )]
            )
        );
        assert_eq!(groups[2].0, Some("Backend"));
        // Chained notes first; a note outside the chain goes after them.
        assert_eq!(
            groups[3],
            (
                Some("Documentacion"),
                vec![
                    entry(p("documentacion/diagramas.md").as_deref(), "Diagramas", vec![]),
                    entry(p("documentacion/manuales.md").as_deref(), "Manuales", vec![]),
                ]
            )
        );
        assert_eq!(index.order.first(), p("Indice.md").as_ref());
        assert_eq!(index.order.len(), 9);
        let (previous, next) = index.neighbours(&format!("{ROOT}/backend/go-springboot.md"));
        assert_eq!(previous, p("programacion-general/conceptos/algoritmos.md").as_deref());
        assert_eq!(next, p("documentacion/diagramas.md").as_deref());
        assert_eq!(
            index.trail[&format!("{ROOT}/programacion-general/conceptos/que-es/compilados.md")],
            vec!["Programacion general", "Conceptos", "¿Que es?"]
        );
    }

    #[test]
    fn single_notes_go_first_and_a_note_inside_a_folder_is_shown_once() {
        let pages = vec![page("Notas/guia.md", "Guía", 5, None), page("Notas/faq.md", "FAQ", 1, None), page("Cursos/x/a.md", "A", 2, None)];
        let items = [
            SpaceItem { path: "Notas/guia.md".into(), kind: ItemKind::File },
            SpaceItem { path: "Cursos/x".into(), kind: ItemKind::Folder },
            SpaceItem { path: "Notas/faq.md".into(), kind: ItemKind::File },
            SpaceItem { path: "Cursos/x/a.md".into(), kind: ItemKind::File },
        ];
        let index = build_index(&items, &pages);
        assert_eq!(index.groups.len(), 1);
        assert_eq!(index.order, vec!["Notas/faq.md", "Cursos/x/a.md", "Notas/guia.md"]);
    }

    #[test]
    fn a_folder_without_cover_is_a_title_with_its_pages_and_names_compare_without_accents() {
        let pages = vec![page("Docs/guias/paso-uno.md", "Paso uno", 1, None), page("Docs/guias/mas/README.md", "Más", 2, None)];
        let index = build_index(&[SpaceItem { path: "Docs".into(), kind: ItemKind::Folder }], &pages);
        assert_eq!(index.groups[0].title.as_deref(), Some("Guias"));
        assert_eq!(index.groups[0].entries[1], entry(Some("Docs/guias/mas/README.md"), "Más", vec![]));
        assert_eq!(comparable_name("¿Qué es un lenguaje?"), comparable_name("que-es-un-lenguaje"));
        let nested = vec![page("Docs/a/b/uno.md", "Uno", 1, None)];
        let index = build_index(&[SpaceItem { path: "Docs".into(), kind: ItemKind::Folder }], &nested);
        assert_eq!(index.groups[0].entries, vec![entry(None, "B", vec![entry(Some("Docs/a/b/uno.md"), "Uno", vec![])])]);
    }

    #[test]
    fn a_chain_that_loops_still_lists_every_page() {
        let pages = vec![page("D/a.md", "A", 2, Some("D/b.md")), page("D/b.md", "B", 1, Some("D/a.md"))];
        let index = build_index(&[SpaceItem { path: "D".into(), kind: ItemKind::Folder }], &pages);
        assert_eq!(index.order, vec!["D/b.md", "D/a.md"]);
    }
}
