//! What an export shows of a note: its blocks and their formatted text,
//! without the Markdown syntax or the properties. Both writers (PDF and DOCX)
//! render this model.

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Document {
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Align {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Block {
    Heading { level: u8, align: Align, content: Vec<Inline> },
    Paragraph { align: Align, content: Vec<Inline> },
    List(List),
    Quote(Vec<Block>),
    Code { text: String },
    /// A display formula, as LaTeX.
    Math(String),
    Table(Table),
    Rule,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct List {
    /// First number of an ordered list; `None` for bullets.
    pub start: Option<u64>,
    pub items: Vec<ListItem>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ListItem {
    /// Checkbox of a task list item.
    pub task: Option<bool>,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Table {
    pub columns: Vec<Align>,
    pub header: Vec<Vec<Inline>>,
    pub rows: Vec<Vec<Vec<Inline>>>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Inline {
    Text { text: String, style: TextStyle },
    /// A formula inside the text, as LaTeX.
    Math(String),
    Break,
}

/// Colors the editor stores by name; exports paint them with the light
/// theme's palette, the one meant for white paper.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Color {
    Gray,
    Teal,
    Blue,
    Violet,
    Red,
    Orange,
    Yellow,
}

impl Color {
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "gray" => Self::Gray,
            "teal" => Self::Teal,
            "blue" => Self::Blue,
            "violet" => Self::Violet,
            "red" => Self::Red,
            "orange" => Self::Orange,
            "yellow" => Self::Yellow,
            _ => return None,
        })
    }

    pub fn rgb(self) -> Rgb {
        match self {
            Self::Gray => Rgb(0x6B, 0x76, 0x86),
            Self::Teal => Rgb(0x0D, 0x94, 0x88),
            Self::Blue => Rgb(0x3B, 0x5F, 0xE0),
            Self::Violet => Rgb(0x7C, 0x3A, 0xED),
            Self::Red => Rgb(0xDC, 0x26, 0x26),
            Self::Orange => Rgb(0xD9, 0x77, 0x06),
            Self::Yellow => Rgb(0xB0, 0x89, 0x00),
        }
    }

    /// The highlight behind text: the color at 26 % over white, as the editor paints it.
    pub fn highlight_rgb(self) -> Rgb {
        self.rgb().over_white(0.26)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    /// Primary text of the light theme.
    pub const TEXT: Rgb = Rgb(0x16, 0x20, 0x2E);
    pub const MUTED: Rgb = Rgb(0x6B, 0x76, 0x86);
    pub const HAIRLINE: Rgb = Rgb(0xDC, 0xE1, 0xEA);
    /// Background of code, the page color of the light theme.
    pub const CODE_BACKGROUND: Rgb = Rgb(0xEE, 0xF1, 0xF6);
    /// Panel of the light theme, for table headers.
    pub const PANEL: Rgb = Rgb(0xF7, 0xF9, 0xFC);
    pub const LINK: Rgb = Rgb(0x0D, 0x94, 0x88);

    pub fn over_white(self, alpha: f32) -> Rgb {
        let mix = |channel: u8| (f32::from(channel) * alpha + 255.0 * (1.0 - alpha)).round() as u8;
        Rgb(mix(self.0), mix(self.1), mix(self.2))
    }

    pub fn hex(self) -> String {
        format!("{:02X}{:02X}{:02X}", self.0, self.1, self.2)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub code: bool,
    pub color: Option<Color>,
    pub highlight: Option<Color>,
    /// Web or mail address the text links to.
    pub link: Option<String>,
}
