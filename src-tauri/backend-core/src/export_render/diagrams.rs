//! The diagrams of a note (Mermaid and XGraph code blocks) and the pictures
//! of them the editor draws for a PDF export.
//!
//! Rust says which code blocks are diagrams (`diagram_sources`); the editor
//! renders each one as it shows it, on white paper, and sends the PNGs back
//! with the export. A block whose picture arrives goes into the PDF as that
//! picture; any other stays code. Word exports keep the code.

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine as _;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};

use crate::error::BackendError;
use crate::prompt::strip_frontmatter;

/// Most pictures one export takes.
const MAX_DIAGRAMS: usize = 64;
/// Largest PNG of one diagram, before base64.
const MAX_PNG_BYTES: usize = 12 * 1024 * 1024;
/// Largest side of a picture, in pixels.
const MAX_SIDE_PX: u32 = 8192;
/// Largest side of a diagram as the editor shows it, in CSS pixels.
const MAX_SIDE_CSS: f64 = 4096.0;

/// First words of a Mermaid diagram, for code blocks without a language
/// (or `text`): the editor shows those as diagrams too.
const MERMAID_KEYWORDS: &[&str] = &[
    "erdiagram",
    "flowchart",
    "graph ",
    "graph\t",
    "sequencediagram",
    "classdiagram",
    "statediagram",
    "gantt",
    "pie",
    "gitgraph",
    "mindmap",
    "journey",
    "requirementdiagram",
    "c4context",
    "c4container",
    "c4component",
    "c4dynamic",
    "c4deployment",
    "timeline",
    "sankey-beta",
    "xychart-beta",
    "block-beta",
    "packet-beta",
    "kanban",
    "architecture-beta",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagramKind {
    Mermaid,
    Xgraph,
}

/// A diagram of the note: its kind and its code, as the export reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramSource {
    pub kind: DiagramKind,
    pub source: String,
}

/// A diagram as the editor drew it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramRenderInput {
    pub kind: DiagramKind,
    /// The code, as `diagram_sources` gave it.
    pub source: String,
    /// The PNG, in base64.
    pub png: String,
    /// Its size on the editor's sheet, in CSS pixels.
    pub width: f64,
    pub height: f64,
}

/// A picture for the PDF: RGB pixels over white paper and the size it is
/// shown at, in CSS pixels.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Picture {
    pub width_px: u32,
    pub height_px: u32,
    pub rgb: Vec<u8>,
    pub width: f32,
    pub height: f32,
}

/// The pictures an export received, by diagram.
#[derive(Debug, Default)]
pub struct DiagramRenders {
    pictures: HashMap<(DiagramKind, String), Arc<Picture>>,
}

impl DiagramRenders {
    /// Validates and decodes what the editor sent.
    pub fn decode(inputs: Vec<DiagramRenderInput>) -> Result<Self, BackendError> {
        if inputs.len() > MAX_DIAGRAMS {
            return Err(BackendError::invalid_input("La nota tiene demasiados diagramas para exportarlos como imagen."));
        }
        let mut pictures = HashMap::new();
        for input in inputs {
            let picture = decode_picture(&input)?;
            pictures.insert((input.kind, input.source.trim().to_string()), Arc::new(picture));
        }
        Ok(Self { pictures })
    }

    pub(crate) fn get(&self, kind: DiagramKind, source: &str) -> Option<Arc<Picture>> {
        self.pictures.get(&(kind, source.trim().to_string())).cloned()
    }
}

fn invalid_picture() -> BackendError {
    BackendError::invalid_input("La imagen de un diagrama no es válida.")
}

fn decode_picture(input: &DiagramRenderInput) -> Result<Picture, BackendError> {
    let sizes_valid = [input.width, input.height].iter().all(|side| side.is_finite() && *side >= 1.0 && *side <= MAX_SIDE_CSS);
    if !sizes_valid || input.png.len() > MAX_PNG_BYTES / 3 * 4 + 4 {
        return Err(invalid_picture());
    }
    let png = base64::engine::general_purpose::STANDARD.decode(input.png.trim()).map_err(|_| invalid_picture())?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    decoder.set_limits(png::Limits { bytes: (MAX_SIDE_PX as usize) * (MAX_SIDE_PX as usize) });
    let mut reader = decoder.read_info().map_err(|_| invalid_picture())?;
    let (width_px, height_px) = (reader.info().width, reader.info().height);
    if width_px == 0 || height_px == 0 || width_px > MAX_SIDE_PX || height_px > MAX_SIDE_PX {
        return Err(invalid_picture());
    }
    let mut buffer = vec![0; reader.output_buffer_size().ok_or_else(invalid_picture)?];
    let frame = reader.next_frame(&mut buffer).map_err(|_| invalid_picture())?;
    let pixels = &buffer[..frame.buffer_size()];
    let channels = match frame.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return Err(invalid_picture()),
    };
    let mut rgb = Vec::with_capacity(width_px as usize * height_px as usize * 3);
    for row in pixels.chunks(frame.line_size).take(height_px as usize) {
        for pixel in row.chunks_exact(channels).take(width_px as usize) {
            let (color, alpha) = match channels {
                1 => ([pixel[0]; 3], 255),
                2 => ([pixel[0]; 3], pixel[1]),
                3 => ([pixel[0], pixel[1], pixel[2]], 255),
                _ => ([pixel[0], pixel[1], pixel[2]], pixel[3]),
            };
            // Transparent parts show the white paper.
            rgb.extend(color.map(|channel| over_white(channel, alpha)));
        }
    }
    Ok(Picture { width_px, height_px, rgb, width: input.width as f32, height: input.height as f32 })
}

fn over_white(channel: u8, alpha: u8) -> u8 {
    let alpha = u32::from(alpha);
    ((u32::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8
}

/// What a code block of `language` holding `code` is, when it is a diagram.
pub(crate) fn diagram_kind(language: &str, code: &str) -> Option<DiagramKind> {
    match language {
        "mermaid" => Some(DiagramKind::Mermaid),
        "xgraph" | "jsxgraph" => Some(DiagramKind::Xgraph),
        "" | "text" if looks_like_mermaid(code) => Some(DiagramKind::Mermaid),
        _ => None,
    }
}

fn looks_like_mermaid(code: &str) -> bool {
    let first_line = code.trim().lines().next().unwrap_or_default().trim().to_lowercase();
    // A first line of a single word (`graph`, `pie`) counts with its keyword.
    let padded = format!("{first_line} ");
    MERMAID_KEYWORDS.iter().any(|keyword| padded.starts_with(keyword))
}

/// The language of a code block, as the export reads it.
pub(crate) fn code_language(kind: &CodeBlockKind) -> String {
    match kind {
        CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or_default().to_ascii_lowercase(),
        CodeBlockKind::Indented => String::new(),
    }
}

/// The diagrams of a note, once each and in order, with the code the export
/// reads; the properties are left out.
pub fn diagram_sources(markdown: &str) -> Vec<DiagramSource> {
    let body = strip_frontmatter(markdown);
    let mut sources: Vec<DiagramSource> = Vec::new();
    let mut open: Option<(String, String)> = None;
    for event in Parser::new_ext(body, Options::ENABLE_TABLES | Options::ENABLE_MATH) {
        match event {
            Event::Start(Tag::CodeBlock(kind)) => open = Some((code_language(&kind), String::new())),
            Event::Text(text) => {
                if let Some((_, code)) = open.as_mut() {
                    code.push_str(&text);
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                let Some((language, code)) = open.take() else { continue };
                let source = code.strip_suffix('\n').unwrap_or(&code).to_string();
                let Some(kind) = diagram_kind(&language, &source) else { continue };
                let source = DiagramSource { kind, source };
                if sources.len() < MAX_DIAGRAMS && !sources.contains(&source) {
                    sources.push(source);
                }
            }
            _ => {}
        }
    }
    sources
}

#[cfg(test)]
pub(crate) fn test_picture(width: f32, height: f32) -> Picture {
    Picture { width_px: 2, height_px: 1, rgb: vec![0, 0, 0, 255, 255, 255], width, height }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32, rgba: &[u8]) -> String {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header().expect("header").write_image_data(rgba).expect("data");
        }
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn input(kind: DiagramKind, source: &str, png: String) -> DiagramRenderInput {
        DiagramRenderInput { kind, source: source.to_string(), png, width: 300.0, height: 150.0 }
    }

    #[test]
    fn finds_the_diagrams_the_editor_shows() {
        let note = "---\ntitle: a\n---\n\n```mermaid\ngraph TD\nA-->B\n```\n\n```\nsequenceDiagram\nA->>B: hola\n```\n\n- lista\n\n  ```xgraph\n  board.create('point', [1, 1]);\n  ```\n\n```rust\nfn main() {}\n```\n\n```text\npie\n\"a\": 1\n```\n\n```mermaid\ngraph TD\nA-->B\n```";
        let sources = diagram_sources(note);
        assert_eq!(
            sources.iter().map(|source| source.kind).collect::<Vec<_>>(),
            vec![DiagramKind::Mermaid, DiagramKind::Mermaid, DiagramKind::Xgraph, DiagramKind::Mermaid]
        );
        assert_eq!(sources[0].source, "graph TD\nA-->B");
        assert_eq!(sources[2].source, "board.create('point', [1, 1]);");
    }

    #[test]
    fn decodes_pictures_over_white_paper() {
        // A black pixel and a transparent one.
        let renders = DiagramRenders::decode(vec![input(DiagramKind::Mermaid, "graph TD\n", png(2, 1, &[0, 0, 0, 255, 0, 0, 0, 0]))]).expect("decoded");
        let picture = renders.get(DiagramKind::Mermaid, "graph TD").expect("found by its trimmed code");
        assert_eq!((picture.width_px, picture.height_px), (2, 1));
        assert_eq!(picture.rgb, vec![0, 0, 0, 255, 255, 255]);
        assert!(renders.get(DiagramKind::Xgraph, "graph TD").is_none());
    }

    #[test]
    fn refuses_what_is_not_a_picture() {
        assert!(DiagramRenders::decode(vec![input(DiagramKind::Mermaid, "a", "no es png".to_string())]).is_err());
        let mut sized = input(DiagramKind::Mermaid, "a", png(1, 1, &[0, 0, 0, 255]));
        sized.width = f64::NAN;
        assert!(DiagramRenders::decode(vec![sized]).is_err());
        let many = (0..=MAX_DIAGRAMS).map(|index| input(DiagramKind::Xgraph, &index.to_string(), png(1, 1, &[0, 0, 0, 255]))).collect();
        assert!(DiagramRenders::decode(many).is_err());
    }
}
