//! Library link graph (Graph View and `.notia/linkCache.md`): nodes from the
//! inventory, edges from wiki and Markdown links, context colors from the
//! note or its Task Manager board. Paths are library logical paths.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::Serialize;

const MARKDOWN_EXTENSIONS: [&str; 5] = ["md", "markdown", "mdown", "mkdn", "mkd"];
pub const MAX_GRAPH_FILES: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeDto {
    pub id: String,
    pub path: String,
    pub label: String,
    pub degree: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeDto {
    pub id: String,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct GraphModelDto {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
}

/// Context catalog entry (`#tag` and color) of the library configuration.
#[derive(Debug, Clone)]
pub struct GraphContext {
    pub tag: String,
    pub color: String,
}

pub fn is_markdown_path(path: &str) -> bool {
    extension(path).is_some_and(|extension| MARKDOWN_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn extension(path: &str) -> Option<&str> {
    let name = file_name(path);
    let dot = name.rfind('.')?;
    (dot > 0).then(|| &name[dot + 1..])
}

fn strip_extension(name: &str) -> &str {
    match name.rfind('.') {
        Some(dot) if dot > 0 => &name[..dot],
        _ => name,
    }
}

fn has_extension(path: &str) -> bool {
    let name = file_name(path);
    name.rfind('.').is_some_and(|dot| dot + 1 < name.len())
}

fn lookup_key(value: &str) -> String {
    let mut key = value.trim().replace('\\', "/");
    while key.contains("//") {
        key = key.replace("//", "/");
    }
    let key = key.strip_prefix("./").unwrap_or(&key);
    key.trim_start_matches('/').to_lowercase()
}

fn is_external(reference: &str) -> bool {
    if reference.is_empty() || reference.starts_with('#') || reference.starts_with("//") {
        return true;
    }
    let mut characters = reference.chars();
    let Some(first) = characters.next() else {
        return true;
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    for character in characters {
        if character == ':' {
            return true;
        }
        if !(character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')) {
            return false;
        }
    }
    false
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3).and_then(|pair| std::str::from_utf8(pair).ok());
            match hex.and_then(|pair| u8::from_str_radix(pair, 16).ok()) {
                Some(byte) => {
                    decoded.push(byte);
                    index += 3;
                    continue;
                }
                None => return value.to_string(),
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| value.to_string())
}

fn sanitize_reference(raw: &str) -> String {
    let trimmed = raw.trim();
    let unwrapped = trimmed
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
        .unwrap_or(trimmed);
    let without_fragment = unwrapped.split('#').next().unwrap_or_default();
    let without_query = without_fragment.split('?').next().unwrap_or_default();
    let without_quotes = without_query
        .strip_prefix(['\'', '"'])
        .unwrap_or(without_query);
    let without_quotes = without_quotes
        .strip_suffix(['\'', '"'])
        .unwrap_or(without_quotes);
    percent_decode(without_quotes)
}

/// Link targets of a Markdown document: wikilinks, legacy escaped wikilinks
/// and relative Markdown links, without duplicates.
fn link_references(content: &str) -> Vec<String> {
    let mut references = Vec::new();
    let mut seen = BTreeSet::new();
    let mut push = |reference: String| {
        if !reference.is_empty() && !is_external(&reference) && seen.insert(reference.clone()) {
            references.push(reference);
        }
    };
    for (open, close) in [("[[", "]]"), ("\\[\\[", "]]")] {
        let mut rest = content;
        while let Some(start) = rest.find(open) {
            let after = &rest[start + open.len()..];
            let Some(end) = after.find(close) else {
                break;
            };
            let inner = &after[..end];
            if !inner.is_empty() && !inner.contains('\n') && !inner.contains(']') {
                let target = inner.split('|').next().unwrap_or_default().trim();
                push(sanitize_reference(target));
                rest = &after[end + close.len()..];
            } else {
                rest = &rest[start + open.len()..];
            }
        }
    }
    let mut rest = content;
    while let Some(bracket) = rest.find('[') {
        let after = &rest[bracket + 1..];
        let Some(label_end) = after.find(']') else {
            break;
        };
        let tail = &after[label_end + 1..];
        if let Some(href_part) = tail.strip_prefix('(') {
            if let Some(href_end) = href_part.find(')') {
                let href = &href_part[..href_end];
                if !href.contains('\n') && !href.trim().is_empty() {
                    let token = href.trim().split_whitespace().next().unwrap_or_default();
                    push(sanitize_reference(token));
                }
            }
        }
        rest = after;
    }
    references
}

fn resolve_relative(base_directory: &str, reference: &str) -> String {
    let mut segments = base_directory
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    for segment in reference.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            _ => segments.push(segment.to_string()),
        }
    }
    segments.join("/")
}

struct Lookup(HashMap<String, Option<String>>);

impl Lookup {
    fn register(&mut self, key: &str, path: &str) {
        let key = lookup_key(key);
        if key.is_empty() {
            return;
        }
        match self.0.get(&key) {
            None => {
                self.0.insert(key, Some(path.to_string()));
            }
            Some(Some(existing)) if existing != path => {
                self.0.insert(key, None);
            }
            _ => {}
        }
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(&lookup_key(key)).and_then(|value| value.as_deref())
    }
}

fn resolve_target(source: &str, reference: &str, lookup: &Lookup) -> Option<String> {
    let normalized = sanitize_reference(&reference.replace('\\', "/"));
    if normalized.is_empty() || is_external(&normalized) {
        return None;
    }
    let source_directory = source.rsplit_once('/').map(|(directory, _)| directory).unwrap_or("");
    let mut candidates = vec![resolve_relative(source_directory, &normalized)];
    if normalized.starts_with('/') {
        candidates.push(normalized.trim_start_matches('/').to_string());
    }
    for candidate in &candidates {
        if let Some(path) = lookup.get(candidate) {
            return Some(path.to_string());
        }
        if !has_extension(candidate) {
            if let Some(path) = lookup.get(&format!("{candidate}.md")) {
                return Some(path.to_string());
            }
        }
    }
    lookup
        .get(reference)
        .or_else(|| lookup.get(strip_extension(reference)))
        .map(str::to_string)
}

fn frontmatter_context(content: &str) -> Option<String> {
    let normalized = content.replace("\r\n", "\n");
    let body = normalized.strip_prefix("---\n")?;
    let end = body.find("\n---")?;
    body[..end].lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "contexto")
            .then(|| value.trim().trim_matches(['"', '\'']).to_string())
            .filter(|value| !value.is_empty())
    })
}

fn board_of(path: &str) -> Option<String> {
    let segments = path.split('/').collect::<Vec<_>>();
    segments.windows(3).find_map(|window| {
        let root = window[0].to_ascii_lowercase();
        (root == "task-mannager" || root == "task-manager").then(|| window[1].to_lowercase())
    })
}

/// Builds the graph from the library files (logical paths), the Markdown
/// sources that could be read, the context catalog and board contexts
/// (lower-case board name → tag).
pub fn build_library_graph(
    files: &[String],
    sources: &BTreeMap<String, String>,
    contexts: &[GraphContext],
    board_contexts: &HashMap<String, String>,
) -> GraphModelDto {
    let files = files.iter().take(MAX_GRAPH_FILES).collect::<Vec<_>>();
    let mut lookup = Lookup(HashMap::new());
    for path in &files {
        let name = file_name(path);
        lookup.register(path, path);
        lookup.register(strip_extension(path), path);
        lookup.register(name, path);
        lookup.register(strip_extension(name), path);
    }
    let known = files.iter().map(|path| path.as_str()).collect::<BTreeSet<_>>();
    let mut edges = Vec::new();
    let mut edge_keys = BTreeSet::new();
    let mut degree = HashMap::<String, usize>::new();
    for (source, content) in sources {
        if !known.contains(source.as_str()) || !is_markdown_path(source) {
            continue;
        }
        for reference in link_references(content) {
            let Some(target) = resolve_target(source, &reference, &lookup) else {
                continue;
            };
            if &target == source {
                continue;
            }
            let (left, right) = if source.as_str() <= target.as_str() {
                (source.clone(), target)
            } else {
                (target, source.clone())
            };
            let key = format!("{left}<=>{right}");
            if edge_keys.insert(key.clone()) {
                *degree.entry(left.clone()).or_default() += 1;
                *degree.entry(right.clone()).or_default() += 1;
                edges.push(GraphEdgeDto { id: key, source_path: left, target_path: right });
            }
        }
    }
    let mut nodes = files
        .iter()
        .map(|path| {
            let name = file_name(path);
            let stem = strip_extension(name);
            let context = is_markdown_path(path)
                .then(|| {
                    board_of(path)
                        .and_then(|board| board_contexts.get(&board).cloned())
                        .or_else(|| sources.get(*path).and_then(|content| frontmatter_context(content)))
                })
                .flatten()
                .and_then(|tag| {
                    contexts
                        .iter()
                        .find(|context| context.tag.eq_ignore_ascii_case(tag.trim()))
                        .cloned()
                });
            GraphNodeDto {
                id: (*path).clone(),
                path: (*path).clone(),
                label: if stem.is_empty() { name.to_string() } else { stem.to_string() },
                degree: degree.get(*path).copied().unwrap_or(0),
                context_tag: context.as_ref().map(|context| context.tag.clone()),
                context_color: context.map(|context| context.color),
            }
        })
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    GraphModelDto { nodes, edges }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphSearchResultDto {
    pub path: String,
    pub label: String,
    pub preview: String,
    pub score: i64,
}

/// Lower-case text without Latin diacritics, for accent-insensitive search.
pub fn fold_search_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

fn search_preview(source: &str, query: &str) -> String {
    let flattened = source.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.is_empty() {
        return "Coincidencia en el archivo".to_string();
    }
    let characters = flattened.chars().collect::<Vec<_>>();
    let folded = fold_search_text(&flattened).chars().collect::<Vec<_>>();
    let needle = query.chars().collect::<Vec<_>>();
    let position = (!needle.is_empty() && folded.len() >= needle.len())
        .then(|| (0..=folded.len() - needle.len()).find(|&start| folded[start..start + needle.len()] == needle[..]))
        .flatten();
    let Some(position) = position.filter(|_| folded.len() == characters.len()) else {
        return characters.iter().take(140).collect();
    };
    let start = position.saturating_sub(44);
    let end = (position + needle.len() + 72).min(characters.len());
    format!(
        "{}{}{}",
        if start > 0 { "... " } else { "" },
        characters[start..end].iter().collect::<String>(),
        if end < characters.len() { " ..." } else { "" }
    )
}

/// Title and content search over the graph nodes, best matches first.
pub fn search_library_graph(
    model: &GraphModelDto,
    sources: &BTreeMap<String, String>,
    query: &str,
    max_results: usize,
) -> Vec<GraphSearchResultDto> {
    let query = fold_search_text(query.trim());
    if query.is_empty() {
        return Vec::new();
    }
    let position = |haystack: &str| haystack.find(&query).map(|byte| haystack[..byte].chars().count() as i64);
    let mut results = model
        .nodes
        .iter()
        .filter_map(|node| {
            let source = sources.get(&node.path).map(String::as_str).unwrap_or("");
            let title = position(&fold_search_text(&node.label));
            let content = position(&fold_search_text(source));
            if title.is_none() && content.is_none() {
                return None;
            }
            let score = title.map(|index| 600 - index * 8).unwrap_or(0)
                + content.map(|index| 240 - index.min(180)).unwrap_or(0)
                + node.degree.min(12) as i64 * 4;
            Some(GraphSearchResultDto {
                path: node.path.clone(),
                label: node.label.clone(),
                preview: search_preview(source, &query),
                score,
            })
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
    });
    results.truncate(max_results.clamp(1, 100));
    results
}

/// Explorer search: files whose logical path or name, or Markdown content,
/// contains the query (accent-insensitive), ordered by name and path.
pub fn search_library_files(
    model: &GraphModelDto,
    sources: &BTreeMap<String, String>,
    query: &str,
    limit: usize,
) -> Vec<String> {
    let query = fold_search_text(query.trim());
    if query.is_empty() {
        return Vec::new();
    }
    let mut matches = model
        .nodes
        .iter()
        .filter(|node| {
            fold_search_text(&node.path).contains(&query)
                || sources
                    .get(&node.path)
                    .is_some_and(|content| fold_search_text(content).contains(&query))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        left.label
            .to_lowercase()
            .cmp(&right.label.to_lowercase())
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    matches.into_iter().take(limit).map(|node| node.path.clone()).collect()
}

fn escape_mermaid_label(label: &str) -> String {
    label
        .replace('"', "&quot;")
        .replace('[', "&#91;")
        .replace(']', "&#93;")
        .replace('{', "&#123;")
        .replace('}', "&#125;")
}

/// Content of `.notia/linkCache.md`: a Mermaid flowchart grouped by folder.
pub fn render_link_cache(model: &GraphModelDto) -> String {
    let mut code = Vec::new();
    if !model.nodes.is_empty() {
        let mut ids = HashMap::new();
        let mut groups = BTreeMap::<String, Vec<String>>::new();
        code.push("flowchart TD".to_string());
        for (index, node) in model.nodes.iter().enumerate() {
            let id = format!("node_{}", index + 1);
            code.push(format!("    {id}[\"{}\"]", escape_mermaid_label(&node.label)));
            let folder = node.path.rsplit_once('/').map(|(folder, _)| folder.to_string()).unwrap_or_default();
            groups.entry(folder).or_default().push(id.clone());
            ids.insert(node.path.clone(), id);
        }
        for (folder, members) in groups {
            let name = if folder.trim().is_empty() { "(root)".to_string() } else { folder };
            code.push(format!("    subgraph \"{}\"", name.replace('"', "\\\"")));
            code.extend(members.iter().map(|id| format!("        {id}")));
            code.push("    end".to_string());
        }
        let mut seen = BTreeSet::new();
        for edge in &model.edges {
            let (Some(source), Some(target)) = (ids.get(&edge.source_path), ids.get(&edge.target_path)) else {
                continue;
            };
            let pair = if source <= target { (source, target) } else { (target, source) };
            if seen.insert(pair) {
                code.push(format!("    {source} --> {target}"));
            }
        }
    }
    format!(
        "<!-- Notia link cache - auto-generated, do not edit manually -->\n\n```mermaid\n{}\n```",
        code.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(files: &[&str], sources: &[(&str, &str)]) -> GraphModelDto {
        build_library_graph(
            &files.iter().map(|path| path.to_string()).collect::<Vec<_>>(),
            &sources.iter().map(|(path, content)| (path.to_string(), content.to_string())).collect(),
            &[GraphContext { tag: "#Laboral".into(), color: "#2563EB".into() }],
            &HashMap::from([("equipo".to_string(), "#Laboral".to_string())]),
        )
    }

    #[test]
    fn links_wiki_markdown_and_relative_references_once() {
        let model = build(
            &["notas/a.md", "notas/b.md", "otra/c.md", "img/x.png"],
            &[
                ("notas/a.md", "[[b]] [[b|alias]] [c](../otra/c.md) ![img](../img/x.png) [web](https://x.com)"),
                ("notas/b.md", "[[notas/a.md]]"),
            ],
        );
        let pairs = model.edges.iter().map(|edge| (edge.source_path.as_str(), edge.target_path.as_str())).collect::<Vec<_>>();
        assert_eq!(pairs, vec![("notas/a.md", "notas/b.md"), ("notas/a.md", "otra/c.md"), ("img/x.png", "notas/a.md")]);
        let a = model.nodes.iter().find(|node| node.path == "notas/a.md").expect("a");
        assert_eq!(a.degree, 3);
    }

    #[test]
    fn ambiguous_names_do_not_link_and_contexts_follow_the_board() {
        let model = build(
            &["x/nota.md", "y/nota.md", "task-manager/equipo/t.md", "p.md"],
            &[
                ("p.md", "---\ncontexto: \"#laboral\"\n---\n[[nota]]"),
                ("task-manager/equipo/t.md", "---\ncontexto: \"#Otro\"\n---\n"),
            ],
        );
        assert!(model.edges.is_empty());
        let ticket = model.nodes.iter().find(|node| node.path == "task-manager/equipo/t.md").expect("t");
        assert_eq!(ticket.context_tag.as_deref(), Some("#Laboral"));
        let note = model.nodes.iter().find(|node| node.path == "p.md").expect("p");
        assert_eq!(note.context_color.as_deref(), Some("#2563EB"));
    }

    #[test]
    fn search_ranks_titles_over_content_and_ignores_accents() {
        let model = build(&["cafe.md", "otro.md"], &[("otro.md", "Tomamos un café largo")]);
        let sources = BTreeMap::from([("otro.md".to_string(), "Tomamos un café largo".to_string())]);
        let results = search_library_graph(&model, &sources, "CAFÉ", 8);
        assert_eq!(results.iter().map(|result| result.path.as_str()).collect::<Vec<_>>(), vec!["cafe.md", "otro.md"]);
        assert!(results[1].preview.contains("café"));
    }

    #[test]
    fn link_cache_groups_nodes_by_folder() {
        let model = build(&["a.md", "d/b.md"], &[("a.md", "[[b]]")]);
        let cache = render_link_cache(&model);
        assert!(cache.contains("subgraph \"(root)\""));
        assert!(cache.contains("subgraph \"d\""));
        assert!(cache.contains("node_1 --> node_2") || cache.contains("node_2 --> node_1"));
    }
}
