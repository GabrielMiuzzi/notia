//! `nextPage` / `previousPage` links between notes: reference parsing,
//! resolution relative to the note and frontmatter reads. The adapter walks
//! the chain for cycles and updates the opposite link of each target.
//! `inspect_page_chain` reads the links of a whole folder at once, so the
//! agent checks a long course without reading its pages one by one.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use crate::library_tools::DocumentMetadata;

/// Pages one inspection reads, with their frontmatter.
pub const MAX_CHAIN_DOCUMENTS: usize = 300;

/// Referenced path of a page-link value (`[[path]]`, `[[alias|path]]`, plain
/// path); `None` for empty or `N/A`.
pub fn extract_link_path(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches(['"', '\'']).trim();
    if trimmed.is_empty() || trimmed == "N/A" {
        return None;
    }
    let reference = match trimmed.strip_prefix("[[").and_then(|inner| inner.strip_suffix("]]")) {
        Some(inner) => inner.rsplit('|').next().unwrap_or(inner).trim(),
        None => trimmed,
    };
    (!reference.is_empty()).then(|| reference.to_string())
}

/// Logical path of `reference` seen from the note at `current`: bare names
/// are siblings (with `.md` when there is no extension); references with a
/// folder are library-relative.
pub fn resolve_link_path(reference: &str, current: &str) -> Option<String> {
    let reference = reference.trim().replace('\\', "/");
    if reference.is_empty() || reference.split('/').any(|part| part == "..") {
        return None;
    }
    if reference.contains('/') {
        return Some(reference.trim_start_matches('/').to_string());
    }
    let name = if reference.contains('.') { reference } else { format!("{reference}.md") };
    Some(match current.rsplit_once('/') {
        Some((directory, _)) => format!("{directory}/{name}"),
        None => name,
    })
}

/// Unquoted value of a frontmatter key, if present.
pub fn frontmatter_value(source: &str, key: &str) -> Option<String> {
    let normalized = source.replace("\r\n", "\n");
    let body = normalized.strip_prefix("---\n")?;
    let end = body.find("\n---")?;
    body[..end].lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case(key)
            .then(|| value.trim().trim_matches(['"', '\'']).to_string())
    })
}

pub fn same_path(left: &str, right: &str) -> bool {
    left.replace('\\', "/").eq_ignore_ascii_case(&right.replace('\\', "/"))
}

/// A page of the folder with its links resolved to library paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainPage {
    pub path: String,
    pub title: String,
    /// `None` when the key is missing, empty or `N/A`.
    pub next_page: Option<String>,
    pub previous_page: Option<String>,
    pub frontmatter: BTreeMap<String, String>,
}

/// Something wrong in the links: `roto` (the target does not exist),
/// `no-reciproco` (the target does not link back), `ruta-corta` (a bare
/// name instead of the full path), `varios-anteriores` (several pages lead
/// to the same one), `ciclo` and `suelta` (a page without links in a folder
/// that has a chain).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainIssue {
    pub kind: &'static str,
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageChainReport {
    pub folder: String,
    pub documents: usize,
    /// Each chain from its first page, following `nextPage`.
    pub chains: Vec<Vec<String>>,
    /// The pages in chain order, then the rest by path.
    pub pages: Vec<ChainPage>,
    pub issues: Vec<ChainIssue>,
}

fn link_value<'a>(frontmatter: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    frontmatter.iter().find(|(name, _)| name.eq_ignore_ascii_case(key)).map(|(_, value)| value.as_str())
}

/// The links of the Markdown pages of a folder: their chains and every
/// broken, one-way, short or repeated link. `exists` answers for targets
/// outside the folder.
pub fn inspect_page_chain(folder: &str, documents: Vec<DocumentMetadata>, exists: &dyn Fn(&str) -> bool) -> PageChainReport {
    let mut issues = Vec::new();
    let mut pages = Vec::new();
    for document in documents {
        let path = document.locator.logical_path.as_str().to_string();
        if !path.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        let mut resolve = |key: &str| {
            let reference = extract_link_path(link_value(&document.frontmatter, key)?)?;
            let Some(target) = resolve_link_path(&reference, &path) else {
                issues.push(ChainIssue { kind: "roto", path: path.clone(), detail: format!("{key} usa «{reference}», que no es una ruta válida.") });
                return None;
            };
            if !reference.contains('/') {
                issues.push(ChainIssue { kind: "ruta-corta", path: path.clone(), detail: format!("{key} usa «{reference}»; la ruta completa es «{target}».") });
            }
            Some(target)
        };
        let next_page = resolve("nextPage");
        let previous_page = resolve("previousPage");
        pages.push(ChainPage { path, title: document.title, next_page, previous_page, frontmatter: document.frontmatter });
    }
    pages.sort_by_key(|page| page.path.to_lowercase());
    let index = pages.iter().enumerate().map(|(position, page)| (page.path.to_lowercase(), position)).collect::<HashMap<_, _>>();
    let find = |target: &str| index.get(&target.to_lowercase()).copied();
    let shown = |value: &Option<String>| value.clone().unwrap_or_else(|| "vacío".to_string());

    let mut incoming = HashMap::<usize, Vec<usize>>::new();
    for (position, page) in pages.iter().enumerate() {
        for (key, target, back_key) in [("nextPage", &page.next_page, "previousPage"), ("previousPage", &page.previous_page, "nextPage")] {
            let Some(target) = target else { continue };
            match find(target) {
                Some(other) => {
                    let back = if key == "nextPage" { &pages[other].previous_page } else { &pages[other].next_page };
                    if !back.as_deref().is_some_and(|back| same_path(back, &page.path)) {
                        issues.push(ChainIssue {
                            kind: "no-reciproco",
                            path: page.path.clone(),
                            detail: format!("{key} apunta a «{target}», pero el {back_key} de esa página es «{}».", shown(back)),
                        });
                    }
                    if key == "nextPage" {
                        incoming.entry(other).or_default().push(position);
                    }
                }
                None if !exists(target) => issues.push(ChainIssue {
                    kind: "roto",
                    path: page.path.clone(),
                    detail: format!("{key} apunta a «{target}», que no existe."),
                }),
                None => {}
            }
        }
    }
    for (target, sources) in &incoming {
        if sources.len() > 1 {
            let names = sources.iter().map(|source| pages[*source].path.as_str()).collect::<Vec<_>>().join(", ");
            issues.push(ChainIssue { kind: "varios-anteriores", path: pages[*target].path.clone(), detail: format!("Llegan a esta página los nextPage de {names}.") });
        }
    }

    // A chain starts at a page no page of the folder leads to; what is left
    // after walking them is a cycle.
    let mut visited = vec![false; pages.len()];
    let mut chains = Vec::new();
    let starts = (0..pages.len()).filter(|position| !incoming.contains_key(position)).collect::<Vec<_>>();
    let leftovers = (0..pages.len()).collect::<Vec<_>>();
    for start in starts.into_iter().chain(leftovers) {
        if visited[start] {
            continue;
        }
        let mut chain = Vec::new();
        let mut current = Some(start);
        while let Some(position) = current {
            if visited[position] {
                if chain.contains(&position) || incoming.get(&start).is_some() {
                    issues.push(ChainIssue { kind: "ciclo", path: pages[position].path.clone(), detail: "La cadena vuelve a esta página.".to_string() });
                }
                break;
            }
            visited[position] = true;
            chain.push(position);
            current = pages[position].next_page.as_deref().and_then(find);
        }
        chains.push(chain);
    }
    let linked = chains.iter().any(|chain| chain.len() > 1);
    let mut order = Vec::new();
    let mut listed_chains = Vec::new();
    for chain in chains {
        if chain.len() == 1 {
            let page = &pages[chain[0]];
            if linked && page.next_page.is_none() && page.previous_page.is_none() {
                issues.push(ChainIssue { kind: "suelta", path: page.path.clone(), detail: "No tiene nextPage ni previousPage.".to_string() });
            }
        } else {
            listed_chains.push(chain.iter().map(|position| pages[*position].path.clone()).collect());
        }
        order.extend(chain);
    }
    let mut slots = pages.into_iter().map(Some).collect::<Vec<_>>();
    let pages = order.into_iter().filter_map(|position| slots[position].take()).collect::<Vec<_>>();
    PageChainReport { folder: folder.to_string(), documents: pages.len(), chains: listed_chains, pages, issues }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_resolves_page_links() {
        assert_eq!(extract_link_path("\"[[alias|6-10]]\"").as_deref(), Some("6-10"));
        assert_eq!(extract_link_path("N/A"), None);
        assert_eq!(resolve_link_path("6-10", "libro/1-5.md").as_deref(), Some("libro/6-10.md"));
        assert_eq!(resolve_link_path("otra/x.md", "libro/1.md").as_deref(), Some("otra/x.md"));
        assert_eq!(resolve_link_path("../x.md", "libro/1.md"), None);
        assert_eq!(
            frontmatter_value("---\nnextPage: \"[[b.md]]\"\n---\n", "nextpage").as_deref(),
            Some("[[b.md]]")
        );
        assert!(same_path("Libro/A.md", "libro/a.md"));
    }

    fn page(path: &str, next: &str, previous: &str) -> DocumentMetadata {
        let mut frontmatter = BTreeMap::new();
        frontmatter.insert("nextPage".to_string(), next.to_string());
        frontmatter.insert("previousPage".to_string(), previous.to_string());
        frontmatter.insert("etapa".to_string(), "1".to_string());
        DocumentMetadata {
            document_id: format!("library-1:{path}"),
            locator: crate::library_tools::DocumentLocatorDto::new("library-1", path, None, None).expect("locator"),
            title: path.to_string(),
            kind: crate::library_tools::DocumentKind::Markdown,
            size_chars: 0,
            modified_at: None,
            revision: 0,
            tags: Vec::new(),
            frontmatter,
        }
    }

    #[test]
    fn a_folder_chain_is_read_at_once_with_every_problem() {
        let documents = vec![
            page("curso/3.md", "N/A", "[[curso/2.md]]"),
            page("curso/1.md", "[[curso/2.md]]", "N/A"),
            page("curso/2.md", "[[curso/3.md]]", "[[curso/1.md]]"),
            // A second chain: the bare name, a one-way link and a broken one.
            page("curso/a.md", "[[b]]", ""),
            page("curso/b.md", "[[curso/falta.md]]", "N/A"),
            page("curso/suelta.md", "", ""),
        ];
        let report = inspect_page_chain("curso", documents, &|path| path == "otra/existe.md");
        assert_eq!(report.documents, 6);
        assert_eq!(report.chains, vec![vec!["curso/1.md", "curso/2.md", "curso/3.md"], vec!["curso/a.md", "curso/b.md"]]);
        assert_eq!(report.pages[0].path, "curso/1.md");
        assert_eq!(report.pages[0].frontmatter.get("etapa").map(String::as_str), Some("1"));
        assert_eq!(report.pages[3].next_page.as_deref(), Some("curso/b.md"));
        let kinds = report.issues.iter().map(|issue| (issue.kind, issue.path.as_str())).collect::<Vec<_>>();
        assert!(kinds.contains(&("ruta-corta", "curso/a.md")), "{kinds:?}");
        assert!(kinds.contains(&("no-reciproco", "curso/a.md")), "{kinds:?}");
        assert!(kinds.contains(&("roto", "curso/b.md")), "{kinds:?}");
        assert!(kinds.contains(&("suelta", "curso/suelta.md")), "{kinds:?}");
        assert_eq!(kinds.len(), 4, "{kinds:?}");
    }

    #[test]
    fn a_cycle_and_two_pages_leading_to_one_are_reported() {
        let documents = vec![
            page("c/1.md", "[[c/2.md]]", "[[c/2.md]]"),
            page("c/2.md", "[[c/1.md]]", "[[c/1.md]]"),
            page("c/x.md", "[[c/y.md]]", ""),
            page("c/z.md", "[[c/y.md]]", ""),
            page("c/y.md", "", "[[c/x.md]]"),
        ];
        let report = inspect_page_chain("c", documents, &|_| false);
        let kinds = report.issues.iter().map(|issue| issue.kind).collect::<Vec<_>>();
        assert!(kinds.contains(&"ciclo"), "{kinds:?}");
        assert!(kinds.contains(&"varios-anteriores"), "{kinds:?}");
        assert!(kinds.contains(&"no-reciproco"), "{kinds:?}");
        assert_eq!(report.documents, 5);
    }
}
