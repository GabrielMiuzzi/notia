//! Three-way merge of a text by lines: what changed from `base` in `mine`
//! (the editor) and in `theirs` (the file, written by the agent or another
//! device) both stay. Where both changed the same lines differently, both
//! versions stay, one after the other: nothing anybody wrote is lost.

/// Largest middle part (lines × lines) compared line by line; beyond it the
/// whole middle counts as changed.
const MAX_COMPARED_CELLS: usize = 4_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Merged {
    pub content: String,
    /// Places where both versions changed the same lines and both were kept.
    pub conflicts: usize,
}

/// `base[start..end]` replaced by `lines` in one version.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Hunk<'a> {
    start: usize,
    end: usize,
    lines: Vec<&'a str>,
}

fn lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

/// Line pairs `(base, other)` of a longest common subsequence of the two.
fn matches(base: &[&str], other: &[&str]) -> Vec<(usize, usize)> {
    let prefix = base.iter().zip(other).take_while(|(a, b)| a == b).count();
    let suffix = base[prefix..].iter().rev().zip(other[prefix..].iter().rev()).take_while(|(a, b)| a == b).count();
    let (base_middle, other_middle) = (&base[prefix..base.len() - suffix], &other[prefix..other.len() - suffix]);
    let mut pairs: Vec<(usize, usize)> = (0..prefix).map(|index| (index, index)).collect();
    let (rows, columns) = (base_middle.len(), other_middle.len());
    if rows > 0 && columns > 0 && rows.saturating_mul(columns) <= MAX_COMPARED_CELLS {
        // lengths[i][j]: common lines of base_middle[i..] and other_middle[j..].
        let width = columns + 1;
        let mut lengths = vec![0u32; (rows + 1) * width];
        for i in (0..rows).rev() {
            for j in (0..columns).rev() {
                lengths[i * width + j] = if base_middle[i] == other_middle[j] {
                    lengths[(i + 1) * width + j + 1] + 1
                } else {
                    lengths[(i + 1) * width + j].max(lengths[i * width + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < rows && j < columns {
            if base_middle[i] == other_middle[j] {
                pairs.push((prefix + i, prefix + j));
                i += 1;
                j += 1;
            } else if lengths[(i + 1) * width + j] >= lengths[i * width + j + 1] {
                i += 1;
            } else {
                j += 1;
            }
        }
    }
    pairs.extend((0..suffix).map(|offset| (base.len() - suffix + offset, other.len() - suffix + offset)));
    pairs
}

/// What `other` changed from `base`, as disjoint hunks in order.
fn hunks<'a>(base: &[&str], other: &[&'a str]) -> Vec<Hunk<'a>> {
    let mut found = Vec::new();
    let (mut base_at, mut other_at) = (0, 0);
    for (base_index, other_index) in matches(base, other).into_iter().chain(std::iter::once((base.len(), other.len()))) {
        if base_index > base_at || other_index > other_at {
            found.push(Hunk { start: base_at, end: base_index, lines: other[other_at..other_index].to_vec() });
        }
        base_at = base_index + 1;
        other_at = other_index + 1;
    }
    found
}

/// `base[start..end]` with the hunks of one version that fall inside it.
fn version_of<'a>(base: &[&'a str], start: usize, end: usize, hunks: &[&Hunk<'a>]) -> Vec<&'a str> {
    let mut output = Vec::new();
    let mut at = start;
    for hunk in hunks {
        output.extend_from_slice(&base[at..hunk.start]);
        output.extend_from_slice(&hunk.lines);
        at = hunk.end;
    }
    output.extend_from_slice(&base[at..end]);
    output
}

/// Joins lines; a line without its newline gets one when more text follows.
fn join(pieces: &[&str]) -> String {
    let mut output = String::new();
    for piece in pieces {
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str(piece);
    }
    output
}

pub fn merge_texts(base: &str, mine: &str, theirs: &str) -> Merged {
    if mine == theirs || theirs == base {
        return Merged { content: mine.to_string(), conflicts: 0 };
    }
    if mine == base {
        return Merged { content: theirs.to_string(), conflicts: 0 };
    }
    let base_lines = lines(base);
    let mine_hunks = hunks(&base_lines, &lines(mine));
    let theirs_hunks = hunks(&base_lines, &lines(theirs));
    let mut output: Vec<&str> = Vec::new();
    let mut conflicts = 0;
    let (mut mine_index, mut theirs_index, mut base_at) = (0, 0, 0);
    while mine_index < mine_hunks.len() || theirs_index < theirs_hunks.len() {
        // The next hunk of either version starts a group with every hunk
        // that touches it.
        let mine_next = mine_hunks.get(mine_index);
        let theirs_next = theirs_hunks.get(theirs_index);
        let first = match (mine_next, theirs_next) {
            (Some(a), Some(b)) => a.start.min(b.start),
            (Some(a), None) => a.start,
            (None, Some(b)) => b.start,
            (None, None) => break,
        };
        let (start, mut end) = (first, first);
        let (mut group_mine, mut group_theirs): (Vec<&Hunk>, Vec<&Hunk>) = (Vec::new(), Vec::new());
        loop {
            let joins = |hunk: &Hunk| hunk.start < end || hunk.start == start || (hunk.start == end && hunk.start == hunk.end);
            if let Some(hunk) = mine_hunks.get(mine_index).filter(|hunk| joins(hunk)) {
                end = end.max(hunk.end);
                group_mine.push(hunk);
                mine_index += 1;
            } else if let Some(hunk) = theirs_hunks.get(theirs_index).filter(|hunk| joins(hunk)) {
                end = end.max(hunk.end);
                group_theirs.push(hunk);
                theirs_index += 1;
            } else {
                break;
            }
        }
        output.extend_from_slice(&base_lines[base_at..start]);
        let mine_version = version_of(&base_lines, start, end, &group_mine);
        let theirs_version = version_of(&base_lines, start, end, &group_theirs);
        if group_theirs.is_empty() || mine_version == theirs_version {
            output.extend(mine_version);
        } else if group_mine.is_empty() {
            output.extend(theirs_version);
        } else {
            conflicts += 1;
            output.extend(mine_version);
            output.extend(theirs_version);
        }
        base_at = end;
    }
    output.extend_from_slice(&base_lines[base_at..]);
    Merged { content: join(&output), conflicts }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "---\ncontexto: \"#Personal\"\n---\n# Título\n\nUno.\n\nDos.\n\nTres.\n";

    #[test]
    fn changes_in_different_places_both_stay() {
        let mine = BASE.replace("Uno.", "Uno, editado por mí.");
        let theirs = BASE.replace("Tres.", "Tres, corregido por el agente.");
        let merged = merge_texts(BASE, &mine, &theirs);
        assert_eq!(merged.conflicts, 0);
        assert_eq!(merged.content, BASE.replace("Uno.", "Uno, editado por mí.").replace("Tres.", "Tres, corregido por el agente."));
    }

    #[test]
    fn the_agent_adds_at_the_end_while_the_person_types_above() {
        let mine = BASE.replace("Dos.", "Dos y algo más.");
        let theirs = format!("{BASE}\n## Resumen\n\nNuevo.\n");
        let merged = merge_texts(BASE, &mine, &theirs);
        assert_eq!(merged.conflicts, 0);
        assert_eq!(merged.content, format!("{}\n## Resumen\n\nNuevo.\n", BASE.replace("Dos.", "Dos y algo más.")));
    }

    #[test]
    fn the_same_change_is_written_once() {
        let both = BASE.replace("Dos.", "Dos!");
        assert_eq!(merge_texts(BASE, &both, &both), Merged { content: both.clone(), conflicts: 0 });
        let mine = format!("{both}Cuatro.\n");
        assert_eq!(merge_texts(BASE, &mine, &both).content, mine);
    }

    #[test]
    fn the_same_line_changed_by_both_keeps_both_versions() {
        let mine = BASE.replace("Dos.", "Dos, según yo.");
        let theirs = BASE.replace("Dos.", "Dos, según el agente.");
        let merged = merge_texts(BASE, &mine, &theirs);
        assert_eq!(merged.conflicts, 1);
        assert_eq!(merged.content, BASE.replace("Dos.\n", "Dos, según yo.\nDos, según el agente.\n"));
    }

    #[test]
    fn a_deleted_paragraph_and_lines_without_final_newline() {
        let mine = BASE.replace("Uno.\n\n", "");
        let theirs = format!("{}Cuatro.", BASE);
        let merged = merge_texts(BASE, &mine, &theirs);
        assert_eq!(merged, Merged { content: format!("{}Cuatro.", BASE.replace("Uno.\n\n", "")), conflicts: 0 });
        assert_eq!(merge_texts("a", "a b", "a\nc").content, "a b\na\nc");
        assert_eq!(merge_texts("", "mío", "suyo").content, "mío\nsuyo");
    }
}
