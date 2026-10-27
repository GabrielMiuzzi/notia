//! HTML written inside a note, as a public page may show it: the tags of
//! formatted text, tables and `<details>` with a few attributes; links and
//! images resolved inside the space. Anything else is shown as text or
//! dropped, so a note never runs a script in a visitor's browser.

use std::sync::OnceLock;

use regex::Regex;

use super::escape_attribute;

/// Tags kept as they are.
const ALLOWED_TAGS: &[&str] = &[
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt",
    "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol",
    "p", "pre", "s", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
    "tr", "u", "ul",
];
/// Tags whose content is dropped with them.
const DROPPED_WITH_CONTENT: &[&str] = &["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"];
const VOID_TAGS: &[&str] = &["br", "col", "hr", "img"];

/// What a link or image of the note becomes: its URL in the space, or
/// `None` when it points to something not published.
pub(crate) type LinkResolver<'a> = dyn Fn(&str, bool) -> Option<String> + 'a;

fn tag_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?s)<!--.*?-->|<(/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>\x22\x27]|\x22[^\x22]*\x22|\x27[^\x27]*\x27)*)>").expect("tag pattern"))
}

fn attribute_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r#"([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?"#).expect("attribute pattern")
    })
}

fn decode_entities(value: &str) -> String {
    value.replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

/// Text between tags: entities stay, a lone `<` or `>` is escaped.
fn text(value: &str) -> String {
    value.replace('<', "&lt;").replace('>', "&gt;")
}

fn allowed_attribute(tag: &str, name: &str) -> bool {
    match name {
        "title" | "align" | "data-color" => true,
        "colspan" | "rowspan" => matches!(tag, "td" | "th"),
        "data-view" => tag == "table",
        "href" => tag == "a",
        "src" | "alt" | "width" | "height" => tag == "img",
        "open" => tag == "details",
        "start" => tag == "ol",
        "span" => matches!(tag, "col" | "colgroup"),
        _ => false,
    }
}

fn attributes(tag: &str, source: &str, resolve: &LinkResolver<'_>) -> String {
    let mut output = String::new();
    for captures in attribute_pattern().captures_iter(source) {
        let name = captures[1].to_ascii_lowercase();
        let value = captures.get(2).or_else(|| captures.get(3)).or_else(|| captures.get(4)).map(|value| decode_entities(value.as_str()));
        if name == "class" && tag == "a" {
            let classes = value.unwrap_or_default();
            if classes.split_whitespace().any(|class| class == "button") {
                let variant = if classes.split_whitespace().any(|class| class == "secondary") { "secondary" } else { "primary" };
                output.push_str(&format!(" class=\"ps-button ps-button-{variant}\""));
            }
            continue;
        }
        if !allowed_attribute(tag, &name) {
            continue;
        }
        let value = match (name.as_str(), value) {
            ("href", Some(href)) => match resolve(&href, false) {
                Some(url) => url,
                None => continue,
            },
            ("src", Some(src)) => match resolve(&src, true) {
                Some(url) => url,
                None => continue,
            },
            (_, Some(value)) => value,
            (_, None) => {
                output.push_str(&format!(" {name}"));
                continue;
            }
        };
        output.push_str(&format!(" {name}=\"{}\"", escape_attribute(&value)));
        if name == "href" && super::links::is_external(&value) {
            output.push_str(" target=\"_blank\" rel=\"noopener noreferrer\"");
        }
    }
    output
}

/// `html` with only the allowed tags and attributes.
pub(crate) fn sanitize_html(html: &str, resolve: &LinkResolver<'_>) -> String {
    let mut output = String::with_capacity(html.len());
    let mut position = 0;
    let mut dropping: Option<String> = None;
    for found in tag_pattern().captures_iter(html) {
        let whole = found.get(0).expect("match");
        if dropping.is_none() {
            output.push_str(&text(&html[position..whole.start()]));
        }
        position = whole.end();
        let Some(name) = found.get(2).map(|name| name.as_str().to_ascii_lowercase()) else {
            continue; // A comment.
        };
        let closing = !found[1].is_empty();
        if let Some(dropped) = &dropping {
            if closing && *dropped == name {
                dropping = None;
            }
            continue;
        }
        if DROPPED_WITH_CONTENT.contains(&name.as_str()) {
            if !closing && !found[3].trim_end().ends_with('/') {
                dropping = Some(name);
            }
            continue;
        }
        if !ALLOWED_TAGS.contains(&name.as_str()) {
            continue;
        }
        if closing {
            if !VOID_TAGS.contains(&name.as_str()) {
                output.push_str(&format!("</{name}>"));
            }
        } else {
            output.push_str(&format!("<{name}{}>", attributes(&name, &found[3], resolve)));
        }
    }
    if dropping.is_none() {
        output.push_str(&text(&html[position..]));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(href: &str, image: bool) -> Option<String> {
        if href.starts_with("http") {
            return Some(href.to_string());
        }
        (href == "ok.md" || (image && href == "foto.png")).then(|| format!("/space/{href}"))
    }

    #[test]
    fn tables_and_formatting_stay_and_scripts_never_run() {
        let html = r#"<table><tr><td colspan="2" onclick="x()"><code>int a;</code></td></tr></table>"#;
        assert_eq!(sanitize_html(html, &resolve), r#"<table><tr><td colspan="2"><code>int a;</code></td></tr></table>"#);
        assert_eq!(sanitize_html("<script>alert(1)</script><u>ok</u>", &resolve), "<u>ok</u>");
        assert_eq!(sanitize_html("<img src=x onerror=alert(1)>", &resolve), "<img>");
        assert_eq!(sanitize_html("<a href=\"javascript:alert(1)\">x</a>", &resolve), "<a>x</a>");
        assert_eq!(sanitize_html("<span style=\"color:red\" data-color=\"teal\">t</span>", &resolve), "<span data-color=\"teal\">t</span>");
        assert_eq!(sanitize_html("<iframe src=\"https://x\"></iframe>después", &resolve), "después");
        assert_eq!(sanitize_html("a < b <!-- nota --> c", &resolve), "a &lt; b  c");
    }

    #[test]
    fn links_and_images_point_inside_the_space() {
        assert_eq!(sanitize_html("<a href=\"ok.md\">ir</a>", &resolve), "<a href=\"/space/ok.md\">ir</a>");
        assert_eq!(sanitize_html("<a href=\"otra.md\">ir</a>", &resolve), "<a>ir</a>");
        assert_eq!(
            sanitize_html("<a href=\"https://gitbook.com\" class=\"button secondary\">GitBook</a>", &resolve),
            "<a href=\"https://gitbook.com\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"ps-button ps-button-secondary\">GitBook</a>"
        );
        assert_eq!(sanitize_html("<img src=\"foto.png\" alt=\"Una &quot;foto&quot;\">", &resolve), "<img src=\"/space/foto.png\" alt=\"Una &quot;foto&quot;\">");
        assert_eq!(sanitize_html("<details open><summary>Más</summary>texto</details>", &resolve), "<details open><summary>Más</summary>texto</details>");
    }
}
