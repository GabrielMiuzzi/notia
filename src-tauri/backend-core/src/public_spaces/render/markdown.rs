//! Markdown of a note as HTML for a public page: CommonMark with tables,
//! task lists, strikethrough, footnotes, math and wikilinks, as the editor
//! reads it. Links and images resolve inside the space, headings get ids for
//! the page outline, fenced blocks go through [`super::code`], blocks kept
//! in table cells through [`super::table_blocks`] and other HTML of the note
//! through [`super::sanitize`].

use std::sync::OnceLock;

use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd};
use regex::Regex;

use super::{escape_attribute, escape_text, PageContext};

fn level_number(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn alignment(value: Alignment) -> &'static str {
    match value {
        Alignment::Left => " data-align=\"left\"",
        Alignment::Center => " data-align=\"center\"",
        Alignment::Right => " data-align=\"right\"",
        Alignment::None => "",
    }
}

struct Heading {
    level: u8,
    start: usize,
    text: String,
    is_title: bool,
}

/// Marks a definition added only so a reference finds it; it is not shown.
const FOOTNOTE_STUB: &str = "\u{E000}notia-footnote-elsewhere";

fn footnote_definition_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?m)^ {0,3}\[\^([^\]\s][^\]]*)\]:").expect("footnote definition pattern"))
}

/// Labels of the footnotes `source` defines.
pub(crate) fn footnote_labels(source: &str) -> Vec<String> {
    footnote_definition_pattern().captures_iter(source).map(|found| found[1].to_string()).collect()
}

/// The id of a footnote's definition, from its label.
fn footnote_id(label: &str) -> String {
    label.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c.to_ascii_lowercase() } else { '-' }).collect()
}

struct Image {
    src: String,
    title: String,
    alt: String,
}

/// Writes the HTML of one Markdown chunk of the page into `output`.
pub(crate) fn write_markdown(source: &str, context: &mut PageContext<'_>, output: &mut String) {
    // Definitions in other chunks of the page, so the references here find them.
    let here = footnote_labels(source);
    let elsewhere: Vec<String> = context.footnotes.iter().filter(|label| !here.contains(label)).cloned().collect();
    let mut chunk = source.to_string();
    for label in &elsewhere {
        chunk.push_str(&format!("\n\n[^{label}]: {FOOTNOTE_STUB}\n"));
    }
    let source = chunk.as_str();
    let mut skipping_stub = false;
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_MATH
        | Options::ENABLE_WIKILINKS;
    let mut heading: Option<Heading> = None;
    let mut image: Option<Image> = None;
    let mut code: Option<(String, String)> = None;
    let mut links: Vec<bool> = Vec::new();
    // A wikilink without alias shows its page's title instead of the path.
    let mut link_label: Option<String> = None;
    let mut alignments: Vec<Alignment> = Vec::new();
    let mut cell = 0;
    let mut in_head = false;
    for event in Parser::new_ext(source, options) {
        if skipping_stub {
            skipping_stub = !matches!(event, Event::End(TagEnd::FootnoteDefinition));
            continue;
        }
        if let Event::Start(Tag::FootnoteDefinition(label)) = &event {
            if elsewhere.iter().any(|other| other.as_str() == label.as_ref()) {
                skipping_stub = true;
                continue;
            }
        }
        if let Some(found) = image.as_mut() {
            match event {
                Event::End(TagEnd::Image) => {
                    let found = image.take().expect("image");
                    match context.resolve_href(&found.src, true) {
                        Some(src) => {
                            let title = if found.title.is_empty() { String::new() } else { format!(" title=\"{}\"", escape_attribute(&found.title)) };
                            output.push_str(&format!("<img src=\"{}\" alt=\"{}\"{title} loading=\"lazy\">", escape_attribute(&src), escape_attribute(&found.alt)));
                        }
                        None => output.push_str(&format!("<span class=\"ps-missing-image\">{}</span>", escape_text(&found.alt))),
                    }
                }
                Event::Text(text) | Event::Code(text) => found.alt.push_str(&text),
                _ => {}
            }
            continue;
        }
        if let Some((_, text)) = code.as_mut() {
            match event {
                Event::Text(value) => text.push_str(&value),
                Event::End(TagEnd::CodeBlock) => {
                    let (language, text) = code.take().expect("code");
                    output.push_str(&super::code::code_block(&language, &text, context.code_view));
                }
                _ => {}
            }
            continue;
        }
        if link_label.is_some() {
            match event {
                Event::End(TagEnd::Link) => {
                    output.push_str(&escape_text(&link_label.take().unwrap_or_default()));
                }
                _ => continue,
            }
        }
        let text_sink = |value: &str, heading: &mut Option<Heading>| {
            if let Some(heading) = heading.as_mut() {
                heading.text.push_str(value);
            }
        };
        match event {
            Event::Start(tag) => {
                let block = matches!(
                    tag,
                    Tag::Paragraph | Tag::BlockQuote(_) | Tag::CodeBlock(_) | Tag::List(_) | Tag::Table(_) | Tag::HtmlBlock | Tag::Heading { .. }
                );
                let first_block = block && !context.seen_block;
                if block {
                    context.seen_block = true;
                }
                match tag {
                    Tag::Paragraph => output.push_str("<p>"),
                    Tag::Heading { level, .. } => {
                        let level = level_number(level);
                        heading = Some(Heading { level, start: output.len(), text: String::new(), is_title: first_block && level == 1 && context.strip_title });
                    }
                    Tag::BlockQuote(_) => output.push_str("<blockquote>"),
                    Tag::CodeBlock(kind) => {
                        let language = match kind {
                            CodeBlockKind::Fenced(info) => super::code::fence_language(&info).to_string(),
                            CodeBlockKind::Indented => String::new(),
                        };
                        code = Some((language, String::new()));
                    }
                    Tag::HtmlBlock => {}
                    Tag::List(Some(1)) => output.push_str("<ol>"),
                    Tag::List(Some(start)) => output.push_str(&format!("<ol start=\"{start}\">")),
                    Tag::List(None) => output.push_str("<ul>"),
                    Tag::Item => output.push_str("<li>"),
                    Tag::Table(columns) => {
                        alignments = columns;
                        output.push_str("<div class=\"ps-table\"><table>");
                    }
                    Tag::TableHead => {
                        in_head = true;
                        cell = 0;
                        output.push_str("<thead><tr>");
                    }
                    Tag::TableRow => {
                        cell = 0;
                        output.push_str("<tr>");
                    }
                    Tag::TableCell => {
                        let align = alignments.get(cell).copied().map(alignment).unwrap_or_default();
                        output.push_str(&format!("<{}{align}>", if in_head { "th" } else { "td" }));
                    }
                    Tag::Emphasis => output.push_str("<em>"),
                    Tag::Strong => output.push_str("<strong>"),
                    Tag::Strikethrough => output.push_str("<del>"),
                    Tag::Superscript => output.push_str("<sup>"),
                    Tag::Subscript => output.push_str("<sub>"),
                    Tag::Link { link_type, dest_url, .. } => {
                        let wikilink = matches!(link_type, LinkType::WikiLink { .. });
                        let href = if wikilink { context.resolve_wikilink(&dest_url) } else { context.resolve_href(&dest_url, false) };
                        match href {
                            Some(href) => {
                                let external = if super::links::is_external(&href) { " target=\"_blank\" rel=\"noopener noreferrer\"" } else { "" };
                                output.push_str(&format!("<a href=\"{}\"{external}>", escape_attribute(&href)));
                                links.push(true);
                            }
                            None => {
                                output.push_str("<span class=\"ps-missing-link\">");
                                links.push(false);
                            }
                        }
                        if matches!(link_type, LinkType::WikiLink { has_pothole: false }) {
                            link_label = Some(context.wikilink_label(&dest_url));
                        }
                    }
                    Tag::Image { dest_url, title, .. } => {
                        image = Some(Image { src: dest_url.to_string(), title: title.to_string(), alt: String::new() });
                    }
                    Tag::FootnoteDefinition(label) => output.push_str(&format!(
                        "<div class=\"ps-footnote\" id=\"fn-{}\"><span class=\"ps-footnote-label\">{}</span><div class=\"ps-footnote-body\">",
                        footnote_id(&label),
                        escape_text(&label)
                    )),
                    _ => {}
                }
            }
            Event::End(tag) => match tag {
                TagEnd::Paragraph => output.push_str("</p>\n"),
                TagEnd::Heading(_) => {
                    if let Some(found) = heading.take() {
                        let inner = output.split_off(found.start);
                        if found.is_title {
                            context.title_from_body = Some(found.text.trim().to_string());
                        } else {
                            let id = context.heading_id(&found.text);
                            output.push_str(&format!("<h{level} id=\"{id}\">{inner}</h{level}>\n", level = found.level));
                            context.add_outline(found.level, &id, found.text.trim());
                        }
                    }
                }
                TagEnd::BlockQuote(_) => output.push_str("</blockquote>\n"),
                TagEnd::HtmlBlock => output.push('\n'),
                TagEnd::List(true) => output.push_str("</ol>\n"),
                TagEnd::List(false) => output.push_str("</ul>\n"),
                TagEnd::Item => output.push_str("</li>\n"),
                TagEnd::Table => output.push_str("</tbody></table></div>\n"),
                TagEnd::TableHead => {
                    in_head = false;
                    output.push_str("</tr></thead><tbody>");
                }
                TagEnd::TableRow => output.push_str("</tr>"),
                TagEnd::TableCell => {
                    output.push_str(if in_head { "</th>" } else { "</td>" });
                    cell += 1;
                }
                TagEnd::Emphasis => output.push_str("</em>"),
                TagEnd::Strong => output.push_str("</strong>"),
                TagEnd::Strikethrough => output.push_str("</del>"),
                TagEnd::Superscript => output.push_str("</sup>"),
                TagEnd::Subscript => output.push_str("</sub>"),
                TagEnd::Link => output.push_str(if links.pop().unwrap_or(false) { "</a>" } else { "</span>" }),
                TagEnd::FootnoteDefinition => output.push_str("</div></div>\n"),
                _ => {}
            },
            Event::Text(text) => {
                text_sink(&text, &mut heading);
                output.push_str(&escape_text(&text));
            }
            Event::Code(text) => {
                text_sink(&text, &mut heading);
                output.push_str(&format!("<code>{}</code>", escape_text(&text)));
            }
            Event::InlineMath(tex) => output.push_str(&format!("<span class=\"ps-math\">{}</span>", escape_text(&tex))),
            Event::DisplayMath(tex) => output.push_str(&format!("<div class=\"ps-math ps-math-display\">{}</div>", escape_text(&tex))),
            Event::Html(html) | Event::InlineHtml(html) => match super::table_blocks::marker_node(&html) {
                // A block the editor keeps inside a table cell.
                Some(node) => super::table_blocks::write_node(&node, 0, context, output),
                None => {
                    let resolve = |href: &str, image: bool| context.resolve_href(href, image);
                    output.push_str(&super::sanitize::sanitize_html(&html, &resolve));
                }
            },
            Event::SoftBreak => {
                text_sink(" ", &mut heading);
                output.push('\n');
            }
            Event::HardBreak => output.push_str("<br>"),
            Event::Rule => output.push_str("<hr>\n"),
            Event::TaskListMarker(checked) => output.push_str(&super::code::task_marker(checked)),
            Event::FootnoteReference(label) => {
                let id = footnote_id(&label);
                output.push_str(&format!("<sup class=\"ps-footnote-ref\"><a href=\"#fn-{id}\">{}</a></sup>", escape_text(&label)));
            }
        }
    }
}
