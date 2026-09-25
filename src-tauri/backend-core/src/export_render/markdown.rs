//! Markdown to the export model. The caller removes the properties first.
//! The HTML the editor writes for formats Markdown lacks (`<u>`,
//! `<span data-color>`, `<mark data-color>` and `<div align>`) becomes style,
//! and `$…$` / `$$…$$` become formulas.

use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd};

use super::document::{Align, Block, Color, Document, Inline, List, ListItem, Table, TextStyle};

/// Containers nested deeper than this are flattened into their parent, so
/// hostile nesting cannot exhaust the stack of the writers.
const MAX_DEPTH: usize = 24;

pub(crate) fn parse_markdown(body: &str) -> Document {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_MATH
        | Options::ENABLE_WIKILINKS;
    let mut reader = Reader {
        events: Parser::new_ext(body, options).collect(),
        index: 0,
        layers: Vec::new(),
        align: Align::Left,
        task: None,
    };
    let mut blocks = reader.blocks(0);
    // Stray closing tags stop `blocks` early; read on so nothing is lost.
    while reader.index < reader.events.len() {
        reader.index += 1;
        blocks.extend(reader.blocks(0));
    }
    Document { blocks }
}

/// An open inline format, innermost last.
#[derive(Debug, Clone, PartialEq)]
enum Layer {
    Bold,
    Italic,
    Strike,
    Underline,
    /// `<span>`, colored or not, so its `</span>` has something to close.
    Span(Option<Color>),
    Highlight(Color),
    Link(Option<String>),
    /// Formats the export does not show (`<sup>`, Markdown superscript…).
    Plain,
}

/// Paragraph content before display formulas are split out of it.
enum Content {
    Inline(Inline),
    Display(String),
}

struct Reader<'a> {
    events: Vec<Event<'a>>,
    index: usize,
    layers: Vec<Layer>,
    /// Alignment of the `<div align>` wrapper the blocks are in.
    align: Align,
    /// Checkbox of the list item being read.
    task: Option<bool>,
}

impl<'a> Reader<'a> {
    fn peek(&self) -> Option<&Event<'a>> {
        self.events.get(self.index)
    }

    fn advance(&mut self) {
        self.index += 1;
    }

    /// Skips the closing event of the container just read.
    fn close(&mut self) {
        if matches!(self.peek(), Some(Event::End(_))) {
            self.advance();
        }
    }

    fn blocks(&mut self, depth: usize) -> Vec<Block> {
        let mut blocks = Vec::new();
        // Containers opened past `MAX_DEPTH`: their content is read here,
        // without recursing, and their closing events are skipped.
        let mut flattened = 0usize;
        while let Some(event) = self.peek() {
            match event {
                Event::End(_) if flattened > 0 => {
                    flattened -= 1;
                    self.advance();
                }
                Event::End(_) => break,
                Event::Start(Tag::BlockQuote(_) | Tag::List(_) | Tag::Item) if depth >= MAX_DEPTH => {
                    flattened += 1;
                    self.advance();
                }
                Event::Rule => {
                    self.advance();
                    blocks.push(Block::Rule);
                }
                Event::Start(Tag::Paragraph) => {
                    self.advance();
                    let content = self.inlines();
                    self.close();
                    push_paragraph(&mut blocks, content, self.align);
                }
                Event::Start(Tag::Heading { level, .. }) => {
                    let level = heading_level(*level);
                    self.advance();
                    let content = inline_only(self.inlines());
                    self.close();
                    blocks.push(Block::Heading { level, align: self.align, content });
                }
                Event::Start(Tag::BlockQuote(_)) => {
                    self.advance();
                    let inner = self.blocks(depth + 1);
                    self.close();
                    blocks.push(Block::Quote(inner));
                }
                Event::Start(Tag::CodeBlock(kind)) => {
                    let language = match kind {
                        CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or_default().to_ascii_lowercase(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    self.advance();
                    let text = self.literal_text();
                    self.close();
                    let text = text.strip_suffix('\n').unwrap_or(&text).to_string();
                    blocks.push(if language == "math" { Block::Math(text.trim().to_string()) } else { Block::Code { text } });
                }
                Event::Start(Tag::List(start)) => {
                    let start = *start;
                    self.advance();
                    blocks.push(Block::List(self.list(start, depth)));
                }
                Event::Start(Tag::Table(columns)) => {
                    let columns = columns.iter().map(|alignment| table_align(*alignment)).collect();
                    self.advance();
                    blocks.push(Block::Table(self.table(columns)));
                }
                Event::Start(Tag::HtmlBlock) => {
                    self.advance();
                    let html = self.literal_text();
                    self.close();
                    self.html_block(&html);
                }
                Event::Start(Tag::MetadataBlock(_)) => {
                    self.advance();
                    self.literal_text();
                    self.close();
                }
                Event::Start(Tag::Item) => {
                    // An item outside a list cannot happen; keep its text anyway.
                    self.advance();
                    blocks.extend(self.blocks(depth));
                    self.close();
                }
                // Text straight inside a tight list item.
                _ => {
                    let before = self.index;
                    let content = self.inlines();
                    if self.index == before {
                        self.advance();
                    }
                    push_paragraph(&mut blocks, content, self.align);
                }
            }
        }
        blocks
    }

    fn list(&mut self, start: Option<u64>, depth: usize) -> List {
        let mut items = Vec::new();
        while let Some(Event::Start(Tag::Item)) = self.peek() {
            self.advance();
            let outer = self.task.take();
            if let Some(Event::TaskListMarker(checked)) = self.peek() {
                self.task = Some(*checked);
                self.advance();
            }
            let blocks = self.blocks(depth + 1);
            self.close();
            items.push(ListItem { task: self.task.take(), blocks });
            self.task = outer;
        }
        self.close();
        List { start, items }
    }

    fn table(&mut self, columns: Vec<Align>) -> Table {
        let mut header = Vec::new();
        let mut rows = Vec::new();
        while let Some(event) = self.peek() {
            match event {
                Event::Start(Tag::TableHead) => {
                    self.advance();
                    header = self.table_cells();
                    self.close();
                }
                Event::Start(Tag::TableRow) => {
                    self.advance();
                    rows.push(self.table_cells());
                    self.close();
                }
                Event::End(TagEnd::Table) => {
                    self.advance();
                    break;
                }
                _ => self.advance(),
            }
        }
        Table { columns, header, rows }
    }

    fn table_cells(&mut self) -> Vec<Vec<Inline>> {
        let mut cells = Vec::new();
        while let Some(Event::Start(Tag::TableCell)) = self.peek() {
            self.advance();
            cells.push(inline_only(self.inlines()));
            self.close();
        }
        cells
    }

    /// Text of a code or HTML block, up to its closing event.
    fn literal_text(&mut self) -> String {
        let mut text = String::new();
        while let Some(event) = self.peek() {
            match event {
                Event::Text(value) | Event::Html(value) | Event::Code(value) => text.push_str(value),
                Event::End(_) => break,
                _ => {}
            }
            self.advance();
        }
        text
    }

    /// `<div align>` wrappers the editor writes around centred or right-aligned blocks.
    fn html_block(&mut self, html: &str) {
        let tag = html.trim();
        if tag.eq_ignore_ascii_case("</div>") {
            self.align = Align::Left;
        } else if let Some(align) = attribute(tag, "div", "align") {
            self.align = match align.as_str() {
                "center" => Align::Center,
                "right" => Align::Right,
                _ => Align::Left,
            };
        }
    }

    fn inlines(&mut self) -> Vec<Content> {
        let mut content = Vec::new();
        while let Some(event) = self.peek() {
            match event {
                Event::Text(text) => {
                    let text = text.to_string();
                    push_text(&mut content, &text, self.style());
                }
                Event::Code(text) => {
                    let text = text.to_string();
                    let style = TextStyle { code: true, ..self.style() };
                    push_text(&mut content, &text, style);
                }
                Event::InlineMath(latex) => content.push(Content::Inline(Inline::Math(latex.trim().to_string()))),
                Event::DisplayMath(latex) => content.push(Content::Display(latex.trim().to_string())),
                Event::SoftBreak => push_text(&mut content, " ", self.style()),
                Event::HardBreak => content.push(Content::Inline(Inline::Break)),
                Event::InlineHtml(html) => {
                    let html = html.to_string();
                    self.inline_html(&html, &mut content);
                }
                Event::FootnoteReference(label) => {
                    let text = format!("[{label}]");
                    push_text(&mut content, &text, self.style());
                }
                Event::TaskListMarker(checked) => self.task = Some(*checked),
                Event::Start(Tag::Emphasis) => self.layers.push(Layer::Italic),
                Event::Start(Tag::Strong) => self.layers.push(Layer::Bold),
                Event::Start(Tag::Strikethrough) => self.layers.push(Layer::Strike),
                Event::Start(Tag::Superscript | Tag::Subscript) => self.layers.push(Layer::Plain),
                Event::Start(Tag::Link { link_type, dest_url, .. }) => {
                    let url = matches!(link_type, LinkType::Inline | LinkType::Reference | LinkType::Collapsed | LinkType::Shortcut | LinkType::Autolink | LinkType::Email)
                        .then(|| web_address(dest_url, *link_type == LinkType::Email))
                        .flatten();
                    self.layers.push(Layer::Link(url));
                }
                Event::Start(Tag::Image { dest_url, .. }) => {
                    let source = dest_url.to_string();
                    self.advance();
                    let mut alt = String::new();
                    while let Some(event) = self.peek() {
                        match event {
                            Event::End(TagEnd::Image) => break,
                            Event::Text(value) | Event::Code(value) => alt.push_str(value),
                            _ => {}
                        }
                        self.advance();
                    }
                    let name = if alt.trim().is_empty() {
                        source.rsplit(['/', '\\']).next().unwrap_or_default().to_string()
                    } else {
                        alt.trim().to_string()
                    };
                    let style = TextStyle { italic: true, color: Some(Color::Gray), ..self.style() };
                    push_text(&mut content, &format!("[Imagen: {name}]"), style);
                }
                Event::End(TagEnd::Emphasis) => self.pop(|layer| *layer == Layer::Italic),
                Event::End(TagEnd::Strong) => self.pop(|layer| *layer == Layer::Bold),
                Event::End(TagEnd::Strikethrough) => self.pop(|layer| *layer == Layer::Strike),
                Event::End(TagEnd::Superscript | TagEnd::Subscript) => self.pop(|layer| *layer == Layer::Plain),
                Event::End(TagEnd::Link) => self.pop(|layer| matches!(layer, Layer::Link(_))),
                // The end of the block, or a block inside a tight list item.
                _ => break,
            }
            self.advance();
        }
        content
    }

    fn inline_html(&mut self, html: &str, content: &mut Vec<Content>) {
        let tag = html.trim().to_ascii_lowercase();
        let name = tag.trim_start_matches(['<', '/']).split(|c: char| !c.is_ascii_alphanumeric()).next().unwrap_or_default().to_string();
        let closing = tag.starts_with("</");
        let layer = match name.as_str() {
            "br" => {
                content.push(Content::Inline(Inline::Break));
                return;
            }
            "u" | "ins" => Layer::Underline,
            "b" | "strong" => Layer::Bold,
            "i" | "em" => Layer::Italic,
            "s" | "del" | "strike" => Layer::Strike,
            "span" => Layer::Span(attribute(html.trim(), "span", "data-color").and_then(|name| Color::from_name(&name))),
            "mark" => Layer::Highlight(
                attribute(html.trim(), "mark", "data-color")
                    .and_then(|name| Color::from_name(&name))
                    .unwrap_or(Color::Yellow),
            ),
            "sub" | "sup" | "kbd" | "small" => Layer::Plain,
            _ => return,
        };
        if closing {
            self.pop(|open| std::mem::discriminant(open) == std::mem::discriminant(&layer));
        } else if !tag.ends_with("/>") {
            self.layers.push(layer);
        }
    }

    /// Closes the innermost open format that `matches`.
    fn pop(&mut self, matches: impl Fn(&Layer) -> bool) {
        if let Some(position) = self.layers.iter().rposition(matches) {
            self.layers.remove(position);
        }
    }

    fn style(&self) -> TextStyle {
        let mut style = TextStyle::default();
        for layer in &self.layers {
            match layer {
                Layer::Bold => style.bold = true,
                Layer::Italic => style.italic = true,
                Layer::Strike => style.strike = true,
                Layer::Underline => style.underline = true,
                Layer::Span(Some(color)) => style.color = Some(*color),
                Layer::Highlight(color) => style.highlight = Some(*color),
                Layer::Link(url) => style.link = url.clone(),
                Layer::Span(None) | Layer::Plain => {}
            }
        }
        style
    }
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn table_align(alignment: Alignment) -> Align {
    match alignment {
        Alignment::Center => Align::Center,
        Alignment::Right => Align::Right,
        Alignment::None | Alignment::Left => Align::Left,
    }
}

/// Addresses a reader of the file can open. Links to other notes are left
/// as plain text: the exported file travels without the library.
fn web_address(url: &str, email: bool) -> Option<String> {
    let url = url.trim();
    if email && !url.contains(':') {
        return Some(format!("mailto:{url}"));
    }
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")).then(|| url.to_string())
}

/// Value of `name="…"` in an opening `<tag …>`.
fn attribute(html: &str, tag: &str, name: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    if !lower.starts_with(&format!("<{tag}")) {
        return None;
    }
    let key = format!("{name}=\"");
    let start = lower.find(&key)? + key.len();
    let end = start + lower[start..].find('"')?;
    Some(lower[start..end].to_string())
}

fn push_text(content: &mut Vec<Content>, text: &str, style: TextStyle) {
    if text.is_empty() {
        return;
    }
    if let Some(Content::Inline(Inline::Text { text: last, style: last_style })) = content.last_mut() {
        if *last_style == style {
            last.push_str(text);
            return;
        }
    }
    content.push(Content::Inline(Inline::Text { text: text.to_string(), style }));
}

/// Display formulas where only inline content fits (headings, cells) stay inline.
fn inline_only(content: Vec<Content>) -> Vec<Inline> {
    content
        .into_iter()
        .map(|piece| match piece {
            Content::Inline(inline) => inline,
            Content::Display(latex) => Inline::Math(latex),
        })
        .collect()
}

/// A paragraph, split around the display formulas it holds.
fn push_paragraph(blocks: &mut Vec<Block>, content: Vec<Content>, align: Align) {
    let mut current = Vec::new();
    let flush = |blocks: &mut Vec<Block>, current: &mut Vec<Inline>| {
        let text = std::mem::take(current);
        let blank = text.iter().all(|inline| match inline {
            Inline::Text { text, .. } => text.trim().is_empty(),
            Inline::Break => true,
            Inline::Math(_) => false,
        });
        if !blank {
            blocks.push(Block::Paragraph { align, content: text });
        }
    };
    for piece in content {
        match piece {
            Content::Inline(inline) => current.push(inline),
            Content::Display(latex) => {
                flush(blocks, &mut current);
                blocks.push(Block::Math(latex));
            }
        }
    }
    flush(blocks, &mut current);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str, style: TextStyle) -> Inline {
        Inline::Text { text: value.to_string(), style }
    }

    fn plain(value: &str) -> Inline {
        text(value, TextStyle::default())
    }

    #[test]
    fn reads_headings_and_inline_formats() {
        let document = parse_markdown("# Título\n\nUno **negrita** y *cursiva* con `x = 1` y ~~no~~.");
        assert_eq!(document.blocks[0], Block::Heading { level: 1, align: Align::Left, content: vec![plain("Título")] });
        let Block::Paragraph { content, .. } = &document.blocks[1] else { panic!("paragraph") };
        assert_eq!(content[1], text("negrita", TextStyle { bold: true, ..TextStyle::default() }));
        assert_eq!(content[3], text("cursiva", TextStyle { italic: true, ..TextStyle::default() }));
        assert_eq!(content[5], text("x = 1", TextStyle { code: true, ..TextStyle::default() }));
        assert_eq!(content[7], text("no", TextStyle { strike: true, ..TextStyle::default() }));
    }

    #[test]
    fn keeps_the_editor_rich_text() {
        let document = parse_markdown(
            "<div align=\"center\">\n\n## Centrado\n\n</div>\n\n<u>sub</u> <span data-color=\"teal\">verde</span> <mark data-color=\"red\">marca</mark><mark>amarillo</mark>",
        );
        assert_eq!(document.blocks[0], Block::Heading { level: 2, align: Align::Center, content: vec![plain("Centrado")] });
        let Block::Paragraph { align, content } = &document.blocks[1] else { panic!("paragraph") };
        assert_eq!(*align, Align::Left);
        assert_eq!(content[0], text("sub", TextStyle { underline: true, ..TextStyle::default() }));
        assert_eq!(content[2], text("verde", TextStyle { color: Some(Color::Teal), ..TextStyle::default() }));
        assert_eq!(content[4], text("marca", TextStyle { highlight: Some(Color::Red), ..TextStyle::default() }));
        assert_eq!(content[5], text("amarillo", TextStyle { highlight: Some(Color::Yellow), ..TextStyle::default() }));
    }

    #[test]
    fn splits_display_formulas_out_of_paragraphs() {
        let document = parse_markdown("Área $A = r^2$ de un círculo.\n\n$$\n\\frac{1}{2}\n$$\n\n```math\nx\n```");
        let Block::Paragraph { content, .. } = &document.blocks[0] else { panic!("paragraph") };
        assert_eq!(content[1], Inline::Math("A = r^2".to_string()));
        assert_eq!(document.blocks[1], Block::Math("\\frac{1}{2}".to_string()));
        assert_eq!(document.blocks[2], Block::Math("x".to_string()));
    }

    #[test]
    fn reads_task_and_nested_lists() {
        let document = parse_markdown("- [x] hecho\n  - hijo\n- [ ] pendiente\n\n3. tres\n4. cuatro");
        let Block::List(list) = &document.blocks[0] else { panic!("list") };
        assert_eq!(list.start, None);
        assert_eq!(list.items[0].task, Some(true));
        assert_eq!(list.items[1].task, Some(false));
        let Block::List(nested) = &list.items[0].blocks[1] else { panic!("nested") };
        assert_eq!(nested.items[0].task, None);
        let Block::List(ordered) = &document.blocks[1] else { panic!("ordered") };
        assert_eq!(ordered.start, Some(3));
        assert_eq!(ordered.items.len(), 2);
    }

    #[test]
    fn reads_tables_code_links_and_images() {
        let document = parse_markdown(
            "| a | b |\n|:-:|--:|\n| 1 | **2** |\n\n```rust\nfn main() {}\n```\n\n[web](https://x.org) [nota](otra.md) [[Wiki|alias]] ![foto](img/gato.png)",
        );
        let Block::Table(table) = &document.blocks[0] else { panic!("table") };
        assert_eq!(table.columns, vec![Align::Center, Align::Right]);
        assert_eq!(table.header[0], vec![plain("a")]);
        assert_eq!(table.rows[0][1], vec![text("2", TextStyle { bold: true, ..TextStyle::default() })]);
        assert_eq!(document.blocks[1], Block::Code { text: "fn main() {}".to_string() });
        let Block::Paragraph { content, .. } = &document.blocks[2] else { panic!("paragraph") };
        assert_eq!(content[0], text("web", TextStyle { link: Some("https://x.org".to_string()), ..TextStyle::default() }));
        assert_eq!(content[1], plain(" nota alias "));
        assert_eq!(content[2], text("[Imagen: foto]", TextStyle { italic: true, color: Some(Color::Gray), ..TextStyle::default() }));
    }

    #[test]
    fn flattens_hostile_nesting() {
        let markdown = format!("{}texto", "> ".repeat(200));
        let document = parse_markdown(&markdown);
        let mut depth = 0;
        let mut blocks = &document.blocks;
        while let Some(Block::Quote(inner)) = blocks.first() {
            depth += 1;
            blocks = inner;
        }
        assert_eq!(depth, MAX_DEPTH);
        assert!(matches!(blocks.first(), Some(Block::Paragraph { .. })));
        // Far deeper nesting must not exhaust the stack either.
        let deep = format!("{}texto", "> ".repeat(100_000));
        assert!(!parse_markdown(&deep).blocks.is_empty());
    }
}
