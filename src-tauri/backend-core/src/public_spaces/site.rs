//! A public space ready to serve: its published notes and images, the
//! index, the search and the JSON each route of the site answers. The app
//! only reads the notes from the library and answers HTTP.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::index::{build_index, IndexedPage, NavEntry, NavGroup, SpaceIndex};
use super::render::{links, render_page, SpacePages};
use super::search::{plain_text, search, SearchDocument};
use super::SpaceItem;
use crate::gitbook_blocks::document_title;
use crate::page_links::{extract_link_path, frontmatter_value, resolve_link_path};

/// A published note: it is inside the space and has the `#Publico` context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SitePage {
    pub path: String,
    pub source: String,
    pub modified_at: Option<i64>,
}

struct Page {
    path: String,
    title: String,
    source: String,
    modified_at: Option<i64>,
}

pub struct Site {
    name: String,
    pages: BTreeMap<String, Page>,
    files: BTreeMap<String, String>,
    index: SpaceIndex,
    documents: Vec<SearchDocument>,
}

fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

fn common_prefix(left: &str, right: &str) -> usize {
    left.split('/').zip(right.split('/')).take_while(|(a, b)| a.eq_ignore_ascii_case(b)).count()
}

/// A title as written in Markdown, without its escapes (`Bit\&Byte`).
fn unescaped(title: &str) -> String {
    let mut output = String::with_capacity(title.len());
    let mut characters = title.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\\' && characters.peek().is_some_and(char::is_ascii_punctuation) {
            continue;
        }
        output.push(character);
    }
    output
}

fn created_at(source: &str) -> Option<i64> {
    frontmatter_value(source, "createdAt").and_then(|value| value.trim().parse().ok())
}

fn next_page(source: &str, path: &str) -> Option<String> {
    let reference = extract_link_path(&frontmatter_value(source, "nextPage")?)?;
    resolve_link_path(&reference, path)
}

fn nav_entries(entries: &[NavEntry]) -> Vec<Value> {
    entries
        .iter()
        .map(|entry| json!({ "url": entry.path.as_deref().map(links::page_url), "title": entry.title, "children": nav_entries(&entry.children) }))
        .collect()
}

fn nav_groups(groups: &[NavGroup]) -> Value {
    Value::Array(groups.iter().map(|group| json!({ "title": group.title, "entries": nav_entries(&group.entries) })).collect())
}

impl Site {
    /// The site of a space named `name` publishing `items`, over the
    /// published `pages` and image `files` (logical paths).
    pub fn build(name: &str, items: &[SpaceItem], pages: Vec<SitePage>, files: Vec<String>) -> Self {
        let pages: BTreeMap<String, Page> = pages
            .into_iter()
            // `publicado: false` keeps a note out of the site.
            .filter(|page| !super::is_unpublished(&page.source))
            .map(|page| {
                let title = unescaped(&document_title(&page.source, &page.path));
                (page.path.to_lowercase(), Page { title, path: page.path, source: page.source, modified_at: page.modified_at })
            })
            .collect();
        let indexed: Vec<IndexedPage> = pages
            .values()
            .map(|page| IndexedPage { path: page.path.clone(), title: page.title.clone(), created_at: created_at(&page.source), next: next_page(&page.source, &page.path) })
            .collect();
        let index = build_index(items, &indexed);
        let documents = index
            .order
            .iter()
            .filter_map(|path| pages.get(&path.to_lowercase()))
            .map(|page| SearchDocument { path: page.path.clone(), title: page.title.clone(), text: plain_text(&page.source) })
            .collect();
        Self { name: name.to_string(), pages, files: files.into_iter().map(|path| (path.to_lowercase(), path)).collect(), index, documents }
    }

    pub fn page_count(&self) -> usize {
        self.index.order.len()
    }

    /// `/api/space`: the name, the index and the first page.
    pub fn space_view(&self) -> Value {
        json!({
            "name": self.name,
            "groups": nav_groups(&self.index.groups),
            "home": self.index.order.first().map(|path| links::page_url(path)),
            "pageCount": self.page_count(),
        })
    }

    fn link(&self, path: &str) -> Option<Value> {
        Some(json!({ "url": links::page_url(path), "title": self.title(path)? }))
    }

    /// `/api/page`: the page behind `url_path`; `None` when not published.
    pub fn page_view(&self, url_path: &str) -> Option<Value> {
        let path = links::page_path_of_url(url_path)?;
        let page = self.pages.get(&path.to_lowercase())?;
        let rendered = render_page(&page.source, &page.path, self);
        let (previous, next) = self.index.neighbours(&page.path);
        Some(json!({
            "url": links::page_url(&page.path),
            "title": rendered.title,
            "description": rendered.description,
            "html": rendered.html,
            "outline": rendered.outline,
            "trail": self.index.trail.get(&page.path).cloned().unwrap_or_default(),
            "previous": previous.and_then(|path| self.link(path)),
            "next": next.and_then(|path| self.link(path)),
            "modifiedAt": page.modified_at,
        }))
    }

    /// `/api/search`.
    pub fn search_view(&self, query: &str) -> Value {
        let results: Vec<Value> = search(&self.documents, query)
            .into_iter()
            .map(|hit| json!({ "url": links::page_url(&hit.path), "title": hit.title, "snippet": hit.snippet, "trail": self.index.trail.get(&hit.path) }))
            .collect();
        json!({ "results": results })
    }

    /// The published image behind `/files/...`.
    pub fn file_for_url(&self, url_path: &str) -> Option<String> {
        self.file(&links::file_path_of_url(url_path)?)
    }
}

impl SpacePages for Site {
    fn page(&self, path: &str) -> Option<String> {
        self.pages.get(&path.to_lowercase()).map(|page| page.path.clone())
    }

    fn page_named(&self, name: &str, near: &str) -> Option<String> {
        self.pages
            .values()
            .filter(|page| stem(&page.path).eq_ignore_ascii_case(name))
            .max_by_key(|page| common_prefix(&page.path, near))
            .map(|page| page.path.clone())
    }

    fn title(&self, path: &str) -> Option<String> {
        self.pages.get(&path.to_lowercase()).map(|page| page.title.clone())
    }

    fn file(&self, path: &str) -> Option<String> {
        self.files.get(&path.to_lowercase()).cloned()
    }

    fn source(&self, path: &str) -> Option<String> {
        self.pages.get(&path.to_lowercase()).map(|page| page.source.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::public_spaces::ItemKind;

    fn note(path: &str, body: &str) -> SitePage {
        SitePage { path: path.into(), source: format!("---\ncontexto: \"#Publico\"\n{body}"), modified_at: Some(1_790_000_000_000) }
    }

    fn site() -> Site {
        Site::build(
            "Curso",
            &[SpaceItem { path: "Curso".into(), kind: ItemKind::Folder }],
            vec![
                note("Curso/Indice.md", "createdAt: 1\nnextPage: \"[[uno.md]]\"\n---\n# Índice\n"),
                note("Curso/uno.md", "createdAt: 2\n---\n# Primera\n\n## Parte\nTexto con memoria.\n\n![Diagrama](img/a.png)\n"),
            ],
            vec!["Curso/img/a.png".into()],
        )
    }

    #[test]
    fn a_note_with_publicado_false_is_left_out() {
        let site = Site::build(
            "Curso",
            &[SpaceItem { path: "Curso".into(), kind: ItemKind::Folder }],
            vec![note("Curso/uno.md", "publicado: true\n---\n# Uno\n"), note("Curso/borrador.md", "publicado: false\n---\n# Borrador\n[uno](uno.md)\n")],
            vec![],
        );
        assert_eq!(site.page_count(), 1);
        assert!(site.page_view("/Curso/borrador").is_none());
        assert_eq!(site.search_view("borrador")["results"], json!([]));
    }

    #[test]
    fn the_space_lists_its_pages_with_their_urls() {
        let view = site().space_view();
        assert_eq!(view["name"], "Curso");
        assert_eq!(view["home"], "/Curso/Indice");
        assert_eq!(view["groups"][0]["entries"][1], json!({ "url": "/Curso/uno", "title": "Primera", "children": [] }));
    }

    #[test]
    fn a_page_has_its_neighbours_outline_and_images() {
        let site = site();
        let page = site.page_view("/Curso/uno").expect("page");
        assert_eq!(page["title"], "Primera");
        assert_eq!(page["previous"], json!({ "url": "/Curso/Indice", "title": "Índice" }));
        assert_eq!(page["next"], Value::Null);
        assert_eq!(page["outline"][0]["id"], "parte");
        assert_eq!(unescaped("Bit\\&Byte \\[x\\] a\\b"), "Bit&Byte [x] a\\b");
        assert!(page["html"].as_str().unwrap().contains("<img src=\"/files/Curso/img/a.png\""));
        assert_eq!(site.file_for_url("/files/Curso/img/a.png").as_deref(), Some("Curso/img/a.png"));
        assert!(site.page_view("/Curso/secreta").is_none());
        assert_eq!(site.search_view("memoria")["results"][0]["url"], "/Curso/uno");
    }

    /// Writes the site of a library folder as JSON (`space` and every page
    /// by URL) for the visual preview of the public site:
    /// `NOTIA_PUBLIC_SPACE_LIBRARY=<library root> NOTIA_PUBLIC_SPACE_FOLDER=<logical folder>
    /// NOTIA_PUBLIC_SPACE_OUT=<file.json> cargo test -p notia-backend-core writes_a_library_folder -- --ignored`
    #[test]
    #[ignore]
    fn writes_a_library_folder_for_the_preview() {
        use std::path::Path;
        let library = std::env::var("NOTIA_PUBLIC_SPACE_LIBRARY").expect("NOTIA_PUBLIC_SPACE_LIBRARY");
        let folder = std::env::var("NOTIA_PUBLIC_SPACE_FOLDER").expect("NOTIA_PUBLIC_SPACE_FOLDER");
        let out = std::env::var("NOTIA_PUBLIC_SPACE_OUT").expect("NOTIA_PUBLIC_SPACE_OUT");
        let root = Path::new(&library);
        let contexts = std::fs::read_to_string(root.join(".notia/folderContexts.json"))
            .map(|text| crate::folder_contexts::FolderContexts::parse(&text))
            .unwrap_or_default();
        fn walk(root: &Path, directory: &Path, found: &mut Vec<String>) {
            for entry in std::fs::read_dir(directory).expect("folder").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(root, &path, found);
                } else if let Ok(relative) = path.strip_prefix(root) {
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        let mut files = Vec::new();
        walk(root, &root.join(&folder), &mut files);
        let pages: Vec<SitePage> = files
            .iter()
            .filter(|path| path.to_lowercase().ends_with(".md"))
            .filter_map(|path| {
                let source = std::fs::read_to_string(root.join(path)).ok()?;
                let public = crate::public_spaces::is_public_context(crate::library_graph::frontmatter_context(&source).as_deref())
                    || crate::public_spaces::is_public_context(contexts.effective(path));
                public.then(|| SitePage { path: path.clone(), source, modified_at: Some(1_790_000_000_000) })
            })
            .collect();
        let images = files.iter().filter(|path| !path.to_lowercase().ends_with(".md")).cloned().collect();
        let site = Site::build("Curso de programación", &[SpaceItem { path: folder.clone(), kind: ItemKind::Folder }], pages, images);
        let pages: serde_json::Map<String, Value> = site
            .index
            .order
            .iter()
            .map(|path| (links::page_url(path), site.page_view(&links::page_url(path)).expect("page")))
            .collect();
        let output = json!({ "space": site.space_view(), "pages": pages, "search": { "memoria": site.search_view("memoria"), "puntero": site.search_view("puntero") } });
        std::fs::write(out, serde_json::to_string_pretty(&output).expect("json")).expect("write");
    }
}
