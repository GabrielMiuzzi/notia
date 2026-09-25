//! Formulas as Word equations (Office Math Markup Language). Word lays them
//! out itself, so they stay editable text in the document.

use super::symbols::is_integral;
use super::{Accent, ArrayKind, AtomClass, ColumnAlign, MathNode, MathVariant};
use crate::export_render::escape_xml;

/// Content of an `<m:oMath>` element for `nodes`.
pub(crate) fn omml(nodes: &[MathNode]) -> String {
    let mut writer = Writer::default();
    writer.list(nodes);
    writer.out
}

#[derive(Default)]
struct Writer {
    out: String,
    /// The next run carries the row's alignment point (`&` in `aligned`).
    align_next: bool,
}

/// A large operator with the scripts attached to it.
struct Nary<'a> {
    symbol: char,
    limits: bool,
    sub: Option<&'a [MathNode]>,
    sup: Option<&'a [MathNode]>,
}

/// An operator name (`sin`, `lim`) with the scripts attached to it.
struct Function<'a> {
    name: &'a str,
    limits: bool,
    sub: Option<&'a [MathNode]>,
    sup: Option<&'a [MathNode]>,
}

fn nary(node: &MathNode) -> Option<Nary<'_>> {
    let (base, sub, sup) = match node {
        MathNode::Scripts { base, sub, sup } => (base.as_ref(), sub.as_deref(), sup.as_deref()),
        other => (other, None, None),
    };
    match base {
        MathNode::LargeOp { symbol, limits } => Some(Nary { symbol: *symbol, limits: limits.unwrap_or(!is_integral(*symbol)), sub, sup }),
        _ => None,
    }
}

fn function(node: &MathNode) -> Option<Function<'_>> {
    let (base, sub, sup) = match node {
        MathNode::Scripts { base, sub, sup } => (base.as_ref(), sub.as_deref(), sup.as_deref()),
        other => (other, None, None),
    };
    match base {
        MathNode::Text { text, class: AtomClass::Op, limits, .. } => Some(Function { name: text, limits: *limits, sub, sup }),
        _ => None,
    }
}

/// Where an atom ends a large operator's operand: a relation, a binary
/// operator or punctuation outside any parentheses.
fn is_boundary(node: &MathNode) -> bool {
    matches!(node.class(), AtomClass::Rel | AtomClass::Bin | AtomClass::Punct)
}

/// End of the operand after a large operator: Word wants it inside the
/// operator, LaTeX writes it after.
fn operand_end(nodes: &[MathNode], start: usize) -> usize {
    let mut depth = 0usize;
    let mut end = start;
    while let Some(node) = nodes.get(end) {
        match node.class() {
            AtomClass::Open => depth += 1,
            AtomClass::Close if depth == 0 => break,
            AtomClass::Close => depth -= 1,
            _ if depth == 0 && is_boundary(node) => break,
            _ => {}
        }
        end += 1;
    }
    end
}

impl Writer {
    fn list(&mut self, nodes: &[MathNode]) {
        let mut index = 0;
        while let Some(node) = nodes.get(index) {
            if let Some(nary) = nary(node) {
                let end = operand_end(nodes, index + 1);
                self.nary(&nary, &nodes[index + 1..end]);
                index = end;
            } else if let Some(function) = function(node) {
                let end = match nodes.get(index + 1) {
                    Some(next) if !is_boundary(next) && next.class() != AtomClass::Close => index + 2,
                    _ => index + 1,
                };
                self.function(&function, &nodes[index + 1..end]);
                index = end;
            } else {
                self.node(node);
                index += 1;
            }
        }
    }

    fn element(&mut self, tag: &str, nodes: &[MathNode]) {
        self.out.push_str(&format!("<m:{tag}>"));
        self.list(nodes);
        self.out.push_str(&format!("</m:{tag}>"));
    }

    fn node(&mut self, node: &MathNode) {
        match node {
            MathNode::Symbol { ch, variant, .. } => self.run(&ch.to_string(), *variant),
            MathNode::Text { text, class, bold, .. } => {
                if *class == AtomClass::Ord {
                    self.text_run(text, *bold);
                } else {
                    self.run(text, MathVariant::Upright);
                }
            }
            MathNode::Group(inner) | MathNode::Styled { body: inner, .. } => self.list(inner),
            MathNode::Fraction { numerator, denominator, rule, delimiters, .. } => {
                if let Some((left, right)) = delimiters {
                    self.delimiters_open(Some(*left), Some(*right));
                }
                self.out.push_str("<m:f>");
                if !rule {
                    self.out.push_str("<m:fPr><m:type m:val=\"noBar\"/></m:fPr>");
                }
                self.element("num", numerator);
                self.element("den", denominator);
                self.out.push_str("</m:f>");
                if delimiters.is_some() {
                    self.out.push_str("</m:e></m:d>");
                }
            }
            MathNode::Root { index, body } => {
                self.out.push_str("<m:rad>");
                match index {
                    Some(index) => self.element("deg", index),
                    None => self.out.push_str("<m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/>"),
                }
                self.element("e", body);
                self.out.push_str("</m:rad>");
            }
            MathNode::Scripts { base, sup, sub } => self.scripts(base, sup.as_deref(), sub.as_deref()),
            MathNode::LargeOp { .. } => {
                if let Some(nary) = nary(node) {
                    self.nary(&nary, &[]);
                }
            }
            MathNode::Delimited { left, right, body } => {
                self.delimiters_open(*left, *right);
                self.list(body);
                self.out.push_str("</m:e></m:d>");
            }
            MathNode::SizedDelimiter { ch, .. } => self.run(&ch.to_string(), MathVariant::Upright),
            MathNode::Array { kind, rows, columns, left, right } => self.array(*kind, rows, columns, *left, *right),
            MathNode::Accent { accent, body } => self.accent(*accent, body),
            MathNode::Stack { base, over, under, .. } => self.stack(base, over.as_deref(), under.as_deref()),
            MathNode::Space(width) => {
                let space = space_characters(*width);
                if !space.is_empty() {
                    self.out.push_str(&format!("<m:r><m:t xml:space=\"preserve\">{space}</m:t></m:r>"));
                }
            }
        }
    }

    /// A math run; Word italicizes letters itself, so only other families say so.
    fn run(&mut self, text: &str, variant: MathVariant) {
        let has_letter = text.chars().any(char::is_alphabetic);
        let mut properties = String::new();
        let script = match variant {
            MathVariant::DoubleStruck => Some("double-struck"),
            MathVariant::Calligraphic | MathVariant::Script => Some("script"),
            MathVariant::Fraktur => Some("fraktur"),
            MathVariant::SansSerif => Some("sans-serif"),
            MathVariant::Monospace => Some("monospace"),
            _ => None,
        };
        if let Some(script) = script {
            properties.push_str(&format!("<m:scr m:val=\"{script}\"/>"));
        }
        let style = match variant {
            MathVariant::Italic => None,
            MathVariant::Bold => Some("b"),
            MathVariant::BoldItalic => Some("bi"),
            _ if has_letter => Some("p"),
            _ => None,
        };
        if let Some(style) = style {
            properties.push_str(&format!("<m:sty m:val=\"{style}\"/>"));
        }
        if std::mem::take(&mut self.align_next) {
            properties.push_str("<m:aln/>");
        }
        self.out.push_str("<m:r>");
        if !properties.is_empty() {
            self.out.push_str(&format!("<m:rPr>{properties}</m:rPr>"));
        }
        self.out.push_str(&format!("<m:t xml:space=\"preserve\">{}</m:t></m:r>", escape_xml(text)));
    }

    /// `\text{…}`: normal text inside the equation.
    fn text_run(&mut self, text: &str, bold: bool) {
        let align = if std::mem::take(&mut self.align_next) { "<m:aln/>" } else { "" };
        let weight = if bold { "<w:rPr><w:b/></w:rPr>" } else { "" };
        self.out.push_str(&format!(
            "<m:r><m:rPr><m:nor/>{align}</m:rPr>{weight}<m:t xml:space=\"preserve\">{}</m:t></m:r>",
            escape_xml(text)
        ));
    }

    fn delimiters_open(&mut self, left: Option<char>, right: Option<char>) {
        let value = |ch: Option<char>| ch.map(|ch| escape_xml(&ch.to_string())).unwrap_or_default();
        self.out.push_str(&format!(
            "<m:d><m:dPr><m:begChr m:val=\"{}\"/><m:endChr m:val=\"{}\"/></m:dPr><m:e>",
            value(left),
            value(right)
        ));
    }

    fn scripts(&mut self, base: &MathNode, sup: Option<&[MathNode]>, sub: Option<&[MathNode]>) {
        match (base, sup, sub) {
            (MathNode::Accent { accent: Accent::OverBrace, .. }, Some(label), None) => {
                self.out.push_str("<m:limUpp><m:e>");
                self.node(base);
                self.out.push_str("</m:e>");
                self.element("lim", label);
                self.out.push_str("</m:limUpp>");
            }
            (MathNode::Accent { accent: Accent::UnderBrace, .. }, None, Some(label)) => {
                self.out.push_str("<m:limLow><m:e>");
                self.node(base);
                self.out.push_str("</m:e>");
                self.element("lim", label);
                self.out.push_str("</m:limLow>");
            }
            (_, Some(sup), Some(sub)) => {
                self.out.push_str("<m:sSubSup><m:e>");
                self.node(base);
                self.out.push_str("</m:e>");
                self.element("sub", sub);
                self.element("sup", sup);
                self.out.push_str("</m:sSubSup>");
            }
            (_, Some(sup), None) => {
                self.out.push_str("<m:sSup><m:e>");
                self.node(base);
                self.out.push_str("</m:e>");
                self.element("sup", sup);
                self.out.push_str("</m:sSup>");
            }
            (_, None, Some(sub)) => {
                self.out.push_str("<m:sSub><m:e>");
                self.node(base);
                self.out.push_str("</m:e>");
                self.element("sub", sub);
                self.out.push_str("</m:sSub>");
            }
            (_, None, None) => self.node(base),
        }
    }

    fn nary(&mut self, nary: &Nary<'_>, operand: &[MathNode]) {
        let location = if nary.limits { "undOvr" } else { "subSup" };
        self.out.push_str(&format!(
            "<m:nary><m:naryPr><m:chr m:val=\"{}\"/><m:limLoc m:val=\"{location}\"/>",
            nary.symbol
        ));
        if nary.sub.is_none() {
            self.out.push_str("<m:subHide m:val=\"1\"/>");
        }
        if nary.sup.is_none() {
            self.out.push_str("<m:supHide m:val=\"1\"/>");
        }
        self.out.push_str("</m:naryPr>");
        self.element("sub", nary.sub.unwrap_or_default());
        self.element("sup", nary.sup.unwrap_or_default());
        self.element("e", operand);
        self.out.push_str("</m:nary>");
    }

    fn function(&mut self, function: &Function<'_>, argument: &[MathNode]) {
        self.out.push_str("<m:func><m:fName>");
        match (function.limits, function.sub, function.sup) {
            (true, Some(sub), _) => {
                self.out.push_str("<m:limLow><m:e>");
                self.run(function.name, MathVariant::Upright);
                self.out.push_str("</m:e>");
                self.element("lim", sub);
                self.out.push_str("</m:limLow>");
            }
            (_, sub, sup) => {
                let name = MathNode::Text { text: function.name.to_string(), class: AtomClass::Op, limits: false, bold: false };
                self.scripts(&name, sup, sub);
            }
        }
        self.out.push_str("</m:fName>");
        self.element("e", argument);
        self.out.push_str("</m:func>");
    }

    fn array(&mut self, kind: ArrayKind, rows: &[Vec<Vec<MathNode>>], columns: &[ColumnAlign], left: Option<char>, right: Option<char>) {
        if matches!(kind, ArrayKind::Aligned | ArrayKind::Gathered) {
            self.out.push_str("<m:eqArr>");
            for row in rows {
                self.out.push_str("<m:e>");
                for (index, cell) in row.iter().enumerate() {
                    self.align_next = kind == ArrayKind::Aligned && index == 1;
                    self.list(cell);
                }
                self.align_next = false;
                self.out.push_str("</m:e>");
            }
            self.out.push_str("</m:eqArr>");
            return;
        }
        let count = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
        let delimited = left.is_some() || right.is_some();
        if delimited {
            self.delimiters_open(left, right);
        }
        self.out.push_str("<m:m>");
        let alignments = (0..count)
            .map(|index| match kind {
                ArrayKind::Cases => ColumnAlign::Left,
                ArrayKind::Array => columns.get(index).copied().unwrap_or(ColumnAlign::Center),
                _ => ColumnAlign::Center,
            })
            .collect::<Vec<_>>();
        if alignments.iter().any(|align| *align != ColumnAlign::Center) {
            self.out.push_str("<m:mPr><m:mcs>");
            for align in &alignments {
                let value = match align {
                    ColumnAlign::Left => "left",
                    ColumnAlign::Center => "center",
                    ColumnAlign::Right => "right",
                };
                self.out.push_str(&format!("<m:mc><m:mcPr><m:count m:val=\"1\"/><m:mcJc m:val=\"{value}\"/></m:mcPr></m:mc>"));
            }
            self.out.push_str("</m:mcs></m:mPr>");
        }
        for row in rows {
            self.out.push_str("<m:mr>");
            for index in 0..count {
                self.element("e", row.get(index).map(Vec::as_slice).unwrap_or_default());
            }
            self.out.push_str("</m:mr>");
        }
        self.out.push_str("</m:m>");
        if delimited {
            self.out.push_str("</m:e></m:d>");
        }
    }

    fn accent(&mut self, accent: Accent, body: &[MathNode]) {
        let group = |ch: &str, top: bool| {
            let (position, justification) = if top { ("top", "bot") } else { ("bot", "top") };
            format!("<m:groupChr><m:groupChrPr><m:chr m:val=\"{ch}\"/><m:pos m:val=\"{position}\"/><m:vertJc m:val=\"{justification}\"/></m:groupChrPr><m:e>")
        };
        let (open, close) = match accent {
            Accent::Overline => ("<m:bar><m:barPr><m:pos m:val=\"top\"/></m:barPr><m:e>".to_string(), "</m:e></m:bar>"),
            Accent::Underline => ("<m:bar><m:barPr><m:pos m:val=\"bot\"/></m:barPr><m:e>".to_string(), "</m:e></m:bar>"),
            Accent::OverBrace => (group("\u{23DE}", true), "</m:e></m:groupChr>"),
            Accent::UnderBrace => (group("\u{23DF}", false), "</m:e></m:groupChr>"),
            Accent::OverRightArrow => (group("\u{2192}", true), "</m:e></m:groupChr>"),
            Accent::OverLeftArrow => (group("\u{2190}", true), "</m:e></m:groupChr>"),
            other => {
                let mark = match other {
                    Accent::Hat | Accent::WideHat => '\u{302}',
                    Accent::Tilde | Accent::WideTilde => '\u{303}',
                    Accent::Bar => '\u{305}',
                    Accent::Vec => '\u{20D7}',
                    Accent::Dot => '\u{307}',
                    Accent::Ddot => '\u{308}',
                    Accent::Check => '\u{30C}',
                    Accent::Breve => '\u{306}',
                    Accent::Acute => '\u{301}',
                    _ => '\u{300}',
                };
                (format!("<m:acc><m:accPr><m:chr m:val=\"{mark}\"/></m:accPr><m:e>"), "</m:e></m:acc>")
            }
        };
        self.out.push_str(&open);
        self.list(body);
        self.out.push_str(close);
    }

    fn stack(&mut self, base: &[MathNode], over: Option<&[MathNode]>, under: Option<&[MathNode]>) {
        if under.is_some() {
            self.out.push_str("<m:limLow><m:e>");
        }
        if let Some(over) = over {
            self.out.push_str("<m:limUpp><m:e>");
            self.list(base);
            self.out.push_str("</m:e>");
            self.element("lim", over);
            self.out.push_str("</m:limUpp>");
        } else {
            self.list(base);
        }
        if let Some(under) = under {
            self.out.push_str("</m:e>");
            self.element("lim", under);
            self.out.push_str("</m:limLow>");
        }
    }
}

/// Unicode spaces closest to a width in ems.
fn space_characters(width: f32) -> String {
    if width <= 0.0 {
        return String::new();
    }
    let quads = width.floor() as usize;
    let rest = width - quads as f32;
    let mut space = "\u{2003}".repeat(quads);
    if rest >= 0.4 {
        space.push('\u{2002}');
    } else if rest >= 0.25 {
        space.push('\u{2004}');
    } else if rest >= 0.2 {
        space.push('\u{205F}');
    } else if rest >= 0.1 {
        space.push('\u{2009}');
    }
    space
}

#[cfg(test)]
mod tests {
    use super::super::parse_math;
    use super::*;

    fn render(latex: &str) -> String {
        omml(&parse_math(latex))
    }

    #[test]
    fn writes_fractions_scripts_and_roots() {
        assert_eq!(
            render("\\frac{a}{b}"),
            "<m:f><m:num><m:r><m:t xml:space=\"preserve\">a</m:t></m:r></m:num><m:den><m:r><m:t xml:space=\"preserve\">b</m:t></m:r></m:den></m:f>"
        );
        assert_eq!(
            render("x^2"),
            "<m:sSup><m:e><m:r><m:t xml:space=\"preserve\">x</m:t></m:r></m:e><m:sup><m:r><m:t xml:space=\"preserve\">2</m:t></m:r></m:sup></m:sSup>"
        );
        assert!(render("\\sqrt{2}").starts_with("<m:rad><m:radPr><m:degHide m:val=\"1\"/></m:radPr><m:deg/><m:e>"));
        assert!(render("\\sqrt[3]{2}").starts_with("<m:rad><m:deg><m:r>"));
    }

    #[test]
    fn puts_the_operand_inside_large_operators() {
        let sum = render("\\sum_{i=1}^{n} a_i + 1");
        assert!(sum.starts_with("<m:nary><m:naryPr><m:chr m:val=\"∑\"/><m:limLoc m:val=\"undOvr\"/></m:naryPr><m:sub>"));
        assert!(sum.contains("<m:e><m:sSub><m:e><m:r><m:t xml:space=\"preserve\">a</m:t>"));
        assert!(sum.ends_with("</m:nary><m:r><m:t xml:space=\"preserve\">+</m:t></m:r><m:r><m:t xml:space=\"preserve\">1</m:t></m:r>"));
        let integral = render("\\int_0^1 f(x)\\,dx = 1");
        assert!(integral.contains("<m:limLoc m:val=\"subSup\"/>"));
        assert!(integral.contains("<m:t xml:space=\"preserve\">d</m:t></m:r><m:r><m:t xml:space=\"preserve\">x</m:t></m:r></m:e></m:nary>"));
    }

    #[test]
    fn writes_functions_matrices_and_text() {
        let limit = render("\\lim_{x \\to 0} \\frac{\\sin x}{x}");
        assert!(limit.starts_with("<m:func><m:fName><m:limLow><m:e><m:r><m:rPr><m:sty m:val=\"p\"/></m:rPr><m:t xml:space=\"preserve\">lim</m:t>"));
        let matrix = render("\\begin{pmatrix} 1 & 0 \\\\ 0 \\end{pmatrix}");
        assert!(matrix.starts_with("<m:d><m:dPr><m:begChr m:val=\"(\"/><m:endChr m:val=\")\"/></m:dPr><m:e><m:m><m:mr>"));
        assert_eq!(matrix.matches("<m:e>").count(), 5);
        assert!(render("\\text{si } x < 0").starts_with("<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space=\"preserve\">si </m:t></m:r>"));
        assert!(render("x < 0").contains("&lt;"));
        let aligned = render("a &= b \\\\ &= c");
        assert!(aligned.starts_with("<m:eqArr><m:e>"));
        assert_eq!(aligned.matches("<m:aln/>").count(), 2);
    }
}
