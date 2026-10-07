//! The Mermaid diagram editor (`.mmd` files): what a source holds, read per
//! diagram type, and the edits the editor makes to it. The interface sends
//! the person's intention; these rules rewrite the source, keeping the lines
//! they do not understand.

pub mod class;
pub mod er;
pub mod flowchart;
#[cfg(test)]
mod preview_fixtures;
pub mod sequence;
pub mod state;
pub mod text;

use serde::{Deserialize, Serialize};

use crate::error::BackendError;

/// Diagram types the editor edits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagramKind {
    Flowchart,
    Sequence,
    State,
    Class,
    Er,
}

/// What a source holds, as the editor shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MermaidModel {
    /// No statement yet.
    Empty,
    Flowchart(flowchart::FlowchartModel),
    Sequence(sequence::SequenceModel),
    State(state::StateModel),
    Class(class::ClassModel),
    Er(er::ErModel),
    /// A diagram type the editor only shows (`gantt`, `pie`…).
    #[serde(rename_all = "camelCase")]
    Other { keyword: String },
}

impl MermaidModel {
    pub fn kind(&self) -> Option<DiagramKind> {
        match self {
            MermaidModel::Flowchart(_) => Some(DiagramKind::Flowchart),
            MermaidModel::Sequence(_) => Some(DiagramKind::Sequence),
            MermaidModel::State(_) => Some(DiagramKind::State),
            MermaidModel::Class(_) => Some(DiagramKind::Class),
            MermaidModel::Er(_) => Some(DiagramKind::Er),
            MermaidModel::Empty | MermaidModel::Other { .. } => None,
        }
    }
}

/// The element an edit created or changed, to select it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub kind: String,
    pub key: String,
}

impl Selection {
    pub fn new(kind: &str, key: &str) -> Self {
        Self { kind: kind.to_string(), key: key.to_string() }
    }
}

/// An edit of the person, by diagram type.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "diagram", rename_all = "camelCase")]
pub enum MermaidEdit {
    Flowchart(flowchart::FlowchartEdit),
    Sequence(sequence::SequenceEdit),
    State(state::StateEdit),
    Class(class::ClassEdit),
    Er(er::ErEdit),
    /// Replaces the source with a new diagram of `kind`.
    #[serde(rename_all = "camelCase")]
    Start { kind: DiagramKind },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MermaidEditResult {
    pub source: String,
    pub model: MermaidModel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<Selection>,
}

/// Longest source the editor reads (characters).
pub const MAX_SOURCE_CHARS: usize = 500_000;

fn too_long() -> BackendError {
    BackendError::invalid_input("El diagrama es demasiado largo para editarlo.")
}

/// The keyword of the source's first statement.
fn keyword(source: &str) -> Option<String> {
    let lines = text::split_lines(source);
    let index = text::header_line(&lines)?;
    lines[index].split_whitespace().next().map(str::to_string)
}

/// What `source` holds.
pub fn read_model(source: &str) -> Result<MermaidModel, BackendError> {
    if source.chars().count() > MAX_SOURCE_CHARS {
        return Err(too_long());
    }
    let Some(keyword) = keyword(source) else { return Ok(MermaidModel::Empty) };
    Ok(match keyword.as_str() {
        "flowchart" | "graph" => flowchart::read(source).map_or(MermaidModel::Other { keyword }, MermaidModel::Flowchart),
        "sequenceDiagram" => sequence::read(source).map_or(MermaidModel::Other { keyword }, MermaidModel::Sequence),
        "stateDiagram-v2" | "stateDiagram" => state::read(source).map_or(MermaidModel::Other { keyword }, MermaidModel::State),
        "classDiagram" | "classDiagram-v2" => class::read(source).map_or(MermaidModel::Other { keyword }, MermaidModel::Class),
        "erDiagram" => er::read(source).map_or(MermaidModel::Other { keyword }, MermaidModel::Er),
        _ => MermaidModel::Other { keyword },
    })
}

/// A new diagram of `kind`.
pub fn template(kind: DiagramKind) -> String {
    match kind {
        DiagramKind::Flowchart => flowchart::template(),
        DiagramKind::Sequence => sequence::template(),
        DiagramKind::State => state::template(),
        DiagramKind::Class => class::template(),
        DiagramKind::Er => er::template(),
    }
}

/// `source` with `edit` applied, its model and what to select.
pub fn apply_edit(source: &str, edit: MermaidEdit) -> Result<MermaidEditResult, BackendError> {
    if source.chars().count() > MAX_SOURCE_CHARS {
        return Err(too_long());
    }
    let (source, selection) = match edit {
        MermaidEdit::Start { kind } => (template(kind), None),
        MermaidEdit::Flowchart(edit) => {
            // An empty file becomes a flowchart with its first edit.
            let base = if keyword(source).is_none() { "flowchart TD\n".to_string() } else { source.to_string() };
            flowchart::apply(&base, edit)?
        }
        MermaidEdit::Sequence(edit) => sequence::apply(source, edit)?,
        MermaidEdit::State(edit) => state::apply(source, edit)?,
        MermaidEdit::Class(edit) => class::apply(source, edit)?,
        MermaidEdit::Er(edit) => er::apply(source, edit)?,
    };
    let model = read_model(&source)?;
    Ok(MermaidEditResult { source, model, selection })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_type_comes_from_the_first_statement() {
        assert_eq!(read_model("").expect("empty"), MermaidModel::Empty);
        assert_eq!(read_model("%% solo un comentario\n").expect("empty"), MermaidModel::Empty);
        assert!(matches!(read_model("---\ntitle: Hola\n---\nflowchart LR\n  a --> b").expect("model"), MermaidModel::Flowchart(_)));
        assert_eq!(read_model("pie title Gastos\n").expect("other"), MermaidModel::Other { keyword: "pie".into() });
    }

    #[test]
    fn an_empty_file_becomes_a_flowchart_with_its_first_node() {
        let edit: MermaidEdit = serde_json::from_value(serde_json::json!({
            "diagram": "flowchart", "op": "addNode", "shape": "rect", "label": "Hola"
        }))
        .expect("edit");
        let result = apply_edit("", edit).expect("result");
        assert_eq!(result.source, "flowchart TD\n  n1@{ shape: rect, label: \"Hola\" }\n");
        assert_eq!(result.selection, Some(Selection::new("node", "n1")));
        let started = apply_edit("pie\n", MermaidEdit::Start { kind: DiagramKind::Flowchart }).expect("start");
        assert!(matches!(started.model, MermaidModel::Flowchart(_)));
    }
}
