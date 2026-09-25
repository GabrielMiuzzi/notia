//! The export model as a laid-out PDF: text is broken into lines and lines
//! into pages of the configured size; formulas are typeset glyph by glyph
//! with KaTeX's fonts.

mod fonts;
mod layout;
mod math_layout;
mod writer;

use super::document::{Document, Rgb};
use crate::error::{BackendError, BackendErrorCode};
use crate::page_setup::PageGeometry;
use fonts::FontId;
use layout::{label, layout_document, paginate};
use writer::{write_pdf, PageContent};

/// Room kept above the bottom margin for the page number, as page mode does (18 px).
const NUMBER_BAND: f32 = 13.5;
const NUMBER_SIZE: f32 = 8.5;

#[derive(Debug, Clone, Copy)]
struct Glyph {
    pub id: u16,
    /// The character the glyph shows, for text extraction.
    pub ch: char,
    /// Advance in points.
    pub advance: f32,
}

/// Something drawn on a page, in points, with y growing upwards.
#[derive(Debug, Clone)]
enum Draw {
    /// Glyphs from `x`, one after the other at their advances.
    Glyphs { x: f32, y: f32, font: FontId, size: f32, color: Rgb, glyphs: Vec<Glyph>, h_scale: f32, v_scale: f32 },
    Rect { x: f32, y: f32, width: f32, height: f32, color: Rgb },
    /// A stroked polyline.
    Line { points: Vec<(f32, f32)>, width: f32, color: Rgb },
    /// A clickable area opening `url`.
    Link { x: f32, y: f32, width: f32, height: f32, url: String },
}

impl Draw {
    pub fn translate(&mut self, dx: f32, dy: f32) {
        match self {
            Draw::Glyphs { x, y, .. } | Draw::Rect { x, y, .. } | Draw::Link { x, y, .. } => {
                *x += dx;
                *y += dy;
            }
            Draw::Line { points, .. } => {
                for point in points {
                    point.0 += dx;
                    point.1 += dy;
                }
            }
        }
    }

    /// Scales around the origin.
    pub fn scale(&mut self, factor: f32) {
        match self {
            Draw::Glyphs { x, y, size, glyphs, .. } => {
                *x *= factor;
                *y *= factor;
                *size *= factor;
                for glyph in glyphs {
                    glyph.advance *= factor;
                }
            }
            Draw::Rect { x, y, width, height, .. } | Draw::Link { x, y, width, height, .. } => {
                *x *= factor;
                *y *= factor;
                *width *= factor;
                *height *= factor;
            }
            Draw::Line { points, width, .. } => {
                *width *= factor;
                for point in points {
                    point.0 *= factor;
                    point.1 *= factor;
                }
            }
        }
    }
}

pub(super) fn render_pdf(document: &Document, page: &PageGeometry) -> Result<Vec<u8>, BackendError> {
    let fonts = fonts::fonts()
        .ok_or_else(|| BackendError::new(BackendErrorCode::Internal, "No se pudieron cargar las fuentes del PDF.", false))?;
    let width = mm_to_pt(page.width_mm);
    let height = mm_to_pt(page.height_mm);
    let margin = mm_to_pt(page.margin_mm).min(width / 4.0).min(height / 4.0);
    let band = if page.page_numbers { NUMBER_BAND } else { 0.0 };
    let content_height = (height - 2.0 * margin - band).max(72.0);

    let pages = paginate(layout_document(fonts, document, width - 2.0 * margin), content_height);
    let count = pages.len();
    let contents = pages
        .into_iter()
        .enumerate()
        .map(|(index, lines)| {
            let mut draws = Vec::new();
            for placed in lines {
                let baseline = height - margin - placed.top - placed.line.ascent;
                for mut draw in placed.line.draws {
                    draw.translate(margin, baseline);
                    draws.push(draw);
                }
            }
            if page.page_numbers {
                let (number, number_width) = label(fonts, &format!("{} / {count}", index + 1), NUMBER_SIZE, Rgb::MUTED);
                let baseline = (margin / 2.0 - 3.0).max(8.0);
                for mut draw in number {
                    draw.translate((width - number_width) / 2.0, baseline);
                    draws.push(draw);
                }
            }
            PageContent { draws }
        })
        .collect::<Vec<_>>();
    write_pdf(fonts, &contents, width, height)
}

fn mm_to_pt(value: f64) -> f32 {
    (value * 72.0 / 25.4) as f32
}

#[cfg(test)]
mod tests {
    use super::super::markdown::parse_markdown;
    use super::*;

    fn render(markdown: &str, page: &PageGeometry) -> lopdf::Document {
        let bytes = render_pdf(&parse_markdown(markdown), page).expect("pdf");
        lopdf::Document::load_mem(&bytes).expect("a valid PDF")
    }

    fn text(document: &lopdf::Document) -> String {
        let pages = document.get_pages().keys().copied().collect::<Vec<_>>();
        document.extract_text(&pages).unwrap_or_else(|error| panic!("text: {error:?}"))
    }

    #[test]
    fn writes_formatted_text_without_markdown() {
        let document = render("# Título\n\nTexto **negrita** y `código`, con ñ y ¿acentos?\n\n- uno\n- dos", &PageGeometry::default());
        let text = text(&document);
        for expected in ["Título", "negrita", "código", "ñ", "¿acentos?", "uno"] {
            assert!(text.contains(expected), "missing {expected} in {text}");
        }
        for markdown in ["#", "**", "`", "- uno"] {
            assert!(!text.contains(markdown), "{markdown} leaked into {text}");
        }
    }

    #[test]
    fn typesets_formulas_as_text() {
        let document = render("$$\n\\frac{\\alpha}{2} + \\sqrt{x} = \\sum_{i=1}^{n} i\n$$", &PageGeometry::default());
        let text = text(&document);
        assert!(text.contains('α') && text.contains('∑'), "{text}");
        assert!(!text.contains("\\frac"));
        let fonts = document
            .objects
            .values()
            .filter_map(|object| object.as_dict().ok())
            .filter_map(|dict| dict.get(b"BaseFont").ok())
            .filter_map(|name| name.as_name().ok())
            .map(|name| String::from_utf8_lossy(name).to_string())
            .collect::<Vec<_>>();
        assert!(fonts.iter().any(|name| name.ends_with("+KaTeX_Math-Italic")), "{fonts:?}");
        assert!(fonts.iter().any(|name| name.ends_with("+KaTeX_Size2-Regular")), "{fonts:?}");
        // No images: the formula is glyphs and rules.
        assert!(!document.objects.values().any(|object| object
            .as_stream()
            .is_ok_and(|stream| stream.dict.get(b"Subtype").and_then(|value| value.as_name()).is_ok_and(|name| name == b"Image"))));
    }

    #[test]
    fn uses_the_page_setup() {
        let page = PageGeometry { width_mm: 210.0, height_mm: 148.0, margin_mm: 12.7, page_numbers: false };
        let document = render(&"linea\n\n".repeat(60), &page);
        let pages = document.get_pages();
        assert!(pages.len() > 1);
        let first = document.get_object(*pages.values().next().expect("page")).and_then(lopdf::Object::as_dict).expect("page dict");
        let media_box = first.get(b"MediaBox").and_then(lopdf::Object::as_array).expect("media box");
        let width = media_box[2].as_float().expect("width");
        let height = media_box[3].as_float().expect("height");
        assert!((width - 595.28).abs() < 0.1 && (height - 419.53).abs() < 0.1);
        assert!(!text(&document).contains(" / "));
    }

    #[test]
    fn numbers_the_pages() {
        let document = render(&"linea\n\n".repeat(120), &PageGeometry::default());
        let count = document.get_pages().len();
        assert!(count > 1);
        assert!(text(&document).contains(&format!("1 / {count}")));
    }

    #[test]
    fn links_web_addresses() {
        let document = render("[Notia](https://example.com/notia)", &PageGeometry::default());
        let has_link = document.objects.values().any(|object| {
            object.as_dict().is_ok_and(|dict| {
                dict.get(b"A").and_then(lopdf::Object::as_dict).and_then(|action| action.get(b"URI")).is_ok()
            })
        });
        assert!(has_link);
    }
}
