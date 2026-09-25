//! Bounded Markdown export renderers.
//!
//! The note is read into a document model, without its properties, and
//! written as a formatted PDF or Word document; formulas stay text in both.
//! Rendering is deliberately kept separate from destination I/O. Callers can
//! preview the returned bytes and hand them to a recoverable export port.

mod document;
mod docx;
mod markdown;
mod math;
mod pdf;

use crate::error::BackendError;
use crate::export::{validate_export_input_size, ExportFormat, MAX_EXPORT_OUTPUT_BYTES};
use crate::page_setup::PageGeometry;
use crate::prompt::strip_frontmatter;

/// Render bounded Markdown into a supported export format. The page size,
/// margins and numbering come from `page`.
pub fn render_markdown_export(
    markdown: &str,
    format: ExportFormat,
    page: &PageGeometry,
) -> Result<Vec<u8>, BackendError> {
    validate_export_input_size(markdown.as_bytes())?;
    let body = strip_frontmatter(markdown);
    if body.trim().is_empty() {
        return Err(BackendError::invalid_input(
            "El documento de exportación no puede estar vacío.",
        ));
    }

    let bytes = match format {
        ExportFormat::Pdf => pdf::render_pdf(&markdown::parse_markdown(body), page)?,
        ExportFormat::Docx => docx::render_docx(&markdown::parse_markdown(body), page)?,
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

    #[test]
    fn escapes_xml_and_drops_invalid_characters() {
        assert_eq!(escape_xml("a<b & \"c\"\u{1}"), "a&lt;b &amp; &quot;c&quot;");
    }
}
