//! The card a link between notes shows on hover: where the note is, its
//! title, the start of its text, when it was edited and how many links it has.

use serde::Serialize;

use crate::gitbook_blocks::document_title;
use crate::prompt::strip_frontmatter;

const MAX_EXCERPT_CHARS: usize = 140;
const MINUTE_MS: i64 = 60_000;
const HOUR_MS: i64 = 60 * MINUTE_MS;
const DAY_MS: i64 = 24 * HOUR_MS;
const MONTHS: [&str; 12] = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinkPreview {
    pub title: String,
    /// Folders of the note, «Personal / filosofia»; empty at the root.
    pub folder: String,
    pub excerpt: String,
    /// «Editada hace 3 días»; absent when the library does not say.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edited: Option<String>,
    pub links: usize,
}

/// Links `[[…]]` the note has.
fn count_links(body: &str) -> usize {
    let mut count = 0;
    let mut rest = body;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        if !after[..end].trim().is_empty() && !after[..end].contains('\n') {
            count += 1;
        }
        rest = &after[end + 2..];
    }
    count
}

fn is_prose(line: &str) -> bool {
    let line = line.trim_start();
    !line.is_empty()
        && !["#", "```", "~~~", "{%", "<", "|", "---", "![", ">", "$$", "- [", "[^"].iter().any(|start| line.starts_with(start))
}

/// The first paragraph of prose, without Markdown marks.
fn excerpt(body: &str) -> String {
    let paragraph: Vec<&str> = body
        .lines()
        .skip_while(|line| !is_prose(line))
        .take_while(|line| is_prose(line))
        .collect();
    let text = paragraph.join(" ").replace("[[", "").replace("]]", "");
    let plain: String = text.chars().filter(|char| !matches!(char, '*' | '_' | '`' | '[' | ']')).collect();
    let words: Vec<&str> = plain.split_whitespace().collect();
    let joined = words.join(" ");
    if joined.chars().count() <= MAX_EXCERPT_CHARS {
        return joined;
    }
    let cut: String = joined.chars().take(MAX_EXCERPT_CHARS).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(start, _)| start);
    format!("{}…", cut.trim_end_matches([',', ';', ':', '.']))
}

fn civil_date(ms: i64) -> (i64, usize, i64) {
    // Days since 1970-01-01 to a proleptic Gregorian date (UTC).
    let days = ms.div_euclid(DAY_MS);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month as usize, day)
}

/// When the note was edited, as a person says it.
pub fn edited_label(modified_ms: i64, now_ms: i64) -> String {
    let elapsed = (now_ms - modified_ms).max(0);
    if elapsed < MINUTE_MS {
        return "Editada recién".to_string();
    }
    if elapsed < HOUR_MS {
        return format!("Editada hace {} min", elapsed / MINUTE_MS);
    }
    if elapsed < DAY_MS {
        let hours = elapsed / HOUR_MS;
        return format!("Editada hace {hours} {}", if hours == 1 { "hora" } else { "horas" });
    }
    let days = elapsed / DAY_MS;
    if days == 1 {
        return "Editada ayer".to_string();
    }
    if days < 30 {
        return format!("Editada hace {days} días");
    }
    let (year, month, day) = civil_date(modified_ms);
    format!("Editada el {day} {} {year}", MONTHS[month - 1])
}

pub fn note_link_preview(logical_path: &str, source: &str, modified_ms: Option<i64>, now_ms: i64) -> NoteLinkPreview {
    let body = strip_frontmatter(source);
    let folder = logical_path.rsplit_once('/').map_or("", |(parent, _)| parent);
    NoteLinkPreview {
        title: document_title(source, logical_path),
        folder: folder.split('/').filter(|segment| !segment.is_empty()).collect::<Vec<_>>().join(" / "),
        excerpt: excerpt(body),
        edited: modified_ms.map(|modified| edited_label(modified, now_ms)),
        links: count_links(body),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_shows_folder_title_excerpt_and_links() {
        let source = "---\ntitle: Meditaciones\n---\n# Otro título\n\nNotas sobre **Marco Aurelio** y la práctica diaria de la [[atención]].\nSigue acá.\n\nOtro párrafo con [[otra]].";
        let preview = note_link_preview("Personal/filosofia/Meditaciones.md", source, None, 0);
        assert_eq!(preview.title, "Meditaciones");
        assert_eq!(preview.folder, "Personal / filosofia");
        assert_eq!(preview.excerpt, "Notas sobre Marco Aurelio y la práctica diaria de la atención. Sigue acá.");
        assert_eq!(preview.links, 2);
        assert_eq!(preview.edited, None);
    }

    #[test]
    fn long_text_is_cut_at_a_word() {
        let source = "palabra ".repeat(60);
        let text = note_link_preview("a.md", &source, None, 0).excerpt;
        assert!(text.ends_with("palabra…"));
        assert!(text.chars().count() <= MAX_EXCERPT_CHARS + 1);
    }

    #[test]
    fn edits_read_as_a_person_says_them() {
        let now = 1_790_000_000_000;
        assert_eq!(edited_label(now - 30_000, now), "Editada recién");
        assert_eq!(edited_label(now - 5 * MINUTE_MS, now), "Editada hace 5 min");
        assert_eq!(edited_label(now - HOUR_MS, now), "Editada hace 1 hora");
        assert_eq!(edited_label(now - DAY_MS - HOUR_MS, now), "Editada ayer");
        assert_eq!(edited_label(now - 3 * DAY_MS, now), "Editada hace 3 días");
        // 2026-09-28 00:00 UTC.
        assert_eq!(edited_label(1_790_553_600_000, 1_790_553_600_000 + 40 * DAY_MS), "Editada el 28 sep 2026");
    }
}
