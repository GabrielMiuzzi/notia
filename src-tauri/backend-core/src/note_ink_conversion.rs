//! Handwriting turned into Markdown with the AI: the strokes the lasso took
//! are drawn as a black-on-white image, the model says what was written
//! (text, a formula, a diagram, a graph, a table or code) and this module
//! turns its answer into the Markdown block the note gets. The model only
//! names the kind and gives the content; the Markdown syntax (fences, `$`,
//! table rows) is always built here.

use serde::Serialize;

use crate::ai_settings::clean_latex_answer;
use crate::note_ink::{distance_to_segment, InkDocument, InkStroke, InkTool};
use crate::BackendError;

/// Blank room around the handwriting in the image, in sheet pixels.
const RASTER_PADDING: f64 = 24.0;
/// Longest side of the image, in pixels.
const MAX_RASTER_SIDE: f64 = 1600.0;
/// Small handwriting is enlarged up to this much.
const MAX_RASTER_SCALE: f64 = 2.0;
/// Thinnest line in the image, in pixels, so a fine tip stays readable.
const MIN_INK_RADIUS: f64 = 1.2;
/// Longest Markdown a conversion may put in the note.
pub const MAX_CONVERSION_CHARS: usize = 100_000;

pub const INK_CONVERSION_SYSTEM_PROMPT: &str = "Sos el reconocedor de escritura a mano de Notia. Recibís una imagen con trazos manuscritos en tinta negra sobre fondo blanco y la convertís en el contenido que la persona quiso escribir en su nota. Respondés solo con el formato pedido, sin saludos ni explicaciones.";

pub const INK_CONVERSION_USER_PROMPT: &str = "Decidí qué se escribió a mano en la imagen y transcribilo.
La primera línea de tu respuesta es `tipo: <tipo>` y desde la segunda línea va el contenido. Tipos:
- text: texto común (oraciones, títulos, listas, tareas). Contenido en Markdown; una fórmula corta dentro de una oración va entre $...$.
- latex_inline: una sola fórmula o expresión corta. Contenido: el LaTeX sin delimitadores.
- latex_block: una o varias ecuaciones destacadas o un desarrollo de varias líneas. Contenido: el LaTeX sin $$ (usá \\\\ o aligned para varias líneas).
- mermaid: un diagrama de cajas y flechas (flujo, secuencia, estados, organigrama, mapa mental). Contenido: código Mermaid.
- xgraph: el gráfico de una función, ejes cartesianos con puntos o una figura geométrica. Contenido: JavaScript de JSXGraph que usa el tablero ya creado `board` (board.setBoundingBox([...]) y board.create(...)), sin initBoard, HTML, etiquetas script ni imports.
- table: una tabla o cuadrícula de filas y columnas. Contenido: una tabla Markdown con la primera fila como encabezado.
- code: código de un lenguaje de programación. La primera línea es `tipo: code <lenguaje>` y el contenido es el código.
No pongas el contenido entre bloques ``` ni agregues comentarios. Transcribí fielmente: respetá el idioma, el orden y los saltos de línea, y no inventes partes ilegibles.";

/// What the handwriting became.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InkConversionKind {
    Text,
    LatexInline,
    LatexBlock,
    Mermaid,
    Xgraph,
    Table,
    Code,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InkConversion {
    pub kind: InkConversionKind,
    /// The block for the note, in Markdown.
    pub markdown: String,
}

/// A grayscale image: one byte per pixel, rows from the top.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InkRaster {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

fn invalid(message: &str) -> BackendError {
    BackendError::invalid_input(message)
}

/// The selected strokes that can be read: pen strokes in the note's flow.
/// The highlighter marks the text below and is left out.
pub fn convertible_strokes(document: &InkDocument, ids: &[String]) -> Result<Vec<InkStroke>, BackendError> {
    if ids.is_empty() || ids.len() > crate::note_ink::MAX_STROKES {
        return Err(invalid("La selección de trazos no es válida."));
    }
    let strokes: Vec<InkStroke> = document
        .strokes
        .iter()
        .filter(|stroke| ids.contains(&stroke.id) && stroke.tool == InkTool::Pen && stroke.page.is_none())
        .cloned()
        .collect();
    if strokes.is_empty() {
        return Err(invalid("Seleccioná trazos de lápiz para convertirlos; el resaltador no se convierte."));
    }
    Ok(strokes)
}

/// Draws the strokes black on white, framed with some room and scaled so
/// the longest side fits the image.
pub fn raster(strokes: &[InkStroke]) -> InkRaster {
    let (mut left, mut top, mut right, mut bottom) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for stroke in strokes {
        let half = stroke.width / 2.0;
        for point in &stroke.points {
            left = left.min(point[0] - half);
            top = top.min(point[1] - half);
            right = right.max(point[0] + half);
            bottom = bottom.max(point[1] + half);
        }
    }
    if left > right {
        (left, top, right, bottom) = (0.0, 0.0, 0.0, 0.0);
    }
    let (frame_width, frame_height) = (right - left + 2.0 * RASTER_PADDING, bottom - top + 2.0 * RASTER_PADDING);
    let scale = (MAX_RASTER_SIDE / frame_width.max(frame_height)).min(MAX_RASTER_SCALE);
    let width = ((frame_width * scale).round() as usize).max(1);
    let height = ((frame_height * scale).round() as usize).max(1);
    let mut pixels = vec![255_u8; width * height];
    let to_image = |point: &[f64; 3]| [(point[0] - left + RASTER_PADDING) * scale, (point[1] - top + RASTER_PADDING) * scale];
    for stroke in strokes {
        let radius = (stroke.width * scale / 2.0).max(MIN_INK_RADIUS);
        let points: Vec<[f64; 2]> = stroke.points.iter().map(to_image).collect();
        let segments: Vec<([f64; 2], [f64; 2])> = if points.len() == 1 {
            vec![(points[0], points[0])]
        } else {
            points.windows(2).map(|pair| (pair[0], pair[1])).collect()
        };
        for (start, end) in segments {
            let x_from = (start[0].min(end[0]) - radius).floor().max(0.0) as usize;
            let x_to = ((start[0].max(end[0]) + radius).ceil() as usize).min(width - 1);
            let y_from = (start[1].min(end[1]) - radius).floor().max(0.0) as usize;
            let y_to = ((start[1].max(end[1]) + radius).ceil() as usize).min(height - 1);
            for y in y_from..=y_to {
                for x in x_from..=x_to {
                    if distance_to_segment([x as f64 + 0.5, y as f64 + 0.5], start, end) <= radius {
                        pixels[y * width + x] = 0;
                    }
                }
            }
        }
    }
    InkRaster { width: width as u32, height: height as u32, pixels }
}

/// The kind line (`tipo: table`, `tipo: code python`) and the rest of the
/// answer. Without it, the whole answer is text.
fn split_answer(answer: &str) -> (Option<(String, String)>, String) {
    let mut lines = answer.trim().lines().peekable();
    while lines.peek().is_some_and(|line| line.trim().is_empty() || line.trim_start().starts_with("```")) {
        lines.next();
    }
    let Some(first) = lines.peek() else { return (None, String::new()) };
    let header = first.trim().trim_matches('*').trim().to_lowercase();
    let Some(rest) = ["tipo:", "tipo :", "kind:", "type:"].iter().find_map(|prefix| header.strip_prefix(prefix)) else {
        return (None, answer.trim().to_string());
    };
    let mut words = rest.trim().trim_matches('*').trim().split_whitespace();
    let kind = words.next().unwrap_or_default().to_string();
    let language = words.next().unwrap_or_default().to_string();
    lines.next();
    (Some((kind, language)), lines.collect::<Vec<_>>().join("\n"))
}

/// The content without the ``` fence a model may still have put around it.
fn without_fence(content: &str) -> String {
    let mut lines: Vec<&str> = content.trim().lines().collect();
    if lines.first().is_some_and(|line| line.trim_start().starts_with("```")) {
        lines.remove(0);
        if lines.last().is_some_and(|line| line.trim() == "```") {
            lines.pop();
        }
    }
    lines.join("\n").trim_matches('\n').trim_end().to_string()
}

/// A fenced block whose fence is longer than any run of backticks inside.
fn fenced(language: &str, body: &str) -> String {
    let mut longest = 0;
    let mut run = 0;
    for char in body.chars() {
        run = if char == '`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    let fence = "`".repeat(longest.max(2) + 1);
    format!("{fence}{language}\n{body}\n{fence}")
}

fn code_language(language: &str) -> String {
    language
        .chars()
        .filter(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '#' | '-' | '_'))
        .take(32)
        .collect::<String>()
        .to_lowercase()
}

fn is_separator_row(cells: &[String]) -> bool {
    !cells.is_empty()
        && cells.iter().all(|cell| !cell.is_empty() && cell.chars().all(|char| matches!(char, '-' | ':' | ' ')))
}

/// A Markdown table with a header, its separator and the same number of
/// cells in every row; `None` when the content has no rows.
fn table(content: &str) -> Option<String> {
    let rows: Vec<Vec<String>> = content
        .lines()
        .map(str::trim)
        .filter(|line| line.contains('|'))
        .map(|line| line.trim_matches('|').split('|').map(|cell| cell.trim().to_string()).collect::<Vec<_>>())
        .filter(|cells| !is_separator_row(cells))
        .collect();
    let columns = rows.iter().map(Vec::len).max()?;
    let line = |cells: &[String]| {
        let padded: Vec<&str> = (0..columns).map(|index| cells.get(index).map_or("", String::as_str)).collect();
        format!("| {} |", padded.join(" | "))
    };
    let mut lines = vec![line(&rows[0]), format!("|{}|", vec![" --- "; columns].join("|"))];
    lines.extend(rows[1..].iter().map(|row| line(row)));
    Some(lines.join("\n"))
}

fn inline_latex(content: &str) -> Option<String> {
    let latex = clean_latex_answer(content)?;
    let latex = latex.trim().trim_start_matches('$').trim_end_matches('$').trim();
    let latex = latex.lines().map(str::trim).filter(|line| !line.is_empty()).collect::<Vec<_>>().join(" ");
    (!latex.is_empty()).then_some(latex)
}

/// The Markdown block of the model's answer.
pub fn parse_answer(answer: &str) -> Result<InkConversion, BackendError> {
    let (header, content) = split_answer(answer);
    let (kind, language) = header.unwrap_or_default();
    let body = without_fence(&content);
    let converted = match kind.as_str() {
        "latex_inline" | "latex-inline" | "inline" => {
            inline_latex(&body).map(|latex| (InkConversionKind::LatexInline, format!("${latex}$")))
        }
        "latex_block" | "latex-block" | "latex" | "math" => {
            clean_latex_answer(&body).map(|latex| (InkConversionKind::LatexBlock, format!("$$\n{latex}\n$$")))
        }
        "mermaid" => (!body.is_empty()).then(|| (InkConversionKind::Mermaid, fenced("mermaid", &body))),
        "xgraph" | "jsxgraph" => (!body.is_empty()).then(|| (InkConversionKind::Xgraph, fenced("xgraph", &body))),
        "code" => (!body.is_empty()).then(|| (InkConversionKind::Code, fenced(&code_language(&language), &body))),
        "table" => table(&body).map(|table| (InkConversionKind::Table, table)),
        _ => None,
    };
    // A kind the model made up, or a block it left empty, is kept as text.
    let (kind, markdown) = match converted {
        Some(converted) => converted,
        None => (InkConversionKind::Text, if kind.is_empty() { content.trim().to_string() } else { body }),
    };
    if markdown.trim().is_empty() {
        return Err(BackendError::new(
            crate::BackendErrorCode::ProviderUnavailable,
            "La IA no reconoció nada escrito en los trazos.",
            true,
        ));
    }
    if markdown.chars().count() > MAX_CONVERSION_CHARS {
        return Err(invalid("La IA devolvió un contenido demasiado largo para la nota."));
    }
    Ok(InkConversion { kind, markdown })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke(id: &str, tool: InkTool, page: Option<u32>, points: Vec<[f64; 3]>) -> InkStroke {
        InkStroke { id: id.to_string(), tool, color: "ink".to_string(), width: 2.0, page, points }
    }

    fn parsed(answer: &str) -> (InkConversionKind, String) {
        let conversion = parse_answer(answer).unwrap();
        (conversion.kind, conversion.markdown)
    }

    #[test]
    fn only_pen_strokes_in_the_flow_are_read() {
        let document = InkDocument {
            version: 1,
            strokes: vec![
                stroke("pen", InkTool::Pen, None, vec![[0.0, 0.0, 0.5]]),
                stroke("marker", InkTool::Highlighter, None, vec![[0.0, 0.0, 0.5]]),
                stroke("old-page", InkTool::Pen, Some(0), vec![[0.0, 0.0, 0.5]]),
            ],
        };
        let all = ["pen", "marker", "old-page"].map(String::from);
        let taken = convertible_strokes(&document, &all).unwrap();
        assert_eq!(taken.iter().map(|stroke| stroke.id.as_str()).collect::<Vec<_>>(), vec!["pen"]);
        assert!(convertible_strokes(&document, &["marker".to_string()]).is_err());
        assert!(convertible_strokes(&document, &[]).is_err());
    }

    #[test]
    fn the_image_frames_the_handwriting_black_on_white() {
        let line = stroke("a", InkTool::Pen, None, vec![[100.0, 500.0, 0.5], [200.0, 500.0, 0.5]]);
        let image = raster(&[line]);
        // 100 px of line plus the stroke and the padding, enlarged twice.
        assert_eq!((image.width, image.height), ((100.0 + 2.0 + 48.0) as u32 * 2, (2.0 + 48.0) as u32 * 2));
        let at = |x: u32, y: u32| image.pixels[(y * image.width + x) as usize];
        assert_eq!(at(image.width / 2, image.height / 2), 0);
        assert_eq!(at(2, 2), 255);
        // A long page fits the longest side.
        let tall = stroke("b", InkTool::Pen, None, vec![[0.0, 0.0, 0.5], [0.0, 5000.0, 0.5]]);
        assert!(raster(&[tall]).height <= MAX_RASTER_SIDE as u32);
    }

    #[test]
    fn each_kind_becomes_its_markdown_block() {
        assert_eq!(parsed("tipo: text\nHola **mundo**"), (InkConversionKind::Text, "Hola **mundo**".to_string()));
        assert_eq!(parsed("tipo: latex_inline\n$x^2 + 1$"), (InkConversionKind::LatexInline, "$x^2 + 1$".to_string()));
        assert_eq!(
            parsed("tipo: latex_block\n```latex\n\\int_0^1 x\\,dx\n```"),
            (InkConversionKind::LatexBlock, "$$\n\\int_0^1 x\\,dx\n$$".to_string())
        );
        assert_eq!(parsed("tipo: mermaid\nflowchart LR\n  A --> B"), (InkConversionKind::Mermaid, "```mermaid\nflowchart LR\n  A --> B\n```".to_string()));
        assert_eq!(
            parsed("**Tipo:** xgraph\nboard.create('point', [1, 2]);"),
            (InkConversionKind::Xgraph, "```xgraph\nboard.create('point', [1, 2]);\n```".to_string())
        );
        assert_eq!(parsed("tipo: code Python\nprint('```')"), (InkConversionKind::Code, "````python\nprint('```')\n````".to_string()));
    }

    #[test]
    fn tables_get_a_header_separator_and_even_rows() {
        assert_eq!(
            parsed("tipo: table\n| Día | Monto |\n|---|---|\n| lunes | 10 |\n| martes |"),
            (InkConversionKind::Table, "| Día | Monto |\n| --- | --- |\n| lunes | 10 |\n| martes |  |".to_string())
        );
        assert_eq!(parsed("tipo: table\nsin columnas").0, InkConversionKind::Text);
    }

    #[test]
    fn answers_without_a_kind_are_text_and_empty_ones_fail() {
        assert_eq!(parsed("Comprar pan"), (InkConversionKind::Text, "Comprar pan".to_string()));
        assert_eq!(parsed("tipo: dibujo\nUna casa").0, InkConversionKind::Text);
        assert!(parse_answer("tipo: latex_block\n").is_err());
        assert!(parse_answer("   ").is_err());
    }
}
