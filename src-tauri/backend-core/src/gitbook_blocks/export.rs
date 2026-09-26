//! What an export reads of the GitBook blocks: Markdown the export parser
//! already renders. Hints become quotes with their label, tabs, steps and
//! updates become bold titles, conditions are evaluated, reusable content is
//! inserted and expressions show their value. Fenced code is left as it is.

use std::sync::OnceLock;

use regex::Regex;

use super::{
    condition_state, resolve_reference, BlockLibrary, ConditionState, Reference, Variables, MAX_INCLUDE_DEPTH,
    SPACE_VARIABLES_PATH,
};
use crate::prompt::strip_frontmatter;

/// Reusable content one export inserts, however it is nested.
const MAX_INCLUDES: usize = 50;

/// The note, with its properties untouched and its blocks as plain Markdown.
pub fn expand_for_export(markdown: &str, current: &str, library: &mut dyn BlockLibrary) -> String {
    let body = strip_frontmatter(markdown);
    let frontmatter = &markdown[..markdown.len() - body.len()];
    if !mentions_blocks(body) {
        return markdown.to_string();
    }
    let space = library.read_text(SPACE_VARIABLES_PATH);
    let variables = Variables::read(markdown, space.as_deref());
    let mut expander = Expander { library, variables: &variables, chain: vec![current.to_string()], includes_left: MAX_INCLUDES };
    let lines = expander.expand(body, current, 0);
    format!("{frontmatter}{}", lines.join("\n"))
}

fn mentions_blocks(body: &str) -> bool {
    ["{%", "<details", "<summary", "data-view=\"cards\"", "class=\"expression\"", "class=\"button", "<i class=\"fa-", "<img", "<figure"]
        .iter()
        .any(|marker| body.contains(marker))
}

fn regex(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid pattern"))
}

fn tag_pattern() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    regex(&CELL, r"\{%-?\s*([a-z][a-z-]*)(.*?)-?%\}")
}

/// Value of `name="…"` in the arguments of a tag or an HTML element.
/// GitBook's own examples sometimes close with a typographic quote.
fn attribute(arguments: &str, name: &str) -> Option<String> {
    static CELL: OnceLock<Regex> = OnceLock::new();
    let pattern = regex(&CELL, r#"([A-Za-z-]+)\s*=\s*["“]([^"”]*)["”]"#);
    pattern
        .captures_iter(arguments)
        .find(|captures| captures[1].eq_ignore_ascii_case(name))
        .map(|captures| decode_entities(&captures[2]))
}

/// First quoted argument (`{% include "…" %}`).
fn quoted_argument(arguments: &str) -> Option<String> {
    static CELL: OnceLock<Regex> = OnceLock::new();
    let pattern = regex(&CELL, r#"["“']([^"”']*)["”']"#);
    pattern.captures(arguments).map(|captures| captures[1].to_string())
}

fn decode_entities(text: &str) -> String {
    text.replace("&quot;", "\"")
        .replace("&#x20;", " ")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

fn strip_tags(html: &str) -> String {
    static CELL: OnceLock<Regex> = OnceLock::new();
    let text = regex(&CELL, r"<[^>]*>").replace_all(html, "");
    decode_entities(text.trim())
}

/// Text that must stay text once it is inside Markdown.
fn escape_markdown(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(ch, '\\' | '*' | '_' | '[' | ']' | '<' | '>' | '`' | '#' | '|' | '{' | '}') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn is_web_address(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

/// A link a reader of the exported file can follow, or the plain name.
fn link_or_name(url: &str) -> String {
    if is_web_address(url) && !url.contains(['<', '>', ' ']) {
        format!("<{}>", url.trim())
    } else {
        let name = url.rsplit(['/', '\\']).next().unwrap_or(url);
        escape_markdown(name)
    }
}

fn hint_label(style: Option<&str>) -> &'static str {
    match style {
        Some("success") => "Éxito",
        Some("warning") => "Advertencia",
        Some("danger") => "Peligro",
        _ => "Información",
    }
}

enum Piece<'a> {
    Text(&'a str),
    Tag { name: String, arguments: &'a str, raw: &'a str },
}

/// A line cut at its tags; a line without tags stays whole, indentation included.
fn split_tags(line: &str) -> Vec<Piece<'_>> {
    let mut pieces = Vec::new();
    let mut last = 0;
    for captures in tag_pattern().captures_iter(line) {
        let whole = captures.get(0).expect("match");
        let before = line[last..whole.start()].trim();
        if !before.is_empty() {
            pieces.push(Piece::Text(before));
        }
        let arguments = captures.get(2).map_or("", |matched| matched.as_str());
        pieces.push(Piece::Tag { name: captures[1].to_ascii_lowercase(), arguments, raw: whole.as_str() });
        last = whole.end();
    }
    if last == 0 {
        return vec![Piece::Text(line)];
    }
    let after = line[last..].trim();
    if !after.is_empty() {
        pieces.push(Piece::Text(after));
    }
    pieces
}

/// Opening fence of a code block: its character and length.
fn fence_open(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start_matches([' ', '>']).trim_start();
    let ch = trimmed.chars().next().filter(|ch| *ch == '`' || *ch == '~')?;
    let length = trimmed.chars().take_while(|candidate| *candidate == ch).count();
    (length >= 3).then_some((ch, length))
}

fn is_fence_close(line: &str, ch: char, length: usize) -> bool {
    let trimmed = line.trim_start_matches([' ', '>']).trim();
    trimmed.chars().count() >= length && trimmed.chars().all(|candidate| candidate == ch)
}

struct Expander<'a> {
    library: &'a mut dyn BlockLibrary,
    variables: &'a Variables,
    /// Notes being expanded, outermost first, so an include cannot loop.
    chain: Vec<String>,
    includes_left: usize,
}

/// Lines written inside `quote` levels of hints.
struct Output {
    lines: Vec<String>,
    quote: usize,
}

impl Output {
    fn push(&mut self, line: &str) {
        let prefix = "> ".repeat(self.quote);
        if line.is_empty() {
            self.lines.push(prefix.trim_end().to_string());
        } else {
            self.lines.push(format!("{prefix}{line}"));
        }
    }

    fn block(&mut self, line: &str) {
        self.push("");
        self.push(line);
        self.push("");
    }
}

impl Expander<'_> {
    fn expand(&mut self, body: &str, current: &str, depth: usize) -> Vec<String> {
        let mut output = Output { lines: Vec::new(), quote: 0 };
        // Nested `{% if %}` levels inside one whose content is left out.
        let mut skipping = 0usize;
        let mut steps: Vec<usize> = Vec::new();
        let mut fence: Option<(char, usize)> = None;
        let mut cards: Option<String> = None;
        for line in body.lines() {
            if let Some((ch, length)) = fence {
                if skipping == 0 {
                    output.push(line);
                }
                if is_fence_close(line, ch, length) {
                    fence = None;
                }
                continue;
            }
            if let Some(table) = cards.as_mut() {
                table.push_str(line);
                table.push('\n');
                if line.to_ascii_lowercase().contains("</table>") {
                    let table = cards.take().unwrap_or_default();
                    if skipping == 0 {
                        card_lines(&table).iter().for_each(|card| output.push(card));
                    }
                }
                continue;
            }
            if let Some(open) = fence_open(line) {
                fence = Some(open);
                if skipping == 0 {
                    output.push(line);
                }
                continue;
            }
            if line.trim_start().to_ascii_lowercase().starts_with("<table data-view=\"cards\"") {
                if line.to_ascii_lowercase().contains("</table>") {
                    if skipping == 0 {
                        card_lines(line).iter().for_each(|card| output.push(card));
                    }
                } else {
                    cards = Some(format!("{line}\n"));
                }
                continue;
            }
            for piece in split_tags(line) {
                match piece {
                    Piece::Text(_) if skipping > 0 => {}
                    Piece::Text(text) => {
                        let text = self.inline(text);
                        output.push(&text);
                    }
                    Piece::Tag { name, arguments, raw } => {
                        if skipping > 0 {
                            match name.as_str() {
                                "if" => skipping += 1,
                                "endif" => skipping -= 1,
                                _ => {}
                            }
                            continue;
                        }
                        self.tag(&mut output, &mut steps, &mut skipping, &name, arguments, raw, current, depth);
                    }
                }
            }
        }
        // A card table that never closes stays as it was written.
        if let Some(table) = cards {
            table.lines().for_each(|line| output.push(line));
        }
        output.lines
    }

    #[allow(clippy::too_many_arguments)]
    fn tag(
        &mut self,
        output: &mut Output,
        steps: &mut Vec<usize>,
        skipping: &mut usize,
        name: &str,
        arguments: &str,
        raw: &str,
        current: &str,
        depth: usize,
    ) {
        match name {
            "hint" => {
                output.push("");
                output.quote += 1;
                let style = attribute(arguments, "style");
                output.push(&format!("**{}**", hint_label(style.as_deref())));
                output.push("");
            }
            "endhint" => {
                output.quote = output.quote.saturating_sub(1);
                output.push("");
            }
            "stepper" => {
                steps.push(0);
                output.push("");
            }
            "endstepper" => {
                steps.pop();
                output.push("");
            }
            "step" => {
                let number = match steps.last_mut() {
                    Some(count) => {
                        *count += 1;
                        *count
                    }
                    None => 1,
                };
                output.block(&format!("**Paso {number}**"));
            }
            "tab" => {
                let title = attribute(arguments, "title").filter(|title| !title.trim().is_empty());
                output.block(&format!("**{}**", title.map_or_else(|| "Pestaña".to_string(), |title| escape_markdown(title.trim()))));
            }
            "update" => {
                let date = attribute(arguments, "date").unwrap_or_default();
                let tags = attribute(arguments, "tags").filter(|tags| !tags.trim().is_empty());
                let label = match tags {
                    Some(tags) => format!("{} · {}", date.trim(), tags.replace(',', ", ")),
                    None => date.trim().to_string(),
                };
                if !label.is_empty() {
                    output.block(&format!("**{}**", escape_markdown(&label)));
                }
            }
            "code" => {
                if let Some(title) = attribute(arguments, "title").filter(|title| !title.trim().is_empty()) {
                    output.block(&format!("**{}**", escape_markdown(title.trim())));
                }
            }
            "prompt" => {
                let label = match attribute(arguments, "description").filter(|text| !text.trim().is_empty()) {
                    Some(description) => format!("**Prompt: {}**", escape_markdown(description.trim())),
                    None => "**Prompt**".to_string(),
                };
                output.block(&label);
            }
            "if" => {
                if condition_state(arguments, self.variables) != ConditionState::Satisfied {
                    *skipping = 1;
                }
                output.push("");
            }
            "embed" => {
                if let Some(url) = attribute(arguments, "url") {
                    output.block(&link_or_name(&url));
                }
            }
            "file" => {
                if let Some(source) = attribute(arguments, "src") {
                    output.block(&format!("Archivo: {}", link_or_name(&source)));
                }
            }
            "include" => {
                let lines = quoted_argument(arguments).and_then(|reference| self.include(&reference, current, depth));
                match lines {
                    Some(lines) => {
                        output.push("");
                        lines.iter().for_each(|line| output.push(line));
                        output.push("");
                    }
                    None => output.block("*\\[Contenido reutilizable no disponible\\]*"),
                }
            }
            "tabs" | "endtabs" | "endtab" | "columns" | "endcolumns" | "column" | "endcolumn" | "endstep" | "updates"
            | "endupdates" | "endupdate" | "endcode" | "endprompt" | "endif" | "content-ref" | "endcontent-ref"
            | "endfile" | "endembed" => output.push(""),
            // Tags Notia does not know stay as they were written.
            _ => output.push(raw),
        }
    }

    fn include(&mut self, reference: &str, current: &str, depth: usize) -> Option<Vec<String>> {
        if depth >= MAX_INCLUDE_DEPTH || self.includes_left == 0 {
            return None;
        }
        let Reference::Library(path) = resolve_reference(reference, current) else {
            return None;
        };
        if self.chain.iter().any(|open| open.eq_ignore_ascii_case(&path)) {
            return None;
        }
        let text = self.library.read_text(&path)?;
        self.includes_left -= 1;
        self.chain.push(path.clone());
        let lines = self.expand(strip_frontmatter(&text), &path, depth + 1);
        self.chain.pop();
        Some(lines)
    }

    /// The HTML GitBook writes inside text, as Markdown the export shows.
    fn inline(&self, line: &str) -> String {
        static DETAILS: OnceLock<Regex> = OnceLock::new();
        static SUMMARY: OnceLock<Regex> = OnceLock::new();
        static FIGURE: OnceLock<Regex> = OnceLock::new();
        static CAPTION: OnceLock<Regex> = OnceLock::new();
        static EXPRESSION: OnceLock<Regex> = OnceLock::new();
        static BUTTON: OnceLock<Regex> = OnceLock::new();
        static ICON: OnceLock<Regex> = OnceLock::new();
        static IMAGE: OnceLock<Regex> = OnceLock::new();
        let line = regex(&DETAILS, r"(?i)</?details\b[^>]*>").replace_all(line, "");
        let line = regex(&SUMMARY, r"(?is)<summary>(.*?)</summary>")
            .replace_all(&line, |captures: &regex::Captures| format!("**{}**", escape_markdown(&strip_tags(&captures[1]))));
        let line = regex(&FIGURE, r"(?i)</?figure\b[^>]*>").replace_all(&line, "");
        let line = regex(&CAPTION, r"(?is)<figcaption>(.*?)</figcaption>")
            .replace_all(&line, |captures: &regex::Captures| format!(" {}", escape_markdown(&strip_tags(&captures[1]))));
        let line = regex(&EXPRESSION, r#"(?is)<code\s+class="expression"\s*>(.*?)</code>"#).replace_all(&line, |captures: &regex::Captures| {
            let expression = decode_entities(&captures[1]);
            match super::evaluate(&expression, self.variables) {
                Ok(evaluation) if evaluation.value != super::Value::Undefined => escape_markdown(&evaluation.value.display()),
                _ => String::new(),
            }
        });
        let line = regex(&BUTTON, r#"(?is)<a\s+([^>]*class="button[^"]*"[^>]*)>(.*?)</a>"#).replace_all(&line, |captures: &regex::Captures| {
            let label = escape_markdown(&strip_tags(&captures[2]));
            match attribute(&captures[1], "href") {
                Some(href) if is_web_address(&href) && !href.contains(['<', '>', ' ']) => format!("[{label}](<{}>)", href.trim()),
                _ => label,
            }
        });
        let line = regex(&ICON, r#"(?is)<i\s+class="fa-[^"]*"[^>]*>.*?</i>"#).replace_all(&line, "");
        let line = regex(&IMAGE, r"(?is)<img\s([^>]*)>").replace_all(&line, |captures: &regex::Captures| {
            let attributes = &captures[1];
            let alt = attribute(attributes, "alt").filter(|alt| !alt.trim().is_empty());
            let is_drawing = attribute(attributes, "class").is_some_and(|class| class.split_whitespace().any(|name| name == "gitbook-drawing"));
            let kind = if is_drawing { "Dibujo" } else { "Imagen" };
            match alt {
                Some(alt) => format!("*\\[{kind}: {}\\]*", escape_markdown(alt.trim())),
                None => format!("*\\[{kind}\\]*"),
            }
        });
        line.into_owned()
    }
}

/// Each card of a `<table data-view="cards">` as a list item.
fn card_lines(table: &str) -> Vec<String> {
    static HEAD: OnceLock<Regex> = OnceLock::new();
    static HEADER_CELL: OnceLock<Regex> = OnceLock::new();
    static ROW: OnceLock<Regex> = OnceLock::new();
    static CELL: OnceLock<Regex> = OnceLock::new();
    let head = regex(&HEAD, r"(?is)<thead>(.*?)</thead>").captures(table).map(|captures| captures[1].to_string()).unwrap_or_default();
    let header_cells: Vec<String> = regex(&HEADER_CELL, r"(?is)<th\b([^>]*)>").captures_iter(&head).map(|captures| captures[1].to_ascii_lowercase()).collect();
    let target = header_cells.iter().position(|cell| cell.contains("data-card-target"));
    let hidden: Vec<usize> = header_cells
        .iter()
        .enumerate()
        .filter(|(_, cell)| cell.contains("data-card-cover") || cell.contains("data-hidden"))
        .map(|(index, _)| index)
        .collect();
    let body = regex(&HEAD, r"(?is)<thead>(.*?)</thead>").replace(table, "");
    let mut lines = vec![String::new()];
    for row in regex(&ROW, r"(?is)<tr\b[^>]*>(.*?)</tr>").captures_iter(&body) {
        let cells: Vec<&str> = regex(&CELL, r"(?is)<td\b[^>]*>(.*?)</td>").captures_iter(&row[1]).map(|captures| captures.get(1).map_or("", |cell| cell.as_str())).collect();
        let texts: Vec<String> = cells
            .iter()
            .enumerate()
            .filter(|(index, _)| !hidden.contains(index) && Some(*index) != target)
            .map(|(_, cell)| strip_tags(cell))
            .filter(|text| !text.is_empty())
            .map(|text| escape_markdown(&text))
            .collect();
        let link = target.and_then(|index| cells.get(index)).and_then(|cell| attribute(cell, "href")).filter(|href| is_web_address(href));
        let Some((title, rest)) = texts.split_first() else {
            continue;
        };
        let mut line = format!("- **{title}**");
        if !rest.is_empty() {
            line.push_str(&format!(" — {}", rest.join(" · ")));
        }
        if let Some(link) = link {
            line.push_str(&format!(" ({})", link_or_name(&link)));
        }
        lines.push(line);
    }
    lines.push(String::new());
    lines
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    struct Library(BTreeMap<String, String>);

    impl BlockLibrary for Library {
        fn read_text(&mut self, logical_path: &str) -> Option<String> {
            self.0.get(logical_path).cloned()
        }
        fn exists(&mut self, logical_path: &str) -> bool {
            self.0.contains_key(logical_path)
        }
        fn visible_path(&self, logical_path: &str) -> String {
            logical_path.to_string()
        }
    }

    fn expand(markdown: &str) -> String {
        let mut library = Library(BTreeMap::from([
            (SPACE_VARIABLES_PATH.to_string(), "version: v3\n".to_string()),
            ("docs/aviso.md".to_string(), "---\na: 1\n---\n\nTexto *reusado*\n\n{% include \"bucle.md\" %}".to_string()),
            ("docs/bucle.md".to_string(), "Bucle\n\n{% include \"aviso.md\" %}".to_string()),
        ]));
        expand_for_export(markdown, "docs/nota.md", &mut library)
    }

    #[test]
    fn leaves_notes_without_blocks_untouched() {
        let markdown = "---\ntitle: x\n---\n\n# Hola\n\nTexto";
        assert_eq!(expand(markdown), markdown);
    }

    #[test]
    fn writes_hints_as_labelled_quotes_and_keeps_code() {
        let expanded = expand("{% hint style=\"warning\" %}\nCuidado\n```\n{% endhint %}\n```\n{% endhint %}\n\nFuera");
        assert_eq!(expanded, "\n> **Advertencia**\n>\n> Cuidado\n> ```\n> {% endhint %}\n> ```\n\n\nFuera");
    }

    #[test]
    fn titles_tabs_steps_updates_code_and_prompts() {
        let expanded = expand(concat!(
            "{% tabs %}{% tab title=\"JS\" %}\nuno\n{% endtab %}{% endtabs %}\n",
            "{% stepper %}\n{% step %}\na\n{% endstep %}\n{% step %}\nb\n{% endstep %}\n{% endstepper %}\n",
            "{% updates format=\"full\" %}\n{% update date=\"2026-01-02\" tags=\"api,beta\" %}\nnovedad\n{% endupdate %}\n{% endupdates %}\n",
            "{% code title=\"main.rs\" lineNumbers=\"true\" %}\n```rust\nfn main() {}\n```\n{% endcode %}\n",
            "{% prompt description=\"Resumir\" defaultExpanded=\"full” %}\n```\nhola\n```\n{% endprompt %}\n",
        ));
        for expected in ["**JS**", "**Paso 1**", "**Paso 2**", "**2026-01-02 · api, beta**", "**main.rs**", "**Prompt: Resumir**", "fn main() {}"] {
            assert!(expanded.contains(expected), "{expected} in {expanded}");
        }
        assert!(!expanded.contains("{%"));
    }

    #[test]
    fn evaluates_conditions_and_expressions() {
        let expanded = expand(concat!(
            "---\nvars:\n  plan: pro\n---\n",
            "{% if page.vars.plan === 'pro' %}\nPro <code class=\"expression\">space.vars.version + '!'</code>\n{% endif %}\n",
            "{% if visitor.claims.unsigned.a %}\nlector\n{% if true %}\nanidado\n{% endif %}\nsigue oculto\n{% endif %}\n",
            "{% if page.vars.plan == 'free' %}\nfree\n{% endif %}\nvisible",
        ));
        assert!(expanded.contains("Pro v3!"));
        for hidden in ["lector", "anidado", "sigue oculto", "free"] {
            assert!(!expanded.contains(hidden), "{hidden} in {expanded}");
        }
        assert!(expanded.ends_with("visible"));
        assert!(expanded.starts_with("---\nvars:\n  plan: pro\n---\n"));
    }

    #[test]
    fn inserts_reusable_content_without_looping() {
        let expanded = expand("{% include \"aviso.md\" %}\n{% include \"../fuera/../../x.md\" %}");
        assert!(expanded.contains("Texto *reusado*"));
        assert!(expanded.contains("Bucle"));
        assert_eq!(expanded.matches("Texto *reusado*").count(), 1);
        assert_eq!(expanded.matches("no disponible").count(), 2);
    }

    #[test]
    fn writes_links_files_details_cards_and_inline_html() {
        let expanded = expand(concat!(
            "{% embed url=\"https://youtu.be/x\" %}\n",
            "{% file src=\".gitbook/assets/informe.pdf\" %}\nEl informe\n{% endfile %}\n",
            "{% content-ref url=\"otra.md\" %}\n[otra.md](otra.md)\n{% endcontent-ref %}\n",
            "<details open>\n<summary>Más <b>info</b></summary>\n\nCuerpo\n\n</details>\n",
            "<table data-view=\"cards\"><thead><tr><th></th><th></th><th data-hidden data-card-target data-type=\"content-ref\"></th></tr></thead>\n",
            "<tbody><tr><td><strong>Inicio</strong></td><td>Primeros pasos</td><td><a href=\"https://x.org\">x</a></td></tr></tbody></table>\n",
            "<a href=\"https://x.org/go\" class=\"button primary\" data-icon=\"rocket\">Empezar</a> <i class=\"fa-check\">check</i> ok ",
            "<img src=\"a.png\" alt=\"logo\" data-size=\"line\"> <img src=\"data:image/svg+xml;base64,AA\" alt=\"Plano\" class=\"gitbook-drawing\">",
        ));
        for expected in [
            "<https://youtu.be/x>",
            "Archivo: informe.pdf",
            "El informe",
            "[otra.md](otra.md)",
            "**Más info**",
            "Cuerpo",
            "- **Inicio** — Primeros pasos (<https://x.org>)",
            "[Empezar](<https://x.org/go>)  ok",
            "*\\[Imagen: logo\\]*",
            "*\\[Dibujo: Plano\\]*",
        ] {
            assert!(expanded.contains(expected), "{expected} in {expanded}");
        }
        assert!(!expanded.contains("<details") && !expanded.contains("<table"));
    }

    #[test]
    fn keeps_unknown_tags_and_unclosed_card_tables() {
        let expanded = expand("{% openapi src=\"x\" %}\n<table data-view=\"cards\">\n<tr>");
        assert!(expanded.contains("{% openapi src=\"x\" %}"));
        assert!(expanded.contains("<table data-view=\"cards\">\n<tr>"));
    }
}
