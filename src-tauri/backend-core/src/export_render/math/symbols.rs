//! What LaTeX commands and characters stand for, following KaTeX's tables.

use super::{Accent, AtomClass, MathVariant};
use AtomClass::{Bin, Close, Inner, Open, Ord, Punct, Rel};
use MathVariant::{Italic, Upright};

type Entry = (&'static str, char, AtomClass, MathVariant);

const SYMBOLS: &[Entry] = &[
    // Lowercase Greek letters are variables: italic.
    ("alpha", 'α', Ord, Italic), ("beta", 'β', Ord, Italic), ("gamma", 'γ', Ord, Italic),
    ("delta", 'δ', Ord, Italic), ("epsilon", 'ϵ', Ord, Italic), ("varepsilon", 'ε', Ord, Italic),
    ("zeta", 'ζ', Ord, Italic), ("eta", 'η', Ord, Italic), ("theta", 'θ', Ord, Italic),
    ("vartheta", 'ϑ', Ord, Italic), ("iota", 'ι', Ord, Italic), ("kappa", 'κ', Ord, Italic),
    ("lambda", 'λ', Ord, Italic), ("mu", 'μ', Ord, Italic), ("nu", 'ν', Ord, Italic),
    ("xi", 'ξ', Ord, Italic), ("omicron", 'ο', Ord, Italic), ("pi", 'π', Ord, Italic),
    ("varpi", 'ϖ', Ord, Italic), ("rho", 'ρ', Ord, Italic), ("varrho", 'ϱ', Ord, Italic),
    ("sigma", 'σ', Ord, Italic), ("varsigma", 'ς', Ord, Italic), ("tau", 'τ', Ord, Italic),
    ("upsilon", 'υ', Ord, Italic), ("phi", 'ϕ', Ord, Italic), ("varphi", 'φ', Ord, Italic),
    ("chi", 'χ', Ord, Italic), ("psi", 'ψ', Ord, Italic), ("omega", 'ω', Ord, Italic),
    // Uppercase Greek letters stand upright.
    ("Gamma", 'Γ', Ord, Upright), ("Delta", 'Δ', Ord, Upright), ("Theta", 'Θ', Ord, Upright),
    ("Lambda", 'Λ', Ord, Upright), ("Xi", 'Ξ', Ord, Upright), ("Pi", 'Π', Ord, Upright),
    ("Sigma", 'Σ', Ord, Upright), ("Upsilon", 'Υ', Ord, Upright), ("Phi", 'Φ', Ord, Upright),
    ("Psi", 'Ψ', Ord, Upright), ("Omega", 'Ω', Ord, Upright),
    // Ordinary symbols.
    ("infty", '∞', Ord, Upright), ("partial", '∂', Ord, Upright), ("nabla", '∇', Ord, Upright),
    ("forall", '∀', Ord, Upright), ("exists", '∃', Ord, Upright), ("nexists", '∄', Ord, Upright),
    ("emptyset", '∅', Ord, Upright), ("varnothing", '∅', Ord, Upright), ("hbar", 'ℏ', Ord, Upright),
    ("ell", 'ℓ', Ord, Upright), ("Re", 'ℜ', Ord, Upright), ("Im", 'ℑ', Ord, Upright),
    ("aleph", 'ℵ', Ord, Upright), ("wp", '℘', Ord, Upright), ("angle", '∠', Ord, Upright),
    ("triangle", '△', Ord, Upright), ("prime", '′', Ord, Upright), ("degree", '°', Ord, Upright),
    ("circ", '∘', Bin, Upright), ("neg", '¬', Ord, Upright), ("lnot", '¬', Ord, Upright),
    ("top", '⊤', Ord, Upright), ("bot", '⊥', Ord, Upright), ("surd", '√', Ord, Upright),
    ("checkmark", '✓', Ord, Upright), ("dagger", '†', Bin, Upright), ("ddagger", '‡', Bin, Upright),
    ("S", '§', Ord, Upright), ("P", '¶', Ord, Upright), ("imath", 'ı', Ord, Italic),
    ("jmath", 'ȷ', Ord, Italic), ("backslash", '\\', Ord, Upright), ("flat", '♭', Ord, Upright),
    ("sharp", '♯', Ord, Upright), ("natural", '♮', Ord, Upright), ("clubsuit", '♣', Ord, Upright),
    ("diamondsuit", '♢', Ord, Upright), ("heartsuit", '♡', Ord, Upright), ("spadesuit", '♠', Ord, Upright),
    ("ldots", '…', Inner, Upright), ("dots", '…', Inner, Upright), ("dotsc", '…', Inner, Upright),
    ("dotso", '…', Inner, Upright), ("cdots", '⋯', Inner, Upright), ("dotsb", '⋯', Inner, Upright),
    ("dotsm", '⋯', Inner, Upright), ("dotsi", '⋯', Inner, Upright), ("vdots", '⋮', Ord, Upright),
    ("ddots", '⋱', Inner, Upright), ("colon", ':', Punct, Upright),
    // Binary operators.
    ("pm", '±', Bin, Upright), ("mp", '∓', Bin, Upright), ("times", '×', Bin, Upright),
    ("div", '÷', Bin, Upright), ("cdot", '⋅', Bin, Upright), ("ast", '∗', Bin, Upright),
    ("star", '⋆', Bin, Upright), ("bullet", '∙', Bin, Upright), ("oplus", '⊕', Bin, Upright),
    ("ominus", '⊖', Bin, Upright), ("otimes", '⊗', Bin, Upright), ("oslash", '⊘', Bin, Upright),
    ("odot", '⊙', Bin, Upright), ("cup", '∪', Bin, Upright), ("cap", '∩', Bin, Upright),
    ("sqcup", '⊔', Bin, Upright), ("sqcap", '⊓', Bin, Upright), ("vee", '∨', Bin, Upright),
    ("lor", '∨', Bin, Upright), ("wedge", '∧', Bin, Upright), ("land", '∧', Bin, Upright),
    ("setminus", '∖', Bin, Upright), ("wr", '≀', Bin, Upright), ("diamond", '⋄', Bin, Upright),
    ("bigtriangleup", '△', Bin, Upright), ("bigtriangledown", '▽', Bin, Upright),
    ("triangleleft", '◃', Bin, Upright), ("triangleright", '▹', Bin, Upright), ("uplus", '⊎', Bin, Upright),
    ("amalg", '⨿', Bin, Upright),
    // Relations and arrows.
    ("leq", '≤', Rel, Upright), ("le", '≤', Rel, Upright), ("geq", '≥', Rel, Upright),
    ("ge", '≥', Rel, Upright), ("leqslant", '⩽', Rel, Upright), ("geqslant", '⩾', Rel, Upright),
    ("neq", '≠', Rel, Upright), ("ne", '≠', Rel, Upright), ("equiv", '≡', Rel, Upright),
    ("approx", '≈', Rel, Upright), ("sim", '∼', Rel, Upright), ("simeq", '≃', Rel, Upright),
    ("cong", '≅', Rel, Upright), ("propto", '∝', Rel, Upright), ("ll", '≪', Rel, Upright),
    ("gg", '≫', Rel, Upright), ("subset", '⊂', Rel, Upright), ("supset", '⊃', Rel, Upright),
    ("subseteq", '⊆', Rel, Upright), ("supseteq", '⊇', Rel, Upright), ("subsetneq", '⊊', Rel, Upright),
    ("in", '∈', Rel, Upright), ("ni", '∋', Rel, Upright), ("notin", '∉', Rel, Upright),
    ("mid", '∣', Rel, Upright), ("nmid", '∤', Rel, Upright), ("parallel", '∥', Rel, Upright),
    ("perp", '⊥', Rel, Upright), ("models", '⊨', Rel, Upright), ("vdash", '⊢', Rel, Upright),
    ("dashv", '⊣', Rel, Upright), ("doteq", '≐', Rel, Upright), ("asymp", '≍', Rel, Upright),
    ("prec", '≺', Rel, Upright), ("succ", '≻', Rel, Upright), ("preceq", '⪯', Rel, Upright),
    ("succeq", '⪰', Rel, Upright), ("lesssim", '≲', Rel, Upright), ("gtrsim", '≳', Rel, Upright),
    ("nleq", '≰', Rel, Upright), ("ngeq", '≱', Rel, Upright), ("coloneqq", '≔', Rel, Upright),
    ("to", '→', Rel, Upright), ("rightarrow", '→', Rel, Upright), ("leftarrow", '←', Rel, Upright),
    ("gets", '←', Rel, Upright), ("leftrightarrow", '↔', Rel, Upright), ("Rightarrow", '⇒', Rel, Upright),
    ("Leftarrow", '⇐', Rel, Upright), ("Leftrightarrow", '⇔', Rel, Upright), ("implies", '⟹', Rel, Upright),
    ("impliedby", '⟸', Rel, Upright), ("iff", '⟺', Rel, Upright), ("mapsto", '↦', Rel, Upright),
    ("longrightarrow", '⟶', Rel, Upright), ("longleftarrow", '⟵', Rel, Upright),
    ("longleftrightarrow", '⟷', Rel, Upright), ("Longrightarrow", '⟹', Rel, Upright),
    ("Longleftarrow", '⟸', Rel, Upright), ("Longleftrightarrow", '⟺', Rel, Upright),
    ("longmapsto", '⟼', Rel, Upright), ("uparrow", '↑', Rel, Upright), ("downarrow", '↓', Rel, Upright),
    ("updownarrow", '↕', Rel, Upright), ("Uparrow", '⇑', Rel, Upright), ("Downarrow", '⇓', Rel, Upright),
    ("nearrow", '↗', Rel, Upright), ("searrow", '↘', Rel, Upright), ("swarrow", '↙', Rel, Upright),
    ("nwarrow", '↖', Rel, Upright), ("hookrightarrow", '↪', Rel, Upright), ("hookleftarrow", '↩', Rel, Upright),
    ("rightleftharpoons", '⇌', Rel, Upright), ("leftrightharpoons", '⇋', Rel, Upright),
    ("rightharpoonup", '⇀', Rel, Upright), ("leftharpoonup", '↼', Rel, Upright),
    // Delimiters used on their own.
    ("lbrace", '{', Open, Upright), ("rbrace", '}', Close, Upright), ("langle", '⟨', Open, Upright),
    ("rangle", '⟩', Close, Upright), ("lfloor", '⌊', Open, Upright), ("rfloor", '⌋', Close, Upright),
    ("lceil", '⌈', Open, Upright), ("rceil", '⌉', Close, Upright), ("vert", '|', Ord, Upright),
    ("Vert", '‖', Ord, Upright), ("lvert", '|', Open, Upright), ("rvert", '|', Close, Upright),
    ("lVert", '‖', Open, Upright), ("rVert", '‖', Close, Upright), ("lbrack", '[', Open, Upright),
    ("rbrack", ']', Close, Upright),
];

const LARGE_OPERATORS: &[(&str, char)] = &[
    ("sum", '∑'), ("prod", '∏'), ("coprod", '∐'), ("int", '∫'), ("iint", '∬'), ("iiint", '∭'),
    ("oint", '∮'), ("bigcup", '⋃'), ("bigcap", '⋂'), ("bigoplus", '⨁'), ("bigotimes", '⨂'),
    ("bigodot", '⨀'), ("bigvee", '⋁'), ("bigwedge", '⋀'), ("biguplus", '⨄'), ("bigsqcup", '⨆'),
];

/// Operator names; `true` when they take limits below in display style.
const OPERATOR_NAMES: &[(&str, bool)] = &[
    ("arccos", false), ("arcsin", false), ("arctan", false), ("arg", false), ("cos", false),
    ("cosh", false), ("cot", false), ("coth", false), ("csc", false), ("deg", false), ("det", true),
    ("dim", false), ("exp", false), ("gcd", true), ("hom", false), ("inf", true), ("ker", false),
    ("lg", false), ("lim", true), ("liminf", true), ("limsup", true), ("ln", false), ("log", false),
    ("max", true), ("min", true), ("Pr", true), ("sec", false), ("sin", false), ("sinh", false),
    ("sup", true), ("tan", false), ("tanh", false), ("sgn", false), ("mod", false),
];

pub(super) fn command_symbol(name: &str) -> Option<(char, AtomClass, MathVariant)> {
    SYMBOLS
        .iter()
        .find(|(command, ..)| *command == name)
        .map(|(_, ch, class, variant)| (*ch, *class, *variant))
}

pub(super) fn large_operator(name: &str) -> Option<char> {
    LARGE_OPERATORS.iter().find(|(command, _)| *command == name).map(|(_, ch)| *ch)
}

/// Whether `ch` is drawn as a large operator (someone typed `∑` directly).
pub(crate) fn is_large_operator(ch: char) -> bool {
    LARGE_OPERATORS.iter().any(|(_, symbol)| *symbol == ch)
}

/// Integrals keep their scripts beside them, even in display style.
pub(crate) fn is_integral(ch: char) -> bool {
    matches!(ch, '∫' | '∬' | '∭' | '∮')
}

pub(super) fn operator_name(name: &str) -> Option<(String, bool)> {
    OPERATOR_NAMES.iter().find(|(command, _)| *command == name).map(|(command, limits)| {
        let text = match *command {
            "liminf" => "lim inf",
            "limsup" => "lim sup",
            other => other,
        };
        (text.to_string(), *limits)
    })
}

/// A delimiter written as a command (`\langle`) or a character (`(`).
pub(super) fn delimiter(token: &str) -> Option<char> {
    Some(match token {
        "(" => '(',
        ")" => ')',
        "[" => '[',
        "]" => ']',
        "|" | "vert" | "lvert" | "rvert" => '|',
        "\\|" | "|\\" | "Vert" | "lVert" | "rVert" => '‖',
        "{" | "lbrace" => '{',
        "}" | "rbrace" => '}',
        "langle" | "<" => '⟨',
        "rangle" | ">" => '⟩',
        "lfloor" => '⌊',
        "rfloor" => '⌋',
        "lceil" => '⌈',
        "rceil" => '⌉',
        "/" => '/',
        "backslash" => '\\',
        "uparrow" => '↑',
        "downarrow" => '↓',
        "updownarrow" => '↕',
        "Uparrow" => '⇑',
        "Downarrow" => '⇓',
        _ => return None,
    })
}

pub(super) fn accent(name: &str) -> Option<Accent> {
    Some(match name {
        "hat" => Accent::Hat,
        "widehat" => Accent::WideHat,
        "tilde" => Accent::Tilde,
        "widetilde" => Accent::WideTilde,
        "bar" => Accent::Bar,
        "overline" => Accent::Overline,
        "underline" => Accent::Underline,
        "vec" => Accent::Vec,
        "overrightarrow" => Accent::OverRightArrow,
        "overleftarrow" => Accent::OverLeftArrow,
        "dot" => Accent::Dot,
        "ddot" => Accent::Ddot,
        "check" => Accent::Check,
        "breve" => Accent::Breve,
        "acute" => Accent::Acute,
        "grave" => Accent::Grave,
        "overbrace" => Accent::OverBrace,
        "underbrace" => Accent::UnderBrace,
        _ => return None,
    })
}

/// Width of spacing commands, in ems (a `mu` is 1/18 em).
pub(super) fn space(name: &str) -> Option<f32> {
    Some(match name {
        "," | "thinspace" => 3.0 / 18.0,
        ":" | ">" | "medspace" => 4.0 / 18.0,
        ";" | "thickspace" => 5.0 / 18.0,
        "!" | "negthinspace" => -3.0 / 18.0,
        " " | "space" => 0.25,
        "enspace" => 0.5,
        "quad" => 1.0,
        "qquad" => 2.0,
        _ => return None,
    })
}

/// `\not` before a relation.
pub(super) fn negated(ch: char) -> Option<char> {
    Some(match ch {
        '=' => '≠',
        '<' => '≮',
        '>' => '≯',
        '∈' => '∉',
        '≡' => '≢',
        '⊂' => '⊄',
        '⊃' => '⊅',
        '⊆' => '⊈',
        '⊇' => '⊉',
        '≤' => '≰',
        '≥' => '≱',
        '∼' => '≁',
        '≈' => '≉',
        '∣' | '|' => '∤',
        '∥' => '∦',
        '∃' => '∄',
        '≃' => '≄',
        '≅' => '≇',
        _ => return None,
    })
}

/// A character typed in a formula: its glyph, class and family.
pub(super) fn character(ch: char) -> (char, AtomClass, MathVariant) {
    match ch {
        'a'..='z' | 'A'..='Z' => (ch, Ord, Italic),
        '0'..='9' | '.' | '/' | '@' | '"' | '|' => (ch, Ord, Upright),
        '+' => ('+', Bin, Upright),
        '-' | '−' => ('−', Bin, Upright),
        '*' => ('∗', Bin, Upright),
        '=' | '<' | '>' | ':' => (ch, Rel, Upright),
        '(' | '[' => (ch, Open, Upright),
        ')' | ']' | '!' | '?' => (ch, Close, Upright),
        ',' | ';' => (ch, Punct, Upright),
        '\'' => ('′', Ord, Upright),
        'ℂ' => ('C', Ord, MathVariant::DoubleStruck),
        'ℍ' => ('H', Ord, MathVariant::DoubleStruck),
        'ℕ' => ('N', Ord, MathVariant::DoubleStruck),
        'ℙ' => ('P', Ord, MathVariant::DoubleStruck),
        'ℚ' => ('Q', Ord, MathVariant::DoubleStruck),
        'ℝ' => ('R', Ord, MathVariant::DoubleStruck),
        'ℤ' => ('Z', Ord, MathVariant::DoubleStruck),
        _ => SYMBOLS
            .iter()
            .find(|(_, symbol, ..)| *symbol == ch)
            .map(|(_, symbol, class, variant)| (*symbol, *class, *variant))
            .unwrap_or_else(|| {
                let lower_greek = ('α'..='ω').contains(&ch);
                (ch, Ord, if lower_greek { Italic } else { Upright })
            }),
    }
}

/// The character a styled letter stands for, for copying text out of the PDF.
pub(crate) fn styled_character(ch: char, variant: MathVariant) -> char {
    if variant != MathVariant::DoubleStruck || !ch.is_ascii_uppercase() {
        return ch;
    }
    match ch {
        'C' => 'ℂ',
        'H' => 'ℍ',
        'N' => 'ℕ',
        'P' => 'ℙ',
        'Q' => 'ℚ',
        'R' => 'ℝ',
        'Z' => 'ℤ',
        _ => char::from_u32(0x1D538 + (u32::from(ch) - u32::from('A'))).unwrap_or(ch),
    }
}
