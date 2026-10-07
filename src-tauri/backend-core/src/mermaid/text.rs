//! Line and label helpers shared by the Mermaid diagram editors.

/// The lines of a diagram source, without line endings.
pub fn split_lines(source: &str) -> Vec<String> {
    source.replace("\r\n", "\n").replace('\r', "\n").split('\n').map(str::to_string).collect()
}

/// The source of `lines`, ending in one newline.
pub fn join_lines(lines: &[String]) -> String {
    let mut out = lines.join("\n");
    while out.ends_with("\n\n") {
        out.pop();
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// A line that only holds a comment or nothing.
pub fn is_blank_or_comment(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.is_empty() || trimmed.starts_with("%%")
}

/// The line of the diagram keyword: the first statement after the
/// frontmatter (`---` … `---`) and the `%%` directives.
pub fn header_line(lines: &[String]) -> Option<usize> {
    let mut start = 0;
    let first = lines.iter().position(|line| !is_blank_or_comment(line))?;
    if lines[first].trim() == "---" {
        let close = lines.iter().skip(first + 1).position(|line| line.trim() == "---")?;
        start = first + 1 + close + 1;
    }
    lines.iter().enumerate().skip(start).find(|(_, line)| !is_blank_or_comment(line)).map(|(index, _)| index)
}

/// The leading spaces of `line`.
pub fn indent_of(line: &str) -> String {
    line.chars().take_while(|character| character.is_whitespace()).collect()
}

/// The indent statements of a diagram use: the one of its first statement
/// after the header, or two spaces.
pub fn body_indent(lines: &[String], header: usize) -> String {
    lines
        .iter()
        .skip(header + 1)
        .find(|line| !is_blank_or_comment(line))
        .map(|line| indent_of(line))
        .filter(|indent| !indent.is_empty())
        .unwrap_or_else(|| "  ".to_string())
}

/// A label written inside double quotes; quotes become `#quot;`.
pub fn quoted(text: &str) -> String {
    format!("\"{}\"", single_line(text).replace('"', "#quot;"))
}

/// `"text"` or `text`, without its quotes, with `#quot;` back to `"`.
pub fn unquoted(text: &str) -> String {
    let trimmed = text.trim();
    let inner = trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(trimmed);
    inner.replace("#quot;", "\"")
}

/// The words of `text` on one line.
pub fn single_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A label for a statement, on one line and at most `max` characters.
pub fn clean_label(text: &str, max: usize) -> String {
    single_line(text).chars().take(max).collect::<String>().trim().to_string()
}

/// An identifier made from `text`: letters, digits and `_`, starting with a
/// letter; `fallback` when nothing is left.
pub fn identifier(text: &str, fallback: &str) -> String {
    let mut out = String::new();
    for character in text.chars() {
        if character.is_alphanumeric() || character == '_' {
            out.push(character);
        } else if !out.is_empty() && !out.ends_with('_') {
            out.push('_');
        }
    }
    let out = out.trim_matches('_').to_string();
    match out.chars().next() {
        Some(first) if first.is_alphabetic() => out,
        Some(_) => format!("{fallback}_{out}"),
        None => fallback.to_string(),
    }
}

/// `text` with the Spanish accents and `ñ` replaced by plain letters.
pub fn fold_accents(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'Á' | 'À' | 'Ä' | 'Â' => 'A',
            'É' | 'È' | 'Ë' | 'Ê' => 'E',
            'Í' | 'Ì' | 'Ï' | 'Î' => 'I',
            'Ó' | 'Ò' | 'Ö' | 'Ô' => 'O',
            'Ú' | 'Ù' | 'Ü' | 'Û' => 'U',
            'ñ' => 'n',
            'Ñ' => 'N',
            other => other,
        })
        .collect()
}

/// An ASCII identifier in PascalCase made from `text` (`En revisión` →
/// `EnRevision`), starting with a letter; `fallback` when nothing is left.
pub fn pascal_identifier(text: &str, fallback: &str) -> String {
    let folded = fold_accents(text);
    let mut out = String::new();
    for word in folded.split(|character: char| !character.is_ascii_alphanumeric()).filter(|word| !word.is_empty()) {
        let mut characters = word.chars();
        if let Some(first) = characters.next() {
            out.push(first.to_ascii_uppercase());
            out.extend(characters);
        }
    }
    match out.chars().next() {
        Some(first) if first.is_ascii_alphabetic() => out,
        Some(_) => format!("{fallback}{out}"),
        None => fallback.to_string(),
    }
}

/// `base`, or `base2`, `base3`… the first one `taken` does not hold.
pub fn unique_name(base: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(base) {
        return base.to_string();
    }
    (2..).map(|number| format!("{base}{number}")).find(|name| !taken(name)).unwrap_or_else(|| base.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_and_names_are_safe_for_mermaid() {
        assert_eq!(quoted("dice \"hola\"\n otra"), "\"dice #quot;hola#quot; otra\"");
        assert_eq!(unquoted(" \"dice #quot;hola#quot;\" "), "dice \"hola\"");
        assert_eq!(identifier("Próximo Q!", "estado"), "Próximo_Q");
        assert_eq!(identifier("1 inicio", "estado"), "estado_1_inicio");
        assert_eq!(identifier("!!", "estado"), "estado");
        assert_eq!(unique_name("Nodo", |name| name == "Nodo" || name == "Nodo2"), "Nodo3");
        assert_eq!(join_lines(&["a".into(), "b".into(), String::new(), String::new()]), "a\nb\n");
        assert_eq!(body_indent(&["flowchart TD".into(), "".into(), "    a --> b".into()], 0), "    ");
    }
}
