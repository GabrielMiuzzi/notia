//! Bounded Markdown export renderers.
//!
//! The note is read into a document model, without its properties, and
//! written as a formatted PDF or Word document; formulas stay text in both.
//! Rendering is deliberately kept separate from destination I/O. Callers can
//! preview the returned bytes and hand them to a recoverable export port.

mod diagrams;
mod document;
mod docx;
mod markdown;
mod math;
mod pdf;

use crate::error::BackendError;
use crate::export::{validate_export_input_size, ExportFormat, MAX_EXPORT_OUTPUT_BYTES};
use crate::page_setup::PageGeometry;
use crate::prompt::strip_frontmatter;

pub use diagrams::{diagram_sources, DiagramKind, DiagramRenderInput, DiagramRenders, DiagramSource};

/// Render bounded Markdown into a supported export format. The page size,
/// margins and numbering come from `page`.
pub fn render_markdown_export(
    markdown: &str,
    format: ExportFormat,
    page: &PageGeometry,
) -> Result<Vec<u8>, BackendError> {
    render_markdown_export_with_diagrams(markdown, format, page, &DiagramRenders::default())
}

/// `render_markdown_export` where the PDF shows the diagrams with a picture
/// in `diagrams` as those pictures.
pub fn render_markdown_export_with_diagrams(
    markdown: &str,
    format: ExportFormat,
    page: &PageGeometry,
    diagrams: &DiagramRenders,
) -> Result<Vec<u8>, BackendError> {
    validate_export_input_size(markdown.as_bytes())?;
    let body = strip_frontmatter(markdown);
    if body.trim().is_empty() {
        return Err(BackendError::invalid_input(
            "El documento de exportación no puede estar vacío.",
        ));
    }

    let bytes = match format {
        ExportFormat::Pdf => pdf::render_pdf(&markdown::parse_markdown_with(body, diagrams), page)?,
        ExportFormat::Docx => docx::render_docx(&markdown::parse_markdown_with(body, &DiagramRenders::default()), page)?,
        ExportFormat::Binary => {
            return Err(BackendError::invalid_input(
                "Binary requiere bytes ya generados por un adaptador autorizado.",
            ))
        }
    };

    if bytes.len() > MAX_EXPORT_OUTPUT_BYTES {
        return Err(output_too_large());
    }
    Ok(bytes)
}

fn output_too_large() -> BackendError {
    BackendError::invalid_input("La salida de exportación supera el límite de tamaño.")
}

/// Escapes text for XML, dropping the control characters XML cannot hold.
pub(crate) fn escape_xml(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            '\t' | '\n' | '\r' => escaped.push(ch),
            ch if (ch as u32) < 0x20 || matches!(ch, '\u{FFFE}' | '\u{FFFF}') => {}
            ch => escaped.push(ch),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\ncontexto: \"#Personal\"\ncreatedAt: 1789793031678\n---\n\n# Título\n\nTexto con $x^2$.";

    #[test]
    fn renders_bounded_docx_with_zip_signature() {
        let bytes = render_markdown_export("# Title\n\nBody", ExportFormat::Docx, &PageGeometry::default()).expect("docx");
        assert!(bytes.starts_with(b"PK"));
    }

    #[test]
    fn leaves_the_properties_out() {
        let bytes = render_markdown_export(NOTE, ExportFormat::Docx, &PageGeometry::default()).expect("docx");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("zip");
        let mut document = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("word/document.xml").expect("document"), &mut document).expect("utf-8");
        assert!(document.contains("Título"));
        assert!(!document.contains("createdAt"));
        assert!(!document.contains("Personal"));
    }

    #[test]
    fn rejects_binary_rendering_and_empty_input() {
        assert!(render_markdown_export("", ExportFormat::Pdf, &PageGeometry::default()).is_err());
        assert!(render_markdown_export("---\na: 1\n---\n\n", ExportFormat::Pdf, &PageGeometry::default()).is_err());
        assert!(render_markdown_export("data", ExportFormat::Binary, &PageGeometry::default()).is_err());
    }

    #[test]
    fn renders_hostile_formulas_without_exhausting_the_stack() {
        let nested = format!("{}x{}", "\\frac{".repeat(60), "}{2}".repeat(60));
        let markdown = format!(
            "$${nested}$$\n\n$${}x$$\n\n${}$ y {}",
            "\\sqrt".repeat(20_000),
            "x^a".repeat(5_000),
            "> ".repeat(500),
        );
        for format in [ExportFormat::Pdf, ExportFormat::Docx] {
            assert!(render_markdown_export(&markdown, format, &PageGeometry::default()).is_ok());
        }
    }

    fn png_base64(width: u32, height: u32) -> String {
        use base64::Engine as _;
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.write_header().expect("header").write_image_data(&vec![40; (width * height * 3) as usize]).expect("data");
        }
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn images(bytes: &[u8]) -> usize {
        let document = lopdf::Document::load_mem(bytes).expect("a valid PDF");
        document
            .objects
            .values()
            .filter(|object| {
                object.as_stream().is_ok_and(|stream| {
                    stream.dict.get(b"Subtype").and_then(|value| value.as_name()).is_ok_and(|name| name == b"Image")
                })
            })
            .count()
    }

    fn pdf_text(bytes: &[u8]) -> String {
        let document = lopdf::Document::load_mem(bytes).expect("a valid PDF");
        let pages = document.get_pages().keys().copied().collect::<Vec<_>>();
        document.extract_text(&pages).expect("text")
    }

    #[test]
    fn the_pdf_shows_diagrams_as_the_editor_draws_them() {
        let note = "Antes

```mermaid
graph TD
A-->Bloque
```

```xgraph
board.create('point', [1, 1]);
```

```mermaid
graph TD
A-->Bloque
```

Después";
        let sources = diagram_sources(note);
        assert_eq!(sources.len(), 2);
        // Only the Mermaid diagram has a picture; the XGraph one stays code.
        let renders = DiagramRenders::decode(vec![DiagramRenderInput {
            kind: DiagramKind::Mermaid,
            source: sources[0].source.clone(),
            png: png_base64(40, 20),
            width: 4000.0,
            height: 2000.0,
        }])
        .expect("decoded");
        let bytes = render_markdown_export_with_diagrams(note, ExportFormat::Pdf, &PageGeometry::default(), &renders).expect("pdf");
        // One picture, written once though it is shown twice.
        assert_eq!(images(&bytes), 1);
        let text = pdf_text(&bytes);
        assert!(text.contains("Antes") && text.contains("Después"), "{text}");
        assert!(!text.contains("Bloque"), "{text}");
        assert!(text.contains("board.create"), "{text}");

        let plain = render_markdown_export(note, ExportFormat::Pdf, &PageGeometry::default()).expect("pdf");
        assert_eq!(images(&plain), 0);
        assert!(pdf_text(&plain).contains("Bloque"));
    }

    #[test]
    fn escapes_xml_and_drops_invalid_characters() {
        assert_eq!(escape_xml("a<b & \"c\"\u{1}"), "a&lt;b &amp; &quot;c&quot;");
    }
}
