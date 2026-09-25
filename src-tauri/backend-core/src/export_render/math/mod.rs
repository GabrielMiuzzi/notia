//! LaTeX formulas, parsed once and written twice: as Word equations (OMML)
//! and as glyphs laid out on the PDF page. Both keep the formula as text,
//! never as an image.

pub(crate) mod omml;
mod parse;
pub(crate) mod symbols;

pub(crate) use parse::parse_math;

/// TeX's atom classes; they decide the space between neighbours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AtomClass {
    Ord,
    Op,
    Bin,
    Rel,
    Open,
    Close,
    Punct,
    Inner,
}

/// Font family a symbol is drawn with, as KaTeX names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MathVariant {
    /// Variables: Latin and lowercase Greek letters.
    Italic,
    Upright,
    Bold,
    BoldItalic,
    DoubleStruck,
    Calligraphic,
    Fraktur,
    Script,
    SansSerif,
    Monospace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MathStyle {
    Display,
    Text,
    Script,
    ScriptScript,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Accent {
    Hat,
    WideHat,
    Tilde,
    WideTilde,
    Bar,
    Overline,
    Underline,
    Vec,
    OverRightArrow,
    OverLeftArrow,
    Dot,
    Ddot,
    Check,
    Breve,
    Acute,
    Grave,
    OverBrace,
    UnderBrace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ArrayKind {
    Matrix,
    SmallMatrix,
    /// Left-aligned columns (`cases`).
    Cases,
    /// Columns alternating right and left (`aligned`, `align`, `split`).
    Aligned,
    /// One centred column (`gathered`, `gather`).
    Gathered,
    /// Columns aligned as `array`'s specification says.
    Array,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ColumnAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MathNode {
    /// One letter, digit, operator or delimiter.
    Symbol { ch: char, class: AtomClass, variant: MathVariant },
    /// Upright words: `\text{…}` and operator names such as `sin` or `lim`.
    Text { text: String, class: AtomClass, limits: bool, bold: bool },
    /// A braced group, laid out as one ordinary atom.
    Group(Vec<MathNode>),
    Fraction {
        numerator: Vec<MathNode>,
        denominator: Vec<MathNode>,
        /// `false` for binomials.
        rule: bool,
        /// `\dfrac` and `\tfrac` force a style.
        style: Option<MathStyle>,
        delimiters: Option<(char, char)>,
    },
    Root { index: Option<Vec<MathNode>>, body: Vec<MathNode> },
    Scripts { base: Box<MathNode>, sup: Option<Vec<MathNode>>, sub: Option<Vec<MathNode>> },
    /// `∑`, `∫` and the like; `limits` is `None` unless `\limits` or `\nolimits` said.
    LargeOp { symbol: char, limits: Option<bool> },
    /// `\left … \right`; `None` is the invisible `.` delimiter.
    Delimited { left: Option<char>, right: Option<char>, body: Vec<MathNode> },
    /// `\big(` … `\Bigg)`: size 1 to 4.
    SizedDelimiter { ch: char, size: u8, class: AtomClass },
    Array {
        kind: ArrayKind,
        rows: Vec<Vec<Vec<MathNode>>>,
        columns: Vec<ColumnAlign>,
        left: Option<char>,
        right: Option<char>,
    },
    Accent { accent: Accent, body: Vec<MathNode> },
    /// `\overset`, `\underset` and `\stackrel`.
    Stack { base: Vec<MathNode>, over: Option<Vec<MathNode>>, under: Option<Vec<MathNode>>, class: AtomClass },
    /// Horizontal space in ems (negative for `\!`).
    Space(f32),
    /// `\displaystyle` and friends, applied to the rest of the group.
    Styled { style: MathStyle, body: Vec<MathNode> },
}

impl MathNode {
    /// Class of the atom this node makes.
    pub fn class(&self) -> AtomClass {
        match self {
            MathNode::Symbol { class, .. } | MathNode::Text { class, .. } | MathNode::SizedDelimiter { class, .. } | MathNode::Stack { class, .. } => *class,
            MathNode::LargeOp { .. } => AtomClass::Op,
            MathNode::Scripts { base, .. } => base.class(),
            MathNode::Delimited { .. } => AtomClass::Inner,
            MathNode::Fraction { delimiters: Some(_), .. } => AtomClass::Inner,
            _ => AtomClass::Ord,
        }
    }
}
