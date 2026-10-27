//! A published note as the HTML of its public page. GitBook blocks
//! (`{% hint %}`, tabs, steps, columns, updates, code frames, prompts,
//! conditions, embeds, files, page cards and includes) become the markup
//! the page styles; the Markdown between them goes through
//! [`markdown::write_markdown`]. Links resolve inside the space.

mod code;
pub mod links;
mod markdown;
mod sanitize;
mod table_blocks;

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::gitbook_blocks::{condition_state, document_title, resolve_reference, ConditionState, Reference, Variables};
use crate::page_links::frontmatter_value;
use crate::prompt::strip_frontmatter;

/// Nested includes a page follows.
const MAX_INCLUDE_DEPTH: usize = 3;

/// The published notes of a space, as a page needs them for its links.
pub trait SpacePages {
    /// The published note at `path` as the space stores it, without
    /// distinguishing case.
    fn page(&self, path: &str) -> Option<String>;
    /// A published note named `name` (without `.md`), the closest to `near`.
    fn page_named(&self, name: &str, near: &str) -> Option<String>;
    fn title(&self, path: &str) -> Option<String>;
    /// A published file (an image) at `path`.
    fn file(&self, path: &str) -> Option<String>;
    /// The content of a published note, for `{% include %}`.
    fn source(&self, path: &str) -> Option<String>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineEntry {
    pub id: String,
    pub text: String,
    pub level: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPage {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub html: String,
    pub outline: Vec<OutlineEntry>,
}

pub(crate) fn escape_text(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub(crate) fn escape_attribute(value: &str) -> String {
    escape_text(value).replace('"', "&quot;")
}

/// What the page being written knows and gathers.
pub(crate) struct PageContext<'a> {
    pages: &'a dyn SpacePages,
    current: String,
    variables: Variables,
    /// The first heading of the page is its title, shown above the body.
    strip_title: bool,
    pub(crate) seen_block: bool,
    pub(crate) title_from_body: Option<String>,
    outline: Vec<OutlineEntry>,
    ids: HashMap<String, usize>,
    /// Includes are written inside the page: their headings stay out of it.
    collect_outline: bool,
    depth: usize,
    /// How the code blocks being written start out (a `{% code %}` frame changes it).
    pub(crate) code_view: code::CodeView,
    /// Footnotes the page defines. GitBook blocks cut the note into Markdown
    /// chunks, and a reference must find its definition in another chunk.
    pub(crate) footnotes: Vec<String>,
}

impl PageContext<'_> {
    /// The URL `href` (of a link or an image of the note) has in the space.
    pub(crate) fn resolve_href(&self, href: &str, image: bool) -> Option<String> {
        let href = href.trim();
        if href.is_empty() || links::is_foreign_scheme(href) {
            return None;
        }
        if href.starts_with('#') {
            return Some(href.to_string());
        }
        if links::is_external(href) {
            return Some(href.to_string());
        }
        let (path, fragment) = links::resolve_relative(&self.current, href)?;
        if image {
            return self.pages.file(&path).map(|file| links::file_url(&file));
        }
        let fragment = fragment.map(|fragment| format!("#{fragment}")).unwrap_or_default();
        if let Some(page) = self.pages.page(&path).or_else(|| self.pages.page(&format!("{path}.md"))) {
            return Some(format!("{}{fragment}", links::page_url(&page)));
        }
        self.pages.file(&path).map(|file| links::file_url(&file))
    }

    fn wikilink_page(&self, target: &str) -> Option<(String, Option<String>)> {
        let (target, fragment) = match target.split_once('#') {
            Some((target, fragment)) => (target.trim(), Some(fragment.to_string()).filter(|fragment| !fragment.is_empty())),
            None => (target.trim(), None),
        };
        if target.is_empty() {
            return None;
        }
        let with_md = if target.to_lowercase().ends_with(".md") { target.to_string() } else { format!("{target}.md") };
        let relative = match self.current.rsplit_once('/') {
            Some((folder, _)) => format!("{folder}/{with_md}"),
            None => with_md.clone(),
        };
        // With a folder: from the library root, or from the note's folder.
        let page = if target.contains('/') {
            let from_root = with_md.trim_start_matches('/');
            self.pages.page(target.trim_start_matches('/')).or_else(|| self.pages.page(from_root)).or_else(|| self.pages.page(&relative))
        } else {
            self.pages.page(&relative).or_else(|| self.pages.page_named(with_md.trim_end_matches(".md"), &self.current))
        };
        page.map(|page| (page, fragment))
    }

    /// The URL of `[[target]]`, when it names a published page.
    pub(crate) fn resolve_wikilink(&self, target: &str) -> Option<String> {
        let (page, fragment) = self.wikilink_page(target)?;
        Some(format!("{}{}", links::page_url(&page), fragment.map(|fragment| format!("#{fragment}")).unwrap_or_default()))
    }

    /// What `[[target]]` without alias shows: the page title or its name.
    pub(crate) fn wikilink_label(&self, target: &str) -> String {
        self.wikilink_page(target)
            .and_then(|(page, _)| self.pages.title(&page))
            .unwrap_or_else(|| target.rsplit('/').next().unwrap_or(target).trim_end_matches(".md").to_string())
    }

    /// A unique id for a heading, from its text.
    pub(crate) fn heading_id(&mut self, text: &str) -> String {
        let slug = super::index::slug(text);
        let slug = if slug.is_empty() { "seccion".to_string() } else { slug };
        let count = self.ids.entry(slug.clone()).or_insert(0);
        *count += 1;
        if *count == 1 { slug } else { format!("{slug}-{count}") }
    }

    pub(crate) fn add_outline(&mut self, level: u8, id: &str, text: &str) {
        if self.collect_outline && (level == 2 || level == 3) && !text.is_empty() {
            self.outline.push(OutlineEntry { id: id.to_string(), text: text.to_string(), level });
        }
    }
}

/// A piece of the body: Markdown, or a GitBook block with its content.
#[derive(Debug, Clone, PartialEq)]
enum Node {
    Markdown(String),
    Block { name: String, attributes: BTreeMap<String, String>, arguments: String, children: Vec<Node> },
}

const CONTAINERS: &[&str] = &["hint", "tabs", "tab", "stepper", "step", "columns", "column", "updates", "update", "code", "prompt", "if"];
const CAPTIONED: &[&str] = &["embed", "file", "content-ref"];

fn tag_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\{%-?\s*([a-zA-Z][a-zA-Z-]*)([\s\S]*?)-?%\}").expect("tag pattern"))
}

fn attribute_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r#"([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).expect("attribute pattern"))
}

fn fence_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^\s{0,3}(`{3,}|~{3,})").expect("fence pattern"))
}

fn read_attributes(arguments: &str) -> BTreeMap<String, String> {
    attribute_pattern()
        .captures_iter(arguments)
        .map(|captures| {
            let value = captures.get(2).or_else(|| captures.get(3)).map_or("", |value| value.as_str());
            (captures[1].to_ascii_lowercase(), value.replace("&quot;", "\""))
        })
        .collect()
}

struct Frame {
    name: String,
    attributes: BTreeMap<String, String>,
    arguments: String,
    children: Vec<Node>,
}

fn push_markdown(children: &mut Vec<Node>, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(Node::Markdown(previous)) = children.last_mut() {
        previous.push_str(text);
    } else {
        children.push(Node::Markdown(text.to_string()));
    }
}

/// Closes the top frame into its parent. An embed, file or page card left
/// open was a single tag: what followed it is not its caption.
fn close_frame(stack: &mut Vec<Frame>, explicit: bool) {
    let frame = stack.pop().expect("frame");
    let parent = &mut stack.last_mut().expect("root").children;
    let captioned = CAPTIONED.contains(&frame.name.as_str());
    if captioned && !explicit {
        parent.push(Node::Block { name: frame.name, attributes: frame.attributes, arguments: frame.arguments, children: Vec::new() });
        for child in frame.children {
            match child {
                Node::Markdown(text) => push_markdown(parent, &text),
                block => parent.push(block),
            }
        }
    } else {
        parent.push(Node::Block { name: frame.name, attributes: frame.attributes, arguments: frame.arguments, children: frame.children });
    }
}

/// The body split into Markdown and GitBook blocks. Tags inside fenced code
/// and unknown or unbalanced tags stay as text.
fn parse_blocks(body: &str) -> Vec<Node> {
    let mut stack = vec![Frame { name: String::new(), attributes: BTreeMap::new(), arguments: String::new(), children: Vec::new() }];
    let mut fence: Option<String> = None;
    for line in body.split_inclusive('\n') {
        if let Some(open) = &fence {
            push_markdown(&mut stack.last_mut().expect("frame").children, line);
            if line.trim_start().starts_with(open.as_str()) && line.trim().chars().all(|character| character == open.chars().next().unwrap_or('`')) {
                fence = None;
            }
            continue;
        }
        if let Some(found) = fence_pattern().captures(line) {
            fence = Some(found[1].to_string());
            push_markdown(&mut stack.last_mut().expect("frame").children, line);
            continue;
        }
        let mut position = 0;
        for found in tag_pattern().captures_iter(line) {
            let whole = found.get(0).expect("tag");
            let name = found[1].to_ascii_lowercase();
            let arguments = found[2].trim().to_string();
            let before = &line[position..whole.start()];
            let known = CONTAINERS.contains(&name.as_str()) || CAPTIONED.contains(&name.as_str()) || name == "include";
            let closing = name.strip_prefix("end").filter(|inner| CONTAINERS.contains(inner) || CAPTIONED.contains(inner));
            let open_at = closing.and_then(|inner| stack.iter().rposition(|frame| frame.name == inner && !frame.name.is_empty()));
            if !known && open_at.is_none() {
                continue; // Left as text with what surrounds it.
            }
            push_markdown(&mut stack.last_mut().expect("frame").children, before);
            position = whole.end();
            if let Some(open_at) = open_at {
                while stack.len() > open_at + 1 {
                    close_frame(&mut stack, false);
                }
                close_frame(&mut stack, true);
            } else if name == "include" {
                stack.last_mut().expect("frame").children.push(Node::Block {
                    name,
                    attributes: BTreeMap::new(),
                    arguments,
                    children: Vec::new(),
                });
            } else {
                stack.push(Frame { attributes: read_attributes(&arguments), name, arguments, children: Vec::new() });
            }
        }
        let rest = &line[position..];
        // A line that only held tags leaves no blank text behind.
        if !(position > 0 && rest.trim().is_empty()) {
            push_markdown(&mut stack.last_mut().expect("frame").children, rest);
        } else {
            push_markdown(&mut stack.last_mut().expect("frame").children, "\n");
        }
    }
    while stack.len() > 1 {
        close_frame(&mut stack, false);
    }
    stack.pop().expect("root").children
}

/// The first quoted text of `arguments` (the reference of an include).
fn first_quoted(arguments: &str) -> Option<String> {
    let start = arguments.find(['"', '\''])?;
    let quote = arguments[start..].chars().next()?;
    let rest = &arguments[start + 1..];
    Some(rest[..rest.find(quote)?].to_string())
}

fn caption_text(children: &[Node]) -> String {
    children
        .iter()
        .filter_map(|child| match child {
            Node::Markdown(text) => Some(text.trim().to_string()),
            Node::Block { .. } => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn write_nodes(nodes: &[Node], context: &mut PageContext<'_>, output: &mut String) {
    for node in nodes {
        match node {
            Node::Markdown(text) => {
                if !text.trim().is_empty() {
                    markdown::write_markdown(text, context, output);
                }
            }
            Node::Block { name, attributes, arguments, children } => write_block(name, attributes, arguments, children, context, output),
        }
    }
}

fn attribute<'a>(attributes: &'a BTreeMap<String, String>, key: &str) -> &'a str {
    attributes.get(key).map(String::as_str).unwrap_or_default()
}

fn children_of<'a>(children: &'a [Node], name: &'a str) -> impl Iterator<Item = (&'a BTreeMap<String, String>, &'a [Node])> {
    children.iter().filter_map(move |child| match child {
        Node::Block { name: child_name, attributes, children, .. } if child_name == name => Some((attributes, children.as_slice())),
        _ => None,
    })
}

fn write_block(name: &str, attributes: &BTreeMap<String, String>, arguments: &str, children: &[Node], context: &mut PageContext<'_>, output: &mut String) {
    context.seen_block = true;
    match name {
        "hint" => {
            let style = match attribute(attributes, "style") {
                style @ ("success" | "warning" | "danger") => style,
                _ => "info",
            };
            output.push_str(&format!("<div class=\"ps-hint ps-hint-{style}\" role=\"note\"><div class=\"ps-hint-body\">"));
            write_nodes(children, context, output);
            output.push_str("</div></div>\n");
        }
        "tabs" => {
            let tabs: Vec<_> = children_of(children, "tab").collect();
            output.push_str("<div class=\"ps-tabs\"><div class=\"ps-tabs-list\" role=\"tablist\">");
            for (index, (tab, _)) in tabs.iter().enumerate() {
                let title = attribute(tab, "title");
                let title = if title.is_empty() { format!("Pestaña {}", index + 1) } else { title.to_string() };
                output.push_str(&format!(
                    "<button type=\"button\" role=\"tab\" class=\"ps-tab\" data-tab=\"{index}\" aria-selected=\"{}\">{}</button>",
                    index == 0,
                    escape_text(&title)
                ));
            }
            output.push_str("</div>");
            for (index, (_, content)) in tabs.iter().enumerate() {
                let hidden = if index == 0 { "" } else { " hidden" };
                output.push_str(&format!("<div class=\"ps-tab-panel\" role=\"tabpanel\" data-tab=\"{index}\"{hidden}>"));
                write_nodes(content, context, output);
                output.push_str("</div>");
            }
            output.push_str("</div>\n");
        }
        "stepper" => {
            output.push_str("<ol class=\"ps-stepper\">");
            for (_, content) in children_of(children, "step") {
                output.push_str("<li class=\"ps-step\"><div class=\"ps-step-body\">");
                write_nodes(content, context, output);
                output.push_str("</div></li>");
            }
            output.push_str("</ol>\n");
        }
        "columns" => {
            output.push_str("<div class=\"ps-columns\">");
            for (_, content) in children_of(children, "column").take(2) {
                output.push_str("<div class=\"ps-column\">");
                write_nodes(content, context, output);
                output.push_str("</div>");
            }
            output.push_str("</div>\n");
        }
        "updates" => {
            output.push_str("<div class=\"ps-updates\">");
            for (update, content) in children_of(children, "update") {
                output.push_str("<section class=\"ps-update\"><header class=\"ps-update-head\">");
                let date = attribute(update, "date");
                if !date.is_empty() {
                    output.push_str(&format!("<time>{}</time>", escape_text(date)));
                }
                for tag in attribute(update, "tags").split(',').map(str::trim).filter(|tag| !tag.is_empty()) {
                    output.push_str(&format!("<span class=\"ps-update-tag\">{}</span>", escape_text(tag)));
                }
                output.push_str("</header>");
                write_nodes(content, context, output);
                output.push_str("</section>");
            }
            output.push_str("</div>\n");
        }
        "code" => {
            output.push_str("<figure class=\"ps-code-frame\">");
            let title = attribute(attributes, "title");
            if !title.is_empty() {
                output.push_str(&format!("<figcaption>{}</figcaption>", escape_text(title)));
            }
            // The frame's options are how its code block starts; the reader can change them.
            let outer = context.code_view;
            context.code_view = code::CodeView {
                numbers: attribute(attributes, "linenumbers") != "false",
                wrap: attribute(attributes, "overflow") == "wrap",
            };
            write_nodes(children, context, output);
            context.code_view = outer;
            output.push_str("</figure>\n");
        }
        "prompt" => {
            output.push_str("<div class=\"ps-prompt\">");
            let description = attribute(attributes, "description");
            if !description.is_empty() {
                output.push_str(&format!("<div class=\"ps-prompt-description\">{}</div>", escape_text(description)));
            }
            output.push_str("<div class=\"ps-prompt-body\">");
            write_nodes(children, context, output);
            output.push_str("</div></div>\n");
        }
        "if" => {
            if condition_state(arguments, &context.variables) == ConditionState::Satisfied {
                write_nodes(children, context, output);
            }
        }
        "embed" => {
            let url = attribute(attributes, "url");
            let Some(href) = context.resolve_href(url, false) else { return };
            let caption = caption_text(children);
            output.push_str(&format!("<a class=\"ps-embed\" href=\"{}\"", escape_attribute(&href)));
            if links::is_external(&href) {
                output.push_str(" target=\"_blank\" rel=\"noopener noreferrer\"");
            }
            output.push_str(&format!("><span class=\"ps-embed-url\">{}</span>", escape_text(url)));
            if !caption.is_empty() {
                output.push_str(&format!("<span class=\"ps-embed-caption\">{}</span>", escape_text(&caption)));
            }
            output.push_str("</a>\n");
        }
        "file" => {
            let src = attribute(attributes, "src");
            let href = links::resolve_relative(&context.current, src).and_then(|(path, _)| context.pages.file(&path)).map(|file| links::file_url(&file));
            let Some(href) = href.or_else(|| links::is_external(src).then(|| src.to_string())) else { return };
            let caption = caption_text(children);
            let name = if caption.is_empty() { src.rsplit('/').next().unwrap_or(src).to_string() } else { caption };
            output.push_str(&format!("<a class=\"ps-file\" href=\"{}\" download>{}</a>\n", escape_attribute(&href), escape_text(&name)));
        }
        "content-ref" => {
            let url = attribute(attributes, "url");
            let page = links::resolve_relative(&context.current, url)
                .and_then(|(path, _)| context.pages.page(&path).or_else(|| context.pages.page(&format!("{}/README.md", path.trim_end_matches('/')))));
            let Some(page) = page else { return };
            let title = context.pages.title(&page).unwrap_or_else(|| caption_text(children));
            output.push_str(&format!(
                "<a class=\"ps-content-ref\" href=\"{}\"><span class=\"ps-content-ref-title\">{}</span></a>\n",
                escape_attribute(&links::page_url(&page)),
                escape_text(&title)
            ));
        }
        "include" => {
            if context.depth >= MAX_INCLUDE_DEPTH {
                return;
            }
            let Some(reference) = first_quoted(arguments) else { return };
            let Reference::Library(path) = resolve_reference(&reference, &context.current) else { return };
            let Some(page) = context.pages.page(&path) else { return };
            let Some(source) = context.pages.source(&page) else { return };
            let nodes = parse_blocks(strip_frontmatter(&source));
            let mut nested = PageContext {
                pages: context.pages,
                current: page,
                variables: Variables::read(&source, None),
                strip_title: false,
                seen_block: true,
                title_from_body: None,
                outline: Vec::new(),
                ids: std::mem::take(&mut context.ids),
                collect_outline: false,
                depth: context.depth + 1,
                code_view: context.code_view,
                footnotes: markdown::footnote_labels(&source),
            };
            output.push_str("<div class=\"ps-include\">");
            write_nodes(&nodes, &mut nested, output);
            output.push_str("</div>\n");
            context.ids = nested.ids;
        }
        _ => write_nodes(children, context, output),
    }
}

/// The public page of the note at `path` with content `source`.
pub fn render_page(source: &str, path: &str, pages: &dyn SpacePages) -> RenderedPage {
    let nodes = parse_blocks(strip_frontmatter(source));
    let mut context = PageContext {
        pages,
        current: path.to_string(),
        variables: Variables::read(source, None),
        strip_title: true,
        seen_block: false,
        title_from_body: None,
        outline: Vec::new(),
        ids: HashMap::new(),
        collect_outline: true,
        depth: 0,
        code_view: code::CodeView::default(),
        footnotes: markdown::footnote_labels(source),
    };
    let mut html = String::new();
    write_nodes(&nodes, &mut context, &mut html);
    let title = frontmatter_value(source, "title")
        .filter(|title| !title.trim().is_empty())
        .or(context.title_from_body.take().filter(|title| !title.is_empty()))
        .unwrap_or_else(|| document_title(source, path));
    RenderedPage {
        title,
        description: frontmatter_value(source, "description").map(|value| value.trim().to_string()).filter(|value| !value.is_empty()),
        html,
        outline: context.outline,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Pages;

    impl SpacePages for Pages {
        fn page(&self, path: &str) -> Option<String> {
            ["Docs/uno.md", "Docs/dos.md", "Docs/guia/tres.md", "Docs/parte.md"].iter().find(|page| page.eq_ignore_ascii_case(path)).map(|page| page.to_string())
        }
        fn page_named(&self, name: &str, _near: &str) -> Option<String> {
            (name == "tres").then(|| "Docs/guia/tres.md".to_string())
        }
        fn title(&self, path: &str) -> Option<String> {
            Some(match path {
                "Docs/dos.md" => "Segunda página",
                "Docs/guia/tres.md" => "Tercera",
                _ => "Otra",
            }
            .to_string())
        }
        fn file(&self, path: &str) -> Option<String> {
            (path == "Docs/img/foto.png").then(|| path.to_string())
        }
        fn source(&self, path: &str) -> Option<String> {
            (path == "Docs/parte.md").then(|| "---\ncontexto: \"#Publico\"\n---\n## Reusado\nTexto común.\n".to_string())
        }
    }

    fn render(body: &str) -> RenderedPage {
        render_page(&format!("---\ncontexto: \"#Publico\"\n---\n{body}"), "Docs/uno.md", &Pages)
    }

    #[test]
    fn the_first_heading_is_the_title_and_the_others_make_the_outline() {
        let page = render("# Bienvenida\n\nIntro.\n\n## Instalación\n\n### Paso a paso\n\n## Instalación\n");
        assert_eq!(page.title, "Bienvenida");
        assert!(!page.html.contains("<h1"));
        assert!(page.html.contains("<h2 id=\"instalacion\">Instalación</h2>"));
        assert!(page.html.contains("<h2 id=\"instalacion-2\">"));
        assert_eq!(
            page.outline.iter().map(|entry| (entry.id.as_str(), entry.level)).collect::<Vec<_>>(),
            vec![("instalacion", 2), ("paso-a-paso", 3), ("instalacion-2", 2)]
        );
    }

    #[test]
    fn hints_tabs_and_steps_become_their_blocks() {
        let page = render("{% hint style=\"warning\" %}\nCuidado con **esto**.\n{% endhint %}\n\n{% tabs %}\n{% tab title=\"C\" %}\nUno\n{% endtab %}\n{% tab title=\"Go\" %}\nDos\n{% endtab %}\n{% endtabs %}\n\n{% stepper %}\n{% step %}\nPrimero\n{% endstep %}\n{% endstepper %}\n");
        assert!(page.html.contains("<div class=\"ps-hint ps-hint-warning\" role=\"note\"><div class=\"ps-hint-body\"><p>Cuidado con <strong>esto</strong>.</p>"));
        assert!(page.html.contains("aria-selected=\"true\">C</button><button type=\"button\" role=\"tab\" class=\"ps-tab\" data-tab=\"1\" aria-selected=\"false\">Go</button>"));
        assert!(page.html.contains("<div class=\"ps-tab-panel\" role=\"tabpanel\" data-tab=\"1\" hidden><p>Dos</p>"));
        assert!(page.html.contains("<ol class=\"ps-stepper\"><li class=\"ps-step\"><div class=\"ps-step-body\"><p>Primero</p>"));
    }

    #[test]
    fn tags_inside_code_and_unknown_tags_stay_as_text() {
        let page = render("```c\n{% hint %}\n#include <stdio.h>\n```\n\n{% raw %} y {% endhint %}\n");
        assert!(page.html.contains("<pre class=\"ps-code\" data-lang=\"c\"><code class=\"language-c\"><span class=\"ps-line\">{% hint %}</span><span class=\"ps-line\">#include &lt;stdio.h&gt;</span></code></pre>"));
        assert!(page.html.contains("{% raw %} y {% endhint %}"));
        assert!(!page.html.contains("ps-hint"));
    }

    #[test]
    fn links_point_to_published_pages_only() {
        let page = render("[dos](dos.md) [[guia/tres]] [[tres]] [[Docs/dos|Alias]] [privada](secreta.md) ![foto](img/foto.png) [web](https://gitbook.com) [x](javascript:alert(1))\n");
        assert!(page.html.contains("<a href=\"/Docs/dos\">dos</a>"));
        assert!(page.html.contains("<a href=\"/Docs/guia/tres\">Tercera</a> <a href=\"/Docs/guia/tres\">Tercera</a>"));
        assert!(page.html.contains("<a href=\"/Docs/dos\">Alias</a>"));
        assert!(page.html.contains("<span class=\"ps-missing-link\">privada</span>"));
        assert!(page.html.contains("<img src=\"/files/Docs/img/foto.png\" alt=\"foto\" loading=\"lazy\">"));
        assert!(page.html.contains("<a href=\"https://gitbook.com\" target=\"_blank\" rel=\"noopener noreferrer\">web</a>"));
        assert!(page.html.contains("<span class=\"ps-missing-link\">x</span>"));
    }

    #[test]
    fn page_cards_embeds_includes_and_raw_html() {
        let page = render(
            "{% content-ref url=\"dos.md\" %}\n[dos.md](dos.md)\n{% endcontent-ref %}\n\n{% embed url=\"https://youtu.be/x\" %}\n\n{% include \"parte.md\" %}\n\n<table><tr><td onclick=\"x\">celda</td></tr></table>\n\n<script>alert(1)</script>\n",
        );
        assert!(page.html.contains("<a class=\"ps-content-ref\" href=\"/Docs/dos\"><span class=\"ps-content-ref-title\">Segunda página</span></a>"));
        assert!(page.html.contains("<a class=\"ps-embed\" href=\"https://youtu.be/x\" target=\"_blank\" rel=\"noopener noreferrer\"><span class=\"ps-embed-url\">https://youtu.be/x</span></a>"));
        assert!(page.html.contains("<div class=\"ps-include\"><h2 id=\"reusado\">Reusado</h2>\n<p>Texto común.</p>"));
        assert!(page.html.contains("<table><tr><td>celda</td></tr></table>"));
        assert!(!page.html.contains("script"));
        assert!(page.outline.is_empty());
    }

    #[test]
    fn math_mermaid_tables_and_conditions() {
        let page = render("$a^2$\n\n$$\nx\n$$\n\n```mermaid\ngraph TD\n```\n\n| A | B |\n|:-:|--|\n| 1 | 2 |\n\n{% if 1 == 1 %}\nSí\n{% endif %}\n{% if 1 == 2 %}\nNo\n{% endif %}\n");
        assert!(page.html.contains("<span class=\"ps-math\">a^2</span>"));
        assert!(page.html.contains("<div class=\"ps-math ps-math-display\">"));
        assert!(page.html.contains("<pre class=\"ps-mermaid\">graph TD\n</pre>"));
        assert!(page.html.contains("<th data-align=\"center\">A</th>"));
        assert!(page.html.contains("<p>Sí</p>"));
        assert!(!page.html.contains("No</p>"));
    }

    /// What `encodeURIComponent` does to the JSON the editor writes.
    fn table_block_marker(json: &str) -> String {
        let encoded: String = json
            .bytes()
            .map(|byte| if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) { (byte as char).to_string() } else { format!("%{byte:02X}") })
            .collect();
        format!("<!--notia-table-block:{encoded}-->")
    }

    #[test]
    fn code_blocks_carry_the_editor_frame_and_latex_fences_are_formulas() {
        let page = render("```c
int x;
```

```latex
\\frac{a}{b}\n```\n");
        assert!(page.html.contains("<div class=\"ps-code-block\" data-numbers=\"true\" data-wrap=\"false\"><div class=\"ps-code-head\"><span class=\"ps-code-lang\">c</span>"));
        assert!(page.html.contains("<span class=\"ps-line\">int x;</span>"));
        assert!(page.html.contains("<div class=\"ps-math ps-math-display\">\\frac{a}{b}</div>"));
    }

    #[test]
    fn a_code_frame_sets_how_its_block_starts() {
        let page = render("{% code title=\"main.c\" overflow=\"wrap\" lineNumbers=\"false\" %}\n```c\nint x;\n```\n{% endcode %}\n\n```c\nint y;\n```\n");
        assert!(page.html.contains("<figure class=\"ps-code-frame\"><figcaption>main.c</figcaption><div class=\"ps-code-block\" data-numbers=\"false\" data-wrap=\"true\">"));
        // The next block, outside the frame, starts as the editor's do.
        assert_eq!(page.html.matches("data-numbers=\"true\" data-wrap=\"false\"").count(), 1);
    }

    #[test]
    fn a_footnote_reference_finds_its_definition_after_a_gitbook_block() {
        let page = render("Texto[^a].\n\n{% hint style=\"info\" %}\nAviso\n{% endhint %}\n\n[^a]: Definida al final.\n");
        assert!(page.html.contains("<sup class=\"ps-footnote-ref\"><a href=\"#fn-a\">a</a></sup>"));
        assert_eq!(page.html.matches("class=\"ps-footnote\"").count(), 1);
        assert!(page.html.contains("<p>Definida al final.</p>"));
    }

    #[test]
    fn tasks_and_footnotes_read_as_in_the_editor() {
        let page = render("- [x] Hecha\n- [ ] Pendiente\n\nTexto[^nota 1].\n\n[^nota 1]: La nota.\n");
        assert!(page.html.contains("<li><span class=\"ps-task\" data-checked=\"true\" role=\"img\" aria-label=\"Tarea hecha\">"));
        assert!(page.html.contains("data-checked=\"false\" role=\"img\" aria-label=\"Tarea pendiente\">"));
        assert!(page.html.contains("<sup class=\"ps-footnote-ref\"><a href=\"#fn-nota-1\">nota 1</a></sup>"));
        assert!(page.html.contains("<div class=\"ps-footnote\" id=\"fn-nota-1\"><span class=\"ps-footnote-label\">nota 1</span><div class=\"ps-footnote-body\"><p>La nota.</p>"));
    }

    #[test]
    fn blocks_kept_in_table_cells_are_shown() {
        let list = table_block_marker(r#"{"type":"bullet_list","content":[{"type":"list_item","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"Ver ","marks":[{"type":"strong"},{"type":"notia_text_color","attrs":{"color":"teal"}}]},{"type":"text","text":"[[dos]] <b>"}]}]}]}"#);
        let code = table_block_marker(r#"{"type":"code_block","attrs":{"language":"c"},"content":[{"type":"text","text":"int a;\nint b;"}]}"#);
        let page = render(&format!("| A | B |\n|--|--|\n| {list} | {code} |\n| <!--notia-table-block:%ZZ--> | <!-- nota --> |\n"));
        assert!(page.html.contains("<td><ul><li><p><span class=\"ps-task\" data-checked=\"true\""));
        assert!(page.html.contains("</svg></span><strong><span data-color=\"teal\">Ver </span></strong><a href=\"/Docs/dos\">Segunda página</a> &lt;b&gt;</p></li></ul>"));
        assert!(page.html.contains("<span class=\"ps-line\">int a;</span><span class=\"ps-line\">int b;</span>"));
        // A broken marker and other comments show nothing.
        assert!(!page.html.contains("notia-table-block") && !page.html.contains("nota -->"));
    }
}
