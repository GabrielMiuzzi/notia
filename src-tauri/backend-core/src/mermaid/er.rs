//! Entity-relationship diagrams: entities with their attributes and keys,
//! and relations with the cardinality of each side, whether they identify
//! and their verb.

use serde::{Deserialize, Serialize};

use super::text::{body_indent, clean_label, header_line, indent_of, is_blank_or_comment, join_lines, split_lines, unique_name};
use super::Selection;
use crate::error::BackendError;

const MAX_TEXT_CHARS: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Cardinality {
    One,
    ZeroOne,
    Many1,
    Many0,
}

impl Cardinality {
    /// The symbol on the left side of the operator (side A).
    fn left(self) -> &'static str {
        match self {
            Cardinality::One => "||",
            Cardinality::ZeroOne => "|o",
            Cardinality::Many1 => "}|",
            Cardinality::Many0 => "}o",
        }
    }

    /// The symbol on the right side of the operator (side B).
    fn right(self) -> &'static str {
        match self {
            Cardinality::One => "||",
            Cardinality::ZeroOne => "o|",
            Cardinality::Many1 => "|{",
            Cardinality::Many0 => "o{",
        }
    }

    fn from_left(symbol: &str) -> Option<Self> {
        [Cardinality::One, Cardinality::ZeroOne, Cardinality::Many1, Cardinality::Many0].into_iter().find(|card| card.left() == symbol)
    }

    fn from_right(symbol: &str) -> Option<Self> {
        [Cardinality::One, Cardinality::ZeroOne, Cardinality::Many1, Cardinality::Many0].into_iter().find(|card| card.right() == symbol)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    PK,
    FK,
    UK,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    pub type_name: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<Key>,
    pub comment: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub name: String,
    pub attributes: Vec<Attribute>,
    pub lines: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErRelation {
    pub index: usize,
    pub a: String,
    pub b: String,
    pub card_a: Cardinality,
    pub card_b: Cardinality,
    pub identifying: bool,
    pub verb: String,
    pub op: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErModel {
    pub header_line: usize,
    pub entities: Vec<Entity>,
    pub relations: Vec<ErRelation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    A,
    B,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ErEdit {
    AddEntity,
    RenameEntity { name: String, new_name: String },
    AddAttribute { name: String },
    /// Sets the key of an attribute; the same key again clears it.
    ToggleKey { name: String, index: usize, key: Key },
    DeleteAttribute { name: String, index: usize },
    DeleteEntity { name: String },
    AddRelation { a: String, b: String },
    SetCardinality { index: usize, side: Side, cardinality: Cardinality },
    SetIdentifying { index: usize, identifying: bool },
    SetVerb { index: usize, verb: String },
    DeleteRelation { index: usize },
}

struct Parsed {
    lines: Vec<String>,
    model: ErModel,
    blocks: Vec<(String, usize, usize)>,
}

fn read_relation(statement: &str) -> Option<(String, String, Cardinality, Cardinality, bool, String)> {
    let (head, verb) = statement.split_once(':')?;
    let words = head.split_whitespace().collect::<Vec<_>>();
    let [a, op, b] = words.as_slice() else { return None };
    if op.chars().count() != 6 || !op.is_ascii() {
        return None;
    }
    let (left, middle, right) = (&op[..2], &op[2..4], &op[4..]);
    let identifying = match middle {
        "--" => true,
        ".." => false,
        _ => return None,
    };
    let card_a = Cardinality::from_left(left)?;
    let card_b = Cardinality::from_right(right)?;
    let verb = verb.trim();
    let verb = verb.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')).unwrap_or(verb);
    Some((a.to_string(), b.to_string(), card_a, card_b, identifying, verb.to_string()))
}

fn read_attribute(statement: &str, line: usize) -> Option<Attribute> {
    let (main, comment) = match statement.find('"') {
        Some(start) => (&statement[..start], statement[start..].trim().trim_matches('"').to_string()),
        None => (statement, String::new()),
    };
    let words = main.split_whitespace().collect::<Vec<_>>();
    let (type_name, name) = (words.first()?, words.get(1)?);
    let key = words.get(2).and_then(|keys| match keys.split(',').next().map(str::trim) {
        Some("PK") => Some(Key::PK),
        Some("FK") => Some(Key::FK),
        Some("UK") => Some(Key::UK),
        _ => None,
    });
    Some(Attribute { type_name: type_name.to_string(), name: name.to_string(), key, comment, line })
}

fn parse(source: &str) -> Option<Parsed> {
    let lines = split_lines(source);
    let header = header_line(&lines)?;
    if lines[header].split_whitespace().next()? != "erDiagram" {
        return None;
    }
    let mut model = ErModel { header_line: header, entities: Vec::new(), relations: Vec::new() };
    let mut blocks = Vec::new();
    let mut open: Option<(String, usize)> = None;
    fn entity(model: &mut ErModel, name: &str) -> usize {
        if let Some(position) = model.entities.iter().position(|entity| entity.name == name) {
            return position;
        }
        model.entities.push(Entity { name: name.to_string(), attributes: Vec::new(), lines: Vec::new() });
        model.entities.len() - 1
    }
    for (index, line) in lines.iter().enumerate().skip(header + 1) {
        if is_blank_or_comment(line) {
            continue;
        }
        let statement = line.trim();
        if let Some((name, start)) = open.clone() {
            let position = entity(&mut model, &name);
            model.entities[position].lines.push(index);
            if statement == "}" {
                blocks.push((name, start, index));
                open = None;
            } else if let Some(attribute) = read_attribute(statement, index) {
                model.entities[position].attributes.push(attribute);
            }
            continue;
        }
        if let Some(name) = statement.strip_suffix('{') {
            let name = name.trim().split('[').next().unwrap_or_default().trim().to_string();
            if !name.is_empty() {
                let position = entity(&mut model, &name);
                model.entities[position].lines.push(index);
                open = Some((name, index));
            }
            continue;
        }
        if let Some((a, b, card_a, card_b, identifying, verb)) = read_relation(statement) {
            entity(&mut model, &a);
            entity(&mut model, &b);
            let op = format!("{}{}{}", card_a.left(), if identifying { "--" } else { ".." }, card_b.right());
            model.relations.push(ErRelation { index: model.relations.len(), a, b, card_a, card_b, identifying, verb, op, line: index });
            continue;
        }
        if !statement.contains(char::is_whitespace) {
            let position = entity(&mut model, statement);
            model.entities[position].lines.push(index);
        }
    }
    Some(Parsed { lines, model, blocks })
}

pub fn read(source: &str) -> Option<ErModel> {
    parse(source).map(|parsed| parsed.model)
}

fn missing_entity() -> BackendError {
    BackendError::invalid_input("Esa entidad ya no está en el diagrama.")
}

fn missing_relation() -> BackendError {
    BackendError::invalid_input("Esa relación ya no está en el diagrama.")
}

/// An entity name: uppercase, words joined by `_`.
pub fn entity_name(text: &str) -> String {
    let words = super::text::fold_accents(text)
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_ascii_uppercase)
        .collect::<Vec<_>>();
    match words.first().and_then(|word| word.chars().next()) {
        Some(first) if first.is_ascii_alphabetic() => words.join("_"),
        Some(_) => format!("ENTIDAD_{}", words.join("_")),
        None => "ENTIDAD".to_string(),
    }
}

fn relation_line(indent: &str, relation: &ErRelation) -> String {
    let op = format!("{}{}{}", relation.card_a.left(), if relation.identifying { "--" } else { ".." }, relation.card_b.right());
    let verb = if relation.verb.is_empty() || relation.verb.contains(char::is_whitespace) {
        format!("\"{}\"", relation.verb.replace('"', "'"))
    } else {
        relation.verb.clone()
    };
    format!("{indent}{} {op} {} : {verb}", relation.a, relation.b)
}

fn rewrite_relation(parsed: &mut Parsed, index: usize, change: impl FnOnce(&mut ErRelation)) -> Result<(), BackendError> {
    let mut relation = parsed.model.relations.get(index).cloned().ok_or_else(missing_relation)?;
    change(&mut relation);
    let indent = indent_of(&parsed.lines[relation.line]);
    parsed.lines[relation.line] = relation_line(&indent, &relation);
    Ok(())
}

fn attribute_line(indent: &str, attribute: &Attribute) -> String {
    let key = attribute.key.map(|key| format!(" {key:?}")).unwrap_or_default();
    let comment = if attribute.comment.is_empty() { String::new() } else { format!(" \"{}\"", attribute.comment) };
    format!("{indent}{} {}{key}{comment}", attribute.type_name, attribute.name)
}

fn ensure_block(parsed: &mut Parsed, name: &str, indent: &str) -> (usize, usize) {
    if let Some((_, start, end)) = parsed.blocks.iter().find(|(block, _, _)| block == name) {
        return (*start, *end);
    }
    let bare = parsed.lines.iter().position(|line| line.trim() == name);
    match bare {
        Some(line) => {
            let line_indent = indent_of(&parsed.lines[line]);
            parsed.lines.splice(line..=line, [format!("{line_indent}{name} {{"), format!("{line_indent}}}")]);
            (line, line + 1)
        }
        None => {
            let position = parsed.lines.len();
            parsed.lines.extend([format!("{indent}{name} {{"), format!("{indent}}}")]);
            (position, position + 1)
        }
    }
}

fn rename_in(line: &str, old: &str, new: &str) -> String {
    line.split_inclusive(|c: char| !(c.is_alphanumeric() || c == '_'))
        .map(|part| {
            let word = part.trim_end_matches(|c: char| !(c.is_alphanumeric() || c == '_'));
            if word == old { format!("{new}{}", &part[word.len()..]) } else { part.to_string() }
        })
        .collect()
}

pub fn apply(source: &str, edit: ErEdit) -> Result<(String, Option<Selection>), BackendError> {
    let mut parsed = parse(source).ok_or_else(|| BackendError::invalid_input("El diagrama no es un diagrama entidad-relación."))?;
    while parsed.lines.len() > parsed.model.header_line + 1 && parsed.lines.last().is_some_and(|line| line.trim().is_empty()) {
        parsed.lines.pop();
    }
    let indent = body_indent(&parsed.lines, parsed.model.header_line);
    let mut selection = None;
    match edit {
        ErEdit::AddEntity => {
            let name = unique_name("NUEVA_ENTIDAD", |name| parsed.model.entities.iter().any(|entity| entity.name == name));
            parsed.lines.extend([format!("{indent}{name} {{"), format!("{indent}  uuid id PK"), format!("{indent}}}")]);
            selection = Some(Selection::new("entity", &name));
        }
        ErEdit::RenameEntity { name, new_name } => {
            if !parsed.model.entities.iter().any(|entity| entity.name == name) {
                return Err(missing_entity());
            }
            let new_name = entity_name(&new_name);
            if new_name != name && parsed.model.entities.iter().any(|entity| entity.name == new_name) {
                return Err(BackendError::invalid_input("Ya hay una entidad con ese nombre."));
            }
            for (index, line) in parsed.lines.iter_mut().enumerate().skip(parsed.model.header_line + 1) {
                let in_block = parsed.blocks.iter().any(|(_, start, end)| index > *start && index < *end);
                if !in_block {
                    *line = rename_in(line, &name, &new_name);
                }
            }
            selection = Some(Selection::new("entity", &new_name));
        }
        ErEdit::AddAttribute { name } => {
            let entity = parsed.model.entities.iter().find(|entity| entity.name == name).cloned().ok_or_else(missing_entity)?;
            let attribute_name = unique_name("nuevo_campo", |value| entity.attributes.iter().any(|attribute| attribute.name == value));
            let (start, end) = ensure_block(&mut parsed, &name, &indent);
            let member_indent = format!("{}  ", indent_of(&parsed.lines[start]));
            parsed.lines.insert(end, format!("{member_indent}string {attribute_name}"));
            selection = Some(Selection::new("entity", &name));
        }
        ErEdit::ToggleKey { name, index, key } => {
            let entity = parsed.model.entities.iter().find(|entity| entity.name == name).cloned().ok_or_else(missing_entity)?;
            let mut attribute = entity.attributes.get(index).cloned().ok_or_else(|| BackendError::invalid_input("Ese atributo ya no está."))?;
            attribute.key = if attribute.key == Some(key) { None } else { Some(key) };
            let line_indent = indent_of(&parsed.lines[attribute.line]);
            parsed.lines[attribute.line] = attribute_line(&line_indent, &attribute);
            selection = Some(Selection::new("entity", &name));
        }
        ErEdit::DeleteAttribute { name, index } => {
            let entity = parsed.model.entities.iter().find(|entity| entity.name == name).cloned().ok_or_else(missing_entity)?;
            let attribute = entity.attributes.get(index).ok_or_else(|| BackendError::invalid_input("Ese atributo ya no está."))?;
            parsed.lines.remove(attribute.line);
            selection = Some(Selection::new("entity", &name));
        }
        ErEdit::DeleteEntity { name } => {
            let entity = parsed.model.entities.iter().find(|entity| entity.name == name).cloned().ok_or_else(missing_entity)?;
            let mut remove = entity.lines.clone();
            remove.extend(parsed.model.relations.iter().filter(|relation| relation.a == name || relation.b == name).map(|relation| relation.line));
            remove.sort_unstable_by(|a, b| b.cmp(a));
            remove.dedup();
            for line in remove {
                parsed.lines.remove(line);
            }
        }
        ErEdit::AddRelation { a, b } => {
            for name in [&a, &b] {
                if !parsed.model.entities.iter().any(|entity| &entity.name == name) {
                    return Err(missing_entity());
                }
            }
            let index = parsed.model.relations.len();
            let relation = ErRelation { index, a, b, card_a: Cardinality::One, card_b: Cardinality::Many0, identifying: true, verb: String::new(), op: String::new(), line: 0 };
            let position = parsed.model.relations.iter().map(|relation| relation.line + 1).max().unwrap_or(parsed.model.header_line + 1);
            parsed.lines.insert(position, relation_line(&indent, &relation));
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ErEdit::SetCardinality { index, side, cardinality } => {
            rewrite_relation(&mut parsed, index, |relation| match side {
                Side::A => relation.card_a = cardinality,
                Side::B => relation.card_b = cardinality,
            })?;
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ErEdit::SetIdentifying { index, identifying } => {
            rewrite_relation(&mut parsed, index, |relation| relation.identifying = identifying)?;
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ErEdit::SetVerb { index, verb } => {
            let verb = clean_label(&verb, MAX_TEXT_CHARS);
            rewrite_relation(&mut parsed, index, |relation| relation.verb = verb)?;
            selection = Some(Selection::new("relation", &index.to_string()));
        }
        ErEdit::DeleteRelation { index } => {
            let relation = parsed.model.relations.get(index).cloned().ok_or_else(missing_relation)?;
            parsed.lines.remove(relation.line);
        }
    }
    Ok((join_lines(&parsed.lines), selection))
}

/// A new entity-relationship diagram.
pub fn template() -> String {
    "erDiagram\n  USUARIO ||--o{ PEDIDO : hace\n  USUARIO {\n    uuid id PK\n    string nombre\n  }\n  PEDIDO {\n    uuid id PK\n    uuid usuario_id FK\n  }\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "erDiagram\n  USUARIO ||--o{ CUENTA : tiene\n  CATEGORIA |o..o{ CUENTA : \"la clasifica\"\n  USUARIO {\n    uuid id PK\n    string email UK \"único\"\n  }\n  CUENTA {\n    uuid id PK\n    uuid usuario_id FK\n  }\n";

    fn edit(source: &str, edit: ErEdit) -> String {
        apply(source, edit).expect("edit").0
    }

    #[test]
    fn entities_attributes_and_relations_are_read() {
        let model = read(SAMPLE).expect("er");
        assert_eq!(model.entities.iter().map(|entity| entity.name.as_str()).collect::<Vec<_>>(), vec!["USUARIO", "CUENTA", "CATEGORIA"]);
        let usuario = &model.entities[0];
        assert_eq!(usuario.attributes.iter().map(|a| (a.type_name.as_str(), a.name.as_str(), a.key, a.comment.as_str())).collect::<Vec<_>>(), vec![("uuid", "id", Some(Key::PK), ""), ("string", "email", Some(Key::UK), "único")]);
        assert_eq!(usuario.lines, vec![3, 4, 5, 6]);
        let relations = model.relations.iter().map(|r| (r.a.as_str(), r.b.as_str(), r.card_a, r.card_b, r.identifying, r.verb.as_str(), r.op.as_str())).collect::<Vec<_>>();
        assert_eq!(
            relations,
            vec![
                ("USUARIO", "CUENTA", Cardinality::One, Cardinality::Many0, true, "tiene", "||--o{"),
                ("CATEGORIA", "CUENTA", Cardinality::ZeroOne, Cardinality::Many0, false, "la clasifica", "|o..o{"),
            ]
        );
    }

    #[test]
    fn entities_and_relations_are_edited() {
        let (added, selection) = apply(SAMPLE, ErEdit::AddEntity).expect("add");
        assert_eq!(selection, Some(Selection::new("entity", "NUEVA_ENTIDAD")));
        assert!(added.ends_with("  NUEVA_ENTIDAD {\n    uuid id PK\n  }\n"));
        let renamed = edit(SAMPLE, ErEdit::RenameEntity { name: "CUENTA".into(), new_name: "cuenta bancaria".into() });
        assert!(renamed.contains("USUARIO ||--o{ CUENTA_BANCARIA : tiene") && renamed.contains("  CUENTA_BANCARIA {\n"));
        let attribute = edit(SAMPLE, ErEdit::AddAttribute { name: "CATEGORIA".into() });
        assert!(attribute.ends_with("  CATEGORIA {\n    string nuevo_campo\n  }\n"));
        let keyed = edit(SAMPLE, ErEdit::ToggleKey { name: "CUENTA".into(), index: 1, key: Key::UK });
        assert!(keyed.contains("    uuid usuario_id UK\n"));
        let cleared = edit(SAMPLE, ErEdit::ToggleKey { name: "USUARIO".into(), index: 0, key: Key::PK });
        assert!(cleared.contains("    uuid id\n"));
        assert!(edit(SAMPLE, ErEdit::ToggleKey { name: "USUARIO".into(), index: 1, key: Key::FK }).contains("    string email FK \"único\"\n"));
        let deleted = edit(SAMPLE, ErEdit::DeleteEntity { name: "USUARIO".into() });
        assert!(!deleted.contains("USUARIO"));
        let (related, selection) = apply(SAMPLE, ErEdit::AddRelation { a: "USUARIO".into(), b: "CATEGORIA".into() }).expect("relation");
        assert_eq!(selection, Some(Selection::new("relation", "2")));
        assert!(related.contains("  CATEGORIA |o..o{ CUENTA : \"la clasifica\"\n  USUARIO ||--o{ CATEGORIA : \"\"\n"));
        let card = edit(SAMPLE, ErEdit::SetCardinality { index: 0, side: Side::B, cardinality: Cardinality::Many1 });
        assert!(card.contains("  USUARIO ||--|{ CUENTA : tiene\n"));
        let side_a = edit(SAMPLE, ErEdit::SetCardinality { index: 0, side: Side::A, cardinality: Cardinality::Many0 });
        assert!(side_a.contains("  USUARIO }o--o{ CUENTA : tiene\n"));
        let dashed = edit(SAMPLE, ErEdit::SetIdentifying { index: 0, identifying: false });
        assert!(dashed.contains("  USUARIO ||..o{ CUENTA : tiene\n"));
        let verb = edit(SAMPLE, ErEdit::SetVerb { index: 0, verb: "es dueño de".into() });
        assert!(verb.contains("  USUARIO ||--o{ CUENTA : \"es dueño de\"\n"));
        assert_eq!(entity_name("mi tabla"), "MI_TABLA");
        assert_eq!(entity_name("MOVIMIENTO"), "MOVIMIENTO");
        assert_eq!(entity_name("usuario admin"), "USUARIO_ADMIN");
        assert_eq!(entity_name("Categoría"), "CATEGORIA");
    }
}
