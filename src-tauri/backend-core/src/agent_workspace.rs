//! Content rules of the library's `.agent` workspace: the managed default
//! rules block, rules added by the agent, persistent memories, the agent's
//! own thoughts, the confidential context of every agent file and prompt
//! names. The adapter only reads and writes the files.

use crate::prompt::{strip_frontmatter, DEFAULT_AGENT_RULES};

pub const AGENT_DIRECTORY: &str = ".agent";
pub const PROMPTS_DIRECTORY: &str = ".agent/promps";
pub const MEMORY_DIRECTORY: &str = ".agent/memory";
pub const AGENT_FOLDERS: [&str; 5] = [
    ".agent",
    ".agent/promps",
    ".agent/dynamics",
    ".agent/skills",
    ".agent/memory",
];
pub const RULES_PATH: &str = ".agent/memory/rules.md";
pub const MEMORY_PATH: &str = ".agent/memory/memory.md";
/// The agent's own working notes: what it noticed, told, asked or proposed.
pub const THOUGHTS_PATH: &str = ".agent/memory/thoughts.md";
pub const DEFAULT_PROMPT_FILE: &str = "default.md";
pub const DEFAULT_PROMPT_PATH: &str = ".agent/promps/default.md";
pub const MAX_MEMORIES: usize = 1_000;
pub const MAX_RULE_CHARS: usize = 8_000;
/// Characters of every memory together; the prompt reads at most 250,000
/// per agent file, so the memory file must stay below that.
pub const MAX_MEMORY_CHARS: usize = 150_000;
/// Budget a new memory must fit in before it is added.
pub const MEMORY_LIMIT: ItemBudget = ItemBudget { items: MAX_MEMORIES, chars: MAX_MEMORY_CHARS };
/// What a full memory is rewritten down to, leaving room for new memories.
pub const MEMORY_TARGET: ItemBudget = ItemBudget { items: 800, chars: 120_000 };
pub const MAX_THOUGHT_CHARS: usize = 1_000;
/// Hard limit of the thoughts file: reaching it forces a rewrite.
pub const THOUGHTS_LIMIT: ItemBudget = ItemBudget { items: 500, chars: 100_000 };
/// What every reorganization of the thoughts keeps them within.
pub const THOUGHTS_TARGET: ItemBudget = ItemBudget { items: 400, chars: 80_000 };

const RULES_START: &str = "<!-- NOTIA_DEFAULT_RULES_START -->";
const RULES_END: &str = "<!-- NOTIA_DEFAULT_RULES_END -->";
const IA_RULES_START: &str = "<!-- NOTIA_IA_RULES_START -->";
const IA_RULES_END: &str = "<!-- NOTIA_IA_RULES_END -->";
const MEMORY_VERSION_MARKER: &str = "<!-- NOTIA_AGENT_MEMORY_VERSION:1 -->";
const THOUGHTS_VERSION_MARKER: &str = "<!-- NOTIA_AGENT_THOUGHTS_VERSION:1 -->";
const CONFIDENTIAL_CONTEXT_LINE: &str = "contexto: \"#Confidencial\"";

/// How many list items, and how many characters in total, a list may hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ItemBudget {
    pub items: usize,
    pub chars: usize,
}

impl ItemBudget {
    /// Whether `items` fit in the budget.
    pub fn fits(&self, items: &[String]) -> bool {
        items.len() <= self.items && total_chars(items) <= self.chars
    }

    /// Whether one more item of `extra` characters still fits.
    pub fn fits_one_more(&self, items: &[String], extra: &str) -> bool {
        items.len() < self.items && total_chars(items) + extra.chars().count() <= self.chars
    }
}

fn total_chars(items: &[String]) -> usize {
    items.iter().map(|item| item.chars().count()).sum()
}

/// Rules body with the current managed default block and an (possibly
/// empty) block for rules added by the agent.
pub fn ensure_default_rules(content: &str) -> String {
    let defaults = DEFAULT_AGENT_RULES.trim();
    let content = match (content.find(RULES_START), content.find(RULES_END)) {
        (Some(start), Some(end)) if end > start => format!(
            "{}{}{}",
            &content[..start],
            defaults,
            &content[end + RULES_END.len()..]
        )
        .trim()
        .to_string(),
        _ => [defaults, content.trim()]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
    };
    if content.contains(IA_RULES_START) && content.contains(IA_RULES_END) {
        content
    } else {
        format!("{content}\n\n{IA_RULES_START}\n{IA_RULES_END}")
    }
}

/// Byte range of the agent rules block inside an ensured rules body.
fn ia_block(content: &str) -> (usize, usize) {
    let start = content.find(IA_RULES_START).map_or(0, |index| index + IA_RULES_START.len());
    let end = content[start..].find(IA_RULES_END).map_or(content.len(), |index| start + index);
    (start, end)
}

fn list_item(line: &str) -> &str {
    let trimmed = line.trim();
    trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .or_else(|| trimmed.strip_prefix('-'))
        .or_else(|| trimmed.strip_prefix('*'))
        .unwrap_or(trimmed)
        .trim()
}

fn with_ia_rules(content: &str, rules: &[String]) -> String {
    let (start, end) = ia_block(content);
    let block = rules.iter().map(|rule| format!("- {rule}")).collect::<Vec<_>>().join("\n");
    format!(
        "{}\n{}{}{}",
        &content[..start],
        block,
        if block.is_empty() { "" } else { "\n" },
        &content[end..]
    )
}

/// Rules added by the agent, without list markers.
pub fn ia_rules(content: &str) -> Vec<String> {
    let ensured = ensure_default_rules(content);
    let (start, end) = ia_block(&ensured);
    ensured[start..end]
        .lines()
        .map(list_item)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

/// Replaces the agent rules block, dropping empty and repeated rules.
pub fn replace_ia_rules(content: &str, rules: &[String]) -> String {
    let mut unique = Vec::<String>::new();
    for rule in rules.iter().map(|rule| rule.split_whitespace().collect::<Vec<_>>().join(" ")) {
        if !rule.is_empty() && !unique.iter().any(|known| known.eq_ignore_ascii_case(&rule)) {
            unique.push(rule);
        }
    }
    with_ia_rules(&ensure_default_rules(content), &unique)
}

/// Adds one rule; `None` when it is empty or already present.
pub fn append_rule(content: &str, rule: &str) -> Option<String> {
    let rule = rule.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut rules = ia_rules(content);
    if rule.is_empty() || rules.iter().any(|known| known.eq_ignore_ascii_case(&rule)) {
        return None;
    }
    rules.push(rule);
    Some(with_ia_rules(&ensure_default_rules(content), &rules))
}

fn starts_with_word(text: &str, prefix: &str) -> bool {
    text.strip_prefix(prefix)
        .is_some_and(|rest| rest.chars().next().is_none_or(|next| !next.is_alphanumeric()))
}

/// Identity, preferences and personal context belong in memory, not rules.
pub fn is_likely_personal_memory(value: &str) -> bool {
    const PREFIXES: [&str; 14] = [
        "el usuario", "la usuaria", "mi nombre", "me llamo", "se llama", "su nombre", "trabajo",
        "trabaja", "vive", "le gusta", "prefiere", "esta trabajando", "esta arreglando", "tiene",
    ];
    let normalized = fold_accents(&list_item(value).to_lowercase());
    PREFIXES.iter().any(|prefix| starts_with_word(&normalized, prefix))
}

/// Runtime corrections that older versions persisted as rules by mistake.
pub fn is_internal_agent_correction(value: &str) -> bool {
    const MARKERS: [&str; 5] = [
        "ninguna mutacion financiera se ejecuto",
        "la respuesta anuncia una accion pendiente pero no solicita herramientas",
        "detectaste un ticket recibido por telegram, pero aun no fue persistido",
        "no hagas la pregunta financiera como texto final",
        "la respuesta anterior no separo todos los tickets recuperados",
    ];
    let normalized = fold_accents(&value.to_lowercase());
    MARKERS.iter().any(|marker| normalized.contains(marker))
}

fn fold_accents(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            'á' => 'a',
            'é' => 'e',
            'í' => 'i',
            'ó' => 'o',
            'ú' | 'ü' => 'u',
            other => other,
        })
        .collect()
}

/// Moves personal facts out of the agent rules and drops internal
/// corrections. Returns the rules body and the facts to keep as memories.
pub fn migrate_misclassified_rules(content: &str) -> (String, Vec<String>) {
    let rules = ia_rules(content);
    let memories = rules.iter().filter(|rule| is_likely_personal_memory(rule)).cloned().collect();
    let retained = rules
        .into_iter()
        .filter(|rule| !is_likely_personal_memory(rule) && !is_internal_agent_correction(rule))
        .collect::<Vec<_>>();
    (with_ia_rules(&ensure_default_rules(content), &retained), memories)
}

/// Memory items of a memory file body (list markers, headings and comments
/// are ignored).
pub fn parse_memory_items(body: &str) -> Vec<String> {
    body.lines()
        .map(list_item)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("<!--"))
        .map(str::to_string)
        .collect()
}

/// Case-insensitive union keeping the latest spelling, in first-seen order.
fn dedupe_items(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut merged = Vec::<String>::new();
    for item in items.into_iter().map(|item| item.split_whitespace().collect::<Vec<_>>().join(" ")) {
        if item.is_empty() {
            continue;
        }
        match merged.iter_mut().find(|known| known.eq_ignore_ascii_case(&item)) {
            Some(known) => *known = item,
            None => merged.push(item),
        }
    }
    merged
}

/// Case-insensitive union keeping the latest spelling, capped.
pub fn merge_memories(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut merged = dedupe_items(items);
    merged.truncate(MAX_MEMORIES);
    merged
}

fn render_list(marker: &str, items: &[String]) -> String {
    let mut lines = vec![marker.to_string(), String::new()];
    lines.extend(items.iter().map(|item| format!("- {item}")));
    lines.push(String::new());
    lines.join("\n")
}

/// Memory file body for `memories`.
pub fn render_memories(memories: &[String]) -> String {
    render_list(MEMORY_VERSION_MARKER, memories)
}

/// Thoughts file body for `thoughts`, without duplicates.
pub fn render_thoughts(thoughts: &[String]) -> String {
    render_list(THOUGHTS_VERSION_MARKER, &dedupe_items(thoughts.iter().cloned()))
}

/// A thought dated with the local time `now_label` (`AAAA-MM-DD HH:MM`),
/// with its whitespace collapsed. `None` when it is empty or too long.
pub fn stamp_thought(now_label: &str, text: &str) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let length = text.chars().count();
    (length > 0 && length <= MAX_THOUGHT_CHARS).then(|| format!("[{now_label}] {text}"))
}

/// The text of a thought without its `[fecha]` prefix.
pub fn thought_text(thought: &str) -> &str {
    let trimmed = thought.trim();
    trimmed
        .strip_prefix('[')
        .and_then(|rest| rest.split_once("] "))
        .map_or(trimmed, |(_, text)| text.trim())
}

/// Thoughts with `stamped` added last. A thought that says the same (apart
/// from its date) is replaced, so a repeated note only refreshes its date.
pub fn with_thought(thoughts: &[String], stamped: String) -> Vec<String> {
    let text = thought_text(&stamped).to_string();
    let mut next = thoughts
        .iter()
        .filter(|known| !thought_text(known).eq_ignore_ascii_case(&text))
        .cloned()
        .collect::<Vec<_>>();
    next.push(stamped);
    next
}

/// Document whose frontmatter marks it as confidential; the body is kept.
pub fn with_confidential_context(source: &str) -> String {
    let normalized = source.replace("\r\n", "\n");
    let normalized = normalized.strip_prefix('\u{feff}').unwrap_or(&normalized);
    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---").filter(|end| {
            let after = &rest[end + 4..];
            after.is_empty() || after.starts_with('\n')
        }) {
            let mut lines = rest[..end]
                .lines()
                .filter(|line| {
                    line.split_once(':')
                        .is_none_or(|(key, _)| !key.trim().eq_ignore_ascii_case("contexto"))
                })
                .map(str::to_string)
                .collect::<Vec<_>>();
            lines.push(CONFIDENTIAL_CONTEXT_LINE.to_string());
            let body = rest[end + 4..].trim_start_matches('\n');
            return compose(&lines.join("\n"), body);
        }
    }
    compose(CONFIDENTIAL_CONTEXT_LINE, normalized)
}

fn compose(frontmatter: &str, body: &str) -> String {
    if body.is_empty() {
        format!("---\n{frontmatter}\n---\n")
    } else {
        format!("---\n{frontmatter}\n---\n\n{body}")
    }
}

/// Body of an agent document without its frontmatter.
pub fn document_body(source: &str) -> &str {
    strip_frontmatter(source)
}

/// A prompt file name inside `.agent/promps`, or the default prompt.
pub fn normalize_prompt_file_name(file_name: &str) -> String {
    let trimmed = file_name.trim();
    let valid = trimmed.len() > 3
        && trimmed.to_ascii_lowercase().ends_with(".md")
        && !trimmed.contains(['/', '\\'])
        && trimmed != "."
        && trimmed != "..";
    if valid { trimmed.to_string() } else { DEFAULT_PROMPT_FILE.to_string() }
}

/// Prompt file names sorted with the default first.
pub fn prompt_file_names(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut unique = Vec::<String>::new();
    for name in names.into_iter().map(|name| normalize_prompt_file_name(&name)) {
        if !unique.contains(&name) {
            unique.push(name);
        }
    }
    if !unique.iter().any(|name| name.eq_ignore_ascii_case(DEFAULT_PROMPT_FILE)) {
        unique.push(DEFAULT_PROMPT_FILE.to_string());
    }
    unique.sort_by(|left, right| {
        let left_default = left.eq_ignore_ascii_case(DEFAULT_PROMPT_FILE);
        let right_default = right.eq_ignore_ascii_case(DEFAULT_PROMPT_FILE);
        right_default.cmp(&left_default).then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    unique
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_keep_the_managed_block_and_agent_rules() {
        let first = append_rule("", "Cuando pida un resumen, usá viñetas.").expect("added");
        assert!(first.contains(RULES_START) && first.contains(IA_RULES_START));
        assert_eq!(append_rule(&first, "cuando pida un resumen, usá viñetas."), None);
        assert_eq!(ia_rules(&first), vec!["Cuando pida un resumen, usá viñetas.".to_string()]);
        let stale = first.replace(DEFAULT_AGENT_RULES.trim(), &format!("{RULES_START}\nvieja\n{RULES_END}"));
        assert_eq!(ensure_default_rules(&stale), ensure_default_rules(&first));
        let replaced = replace_ia_rules(&first, &["a".into(), "A".into(), " ".into()]);
        assert_eq!(ia_rules(&replaced), vec!["a".to_string()]);
    }

    #[test]
    fn personal_facts_move_to_memory_and_corrections_are_dropped() {
        let content = replace_ia_rules(
            "",
            &[
                "El usuario se llama Ana".into(),
                "Ninguna mutación financiera se ejecutó".into(),
                "Respondé en inglés".into(),
                "Tienda: no es memoria".into(),
            ],
        );
        let (rules, memories) = migrate_misclassified_rules(&content);
        assert_eq!(memories, vec!["El usuario se llama Ana".to_string()]);
        assert_eq!(ia_rules(&rules), vec!["Respondé en inglés".to_string(), "Tienda: no es memoria".to_string()]);
    }

    #[test]
    fn memories_are_parsed_merged_and_rendered() {
        let items = parse_memory_items("<!-- marker -->\n# Título\n- uno\n* Dos\n\n");
        assert_eq!(items, vec!["uno".to_string(), "Dos".to_string()]);
        let merged = merge_memories(items.into_iter().chain(["UNO".to_string()]));
        assert_eq!(merged, vec!["UNO".to_string(), "Dos".to_string()]);
        assert_eq!(parse_memory_items(&render_memories(&merged)), merged);
    }

    #[test]
    fn thoughts_are_dated_refreshed_and_rendered() {
        let first = stamp_thought("2026-09-27 10:00", "  Le avisé del turno   del lunes. ").expect("thought");
        assert_eq!(first, "[2026-09-27 10:00] Le avisé del turno del lunes.");
        assert_eq!(thought_text(&first), "Le avisé del turno del lunes.");
        assert_eq!(thought_text("sin fecha"), "sin fecha");
        assert_eq!(stamp_thought("2026-09-27 10:00", " "), None);
        assert_eq!(stamp_thought("2026-09-27 10:00", &"x".repeat(MAX_THOUGHT_CHARS + 1)), None);

        let other = stamp_thought("2026-09-27 10:05", "Propuse ordenar la rutina.").expect("thought");
        let again = stamp_thought("2026-09-27 11:00", "le avisé del turno del lunes.").expect("thought");
        let thoughts = with_thought(&with_thought(&[first], other.clone()), again.clone());
        assert_eq!(thoughts, vec![other, again]);

        let rendered = render_thoughts(&thoughts);
        assert!(rendered.starts_with(THOUGHTS_VERSION_MARKER));
        assert_eq!(parse_memory_items(&rendered), thoughts);
    }

    #[test]
    fn budgets_count_items_and_characters() {
        let items = vec!["abc".to_string(), "de".to_string()];
        let budget = ItemBudget { items: 3, chars: 6 };
        assert!(budget.fits(&items));
        assert!(budget.fits_one_more(&items, "f"));
        assert!(!budget.fits_one_more(&items, "fg"));
        assert!(!ItemBudget { items: 2, chars: 100 }.fits_one_more(&items, "f"));
        assert!(!ItemBudget { items: 5, chars: 4 }.fits(&items));
        assert!(MEMORY_TARGET.items < MEMORY_LIMIT.items && MEMORY_TARGET.chars < MEMORY_LIMIT.chars);
        assert!(THOUGHTS_TARGET.items < THOUGHTS_LIMIT.items && THOUGHTS_TARGET.chars < THOUGHTS_LIMIT.chars);
    }

    #[test]
    fn confidential_context_replaces_the_context_and_keeps_the_body() {
        assert_eq!(with_confidential_context("hola"), "---\ncontexto: \"#Confidencial\"\n---\n\nhola");
        let marked = with_confidential_context("---\ntitle: x\ncontexto: \"#Personal\"\n---\n\nhola");
        assert_eq!(marked, "---\ntitle: x\ncontexto: \"#Confidencial\"\n---\n\nhola");
        assert_eq!(with_confidential_context(&marked), marked);
    }

    #[test]
    fn prompt_names_are_validated_and_sorted() {
        assert_eq!(normalize_prompt_file_name("../x.md"), DEFAULT_PROMPT_FILE);
        assert_eq!(
            prompt_file_names(["Zeta.md".into(), "alfa.md".into(), "notas.txt".into()]),
            vec!["default.md".to_string(), "alfa.md".to_string(), "Zeta.md".to_string()]
        );
    }
}
