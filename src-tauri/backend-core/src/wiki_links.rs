//! Wikilink targets of a library: which notes can be linked, the name each
//! one is linked by (its title, or its path when titles repeat) and the
//! suggestions for what the person is typing.

use serde::Serialize;

use crate::library_graph::is_markdown_path;

pub const MAX_SUGGESTIONS: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiLinkTargetDto {
    /// Path of the note as the explorer shows it (set by the adapter).
    pub path: String,
    pub name: String,
    pub title: String,
    pub relative_path: String,
    pub relative_path_with_extension: String,
    /// What a link to the note is written as.
    pub wiki_link: String,
}

fn strip_extension(name: &str) -> &str {
    match name.rfind('.') {
        Some(index) if index > 0 => &name[..index],
        _ => name,
    }
}

fn compare_base(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase().cmp(&right.to_lowercase())
}

/// Targets of the Markdown notes among `logical_paths`, sorted by title and
/// path. Notes sharing a title are linked by their path.
pub fn build_targets(logical_paths: &[String]) -> Vec<WikiLinkTargetDto> {
    let mut targets = logical_paths
        .iter()
        .filter(|path| is_markdown_path(path))
        .map(|path| {
            let name = path.rsplit('/').next().unwrap_or(path).to_string();
            let title = strip_extension(&name).to_string();
            WikiLinkTargetDto {
                path: path.clone(),
                relative_path: strip_extension(path).to_string(),
                relative_path_with_extension: path.clone(),
                wiki_link: title.clone(),
                name,
                title,
            }
        })
        .collect::<Vec<_>>();
    let mut counts = std::collections::HashMap::<String, usize>::new();
    for target in &targets {
        *counts.entry(target.title.to_lowercase()).or_default() += 1;
    }
    for target in &mut targets {
        if counts.get(&target.title.to_lowercase()).copied().unwrap_or(0) > 1 {
            target.wiki_link = target.relative_path.clone();
        }
    }
    targets.sort_by(|left, right| compare_base(&left.title, &right.title).then_with(|| compare_base(&left.relative_path, &right.relative_path)));
    targets
}

/// A link reference as notes are looked up: without alias, leading `./`
/// or `/`, repeated slashes or Markdown extension, lower-cased.
pub fn normalize_reference(value: &str) -> String {
    let reference = value.split('|').next().unwrap_or_default().trim();
    if reference.is_empty() {
        return String::new();
    }
    let mut path = reference.replace('\\', "/");
    if let Some(rest) = path.strip_prefix("./") {
        path = rest.to_string();
    }
    while path.contains("//") {
        path = path.replace("//", "/");
    }
    let path = path.strip_prefix('/').unwrap_or(&path);
    let path = if is_markdown_path(path) { strip_extension(path) } else { path };
    path.to_lowercase()
}

fn score(target: &WikiLinkTargetDto, query: &str) -> Option<u8> {
    if query.is_empty() {
        return Some(100);
    }
    let title = normalize_reference(&target.title);
    let wiki_link = normalize_reference(&target.wiki_link);
    let relative = normalize_reference(&target.relative_path);
    [
        title == query || wiki_link == query || relative == query,
        title.starts_with(query),
        wiki_link.starts_with(query),
        relative.starts_with(query),
        title.contains(query),
        wiki_link.contains(query),
        relative.contains(query),
    ]
    .iter()
    .position(|matches| *matches)
    .map(|position| position as u8)
}

/// Targets matching what the person typed, best first: exact names, then
/// prefixes, then substrings; ties go to the closest length and the title.
pub fn suggest(targets: &[WikiLinkTargetDto], query: &str, limit: usize) -> Vec<WikiLinkTargetDto> {
    let normalized = normalize_reference(query);
    let query_length = query.chars().count();
    let mut scored = targets
        .iter()
        .filter_map(|target| score(target, &normalized).map(|score| (score, target)))
        .collect::<Vec<_>>();
    scored.sort_by(|(left_score, left), (right_score, right)| {
        left_score
            .cmp(right_score)
            .then_with(|| {
                let distance = |target: &WikiLinkTargetDto| target.wiki_link.chars().count().abs_diff(query_length);
                distance(left).cmp(&distance(right))
            })
            .then_with(|| compare_base(&left.title, &right.title))
    });
    scored.into_iter().take(limit.max(1)).map(|(_, target)| target.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn repeated_titles_are_linked_by_path_and_other_files_are_skipped() {
        let targets = build_targets(&paths(&["b/Idea.md", "a/Idea.md", "Plan.md", "foto.png"]));
        assert_eq!(targets.len(), 3);
        assert_eq!(targets[0].wiki_link, "a/Idea");
        assert_eq!(targets[1].wiki_link, "b/Idea");
        assert_eq!(targets[2].wiki_link, "Plan");
        assert_eq!(targets[2].relative_path_with_extension, "Plan.md");
    }

    #[test]
    fn references_are_normalized_for_lookup() {
        assert_eq!(normalize_reference("./Notas//Idea.md|alias"), "notas/idea");
        assert_eq!(normalize_reference("/Plan"), "plan");
        assert_eq!(normalize_reference("  "), "");
    }

    #[test]
    fn suggestions_prefer_exact_then_prefix_then_substring() {
        let targets = build_targets(&paths(&["Plan.md", "Planeta.md", "Mi plan.md", "Otro.md"]));
        let names = suggest(&targets, "plan", 10).into_iter().map(|target| target.title).collect::<Vec<_>>();
        assert_eq!(names, ["Plan", "Planeta", "Mi plan"]);
        assert_eq!(suggest(&targets, "", 2).len(), 2);
    }
}
