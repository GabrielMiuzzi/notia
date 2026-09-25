//! Blocks to lines and lines to pages. Every line carries its own
//! decorations (code background, quote bars, list marker), so a page can
//! break between any two lines.

use super::fonts::{text_chain, FontId, Fonts};
use super::math_layout::{MathBox, MathLayout, MATH_SCALE};
use super::{Draw, Glyph};
use crate::export_render::document::{Align, Block, Document, Inline, List, Rgb, Table, TextStyle};
use crate::export_render::math::parse_math;

pub(super) const BODY_SIZE: f32 = 11.0;
const LINE_HEIGHT: f32 = 1.4;
/// Liberation Sans' ascender and descender, in ems.
const ASCENDER: f32 = 0.905;
const DESCENDER: f32 = 0.212;
const PARAGRAPH_GAP: f32 = 7.0;
const ITEM_GAP: f32 = 2.5;
const HEADING_SIZES: [f32; 6] = [22.0, 17.0, 14.0, 12.0, 11.0, 11.0];
/// Space before and after each heading level.
const HEADING_GAPS: [(f32, f32); 6] = [(16.0, 7.0), (14.0, 6.0), (12.0, 5.0), (10.0, 4.0), (10.0, 4.0), (10.0, 4.0)];
const LIST_INDENT: f32 = 20.0;
const QUOTE_INDENT: f32 = 14.0;
const QUOTE_BAR: f32 = 3.0;
const CODE_SIZE: f32 = 9.5;
const CODE_PADDING: f32 = 7.0;
const TABLE_SIZE: f32 = 10.0;
const CELL_PADDING: (f32, f32) = (6.0, 4.0);
const BORDER: f32 = 0.75;
const WHITE: Rgb = Rgb(0xFF, 0xFF, 0xFF);
/// Backgrounds that continue from line to line reach this far into the
/// next one, so viewers leave no hairline seam between them.
const SEAM_OVERLAP: f32 = 0.4;

#[derive(Debug, Clone)]
pub(super) struct Line {
    /// Room above and below the baseline.
    pub ascent: f32,
    pub descent: f32,
    /// Drawn relative to the content's left edge and the line's baseline.
    pub draws: Vec<Draw>,
    /// A heading: it moves to the next page with the line after it.
    pub keep_with_next: bool,
}

impl Line {
    fn empty(height: f32) -> Line {
        Line { ascent: height, descent: 0.0, draws: Vec::new(), keep_with_next: false }
    }

    fn height(&self) -> f32 {
        self.ascent + self.descent
    }
}

#[derive(Debug, Clone)]
pub(super) enum Flow {
    Line(Line),
    /// Vertical space; dropped at the top of a page.
    Gap(f32),
}

/// A line on a page, `top` points below the top of the content area.
#[derive(Debug, Clone)]
pub(super) struct PlacedLine {
    pub top: f32,
    pub line: Line,
}

/// Where blocks go: their left edge, width and the bars of the quotes around them.
#[derive(Debug, Clone)]
struct Frame {
    x: f32,
    width: f32,
    bars: Vec<f32>,
    paragraph_gap: f32,
}

/// Size, weight and color the text of a block starts from.
#[derive(Debug, Clone, Copy)]
struct Base {
    size: f32,
    bold: bool,
    color: Rgb,
}

#[derive(Debug, Clone, PartialEq)]
struct RunStyle {
    font: FontId,
    size: f32,
    color: Rgb,
    underline: bool,
    strike: bool,
    highlight: Option<Rgb>,
    code: bool,
    link: Option<String>,
}

#[derive(Debug, Clone)]
struct Run {
    style: RunStyle,
    glyphs: Vec<(FontId, Glyph)>,
    width: f32,
}

#[derive(Debug, Clone)]
enum Segment {
    Text(Run),
    Math(MathBox),
}

impl Segment {
    fn width(&self) -> f32 {
        match self {
            Segment::Text(run) => run.width,
            Segment::Math(math) => math.width,
        }
    }
}

enum Piece {
    Word(Vec<Segment>),
    Space(RunStyle, f32),
    Break,
}

enum LineItem {
    Segment(Segment),
    Space(RunStyle, f32),
}

pub(super) fn layout_document(fonts: &Fonts, document: &Document, width: f32) -> Vec<Flow> {
    let mut layout = Layout { fonts, flow: Vec::new() };
    let frame = Frame { x: 0.0, width, bars: Vec::new(), paragraph_gap: PARAGRAPH_GAP };
    layout.blocks(&document.blocks, &frame, 0);
    layout.flow
}

/// Lines to pages of `height` points; a heading never ends a page.
pub(super) fn paginate(flow: Vec<Flow>, height: f32) -> Vec<Vec<PlacedLine>> {
    let mut pages: Vec<Vec<PlacedLine>> = vec![Vec::new()];
    let mut cursor = 0.0f32;
    for index in 0..flow.len() {
        match &flow[index] {
            Flow::Gap(gap) => {
                if cursor > 0.0 {
                    cursor += gap;
                }
            }
            Flow::Line(line) => {
                let own = line.height();
                let chain = if line.keep_with_next { kept_height(&flow, index) } else { own };
                let overflows = cursor + own > height + 0.01 || (chain <= height && cursor + chain > height + 0.01);
                if cursor > 0.0 && overflows {
                    pages.push(Vec::new());
                    cursor = 0.0;
                }
                if let Some(page) = pages.last_mut() {
                    page.push(PlacedLine { top: cursor, line: line.clone() });
                }
                cursor += own;
            }
        }
    }
    pages
}

/// Height of a heading with everything that must stay with it: following
/// headings and the first line after them.
fn kept_height(flow: &[Flow], start: usize) -> f32 {
    let mut total = 0.0;
    for item in &flow[start..] {
        match item {
            Flow::Gap(gap) => total += gap,
            Flow::Line(line) => {
                total += line.height();
                if !line.keep_with_next {
                    break;
                }
            }
        }
    }
    total
}

struct Layout<'a> {
    fonts: &'a Fonts,
    flow: Vec<Flow>,
}

impl Layout<'_> {
    fn push_line(&mut self, mut line: Line, frame: &Frame) {
        for draw in &mut line.draws {
            draw.translate(frame.x, 0.0);
        }
        for bar in &frame.bars {
            line.draws.insert(0, Draw::Rect { x: *bar, y: -line.descent - SEAM_OVERLAP, width: QUOTE_BAR, height: line.height() + SEAM_OVERLAP, color: Rgb::HAIRLINE });
        }
        self.flow.push(Flow::Line(line));
    }

    /// Adds space; next to another gap only the larger one counts. Inside a
    /// quote the space is a line, so the bar goes on.
    fn push_gap(&mut self, gap: f32, frame: &Frame) {
        if frame.bars.is_empty() {
            match self.flow.last_mut() {
                Some(Flow::Gap(last)) => *last = last.max(gap),
                _ => self.flow.push(Flow::Gap(gap)),
            }
        } else {
            self.push_line(Line::empty(gap), frame);
        }
    }

    fn blocks(&mut self, blocks: &[Block], frame: &Frame, depth: usize) {
        for block in blocks {
            self.block(block, frame, depth);
        }
    }

    fn block(&mut self, block: &Block, frame: &Frame, depth: usize) {
        match block {
            Block::Heading { level, align, content } => {
                let index = usize::from(level.clamp(&1, &6) - 1);
                let (before, after) = HEADING_GAPS[index];
                let color = if index == 5 { Rgb::MUTED } else { Rgb::TEXT };
                let base = Base { size: HEADING_SIZES[index], bold: true, color };
                self.push_gap(before, frame);
                for mut line in self.paragraph_lines(content, base, frame.width, *align, 1.25) {
                    line.keep_with_next = true;
                    self.push_line(line, frame);
                }
                self.push_gap(after, frame);
            }
            Block::Paragraph { align, content } => {
                let base = Base { size: BODY_SIZE, bold: false, color: Rgb::TEXT };
                for line in self.paragraph_lines(content, base, frame.width, *align, LINE_HEIGHT) {
                    self.push_line(line, frame);
                }
                self.push_gap(frame.paragraph_gap, frame);
            }
            Block::List(list) => self.list(list, frame, depth),
            Block::Quote(blocks) => {
                let mut bars = frame.bars.clone();
                bars.push(frame.x + 1.0);
                let inner = Frame { x: frame.x + QUOTE_INDENT, width: (frame.width - QUOTE_INDENT).max(40.0), bars, ..frame.clone() };
                self.blocks(blocks, &inner, depth);
                // The space after the quote's last block is not part of the quote.
                while let Some(Flow::Line(line)) = self.flow.last() {
                    let spacer = line.descent == 0.0
                        && line.draws.len() == inner.bars.len()
                        && line.draws.iter().all(|draw| matches!(draw, Draw::Rect { color, .. } if *color == Rgb::HAIRLINE));
                    if !spacer {
                        break;
                    }
                    self.flow.pop();
                }
                self.push_gap(frame.paragraph_gap, frame);
            }
            Block::Code { text } => self.code(text, frame),
            Block::Math(latex) => self.display_math(latex, frame),
            Block::Table(table) => self.table(table, frame),
            Block::Rule => {
                let line = Line {
                    ascent: 8.0,
                    descent: 4.0,
                    draws: vec![Draw::Rect { x: 0.0, y: 0.0, width: frame.width, height: BORDER, color: Rgb::HAIRLINE }],
                    keep_with_next: false,
                };
                self.push_line(line, frame);
                self.push_gap(frame.paragraph_gap, frame);
            }
        }
    }

    fn list(&mut self, list: &List, frame: &Frame, depth: usize) {
        let inner = Frame {
            x: frame.x + LIST_INDENT,
            width: (frame.width - LIST_INDENT).max(40.0),
            bars: frame.bars.clone(),
            paragraph_gap: ITEM_GAP,
        };
        for (index, item) in list.items.iter().enumerate() {
            let start = self.flow.len();
            if item.blocks.is_empty() {
                let base = Base { size: BODY_SIZE, bold: false, color: Rgb::TEXT };
                for line in self.paragraph_lines(&[], base, inner.width, Align::Left, LINE_HEIGHT) {
                    self.push_line(line, &inner);
                }
            }
            self.blocks(&item.blocks, &inner, depth + 1);
            let marker = match item.task {
                Some(checked) => checkbox(inner.x, checked),
                None => {
                    let label = match list.start {
                        Some(first) => format!("{}.", first.saturating_add(index as u64)),
                        None => ["•", "◦", "▪"][depth % 3].to_string(),
                    };
                    let (mut draws, width) = self.text_draws(&label, FontId::Sans, BODY_SIZE, Rgb::TEXT);
                    let gap = if list.start.is_some() { 5.0 } else { 7.0 };
                    for draw in &mut draws {
                        draw.translate(inner.x - gap - width, 0.0);
                    }
                    draws
                }
            };
            if let Some(Flow::Line(line)) = self.flow[start..].iter_mut().find(|flow| matches!(flow, Flow::Line(_))) {
                line.draws.extend(marker);
            }
        }
        self.push_gap(frame.paragraph_gap, frame);
    }

    fn code(&mut self, text: &str, frame: &Frame) {
        let background = |line: &mut Line| {
            line.draws.insert(0, Draw::Rect { x: 0.0, y: -line.descent - SEAM_OVERLAP, width: frame.width, height: line.height() + SEAM_OVERLAP, color: Rgb::CODE_BACKGROUND });
        };
        let columns = ((frame.width - 2.0 * CODE_PADDING) / (0.6 * CODE_SIZE)).floor().max(10.0) as usize;
        let (ascent, descent) = metrics(CODE_SIZE, 1.35);
        let mut padding = Line::empty(CODE_PADDING);
        background(&mut padding);
        self.push_line(padding.clone(), frame);
        for source in text.split('\n') {
            let expanded = source.replace('\t', "    ");
            let characters = expanded.chars().filter(|ch| !ch.is_control()).collect::<Vec<_>>();
            let chunks = if characters.is_empty() { vec![&characters[..]] } else { characters.chunks(columns).collect() };
            for chunk in chunks {
                let chunk = chunk.iter().collect::<String>();
                let (mut draws, _) = self.text_draws(&chunk, FontId::Courier, CODE_SIZE, Rgb::TEXT);
                for draw in &mut draws {
                    draw.translate(CODE_PADDING, 0.0);
                }
                let mut line = Line { ascent, descent, draws, keep_with_next: false };
                background(&mut line);
                self.push_line(line, frame);
            }
        }
        self.push_line(padding, frame);
        self.push_gap(frame.paragraph_gap.max(PARAGRAPH_GAP), frame);
    }

    fn display_math(&mut self, latex: &str, frame: &Frame) {
        let nodes = parse_math(latex);
        if nodes.is_empty() {
            return;
        }
        let math = MathLayout { fonts: self.fonts, size: BODY_SIZE * MATH_SCALE, color: Rgb::TEXT }.formula(&nodes, true);
        // A formula wider than the page is scaled down to fit.
        let scale = if math.width > frame.width { frame.width / math.width } else { 1.0 };
        let x = (frame.width - math.width * scale) / 2.0;
        let mut draws = math.draws;
        for draw in &mut draws {
            draw.scale(scale);
            draw.translate(x, 0.0);
        }
        self.push_gap(4.0, frame);
        let line = Line { ascent: math.height * scale + 4.0, descent: math.depth * scale + 4.0, draws, keep_with_next: false };
        self.push_line(line, frame);
        self.push_gap(frame.paragraph_gap.max(PARAGRAPH_GAP), frame);
    }

    fn table(&mut self, table: &Table, frame: &Frame) {
        let count = table.rows.iter().map(Vec::len).chain([table.header.len(), table.columns.len()]).max().unwrap_or(0);
        if count == 0 {
            return;
        }
        let body = Base { size: TABLE_SIZE, bold: false, color: Rgb::TEXT };
        let head = Base { bold: true, ..body };
        let rows = std::iter::once((&table.header, head))
            .filter(|(cells, _)| !cells.is_empty())
            .chain(table.rows.iter().map(|row| (row, body)))
            .collect::<Vec<_>>();

        // Natural (one line) and minimum (longest word) width of each column.
        let mut natural = vec![0.0f32; count];
        let mut minimum = vec![0.0f32; count];
        for (cells, base) in &rows {
            for (index, cell) in cells.iter().enumerate().take(count) {
                let mut line = 0.0f32;
                for piece in self.pieces(cell, *base) {
                    match piece {
                        Piece::Word(segments) => {
                            let width = segments.iter().map(Segment::width).sum::<f32>();
                            minimum[index] = minimum[index].max(width);
                            line += width;
                        }
                        Piece::Space(_, width) => line += width,
                        Piece::Break => line = 0.0,
                    }
                    natural[index] = natural[index].max(line);
                }
            }
        }
        let padding = 2.0 * CELL_PADDING.0;
        let natural = natural.iter().map(|width| width + padding).collect::<Vec<_>>();
        let minimum = minimum.iter().map(|width| (width + padding).min(frame.width)).collect::<Vec<_>>();
        let widths = column_widths(&natural, &minimum, frame.width);

        for (row_index, (cells, base)) in rows.iter().enumerate() {
            let header = row_index == 0 && !table.header.is_empty();
            let cell_lines = (0..count)
                .map(|index| {
                    let content = cells.get(index).map(Vec::as_slice).unwrap_or_default();
                    let align = table.columns.get(index).copied().unwrap_or_default();
                    self.paragraph_lines(content, *base, (widths[index] - padding).max(1.0), align, 1.3)
                })
                .collect::<Vec<_>>();
            let height = cell_lines
                .iter()
                .map(|lines| lines.iter().map(Line::height).sum::<f32>())
                .fold(0.0, f32::max)
                + 2.0 * CELL_PADDING.1;
            let total_width = widths.iter().sum::<f32>();
            let mut draws = Vec::new();
            if header {
                draws.push(Draw::Rect { x: 0.0, y: 0.0, width: total_width, height, color: Rgb::PANEL });
            }
            let mut x = 0.0;
            for (index, lines) in cell_lines.into_iter().enumerate() {
                let mut top = height - CELL_PADDING.1;
                for line in lines {
                    let baseline = top - line.ascent;
                    for mut draw in line.draws {
                        draw.translate(x + CELL_PADDING.0, baseline);
                        draws.push(draw);
                    }
                    top = baseline - line.descent;
                }
                x += widths[index];
            }
            for y in [0.0, height] {
                draws.push(Draw::Rect { x: 0.0, y: y - BORDER / 2.0, width: total_width, height: BORDER, color: Rgb::HAIRLINE });
            }
            let mut edge = 0.0;
            for width in std::iter::once(0.0).chain(widths.iter().copied()) {
                edge += width;
                draws.push(Draw::Rect { x: edge - BORDER / 2.0, y: 0.0, width: BORDER, height, color: Rgb::HAIRLINE });
            }
            self.push_line(Line { ascent: height, descent: 0.0, draws, keep_with_next: false }, frame);
        }
        self.push_gap(frame.paragraph_gap.max(PARAGRAPH_GAP), frame);
    }

    fn run_style(&self, style: &TextStyle, base: Base) -> RunStyle {
        let bold = style.bold || base.bold;
        let font = match (style.code, bold, style.italic) {
            (true, ..) => FontId::Courier,
            (false, true, true) => FontId::SansBoldItalic,
            (false, true, false) => FontId::SansBold,
            (false, false, true) => FontId::SansItalic,
            (false, false, false) => FontId::Sans,
        };
        let color = match (&style.link, style.color) {
            (_, Some(color)) => color.rgb(),
            (Some(_), None) => Rgb::LINK,
            (None, None) => base.color,
        };
        RunStyle {
            font,
            size: if style.code { base.size * 0.9 } else { base.size },
            color,
            underline: style.underline || style.link.is_some(),
            strike: style.strike,
            highlight: style.highlight.map(|color| color.highlight_rgb()),
            code: style.code,
            link: style.link.clone(),
        }
    }

    fn glyph(&self, ch: char, style: &RunStyle) -> (FontId, Glyph) {
        let found = self.fonts.find(ch, text_chain(style.font));
        let advance = self.fonts.advance(found.font, found.glyph) * style.size;
        (found.font, Glyph { id: found.glyph, ch: found.ch, advance })
    }

    /// Words, spaces and breaks of a paragraph; formulas stick to the word
    /// they touch.
    fn pieces(&self, content: &[Inline], base: Base) -> Vec<Piece> {
        let mut pieces = Vec::new();
        let mut word: Vec<Segment> = Vec::new();
        let flush = |word: &mut Vec<Segment>, pieces: &mut Vec<Piece>| {
            if !word.is_empty() {
                pieces.push(Piece::Word(std::mem::take(word)));
            }
        };
        for inline in content {
            match inline {
                Inline::Text { text, style } => {
                    let style = self.run_style(style, base);
                    for ch in text.chars() {
                        if ch == ' ' || ch == '\n' || ch == '\t' {
                            flush(&mut word, &mut pieces);
                            let (_, space) = self.glyph(' ', &style);
                            pieces.push(Piece::Space(style.clone(), space.advance));
                            continue;
                        }
                        if ch.is_control() {
                            continue;
                        }
                        let ch = if ch == '\u{a0}' { ' ' } else { ch };
                        let (font, glyph) = self.glyph(ch, &style);
                        match word.last_mut() {
                            Some(Segment::Text(run)) if run.style == style => {
                                run.width += glyph.advance;
                                run.glyphs.push((font, glyph));
                            }
                            _ => word.push(Segment::Text(Run { style: style.clone(), glyphs: vec![(font, glyph)], width: glyph.advance })),
                        }
                    }
                }
                Inline::Math(latex) => {
                    let nodes = parse_math(latex);
                    if !nodes.is_empty() {
                        let layout = MathLayout { fonts: self.fonts, size: base.size * MATH_SCALE, color: base.color };
                        word.push(Segment::Math(layout.formula(&nodes, false)));
                    }
                }
                Inline::Break => {
                    flush(&mut word, &mut pieces);
                    pieces.push(Piece::Break);
                }
            }
        }
        flush(&mut word, &mut pieces);
        pieces
    }

    fn paragraph_lines(&self, content: &[Inline], base: Base, width: f32, align: Align, line_height: f32) -> Vec<Line> {
        let mut lines: Vec<Vec<LineItem>> = Vec::new();
        let mut current: Vec<LineItem> = Vec::new();
        let mut used = 0.0f32;
        let mut pending: Option<(RunStyle, f32)> = None;
        for piece in self.pieces(content, base) {
            match piece {
                Piece::Break => {
                    lines.push(std::mem::take(&mut current));
                    used = 0.0;
                    pending = None;
                }
                Piece::Space(style, space) => {
                    if !current.is_empty() && pending.is_none() {
                        pending = Some((style, space));
                    }
                }
                Piece::Word(segments) => {
                    let word = segments.iter().map(Segment::width).sum::<f32>();
                    let space = pending.as_ref().map_or(0.0, |(_, space)| *space);
                    if !current.is_empty() && used + space + word > width {
                        lines.push(std::mem::take(&mut current));
                        used = 0.0;
                        pending = None;
                    }
                    if let Some((style, space)) = pending.take() {
                        current.push(LineItem::Space(style, space));
                        used += space;
                    }
                    if current.is_empty() && word > width {
                        let mut chunks = split_word(segments, width);
                        let last = chunks.pop().unwrap_or_default();
                        for chunk in chunks {
                            lines.push(chunk.into_iter().map(LineItem::Segment).collect());
                        }
                        used = last.iter().map(Segment::width).sum();
                        current.extend(last.into_iter().map(LineItem::Segment));
                    } else {
                        used += word;
                        current.extend(segments.into_iter().map(LineItem::Segment));
                    }
                }
            }
        }
        if !current.is_empty() || lines.is_empty() {
            lines.push(current);
        }
        lines.into_iter().map(|items| self.render_line(items, base, width, align, line_height)).collect()
    }

    fn render_line(&self, items: Vec<LineItem>, base: Base, width: f32, align: Align, line_height: f32) -> Line {
        let natural = items
            .iter()
            .map(|item| match item {
                LineItem::Segment(segment) => segment.width(),
                LineItem::Space(_, space) => *space,
            })
            .sum::<f32>();
        let free = (width - natural).max(0.0);
        let mut x = match align {
            Align::Left => 0.0,
            Align::Center => free / 2.0,
            Align::Right => free,
        };
        let (mut ascent, mut descent) = metrics(base.size, line_height);
        let mut backgrounds = Vec::new();
        let mut draws = Vec::new();
        for item in items {
            match item {
                LineItem::Space(style, space) => {
                    decorate(&mut backgrounds, &mut draws, &style, x, space);
                    x += space;
                }
                LineItem::Segment(Segment::Text(run)) => {
                    decorate(&mut backgrounds, &mut draws, &run.style, x, run.width);
                    let mut glyph_x = x;
                    let mut current: Option<(FontId, Vec<Glyph>, f32)> = None;
                    for (font, glyph) in run.glyphs {
                        match &mut current {
                            Some((current_font, glyphs, _)) if *current_font == font => glyphs.push(glyph),
                            _ => {
                                if let Some((font, glyphs, start)) = current.take() {
                                    draws.push(glyph_draw(font, glyphs, start, &run.style));
                                }
                                current = Some((font, vec![glyph], glyph_x));
                            }
                        }
                        glyph_x += glyph.advance;
                    }
                    if let Some((font, glyphs, start)) = current {
                        draws.push(glyph_draw(font, glyphs, start, &run.style));
                    }
                    x += run.width;
                }
                LineItem::Segment(Segment::Math(math)) => {
                    let pad = 0.15 * base.size;
                    ascent = ascent.max(math.height + pad);
                    descent = descent.max(math.depth + pad);
                    for mut draw in math.draws {
                        draw.translate(x, 0.0);
                        draws.push(draw);
                    }
                    x += math.width;
                }
            }
        }
        backgrounds.extend(draws);
        Line { ascent, descent, draws: backgrounds, keep_with_next: false }
    }

    /// Glyphs of a short label (list numbers, page numbers) and their width.
    pub(super) fn text_draws(&self, text: &str, font: FontId, size: f32, color: Rgb) -> (Vec<Draw>, f32) {
        let style = RunStyle { font, size, color, underline: false, strike: false, highlight: None, code: false, link: None };
        let mut draws = Vec::new();
        let mut x = 0.0;
        for ch in text.chars() {
            let (font, glyph) = self.glyph(ch, &style);
            match draws.last_mut() {
                Some(Draw::Glyphs { font: last, glyphs, .. }) if *last == font => glyphs.push(glyph),
                _ => draws.push(glyph_draw(font, vec![glyph], x, &style)),
            }
            x += glyph.advance;
        }
        (draws, x)
    }
}

/// Glyphs and width of `text`, for callers outside a paragraph.
pub(super) fn label(fonts: &Fonts, text: &str, size: f32, color: Rgb) -> (Vec<Draw>, f32) {
    Layout { fonts, flow: Vec::new() }.text_draws(text, FontId::Sans, size, color)
}

fn glyph_draw(font: FontId, glyphs: Vec<Glyph>, x: f32, style: &RunStyle) -> Draw {
    Draw::Glyphs { x, y: 0.0, font, size: style.size, color: style.color, glyphs, h_scale: 1.0, v_scale: 1.0 }
}

/// Room a line of `size` text takes above and below its baseline.
fn metrics(size: f32, line_height: f32) -> (f32, f32) {
    let leading = ((line_height - ASCENDER - DESCENDER) * size / 2.0).max(0.0);
    (ASCENDER * size + leading, DESCENDER * size + leading)
}

/// Highlight and code backgrounds behind a stretch of text; underline,
/// strikethrough and link area on top of it.
fn decorate(backgrounds: &mut Vec<Draw>, draws: &mut Vec<Draw>, style: &RunStyle, x: f32, width: f32) {
    let size = style.size;
    if let Some(color) = style.highlight {
        backgrounds.push(Draw::Rect { x, y: -0.24 * size, width, height: 1.08 * size, color });
    }
    if style.code {
        backgrounds.push(Draw::Rect { x: x - 1.0, y: -0.26 * size, width: width + 2.0, height: 1.1 * size, color: Rgb::CODE_BACKGROUND });
    }
    let thickness = (0.06 * size).max(0.5);
    if style.underline {
        draws.push(Draw::Rect { x, y: -0.13 * size - thickness / 2.0, width, height: thickness, color: style.color });
    }
    if style.strike {
        draws.push(Draw::Rect { x, y: 0.28 * size, width, height: thickness, color: style.color });
    }
    if let Some(url) = &style.link {
        draws.push(Draw::Link { x, y: -0.25 * size, width, height: 1.15 * size, url: url.clone() });
    }
}

/// Splits a word wider than the line into pieces that fit; formulas are
/// never cut.
fn split_word(segments: Vec<Segment>, width: f32) -> Vec<Vec<Segment>> {
    let mut chunks: Vec<Vec<Segment>> = vec![Vec::new()];
    let mut used = 0.0f32;
    for segment in segments {
        match segment {
            Segment::Math(math) => {
                if used > 0.0 && used + math.width > width {
                    chunks.push(Vec::new());
                    used = 0.0;
                }
                used += math.width;
                if let Some(chunk) = chunks.last_mut() {
                    chunk.push(Segment::Math(math));
                }
            }
            Segment::Text(run) => {
                let mut current = Run { style: run.style.clone(), glyphs: Vec::new(), width: 0.0 };
                for (font, glyph) in run.glyphs {
                    if used > 0.0 && used + glyph.advance > width {
                        if !current.glyphs.is_empty() {
                            if let Some(chunk) = chunks.last_mut() {
                                chunk.push(Segment::Text(std::mem::replace(&mut current, Run { style: run.style.clone(), glyphs: Vec::new(), width: 0.0 })));
                            }
                        }
                        chunks.push(Vec::new());
                        used = 0.0;
                    }
                    used += glyph.advance;
                    current.width += glyph.advance;
                    current.glyphs.push((font, glyph));
                }
                if !current.glyphs.is_empty() {
                    if let Some(chunk) = chunks.last_mut() {
                        chunk.push(Segment::Text(current));
                    }
                }
            }
        }
    }
    chunks.retain(|chunk| !chunk.is_empty());
    chunks
}

/// Column widths that fill `available`: extra room follows the natural
/// widths; when there is not enough, columns shrink towards their longest word.
fn column_widths(natural: &[f32], minimum: &[f32], available: f32) -> Vec<f32> {
    let natural_total = natural.iter().sum::<f32>();
    if natural_total <= available {
        let extra = available - natural_total;
        return natural.iter().map(|width| width + extra * width / natural_total.max(1.0)).collect();
    }
    let minimum_total = minimum.iter().sum::<f32>();
    if minimum_total >= available {
        return minimum.iter().map(|width| width * available / minimum_total.max(1.0)).collect();
    }
    let flexible = natural_total - minimum_total;
    natural
        .iter()
        .zip(minimum)
        .map(|(natural, minimum)| minimum + (available - minimum_total) * (natural - minimum) / flexible.max(1.0))
        .collect()
}

/// A task's checkbox, left of the text; checked boxes are teal with a tick.
fn checkbox(text_x: f32, checked: bool) -> Vec<Draw> {
    let side = 8.5;
    let x = text_x - side - 6.0;
    let y = -0.5;
    if checked {
        vec![
            Draw::Rect { x, y, width: side, height: side, color: Rgb::LINK },
            Draw::Line { points: vec![(x + 1.9, y + 4.4), (x + 3.6, y + 2.5), (x + 6.7, y + 6.3)], width: 1.3, color: WHITE },
        ]
    } else {
        let edges = vec![(x, y), (x + side, y), (x + side, y + side), (x, y + side), (x, y)];
        vec![Draw::Line { points: edges, width: 0.9, color: Rgb::MUTED }]
    }
}

#[cfg(test)]
mod tests {
    use super::super::fonts::fonts;
    use super::*;
    use crate::export_render::markdown::parse_markdown;

    fn flow(markdown: &str, width: f32) -> Vec<Flow> {
        layout_document(fonts().expect("fonts"), &parse_markdown(markdown), width)
    }

    fn lines(flow: &[Flow]) -> Vec<&Line> {
        flow.iter().filter_map(|item| if let Flow::Line(line) = item { Some(line) } else { None }).collect()
    }

    #[test]
    fn wraps_paragraphs_to_the_width() {
        let text = "palabra ".repeat(60);
        assert!(lines(&flow(&text, 450.0)).len() > 3);
        assert_eq!(lines(&flow("corta", 450.0)).len(), 1);
        // A word longer than the line is cut rather than overflowing.
        let long = "x".repeat(400);
        assert!(lines(&flow(&long, 100.0)).len() > 3);
    }

    #[test]
    fn keeps_headings_with_what_follows() {
        let mut markdown = "texto\n\n".repeat(30);
        markdown.push_str("# Título\n\nDespués");
        let pages = paginate(flow(&markdown, 400.0), 500.0);
        let heading_page = pages.iter().position(|page| page.iter().any(|placed| placed.line.keep_with_next)).expect("heading");
        let last = pages[heading_page].last().expect("line");
        assert!(!last.line.keep_with_next, "the heading ended a page");
    }

    #[test]
    fn breaks_pages_and_drops_gaps_at_their_top() {
        let markdown = "linea\n\n".repeat(80);
        let pages = paginate(flow(&markdown, 400.0), 300.0);
        assert!(pages.len() > 3);
        for page in &pages {
            assert_eq!(page.first().map(|placed| placed.top), Some(0.0));
            let bottom = page.last().map(|placed| placed.top + placed.line.height()).unwrap_or(0.0);
            assert!(bottom <= 300.01);
        }
    }

    #[test]
    fn marks_list_items_and_draws_quote_bars() {
        let with_marker = lines(&flow("- uno\n- [x] dos\n\n7. siete", 400.0))
            .iter()
            .filter(|line| line.draws.iter().any(|draw| matches!(draw, Draw::Glyphs { x, .. } if *x < LIST_INDENT - 1.0) || matches!(draw, Draw::Line { .. })))
            .count();
        assert_eq!(with_marker, 3);
        let quoted = flow("> uno\n>\n> dos", 400.0);
        assert!(lines(&quoted).iter().all(|line| matches!(line.draws.first(), Some(Draw::Rect { color, .. }) if *color == Rgb::HAIRLINE)));
    }

    #[test]
    fn scales_wide_formulas_to_the_width() {
        let wide = format!("$$\n{}\n$$", "a + ".repeat(80) + "a");
        let line = lines(&flow(&wide, 300.0))[0].clone();
        let right = line
            .draws
            .iter()
            .filter_map(|draw| if let Draw::Glyphs { x, glyphs, .. } = draw { Some(x + glyphs.iter().map(|glyph| glyph.advance).sum::<f32>()) } else { None })
            .fold(0.0, f32::max);
        assert!(right <= 300.5, "{right}");
    }

    #[test]
    fn fills_tables_to_the_width() {
        assert_eq!(column_widths(&[50.0, 150.0], &[20.0, 40.0], 400.0), vec![100.0, 300.0]);
        let narrow = column_widths(&[300.0, 300.0], &[50.0, 50.0], 200.0);
        assert!((narrow.iter().sum::<f32>() - 200.0).abs() < 0.01);
        assert!(narrow.iter().all(|width| *width >= 50.0));
    }
}
