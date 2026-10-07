//! Flowcharts (`flowchart TD` / `graph LR`): nodes with their shape, label,
//! icon and style, links with their line, end and text, read from the
//! source and edited line by line. Lines the editor does not understand
//! (subgraphs, `classDef`, `click`, comments) are kept as they are.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::text::{body_indent, clean_label, indent_of, is_blank_or_comment, join_lines, quoted, single_line, split_lines, unquoted};
use super::Selection;
use crate::error::BackendError;

const MAX_LABEL_CHARS: usize = 200;
pub const DIRECTIONS: [&str; 5] = ["TD", "TB", "LR", "BT", "RL"];

/// Shapes the editor offers (Mermaid 11 short names).
pub const SHAPES: [&str; 22] = [
    "rect", "rounded", "stadium", "circle", "dbl-circ", "diam", "hex", "text", "lean-r", "lean-l", "trap-b", "trap-t", "subproc", "doc",
    "odd", "cyl", "cloud", "fork", "sm-circ", "fr-circ", "tri", "icon",
];

/// Border colors of the style inspector, in its order.
pub const NODE_COLORS: [&str; 8] = ["#46536F", "#4FD1C5", "#6C8EFF", "#FFB86B", "#FF6B6B", "#6FCF97", "#A78BFA", "#D9B44A"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineStyle {
    Solid,
    Dotted,
    Thick,
    Invisible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EdgeCap {
    Arrow,
    None,
    Circle,
    Cross,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FillMode {
    Surface,
    Tint,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextSize {
    S,
    M,
    L,
}

impl TextSize {
    fn px(self) -> u32 {
        match self {
            TextSize::S => 13,
            TextSize::M => 16,
            TextSize::L => 20,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowNode {
    pub id: String,
    pub label: String,
    pub shape: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Border color (`#RRGGBB`) set by the editor's `style` line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<String>,
    pub fill: FillMode,
    pub text_size: TextSize,
    /// Lines (0-based) that define or style the node.
    pub lines: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEdge {
    /// Position among the links, as Mermaid numbers them.
    pub index: usize,
    pub from: String,
    pub to: String,
    pub label: String,
    pub line_style: LineStyle,
    pub cap: EdgeCap,
    /// The operator as written (`-.->`).
    pub op: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowchartModel {
    /// `flowchart` or `graph`.
    pub keyword: String,
    pub direction: String,
    pub header_line: usize,
    pub nodes: Vec<FlowNode>,
    pub edges: Vec<FlowEdge>,
}

/// What the person did on a flowchart.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FlowchartEdit {
    SetDirection { direction: String },
    AddNode { shape: String, label: Option<String>, icon: Option<String> },
    SetNodeLabel { id: String, label: String },
    SetNodeShape { id: String, shape: String },
    SetNodeIcon { id: String, icon: String },
    SetNodeStyle { id: String, border: Option<String>, fill: FillMode, text_size: TextSize },
    DuplicateNode { id: String },
    DeleteNode { id: String },
    Connect { from: String, to: String },
    SetEdgeLabel { index: usize, label: String },
    SetEdgeLine { index: usize, line_style: LineStyle },
    SetEdgeCap { index: usize, cap: EdgeCap },
    SwapEdge { index: usize },
    DeleteEdge { index: usize },
    Format,
}

// --- Tokens of a statement -----------------------------------------------------

/// A node as written in a statement: `A`, `A[texto]`, `A@{ shape: rect }`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NodeToken {
    id: String,
    /// The whole token (definition and `:::class` included).
    raw: String,
    /// The definition after the id, when there is one.
    shape: Option<String>,
    label: Option<String>,
    icon: Option<String>,
    /// `@{ }` pairs other than shape, label and icon.
    extra: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LinkToken {
    raw: String,
    line_style: LineStyle,
    cap: EdgeCap,
    label: String,
}

/// A statement of nodes and links: `A & B --> C -->|sí| D`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Chain {
    /// Groups of nodes joined by `&`, with the link after each group.
    groups: Vec<Vec<NodeToken>>,
    links: Vec<LinkToken>,
}

/// Bracket shapes, longest openers first; `[/a\]` and `[\a/]` share their
/// openers with `[/a/]` and `[\a\]`.
const OPENERS: [(&str, &str, &str); 14] = [
    ("(((", ")))", "dbl-circ"),
    ("([", "])", "stadium"),
    ("((", "))", "circle"),
    ("[[", "]]", "subproc"),
    ("[(", ")]", "cyl"),
    ("[/", "/]", "lean-r"),
    ("[\\", "\\]", "lean-l"),
    ("[/", "\\]", "trap-b"),
    ("[\\", "/]", "trap-t"),
    ("{{", "}}", "hex"),
    ("[", "]", "rect"),
    ("(", ")", "rounded"),
    ("{", "}", "diam"),
    (">", "]", "odd"),
];

fn is_id_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

struct Cursor<'a> {
    text: &'a str,
    position: usize,
}

impl<'a> Cursor<'a> {
    fn rest(&self) -> &'a str {
        &self.text[self.position..]
    }

    fn skip_spaces(&mut self) {
        let rest = self.rest();
        self.position += rest.len() - rest.trim_start().len();
    }

    fn done(&self) -> bool {
        self.rest().trim().is_empty() || self.rest().trim_start().starts_with(';')
    }
}

/// The id of a node at the cursor: letters, digits, `_`, and `-` or `.`
/// between them (not the start of a link).
fn read_id(cursor: &mut Cursor) -> Option<String> {
    let rest = cursor.rest();
    let characters = rest.char_indices().collect::<Vec<_>>();
    let mut end = 0;
    for (index, &(offset, character)) in characters.iter().enumerate() {
        let next = characters.get(index + 1).map(|(_, next)| *next);
        let joins = matches!(character, '-' | '.') && end > 0 && next.is_some_and(is_id_char);
        if is_id_char(character) || joins {
            end = offset + character.len_utf8();
        } else {
            break;
        }
    }
    (end > 0).then(|| {
        cursor.position += end;
        rest[..end].to_string()
    })
}

/// The end of a label that may be quoted, before `closer`.
fn label_end(rest: &str, closer: &str) -> Option<usize> {
    let trimmed_start = rest.len() - rest.trim_start().len();
    if rest[trimmed_start..].starts_with('"') {
        let after_quote = trimmed_start + 1;
        let quote_end = rest[after_quote..].find('"')? + after_quote + 1;
        let close = rest[quote_end..].find(closer)? + quote_end;
        return rest[quote_end..close].trim().is_empty().then_some(close);
    }
    rest.find(closer)
}

/// `@{ key: value, … }` pairs.
fn read_object(body: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut parts = Vec::new();
    for character in body.chars() {
        match character {
            '"' => {
                in_quotes = !in_quotes;
                current.push(character);
            }
            ',' if !in_quotes => parts.push(std::mem::take(&mut current)),
            _ => current.push(character),
        }
    }
    parts.push(current);
    for part in parts {
        if let Some((key, value)) = part.split_once(':') {
            let key = key.trim().to_string();
            if !key.is_empty() {
                pairs.push((key, value.trim().to_string()));
            }
        }
    }
    pairs
}

fn read_node(cursor: &mut Cursor) -> Option<NodeToken> {
    let start = cursor.position;
    let id = read_id(cursor)?;
    let mut token = NodeToken { id, raw: String::new(), shape: None, label: None, icon: None, extra: Vec::new() };
    let rest = cursor.rest();
    if let Some(body_start) = rest.strip_prefix("@{") {
        let mut in_quotes = false;
        let mut close = None;
        for (offset, character) in body_start.char_indices() {
            match character {
                '"' => in_quotes = !in_quotes,
                '}' if !in_quotes => {
                    close = Some(offset);
                    break;
                }
                _ => {}
            }
        }
        let close = close?;
        for (key, value) in read_object(&body_start[..close]) {
            match key.as_str() {
                "shape" => token.shape = Some(unquoted(&value)),
                "label" => token.label = Some(unquoted(&value)),
                "icon" => token.icon = Some(unquoted(&value)),
                _ => token.extra.push((key, value)),
            }
        }
        if token.icon.is_some() && token.shape.is_none() {
            token.shape = Some("icon".to_string());
        }
        cursor.position += 2 + close + 1;
    } else {
        for (opener, closer, shape) in OPENERS {
            let Some(after) = rest.strip_prefix(opener) else { continue };
            let Some(end) = label_end(after, closer) else { continue };
            if matches!(opener, "[/" | "[\\") && after[..end].contains(']') {
                continue;
            }
            token.shape = Some(shape.to_string());
            token.label = Some(unquoted(&after[..end]));
            cursor.position += opener.len() + end + closer.len();
            break;
        }
    }
    if let Some(class_start) = cursor.rest().strip_prefix(":::") {
        let length = class_start.chars().take_while(|character| is_id_char(*character) || *character == '-').map(char::len_utf8).sum::<usize>();
        cursor.position += 3 + length;
    }
    token.raw = cursor.text[start..cursor.position].to_string();
    Some(token)
}

fn style_and_cap(body: &str, start: Option<char>, end: Option<char>) -> (LineStyle, EdgeCap) {
    let line_style = if body.contains('~') {
        LineStyle::Invisible
    } else if body.contains('=') {
        LineStyle::Thick
    } else if body.contains('.') {
        LineStyle::Dotted
    } else {
        LineStyle::Solid
    };
    let cap = match (start, end) {
        (Some('<'), Some('>')) => EdgeCap::Both,
        (_, Some('>')) => EdgeCap::Arrow,
        (_, Some('o')) => EdgeCap::Circle,
        (_, Some('x')) => EdgeCap::Cross,
        _ => EdgeCap::None,
    };
    (line_style, cap)
}

/// A link at the cursor: `-->`, `-.->|texto|`, `-- texto -->`, `<==>`, `~~~`.
fn read_link(cursor: &mut Cursor) -> Option<LinkToken> {
    let rest = cursor.rest();
    let characters = rest.chars().collect::<Vec<_>>();
    let mut index = 0;
    let start = match characters.first() {
        Some('<') => {
            index = 1;
            Some('<')
        }
        Some(c @ ('o' | 'x')) if matches!(characters.get(1), Some('-' | '=')) => {
            index = 1;
            Some(*c)
        }
        _ => None,
    };
    let body_start = index;
    while index < characters.len() && matches!(characters[index], '-' | '=' | '.' | '~') {
        index += 1;
    }
    let body = characters[body_start..index].iter().collect::<String>();
    let valid_body = body.len() >= 2 && (body.starts_with('-') || body.starts_with('=') || body.starts_with('~'));
    if !valid_body {
        return None;
    }
    let mut label = String::new();
    let mut end = match characters.get(index) {
        Some(c @ ('>' | 'o' | 'x')) if !characters.get(index + 1).is_some_and(|next| is_id_char(*next)) || *c == '>' => {
            index += 1;
            Some(*c)
        }
        _ => None,
    };
    // `-- texto -->`: the text form, when the body is a bare opener.
    let opener = matches!(body.as_str(), "--" | "==" | "-.");
    if end.is_none() && opener && characters.get(index) == Some(&' ') {
        let tail = characters[index..].iter().collect::<String>();
        let closers: &[&str] = match body.as_str() {
            "--" => &["-->", "---", "--o", "--x"],
            "==" => &["==>", "===", "==o", "==x"],
            _ => &[".->", ".-", ".-o", ".-x"],
        };
        let found = closers
            .iter()
            .filter_map(|closer| tail.find(&format!(" {closer}")).map(|offset| (offset, *closer)))
            .min_by_key(|(offset, closer)| (*offset, std::cmp::Reverse(closer.len())));
        if let Some((offset, closer)) = found {
            label = tail[..offset].trim().to_string();
            let consumed = offset + 1 + closer.len();
            let last = closer.chars().last();
            end = last.filter(|character| matches!(character, '>' | 'o' | 'x'));
            let byte_end = rest.char_indices().nth(index).map_or(rest.len(), |(offset, _)| offset) + consumed;
            let raw = rest[..byte_end].to_string();
            cursor.position += byte_end;
            let full_body = format!("{body}{closer}");
            let (line_style, cap) = style_and_cap(&full_body, start, end);
            return Some(LinkToken { raw, line_style, cap, label: unquoted(&label) });
        }
    }
    let mut byte_end = rest.char_indices().nth(index).map_or(rest.len(), |(offset, _)| offset);
    let after = &rest[byte_end..];
    let after_trimmed = after.trim_start();
    if let Some(inner) = after_trimmed.strip_prefix('|') {
        if let Some(close) = inner.find('|') {
            label = inner[..close].to_string();
            byte_end += after.len() - after_trimmed.len() + 1 + close + 1;
        }
    }
    let (line_style, cap) = style_and_cap(&body, start, end);
    let raw = rest[..byte_end].to_string();
    cursor.position += byte_end;
    Some(LinkToken { raw, line_style, cap, label: unquoted(&label) })
}

fn read_group(cursor: &mut Cursor) -> Option<Vec<NodeToken>> {
    let mut group = vec![read_node(cursor)?];
    loop {
        let saved = cursor.position;
        cursor.skip_spaces();
        if cursor.rest().starts_with('&') {
            cursor.position += 1;
            cursor.skip_spaces();
            match read_node(cursor) {
                Some(node) => group.push(node),
                None => {
                    cursor.position = saved;
                    return Some(group);
                }
            }
        } else {
            cursor.position = saved;
            return Some(group);
        }
    }
}

/// A statement of nodes and links, or `None` for any other statement.
fn read_chain(statement: &str) -> Option<Chain> {
    let mut cursor = Cursor { text: statement, position: 0 };
    cursor.skip_spaces();
    let mut chain = Chain { groups: vec![read_group(&mut cursor)?], links: Vec::new() };
    loop {
        cursor.skip_spaces();
        if cursor.done() {
            return Some(chain);
        }
        let link = read_link(&mut cursor)?;
        cursor.skip_spaces();
        let group = read_group(&mut cursor)?;
        chain.links.push(link);
        chain.groups.push(group);
    }
}

const KEYWORDS: [&str; 10] = ["subgraph", "end", "direction", "classDef", "class", "style", "linkStyle", "click", "accTitle", "accDescr"];

fn statement_keyword(statement: &str) -> Option<&str> {
    let first = statement.split_whitespace().next()?;
    KEYWORDS.iter().copied().find(|keyword| first == *keyword)
}

// --- Reading -------------------------------------------------------------------

/// One link with the statement and the groups it came from.
#[derive(Debug, Clone)]
struct EdgeSource {
    line: usize,
    link: usize,
    from: usize,
    to: usize,
}

struct Parsed {
    lines: Vec<String>,
    model: FlowchartModel,
    edge_sources: Vec<EdgeSource>,
    chains: HashMap<usize, Chain>,
    /// Lines of `style <id>` statements.
    style_lines: HashMap<String, usize>,
}

fn header_of(lines: &[String]) -> Option<(usize, String, String)> {
    let index = super::text::header_line(lines)?;
    let mut words = lines[index].split_whitespace();
    let keyword = words.next()?;
    if !matches!(keyword, "flowchart" | "graph") {
        return None;
    }
    let direction = words.next().unwrap_or("TD").to_string();
    Some((index, keyword.to_string(), direction))
}

fn style_props(rest: &str) -> Vec<(String, String)> {
    rest.split(',')
        .filter_map(|pair| pair.split_once(':'))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .collect()
}

fn parse(source: &str) -> Option<Parsed> {
    let lines = split_lines(source);
    let (header_line, keyword, direction) = header_of(&lines)?;
    let mut model = FlowchartModel { keyword, direction, header_line, nodes: Vec::new(), edges: Vec::new() };
    let mut index_of: HashMap<String, usize> = HashMap::new();
    let mut edge_sources = Vec::new();
    let mut chains = HashMap::new();
    let mut style_lines = HashMap::new();
    let mut node = |model: &mut FlowchartModel, token: &NodeToken, line: usize| {
        let position = *index_of.entry(token.id.clone()).or_insert_with(|| {
            model.nodes.push(FlowNode {
                id: token.id.clone(),
                label: token.id.clone(),
                shape: "rect".to_string(),
                icon: None,
                border: None,
                fill: FillMode::Surface,
                text_size: TextSize::M,
                lines: Vec::new(),
            });
            model.nodes.len() - 1
        });
        let entry = &mut model.nodes[position];
        if let Some(shape) = &token.shape {
            entry.shape = shape.clone();
        }
        if let Some(label) = &token.label {
            entry.label = label.clone();
        }
        if token.icon.is_some() {
            entry.icon = token.icon.clone();
        }
        if !entry.lines.contains(&line) {
            entry.lines.push(line);
        }
    };
    for (line_index, line) in lines.iter().enumerate().skip(header_line + 1) {
        if is_blank_or_comment(line) {
            continue;
        }
        for statement in line.split(';').filter(|statement| !statement.trim().is_empty()) {
            let trimmed = statement.trim();
            match statement_keyword(trimmed) {
                Some("direction") | Some("subgraph") | Some("end") | Some("classDef") | Some("class") | Some("linkStyle") | Some("click")
                | Some("accTitle") | Some("accDescr") => continue,
                Some("style") => {
                    if let Some(id) = trimmed.split_whitespace().nth(1) {
                        style_lines.insert(id.to_string(), line_index);
                    }
                    continue;
                }
                _ => {}
            }
            let Some(chain) = read_chain(trimmed) else { continue };
            for group in &chain.groups {
                for token in group {
                    node(&mut model, token, line_index);
                }
            }
            for (link_position, link) in chain.links.iter().enumerate() {
                for (from_index, from) in chain.groups[link_position].iter().enumerate() {
                    for (to_index, to) in chain.groups[link_position + 1].iter().enumerate() {
                        let index = model.edges.len();
                        let op = link_op(link.line_style, link.cap).to_string();
                        model.edges.push(FlowEdge {
                            index,
                            from: from.id.clone(),
                            to: to.id.clone(),
                            label: link.label.clone(),
                            line_style: link.line_style,
                            cap: link.cap,
                            op,
                            line: line_index,
                        });
                        edge_sources.push(EdgeSource { line: line_index, link: link_position, from: from_index, to: to_index });
                    }
                }
            }
            if lines[line_index].split(';').filter(|part| !part.trim().is_empty()).count() == 1 {
                chains.insert(line_index, chain);
            }
        }
    }
    // Styles written before or after their node.
    for (id, line_index) in &style_lines {
        let Some(&position) = index_of.get(id) else { continue };
        let entry = &mut model.nodes[position];
        if !entry.lines.contains(line_index) {
            entry.lines.push(*line_index);
        }
        let rest = lines[*line_index].trim().splitn(3, char::is_whitespace).nth(2).unwrap_or_default().to_string();
        for (key, value) in style_props(&rest) {
            match key.as_str() {
                "stroke" => entry.border = Some(value.to_uppercase()),
                "fill" if value == "transparent" || value == "none" => entry.fill = FillMode::None,
                "fill" => entry.fill = FillMode::Tint,
                "font-size" => {
                    let px = value.trim_end_matches("px").parse::<u32>().unwrap_or(16);
                    entry.text_size = if px <= 14 { TextSize::S } else if px >= 18 { TextSize::L } else { TextSize::M };
                }
                _ => {}
            }
        }
    }
    for entry in &mut model.nodes {
        entry.lines.sort_unstable();
    }
    Some(Parsed { lines, model, edge_sources, chains, style_lines })
}

/// The model of a flowchart source; `None` when it is not a flowchart.
pub fn read(source: &str) -> Option<FlowchartModel> {
    parse(source).map(|parsed| parsed.model)
}

// --- Writing -------------------------------------------------------------------

/// The operator of a link with this line and end.
pub fn link_op(line_style: LineStyle, cap: EdgeCap) -> &'static str {
    match (line_style, cap) {
        (LineStyle::Invisible, _) => "~~~",
        (LineStyle::Solid, EdgeCap::Arrow) => "-->",
        (LineStyle::Solid, EdgeCap::None) => "---",
        (LineStyle::Solid, EdgeCap::Circle) => "--o",
        (LineStyle::Solid, EdgeCap::Cross) => "--x",
        (LineStyle::Solid, EdgeCap::Both) => "<-->",
        (LineStyle::Dotted, EdgeCap::Arrow) => "-.->",
        (LineStyle::Dotted, EdgeCap::None) => "-.-",
        (LineStyle::Dotted, EdgeCap::Circle) => "-.-o",
        (LineStyle::Dotted, EdgeCap::Cross) => "-.-x",
        (LineStyle::Dotted, EdgeCap::Both) => "<-.->",
        (LineStyle::Thick, EdgeCap::Arrow) => "==>",
        (LineStyle::Thick, EdgeCap::None) => "===",
        (LineStyle::Thick, EdgeCap::Circle) => "==o",
        (LineStyle::Thick, EdgeCap::Cross) => "==x",
        (LineStyle::Thick, EdgeCap::Both) => "<==>",
    }
}

fn link_text(line_style: LineStyle, cap: EdgeCap, label: &str) -> String {
    let op = link_op(line_style, cap);
    if line_style == LineStyle::Invisible || label.trim().is_empty() {
        op.to_string()
    } else {
        format!("{op}|{}|", quoted(label))
    }
}

/// A node definition: `id@{ shape: x, label: "y" }`.
fn node_definition(id: &str, shape: &str, label: &str, icon: Option<&str>, extra: &[(String, String)]) -> String {
    let mut pairs = Vec::new();
    if let Some(icon) = icon {
        pairs.push(format!("icon: {}", quoted(icon)));
        pairs.push("form: \"square\"".to_string());
    } else {
        pairs.push(format!("shape: {shape}"));
    }
    pairs.push(format!("label: {}", quoted(label)));
    for (key, value) in extra.iter().filter(|(key, _)| key != "form" || icon.is_none()) {
        pairs.push(format!("{key}: {value}"));
    }
    format!("{id}@{{ {} }}", pairs.join(", "))
}

fn validate_shape(shape: &str) -> Result<(), BackendError> {
    if SHAPES.contains(&shape) {
        Ok(())
    } else {
        Err(BackendError::invalid_input("Esa forma no existe."))
    }
}

fn validate_icon(icon: &str) -> Result<String, BackendError> {
    let icon = icon.trim();
    let valid = icon.split_once(':').is_some_and(|(pack, name)| {
        !pack.is_empty() && !name.is_empty() && icon.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_'))
    });
    if valid {
        Ok(icon.to_string())
    } else {
        Err(BackendError::invalid_input("El ícono no es válido."))
    }
}

fn label_of(text: &str) -> Result<String, BackendError> {
    let label = clean_label(text, MAX_LABEL_CHARS);
    if label.is_empty() {
        return Err(BackendError::invalid_input("Escribí un texto."));
    }
    Ok(label)
}

/// `n<k>`, the first free one from the node count up.
fn new_node_id(model: &FlowchartModel) -> String {
    (model.nodes.len() + 1..)
        .map(|number| format!("n{number}"))
        .find(|id| !model.nodes.iter().any(|node| &node.id == id))
        .unwrap_or_else(|| "n".to_string())
}

/// Rewrites the token of node `id` in the line that defines it (or adds a
/// definition line), with `change` applied to its shape, label and icon.
fn rewrite_definition(
    parsed: &mut Parsed,
    id: &str,
    change: impl Fn(&mut String, &mut String, &mut Option<String>),
) -> Result<(), BackendError> {
    let node = parsed.model.nodes.iter().find(|node| node.id == id).ok_or_else(missing_node)?.clone();
    let (mut shape, mut label, mut icon) = (node.shape.clone(), node.label.clone(), node.icon.clone());
    change(&mut shape, &mut label, &mut icon);
    // The token that defines the node (the first one with a definition).
    for &line_index in &node.lines {
        let line = parsed.lines[line_index].clone();
        let indent = indent_of(&line);
        let Some(chain) = read_chain(line.trim()) else { continue };
        let Some(token) = chain.groups.iter().flatten().find(|token| token.id == id && token.raw.len() > token.id.len()).cloned() else {
            continue;
        };
        let definition = node_definition(id, &shape, &label, icon.as_deref(), &token.extra);
        let replaced = replace_token(line.trim(), &token.raw, &definition);
        parsed.lines[line_index] = format!("{indent}{replaced}");
        return Ok(());
    }
    // Only bare references: the definition goes on its own line, after the header.
    let indent = body_indent(&parsed.lines, parsed.model.header_line);
    let definition = node_definition(id, &shape, &label, icon.as_deref(), &[]);
    parsed.lines.insert(parsed.model.header_line + 1, format!("{indent}{definition}"));
    Ok(())
}

/// `statement` with the first whole-token occurrence of `raw` replaced.
fn replace_token(statement: &str, raw: &str, replacement: &str) -> String {
    let mut search_from = 0;
    while let Some(found) = statement[search_from..].find(raw) {
        let start = search_from + found;
        let end = start + raw.len();
        let before_ok = statement[..start].chars().next_back().is_none_or(|c| !is_id_char(c));
        let after_ok = !raw.chars().last().is_some_and(is_id_char) || statement[end..].chars().next().is_none_or(|c| !is_id_char(c));
        if before_ok && after_ok {
            return format!("{}{}{}", &statement[..start], replacement, &statement[end..]);
        }
        search_from = end;
    }
    statement.to_string()
}

fn missing_node() -> BackendError {
    BackendError::invalid_input("Ese nodo ya no está en el diagrama.")
}

fn missing_edge() -> BackendError {
    BackendError::invalid_input("Esa conexión ya no está en el diagrama.")
}

/// Splits the statement of link `index` into one statement per link, so
/// that link can be edited alone. Returns the line now holding it.
fn isolate_edge(parsed: &mut Parsed, index: usize) -> Result<usize, BackendError> {
    let source = parsed.edge_sources.get(index).cloned().ok_or_else(missing_edge)?;
    let line = parsed.lines[source.line].clone();
    let chain = parsed.chains.get(&source.line).cloned().ok_or_else(|| {
        BackendError::invalid_input("Esa conexión está en una línea con varias sentencias; editala en el código.")
    })?;
    let single = chain.links.len() == 1 && chain.groups[0].len() == 1 && chain.groups[1].len() == 1;
    if single {
        return Ok(source.line);
    }
    let indent = indent_of(&line);
    let mut expanded = Vec::new();
    let mut target = 0;
    let mut defined: Vec<String> = Vec::new();
    for (link_position, link) in chain.links.iter().enumerate() {
        for (from_index, from) in chain.groups[link_position].iter().enumerate() {
            for (to_index, to) in chain.groups[link_position + 1].iter().enumerate() {
                let mut token_text = |token: &NodeToken| {
                    if defined.contains(&token.id) {
                        token.id.clone()
                    } else {
                        defined.push(token.id.clone());
                        token.raw.clone()
                    }
                };
                let text = format!("{indent}{} {} {}", token_text(from), link.raw.trim(), token_text(to));
                if link_position == source.link && from_index == source.from && to_index == source.to {
                    target = expanded.len();
                }
                expanded.push(text);
            }
        }
    }
    let count = expanded.len();
    parsed.lines.splice(source.line..=source.line, expanded);
    let _ = count;
    Ok(source.line + target)
}

fn reparse(lines: &[String]) -> Result<Parsed, BackendError> {
    parse(&join_lines(lines)).ok_or_else(|| BackendError::invalid_input("El diagrama dejó de ser un diagrama de flujo."))
}

/// Rewrites the single-link statement on `line` with `change` applied.
fn rewrite_edge(parsed: &mut Parsed, index: usize, change: impl Fn(&mut FlowEdge)) -> Result<(), BackendError> {
    let line_index = isolate_edge(parsed, index)?;
    *parsed = reparse(&parsed.lines)?;
    let chain = parsed.chains.get(&line_index).cloned().ok_or_else(missing_edge)?;
    let mut edge = parsed.model.edges.iter().find(|edge| edge.line == line_index).cloned().ok_or_else(missing_edge)?;
    change(&mut edge);
    let indent = indent_of(&parsed.lines[line_index]);
    let (from, to) = (&chain.groups[0][0], &chain.groups[1][0]);
    let (from_raw, to_raw) = if edge.from == from.id { (from.raw.clone(), to.raw.clone()) } else { (to.raw.clone(), from.raw.clone()) };
    parsed.lines[line_index] = format!("{indent}{from_raw} {} {to_raw}", link_text(edge.line_style, edge.cap, &edge.label));
    Ok(())
}

fn style_line(id: &str, border: Option<&str>, fill: FillMode, text_size: TextSize) -> Option<String> {
    let mut props = Vec::new();
    if let Some(border) = border {
        props.push(format!("stroke:{border}"));
    }
    match fill {
        FillMode::Surface => {}
        FillMode::Tint => props.push(format!("fill:{}26", border.unwrap_or(NODE_COLORS[0]))),
        FillMode::None => props.push("fill:transparent".to_string()),
    }
    if text_size != TextSize::M {
        props.push(format!("font-size:{}px", text_size.px()));
    }
    (!props.is_empty()).then(|| format!("style {id} {}", props.join(",")))
}

fn validate_color(color: &str) -> Result<String, BackendError> {
    let color = color.trim().to_uppercase();
    let valid = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if valid {
        Ok(color)
    } else {
        Err(BackendError::invalid_input("El color no es válido."))
    }
}

/// Removes node `id` from a statement line; `None` when nothing is left.
fn without_node(line: &str, id: &str) -> Option<String> {
    let indent = indent_of(line);
    let chain = read_chain(line.trim())?;
    let mut statements = Vec::new();
    for (link_position, link) in chain.links.iter().enumerate() {
        for from in &chain.groups[link_position] {
            for to in &chain.groups[link_position + 1] {
                if from.id != id && to.id != id {
                    statements.push(format!("{indent}{} {} {}", from.raw, link.raw.trim(), to.raw));
                }
            }
        }
    }
    if chain.links.is_empty() {
        let kept = chain.groups[0].iter().filter(|token| token.id != id).map(|token| token.raw.clone()).collect::<Vec<_>>();
        return (!kept.is_empty()).then(|| format!("{indent}{}", kept.join(" & ")));
    }
    // Nodes defined on this line that lose all their links stay defined.
    for token in chain.groups.iter().flatten().filter(|token| token.id != id && token.raw.len() > token.id.len()) {
        if !statements.iter().any(|statement| statement.contains(&token.raw)) {
            statements.push(format!("{indent}{}", token.raw));
        }
    }
    (!statements.is_empty()).then(|| statements.join("\n"))
}

/// Applies `edit` to the flowchart `source`.
pub fn apply(source: &str, edit: FlowchartEdit) -> Result<(String, Option<Selection>), BackendError> {
    let mut parsed = parse(source).ok_or_else(|| BackendError::invalid_input("El diagrama no es un diagrama de flujo."))?;
    // New statements go right after the last one.
    while parsed.lines.len() > parsed.model.header_line + 1 && parsed.lines.last().is_some_and(|line| line.trim().is_empty()) {
        parsed.lines.pop();
    }
    let indent = body_indent(&parsed.lines, parsed.model.header_line);
    let mut selection = None;
    match edit {
        FlowchartEdit::SetDirection { direction } => {
            if !DIRECTIONS.contains(&direction.as_str()) {
                return Err(BackendError::invalid_input("Esa dirección no existe."));
            }
            let header = parsed.model.header_line;
            parsed.lines[header] = format!("{}{} {direction}", indent_of(&parsed.lines[header]), parsed.model.keyword);
        }
        FlowchartEdit::AddNode { shape, label, icon } => {
            let icon = icon.map(|icon| validate_icon(&icon)).transpose()?;
            if icon.is_none() {
                validate_shape(&shape)?;
            }
            let id = new_node_id(&parsed.model);
            let label = match label {
                Some(label) => label_of(&label)?,
                None => icon.as_deref().and_then(|icon| icon.split(':').nth(1)).map(str::to_string).unwrap_or_else(|| "Nuevo nodo".to_string()),
            };
            parsed.lines.push(format!("{indent}{}", node_definition(&id, &shape, &label, icon.as_deref(), &[])));
            selection = Some(Selection::new("node", &id));
        }
        FlowchartEdit::SetNodeLabel { id, label } => {
            let label = label_of(&label)?;
            rewrite_definition(&mut parsed, &id, |_, current, _| *current = label.clone())?;
            selection = Some(Selection::new("node", &id));
        }
        FlowchartEdit::SetNodeShape { id, shape } => {
            validate_shape(&shape)?;
            rewrite_definition(&mut parsed, &id, |current, _, icon| {
                *current = shape.clone();
                if shape != "icon" {
                    *icon = None;
                }
            })?;
            selection = Some(Selection::new("node", &id));
        }
        FlowchartEdit::SetNodeIcon { id, icon } => {
            let icon = validate_icon(&icon)?;
            rewrite_definition(&mut parsed, &id, |shape, _, current| {
                *shape = "icon".to_string();
                *current = Some(icon.clone());
            })?;
            selection = Some(Selection::new("node", &id));
        }
        FlowchartEdit::SetNodeStyle { id, border, fill, text_size } => {
            if !parsed.model.nodes.iter().any(|node| node.id == id) {
                return Err(missing_node());
            }
            let border = border.map(|color| validate_color(&color)).transpose()?.filter(|color| color != NODE_COLORS[0]);
            let line = style_line(&id, border.as_deref(), fill, text_size).map(|line| format!("{indent}{line}"));
            match (parsed.style_lines.get(&id).copied(), line) {
                (Some(existing), Some(line)) => parsed.lines[existing] = line,
                (Some(existing), None) => {
                    parsed.lines.remove(existing);
                }
                (None, Some(line)) => parsed.lines.push(line),
                (None, None) => {}
            }
            selection = Some(Selection::new("node", &id));
        }
        FlowchartEdit::DuplicateNode { id } => {
            let node = parsed.model.nodes.iter().find(|node| node.id == id).cloned().ok_or_else(missing_node)?;
            let copy = new_node_id(&parsed.model);
            parsed.lines.push(format!("{indent}{}", node_definition(&copy, &node.shape, &node.label, node.icon.as_deref(), &[])));
            if let Some(line) = style_line(&copy, node.border.as_deref(), node.fill, node.text_size) {
                parsed.lines.push(format!("{indent}{line}"));
            }
            selection = Some(Selection::new("node", &copy));
        }
        FlowchartEdit::DeleteNode { id } => {
            let node = parsed.model.nodes.iter().find(|node| node.id == id).cloned().ok_or_else(missing_node)?;
            let mut lines = node.lines.clone();
            lines.sort_unstable_by(|a, b| b.cmp(a));
            for line_index in lines {
                let line = parsed.lines[line_index].clone();
                let first = line.split_whitespace().next().unwrap_or_default();
                let replacement = if first == "style" { None } else { without_node(&line, &id) };
                match replacement {
                    Some(text) => {
                        let split = split_lines(&text);
                        parsed.lines.splice(line_index..=line_index, split);
                    }
                    None => {
                        parsed.lines.remove(line_index);
                    }
                }
            }
        }
        FlowchartEdit::Connect { from, to } => {
            for id in [&from, &to] {
                if !parsed.model.nodes.iter().any(|node| &node.id == id) {
                    return Err(missing_node());
                }
            }
            if from == to {
                return Err(BackendError::invalid_input("Elegí otro nodo para conectar."));
            }
            let index = parsed.model.edges.len();
            parsed.lines.push(format!("{indent}{from} --> {to}"));
            selection = Some(Selection::new("edge", &index.to_string()));
        }
        FlowchartEdit::SetEdgeLabel { index, label } => {
            let label = clean_label(&label, MAX_LABEL_CHARS);
            rewrite_edge(&mut parsed, index, |edge| edge.label = label.clone())?;
            selection = Some(Selection::new("edge", &index.to_string()));
        }
        FlowchartEdit::SetEdgeLine { index, line_style } => {
            rewrite_edge(&mut parsed, index, |edge| edge.line_style = line_style)?;
            selection = Some(Selection::new("edge", &index.to_string()));
        }
        FlowchartEdit::SetEdgeCap { index, cap } => {
            rewrite_edge(&mut parsed, index, |edge| edge.cap = cap)?;
            selection = Some(Selection::new("edge", &index.to_string()));
        }
        FlowchartEdit::SwapEdge { index } => {
            rewrite_edge(&mut parsed, index, |edge| std::mem::swap(&mut edge.from, &mut edge.to))?;
            selection = Some(Selection::new("edge", &index.to_string()));
        }
        FlowchartEdit::DeleteEdge { index } => {
            let line_index = isolate_edge(&mut parsed, index)?;
            let reparsed = reparse(&parsed.lines)?;
            let chain = reparsed.chains.get(&line_index).cloned().ok_or_else(missing_edge)?;
            let indent = indent_of(&parsed.lines[line_index]);
            // Definitions written on the link survive it.
            let kept = chain.groups.iter().flatten().filter(|token| token.raw.len() > token.id.len()).map(|token| format!("{indent}{}", token.raw)).collect::<Vec<_>>();
            parsed.lines.splice(line_index..=line_index, kept);
        }
        FlowchartEdit::Format => {
            return Ok((format(&parsed), None));
        }
    }
    Ok((join_lines(&parsed.lines), selection))
}

/// The diagram rewritten in the editor's layout: header, one definition per
/// node, one statement per link, the other statements, then the styles.
fn format(parsed: &Parsed) -> String {
    let model = &parsed.model;
    let indent = "  ";
    let mut out = vec![format!("{} {}", model.keyword, model.direction)];
    for node in &model.nodes {
        out.push(format!("{indent}{}", node_definition(&node.id, &node.shape, &node.label, node.icon.as_deref(), &[])));
    }
    for edge in &model.edges {
        out.push(format!("{indent}{} {} {}", edge.from, link_text(edge.line_style, edge.cap, &edge.label), edge.to));
    }
    for (line_index, line) in parsed.lines.iter().enumerate().skip(model.header_line + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty() || parsed.chains.contains_key(&line_index) || trimmed.starts_with("style ") {
            continue;
        }
        if read_chain(trimmed).is_some() && statement_keyword(trimmed).is_none() {
            continue;
        }
        out.push(format!("{indent}{}", single_line(trimmed)));
    }
    for node in &model.nodes {
        if let Some(line) = style_line(&node.id, node.border.as_deref(), node.fill, node.text_size) {
            out.push(format!("{indent}{line}"));
        }
    }
    join_lines(&out)
}

/// A new flowchart.
pub fn template() -> String {
    "flowchart TD\n  inicio@{ shape: stadium, label: \"Inicio\" }\n  paso@{ shape: rect, label: \"Paso\" }\n  inicio --> paso\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(source: &str, edit: FlowchartEdit) -> String {
        apply(source, edit).expect("edit").0
    }

    #[test]
    fn statements_are_read_with_shapes_labels_chains_and_ampersands() {
        let source = "flowchart LR\n  a@{ shape: diam, label: \"¿Sigue?\" }\n  a -->|sí| b[Paso uno] -.-> c((Fin))\n  b & c --- d{{Hex}}\n  d -- texto largo --> a\n  e ~~~ f\n  g <==> h\n  i --x j\n  %% comentario\n  style b stroke:#4FD1C5,fill:#4FD1C526,font-size:20px\n";
        let model = read(source).expect("flowchart");
        assert_eq!((model.keyword.as_str(), model.direction.as_str()), ("flowchart", "LR"));
        let node = |id: &str| model.nodes.iter().find(|node| node.id == id).expect(id).clone();
        assert_eq!((node("a").shape.as_str(), node("a").label.as_str()), ("diam", "¿Sigue?"));
        assert_eq!((node("b").shape.as_str(), node("b").label.as_str()), ("rect", "Paso uno"));
        assert_eq!(node("c").shape, "circle");
        assert_eq!(node("d").shape, "hex");
        assert_eq!(node("b").border.as_deref(), Some("#4FD1C5"));
        assert_eq!((node("b").fill, node("b").text_size), (FillMode::Tint, TextSize::L));
        assert_eq!(node("b").lines, vec![2, 3, 9]);
        let edges = model.edges.iter().map(|edge| (edge.from.as_str(), edge.to.as_str(), edge.label.as_str(), edge.line_style, edge.cap)).collect::<Vec<_>>();
        assert_eq!(
            edges,
            vec![
                ("a", "b", "sí", LineStyle::Solid, EdgeCap::Arrow),
                ("b", "c", "", LineStyle::Dotted, EdgeCap::Arrow),
                ("b", "d", "", LineStyle::Solid, EdgeCap::None),
                ("c", "d", "", LineStyle::Solid, EdgeCap::None),
                ("d", "a", "texto largo", LineStyle::Solid, EdgeCap::Arrow),
                ("e", "f", "", LineStyle::Invisible, EdgeCap::None),
                ("g", "h", "", LineStyle::Thick, EdgeCap::Both),
                ("i", "j", "", LineStyle::Solid, EdgeCap::Cross),
            ]
        );
        assert_eq!(model.edges[4].line, 4);
        assert!(read("sequenceDiagram\n  A->>B: hola").is_none());
    }

    #[test]
    fn nodes_are_added_relabelled_reshaped_styled_and_deleted() {
        let source = "flowchart TD\n  a[Uno] --> b\n";
        let (added, selection) = apply(source, FlowchartEdit::AddNode { shape: "cyl".into(), label: None, icon: None }).expect("add");
        assert_eq!(selection, Some(Selection::new("node", "n3")));
        assert!(added.ends_with("  n3@{ shape: cyl, label: \"Nuevo nodo\" }\n"));

        let relabelled = edit(source, FlowchartEdit::SetNodeLabel { id: "a".into(), label: "Dice \"hola\"".into() });
        assert_eq!(relabelled, "flowchart TD\n  a@{ shape: rect, label: \"Dice #quot;hola#quot;\" } --> b\n");
        // A node only referenced gets its own definition line.
        let defined = edit(source, FlowchartEdit::SetNodeShape { id: "b".into(), shape: "diam".into() });
        assert_eq!(defined, "flowchart TD\n  b@{ shape: diam, label: \"b\" }\n  a[Uno] --> b\n");
        let iconed = edit(source, FlowchartEdit::SetNodeIcon { id: "b".into(), icon: "fa:user".into() });
        assert!(iconed.contains("b@{ icon: \"fa:user\", form: \"square\", label: \"b\" }"));
        let icon_node = read(&iconed).expect("model").nodes.into_iter().find(|node| node.id == "b").expect("b");
        assert_eq!((icon_node.icon.as_deref(), icon_node.shape.as_str()), (Some("fa:user"), "icon"));

        let styled = edit(source, FlowchartEdit::SetNodeStyle { id: "a".into(), border: Some("#6c8eff".into()), fill: FillMode::Tint, text_size: TextSize::S });
        assert!(styled.ends_with("  style a stroke:#6C8EFF,fill:#6C8EFF26,font-size:13px\n"));
        let plain = edit(&styled, FlowchartEdit::SetNodeStyle { id: "a".into(), border: Some("#46536F".into()), fill: FillMode::Surface, text_size: TextSize::M });
        assert_eq!(plain, source);

        let deleted = edit("flowchart TD\n  a[Uno] --> b & c\n  b --> c\n  style b stroke:#FF6B6B\n", FlowchartEdit::DeleteNode { id: "b".into() });
        assert_eq!(deleted, "flowchart TD\n  a[Uno] --> c\n");
        let duplicated = apply(source, FlowchartEdit::DuplicateNode { id: "a".into() }).expect("duplicate");
        assert!(duplicated.0.ends_with("  n3@{ shape: rect, label: \"Uno\" }\n"));
    }

    #[test]
    fn links_are_edited_alone_even_inside_chains() {
        let source = "flowchart TD\n  a[Uno] --> b & c\n";
        let labelled = edit(source, FlowchartEdit::SetEdgeLabel { index: 1, label: "no".into() });
        assert_eq!(labelled, "flowchart TD\n  a[Uno] --> b\n  a -->|\"no\"| c\n");
        let model = read(&labelled).expect("model");
        assert_eq!(model.edges[1].label, "no");
        let dotted = edit(&labelled, FlowchartEdit::SetEdgeLine { index: 0, line_style: LineStyle::Dotted });
        assert_eq!(dotted, "flowchart TD\n  a[Uno] -.-> b\n  a -->|\"no\"| c\n");
        let both = edit(&dotted, FlowchartEdit::SetEdgeCap { index: 0, cap: EdgeCap::Both });
        assert!(both.contains("a[Uno] <-.-> b"));
        let swapped = edit("flowchart TD\n  a[Uno] --> b\n", FlowchartEdit::SwapEdge { index: 0 });
        assert_eq!(swapped, "flowchart TD\n  b --> a[Uno]\n");
        let deleted = edit("flowchart TD\n  a[Uno] --> b\n  b --> a\n", FlowchartEdit::DeleteEdge { index: 0 });
        assert_eq!(deleted, "flowchart TD\n  a[Uno]\n  b --> a\n");
        let (connected, selection) = apply(source, FlowchartEdit::Connect { from: "c".into(), to: "a".into() }).expect("connect");
        assert!(connected.ends_with("  c --> a\n"));
        assert_eq!(selection, Some(Selection::new("edge", "2")));
        let invisible = edit("flowchart TD\n  a -->|x| b\n", FlowchartEdit::SetEdgeLine { index: 0, line_style: LineStyle::Invisible });
        assert_eq!(invisible, "flowchart TD\n  a ~~~ b\n");
    }

    #[test]
    fn direction_and_format() {
        assert_eq!(edit("graph TD\n  a --> b\n", FlowchartEdit::SetDirection { direction: "LR".into() }), "graph LR\n  a --> b\n");
        assert!(apply("graph TD\n", FlowchartEdit::SetDirection { direction: "XX".into() }).is_err());
        let formatted = edit(
            "flowchart TD\n  a[Uno] --> b & c\n  classDef x fill:#f00\n  style a stroke:#FF6B6B\n",
            FlowchartEdit::Format,
        );
        assert_eq!(
            formatted,
            "flowchart TD\n  a@{ shape: rect, label: \"Uno\" }\n  b@{ shape: rect, label: \"b\" }\n  c@{ shape: rect, label: \"c\" }\n  a --> b\n  a --> c\n  classDef x fill:#f00\n  style a stroke:#FF6B6B\n"
        );
    }
}
