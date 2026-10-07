//! Class diagrams: classes with their stereotype, attributes and methods,
//! and relations with their type, multiplicities and label.

use serde::{Deserialize, Serialize};

use super::text::{body_indent, clean_label, header_line, indent_of, is_blank_or_comment, join_lines, pascal_identifier, split_lines, unique_name};
use super::Selection;
use crate::error::BackendError;

const MAX_TEXT_CHARS: usize = 120;
pub const DIRECTIONS: [&str; 4] = ["TB", "LR", "BT", "RL"];
const VISIBILITIES: [&str; 4] = ["+", "-", "#", "~"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stereotype {
    None,
    Interface,
    Abstract,
    Enumeration,
}

impl Stereotype {
    fn annotation(self) -> Option<&'static str> {
        match self {
            Stereotype::None => None,
            Stereotype::Interface => Some("<<interface>>"),
            Stereotype::Abstract => Some("<<abstract>>"),
            Stereotype::Enumeration => Some("<<enumeration>>"),
        }
    }

    fn from_annotation(text: &str) -> Self {
        match text.trim().trim_start_matches("<<").trim_end_matches(">>").to_lowercase().as_str() {
            "interface" => Stereotype::Interface,
            "abstract" => Stereotype::Abstract,
            "enumeration" | "enum" => Stereotype::Enumeration,
            _ => Stereotype::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RelationKind {
    Inheritance,
    Realization,
    Composition,
    Aggregation,
    Association,
    Dependency,
    Link,
    DashedLink,
}

impl RelationKind {
    pub fn op(self) -> &'static str {
        match self {
            RelationKind::Inheritance => "<|--",
            RelationKind::Realization => "<|..",
            RelationKind::Composition => "*--",
            RelationKind::Aggregation => "o--",
            RelationKind::Association => "-->",
            RelationKind::Dependency => "..>",
            RelationKind::Link => "--",
            RelationKind::DashedLink => "..",
        }
    }
}

/// Operators as written; the reversed ones swap the classes.
const OPERATORS: [(&str, RelationKind, bool); 14] = [
    ("<|--", RelationKind::Inheritance, false),
    ("--|>", RelationKind::Inheritance, true),
    ("<|..", RelationKind::Realization, false),
    ("..|>", RelationKind::Realization, true),
    ("*--", RelationKind::Composition, false),
    ("--*", RelationKind::Composition, true),
    ("o--", RelationKind::Aggregation, false),
    ("--o", RelationKind::Aggregation, true),
    ("-->", RelationKind::Association, false),
    ("<--", RelationKind::Association, true),
    ("..>", RelationKind::Dependency, false),
    ("<..", RelationKind::Dependency, true),
    ("--", RelationKind::Link, false),
    ("..", RelationKind::DashedLink, false),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    /// `+`, `-`, `#`, `~` or empty.
    pub visibility: String,
    /// Attribute type, or method return type.
    pub type_name: String,
    pub name: String,
    /// Method arguments; `None` for an attribute.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassNode {
    pub name: String,
    pub stereotype: Stereotype,
    pub attributes: Vec<Member>,
    pub methods: Vec<Member>,
    pub lines: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub index: usize,
    pub a: String,
    pub b: String,
    pub kind: RelationKind,
    pub mult_a: String,
    pub mult_b: String,
    pub label: String,
    /// The operator of its type (`*--`).
    pub op: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassModel {
    pub header_line: usize,
    pub direction: String,
    pub classes: Vec<ClassNode>,
    pub relations: Vec<Relation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MemberKind {
    Attribute,
    Method,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    A,
    B,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClassEdit {
    SetDirection { direction: String },
    AddClass { stereotype: Stereotype },
    RenameClass { name: String, new_name: String },
    SetStereotype { name: String, stereotype: Stereotype },
    AddMember { name: String, kind: MemberKind },
    /// `+` → `-` → `#` → `~` → `+`.
    CycleVisibility { name: String, kind: MemberKind, index: usize },
    DeleteMember { name: String, kind: MemberKind, index: usize },
    DeleteClass { name: String },
    AddRelation { a: String, b: String, kind: Option<RelationKind> },
    SetRelationKind { index: usize, kind: RelationKind },
    SetMultiplicity { index: usize, side: Side, value: String },
    SetRelationLabel { index: usize, label: String },
    DeleteRelation { index: usize },
}

struct Parsed {
    lines: Vec<String>,
    model: ClassModel,
    direction_line: Option<usize>,
    /// `class Name {` … `}` line ranges by class.
    blocks: Vec<(String, usize, usize)>,
}

fn read_member(text: &str, line: usize) -> Member {
    let text = text.trim();
    let (visibility, rest) = match text.chars().next() {
        Some(c) if VISIBILITIES.contains(&c.to_string().as_str()) => (c.to_string(), text[c.len_utf8()..].trim()),
        _ => (String::new(), text),
    };
    if let (Some(open), Some(close)) = (rest.find('('), rest.rfind(')')) {
        if open < close {
            return Member {
                visibility,
                name: rest[..open].trim().to_string(),
                args: Some(rest[open + 1..close].trim().to_string()),
                type_name: rest[close + 1..].trim().trim_start_matches(':').trim().trim_end_matches(['$', '*']).trim().to_string(),
                line,
            };
        }
    }
    let (type_name, name) = match rest.rsplit_once(char::is_whitespace) {
        Some((type_name, name)) => (type_name.trim().to_string(), name.trim().to_string()),
        None => (String::new(), rest.to_string()),
    };
    Member { visibility, type_name, name, args: None, line }
}

fn member_text(member: &Member) -> String {
    match &member.args {
        Some(args) if member.type_name.is_empty() => format!("{}{}({args})", member.visibility, member.name),
        Some(args) => format!("{}{}({args}) {}", member.visibility, member.name, member.type_name),
        None if member.type_name.is_empty() => format!("{}{}", member.visibility, member.name),
        None => format!("{}{} {}", member.visibility, member.type_name, member.name),
    }
}

/// `A "1" *-- "0..*" B : etiqueta`.
fn read_relation(statement: &str) -> Option<(String, String, RelationKind, String, String, String)> {
    let (head, label) = match statement.split_once(" : ").or_else(|| statement.split_once(':')) {
        Some((head, label)) => (head, label.trim().to_string()),
        None => (statement, String::new()),
    };
    let quoted = |text: &str| -> Option<(String, usize)> {
        let text_start = text.len() - text.trim_start().len();
        let rest = text.trim_start().strip_prefix('"')?;
        let close = rest.find('"')?;
        Some((rest[..close].to_string(), text_start + 1 + close + 1))
    };
    // The name ends at a space or a quote; written without spaces, at the
    // first operator after its first character.
    let mut position = head
        .find(|c: char| c.is_whitespace() || c == '"')
        .or_else(|| OPERATORS.iter().filter_map(|(op, _, _)| head.get(1..)?.find(op).map(|found| found + 1)).min())
        .unwrap_or(head.len());
    let a = head[..position].trim().to_string();
    if a.is_empty() {
        return None;
    }
    let mut mult_a = String::new();
    if let Some((value, consumed)) = quoted(&head[position..]) {
        mult_a = value;
        position += consumed;
    }
    let rest = head[position..].trim_start();
    let (op, kind, reversed) = OPERATORS.iter().find(|(op, _, _)| rest.starts_with(op)).copied()?;
    let mut rest = rest[op.len()..].to_string();
    let mut mult_b = String::new();
    if let Some((value, consumed)) = quoted(&rest) {
        mult_b = value;
        rest = rest[consumed..].to_string();
    }
    let b = rest.trim().to_string();
    if b.is_empty() || b.contains(char::is_whitespace) || a.contains(char::is_whitespace) {
        return None;
    }
    Some(if reversed { (b, a, kind, mult_b, mult_a, label) } else { (a, b, kind, mult_a, mult_b, label) })
}

fn class_name(text: &str) -> String {
    text.trim().split(['{', '[', '~']).next().unwrap_or_default().trim().to_string()
}

fn parse(source: &str) -> Option<Parsed> {
    let lines = split_lines(source);
    let header = header_line(&lines)?;
    if !matches!(lines[header].split_whitespace().next()?, "classDiagram" | "classDiagram-v2") {
        return None;
    }
    let mut model = ClassModel { header_line: header, direction: "TB".to_string(), classes: Vec::new(), relations: Vec::new() };
    let mut direction_line = None;
    let mut blocks = Vec::new();
    let mut open: Option<(String, usize)> = None;
    fn class(model: &mut ClassModel, name: &str) -> usize {
        if let Some(position) = model.classes.iter().position(|class| class.name == name) {
            return position;
        }
        model.classes.push(ClassNode { name: name.to_string(), stereotype: Stereotype::None, attributes: Vec::new(), methods: Vec::new(), lines: Vec::new() });
        model.classes.len() - 1
    }
    fn add_member(model: &mut ClassModel, position: usize, text: &str, line: usize) {
        let member = read_member(text, line);
        if member.name.is_empty() {
            return;
        }
        if member.args.is_some() {
            model.classes[position].methods.push(member);
        } else {
            model.classes[position].attributes.push(member);
        }
        if !model.classes[position].lines.contains(&line) {
            model.classes[position].lines.push(line);
        }
    }
    for (index, line) in lines.iter().enumerate().skip(header + 1) {
        if is_blank_or_comment(line) {
            continue;
        }
        let statement = line.trim();
        if let Some((name, start)) = open.clone() {
            let position = class(&mut model, &name);
            model.classes[position].lines.push(index);
            if statement == "}" {
                blocks.push((name, start, index));
                open = None;
            } else if statement.starts_with("<<") {
                model.classes[position].stereotype = Stereotype::from_annotation(statement);
            } else {
                add_member(&mut model, position, statement, index);
            }
            continue;
        }
        let first = statement.split_whitespace().next().unwrap_or_default();
        match first {
            "direction" => {
                model.direction = statement.split_whitespace().nth(1).unwrap_or("TB").to_string();
                direction_line = Some(index);
                continue;
            }
            "class" => {
                let rest = statement["class".len()..].trim();
                let name = class_name(rest);
                if name.is_empty() {
                    continue;
                }
                let position = class(&mut model, &name);
                model.classes[position].lines.push(index);
                if rest.trim_end().ends_with('{') {
                    open = Some((name, index));
                }
                continue;
            }
            "note" | "classDef" | "cssClass" | "style" | "click" | "callback" | "link" => continue,
            _ => {}
        }
        if let Some(annotation) = statement.strip_prefix("<<") {
            if let Some((stereotype, name)) = annotation.split_once(">>") {
                let position = class(&mut model, name.trim());
                model.classes[position].stereotype = Stereotype::from_annotation(stereotype);
                model.classes[position].lines.push(index);
            }
            continue;
        }
        if let Some((a, b, kind, mult_a, mult_b, label)) = read_relation(statement) {
            class(&mut model, &a);
            class(&mut model, &b);
            model.relations.push(Relation { index: model.relations.len(), a, b, kind, mult_a, mult_b, label, op: kind.op().to_string(), line: index });
            continue;
        }
        // `Nombre : +String campo`.
        if let Some((name, member)) = statement.split_once(':') {
            let name = name.trim();
            if !name.is_empty() && !name.contains(char::is_whitespace) {
                let position = class(&mut model, name);
                add_member(&mut model, position, member, index);
            }
        }
    }
    Some(Parsed { lines, model, direction_line, blocks })
}

pub fn read(source: &str) -> Option<ClassModel> {
    parse(source).map(|parsed| parsed.model)
}

fn missing_class() -> BackendError {
    BackendError::invalid_input("Esa clase ya no está en el diagrama.")
}

fn missing_relation() -> BackendError {
    BackendError::invalid_input("Esa relación ya no está en el diagrama.")
}

fn relation_line(indent: &str, relation: &Relation) -> String {
    let mult = |value: &str| if value.is_empty() { String::new() } else { format!(" \"{}\"", value.replace('"', "'")) };
    let label = if relation.label.is_empty() { String::new() } else { format!(" : {}", relation.label) };
    format!("{indent}{}{} {}{} {}{label}", relation.a, mult(&relation.mult_a), relation.kind.op(), mult(&relation.mult_b), relation.b)
}

fn rewrite_relation(parsed: &mut Parsed, index: usize, change: impl FnOnce(&mut Relation)) -> Result<(), BackendError> {
    let mut relation = parsed.model.relations.get(index).cloned().ok_or_else(missing_relation)?;
    change(&mut relation);
    let indent = indent_of(&parsed.lines[relation.line]);
    parsed.lines[relation.line] = relation_line(&indent, &relation);
    Ok(())
}

/// The block of class `name`, made from its `class Name` line (or added at
/// the end) when it has none; returns (opening line, closing line).
fn ensure_block(parsed: &mut Parsed, name: &str, indent: &str) -> (usize, usize) {
    if let Some((_, start, end)) = parsed.blocks.iter().find(|(block, _, _)| block == name) {
        return (*start, *end);
    }
    let declaration = parsed.lines.iter().position(|line| {
        let statement = line.trim();
        statement.strip_prefix("class ").is_some_and(|rest| class_name(rest) == name)
    });
    match declaration {
        Some(line) => {
            let line_indent = indent_of(&parsed.lines[line]);
            let opener = format!("{} {{", parsed.lines[line].trim_end());
            parsed.lines.splice(line..=line, [format!("{line_indent}{}", opener.trim_start()), format!("{line_indent}}}")]);
            (line, line + 1)
        }
        None => {
            let position = parsed.lines.len();
            parsed.lines.extend([format!("{indent}class {name} {{"), format!("{indent}}}")]);
            (position, position + 1)
        }
    }
}

fn reparse(lines: &[String]) -> Result<Parsed, BackendError> {
    parse(&join_lines(lines)).ok_or_else(|| BackendError::invalid_input("El diagrama dejó de ser un diagrama de clases."))
}

fn valid_name(name: &str) -> Result<String, BackendError> {
    let name = pascal_identifier(name.trim(), "Clase");
    if name.chars().count() > MAX_TEXT_CHARS {
        return Err(BackendError::invalid_input("El nombre es demasiado largo."));
    }
    Ok(name)
}

/// `line` with whole-word `old` replaced by `new`.
fn rename_in(line: &str, old: &str, new: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(found) = rest.find(old) {
        let before_ok = rest[..found].chars().next_back().is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        let after_ok = rest[found + old.len()..].chars().next().is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        out.push_str(&rest[..found]);
        out.push_str(if before_ok && after_ok { new } else { old });
        rest = &rest[found + old.len()..];
    }
    out.push_str(rest);
    out
}

pub fn apply(source: &str, edit: ClassEdit) -> Result<(String, Option<Selection>), BackendError> {
    let mut parsed = parse(source).ok_or_else(|| BackendError::invalid_input("El diagrama no es un diagrama de clases."))?;
    while parsed.lines.len() > parsed.model.header_line + 1 && parsed.lines.last().is_some_and(|line| line.trim().is_empty()) {
        parsed.lines.pop();
    }
    let indent = body_indent(&parsed.lines, parsed.model.header_line);
    let mut selection = None;
    match edit {
        ClassEdit::SetDirection { direction } => {
            if !DIRECTIONS.contains(&direction.as_str()) {
                return Err(BackendError::invalid_input("Esa dirección no existe."));
            }
            match parsed.direction_line {
                Some(line) => parsed.lines[line] = format!("{}direction {direction}", indent_of(&parsed.lines[line])),
                None => parsed.lines.insert(parsed.model.header_line + 1, format!("{indent}direction {direction}")),
            }
        }
        ClassEdit::AddClass { stereotype } => {
            let base = match stereotype {
                Stereotype::Interface => "NuevaInterfaz",
                Stereotype::Enumeration => "NuevoEnum",
                _ => "NuevaClase",
            };
            let name = unique_name(base, |name| parsed.model.classes.iter().any(|class| class.name == name));
            let mut block = vec![format!("{indent}class {name} {{")];
            if let Some(annotation) = stereotype.annotation() {
                block.push(format!("{indent}  {annotation}"));
            }
            block.push(format!("{indent}}}"));
            let position = parsed.blocks.iter().map(|(_, _, end)| end + 1).max().unwrap_or(parsed.lines.len());
            parsed.lines.splice(position..position, block);
            selection = Some(Selection::new("class", &name));
        }
        ClassEdit::RenameClass { name, new_name } => {
            if !parsed.model.classes.iter().any(|class| class.name == name) {
                return Err(missing_class());
            }
            let new_name = valid_name(&new_name)?;
            if new_name != name && parsed.model.classes.iter().any(|class| class.name == new_name) {
                return Err(BackendError::invalid_input("Ya hay una clase con ese nombre."));
            }
            for line in parsed.lines.iter_mut().skip(parsed.model.header_line + 1) {
                *line = rename_in(line, &name, &new_name);
            }
            selection = Some(Selection::new("class", &new_name));
        }
        ClassEdit::SetStereotype { name, stereotype } => {
            if !parsed.model.classes.iter().any(|class| class.name == name) {
                return Err(missing_class());
            }
            // Annotations outside the block go away; the block keeps the one.
            let outside = parsed
                .lines
                .iter()
                .enumerate()
                .filter(|(_, line)| line.trim().starts_with("<<") && line.trim().split_once(">>").is_some_and(|(_, rest)| rest.trim() == name))
                .map(|(index, _)| index)
                .rev()
                .collect::<Vec<_>>();
            for index in outside {
                parsed.lines.remove(index);
            }
            parsed = reparse(&parsed.lines)?;
            let (start, end) = ensure_block(&mut parsed, &name, &indent);
            let inside = (start + 1..end).find(|index| parsed.lines[*index].trim().starts_with("<<"));
            let member_indent = format!("{}  ", indent_of(&parsed.lines[start]));
            match (inside, stereotype.annotation()) {
                (Some(index), Some(annotation)) => parsed.lines[index] = format!("{member_indent}{annotation}"),
                (Some(index), None) => {
                    parsed.lines.remove(index);
                }
                (None, Some(annotation)) => parsed.lines.insert(start + 1, format!("{member_indent}{annotation}")),
                (None, None) => {}
            }
            selection = Some(Selection::new("class", &name));
        }
        ClassEdit::AddMember { name, kind } => {
            let class = parsed.model.classes.iter().find(|class| class.name == name).cloned().ok_or_else(missing_class)?;
            let text = match (kind, class.stereotype) {
                (_, Stereotype::Enumeration) => unique_name("NUEVO", |value| class.attributes.iter().any(|member| member.name == value)),
                (MemberKind::Attribute, _) => format!("+String {}", unique_name("nuevoCampo", |value| class.attributes.iter().any(|member| member.name == value))),
                (MemberKind::Method, _) => format!("+{}() void", unique_name("nuevoMetodo", |value| class.methods.iter().any(|member| member.name == value))),
            };
            let (start, end) = ensure_block(&mut parsed, &name, &indent);
            let member_indent = format!("{}  ", indent_of(&parsed.lines[start]));
            parsed.lines.insert(end, format!("{member_indent}{text}"));
            selection = Some(Selection::new("class", &name));
        }
        ClassEdit::CycleVisibility { name, kind, index } => {
            let class = parsed.model.classes.iter().find(|class| class.name == name).cloned().ok_or_else(missing_class)?;
            let members = if kind == MemberKind::Attribute { &class.attributes } else { &class.methods };
            let mut member = members.get(index).cloned().ok_or_else(|| BackendError::invalid_input("Ese miembro ya no está."))?;
            if class.stereotype == Stereotype::Enumeration {
                return Err(BackendError::invalid_input("Los valores de una enumeración no tienen visibilidad."));
            }
            let current = VISIBILITIES.iter().position(|value| *value == member.visibility);
            member.visibility = VISIBILITIES[current.map_or(0, |position| (position + 1) % VISIBILITIES.len())].to_string();
            let line = parsed.lines[member.line].clone();
            let rewritten = match line.split_once(':') {
                Some((owner, _)) if !line.trim_end().ends_with('{') && owner.trim() == name && !parsed.blocks.iter().any(|(_, start, end)| member.line > *start && member.line < *end) => {
                    format!("{owner}: {}", member_text(&member))
                }
                _ => format!("{}{}", indent_of(&line), member_text(&member)),
            };
            parsed.lines[member.line] = rewritten;
            selection = Some(Selection::new("class", &name));
        }
        ClassEdit::DeleteMember { name, kind, index } => {
            let class = parsed.model.classes.iter().find(|class| class.name == name).cloned().ok_or_else(missing_class)?;
            let members = if kind == MemberKind::Attribute { &class.attributes } else { &class.methods };
            let member = members.get(index).ok_or_else(|| BackendError::invalid_input("Ese miembro ya no está."))?;
            parsed.lines.remove(member.line);
            selection = Some(Selection::new("class", &name));
        }
        ClassEdit::DeleteClass { name } => {
            let class = parsed.model.classes.iter().find(|class| class.name == name).cloned().ok_or_else(missing_class)?;
            let mut remove = class.lines.clone();
            remove.extend(parsed.model.relations.iter().filter(|relation| relation.a == name || relation.b == name).map(|relation| relation.line));
            remove.sort_unstable_by(|a, b| b.cmp(a));
            remove.dedup();
            for line in remove {
                parsed.lines.remove(line);
            }
        }
        ClassEdit::AddRelation { a, b, kind } => {
            for name in [&a, &b] {
                if !parsed.model.classes.iter().any(|class| &class.name == name) {
                    return Err(missing_class());
                }
            }
            let index = parsed.model.relations.len();
            let relation = Relation { index, a, b, kind: kind.unwrap_or(RelationKind::Association), mult_a: String::new(), mult_b: String::new(), label: String::new(), op: String::new(), line: 0 };
            let position = parsed.model.relations.iter().map(|relation| relation.line + 1).max().unwrap_or(parsed.lines.len());
            parsed.lines.insert(position, relation_line(&indent, &relation));
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ClassEdit::SetRelationKind { index, kind } => {
            rewrite_relation(&mut parsed, index, |relation| relation.kind = kind)?;
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ClassEdit::SetMultiplicity { index, side, value } => {
            let value = clean_label(&value, 20).replace('"', "");
            rewrite_relation(&mut parsed, index, |relation| match side {
                Side::A => relation.mult_a = value,
                Side::B => relation.mult_b = value,
            })?;
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ClassEdit::SetRelationLabel { index, label } => {
            let label = clean_label(&label, MAX_TEXT_CHARS);
            rewrite_relation(&mut parsed, index, |relation| relation.label = label)?;
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ClassEdit::DeleteRelation { index } => {
            let relation = parsed.model.relations.get(index).cloned().ok_or_else(missing_relation)?;
            parsed.lines.remove(relation.line);
        }
    }
    Ok((join_lines(&parsed.lines), selection))
}

/// A new class diagram.
pub fn template() -> String {
    "classDiagram\n  direction TB\n  class Nota {\n    +String titulo\n    +guardar() void\n  }\n  class Carpeta {\n    +String nombre\n  }\n  Carpeta \"1\" *-- \"0..*\" Nota : contiene\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "classDiagram\n  direction TB\n  class Sincronizable {\n    <<interface>>\n    +sincronizar() Resultado\n  }\n  class Nota {\n    +String id\n    -DateTime creada\n    +enlazar(Nota destino) Enlace\n  }\n  class Carpeta\n  Carpeta : +String nombre\n  Carpeta \"1\" *-- \"0..*\" Nota : contiene\n  Sincronizable <|.. Nota\n  Etiqueta --|> Nota\n";

    fn edit(source: &str, edit: ClassEdit) -> String {
        apply(source, edit).expect("edit").0
    }

    #[test]
    fn classes_members_and_relations_are_read() {
        let model = read(SAMPLE).expect("class");
        let names = model.classes.iter().map(|class| (class.name.as_str(), class.stereotype)).collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                ("Sincronizable", Stereotype::Interface),
                ("Nota", Stereotype::None),
                ("Carpeta", Stereotype::None),
                ("Etiqueta", Stereotype::None),
            ]
        );
        let nota = &model.classes[1];
        assert_eq!(nota.attributes.iter().map(|m| (m.visibility.as_str(), m.type_name.as_str(), m.name.as_str())).collect::<Vec<_>>(), vec![("+", "String", "id"), ("-", "DateTime", "creada")]);
        assert_eq!(nota.methods[0].args.as_deref(), Some("Nota destino"));
        assert_eq!(nota.methods[0].type_name, "Enlace");
        assert_eq!(nota.lines, vec![6, 7, 8, 9, 10]);
        assert_eq!(model.classes[2].attributes[0].name, "nombre");
        let relations = model.relations.iter().map(|r| (r.a.as_str(), r.b.as_str(), r.kind, r.mult_a.as_str(), r.mult_b.as_str(), r.label.as_str())).collect::<Vec<_>>();
        assert_eq!(
            relations,
            vec![
                ("Carpeta", "Nota", RelationKind::Composition, "1", "0..*", "contiene"),
                ("Sincronizable", "Nota", RelationKind::Realization, "", "", ""),
                ("Nota", "Etiqueta", RelationKind::Inheritance, "", "", ""),
            ]
        );
    }

    #[test]
    fn classes_are_added_renamed_stereotyped_and_get_members() {
        let (added, selection) = apply(SAMPLE, ClassEdit::AddClass { stereotype: Stereotype::Enumeration }).expect("add");
        assert_eq!(selection, Some(Selection::new("class", "NuevoEnum")));
        assert!(added.contains("  }\n  class NuevoEnum {\n    <<enumeration>>\n  }\n  class Carpeta\n"));
        let renamed = edit(SAMPLE, ClassEdit::RenameClass { name: "Nota".into(), new_name: "nota rápida".into() });
        assert!(renamed.contains("class NotaRapida {") && renamed.contains("*-- \"0..*\" NotaRapida : contiene") && renamed.contains("+enlazar(NotaRapida destino)"));
        let abstracted = edit(SAMPLE, ClassEdit::SetStereotype { name: "Carpeta".into(), stereotype: Stereotype::Abstract });
        assert!(abstracted.contains("  class Carpeta {\n    <<abstract>>\n  }\n"));
        let plain = edit(SAMPLE, ClassEdit::SetStereotype { name: "Sincronizable".into(), stereotype: Stereotype::None });
        assert!(!plain.contains("<<interface>>"));
        let attribute = edit(SAMPLE, ClassEdit::AddMember { name: "Nota".into(), kind: MemberKind::Attribute });
        assert!(attribute.contains("    +enlazar(Nota destino) Enlace\n    +String nuevoCampo\n  }\n"));
        let method = edit(SAMPLE, ClassEdit::AddMember { name: "Etiqueta".into(), kind: MemberKind::Method });
        assert!(method.ends_with("  class Etiqueta {\n    +nuevoMetodo() void\n  }\n"));
        let cycled = edit(SAMPLE, ClassEdit::CycleVisibility { name: "Nota".into(), kind: MemberKind::Attribute, index: 1 });
        assert!(cycled.contains("    #DateTime creada\n"));
        let outside = edit(SAMPLE, ClassEdit::CycleVisibility { name: "Carpeta".into(), kind: MemberKind::Attribute, index: 0 });
        assert!(outside.contains("  Carpeta : -String nombre\n"));
        let deleted = edit(SAMPLE, ClassEdit::DeleteClass { name: "Sincronizable".into() });
        assert!(!deleted.contains("Sincronizable") && !deleted.contains("<<interface>>"));
    }

    #[test]
    fn relations_are_added_and_edited() {
        let (added, selection) = apply(SAMPLE, ClassEdit::AddRelation { a: "Carpeta".into(), b: "Etiqueta".into(), kind: None }).expect("add");
        assert_eq!(selection, Some(Selection::new("relation", "3")));
        assert!(added.ends_with("  Etiqueta --|> Nota\n  Carpeta --> Etiqueta\n"));
        let kind = edit(SAMPLE, ClassEdit::SetRelationKind { index: 0, kind: RelationKind::Aggregation });
        assert!(kind.contains("  Carpeta \"1\" o-- \"0..*\" Nota : contiene\n"));
        let mult = edit(SAMPLE, ClassEdit::SetMultiplicity { index: 1, side: Side::B, value: "1..*".into() });
        assert!(mult.contains("  Sincronizable <|.. \"1..*\" Nota\n"));
        let label = edit(SAMPLE, ClassEdit::SetRelationLabel { index: 2, label: "es".into() });
        assert!(label.contains("  Nota <|-- Etiqueta : es\n"));
        let deleted = edit(SAMPLE, ClassEdit::DeleteRelation { index: 0 });
        assert!(!deleted.contains("contiene"));
        let lr = edit(SAMPLE, ClassEdit::SetDirection { direction: "LR".into() });
        assert!(lr.starts_with("classDiagram\n  direction LR\n"));
    }
}
