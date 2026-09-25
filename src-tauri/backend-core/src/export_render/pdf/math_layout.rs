//! Formulas typeset for the PDF: a small version of TeX's math layout
//! (appendix G of the TeXbook) with KaTeX's fonts and parameters. The result
//! is glyphs and rules, so the formula stays text in the PDF.

use super::fonts::{text_chain, FontId, Fonts};
use super::{Draw, Glyph};
use crate::export_render::document::Rgb;
use crate::export_render::math::symbols::{is_integral, styled_character};
use crate::export_render::math::{Accent, ArrayKind, AtomClass, ColumnAlign, MathNode, MathStyle, MathVariant};

/// Math is set this much larger than the text around it, so the x-heights
/// of KaTeX's fonts and Liberation Sans match (KaTeX itself uses 1.21).
pub(super) const MATH_SCALE: f32 = 1.2;

// TeX's font parameters, in ems of the current size (KaTeX's values).
const AXIS: f32 = 0.25;
const X_HEIGHT: f32 = 0.431;
const RULE: f32 = 0.04;
const NUM1: f32 = 0.677;
const NUM2: f32 = 0.394;
const NUM3: f32 = 0.444;
const DENOM1: f32 = 0.686;
const DENOM2: f32 = 0.345;
const SUP1: f32 = 0.413;
const SUP2: f32 = 0.363;
const SUP3: f32 = 0.289;
const SUB1: f32 = 0.15;
const SUB2: f32 = 0.247;
const SUP_DROP: f32 = 0.386;
const SUB_DROP: f32 = 0.05;
const DELIM1: f32 = 2.39;
const DELIM2: f32 = 1.01;
const BIG_OP_SPACING: [f32; 5] = [0.111, 0.166, 0.2, 0.6, 0.1];
const SCRIPT_SPACE: f32 = 0.05;
const NULL_DELIMITER: f32 = 0.12;
/// Row height and depth of arrays (`\arraystretch` 1, 12 pt baselines).
const ARRAY_STRUT: (f32, f32) = (0.84, 0.36);

/// A laid-out piece of formula: glyphs and rules around a baseline at
/// y = 0, starting at x = 0; y grows upwards.
#[derive(Debug, Clone, Default)]
pub(super) struct MathBox {
    pub width: f32,
    pub height: f32,
    pub depth: f32,
    /// Italic correction of the last glyph, for superscripts.
    pub italic: f32,
    pub draws: Vec<Draw>,
}

impl MathBox {
    /// Adds `other` at (`x`, `y`) without changing the width.
    fn place(&mut self, other: MathBox, x: f32, y: f32) {
        self.height = self.height.max(other.height + y);
        self.depth = self.depth.max(other.depth - y);
        for mut draw in other.draws {
            draw.translate(x, y);
            self.draws.push(draw);
        }
    }

    /// Adds `other` after the current content.
    fn append(&mut self, other: MathBox) {
        let x = self.width;
        self.width += other.width;
        self.italic = other.italic;
        self.place(other, x, 0.0);
    }

    /// Moves the content up by `dy` (down when negative).
    fn raised(mut self, dy: f32) -> MathBox {
        for draw in &mut self.draws {
            draw.translate(0.0, dy);
        }
        self.height += dy;
        self.depth -= dy;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Style {
    /// 0 display, 1 text, 2 script, 3 scriptscript.
    level: u8,
    cramped: bool,
}

impl Style {
    fn from(style: MathStyle, cramped: bool) -> Style {
        let level = match style {
            MathStyle::Display => 0,
            MathStyle::Text => 1,
            MathStyle::Script => 2,
            MathStyle::ScriptScript => 3,
        };
        Style { level, cramped }
    }

    fn size(self) -> f32 {
        match self.level {
            0 | 1 => 1.0,
            2 => 0.7,
            _ => 0.5,
        }
    }

    fn is_display(self) -> bool {
        self.level == 0
    }

    fn is_script(self) -> bool {
        self.level >= 2
    }

    fn sup(self) -> Style {
        Style { level: if self.level <= 1 { 2 } else { 3 }, cramped: self.cramped }
    }

    fn sub(self) -> Style {
        Style { cramped: true, ..self.sup() }
    }

    fn numerator(self) -> Style {
        Style { level: (self.level + 1).clamp(1, 3), cramped: self.cramped }
    }

    fn denominator(self) -> Style {
        Style { cramped: true, ..self.numerator() }
    }

    fn cramp(self) -> Style {
        Style { cramped: true, ..self }
    }
}

fn chain(variant: MathVariant) -> &'static [FontId] {
    use FontId::*;
    match variant {
        MathVariant::Italic => &[MathItalic, MainItalic, MainRegular, Ams, Size1, Sans],
        MathVariant::Upright => &[MainRegular, Ams, MathItalic, Size1, Sans],
        MathVariant::Bold => &[MainBold, MainRegular, Ams, SansBold],
        MathVariant::BoldItalic => &[MathBoldItalic, MainBold, MathItalic, MainRegular, Ams],
        MathVariant::DoubleStruck => &[Ams, MainRegular, Sans],
        MathVariant::Calligraphic => &[Caligraphic, MathItalic, MainRegular],
        MathVariant::Fraktur => &[Fraktur, MainRegular],
        MathVariant::Script => &[Script, Caligraphic, MathItalic, MainRegular],
        MathVariant::SansSerif => &[SansSerif, Sans],
        MathVariant::Monospace => &[Typewriter, Courier, MainRegular],
    }
}

pub(super) struct MathLayout<'a> {
    pub fonts: &'a Fonts,
    /// Size of the math em, in points.
    pub size: f32,
    pub color: Rgb,
}

impl MathLayout<'_> {
    pub fn formula(&self, nodes: &[MathNode], display: bool) -> MathBox {
        let style = Style { level: if display { 0 } else { 1 }, cramped: false };
        self.list(nodes, style)
    }

    fn em(&self, style: Style) -> f32 {
        self.size * style.size()
    }

    fn list(&self, nodes: &[MathNode], style: Style) -> MathBox {
        let mut atoms: Vec<(Option<AtomClass>, MathBox)> = Vec::with_capacity(nodes.len());
        for node in nodes {
            match node {
                MathNode::Space(width) => atoms.push((None, MathBox { width: width * self.em(style), ..MathBox::default() })),
                MathNode::Styled { style: next, body } => {
                    atoms.push((Some(AtomClass::Ord), self.list(body, Style::from(*next, style.cramped))));
                }
                other => atoms.push((Some(other.class()), self.atom(other, style))),
            }
        }
        fix_binary_operators(&mut atoms);
        let mut result = MathBox::default();
        let mut previous = None;
        for (class, atom) in atoms {
            if let (Some(left), Some(right)) = (previous, class) {
                result.width += self.spacing(left, right, style);
            }
            result.append(atom);
            if class.is_some() {
                previous = class;
            }
        }
        result
    }

    /// TeX's space between neighbouring atoms (thin, medium or thick).
    fn spacing(&self, left: AtomClass, right: AtomClass, style: Style) -> f32 {
        use AtomClass::*;
        // Negative: only in display and text styles.
        let code: i8 = match (left, right) {
            (Ord, Op) | (Op, Ord) | (Op, Op) | (Close, Op) | (Inner, Op) => 1,
            (Ord, Bin) | (Bin, Ord | Op | Open | Inner) | (Close, Bin) | (Inner, Bin) => -2,
            (Ord | Op | Close | Inner, Rel) | (Rel, Ord | Op | Open | Inner) => -3,
            (Ord | Op | Close, Inner) | (Punct, _) | (Inner, Ord | Open | Punct | Inner) => -1,
            _ => 0,
        };
        if code < 0 && style.is_script() {
            return 0.0;
        }
        let mu = match code.unsigned_abs() {
            1 => 3.0,
            2 => 4.0,
            3 => 5.0,
            _ => 0.0,
        };
        mu / 18.0 * self.em(style)
    }

    fn atom(&self, node: &MathNode, style: Style) -> MathBox {
        match node {
            MathNode::Symbol { ch, variant, .. } => self.symbol(*ch, *variant, style),
            MathNode::Text { text, class, bold, .. } => self.text(text, *class, *bold, style),
            MathNode::Group(inner) => self.list(inner, style),
            MathNode::Fraction { numerator, denominator, rule, style: forced, delimiters } => {
                let style = forced.map_or(style, |forced| Style::from(forced, style.cramped));
                self.fraction(numerator, denominator, *rule, *delimiters, style)
            }
            MathNode::Root { index, body } => self.root(index.as_deref(), body, style),
            MathNode::Scripts { base, sup, sub } => self.scripts(base, sup.as_deref(), sub.as_deref(), style),
            MathNode::LargeOp { symbol, .. } => self.large_operator(*symbol, style),
            MathNode::Delimited { left, right, body } => self.delimited(*left, *right, body, style),
            MathNode::SizedDelimiter { ch, size, .. } => {
                let total = [1.2, 1.8, 2.4, 3.0][usize::from(size.clamp(&1, &4) - 1)] * self.em(style);
                self.delimiter(*ch, total, style)
            }
            MathNode::Array { kind, rows, columns, left, right } => self.array(*kind, rows, columns, *left, *right, style),
            MathNode::Accent { accent, body } => self.accent(*accent, body, style),
            MathNode::Stack { base, over, under, .. } => {
                let base = self.list(base, style);
                self.limits(base, over.as_deref(), under.as_deref(), style)
            }
            MathNode::Space(width) => MathBox { width: width * self.em(style), ..MathBox::default() },
            MathNode::Styled { style: next, body } => self.list(body, Style::from(*next, style.cramped)),
        }
    }

    fn glyph_box(&self, font: FontId, glyph: u16, ch: char, size: f32) -> MathBox {
        let advance = self.fonts.advance(font, glyph) * size;
        let bounds = self.fonts.bounds(font, glyph);
        // Ink past the advance: the italic correction of slanted letters and of `∫`.
        let italic = (bounds.x_max * size - advance).max(0.0);
        MathBox {
            width: advance,
            height: bounds.y_max * size,
            depth: -bounds.y_min * size,
            italic,
            draws: vec![Draw::Glyphs {
                x: 0.0,
                y: 0.0,
                font,
                size,
                color: self.color,
                glyphs: vec![Glyph { id: glyph, ch, advance }],
                h_scale: 1.0,
                v_scale: 1.0,
            }],
        }
    }

    fn symbol(&self, ch: char, variant: MathVariant, style: Style) -> MathBox {
        let found = self.fonts.find(ch, chain(variant));
        let shown = if found.ch == ch { styled_character(ch, variant) } else { found.ch };
        self.glyph_box(found.font, found.glyph, shown, self.em(style))
    }

    /// `\text{…}` in the text font, at the size of the surrounding text;
    /// operator names in KaTeX's upright font.
    fn text(&self, text: &str, class: AtomClass, bold: bool, style: Style) -> MathBox {
        let (chain, size) = if class == AtomClass::Ord {
            (text_chain(if bold { FontId::SansBold } else { FontId::Sans }), self.em(style) / MATH_SCALE)
        } else {
            (chain(if bold { MathVariant::Bold } else { MathVariant::Upright }), self.em(style))
        };
        let mut result = MathBox::default();
        for ch in text.chars() {
            let ch = if ch == '\u{a0}' { ' ' } else { ch };
            let found = self.fonts.find(ch, chain);
            let mut glyph_box = self.glyph_box(found.font, found.glyph, found.ch, size);
            glyph_box.italic = 0.0;
            if ch == ' ' {
                glyph_box.height = 0.0;
                glyph_box.depth = 0.0;
            }
            result.append(glyph_box);
        }
        result
    }

    fn fraction(&self, numerator: &[MathNode], denominator: &[MathNode], rule: bool, delimiters: Option<(char, char)>, style: Style) -> MathBox {
        let em = self.em(style);
        let top = self.list(numerator, style.numerator());
        let bottom = self.list(denominator, style.denominator());
        let theta = if rule { RULE * em } else { 0.0 };
        let axis = AXIS * em;
        let (mut shift_up, mut shift_down) = match (style.is_display(), rule) {
            (true, _) => (NUM1 * em, DENOM1 * em),
            (false, true) => (NUM2 * em, DENOM2 * em),
            (false, false) => (NUM3 * em, DENOM2 * em),
        };
        if rule {
            let clearance = if style.is_display() { 3.0 * theta } else { theta };
            let above = (shift_up - top.depth) - (axis + theta / 2.0);
            if above < clearance {
                shift_up += clearance - above;
            }
            let below = (axis - theta / 2.0) - (bottom.height - shift_down);
            if below < clearance {
                shift_down += clearance - below;
            }
        } else {
            let clearance = if style.is_display() { 7.0 } else { 3.0 } * RULE * em;
            let gap = (shift_up - top.depth) - (bottom.height - shift_down);
            if gap < clearance {
                shift_up += (clearance - gap) / 2.0;
                shift_down += (clearance - gap) / 2.0;
            }
        }
        let pad = if delimiters.is_some() { 0.0 } else { NULL_DELIMITER * em };
        let inner = top.width.max(bottom.width);
        let mut result = MathBox { width: inner + 2.0 * pad, ..MathBox::default() };
        let (top_width, bottom_width) = (top.width, bottom.width);
        result.place(top, pad + (inner - top_width) / 2.0, shift_up);
        result.place(bottom, pad + (inner - bottom_width) / 2.0, -shift_down);
        if rule {
            result.draws.push(Draw::Rect { x: pad, y: axis - theta / 2.0, width: inner, height: theta, color: self.color });
        }
        match delimiters {
            Some((left, right)) => {
                let size = if style.is_display() { DELIM1 } else { DELIM2 } * em;
                let mut wrapped = self.delimiter(left, size, style);
                wrapped.append(result);
                wrapped.append(self.delimiter(right, size, style));
                wrapped
            }
            None => result,
        }
    }

    fn root(&self, index: Option<&[MathNode]>, body: &[MathNode], style: Style) -> MathBox {
        let em = self.em(style);
        let theta = RULE * em;
        let content = self.list(body, style.cramp());
        let phi = if style.is_display() { X_HEIGHT * em } else { theta };
        let clearance = theta + phi / 4.0;
        let top = content.height.max(0.6 * em) + clearance + theta;
        let bottom = -(content.depth.max(0.0) + 0.08 * em);
        let total = top - bottom;
        let sign = (0.5 + 0.08 * (total / em)).min(0.9) * em;
        let hook = bottom + 0.45 * total.min(1.1 * em);

        let index_box = index.map(|nodes| self.list(nodes, Style { level: 3, cramped: false }));
        let offset = index_box.as_ref().map_or(0.0, |index| (index.width - 0.55 * sign).max(0.0));
        let mut result = MathBox { width: offset + sign + content.width + 0.05 * em, height: top + theta, depth: -bottom, ..MathBox::default() };
        let points = vec![
            (offset, hook),
            (offset + 0.2 * sign, hook + 0.06 * em),
            (offset + 0.5 * sign, bottom),
            (offset + sign, top - theta / 2.0),
        ];
        result.draws.push(Draw::Line { points: points[1..3].to_vec(), width: 2.4 * theta, color: self.color });
        result.draws.push(Draw::Line { points, width: 1.1 * theta, color: self.color });
        result.draws.push(Draw::Rect { x: offset + sign - 0.02 * em, y: top - theta, width: content.width + 0.07 * em, height: theta, color: self.color });
        result.place(content, offset + sign, 0.0);
        if let Some(index) = index_box {
            let x = offset + 0.55 * sign - index.width;
            let y = bottom + 0.6 * total + index.depth;
            result.place(index, x.max(0.0), y);
        }
        result
    }

    fn scripts(&self, base: &MathNode, sup: Option<&[MathNode]>, sub: Option<&[MathNode]>, style: Style) -> MathBox {
        match base {
            MathNode::LargeOp { symbol, limits } => {
                let operator = self.large_operator(*symbol, style);
                let use_limits = limits.unwrap_or(style.is_display() && !is_integral(*symbol));
                if use_limits {
                    self.limits(operator, sup, sub, style)
                } else {
                    // Scripts follow the operator's top and bottom, not a letter's.
                    self.attach(operator, false, sup, sub, style)
                }
            }
            MathNode::Text { class: AtomClass::Op, limits: true, .. } if style.is_display() => {
                let operator = self.atom(base, style);
                self.limits(operator, sup, sub, style)
            }
            MathNode::Accent { accent: Accent::OverBrace, .. } if sub.is_none() => {
                let braced = self.atom(base, style);
                self.limits(braced, sup, None, style)
            }
            MathNode::Accent { accent: Accent::UnderBrace, .. } if sup.is_none() => {
                let braced = self.atom(base, style);
                self.limits(braced, None, sub, style)
            }
            _ => {
                let single = matches!(base, MathNode::Symbol { .. });
                let base_box = self.atom(base, style);
                self.attach(base_box, single, sup, sub, style)
            }
        }
    }

    /// Superscript and subscript beside `base` (TeX's rule 18).
    fn attach(&self, base: MathBox, single: bool, sup: Option<&[MathNode]>, sub: Option<&[MathNode]>, style: Style) -> MathBox {
        let em = self.em(style);
        let sup_box = sup.map(|nodes| self.list(nodes, style.sup()));
        let sub_box = sub.map(|nodes| self.list(nodes, style.sub()));
        let (mut up, mut down) = if single {
            (0.0, 0.0)
        } else {
            (base.height - SUP_DROP * self.em(style.sup()), base.depth + SUB_DROP * self.em(style.sub()))
        };
        let theta = RULE * em;
        let x_height = X_HEIGHT * em;
        let italic = base.italic;
        let mut result = MathBox { width: base.width, ..MathBox::default() };
        let base_width = base.width;
        result.place(base, 0.0, 0.0);
        let mut extra: f32 = 0.0;
        match (sup_box, sub_box) {
            (None, Some(sub)) => {
                down = down.max(SUB1 * em).max(sub.height - 0.8 * x_height);
                extra = extra.max(sub.width);
                result.place(sub, base_width, -down);
            }
            (Some(sup), sub) => {
                let minimum = if style.is_display() && !style.cramped {
                    SUP1
                } else if style.cramped {
                    SUP3
                } else {
                    SUP2
                };
                up = up.max(minimum * em).max(sup.depth + 0.25 * x_height);
                if let Some(sub) = &sub {
                    down = down.max(SUB2 * em);
                    let gap = (up - sup.depth) - (sub.height - down);
                    if gap < 4.0 * theta {
                        down += 4.0 * theta - gap;
                        let lift = 0.8 * x_height - (up - sup.depth);
                        if lift > 0.0 {
                            up += lift;
                            down -= lift;
                        }
                    }
                }
                extra = extra.max(sup.width + italic);
                result.place(sup, base_width + italic, up);
                if let Some(sub) = sub {
                    extra = extra.max(sub.width);
                    result.place(sub, base_width, -down);
                }
            }
            (None, None) => return result,
        }
        result.width = base_width + extra + SCRIPT_SPACE * em;
        result
    }

    /// Scripts above and below `base`, as the limits of `∑` (TeX's rule 13a).
    fn limits(&self, base: MathBox, sup: Option<&[MathNode]>, sub: Option<&[MathNode]>, style: Style) -> MathBox {
        let em = self.em(style);
        let sup_box = sup.map(|nodes| self.list(nodes, style.sup()));
        let sub_box = sub.map(|nodes| self.list(nodes, style.sub()));
        let width = [Some(base.width), sup_box.as_ref().map(|b| b.width), sub_box.as_ref().map(|b| b.width)]
            .into_iter()
            .flatten()
            .fold(0.0, f32::max);
        let italic = base.italic;
        let (base_height, base_depth, base_width) = (base.height, base.depth, base.width);
        let mut result = MathBox { width, ..MathBox::default() };
        result.place(base, (width - base_width) / 2.0, 0.0);
        if let Some(sup) = sup_box {
            let gap = (BIG_OP_SPACING[0] * em).max(BIG_OP_SPACING[2] * em - sup.depth);
            let y = base_height + gap + sup.depth;
            let top = y + sup.height + BIG_OP_SPACING[4] * em;
            let x = (width - sup.width) / 2.0 + italic / 2.0;
            result.place(sup, x, y);
            result.height = result.height.max(top);
        }
        if let Some(sub) = sub_box {
            let gap = (BIG_OP_SPACING[1] * em).max(BIG_OP_SPACING[3] * em - sub.height);
            let y = -(base_depth + gap + sub.height);
            let bottom = -y + sub.depth + BIG_OP_SPACING[4] * em;
            let x = (width - sub.width) / 2.0 - italic / 2.0;
            result.place(sub, x, y);
            result.depth = result.depth.max(bottom);
        }
        result
    }

    fn large_operator(&self, symbol: char, style: Style) -> MathBox {
        let size_font = if style.is_display() { FontId::Size2 } else { FontId::Size1 };
        let found = self.fonts.find(symbol, &[size_font, FontId::Size1, FontId::MainRegular, FontId::Sans]);
        let operator = self.glyph_box(found.font, found.glyph, found.ch, self.em(style));
        let shift = (operator.height - operator.depth) / 2.0 - AXIS * self.em(style);
        operator.raised(-shift)
    }

    /// A delimiter at least `total` tall (height plus depth), centred on the axis.
    fn delimiter(&self, ch: char, total: f32, style: Style) -> MathBox {
        let em = self.em(style);
        let mut chosen = None;
        for font in [FontId::MainRegular, FontId::Size1, FontId::Size2, FontId::Size3, FontId::Size4] {
            if let Some(glyph) = self.fonts.glyph(font, ch) {
                let candidate = self.glyph_box(font, glyph, ch, em);
                let fits = candidate.height + candidate.depth >= total;
                chosen = Some(candidate);
                if fits {
                    break;
                }
            }
        }
        let mut delimiter = chosen.unwrap_or_else(|| {
            let found = self.fonts.find(ch, chain(MathVariant::Upright));
            self.glyph_box(found.font, found.glyph, found.ch, em)
        });
        let extent = delimiter.height + delimiter.depth;
        if extent > 0.0 && extent < total {
            let scale = total / extent;
            for draw in &mut delimiter.draws {
                if let Draw::Glyphs { v_scale, .. } = draw {
                    *v_scale = scale;
                }
            }
            delimiter.height *= scale;
            delimiter.depth *= scale;
        }
        let shift = (delimiter.height - delimiter.depth) / 2.0 - AXIS * em;
        delimiter.italic = 0.0;
        delimiter.raised(-shift)
    }

    /// Height the delimiters around `content` need (TeX's `\delimiterfactor`).
    fn delimiter_size(&self, content: &MathBox, style: Style) -> f32 {
        let em = self.em(style);
        let axis = AXIS * em;
        let half = (content.height - axis).max(content.depth + axis);
        (2.0 * half * 0.901).max(2.0 * half - 0.5 * em)
    }

    fn delimited(&self, left: Option<char>, right: Option<char>, body: &[MathNode], style: Style) -> MathBox {
        let content = self.list(body, style);
        let size = self.delimiter_size(&content, style);
        let null = NULL_DELIMITER * self.em(style);
        let mut result = match left {
            Some(ch) => self.delimiter(ch, size, style),
            None => MathBox { width: null, ..MathBox::default() },
        };
        result.append(content);
        result.append(match right {
            Some(ch) => self.delimiter(ch, size, style),
            None => MathBox { width: null, ..MathBox::default() },
        });
        result.italic = 0.0;
        result
    }

    fn array(&self, kind: ArrayKind, rows: &[Vec<Vec<MathNode>>], columns: &[ColumnAlign], left: Option<char>, right: Option<char>, style: Style) -> MathBox {
        let em = self.em(style);
        let cell_style = match kind {
            ArrayKind::Aligned | ArrayKind::Gathered => Style { level: 0, cramped: false },
            ArrayKind::SmallMatrix => Style { level: 2, cramped: false },
            _ => Style { level: 1, cramped: false },
        };
        let cells = rows
            .iter()
            .map(|row| {
                row.iter()
                    .enumerate()
                    .map(|(index, cell)| {
                        if kind == ArrayKind::Aligned && index % 2 == 1 {
                            // amsmath starts these cells with `{}`, so a relation keeps its space.
                            let mut nodes = vec![MathNode::Group(Vec::new())];
                            nodes.extend(cell.iter().cloned());
                            self.list(&nodes, cell_style)
                        } else {
                            self.list(cell, cell_style)
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let count = cells.iter().map(Vec::len).max().unwrap_or(0);
        let mut widths = vec![0.0f32; count];
        for row in &cells {
            for (index, cell) in row.iter().enumerate() {
                widths[index] = widths[index].max(cell.width);
            }
        }
        let align = |index: usize| match kind {
            ArrayKind::Cases => ColumnAlign::Left,
            ArrayKind::Aligned => if index.is_multiple_of(2) { ColumnAlign::Right } else { ColumnAlign::Left },
            ArrayKind::Array => columns.get(index).copied().unwrap_or(ColumnAlign::Center),
            _ => ColumnAlign::Center,
        };
        let gap = |index: usize| match kind {
            _ if index == 0 => 0.0,
            ArrayKind::Aligned => if index % 2 == 1 { 0.0 } else { 1.0 * em },
            ArrayKind::SmallMatrix => 0.4 * em,
            _ => 1.0 * em,
        };
        let row_gap = match kind {
            ArrayKind::Aligned | ArrayKind::Gathered => 0.3 * em,
            ArrayKind::Cases => 0.2 * em,
            _ => 0.0,
        };
        let strut = (ARRAY_STRUT.0 * self.em(cell_style), ARRAY_STRUT.1 * self.em(cell_style));
        let metrics = cells
            .iter()
            .map(|row| {
                row.iter().fold(strut, |(height, depth), cell| (height.max(cell.height), depth.max(cell.depth)))
            })
            .collect::<Vec<_>>();
        let total = metrics.iter().map(|(height, depth)| height + depth).sum::<f32>() + row_gap * metrics.len().saturating_sub(1) as f32;
        let axis = AXIS * em;
        let mut result = MathBox { width: 0.0, height: total / 2.0 + axis, depth: total / 2.0 - axis, ..MathBox::default() };
        let mut x_positions = Vec::with_capacity(count);
        let mut x = 0.0;
        for (index, width) in widths.iter().enumerate() {
            x += gap(index);
            x_positions.push(x);
            x += width;
        }
        result.width = x;
        let mut top = total / 2.0 + axis;
        for (row, (height, depth)) in cells.into_iter().zip(metrics) {
            let baseline = top - height;
            for (index, cell) in row.into_iter().enumerate() {
                let free = widths[index] - cell.width;
                let offset = match align(index) {
                    ColumnAlign::Left => 0.0,
                    ColumnAlign::Center => free / 2.0,
                    ColumnAlign::Right => free,
                };
                result.place(cell, x_positions[index] + offset, baseline);
            }
            top = baseline - depth - row_gap;
        }
        if left.is_none() && right.is_none() {
            return result;
        }
        let size = self.delimiter_size(&result, style);
        let space = if kind == ArrayKind::Cases { 0.2 * em } else { 0.0 };
        let mut wrapped = match left {
            Some(ch) => self.delimiter(ch, size, style),
            None => MathBox { width: NULL_DELIMITER * em, ..MathBox::default() },
        };
        wrapped.width += space;
        wrapped.append(result);
        wrapped.append(match right {
            Some(ch) => self.delimiter(ch, size, style),
            None => MathBox { width: NULL_DELIMITER * em, ..MathBox::default() },
        });
        wrapped
    }

    fn accent(&self, accent: Accent, body: &[MathNode], style: Style) -> MathBox {
        let em = self.em(style);
        let theta = RULE * em;
        let content = self.list(body, style.cramp());
        let width = content.width;
        let (height, depth) = (content.height, content.depth);
        let skew = content.italic / 2.0;
        let mut result = MathBox { width, ..MathBox::default() };
        result.place(content, 0.0, 0.0);
        match accent {
            Accent::Overline => {
                let y = height + 3.0 * theta;
                result.draws.push(Draw::Rect { x: 0.0, y, width, height: theta, color: self.color });
                result.height = y + 2.0 * theta;
            }
            Accent::Underline => {
                let y = -(depth + 3.0 * theta) - theta;
                result.draws.push(Draw::Rect { x: 0.0, y, width, height: theta, color: self.color });
                result.depth = -y + theta;
            }
            Accent::OverRightArrow | Accent::OverLeftArrow => {
                let y = height.max(X_HEIGHT * em) + 0.2 * em;
                let head = 0.12 * em;
                let (tip, back) = if accent == Accent::OverRightArrow { (width, width - head) } else { (0.0, head) };
                result.draws.push(Draw::Line { points: vec![(0.0, y), (width, y)], width: theta, color: self.color });
                result.draws.push(Draw::Line { points: vec![(back, y + head * 0.8), (tip, y), (back, y - head * 0.8)], width: theta, color: self.color });
                result.height = y + head;
            }
            Accent::OverBrace | Accent::UnderBrace => {
                let over = accent == Accent::OverBrace;
                let rise = 0.18 * em;
                let base = if over { height + 0.12 * em } else { -(depth + 0.12 * em) };
                let sign = if over { 1.0 } else { -1.0 };
                let bend = (0.15 * em).min(width / 6.0);
                let middle = width / 2.0;
                let points = vec![
                    (0.0, base),
                    (bend, base + sign * rise / 2.0),
                    (middle - bend, base + sign * rise / 2.0),
                    (middle, base + sign * rise),
                    (middle + bend, base + sign * rise / 2.0),
                    (width - bend, base + sign * rise / 2.0),
                    (width, base),
                ];
                result.draws.push(Draw::Line { points, width: 1.6 * theta, color: self.color });
                if over {
                    result.height = base + rise + 0.05 * em;
                } else {
                    result.depth = -(base - rise) + 0.05 * em;
                }
            }
            other => {
                let mark = match other {
                    Accent::Hat | Accent::WideHat => 'ˆ',
                    Accent::Tilde | Accent::WideTilde => '˜',
                    Accent::Bar => 'ˉ',
                    Accent::Vec => '⃗',
                    Accent::Dot => '˙',
                    Accent::Ddot => '¨',
                    Accent::Check => 'ˇ',
                    Accent::Breve => '˘',
                    Accent::Acute => 'ˊ',
                    _ => 'ˋ',
                };
                let found = self.fonts.find(mark, chain(MathVariant::Upright));
                let (font, glyph) = (found.font, found.glyph);
                let bounds = self.fonts.bounds(font, glyph);
                let ink = (bounds.x_max - bounds.x_min) * em;
                let wide = matches!(other, Accent::WideHat | Accent::WideTilde) || (other == Accent::Bar && width > 0.8 * em);
                let h_scale = if wide && ink > 0.0 { (width * 0.9 / ink).clamp(1.0, 6.0) } else { 1.0 };
                let centre = width / 2.0 + skew;
                let x = centre - h_scale * (bounds.x_min + bounds.x_max) / 2.0 * em;
                let bottom = height.max(X_HEIGHT * em) + 0.08 * em;
                let y = bottom - bounds.y_min * em;
                result.draws.push(Draw::Glyphs {
                    x,
                    y,
                    font,
                    size: em,
                    color: self.color,
                    glyphs: vec![Glyph { id: glyph, ch: found.ch, advance: self.fonts.advance(font, glyph) * em }],
                    h_scale,
                    v_scale: 1.0,
                });
                result.height = result.height.max(y + bounds.y_max * em);
            }
        }
        result
    }
}

/// TeX's rules 5 and 6: a binary operator with nothing to join is ordinary.
fn fix_binary_operators(atoms: &mut [(Option<AtomClass>, MathBox)]) {
    let classes = atoms.iter().enumerate().filter_map(|(index, (class, _))| class.map(|class| (index, class))).collect::<Vec<_>>();
    for (position, (index, class)) in classes.iter().enumerate() {
        if *class != AtomClass::Bin {
            continue;
        }
        let previous = position.checked_sub(1).map(|previous| classes[previous].1);
        let next = classes.get(position + 1).map(|(_, class)| *class);
        let lonely = matches!(previous, None | Some(AtomClass::Bin | AtomClass::Op | AtomClass::Rel | AtomClass::Open | AtomClass::Punct))
            || matches!(next, None | Some(AtomClass::Rel | AtomClass::Close | AtomClass::Punct));
        if lonely {
            atoms[*index].0 = Some(AtomClass::Ord);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::fonts::fonts;
    use super::*;
    use crate::export_render::math::parse_math;

    fn layout(latex: &str, display: bool) -> MathBox {
        let fonts = fonts().expect("fonts");
        MathLayout { fonts, size: 10.0, color: Rgb::TEXT }.formula(&parse_math(latex), display)
    }

    #[test]
    fn spaces_relations_and_binary_operators() {
        let tight = layout("ab", false).width;
        let relation = layout("a=b", false).width;
        let equals = layout("=", false).width;
        // Thick spaces (5/18 em) on both sides of `=`.
        assert!((relation - tight - equals - 2.0 * 5.0 / 18.0 * 10.0).abs() < 0.01);
        // A leading minus is a unary sign: no medium spaces.
        let negative = layout("-a", false).width;
        let minus = layout("-", false).width;
        let a = layout("a", false).width;
        assert!((negative - minus - a).abs() < 0.01);
    }

    #[test]
    fn stacks_fractions_and_limits() {
        let fraction = layout("\\frac{a}{b}", true);
        assert!(fraction.height > 1.0 && fraction.depth > 1.0);
        let inline = layout("\\frac{a}{b}", false);
        assert!(inline.height < fraction.height);
        let sum = layout("\\sum_{i=1}^{n} i", true);
        let side = layout("\\sum_{i=1}^{n} i", false);
        assert!(sum.height > side.height);
        assert!(sum.width < side.width);
    }

    #[test]
    fn grows_delimiters_and_roots_with_their_content() {
        let small = layout("\\left( x \\right)", true);
        let tall = layout("\\left( \\frac{\\frac{a}{b}}{\\frac{c}{d}} \\right)", true);
        assert!(tall.height + tall.depth > 2.0 * (small.height + small.depth));
        let root = layout("\\sqrt{x}", false);
        assert!(root.height > layout("x", false).height);
        assert!(root.draws.iter().any(|draw| matches!(draw, Draw::Line { .. })));
    }

    #[test]
    fn lays_out_matrices_and_cases() {
        let matrix = layout("\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}", true);
        let row = layout("\\begin{pmatrix} 1 & 2 \\end{pmatrix}", true);
        assert!(matrix.height + matrix.depth > row.height + row.depth);
        let cases = layout("f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{si no} \\end{cases}", true);
        assert!(cases.width > 30.0);
    }
}
