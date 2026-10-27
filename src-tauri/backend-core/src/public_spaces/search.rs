//! Search of a public space: every word of the query must appear in the
//! title or the text of a page; title matches go first. Accents and case
//! do not matter.

use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use super::index::comparable_name;
use crate::prompt::strip_frontmatter;

pub const MAX_RESULTS: usize = 20;
const SNIPPET_CHARS: usize = 160;
const MAX_QUERY_CHARS: usize = 120;

/// A published page as the search reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchDocument {
    pub path: String,
    pub title: String,
    /// Plain text of the body (see [`plain_text`]).
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

fn markup_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\{%[\s\S]*?%\}|<[^>]+>|!\[[^\]]*\]\([^)]*\)|[#*_`>|~]|\[\[|\]\]").expect("markup pattern"))
}

fn link_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\[([^\]]*)\]\([^)]*\)").expect("link pattern"))
}

/// The body of a note without frontmatter, GitBook tags, HTML or Markdown
/// marks, with its whitespace collapsed.
pub fn plain_text(source: &str) -> String {
    let body = strip_frontmatter(source);
    // The first heading is the page title, searched apart.
    let body = match body.trim_start().strip_prefix("# ") {
        Some(rest) => rest.split_once('\n').map_or("", |(_, rest)| rest),
        None => body,
    };
    let body = link_pattern().replace_all(body, "$1");
    let body = markup_pattern().replace_all(&body, " ");
    body.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Text compared with the query, keeping word boundaries.
fn folded(value: &str) -> String {
    value.split(|character: char| !character.is_alphanumeric()).map(comparable_name).collect::<Vec<_>>().join(" ")
}

fn snippet(text: &str, word: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    // Folded text is ASCII: each of its bytes points back to a character.
    let mut folded = String::new();
    let mut origin = Vec::new();
    for (index, character) in characters.iter().enumerate() {
        for letter in comparable_name(&character.to_string()).chars() {
            folded.push(letter);
            origin.push(index);
        }
    }
    let found = folded.find(word).map(|byte| origin[byte]);
    let start = found.map_or(0, |found| found.saturating_sub(SNIPPET_CHARS / 3));
    let end = (start + SNIPPET_CHARS).min(characters.len());
    let mut snippet: String = characters[start..end].iter().collect();
    if start > 0 {
        snippet.insert(0, '…');
    }
    if end < characters.len() {
        snippet.push('…');
    }
    snippet
}

/// The pages matching `query`, best first.
pub fn search(documents: &[SearchDocument], query: &str) -> Vec<SearchHit> {
    let query: String = query.chars().take(MAX_QUERY_CHARS).collect();
    let words: Vec<String> = folded(&query).split_whitespace().map(str::to_string).collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<(u8, usize, SearchHit)> = documents
        .iter()
        .enumerate()
        .filter_map(|(order, document)| {
            let title = folded(&document.title);
            let text = folded(&document.text);
            let in_title = words.iter().all(|word| title.contains(word.as_str()));
            let anywhere = words.iter().all(|word| title.contains(word.as_str()) || text.contains(word.as_str()));
            if !anywhere {
                return None;
            }
            let rank = if in_title { 0 } else { 1 };
            let word = words.iter().find(|word| text.contains(word.as_str())).unwrap_or(&words[0]);
            Some((rank, order, SearchHit { path: document.path.clone(), title: document.title.clone(), snippet: snippet(&document.text, word) }))
        })
        .collect();
    hits.sort_by_key(|(rank, order, _)| (*rank, *order));
    hits.into_iter().take(MAX_RESULTS).map(|(_, _, hit)| hit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(path: &str, title: &str, source: &str) -> SearchDocument {
        SearchDocument { path: path.into(), title: title.into(), text: plain_text(source) }
    }

    #[test]
    fn the_text_of_a_note_leaves_its_marks_out() {
        assert_eq!(
            plain_text("---\ncontexto: \"#Publico\"\n---\n# Título\n{% hint style=\"info\" %}\nUn **dato** con [enlace](x.md) y <code>int</code>.\n{% endhint %}\n"),
            "Un dato con enlace y int ."
        );
    }

    #[test]
    fn every_word_must_match_and_titles_go_first() {
        let documents = vec![
            document("a.md", "Introducción", "Los punteros guardan direcciones de memoria."),
            document("b.md", "Memoria heap", "Se reserva con malloc."),
            document("c.md", "Otra", "Nada que ver."),
        ];
        let hits = search(&documents, "MEMORIA");
        assert_eq!(hits.iter().map(|hit| hit.path.as_str()).collect::<Vec<_>>(), vec!["b.md", "a.md"]);
        assert!(hits[1].snippet.contains("memoria"));
        assert_eq!(search(&documents, "introduccion").len(), 1);
        assert!(search(&documents, "memoria python").is_empty());
        assert!(search(&documents, "  ").is_empty());
    }
}
