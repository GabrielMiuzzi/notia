//! Content rules of the library's `.agent` workspace: the managed default
//! rules block, rules added by the agent, persistent memories, the
//! confidential context of every agent file and prompt names. The adapter
//! only reads and writes the files.

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
pub const LEGACY_MEMORY_PATH: &str = "chat/LongTermMemory.md";
pub const LEGACY_MEMORY_BACKUP_PATH: &str = ".agent/memory/LongTermMemory.legacy.v1.backup.md";
pub const DEFAULT_PROMPT_FILE: &str = "default.md";
pub const DEFAULT_PROMPT_PATH: &str = ".agent/promps/default.md";
pub const MAX_MEMORIES: usize = 100;
pub const MAX_RULE_CHARS: usize = 8_000;

const RULES_START: &str = "<!-- NOTIA_DEFAULT_RULES_START -->";
const RULES_END: &str = "<!-- NOTIA_DEFAULT_RULES_END -->";
const IA_RULES_START: &str = "<!-- NOTIA_IA_RULES_START -->";
const IA_RULES_END: &str = "<!-- NOTIA_IA_RULES_END -->";
const MEMORY_VERSION_MARKER: &str = "<!-- NOTIA_AGENT_MEMORY_VERSION:1 -->";
const CONFIDENTIAL_CONTEXT_LINE: &str = "contexto: \"#Confidencial\"";

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

/// Case-insensitive union keeping the latest spelling, capped.
pub fn merge_memories(items: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut merged = Vec::<String>::new();
    for item in items.into_iter().map(|item| item.trim().to_string()) {
        if item.is_empty() {
            continue;
        }
        match merged.iter_mut().find(|known| known.eq_ignore_ascii_case(&item)) {
            Some(known) => *known = item,
            None => merged.push(item),
        }
    }
    merged.truncate(MAX_MEMORIES);
    merged
}

/// Memory file body for `memories`.
pub fn render_memories(memories: &[String]) -> String {
    let mut lines = vec![MEMORY_VERSION_MARKER.to_string(), String::new()];
    lines.extend(memories.iter().map(|memory| format!("- {memory}")));
    lines.push(String::new());
    lines.join("\n")
}

/// Recovery copy of the legacy chat memory kept once after its migration.
pub fn legacy_memory_backup(legacy: &str) -> String {
    format!("{MEMORY_VERSION_MARKER}\n<!-- Source: {LEGACY_MEMORY_PATH} -->\n\n{legacy}")
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
