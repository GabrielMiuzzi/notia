//! LaTeX math to `MathNode`s. The parser never fails: what it does not
//! understand is kept as upright text, so nothing the note says is lost.

use super::symbols;
use super::{ArrayKind, AtomClass, ColumnAlign, MathNode, MathStyle, MathVariant};

/// Groups nested deeper than this are kept as text, so hostile input cannot
/// exhaust the stack of the parser or of the writers.
const MAX_DEPTH: usize = 48;

/// Parses a formula. Top-level `\\` and `&` (a multi-line display formula
/// written without an environment) make an aligned array.
pub(crate) fn parse_math(source: &str) -> Vec<MathNode> {
    let mut parser = Parser { chars: source.chars().collect(), pos: 0, depth: 0 };
    let mut rows: Vec<Vec<Vec<MathNode>>> = vec![vec![Vec::new()]];
    loop {
        let nodes = parser.list(Stop::Cell);
        if let Some(cell) = rows.last_mut().and_then(|row| row.last_mut()) {
            cell.extend(nodes);
        }
        match parser.next_token() {
            Token::Amp => {
                if let Some(row) = rows.last_mut() {
                    row.push(Vec::new());
                }
            }
            Token::Newline => {
                parser.skip_optional_argument();
                rows.push(vec![Vec::new()]);
            }
            Token::End => break,
            Token::Command(name) if name == "end" => {
                parser.braced_raw();
            }
            // A stray `}`: the same cell goes on.
            _ => {}
        }
    }
    rows.retain(|row| !row.iter().all(Vec::is_empty));
    match rows.len() {
        0 => Vec::new(),
        1 if rows[0].len() == 1 => rows.remove(0).remove(0),
        _ => {
            let aligned = rows.iter().any(|row| row.len() > 1);
            let kind = if aligned { ArrayKind::Aligned } else { ArrayKind::Gathered };
            vec![MathNode::Array { kind, rows, columns: Vec::new(), left: None, right: None }]
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    /// A `}` closes the list.
    Brace,
    /// `\right` closes the list.
    Right,
    /// `&`, `\\` or `\end` closes the cell.
    Cell,
    /// `]` closes an optional argument.
    Bracket,
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Command(String),
    Char(char),
    Open,
    Close,
    Sup,
    Sub,
    Amp,
    Newline,
    Prime,
    End,
}

struct Parser {
    chars: Vec<char>,
    pos: usize,
    depth: usize,
}

impl Parser {
    fn skip_space(&mut self) {
        while let Some(&ch) = self.chars.get(self.pos) {
            if ch == '%' {
                while self.chars.get(self.pos).is_some_and(|ch| *ch != '\n') {
                    self.pos += 1;
                }
            } else if ch.is_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn next_token(&mut self) -> Token {
        self.skip_space();
        let Some(&ch) = self.chars.get(self.pos) else { return Token::End };
        self.pos += 1;
        match ch {
            '\\' => {
                let Some(&next) = self.chars.get(self.pos) else { return Token::Char('\\') };
                if next.is_ascii_alphabetic() {
                    let start = self.pos;
                    while self.chars.get(self.pos).is_some_and(char::is_ascii_alphabetic) {
                        self.pos += 1;
                    }
                    Token::Command(self.chars[start..self.pos].iter().collect())
                } else {
                    self.pos += 1;
                    if next == '\\' { Token::Newline } else { Token::Command(next.to_string()) }
                }
            }
            '{' => Token::Open,
            '}' => Token::Close,
            '^' => Token::Sup,
            '_' => Token::Sub,
            '&' => Token::Amp,
            '\'' => Token::Prime,
            '~' => Token::Command(" ".to_string()),
            other => Token::Char(other),
        }
    }

    /// Skips a `*` right after a command (`\operatorname*`).
    fn take_star(&mut self) -> bool {
        if self.chars.get(self.pos) == Some(&'*') {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn list(&mut self, stop: Stop) -> Vec<MathNode> {
        let mut nodes = Vec::new();
        loop {
            let before = self.pos;
            let token = self.next_token();
            match token {
                Token::End => {
                    self.pos = before;
                    break;
                }
                // The enclosing group closes (or a stray `}` at the top).
                Token::Close => {
                    self.pos = before;
                    break;
                }
                Token::Char(']') if stop == Stop::Bracket => {
                    self.pos = before;
                    break;
                }
                Token::Amp | Token::Newline if stop == Stop::Cell => {
                    self.pos = before;
                    break;
                }
                Token::Amp => {}
                Token::Newline => self.skip_optional_argument(),
                Token::Command(name) if (name == "right" && stop == Stop::Right) || (name == "end" && stop == Stop::Cell) => {
                    self.pos = before;
                    break;
                }
                Token::Command(name) if name == "right" => {
                    self.delimiter();
                }
                Token::Command(name) if name == "end" => {
                    self.braced_raw();
                }
                Token::Sup | Token::Sub => {
                    let script = self.argument();
                    attach(&mut nodes, token == Token::Sup, script);
                }
                Token::Prime => attach_prime(&mut nodes),
                Token::Open => {
                    let inner = self.group();
                    nodes.push(MathNode::Group(inner));
                }
                Token::Char(ch) => nodes.push(symbol(ch)),
                Token::Command(name) => self.command(&name, &mut nodes, Some(stop)),
            }
        }
        nodes
    }

    /// Content of a `{…}` whose `{` was just read; the `}` is consumed.
    fn group(&mut self) -> Vec<MathNode> {
        if self.depth >= MAX_DEPTH {
            self.pos -= 1;
            let text = self.braced_raw();
            return vec![MathNode::Text { text, class: AtomClass::Ord, limits: false, bold: false }];
        }
        self.depth += 1;
        let inner = self.list(Stop::Brace);
        self.depth -= 1;
        // The `}`, or nothing when the formula ends inside the group.
        self.next_token();
        inner
    }

    /// One argument: a group, a character or a command.
    fn argument(&mut self) -> Vec<MathNode> {
        let before = self.pos;
        match self.next_token() {
            Token::Open => self.group(),
            Token::Char(ch) => vec![symbol(ch)],
            Token::Prime => vec![prime()],
            Token::Command(name) => {
                // `\sqrt\sqrt…` nests without braces: it counts as depth too.
                if self.depth >= MAX_DEPTH {
                    return vec![MathNode::Text { text: format!("\\{name}"), class: AtomClass::Ord, limits: false, bold: false }];
                }
                self.depth += 1;
                let mut nodes = Vec::new();
                self.command(&name, &mut nodes, None);
                self.depth -= 1;
                nodes
            }
            _ => {
                self.pos = before;
                Vec::new()
            }
        }
    }

    fn skip_optional_argument(&mut self) {
        let before = self.pos;
        self.skip_space();
        if self.chars.get(self.pos) == Some(&'[') {
            while let Some(&ch) = self.chars.get(self.pos) {
                self.pos += 1;
                if ch == ']' {
                    return;
                }
            }
        }
        self.pos = before;
    }

    /// Raw text of the next `{…}` (or of the next character), for `\text`
    /// and names. Commands inside are dropped, their escapes kept.
    fn braced_raw(&mut self) -> String {
        self.skip_space();
        match self.chars.get(self.pos) {
            Some('{') => self.pos += 1,
            Some('\\') => {
                return match self.next_token() {
                    Token::Command(name) => escaped_text(&name).unwrap_or_default(),
                    _ => String::new(),
                };
            }
            Some(&ch) => {
                self.pos += 1;
                return ch.to_string();
            }
            None => return String::new(),
        }
        let mut text = String::new();
        let mut depth = 1usize;
        while let Some(&ch) = self.chars.get(self.pos) {
            self.pos += 1;
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                '$' => {}
                '~' => text.push('\u{a0}'),
                '\\' => {
                    let Some(&next) = self.chars.get(self.pos) else { break };
                    if next.is_ascii_alphabetic() {
                        while self.chars.get(self.pos).is_some_and(char::is_ascii_alphabetic) {
                            self.pos += 1;
                        }
                    } else {
                        self.pos += 1;
                        match (next, self.chars.get(self.pos).copied()) {
                            ('\'' | '`' | '^' | '"' | '~', Some(letter)) if letter.is_alphabetic() => {
                                self.pos += 1;
                                text.push(accented(next, letter));
                            }
                            _ => text.push_str(&escaped_text(&next.to_string()).unwrap_or_default()),
                        }
                    }
                }
                other => text.push(other),
            }
        }
        text
    }

    /// The delimiter after `\left`, `\right` or `\big`; `None` for `.`.
    fn delimiter(&mut self) -> Option<char> {
        let before = self.pos;
        match self.next_token() {
            Token::Char('.') => None,
            Token::Char(ch) => symbols::delimiter(&ch.to_string()),
            Token::Command(name) => symbols::delimiter(&name).or(match name.as_str() {
                "{" => Some('{'),
                "}" => Some('}'),
                "|" => Some('‖'),
                _ => None,
            }),
            _ => {
                self.pos = before;
                None
            }
        }
    }

    /// Reads a command's arguments and adds what it makes to `nodes`.
    /// `rest` is the stop of the list being read, for style switches
    /// (`None` inside an argument, where they apply to nothing).
    fn command(&mut self, name: &str, nodes: &mut Vec<MathNode>, rest: Option<Stop>) {
        match name {
            "frac" | "dfrac" | "tfrac" | "cfrac" => {
                let numerator = self.argument();
                let denominator = self.argument();
                let style = match name {
                    "dfrac" | "cfrac" => Some(MathStyle::Display),
                    "tfrac" => Some(MathStyle::Text),
                    _ => None,
                };
                nodes.push(MathNode::Fraction { numerator, denominator, rule: true, style, delimiters: None });
            }
            "binom" | "dbinom" | "tbinom" => {
                let numerator = self.argument();
                let denominator = self.argument();
                let style = match name {
                    "dbinom" => Some(MathStyle::Display),
                    "tbinom" => Some(MathStyle::Text),
                    _ => None,
                };
                nodes.push(MathNode::Fraction { numerator, denominator, rule: false, style, delimiters: Some(('(', ')')) });
            }
            "sqrt" => {
                self.skip_space();
                let index = if self.chars.get(self.pos) == Some(&'[') {
                    self.pos += 1;
                    let index = self.list(Stop::Bracket);
                    if self.chars.get(self.pos) == Some(&']') {
                        self.pos += 1;
                    }
                    Some(index)
                } else {
                    None
                };
                let body = self.argument();
                nodes.push(MathNode::Root { index, body });
            }
            "left" => {
                let left = self.delimiter();
                self.depth += 1;
                let body = if self.depth > MAX_DEPTH { Vec::new() } else { self.list(Stop::Right) };
                self.depth -= 1;
                let before = self.pos;
                let right = match self.next_token() {
                    Token::Command(name) if name == "right" => self.delimiter(),
                    _ => {
                        self.pos = before;
                        None
                    }
                };
                nodes.push(MathNode::Delimited { left, right, body });
            }
            "middle" => {
                let ch = self.delimiter().unwrap_or('|');
                nodes.push(MathNode::Symbol { ch, class: AtomClass::Rel, variant: MathVariant::Upright });
            }
            "big" | "Big" | "bigg" | "Bigg" | "bigl" | "Bigl" | "biggl" | "Biggl" | "bigr" | "Bigr" | "biggr" | "Biggr" | "bigm" | "Bigm" | "biggm" | "Biggm" => {
                let size = match name.trim_end_matches(['l', 'r', 'm']) {
                    "big" => 1,
                    "Big" => 2,
                    "bigg" => 3,
                    _ => 4,
                };
                let class = match name.chars().last() {
                    Some('l') => AtomClass::Open,
                    Some('r') => AtomClass::Close,
                    Some('m') => AtomClass::Rel,
                    _ => AtomClass::Ord,
                };
                if let Some(ch) = self.delimiter() {
                    nodes.push(MathNode::SizedDelimiter { ch, size, class });
                }
            }
            "begin" => {
                let environment = self.braced_raw();
                nodes.push(self.environment(environment.trim()));
            }
            "text" | "textrm" | "textnormal" | "textup" | "textmd" | "mbox" | "hbox" | "textit" | "emph" | "textsf" | "texttt" => {
                let text = self.braced_raw();
                nodes.push(MathNode::Text { text, class: AtomClass::Ord, limits: false, bold: false });
            }
            "textbf" => {
                let text = self.braced_raw();
                nodes.push(MathNode::Text { text, class: AtomClass::Ord, limits: false, bold: true });
            }
            "operatorname" | "operatornamewithlimits" => {
                let limits = self.take_star() || name == "operatornamewithlimits";
                let text = self.braced_raw();
                nodes.push(MathNode::Text { text, class: AtomClass::Op, limits, bold: false });
            }
            "mathrm" | "mathup" | "mathnormal" | "mathit" | "mathbf" | "boldsymbol" | "bm" | "mathbb" | "mathcal" | "mathfrak" | "mathscr" | "mathsf" | "mathtt" => {
                let mut body = self.argument();
                apply_variant(&mut body, name);
                nodes.extend(body);
            }
            "displaystyle" | "textstyle" | "scriptstyle" | "scriptscriptstyle" => {
                if let Some(stop) = rest.filter(|_| self.depth < MAX_DEPTH) {
                    let style = match name {
                        "displaystyle" => MathStyle::Display,
                        "textstyle" => MathStyle::Text,
                        "scriptstyle" => MathStyle::Script,
                        _ => MathStyle::ScriptScript,
                    };
                    self.depth += 1;
                    let body = self.list(stop);
                    self.depth -= 1;
                    nodes.push(MathNode::Styled { style, body });
                }
            }
            "limits" | "nolimits" => set_limits(nodes.last_mut(), name == "limits"),
            "not" => {
                let negated = match self.argument().pop() {
                    Some(MathNode::Symbol { ch, class, variant }) => match symbols::negated(ch) {
                        Some(ch) => MathNode::Symbol { ch, class, variant },
                        None => MathNode::Symbol { ch, class, variant },
                    },
                    Some(other) => other,
                    None => return,
                };
                nodes.push(negated);
            }
            "color" => {
                self.braced_raw();
            }
            "textcolor" | "colorbox" => {
                self.braced_raw();
                let body = self.argument();
                nodes.push(MathNode::Group(body));
            }
            "boxed" | "fbox" | "cancel" | "bcancel" | "xcancel" | "sout" => {
                let body = self.argument();
                nodes.push(MathNode::Group(body));
            }
            "phantom" | "hphantom" | "vphantom" | "label" | "tag" | "ref" | "eqref" => {
                self.take_star();
                self.argument();
            }
            "nonumber" | "notag" | "allowbreak" | "nobreak" | "relax" | "left." | "strut" | "displaylimits" => {}
            "overset" | "underset" | "stackrel" => {
                let label = self.argument();
                let base = self.argument();
                let class = match name {
                    "stackrel" => AtomClass::Rel,
                    _ => base.first().map_or(AtomClass::Ord, MathNode::class),
                };
                let (over, under) = if name == "underset" { (None, Some(label)) } else { (Some(label), None) };
                nodes.push(MathNode::Stack { base, over, under, class });
            }
            "pmod" => {
                let body = self.argument();
                nodes.push(MathNode::Space(1.0));
                nodes.push(MathNode::Symbol { ch: '(', class: AtomClass::Open, variant: MathVariant::Upright });
                nodes.push(MathNode::Text { text: "mod".to_string(), class: AtomClass::Ord, limits: false, bold: false });
                nodes.push(MathNode::Space(6.0 / 18.0));
                nodes.push(MathNode::Group(body));
                nodes.push(MathNode::Symbol { ch: ')', class: AtomClass::Close, variant: MathVariant::Upright });
            }
            "bmod" => nodes.push(MathNode::Text { text: "mod".to_string(), class: AtomClass::Bin, limits: false, bold: false }),
            "hspace" | "hskip" | "kern" | "mkern" | "mskip" => {
                self.take_star();
                let length = self.braced_raw();
                nodes.push(MathNode::Space(length_in_em(&length)));
            }
            _ => nodes.push(self.simple_command(name)),
        }
    }

    /// Commands without arguments and those that only take one plain argument.
    fn simple_command(&mut self, name: &str) -> MathNode {
        if let Some(accent) = symbols::accent(name) {
            return MathNode::Accent { accent, body: self.argument() };
        }
        if let Some(symbol) = symbols::large_operator(name) {
            return MathNode::LargeOp { symbol, limits: None };
        }
        if let Some((text, limits)) = symbols::operator_name(name) {
            return MathNode::Text { text, class: AtomClass::Op, limits, bold: false };
        }
        if let Some((ch, class, variant)) = symbols::command_symbol(name) {
            return MathNode::Symbol { ch, class, variant };
        }
        if let Some(width) = symbols::space(name) {
            return MathNode::Space(width);
        }
        match name {
            "{" => MathNode::Symbol { ch: '{', class: AtomClass::Open, variant: MathVariant::Upright },
            "}" => MathNode::Symbol { ch: '}', class: AtomClass::Close, variant: MathVariant::Upright },
            "|" => MathNode::Symbol { ch: '‖', class: AtomClass::Ord, variant: MathVariant::Upright },
            _ => match escaped_text(name) {
                Some(text) if text.chars().count() == 1 => {
                    let ch = text.chars().next().unwrap_or(' ');
                    MathNode::Symbol { ch, class: AtomClass::Ord, variant: MathVariant::Upright }
                }
                // An unknown command stays visible as written.
                _ => MathNode::Text { text: format!("\\{name}"), class: AtomClass::Ord, limits: false, bold: false },
            },
        }
    }

    fn environment(&mut self, name: &str) -> MathNode {
        let base = name.trim_end_matches('*');
        let (kind, left, right) = match base {
            "matrix" => (ArrayKind::Matrix, None, None),
            "pmatrix" => (ArrayKind::Matrix, Some('('), Some(')')),
            "bmatrix" => (ArrayKind::Matrix, Some('['), Some(']')),
            "Bmatrix" => (ArrayKind::Matrix, Some('{'), Some('}')),
            "vmatrix" => (ArrayKind::Matrix, Some('|'), Some('|')),
            "Vmatrix" => (ArrayKind::Matrix, Some('‖'), Some('‖')),
            "smallmatrix" => (ArrayKind::SmallMatrix, None, None),
            "cases" | "dcases" => (ArrayKind::Cases, Some('{'), None),
            "rcases" => (ArrayKind::Cases, None, Some('}')),
            "aligned" | "align" | "alignat" | "alignedat" | "split" | "eqnarray" | "flalign" => (ArrayKind::Aligned, None, None),
            "array" | "subarray" => (ArrayKind::Array, None, None),
            _ => (ArrayKind::Gathered, None, None),
        };
        let columns = match kind {
            ArrayKind::Array => column_spec(&self.braced_raw()),
            _ => {
                if matches!(base, "alignat" | "alignedat") {
                    self.braced_raw();
                }
                Vec::new()
            }
        };
        let mut rows = Vec::new();
        let mut row = Vec::new();
        self.depth += 1;
        loop {
            if self.depth > MAX_DEPTH {
                break;
            }
            row.push(self.list(Stop::Cell));
            let before = self.pos;
            match self.next_token() {
                Token::Amp => {}
                Token::Newline => {
                    self.skip_optional_argument();
                    rows.push(std::mem::take(&mut row));
                }
                Token::Command(command) if command == "end" => {
                    self.braced_raw();
                    break;
                }
                Token::End => break,
                _ => {
                    self.pos = before;
                    break;
                }
            }
        }
        self.depth -= 1;
        if !row.iter().all(Vec::is_empty) {
            rows.push(row);
        }
        MathNode::Array { kind, rows, columns, left, right }
    }
}

fn symbol(ch: char) -> MathNode {
    if symbols::is_large_operator(ch) {
        return MathNode::LargeOp { symbol: ch, limits: None };
    }
    let (ch, class, variant) = symbols::character(ch);
    MathNode::Symbol { ch, class, variant }
}

fn prime() -> MathNode {
    MathNode::Symbol { ch: '′', class: AtomClass::Ord, variant: MathVariant::Upright }
}

fn is_prime(node: &MathNode) -> bool {
    matches!(node, MathNode::Symbol { ch: '′', .. })
}

/// Attaches `^` or `_` to the atom before it. A second superscript
/// (`x^a^b`, an error in TeX) goes on an empty base after it, so chains of
/// them never nest.
fn attach(nodes: &mut Vec<MathNode>, is_sup: bool, script: Vec<MathNode>) {
    let (base, mut sup, mut sub) = match nodes.pop() {
        Some(MathNode::Scripts { base, sup, sub }) => {
            let free = if is_sup { sup.as_ref().is_none_or(|nodes| nodes.iter().all(is_prime)) } else { sub.is_none() };
            if free {
                (*base, sup, sub)
            } else {
                nodes.push(MathNode::Scripts { base, sup, sub });
                (MathNode::Group(Vec::new()), None, None)
            }
        }
        Some(node) => (node, None, None),
        None => (MathNode::Group(Vec::new()), None, None),
    };
    if is_sup {
        let mut nodes = sup.take().unwrap_or_default();
        nodes.extend(script);
        sup = Some(nodes);
    } else {
        sub = Some(script);
    }
    nodes.push(MathNode::Scripts { base: Box::new(base), sup, sub });
}

fn attach_prime(nodes: &mut Vec<MathNode>) {
    match nodes.last_mut() {
        Some(MathNode::Scripts { sup: Some(sup), .. }) => sup.push(prime()),
        Some(MathNode::Scripts { sup: sup @ None, .. }) => *sup = Some(vec![prime()]),
        _ => attach(nodes, true, vec![prime()]),
    }
}

fn set_limits(node: Option<&mut MathNode>, value: bool) {
    match node {
        Some(MathNode::LargeOp { limits, .. }) => *limits = Some(value),
        Some(MathNode::Text { limits, class: AtomClass::Op, .. }) => *limits = value,
        Some(MathNode::Scripts { base, .. }) => set_limits(Some(base), value),
        _ => {}
    }
}

/// `\mathbf{…}` and friends: the family of the letters (and digits) inside.
fn apply_variant(nodes: &mut [MathNode], command: &str) {
    for node in nodes {
        match node {
            MathNode::Symbol { ch, variant, .. } => {
                let letter = ch.is_alphabetic();
                let digit = ch.is_ascii_digit();
                let next = match command {
                    "mathrm" | "mathup" => (letter && ch.is_ascii()).then_some(MathVariant::Upright),
                    "mathnormal" | "mathit" => letter.then_some(MathVariant::Italic),
                    "mathbf" => (letter || digit).then_some(MathVariant::Bold),
                    "boldsymbol" | "bm" => Some(if letter && *variant == MathVariant::Italic { MathVariant::BoldItalic } else { MathVariant::Bold }),
                    "mathbb" => letter.then_some(MathVariant::DoubleStruck),
                    "mathcal" => letter.then_some(MathVariant::Calligraphic),
                    "mathfrak" => letter.then_some(MathVariant::Fraktur),
                    "mathscr" => letter.then_some(MathVariant::Script),
                    "mathsf" => (letter || digit).then_some(MathVariant::SansSerif),
                    "mathtt" => (letter || digit).then_some(MathVariant::Monospace),
                    _ => None,
                };
                if let Some(next) = next {
                    *variant = next;
                }
            }
            MathNode::Text { bold, .. } => {
                if matches!(command, "mathbf" | "boldsymbol" | "bm") {
                    *bold = true;
                }
            }
            MathNode::Group(inner) | MathNode::Styled { body: inner, .. } | MathNode::Accent { body: inner, .. } => apply_variant(inner, command),
            MathNode::Scripts { base, sup, sub } => {
                apply_variant(std::slice::from_mut(base.as_mut()), command);
                for script in [sup, sub].into_iter().flatten() {
                    apply_variant(script, command);
                }
            }
            MathNode::Fraction { numerator, denominator, .. } => {
                apply_variant(numerator, command);
                apply_variant(denominator, command);
            }
            MathNode::Root { index, body } => {
                apply_variant(body, command);
                if let Some(index) = index {
                    apply_variant(index, command);
                }
            }
            MathNode::Delimited { body, .. } => apply_variant(body, command),
            _ => {}
        }
    }
}

/// Characters written as escapes: `\%`, `\{`, `\ `…
fn escaped_text(name: &str) -> Option<String> {
    Some(match name {
        "%" | "$" | "#" | "&" | "_" | "{" | "}" => name.to_string(),
        " " => " ".to_string(),
        "textbackslash" => "\\".to_string(),
        "textasciitilde" => "~".to_string(),
        "ldots" | "dots" | "textellipsis" => "…".to_string(),
        _ => return None,
    })
}

/// `\'a`, `\~n`… inside `\text{…}`.
fn accented(accent: char, letter: char) -> char {
    let table: &[(char, &str, &str)] = &[
        ('\'', "aeiouAEIOUy", "áéíóúÁÉÍÓÚý"),
        ('`', "aeiouAEIOU", "àèìòùÀÈÌÒÙ"),
        ('^', "aeiouAEIOU", "âêîôûÂÊÎÔÛ"),
        ('"', "aeiouAEIOU", "äëïöüÄËÏÖÜ"),
        ('~', "nNaoAO", "ñÑãõÃÕ"),
    ];
    table
        .iter()
        .find(|(mark, ..)| *mark == accent)
        .and_then(|(_, plain, marked)| plain.chars().position(|ch| ch == letter).and_then(|index| marked.chars().nth(index)))
        .unwrap_or(letter)
}

/// Column alignments of an `array` specification (`{lc|r}`).
fn column_spec(spec: &str) -> Vec<ColumnAlign> {
    spec.chars()
        .filter_map(|ch| match ch {
            'l' => Some(ColumnAlign::Left),
            'c' => Some(ColumnAlign::Center),
            'r' => Some(ColumnAlign::Right),
            _ => None,
        })
        .collect()
}

/// A TeX length (`1em`, `5pt`, `3mu`…) in ems, taking 1 em as 10 pt.
fn length_in_em(length: &str) -> f32 {
    let length = length.trim();
    let split = length.find(|ch: char| ch.is_ascii_alphabetic()).unwrap_or(length.len());
    let value = length[..split].trim().parse::<f32>().unwrap_or(0.0);
    let em = match &length[split..] {
        "pt" => value / 10.0,
        "mm" => value * 0.2845,
        "cm" => value * 2.845,
        "in" => value * 7.227,
        "ex" => value * 0.431,
        "mu" => value / 18.0,
        _ => value,
    };
    em.clamp(-10.0, 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn italic(ch: char) -> MathNode {
        MathNode::Symbol { ch, class: AtomClass::Ord, variant: MathVariant::Italic }
    }

    fn upright(ch: char, class: AtomClass) -> MathNode {
        MathNode::Symbol { ch, class, variant: MathVariant::Upright }
    }

    #[test]
    fn parses_fractions_roots_and_scripts() {
        let nodes = parse_math("\\frac{a}{2} + \\sqrt[3]{x^2_i}");
        assert_eq!(
            nodes[0],
            MathNode::Fraction { numerator: vec![italic('a')], denominator: vec![upright('2', AtomClass::Ord)], rule: true, style: None, delimiters: None }
        );
        assert_eq!(nodes[1], upright('+', AtomClass::Bin));
        let MathNode::Root { index: Some(index), body } = &nodes[2] else { panic!("root") };
        assert_eq!(index, &vec![upright('3', AtomClass::Ord)]);
        assert_eq!(
            body[0],
            MathNode::Scripts { base: Box::new(italic('x')), sup: Some(vec![upright('2', AtomClass::Ord)]), sub: Some(vec![italic('i')]) }
        );
    }

    #[test]
    fn parses_operators_delimiters_and_text() {
        let nodes = parse_math("\\sum_{i=1}^{n} \\left( \\frac{1}{i} \\right] \\lim\\limits_{x \\to 0} \\text{si } x' \\neq 0");
        let MathNode::Scripts { base, sup: Some(_), sub: Some(_) } = &nodes[0] else { panic!("sum") };
        assert_eq!(**base, MathNode::LargeOp { symbol: '∑', limits: None });
        let MathNode::Delimited { left, right, body } = &nodes[1] else { panic!("delimited") };
        assert_eq!((*left, *right, body.len()), (Some('('), Some(']'), 1));
        let MathNode::Scripts { base, .. } = &nodes[2] else { panic!("lim") };
        assert_eq!(**base, MathNode::Text { text: "lim".to_string(), class: AtomClass::Op, limits: true, bold: false });
        assert_eq!(nodes[3], MathNode::Text { text: "si ".to_string(), class: AtomClass::Ord, limits: false, bold: false });
        assert_eq!(
            nodes[4],
            MathNode::Scripts { base: Box::new(italic('x')), sup: Some(vec![upright('′', AtomClass::Ord)]), sub: None }
        );
        assert_eq!(nodes[5], upright('≠', AtomClass::Rel));
    }

    #[test]
    fn parses_environments_and_multiline_formulas() {
        let nodes = parse_math("\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}");
        let MathNode::Array { kind: ArrayKind::Matrix, rows, left: Some('('), right: Some(')'), .. } = &nodes[0] else { panic!("matrix") };
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].len(), 2);
        let nodes = parse_math("f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{si no} \\end{cases}");
        assert!(matches!(nodes.last(), Some(MathNode::Array { kind: ArrayKind::Cases, left: Some('{'), .. })));
        let nodes = parse_math("a &= b \\\\ &= c");
        let MathNode::Array { kind: ArrayKind::Aligned, rows, .. } = &nodes[0] else { panic!("aligned") };
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn applies_font_commands_and_keeps_unknown_commands() {
        let nodes = parse_math("\\mathbb{R} \\mathbf{v} \\foo");
        assert_eq!(nodes[0], MathNode::Symbol { ch: 'R', class: AtomClass::Ord, variant: MathVariant::DoubleStruck });
        assert_eq!(nodes[1], MathNode::Symbol { ch: 'v', class: AtomClass::Ord, variant: MathVariant::Bold });
        assert_eq!(nodes[2], MathNode::Text { text: "\\foo".to_string(), class: AtomClass::Ord, limits: false, bold: false });
    }

    #[test]
    fn survives_unbalanced_and_hostile_input() {
        assert!(!parse_math("\\frac{a}{").is_empty());
        assert_eq!(parse_math("}}a{"), vec![italic('a'), MathNode::Group(Vec::new())]);
        assert!(parse_math("").is_empty());
        let deep = format!("{}x{}", "{".repeat(10_000), "}".repeat(10_000));
        assert!(!parse_math(&deep).is_empty());
        let deep_left = format!("{}x", "\\left(".repeat(10_000));
        assert!(!parse_math(&deep_left).is_empty());
        for hostile in [
            format!("{}x", "\\sqrt".repeat(100_000)),
            format!("{}x", "\\displaystyle ".repeat(100_000)),
            format!("x{}", "^a".repeat(100_000)),
            format!("{}x", "\\not\\hat".repeat(50_000)),
        ] {
            assert!(!parse_math(&hostile).is_empty());
        }
        assert_eq!(parse_math("x^a^b").len(), 2);
    }

    #[test]
    fn reads_accents_inside_text() {
        let nodes = parse_math("\\text{\\'area de la regi\\'on}");
        assert_eq!(nodes[0], MathNode::Text { text: "área de la región".to_string(), class: AtomClass::Ord, limits: false, bold: false });
    }
}
