//! State diagrams (`stateDiagram-v2`): states with their label, color and
//! kind (`<<choice>>`, `<<fork>>`, `<<join>>`), transitions with their
//! event, and the start and end pseudo-states (`[*]`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::text::{body_indent, clean_label, header_line, identifier, indent_of, is_blank_or_comment, join_lines, pascal_identifier, split_lines, unique_name, unquoted};
use super::Selection;
use crate::error::BackendError;

const MAX_LABEL_CHARS: usize = 120;
pub const PSEUDO: &str = "[*]";
/// Colors of the state inspector, in its order.
pub const STATE_COLORS: [&str; 8] = ["#64748B", "#4FD1C5", "#6C8EFF", "#FFB86B", "#FF6B6B", "#6FCF97", "#A78BFA", "#D9B44A"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StateKind {
    Normal,
    Choice,
    Fork,
    Join,
}

impl StateKind {
    fn annotation(self) -> Option<&'static str> {
        match self {
            StateKind::Normal => None,
            StateKind::Choice => Some("<<choice>>"),
            StateKind::Fork => Some("<<fork>>"),
            StateKind::Join => Some("<<join>>"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateNode {
    pub id: String,
    pub label: String,
    pub kind: StateKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// The state inside a composite state, when it is.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub lines: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub index: usize,
    pub from: String,
    pub to: String,
    pub event: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateModel {
    pub header_line: usize,
    /// `TB` or `LR`.
    pub direction: String,
    pub states: Vec<StateNode>,
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum StateEdit {
    SetDirection { direction: String },
    AddState { label: Option<String>, kind: Option<StateKind> },
    SetStateLabel { id: String, label: String },
    SetStateColor { id: String, color: Option<String> },
    SetStateKind { id: String, kind: StateKind },
    DeleteState { id: String },
    AddTransition { from: String, to: String },
    SetTransitionEvent { index: usize, event: String },
    SwapTransition { index: usize },
    DeleteTransition { index: usize },
    AddStart { to: String },
    AddEnd { from: String },
    AddNote { id: String },
}

struct Parsed {
    lines: Vec<String>,
    model: StateModel,
    direction_line: Option<usize>,
    /// `state "Label" as Id` lines by id.
    label_lines: HashMap<String, usize>,
    /// `state Id <<kind>>` lines by id.
    kind_lines: HashMap<String, usize>,
    /// `classDef c_id …` and `class Id c_id` lines by id.
    color_lines: HashMap<String, Vec<usize>>,
}

/// `A --> B : evento` → (from, to, event).
fn read_transition(statement: &str) -> Option<(String, String, String)> {
    let (head, event) = match statement.split_once(" : ").or_else(|| statement.split_once(':')) {
        Some((head, event)) if head.contains("-->") => (head, event.trim().to_string()),
        _ => (statement, String::new()),
    };
    let (from, to) = head.split_once("-->")?;
    let (from, to) = (from.trim(), to.trim());
    let valid = |name: &str| !name.is_empty() && !name.contains(char::is_whitespace);
    (valid(from) && valid(to)).then(|| (from.trim_end_matches(":::").to_string(), to.to_string(), event))
}

fn color_class(id: &str) -> String {
    format!("c_{}", identifier(id, "estado").to_lowercase())
}

fn parse(source: &str) -> Option<Parsed> {
    let lines = split_lines(source);
    let header = header_line(&lines)?;
    if !matches!(lines[header].split_whitespace().next()?, "stateDiagram-v2" | "stateDiagram") {
        return None;
    }
    let mut model = StateModel { header_line: header, direction: "TB".to_string(), states: Vec::new(), transitions: Vec::new() };
    let mut direction_line = None;
    let mut label_lines = HashMap::new();
    let mut kind_lines = HashMap::new();
    let mut color_lines: HashMap<String, Vec<usize>> = HashMap::new();
    let mut class_strokes: HashMap<String, (String, usize)> = HashMap::new();
    let mut class_of: Vec<(String, String, usize)> = Vec::new();
    let mut parents: Vec<String> = Vec::new();
    let mut in_note = false;
    let state = |model: &mut StateModel, id: &str, parent: Option<&String>| -> usize {
        if let Some(position) = model.states.iter().position(|state| state.id == id) {
            return position;
        }
        model.states.push(StateNode {
            id: id.to_string(),
            label: id.to_string(),
            kind: StateKind::Normal,
            color: None,
            parent: parent.cloned(),
            lines: Vec::new(),
        });
        model.states.len() - 1
    };
    for (index, line) in lines.iter().enumerate().skip(header + 1) {
        if is_blank_or_comment(line) {
            continue;
        }
        let statement = line.trim();
        if in_note {
            in_note = statement != "end note";
            continue;
        }
        let first = statement.split_whitespace().next().unwrap_or_default();
        match first {
            "direction" => {
                model.direction = statement.split_whitespace().nth(1).unwrap_or("TB").to_string();
                direction_line = Some(index);
                continue;
            }
            "note" => {
                in_note = !statement.contains(':');
                continue;
            }
            "classDef" => {
                let mut words = statement.splitn(3, char::is_whitespace);
                words.next();
                if let (Some(name), Some(props)) = (words.next(), words.next()) {
                    let stroke = props.split(',').filter_map(|pair| pair.split_once(':')).find(|(key, _)| key.trim() == "stroke").map(|(_, value)| value.trim().to_uppercase());
                    if let Some(stroke) = stroke {
                        class_strokes.insert(name.to_string(), (stroke, index));
                    }
                }
                continue;
            }
            "class" => {
                let mut words = statement.split_whitespace().skip(1);
                if let (Some(ids), Some(name)) = (words.next(), words.next()) {
                    for id in ids.split(',') {
                        class_of.push((id.trim().to_string(), name.to_string(), index));
                    }
                }
                continue;
            }
            "}" => {
                parents.pop();
                continue;
            }
            "--" => continue,
            _ => {}
        }
        if let Some(rest) = statement.strip_prefix("state ") {
            let rest = rest.trim();
            if let Some(composite) = rest.strip_suffix('{') {
                let id = composite.trim().rsplit(" as ").next().unwrap_or(composite).trim().to_string();
                let position = state(&mut model, &id, parents.last());
                model.states[position].lines.push(index);
                parents.push(id);
                continue;
            }
            if let Some((label, id)) = rest.split_once(" as ") {
                let (label, id) = if label.trim().starts_with('"') { (label, id) } else { (id, label) };
                let id = id.split_whitespace().next().unwrap_or_default().to_string();
                let position = state(&mut model, &id, parents.last());
                model.states[position].label = unquoted(label);
                model.states[position].lines.push(index);
                label_lines.insert(id, index);
                continue;
            }
            let mut words = rest.split_whitespace();
            let id = words.next().unwrap_or_default().to_string();
            let kind = match words.next() {
                Some("<<choice>>") => StateKind::Choice,
                Some("<<fork>>") => StateKind::Fork,
                Some("<<join>>") => StateKind::Join,
                _ => StateKind::Normal,
            };
            let position = state(&mut model, &id, parents.last());
            model.states[position].kind = kind;
            model.states[position].lines.push(index);
            if kind != StateKind::Normal {
                kind_lines.insert(id, index);
            }
            continue;
        }
        if let Some((from, to, event)) = read_transition(statement) {
            for name in [&from, &to] {
                if name != PSEUDO {
                    let clean = name.split(":::").next().unwrap_or(name).to_string();
                    state(&mut model, &clean, parents.last());
                }
            }
            let clean = |name: &str| name.split(":::").next().unwrap_or(name).to_string();
            model.transitions.push(Transition { index: model.transitions.len(), from: clean(&from), to: clean(&to), event, line: index });
            continue;
        }
        // `Id : descripción` gives a state its text.
        if let Some((id, description)) = statement.split_once(':') {
            let id = id.trim();
            if !id.is_empty() && !id.contains(char::is_whitespace) {
                let position = state(&mut model, id, parents.last());
                model.states[position].label = description.trim().to_string();
                model.states[position].lines.push(index);
            }
        }
    }
    for (id, class_name, line) in class_of {
        let Some(position) = model.states.iter().position(|state| state.id == id) else { continue };
        let Some((stroke, define_line)) = class_strokes.get(&class_name) else { continue };
        model.states[position].color = Some(stroke.clone());
        model.states[position].lines.extend([*define_line, line]);
        if class_name == color_class(&id) {
            color_lines.entry(id).or_default().extend([*define_line, line]);
        }
    }
    for state in &mut model.states {
        state.lines.sort_unstable();
        state.lines.dedup();
    }
    Some(Parsed { lines, model, direction_line, label_lines, kind_lines, color_lines })
}

pub fn read(source: &str) -> Option<StateModel> {
    parse(source).map(|parsed| parsed.model)
}

fn missing_state() -> BackendError {
    BackendError::invalid_input("Ese estado ya no está en el diagrama.")
}

fn missing_transition() -> BackendError {
    BackendError::invalid_input("Esa transición ya no está en el diagrama.")
}

fn ensure_state(parsed: &Parsed, id: &str, pseudo: bool) -> Result<(), BackendError> {
    if (pseudo && id == PSEUDO) || parsed.model.states.iter().any(|state| state.id == id) {
        Ok(())
    } else {
        Err(missing_state())
    }
}

fn transition_line(indent: &str, from: &str, to: &str, event: &str) -> String {
    if event.is_empty() {
        format!("{indent}{from} --> {to}")
    } else {
        format!("{indent}{from} --> {to} : {event}")
    }
}

fn rewrite_transition(parsed: &mut Parsed, index: usize, change: impl FnOnce(&mut Transition)) -> Result<(), BackendError> {
    let mut transition = parsed.model.transitions.get(index).cloned().ok_or_else(missing_transition)?;
    change(&mut transition);
    let indent = indent_of(&parsed.lines[transition.line]);
    parsed.lines[transition.line] = transition_line(&indent, &transition.from, &transition.to, &transition.event);
    Ok(())
}

fn last_statement(parsed: &Parsed) -> usize {
    parsed.lines.iter().rposition(|line| !line.trim().is_empty()).unwrap_or(parsed.model.header_line)
}

/// Where declarations go: after the header, the direction and the other
/// declarations.
fn declarations_end(parsed: &Parsed) -> usize {
    let mut end = parsed.direction_line.unwrap_or(parsed.model.header_line);
    for &line in parsed.label_lines.values().chain(parsed.kind_lines.values()) {
        end = end.max(line);
    }
    end
}

fn validate_color(color: &str) -> Result<String, BackendError> {
    let color = color.trim().to_uppercase();
    let valid = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    valid.then_some(color).ok_or_else(|| BackendError::invalid_input("El color no es válido."))
}

pub fn apply(source: &str, edit: StateEdit) -> Result<(String, Option<Selection>), BackendError> {
    let mut parsed = parse(source).ok_or_else(|| BackendError::invalid_input("El diagrama no es un diagrama de estados."))?;
    while parsed.lines.len() > parsed.model.header_line + 1 && parsed.lines.last().is_some_and(|line| line.trim().is_empty()) {
        parsed.lines.pop();
    }
    let indent = body_indent(&parsed.lines, parsed.model.header_line);
    let mut selection = None;
    match edit {
        StateEdit::SetDirection { direction } => {
            match (direction.as_str(), parsed.direction_line) {
                ("TB", Some(line)) => {
                    parsed.lines.remove(line);
                }
                ("TB", None) => {}
                ("LR", Some(line)) => parsed.lines[line] = format!("{indent}direction LR"),
                ("LR", None) => parsed.lines.insert(parsed.model.header_line + 1, format!("{indent}direction LR")),
                _ => return Err(BackendError::invalid_input("Esa dirección no existe.")),
            }
        }
        StateEdit::AddState { label, kind } => {
            let label = clean_label(label.as_deref().unwrap_or("Nuevo estado"), MAX_LABEL_CHARS);
            let label = if label.is_empty() { "Nuevo estado".to_string() } else { label };
            let id = unique_name(&pascal_identifier(&label, "Estado"), |name| parsed.model.states.iter().any(|state| state.id == name));
            let line = if id == label { format!("{indent}state {id}") } else { format!("{indent}state \"{}\" as {id}", label.replace('"', "'")) };
            let at = declarations_end(&parsed) + 1;
            parsed.lines.insert(at, line);
            if let Some(annotation) = kind.and_then(StateKind::annotation) {
                parsed.lines.insert(at + 1, format!("{indent}state {id} {annotation}"));
            }
            selection = Some(Selection::new("state", &id));
        }
        StateEdit::SetStateLabel { id, label } => {
            ensure_state(&parsed, &id, false)?;
            let label = clean_label(&label, MAX_LABEL_CHARS).replace('"', "'");
            if label.is_empty() {
                return Err(BackendError::invalid_input("Escribí un nombre."));
            }
            let line = (label != id).then(|| format!("{indent}state \"{label}\" as {id}"));
            match (parsed.label_lines.get(&id).copied(), line) {
                (Some(existing), Some(line)) => parsed.lines[existing] = format!("{}{}", indent_of(&parsed.lines[existing]), line.trim_start()),
                (Some(existing), None) => {
                    parsed.lines.remove(existing);
                }
                (None, Some(line)) => parsed.lines.insert(declarations_end(&parsed) + 1, line),
                (None, None) => {}
            }
            selection = Some(Selection::new("state", &id));
        }
        StateEdit::SetStateColor { id, color } => {
            ensure_state(&parsed, &id, false)?;
            let color = color.map(|color| validate_color(&color)).transpose()?;
            let mut existing = parsed.color_lines.get(&id).cloned().unwrap_or_default();
            existing.sort_unstable_by(|a, b| b.cmp(a));
            for line in existing {
                parsed.lines.remove(line);
            }
            if let Some(color) = color {
                let class = color_class(&id);
                parsed.lines.push(format!("{indent}classDef {class} stroke:{color}"));
                parsed.lines.push(format!("{indent}class {id} {class}"));
            }
            selection = Some(Selection::new("state", &id));
        }
        StateEdit::SetStateKind { id, kind } => {
            ensure_state(&parsed, &id, false)?;
            let line = kind.annotation().map(|annotation| format!("{indent}state {id} {annotation}"));
            match (parsed.kind_lines.get(&id).copied(), line) {
                (Some(existing), Some(line)) => parsed.lines[existing] = line,
                (Some(existing), None) => {
                    parsed.lines.remove(existing);
                }
                (None, Some(line)) => parsed.lines.insert(declarations_end(&parsed) + 1, line),
                (None, None) => {}
            }
            selection = Some(Selection::new("state", &id));
        }
        StateEdit::DeleteState { id } => {
            let state = parsed.model.states.iter().find(|state| state.id == id).cloned().ok_or_else(missing_state)?;
            if parsed.lines.get(*state.lines.first().unwrap_or(&0)).is_some_and(|line| line.trim_end().ends_with('{')) {
                return Err(BackendError::invalid_input("Un estado compuesto se borra desde el código."));
            }
            let mut remove = state.lines.clone();
            remove.extend(parsed.model.transitions.iter().filter(|transition| transition.from == id || transition.to == id).map(|transition| transition.line));
            remove.sort_unstable_by(|a, b| b.cmp(a));
            remove.dedup();
            for line in remove {
                parsed.lines.remove(line);
            }
        }
        StateEdit::AddTransition { from, to } => {
            ensure_state(&parsed, &from, true)?;
            ensure_state(&parsed, &to, true)?;
            if from == PSEUDO && to == PSEUDO {
                return Err(BackendError::invalid_input("Elegí un estado."));
            }
            let index = parsed.model.transitions.len();
            parsed.lines.insert(transitions_end(&parsed) + 1, transition_line(&indent, &from, &to, ""));
            selection = Some(Selection::new("transition", &index.to_string()));
        }
        StateEdit::SetTransitionEvent { index, event } => {
            let event = clean_label(&event, MAX_LABEL_CHARS).replace(':', " ");
            rewrite_transition(&mut parsed, index, |transition| transition.event = event)?;
            selection = Some(Selection::new("transition", &index.to_string()));
        }
        StateEdit::SwapTransition { index } => {
            rewrite_transition(&mut parsed, index, |transition| std::mem::swap(&mut transition.from, &mut transition.to))?;
            selection = Some(Selection::new("transition", &index.to_string()));
        }
        StateEdit::DeleteTransition { index } => {
            let transition = parsed.model.transitions.get(index).cloned().ok_or_else(missing_transition)?;
            parsed.lines.remove(transition.line);
        }
        StateEdit::AddStart { to } => {
            ensure_state(&parsed, &to, false)?;
            let index = parsed.model.transitions.len();
            parsed.lines.insert(transitions_end(&parsed) + 1, transition_line(&indent, PSEUDO, &to, ""));
            selection = Some(Selection::new("transition", &index.to_string()));
        }
        StateEdit::AddEnd { from } => {
            ensure_state(&parsed, &from, false)?;
            let index = parsed.model.transitions.len();
            parsed.lines.insert(transitions_end(&parsed) + 1, transition_line(&indent, &from, PSEUDO, ""));
            selection = Some(Selection::new("transition", &index.to_string()));
        }
        StateEdit::AddNote { id } => {
            ensure_state(&parsed, &id, false)?;
            let position = last_statement(&parsed) + 1;
            parsed.lines.insert(position, format!("{indent}note right of {id} : Nota"));
            selection = Some(Selection::new("state", &id));
        }
    }
    Ok((join_lines(&parsed.lines), selection))
}

/// After the last transition (so new ones keep their number), or after the
/// declarations.
fn transitions_end(parsed: &Parsed) -> usize {
    parsed
        .model
        .transitions
        .iter()
        .map(|transition| transition.line)
        .max()
        .unwrap_or_else(|| declarations_end(parsed))
}

/// A new state diagram.
pub fn template() -> String {
    "stateDiagram-v2\n  [*] --> Pendiente\n  Pendiente --> EnCurso : empezar\n  EnCurso --> Hecho : terminar\n  Hecho --> [*]\n".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "stateDiagram-v2\n  state \"Sprint actual\" as SprintActual\n  state Elige <<choice>>\n  [*] --> Anotador\n  Anotador --> SprintActual : priorizar\n  SprintActual --> Elige\n  Elige --> [*]\n  classDef c_sprintactual stroke:#4FD1C5\n  class SprintActual c_sprintactual\n";

    fn edit(source: &str, edit: StateEdit) -> String {
        apply(source, edit).expect("edit").0
    }

    #[test]
    fn states_transitions_kinds_and_colors_are_read() {
        let model = read(SAMPLE).expect("state");
        let states = model.states.iter().map(|state| (state.id.as_str(), state.label.as_str(), state.kind, state.color.as_deref())).collect::<Vec<_>>();
        assert_eq!(
            states,
            vec![
                ("SprintActual", "Sprint actual", StateKind::Normal, Some("#4FD1C5")),
                ("Elige", "Elige", StateKind::Choice, None),
                ("Anotador", "Anotador", StateKind::Normal, None),
            ]
        );
        assert_eq!(model.states[0].lines, vec![1, 7, 8]);
        let transitions = model.transitions.iter().map(|t| (t.from.as_str(), t.to.as_str(), t.event.as_str(), t.line)).collect::<Vec<_>>();
        assert_eq!(
            transitions,
            vec![("[*]", "Anotador", "", 3), ("Anotador", "SprintActual", "priorizar", 4), ("SprintActual", "Elige", "", 5), ("Elige", "[*]", "", 6)]
        );
        let composite = read("stateDiagram-v2\n  state Activo {\n    [*] --> Uno\n    Uno --> Dos\n  }\n  Activo --> [*]\n").expect("composite");
        assert_eq!(composite.states.iter().find(|state| state.id == "Uno").and_then(|state| state.parent.as_deref()), Some("Activo"));
        assert_eq!(composite.transitions.len(), 3);
    }

    #[test]
    fn states_are_added_renamed_colored_and_deleted() {
        let (added, selection) = apply(SAMPLE, StateEdit::AddState { label: Some("En revisión".into()), kind: None }).expect("add");
        assert_eq!(selection, Some(Selection::new("state", "EnRevision")));
        assert_eq!(split_lines(&added)[3], "  state \"En revisión\" as EnRevision");
        let choice = edit(SAMPLE, StateEdit::AddState { label: Some("Decide".into()), kind: Some(StateKind::Choice) });
        assert!(choice.contains("  state Decide
  state Decide <<choice>>
"));
        assert_eq!(read(&choice).expect("model").states.iter().find(|state| state.id == "Decide").map(|state| state.kind), Some(StateKind::Choice));
        let relabelled = edit(SAMPLE, StateEdit::SetStateLabel { id: "Anotador".into(), label: "Anotadores".into() });
        assert_eq!(split_lines(&relabelled)[3], "  state \"Anotadores\" as Anotador");
        let back = edit(SAMPLE, StateEdit::SetStateLabel { id: "SprintActual".into(), label: "SprintActual".into() });
        assert!(!back.contains("Sprint actual"));
        let recolored = edit(SAMPLE, StateEdit::SetStateColor { id: "SprintActual".into(), color: Some("#ff6b6b".into()) });
        assert!(recolored.ends_with("  classDef c_sprintactual stroke:#FF6B6B\n  class SprintActual c_sprintactual\n"));
        assert_eq!(recolored.matches("classDef").count(), 1);
        let uncolored = edit(SAMPLE, StateEdit::SetStateColor { id: "SprintActual".into(), color: None });
        assert!(!uncolored.contains("classDef"));
        let fork = edit(SAMPLE, StateEdit::SetStateKind { id: "Elige".into(), kind: StateKind::Fork });
        assert!(fork.contains("  state Elige <<fork>>\n"));
        let normal = edit(SAMPLE, StateEdit::SetStateKind { id: "Elige".into(), kind: StateKind::Normal });
        assert!(!normal.contains("<<"));
        let deleted = edit(SAMPLE, StateEdit::DeleteState { id: "SprintActual".into() });
        assert_eq!(deleted, "stateDiagram-v2\n  state Elige <<choice>>\n  [*] --> Anotador\n  Elige --> [*]\n");
    }

    #[test]
    fn transitions_are_added_and_edited() {
        let (added, selection) = apply(SAMPLE, StateEdit::AddTransition { from: "Elige".into(), to: "Anotador".into() }).expect("add");
        assert_eq!(selection, Some(Selection::new("transition", "4")));
        assert_eq!(split_lines(&added)[7], "  Elige --> Anotador");
        let evented = edit(SAMPLE, StateEdit::SetTransitionEvent { index: 2, event: "decidir: ya".into() });
        assert!(evented.contains("  SprintActual --> Elige : decidir  ya\n"));
        let swapped = edit(SAMPLE, StateEdit::SwapTransition { index: 1 });
        assert!(swapped.contains("  SprintActual --> Anotador : priorizar\n"));
        let deleted = edit(SAMPLE, StateEdit::DeleteTransition { index: 0 });
        assert!(!deleted.contains("[*] --> Anotador"));
        let started = edit(SAMPLE, StateEdit::AddEnd { from: "Anotador".into() });
        assert!(started.contains("  Elige --> [*]\n  Anotador --> [*]\n"));
        let lr = edit(SAMPLE, StateEdit::SetDirection { direction: "LR".into() });
        assert!(lr.starts_with("stateDiagram-v2\n  direction LR\n"));
        assert_eq!(read(&lr).expect("model").direction, "LR");
        assert_eq!(edit(&lr, StateEdit::SetDirection { direction: "TB".into() }), SAMPLE);
    }
}
