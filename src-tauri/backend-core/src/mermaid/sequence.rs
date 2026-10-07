//! Sequence diagrams: participants and actors, messages with their line,
//! tip and activation, blocks (`loop`, `alt`…), notes and `autonumber`.

use serde::{Deserialize, Serialize};

use super::text::{body_indent, clean_label, header_line, indent_of, is_blank_or_comment, join_lines, split_lines, unique_name};
use super::Selection;
use crate::error::BackendError;

const MAX_TEXT_CHARS: usize = 200;
/// Message operators, longest first so a prefix never wins.
const OPERATORS: [&str; 10] = ["<<-->>", "<<->>", "-->>", "->>", "--x", "-x", "--)", "-)", "-->", "->"];
const BLOCK_KEYWORDS: [&str; 8] = ["loop", "alt", "opt", "par", "critical", "break", "rect", "box"];
const SECTION_KEYWORDS: [&str; 3] = ["else", "and", "option"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParticipantKind {
    Participant,
    Actor,
}

impl ParticipantKind {
    fn keyword(self) -> &'static str {
        match self {
            ParticipantKind::Participant => "participant",
            ParticipantKind::Actor => "actor",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageLine {
    Solid,
    Dotted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageTip {
    Arrow,
    None,
    Async,
    Cross,
    Both,
}

/// `+` (activates the target) or `-` (deactivates the source).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Activation {
    None,
    ActivateTarget,
    DeactivateSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub alias: String,
    pub label: String,
    pub kind: ParticipantKind,
    /// The declaration line; `None` when only messages name it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    pub sends: usize,
    pub receives: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockRef {
    pub keyword: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub index: usize,
    pub from: String,
    pub to: String,
    pub text: String,
    pub line_style: MessageLine,
    pub tip: MessageTip,
    pub activation: Activation,
    /// The operator as written, activation included (`->>+`).
    pub op: String,
    pub line: usize,
    /// The innermost block it is in, with the section (`else …`) it falls in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block: Option<BlockRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub keyword: String,
    pub label: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub position: String,
    pub over: Vec<String>,
    pub text: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceModel {
    pub header_line: usize,
    pub autonumber: bool,
    pub participants: Vec<Participant>,
    pub messages: Vec<Message>,
    pub blocks: Vec<Block>,
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SequenceEdit {
    SetAutonumber { enabled: bool },
    AddParticipant { kind: ParticipantKind },
    SetParticipantLabel { alias: String, label: String },
    SetParticipantKind { alias: String, kind: ParticipantKind },
    DeleteParticipant { alias: String },
    /// A message `from` → `to`, before message `before` (at the end without it).
    AddMessage { from: String, to: String, before: Option<usize>, line_style: Option<MessageLine>, tip: Option<MessageTip> },
    SetMessageText { index: usize, text: String },
    SetMessageLine { index: usize, line_style: MessageLine },
    SetMessageTip { index: usize, tip: MessageTip },
    SetMessageEnds { index: usize, from: String, to: String },
    SwapMessage { index: usize },
    SetActivation { index: usize, activation: Activation },
    DeleteMessage { index: usize },
    AddNote { alias: String },
    /// Wraps message `index` (or adds an empty block at the end) in `keyword`.
    AddBlock { keyword: String, index: Option<usize> },
    /// Activates `alias` from the first message it receives to the next one it sends.
    ActivateParticipant { alias: String },
}

struct ParsedMessage {
    from: String,
    to: String,
    text: String,
    line_style: MessageLine,
    tip: MessageTip,
    activation: Activation,
    op: String,
}

pub fn message_op(line_style: MessageLine, tip: MessageTip) -> &'static str {
    match (line_style, tip) {
        (MessageLine::Solid, MessageTip::Arrow) => "->>",
        (MessageLine::Solid, MessageTip::None) => "->",
        (MessageLine::Solid, MessageTip::Async) => "-)",
        (MessageLine::Solid, MessageTip::Cross) => "-x",
        (MessageLine::Solid, MessageTip::Both) => "<<->>",
        (MessageLine::Dotted, MessageTip::Arrow) => "-->>",
        (MessageLine::Dotted, MessageTip::None) => "-->",
        (MessageLine::Dotted, MessageTip::Async) => "--)",
        (MessageLine::Dotted, MessageTip::Cross) => "--x",
        (MessageLine::Dotted, MessageTip::Both) => "<<-->>",
    }
}

fn op_parts(op: &str) -> (MessageLine, MessageTip) {
    let line_style = if op.contains("--") { MessageLine::Dotted } else { MessageLine::Solid };
    let tip = if op.starts_with("<<") {
        MessageTip::Both
    } else if op.ends_with(">>") {
        MessageTip::Arrow
    } else if op.ends_with(')') {
        MessageTip::Async
    } else if op.ends_with('x') {
        MessageTip::Cross
    } else {
        MessageTip::None
    };
    (line_style, tip)
}

fn read_message(statement: &str) -> Option<ParsedMessage> {
    let (head, text) = match statement.split_once(':') {
        Some((head, text)) => (head, text.trim().to_string()),
        None => (statement, String::new()),
    };
    // The first operator from the left that splits two names.
    let (position, op) = (0..head.len())
        .filter(|position| head.is_char_boundary(*position))
        .find_map(|position| OPERATORS.iter().find(|op| head[position..].starts_with(*op)).map(|op| (position, *op)))?;
    let from = head[..position].trim();
    let mut rest = head[position + op.len()..].trim_start();
    let activation = if let Some(after) = rest.strip_prefix('+') {
        rest = after;
        Activation::ActivateTarget
    } else if let Some(after) = rest.strip_prefix('-') {
        rest = after;
        Activation::DeactivateSource
    } else {
        Activation::None
    };
    let to = rest.trim();
    let valid = |name: &str| !name.is_empty() && !name.contains(char::is_whitespace);
    if !valid(from) || !valid(to) {
        return None;
    }
    let (line_style, tip) = op_parts(op);
    let sign = match activation {
        Activation::ActivateTarget => "+",
        Activation::DeactivateSource => "-",
        Activation::None => "",
    };
    Some(ParsedMessage { from: from.to_string(), to: to.to_string(), text, line_style, tip, activation, op: format!("{op}{sign}") })
}

/// `participant A as Etiqueta` → (kind, alias, label).
fn read_declaration(statement: &str) -> Option<(ParticipantKind, String, String)> {
    let statement = statement.strip_prefix("create ").unwrap_or(statement).trim();
    let (kind, rest) = if let Some(rest) = statement.strip_prefix("participant ") {
        (ParticipantKind::Participant, rest)
    } else {
        (ParticipantKind::Actor, statement.strip_prefix("actor ")?)
    };
    let rest = rest.split("@{").next().unwrap_or(rest).trim();
    let (alias, label) = match rest.split_once(" as ") {
        Some((alias, label)) => (alias.trim(), label.trim()),
        None => (rest, rest),
    };
    (!alias.is_empty()).then(|| (kind, alias.to_string(), label.to_string()))
}

fn read_note(statement: &str) -> Option<Note> {
    let rest = statement.strip_prefix("Note ").or_else(|| statement.strip_prefix("note "))?;
    let (place, text) = rest.split_once(':').unwrap_or((rest, ""));
    let place = place.trim();
    let (position, names) = ["right of", "left of", "over"]
        .iter()
        .find_map(|position| place.strip_prefix(position).map(|names| (*position, names)))?;
    let over = names.split(',').map(|name| name.trim().to_string()).filter(|name| !name.is_empty()).collect();
    Some(Note { position: position.to_string(), over, text: text.trim().to_string(), line: 0 })
}

struct Parsed {
    lines: Vec<String>,
    model: SequenceModel,
    /// Line of the last declaration (or the header / autonumber line).
    declarations_end: usize,
    autonumber_line: Option<usize>,
}

fn parse(source: &str) -> Option<Parsed> {
    let lines = split_lines(source);
    let header = header_line(&lines)?;
    if lines[header].split_whitespace().next()? != "sequenceDiagram" {
        return None;
    }
    let mut model = SequenceModel { header_line: header, autonumber: false, participants: Vec::new(), messages: Vec::new(), blocks: Vec::new(), notes: Vec::new() };
    let mut autonumber_line = None;
    let mut declarations_end = header;
    // Open blocks: (keyword, label, start line, section label).
    let mut stack: Vec<(String, String, usize, String)> = Vec::new();
    for (index, line) in lines.iter().enumerate().skip(header + 1) {
        if is_blank_or_comment(line) {
            continue;
        }
        let statement = line.trim();
        let first = statement.split_whitespace().next().unwrap_or_default();
        if first == "autonumber" {
            model.autonumber = true;
            autonumber_line = Some(index);
            declarations_end = declarations_end.max(index);
            continue;
        }
        if let Some((kind, alias, label)) = read_declaration(statement) {
            if !model.participants.iter().any(|participant| participant.alias == alias) {
                model.participants.push(Participant { alias, label, kind, line: Some(index), sends: 0, receives: 0 });
            }
            declarations_end = index;
            continue;
        }
        if BLOCK_KEYWORDS.contains(&first) {
            let label = statement[first.len()..].trim().to_string();
            stack.push((first.to_string(), label.clone(), index, label));
            continue;
        }
        if SECTION_KEYWORDS.contains(&first) {
            if let Some(open) = stack.last_mut() {
                open.3 = statement[first.len()..].trim().to_string();
            }
            continue;
        }
        if first == "end" {
            if let Some((keyword, label, start, _)) = stack.pop() {
                model.blocks.push(Block { keyword, label, start_line: start, end_line: index });
            }
            continue;
        }
        if let Some(mut note) = read_note(statement) {
            note.line = index;
            model.notes.push(note);
            continue;
        }
        if let Some(message) = read_message(statement) {
            for name in [&message.from, &message.to] {
                if !model.participants.iter().any(|participant| &participant.alias == name) {
                    model.participants.push(Participant {
                        alias: name.clone(),
                        label: name.clone(),
                        kind: ParticipantKind::Participant,
                        line: None,
                        sends: 0,
                        receives: 0,
                    });
                }
            }
            let block = stack.last().map(|(keyword, label, _, section)| {
                let in_section = section != label;
                BlockRef {
                    keyword: if in_section { if keyword == "par" { "and".to_string() } else { "else".to_string() } } else { keyword.clone() },
                    label: section.clone(),
                }
            });
            model.messages.push(Message {
                index: model.messages.len(),
                from: message.from,
                to: message.to,
                text: message.text,
                line_style: message.line_style,
                tip: message.tip,
                activation: message.activation,
                op: message.op,
                line: index,
                block,
            });
        }
    }
    model.blocks.sort_by_key(|block| block.start_line);
    for message in &model.messages {
        if let Some(sender) = model.participants.iter_mut().find(|participant| participant.alias == message.from) {
            sender.sends += 1;
        }
        if let Some(receiver) = model.participants.iter_mut().find(|participant| participant.alias == message.to) {
            receiver.receives += 1;
        }
    }
    Some(Parsed { lines, model, declarations_end, autonumber_line })
}

pub fn read(source: &str) -> Option<SequenceModel> {
    parse(source).map(|parsed| parsed.model)
}

fn text_of(text: &str) -> String {
    clean_label(text, MAX_TEXT_CHARS).replace(';', "#59;")
}

fn message_line(indent: &str, message: &Message) -> String {
    let sign = match message.activation {
        Activation::ActivateTarget => "+",
        Activation::DeactivateSource => "-",
        Activation::None => "",
    };
    let op = message_op(message.line_style, message.tip);
    format!("{indent}{}{op}{sign}{}: {}", message.from, message.to, message.text)
}

fn declaration(indent: &str, kind: ParticipantKind, alias: &str, label: &str) -> String {
    if label == alias {
        format!("{indent}{} {alias}", kind.keyword())
    } else {
        format!("{indent}{} {alias} as {label}", kind.keyword())
    }
}

fn missing_message() -> BackendError {
    BackendError::invalid_input("Ese mensaje ya no está en el diagrama.")
}

fn missing_participant() -> BackendError {
    BackendError::invalid_input("Ese participante ya no está en el diagrama.")
}

fn rewrite_message(parsed: &mut Parsed, index: usize, change: impl FnOnce(&mut Message)) -> Result<(), BackendError> {
    let mut message = parsed.model.messages.get(index).cloned().ok_or_else(missing_message)?;
    change(&mut message);
    let indent = indent_of(&parsed.lines[message.line]);
    parsed.lines[message.line] = message_line(&indent, &message);
    Ok(())
}

fn ensure_participant(parsed: &Parsed, alias: &str) -> Result<(), BackendError> {
    parsed.model.participants.iter().any(|participant| participant.alias == alias).then_some(()).ok_or_else(missing_participant)
}

/// The last line of the diagram's statements.
fn last_statement(parsed: &Parsed) -> usize {
    parsed.lines.iter().rposition(|line| !line.trim().is_empty()).unwrap_or(parsed.model.header_line)
}

pub fn apply(source: &str, edit: SequenceEdit) -> Result<(String, Option<Selection>), BackendError> {
    let mut parsed = parse(source).ok_or_else(|| BackendError::invalid_input("El diagrama no es un diagrama de secuencia."))?;
    let indent = body_indent(&parsed.lines, parsed.model.header_line);
    let mut selection = None;
    match edit {
        SequenceEdit::SetAutonumber { enabled } => match (enabled, parsed.autonumber_line) {
            (true, None) => parsed.lines.insert(parsed.model.header_line + 1, format!("{indent}autonumber")),
            (false, Some(line)) => {
                parsed.lines.remove(line);
            }
            _ => {}
        },
        SequenceEdit::AddParticipant { kind } => {
            let base = match kind {
                ParticipantKind::Participant => "P",
                ParticipantKind::Actor => "A",
            };
            let alias = (1..)
                .map(|number| format!("{base}{number}"))
                .find(|alias| !parsed.model.participants.iter().any(|participant| &participant.alias == alias))
                .unwrap_or_else(|| base.to_string());
            let label = match kind {
                ParticipantKind::Participant => "Participante",
                ParticipantKind::Actor => "Actor",
            };
            let label = unique_name(label, |name| parsed.model.participants.iter().any(|participant| participant.label == name));
            parsed.lines.insert(parsed.declarations_end + 1, declaration(&indent, kind, &alias, &label));
            selection = Some(Selection::new("participant", &alias));
        }
        SequenceEdit::SetParticipantLabel { alias, label } => {
            ensure_participant(&parsed, &alias)?;
            let label = text_of(&label);
            if label.is_empty() {
                return Err(BackendError::invalid_input("Escribí un nombre."));
            }
            let participant = parsed.model.participants.iter().find(|participant| participant.alias == alias).cloned().ok_or_else(missing_participant)?;
            let line = declaration(&indent, participant.kind, &alias, &label);
            match participant.line {
                Some(index) => parsed.lines[index] = format!("{}{}", indent_of(&parsed.lines[index]), line.trim_start()),
                None => parsed.lines.insert(parsed.declarations_end + 1, line),
            }
            selection = Some(Selection::new("participant", &alias));
        }
        SequenceEdit::SetParticipantKind { alias, kind } => {
            let participant = parsed.model.participants.iter().find(|participant| participant.alias == alias).cloned().ok_or_else(missing_participant)?;
            let line = declaration(&indent, kind, &alias, &participant.label);
            match participant.line {
                Some(index) => parsed.lines[index] = format!("{}{}", indent_of(&parsed.lines[index]), line.trim_start()),
                None => parsed.lines.insert(parsed.declarations_end + 1, line),
            }
            selection = Some(Selection::new("participant", &alias));
        }
        SequenceEdit::DeleteParticipant { alias } => {
            let participant = parsed.model.participants.iter().find(|participant| participant.alias == alias).cloned().ok_or_else(missing_participant)?;
            let mut remove = parsed
                .model
                .messages
                .iter()
                .filter(|message| message.from == alias || message.to == alias)
                .map(|message| message.line)
                .chain(parsed.model.notes.iter().filter(|note| note.over.contains(&alias)).map(|note| note.line))
                .chain(participant.line)
                .collect::<Vec<_>>();
            for (index, line) in parsed.lines.iter().enumerate() {
                let words = line.split_whitespace().collect::<Vec<_>>();
                if matches!(words.as_slice(), [keyword, name] if (*keyword == "activate" || *keyword == "deactivate") && *name == alias) {
                    remove.push(index);
                }
            }
            remove.sort_unstable_by(|a, b| b.cmp(a));
            remove.dedup();
            for index in remove {
                parsed.lines.remove(index);
            }
        }
        SequenceEdit::AddMessage { from, to, before, line_style, tip } => {
            ensure_participant(&parsed, &from)?;
            ensure_participant(&parsed, &to)?;
            let message = Message {
                index: 0,
                from,
                to,
                text: "Nuevo mensaje".to_string(),
                line_style: line_style.unwrap_or(MessageLine::Solid),
                tip: tip.unwrap_or(MessageTip::Arrow),
                activation: Activation::None,
                op: String::new(),
                line: 0,
                block: None,
            };
            let (position, new_index) = match before.and_then(|index| parsed.model.messages.get(index)) {
                Some(next) => (next.line, next.index),
                None => (last_statement(&parsed) + 1, parsed.model.messages.len()),
            };
            let line_indent = match before.and_then(|index| parsed.model.messages.get(index)) {
                Some(next) => indent_of(&parsed.lines[next.line]),
                None => indent.clone(),
            };
            parsed.lines.insert(position, message_line(&line_indent, &message));
            selection = Some(Selection::new("message", &new_index.to_string()));
        }
        SequenceEdit::SetMessageText { index, text } => {
            let text = text_of(&text);
            rewrite_message(&mut parsed, index, |message| message.text = text)?;
            selection = Some(Selection::new("message", &index.to_string()));
        }
        SequenceEdit::SetMessageLine { index, line_style } => {
            rewrite_message(&mut parsed, index, |message| message.line_style = line_style)?;
            selection = Some(Selection::new("message", &index.to_string()));
        }
        SequenceEdit::SetMessageTip { index, tip } => {
            rewrite_message(&mut parsed, index, |message| message.tip = tip)?;
            selection = Some(Selection::new("message", &index.to_string()));
        }
        SequenceEdit::SetMessageEnds { index, from, to } => {
            ensure_participant(&parsed, &from)?;
            ensure_participant(&parsed, &to)?;
            rewrite_message(&mut parsed, index, |message| {
                message.from = from;
                message.to = to;
            })?;
            selection = Some(Selection::new("message", &index.to_string()));
        }
        SequenceEdit::SwapMessage { index } => {
            rewrite_message(&mut parsed, index, |message| std::mem::swap(&mut message.from, &mut message.to))?;
            selection = Some(Selection::new("message", &index.to_string()));
        }
        SequenceEdit::SetActivation { index, activation } => {
            rewrite_message(&mut parsed, index, |message| message.activation = activation)?;
            selection = Some(Selection::new("message", &index.to_string()));
        }
        SequenceEdit::DeleteMessage { index } => {
            let message = parsed.model.messages.get(index).cloned().ok_or_else(missing_message)?;
            parsed.lines.remove(message.line);
        }
        SequenceEdit::AddNote { alias } => {
            ensure_participant(&parsed, &alias)?;
            let position = last_statement(&parsed) + 1;
            parsed.lines.insert(position, format!("{indent}Note right of {alias}: Nota"));
            selection = Some(Selection::new("participant", &alias));
        }
        SequenceEdit::AddBlock { keyword, index } => {
            if !matches!(keyword.as_str(), "loop" | "alt" | "opt" | "par" | "critical" | "rect") {
                return Err(BackendError::invalid_input("Ese bloque no existe."));
            }
            let opener = match keyword.as_str() {
                "rect" => "rect rgb(79, 209, 197, 0.12)".to_string(),
                _ => format!("{keyword} Condición"),
            };
            match index.and_then(|index| parsed.model.messages.get(index)).cloned() {
                Some(message) => {
                    let line_indent = indent_of(&parsed.lines[message.line]);
                    parsed.lines[message.line] = format!("  {}", parsed.lines[message.line]);
                    let mut block = vec![format!("{line_indent}{opener}")];
                    block.push(parsed.lines[message.line].clone());
                    match keyword.as_str() {
                        "alt" => block.push(format!("{line_indent}else Otra condición")),
                        "par" => block.push(format!("{line_indent}and Otra rama")),
                        _ => {}
                    }
                    block.push(format!("{line_indent}end"));
                    parsed.lines.splice(message.line..=message.line, block);
                    selection = Some(Selection::new("message", &message.index.to_string()));
                }
                None => {
                    let position = last_statement(&parsed) + 1;
                    parsed.lines.splice(position..position, [format!("{indent}{opener}"), format!("{indent}end")]);
                }
            }
        }
        SequenceEdit::ActivateParticipant { alias } => {
            ensure_participant(&parsed, &alias)?;
            let messages = parsed.model.messages.clone();
            let incoming = messages.iter().find(|message| message.to == alias && message.from != alias).ok_or_else(|| {
                BackendError::invalid_input("Para activarlo hace falta un mensaje que le llegue y otro que salga de él después.")
            })?;
            let outgoing = messages.iter().find(|message| message.index > incoming.index && message.from == alias).ok_or_else(|| {
                BackendError::invalid_input("Para activarlo hace falta un mensaje que le llegue y otro que salga de él después.")
            })?;
            let (incoming, outgoing) = (incoming.index, outgoing.index);
            rewrite_message(&mut parsed, incoming, |message| message.activation = Activation::ActivateTarget)?;
            rewrite_message(&mut parsed, outgoing, |message| message.activation = Activation::DeactivateSource)?;
            selection = Some(Selection::new("participant", &alias));
        }
    }
    Ok((join_lines(&parsed.lines), selection))
}

/// A new sequence diagram.
pub fn template() -> String {
    "sequenceDiagram\n  autonumber\n  actor U as Usuario\n  participant S as Sistema\n  U->>S: Pedido\n  S-->>U: Respuesta\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "sequenceDiagram\n  autonumber\n  actor U as Usuario\n  participant M as Munin\n  U->>+M: Abrir bóveda\n  loop Hasta conectar\n    M-)C: Escanear BLE\n  end\n  Note right of M: espera\n  alt firma válida\n    C-->>M: Token\n  else firma inválida\n    C--x-M: Rechazado\n  end\n";

    fn edit(source: &str, edit: SequenceEdit) -> String {
        apply(source, edit).expect("edit").0
    }

    #[test]
    fn participants_messages_blocks_and_notes_are_read() {
        let model = read(SAMPLE).expect("sequence");
        assert!(model.autonumber);
        let participants = model.participants.iter().map(|p| (p.alias.as_str(), p.label.as_str(), p.kind, p.line)).collect::<Vec<_>>();
        assert_eq!(
            participants,
            vec![
                ("U", "Usuario", ParticipantKind::Actor, Some(2)),
                ("M", "Munin", ParticipantKind::Participant, Some(3)),
                ("C", "C", ParticipantKind::Participant, None),
            ]
        );
        assert_eq!((model.participants[1].sends, model.participants[1].receives), (1, 3));
        let messages = model.messages.iter().map(|m| (m.from.as_str(), m.to.as_str(), m.line_style, m.tip, m.activation, m.line)).collect::<Vec<_>>();
        assert_eq!(
            messages,
            vec![
                ("U", "M", MessageLine::Solid, MessageTip::Arrow, Activation::ActivateTarget, 4),
                ("M", "C", MessageLine::Solid, MessageTip::Async, Activation::None, 6),
                ("C", "M", MessageLine::Dotted, MessageTip::Arrow, Activation::None, 10),
                ("C", "M", MessageLine::Dotted, MessageTip::Cross, Activation::DeactivateSource, 12),
            ]
        );
        assert_eq!(model.messages[1].block, Some(BlockRef { keyword: "loop".into(), label: "Hasta conectar".into() }));
        assert_eq!(model.messages[2].block, Some(BlockRef { keyword: "alt".into(), label: "firma válida".into() }));
        assert_eq!(model.messages[3].block, Some(BlockRef { keyword: "else".into(), label: "firma inválida".into() }));
        assert_eq!(model.blocks.len(), 2);
        assert_eq!(model.notes[0].over, vec!["M".to_string()]);
        assert_eq!(model.messages[3].op, "--x-");
    }

    #[test]
    fn messages_are_added_and_edited() {
        let (added, selection) = apply(SAMPLE, SequenceEdit::AddMessage { from: "U".into(), to: "M".into(), before: Some(1), line_style: None, tip: None }).expect("add");
        assert_eq!(selection, Some(Selection::new("message", "1")));
        assert_eq!(split_lines(&added)[6], "    U->>M: Nuevo mensaje");
        let at_end = edit(SAMPLE, SequenceEdit::AddMessage { from: "M".into(), to: "U".into(), before: None, line_style: Some(MessageLine::Dotted), tip: Some(MessageTip::Async) });
        assert!(at_end.ends_with("  end\n  M--)U: Nuevo mensaje\n"));
        let texted = edit(SAMPLE, SequenceEdit::SetMessageText { index: 0, text: "Abrir; ya".into() });
        assert!(texted.contains("  U->>+M: Abrir#59; ya\n"));
        let dotted = edit(SAMPLE, SequenceEdit::SetMessageLine { index: 1, line_style: MessageLine::Dotted });
        assert!(dotted.contains("    M--)C: Escanear BLE\n"));
        let both = edit(SAMPLE, SequenceEdit::SetMessageTip { index: 0, tip: MessageTip::Both });
        assert!(both.contains("  U<<->>+M: Abrir bóveda\n"));
        let swapped = edit(SAMPLE, SequenceEdit::SwapMessage { index: 1 });
        assert!(swapped.contains("    C-)M: Escanear BLE\n"));
        let deactivated = edit(SAMPLE, SequenceEdit::SetActivation { index: 0, activation: Activation::None });
        assert!(deactivated.contains("  U->>M: Abrir bóveda\n"));
        let deleted = edit(SAMPLE, SequenceEdit::DeleteMessage { index: 1 });
        assert!(deleted.contains("  loop Hasta conectar\n  end\n"));
        let moved = edit(SAMPLE, SequenceEdit::SetMessageEnds { index: 0, from: "M".into(), to: "C".into() });
        assert!(moved.contains("  M->>+C: Abrir bóveda\n"));
        assert!(apply(SAMPLE, SequenceEdit::SetMessageEnds { index: 0, from: "X".into(), to: "C".into() }).is_err());
    }

    #[test]
    fn participants_autonumber_blocks_and_activations() {
        let (added, selection) = apply(SAMPLE, SequenceEdit::AddParticipant { kind: ParticipantKind::Actor }).expect("add");
        assert_eq!(selection, Some(Selection::new("participant", "A1")));
        assert_eq!(split_lines(&added)[4], "  actor A1 as Actor");
        let relabelled = edit(SAMPLE, SequenceEdit::SetParticipantLabel { alias: "C".into(), label: "ColdPass".into() });
        assert_eq!(split_lines(&relabelled)[4], "  participant C as ColdPass");
        let kind = edit(SAMPLE, SequenceEdit::SetParticipantKind { alias: "M".into(), kind: ParticipantKind::Actor });
        assert_eq!(split_lines(&kind)[3], "  actor M as Munin");
        let numbered = edit(SAMPLE, SequenceEdit::SetAutonumber { enabled: false });
        assert!(!numbered.contains("autonumber"));
        assert!(edit(&numbered, SequenceEdit::SetAutonumber { enabled: true }).starts_with("sequenceDiagram\n  autonumber\n"));
        let wrapped = edit(SAMPLE, SequenceEdit::AddBlock { keyword: "alt".into(), index: Some(0) });
        assert!(wrapped.contains("  alt Condición\n    U->>+M: Abrir bóveda\n  else Otra condición\n  end\n"));
        let removed = edit(SAMPLE, SequenceEdit::DeleteParticipant { alias: "C".into() });
        assert!(!removed.contains("C"));
        let plain = "sequenceDiagram\n  A->>B: hola\n  B->>C: pasa\n";
        let activated = edit(plain, SequenceEdit::ActivateParticipant { alias: "B".into() });
        assert_eq!(activated, "sequenceDiagram\n  A->>+B: hola\n  B->>-C: pasa\n");
        assert!(apply(plain, SequenceEdit::ActivateParticipant { alias: "A".into() }).is_err());
        let noted = edit(plain, SequenceEdit::AddNote { alias: "B".into() });
        assert!(noted.ends_with("  Note right of B: Nota\n"));
    }
}
