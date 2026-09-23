//! Bounded Markdown export renderers.
//!
//! Rendering is deliberately kept separate from destination I/O. Callers can
//! preview the returned bytes and hand them to a recoverable export port.

use std::io::Cursor;

use docx_rs::{Docx, Paragraph, Run};

use crate::error::{BackendError, BackendErrorCode};
use crate::export::{validate_export_input_size, ExportFormat, MAX_EXPORT_OUTPUT_BYTES};

const PDF_PAGE_WIDTH_MM: f32 = 210.0;
const PDF_PAGE_HEIGHT_MM: f32 = 297.0;
const PDF_MARGIN_MM: f32 = 20.0;
const PDF_LINE_HEIGHT_PT: f32 = 14.0;
const PDF_FONT_SIZE_PT: f32 = 11.0;
const PDF_MAX_LINES_PER_PAGE: usize = 45;

/// Render bounded Markdown into a supported export format.
pub fn render_markdown_export(
    markdown: &str,
    format: ExportFormat,
) -> Result<Vec<u8>, BackendError> {
    validate_export_input_size(markdown.as_bytes())?;
    if markdown.trim().is_empty() {
        return Err(BackendError::invalid_input(
            "El documento de exportación no puede estar vacío.",
        ));
    }

    let bytes = match format {
        ExportFormat::Pdf => render_pdf(markdown)?,
        ExportFormat::Docx => render_docx(markdown)?,
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

fn render_docx(markdown: &str) -> Result<Vec<u8>, BackendError> {
    let mut document = Docx::new();
    for line in markdown.lines() {
        let text = line.strip_prefix("# ").unwrap_or(line);
        let run = Run::new().add_text(text);
        document = document.add_paragraph(Paragraph::new().add_run(run));
    }

    let mut output = Cursor::new(Vec::new());
    document.build().pack(&mut output).map_err(|error| {
        BackendError::new(
            BackendErrorCode::Internal,
            format!("No se pudo renderizar DOCX: {error}"),
            false,
        )
    })?;
    Ok(output.into_inner())
}

/// Writes a minimal PDF 1.4 document with the builtin Helvetica font.
///
/// The writer is dependency-free so the same renderer compiles for Windows and
/// Android. Builtin fonts avoid loading untrusted font files; characters
/// outside WinAnsi/Latin-1 are replaced with `?`.
fn render_pdf(markdown: &str) -> Result<Vec<u8>, BackendError> {
    let lines = markdown.lines().map(pdf_line).collect::<Vec<_>>();
    let pages = lines.chunks(PDF_MAX_LINES_PER_PAGE).collect::<Vec<_>>();
    let page_width = mm_to_pt(PDF_PAGE_WIDTH_MM);
    let page_height = mm_to_pt(PDF_PAGE_HEIGHT_MM);
    let margin = mm_to_pt(PDF_MARGIN_MM);

    // Object layout: 1 catalog, 2 page tree, 3 font, then (page, content) pairs.
    let page_ids = (0..pages.len()).map(|index| 4 + index * 2).collect::<Vec<_>>();
    let kids = page_ids
        .iter()
        .map(|id| format!("{id} 0 R"))
        .collect::<Vec<_>>()
        .join(" ");
    let mut objects: Vec<Vec<u8>> = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", pages.len()).into_bytes(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    ];
    for (page_lines, page_id) in pages.iter().zip(&page_ids) {
        objects.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_width:.2} {page_height:.2}] \
                 /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
                page_id + 1
            )
            .into_bytes(),
        );
        objects.push(pdf_content_stream(page_lines, margin, page_height - margin));
    }

    let mut output = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        offsets.push(output.len());
        output.extend(format!("{} 0 obj\n", index + 1).into_bytes());
        output.extend_from_slice(object);
        output.extend_from_slice(b"\nendobj\n");
        if output.len() > MAX_EXPORT_OUTPUT_BYTES {
            return Err(output_too_large());
        }
    }
    let xref_offset = output.len();
    output.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).into_bytes());
    for offset in offsets {
        output.extend(format!("{offset:010} 00000 n \n").into_bytes());
    }
    output.extend(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .into_bytes(),
    );
    Ok(output)
}

fn pdf_content_stream(lines: &[String], x: f32, top: f32) -> Vec<u8> {
    let mut stream =
        format!("BT\n/F1 {PDF_FONT_SIZE_PT:.1} Tf\n{PDF_LINE_HEIGHT_PT:.1} TL\n{x:.2} {top:.2} Td\n")
            .into_bytes();
    for line in lines {
        stream.push(b'(');
        stream.extend(pdf_escape_text(line));
        stream.extend_from_slice(b") Tj T*\n");
    }
    stream.extend_from_slice(b"ET");
    let mut object = format!("<< /Length {} >>\nstream\n", stream.len()).into_bytes();
    object.extend(stream);
    object.extend_from_slice(b"\nendstream");
    object
}

fn mm_to_pt(value: f32) -> f32 {
    value * 72.0 / 25.4
}

/// Encodes one line as the body of a PDF literal string in WinAnsi/Latin-1.
fn pdf_escape_text(line: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(line.len());
    for character in line.chars() {
        let code = u32::from(character);
        let byte = if (0x20..=0x7e).contains(&code) || (0xa0..=0xff).contains(&code) {
            code as u8
        } else {
            b'?'
        };
        if matches!(byte, b'(' | b')' | b'\\') {
            bytes.push(b'\\');
        }
        bytes.push(byte);
    }
    bytes
}

fn pdf_line(line: &str) -> String {
    // Replace unsupported control characters while retaining content.
    line.chars()
        .filter(|character| !character.is_control())
        .collect()
}

fn output_too_large() -> BackendError {
    BackendError::invalid_input("La salida de exportación supera el límite de tamaño.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_bounded_docx_with_zip_signature() {
        let bytes = render_markdown_export("# Title\n\nBody", ExportFormat::Docx).expect("docx");
        assert!(bytes.starts_with(b"PK"));
    }

    #[test]
    fn renders_bounded_pdf_with_pdf_signature() {
        let bytes = render_markdown_export("# Title\n\nBody", ExportFormat::Pdf).expect("pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.ends_with(b"%%EOF\n"));
    }

    #[test]
    fn paginates_long_pdf_documents() {
        let markdown = (0..100)
            .map(|line| format!("linea {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let bytes = render_markdown_export(&markdown, ExportFormat::Pdf).expect("pdf");
        assert!(String::from_utf8_lossy(&bytes).contains("/Count 3"));
    }

    #[test]
    fn escapes_pdf_delimiters_and_replaces_non_latin_characters() {
        assert_eq!(pdf_escape_text("a(b)\\ñ→"), b"a\\(b\\)\\\\\xf1?".to_vec());
    }

    #[test]
    fn rejects_binary_markdown_rendering_and_empty_input() {
        assert!(render_markdown_export("", ExportFormat::Pdf).is_err());
        assert!(render_markdown_export("data", ExportFormat::Binary).is_err());
    }
}
