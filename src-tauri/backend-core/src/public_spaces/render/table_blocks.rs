//! Blocks inside table cells. A GFM cell only holds inline Markdown, so the
//! editor keeps a block written there (a list, code, a quote, a heading…) as
//! `<!--notia-table-block:…-->`: its ProseMirror JSON, URI-encoded. The page
//! shows that block as the editor does; anything it does not know shows its
//! content.

use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use super::{code, escape_attribute, escape_text, PageContext};

const PREFIX: &str = "<!--notia-table-block:";
const SUFFIX: &str = "-->";
/// The editor ignores longer markers.
const MAX_LENGTH: usize = 500_000;
/// Deeper nodes are dropped, so a crafted marker cannot exhaust the stack.
const MAX_DEPTH: usize = 32;
/// Colors the editor writes (`RICH_TEXT_COLORS`).
const COLORS: &[&str] = &["gray", "teal", "blue", "violet", "red", "orange", "yellow"];

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

/// The node a cell's marker holds, when `html` is exactly one valid marker.
pub(crate) fn marker_node(html: &str) -> Option<Value> {
    let html = html.trim();
    if html.len() > MAX_LENGTH {
        return None;
    }
    let encoded = html.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    let node: Value = serde_json::from_str(&percent_decode(encoded)?).ok()?;
    node.get("type").and_then(Value::as_str).is_some().then_some(node)
}

fn wikilink_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]").expect("wikilink pattern"))
}

fn attr<'a>(node: &'a Value, name: &str) -> Option<&'a Value> {
    node.get("attrs").and_then(|attrs| attrs.get(name)).filter(|value| !value.is_null())
}

fn attr_str<'a>(node: &'a Value, name: &str) -> &'a str {
    attr(node, name).and_then(Value::as_str).unwrap_or_default()
}

fn children(node: &Value) -> &[Value] {
    node.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn plain_text(node: &Value) -> String {
    match node.get("text").and_then(Value::as_str) {
        Some(text) => text.to_string(),
        None => children(node).iter().map(plain_text).collect(),
    }
}

/// Text of a node: wikilinks become links to their published pages.
fn write_text(text: &str, linked: bool, context: &PageContext<'_>, output: &mut String) {
    if linked {
        output.push_str(&escape_text(text));
        return;
    }
    let mut position = 0;
    for found in wikilink_pattern().captures_iter(text) {
        let whole = found.get(0).expect("match");
        output.push_str(&escape_text(&text[position..whole.start()]));
        let target = found[1].trim();
        let label = found.get(2).map(|alias| alias.as_str().trim().to_string()).unwrap_or_else(|| context.wikilink_label(target));
        match context.resolve_wikilink(target) {
            Some(href) => output.push_str(&format!("<a href=\"{}\">{}</a>", escape_attribute(&href), escape_text(&label))),
            None => output.push_str(&format!("<span class=\"ps-missing-link\">{}</span>", escape_text(&label))),
        }
        position = whole.end();
    }
    output.push_str(&escape_text(&text[position..]));
}

/// The opening and closing tags of a mark, or `None` when it adds nothing.
fn mark_tags(mark: &Value, context: &PageContext<'_>) -> Option<(String, String)> {
    let color = |name: &str| {
        let color = attr_str(mark, name);
        COLORS.contains(&color).then(|| color.to_string())
    };
    let tags = match mark.get("type").and_then(Value::as_str)? {
        "strong" => ("<strong>".to_string(), "</strong>".to_string()),
        "emphasis" => ("<em>".to_string(), "</em>".to_string()),
        "inlineCode" => ("<code>".to_string(), "</code>".to_string()),
        "strike_through" => ("<del>".to_string(), "</del>".to_string()),
        "notia_underline" => ("<u>".to_string(), "</u>".to_string()),
        "notia_text_color" => (format!("<span data-color=\"{}\">", color("color")?), "</span>".to_string()),
        "notia_highlight" => (format!("<mark data-color=\"{}\">", color("color").unwrap_or_else(|| "yellow".to_string())), "</mark>".to_string()),
        "link" => match context.resolve_href(attr_str(mark, "href"), false) {
            Some(href) => {
                let external = if super::links::is_external(&href) { " target=\"_blank\" rel=\"noopener noreferrer\"" } else { "" };
                (format!("<a href=\"{}\"{external}>", escape_attribute(&href)), "</a>".to_string())
            }
            None => ("<span class=\"ps-missing-link\">".to_string(), "</span>".to_string()),
        },
        _ => return None,
    };
    Some(tags)
}

fn write_children(node: &Value, depth: usize, context: &mut PageContext<'_>, output: &mut String) {
    for child in children(node) {
        write_node(child, depth + 1, context, output);
    }
}

fn write_image(src: &str, alt: &str, title: &str, context: &PageContext<'_>, output: &mut String) {
    match context.resolve_href(src, true) {
        Some(src) => {
            let title = if title.is_empty() { String::new() } else { format!(" title=\"{}\"", escape_attribute(title)) };
            output.push_str(&format!("<img src=\"{}\" alt=\"{}\"{title} loading=\"lazy\">", escape_attribute(&src), escape_attribute(alt)));
        }
        None => output.push_str(&format!("<span class=\"ps-missing-image\">{}</span>", escape_text(alt))),
    }
}

/// Writes one ProseMirror node of a cell as the page's HTML.
pub(crate) fn write_node(node: &Value, depth: usize, context: &mut PageContext<'_>, output: &mut String) {
    if depth > MAX_DEPTH {
        return;
    }
    match node.get("type").and_then(Value::as_str).unwrap_or_default() {
        "text" => {
            let text = node.get("text").and_then(Value::as_str).unwrap_or_default();
            let marks = node.get("marks").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
            let tags: Vec<(String, String)> = marks.iter().filter_map(|mark| mark_tags(mark, context)).collect();
            let linked = marks.iter().any(|mark| matches!(mark.get("type").and_then(Value::as_str), Some("link" | "inlineCode")));
            tags.iter().for_each(|(open, _)| output.push_str(open));
            write_text(text, linked, context, output);
            tags.iter().rev().for_each(|(_, close)| output.push_str(close));
        }
        "paragraph" => {
            output.push_str("<p>");
            write_children(node, depth, context, output);
            output.push_str("</p>");
        }
        "heading" => {
            let level = attr(node, "level").and_then(Value::as_u64).unwrap_or(2).clamp(1, 6);
            output.push_str(&format!("<h{level}>"));
            write_children(node, depth, context, output);
            output.push_str(&format!("</h{level}>"));
        }
        "blockquote" => {
            output.push_str("<blockquote>");
            write_children(node, depth, context, output);
            output.push_str("</blockquote>");
        }
        "code_block" => output.push_str(&code::code_block(code::fence_language(attr_str(node, "language")), &plain_text(node), context.code_view)),
        "bullet_list" => {
            output.push_str("<ul>");
            write_children(node, depth, context, output);
            output.push_str("</ul>");
        }
        "ordered_list" => {
            match attr(node, "order").and_then(Value::as_u64).filter(|start| *start != 1) {
                Some(start) => output.push_str(&format!("<ol start=\"{start}\">")),
                None => output.push_str("<ol>"),
            }
            write_children(node, depth, context, output);
            output.push_str("</ol>");
        }
        "list_item" => {
            output.push_str("<li>");
            let items = children(node);
            match (attr(node, "checked").and_then(Value::as_bool), items.first()) {
                // The box goes on the item's first line, as in the editor.
                (Some(checked), Some(first)) if first.get("type").and_then(Value::as_str) == Some("paragraph") => {
                    output.push_str("<p>");
                    output.push_str(&code::task_marker(checked));
                    write_children(first, depth + 1, context, output);
                    output.push_str("</p>");
                    for item in &items[1..] {
                        write_node(item, depth + 1, context, output);
                    }
                }
                (checked, _) => {
                    if let Some(checked) = checked {
                        output.push_str(&code::task_marker(checked));
                    }
                    write_children(node, depth, context, output);
                }
            }
            output.push_str("</li>");
        }
        "hr" => output.push_str("<hr>"),
        "hardbreak" => output.push_str("<br>"),
        "image" => write_image(attr_str(node, "src"), attr_str(node, "alt"), attr_str(node, "title"), context, output),
        "image-block" => write_image(attr_str(node, "src"), attr_str(node, "caption"), "", context, output),
        "math_inline" => output.push_str(&format!("<span class=\"ps-math\">{}</span>", escape_text(attr_str(node, "value")))),
        "html" => {
            let resolve = |href: &str, image: bool| context.resolve_href(href, image);
            output.push_str(&super::sanitize::sanitize_html(attr_str(node, "value"), &resolve));
        }
        _ => write_children(node, depth, context, output),
    }
}
