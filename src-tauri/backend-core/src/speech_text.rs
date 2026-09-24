//! Text a local TTS model reads aloud: Markdown and HTML markup removed and,
//! for very long answers, bounded chunks that keep sentences together.

use std::sync::OnceLock;

use regex::Regex;

/// Longest text synthesized in one inference; longer answers are chunked.
pub const MAX_SINGLE_SPEECH_CHARS: usize = 5_900;
/// Chunk size for long answers, under the model's native limit.
pub const MAX_SPEECH_CHUNK_CHARS: usize = 280;

struct Rule {
    pattern: Regex,
    replacement: &'static str,
}

fn rules() -> &'static [Rule] {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        [
            (r"(?i)<https?://[^>]+>", " "),
            (r"<[^>]+>", " "),
            (r"```(?:\w+)?\s*([\s\S]*?)```", "$1"),
            (r"!\[([^\]]*)\]\([^)]*\)", "$1"),
            (r"\[([^\]]+)\]\([^)]*\)", "$1"),
            (r"(?m)^\s*[-*_]{3,}\s*$", ""),
            (r"(?m)^\s{0,3}#{1,6}\s+", ""),
            (r"(?m)^\s*(?:[-*+] |\d+[.)]\s+)", ""),
            (r"(?m)^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$", ""),
            (r"(?m)^\s*>\s?", ""),
            (r"[*_~`]", ""),
            (r"\\([\\`*_{}()#+.!-])", "$1"),
            (r"\|", ". "),
            (r"\n{2,}", "\n"),
            (r"[ \t]+", " "),
        ]
        .into_iter()
        .map(|(pattern, replacement)| Rule {
            pattern: Regex::new(pattern).expect("static speech pattern"),
            replacement,
        })
        .collect()
    })
}

/// Only the words a person would pronounce: no markup, links or tables.
pub fn markdown_to_speech_text(markdown: &str) -> String {
    let mut text = markdown.to_string();
    for rule in rules() {
        text = rule.pattern.replace_all(&text, rule.replacement).into_owned();
    }
    // Removed markup leaves spaces at line ends; the voice would pause on them.
    text.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string()
}

fn char_prefix(text: &str, chars: usize) -> &str {
    text.char_indices().nth(chars).map_or(text, |(index, _)| &text[..index])
}

/// Splits a sentence longer than `maximum` at the last punctuation or space
/// past its middle, or hard at `maximum`.
fn split_oversized(part: &str, maximum: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut remaining = part.trim().to_string();
    while remaining.chars().count() > maximum {
        let candidate = char_prefix(&remaining, maximum + 1);
        let boundary = [". ", "? ", "! ", "; ", " "]
            .iter()
            .filter_map(|separator| candidate.rfind(separator))
            .max();
        let middle = char_prefix(&remaining, maximum / 2).len();
        let cut = match boundary {
            Some(index) if index > middle => index + 1,
            _ => char_prefix(&remaining, maximum).len(),
        };
        chunks.push(remaining[..cut].trim().to_string());
        remaining = remaining[cut..].trim().to_string();
    }
    if !remaining.is_empty() {
        chunks.push(remaining);
    }
    chunks
}

/// Sentence groups of at most `maximum` characters.
pub fn speech_chunks(text: &str, maximum: usize) -> Vec<String> {
    static SENTENCES: OnceLock<Regex> = OnceLock::new();
    let sentences = SENTENCES.get_or_init(|| Regex::new(r"[.!?;]\s+|\n+").expect("static sentence pattern"));
    let mut units = Vec::new();
    let mut start = 0;
    for boundary in sentences.find_iter(text) {
        let keep = text[boundary.start()..].chars().next().is_some_and(|character| ".!?;".contains(character));
        let end = if keep { boundary.start() + 1 } else { boundary.start() };
        units.extend(split_oversized(&text[start..end], maximum));
        start = boundary.end();
    }
    units.extend(split_oversized(&text[start..], maximum));
    let mut chunks: Vec<String> = Vec::new();
    for unit in units.into_iter().filter(|unit| !unit.is_empty()) {
        match chunks.last_mut() {
            Some(current) if current.chars().count() + unit.chars().count() < maximum => {
                current.push(' ');
                current.push_str(&unit);
            }
            _ => chunks.push(unit),
        }
    }
    chunks
}

/// Texts to synthesize in order: the whole answer when it fits one
/// inference (a single inference keeps the voice stable), otherwise chunks.
pub fn speech_plan(markdown: &str) -> Vec<String> {
    let text = markdown_to_speech_text(markdown);
    if text.is_empty() {
        Vec::new()
    } else if text.chars().count() <= MAX_SINGLE_SPEECH_CHARS {
        vec![text]
    } else {
        speech_chunks(&text, MAX_SPEECH_CHUNK_CHARS)
    }
}

/// Text of a transcript with its speakers: consecutive segments of the same
/// speaker join in one paragraph labelled `Hablante N:` (numbered by first
/// appearance). A transcript of one speaker is its plain text.
pub fn format_diarized(text: &str, segments: &[(Option<&str>, &str)], speaker_count: u32) -> String {
    if speaker_count <= 1 {
        return text.trim().to_string();
    }
    let mut labels = Vec::<(String, String)>::new();
    let mut blocks = Vec::<(Option<String>, String)>::new();
    for (speaker, segment) in segments {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let label = speaker.map(|speaker| match labels.iter().find(|(id, _)| id == speaker) {
            Some((_, label)) => label.clone(),
            None => {
                let label = format!("Hablante {}", labels.len() + 1);
                labels.push((speaker.to_string(), label.clone()));
                label
            }
        });
        match blocks.last_mut() {
            Some((previous, block)) if *previous == label => {
                block.push(' ');
                block.push_str(segment);
            }
            _ => blocks.push((label, segment.to_string())),
        }
    }
    let formatted = blocks
        .into_iter()
        .map(|(label, block)| match label {
            Some(label) => format!("{label}: {block}"),
            None => block,
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    if formatted.trim().is_empty() { text.trim().to_string() } else { formatted.trim().to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_markup_and_keeps_words() {
        let text = markdown_to_speech_text(
            "## Resumen\n**Esta es una oración completa.** Ver [detalle](https://x.y) y <strong>Importante</strong>\n| a | b |\n|---|---|",
        );
        assert_eq!(text, "Resumen\nEsta es una oración completa. Ver detalle y Importante\n. a . b .");
    }

    #[test]
    fn long_answers_become_bounded_chunks() {
        let answer = (1..=30)
            .map(|index| format!("## Tarea {index}\n- **Estado:** Pendiente.\n- [Detalle](https://example.com): trabajo asignado al equipo."))
            .collect::<Vec<_>>()
            .join("\n\n");
        let chunks = speech_chunks(&markdown_to_speech_text(&answer), 180);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 180));
        assert!(!chunks.join(" ").contains(['*', '#', '[', ']', '|']));
        assert!(chunks[0].contains("Tarea 1"));
    }

    #[test]
    fn short_answers_are_one_inference() {
        assert_eq!(speech_plan("Hola **vos**."), vec!["Hola vos.".to_string()]);
        assert!(speech_plan("**  **").is_empty());
        assert!(speech_plan(&"palabra ".repeat(1_000)).len() > 1);
    }

    #[test]
    fn diarized_transcripts_are_labelled_by_speaker() {
        let segments = [(Some("b"), "Hola."), (Some("b"), "¿Todo bien?"), (Some("a"), "Sí."), (None, "ruido")];
        let text = format_diarized("todo", &segments, 2);
        assert_eq!(text, "Hablante 1: Hola. ¿Todo bien?\n\nHablante 2: Sí.\n\nruido");
        assert_eq!(format_diarized(" solo ", &segments, 1), "solo");
    }
}
