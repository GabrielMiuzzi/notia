//! Page setup shared by the editor's page mode and the PDF exports: paper
//! formats, orientation, margins and page numbers, all in millimetres.

use serde_json::{json, Value};

use crate::{BackendError, BackendErrorCode, ExportFormat};

/// A paper format the page setup offers.
pub struct PaperFormat {
    pub id: &'static str,
    pub label: &'static str,
    pub width_mm: f64,
    pub height_mm: f64,
}

pub const PAPER_FORMATS: [PaperFormat; 6] = [
    PaperFormat { id: "a3", label: "A3", width_mm: 297.0, height_mm: 420.0 },
    PaperFormat { id: "a4", label: "A4", width_mm: 210.0, height_mm: 297.0 },
    PaperFormat { id: "a5", label: "A5", width_mm: 148.0, height_mm: 210.0 },
    PaperFormat { id: "b5", label: "B5", width_mm: 176.0, height_mm: 250.0 },
    PaperFormat { id: "letter", label: "Carta", width_mm: 215.9, height_mm: 279.4 },
    PaperFormat { id: "legal", label: "Oficio", width_mm: 215.9, height_mm: 355.6 },
];

/// A margin preset, the same on the four sides.
pub struct MarginPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub margin_mm: f64,
}

pub const MARGIN_PRESETS: [MarginPreset; 3] = [
    MarginPreset { id: "narrow", label: "Estrechos", margin_mm: 12.7 },
    MarginPreset { id: "normal", label: "Normales", margin_mm: 25.4 },
    MarginPreset { id: "wide", label: "Amplios", margin_mm: 38.1 },
];

const DEFAULT_FORMAT: &str = "a4";
const DEFAULT_MARGINS: &str = "normal";
const ORIENTATIONS: [&str; 2] = ["portrait", "landscape"];

/// Size of the page, its margins and whether it carries its number.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageGeometry {
    pub width_mm: f64,
    pub height_mm: f64,
    pub margin_mm: f64,
    pub page_numbers: bool,
}

fn choice<'a>(value: &Value, key: &str, allowed: impl IntoIterator<Item = &'a str>, fallback: &'a str) -> &'a str {
    let chosen = value.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_ascii_lowercase();
    allowed.into_iter().find(|option| *option == chosen).unwrap_or(fallback)
}

/// The editor's page setup with every value valid. Page mode starts off; the
/// other values also shape the PDF exports.
pub fn normalize_editor_page(value: &Value) -> Value {
    json!({
        "pageMode": value.get("pageMode").and_then(Value::as_bool) == Some(true),
        "format": choice(value, "format", PAPER_FORMATS.iter().map(|format| format.id), DEFAULT_FORMAT),
        "orientation": choice(value, "orientation", ORIENTATIONS, "portrait"),
        "margins": choice(value, "margins", MARGIN_PRESETS.iter().map(|preset| preset.id), DEFAULT_MARGINS),
        "pageNumbers": value.get("pageNumbers").and_then(Value::as_bool) != Some(false),
    })
}

fn oriented(format: &PaperFormat, landscape: bool) -> (f64, f64) {
    if landscape {
        (format.height_mm, format.width_mm)
    } else {
        (format.width_mm, format.height_mm)
    }
}

/// Page size, margin and numbering of a page setup (normalized first).
pub fn page_geometry(editor_page: &Value) -> PageGeometry {
    let setup = normalize_editor_page(editor_page);
    let format = PAPER_FORMATS
        .iter()
        .find(|format| setup["format"] == format.id)
        .unwrap_or(&PAPER_FORMATS[1]);
    let margin = MARGIN_PRESETS
        .iter()
        .find(|preset| setup["margins"] == preset.id)
        .unwrap_or(&MARGIN_PRESETS[1]);
    let (width_mm, height_mm) = oriented(format, setup["orientation"] == "landscape");
    PageGeometry {
        width_mm,
        height_mm,
        margin_mm: margin.margin_mm,
        page_numbers: setup["pageNumbers"] == true,
    }
}

/// A PDF lays the note out on the sheets page mode shows, so it is only
/// exported with page mode on. Word exports do not depend on it.
pub fn ensure_export_allowed(format: ExportFormat, editor_page: &Value) -> Result<(), BackendError> {
    if format == ExportFormat::Pdf && normalize_editor_page(editor_page)["pageMode"] != true {
        return Err(BackendError::new(
            BackendErrorCode::Unsupported,
            "Activá el modo página para exportar a PDF.",
            false,
        ));
    }
    Ok(())
}

impl Default for PageGeometry {
    /// A4 portrait with normal margins and page numbers.
    fn default() -> Self {
        page_geometry(&Value::Null)
    }
}

/// What the editor shows of a page setup: the formats with their size in the
/// chosen orientation, the margin presets, the resulting page and whether a
/// PDF can be exported.
pub fn page_setup_view(editor_page: &Value) -> Value {
    let landscape = normalize_editor_page(editor_page)["orientation"] == "landscape";
    let geometry = page_geometry(editor_page);
    json!({
        "formats": PAPER_FORMATS.iter().map(|format| {
            let (width_mm, height_mm) = oriented(format, landscape);
            json!({ "id": format.id, "label": format.label, "widthMm": width_mm, "heightMm": height_mm })
        }).collect::<Vec<_>>(),
        "margins": MARGIN_PRESETS.iter().map(|preset| {
            json!({ "id": preset.id, "label": preset.label, "marginMm": preset.margin_mm })
        }).collect::<Vec<_>>(),
        "widthMm": geometry.width_mm,
        "heightMm": geometry.height_mm,
        "marginMm": geometry.margin_mm,
        "pageNumbers": geometry.page_numbers,
        "canExportPdf": ensure_export_allowed(ExportFormat::Pdf, editor_page).is_ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_values_take_their_defaults() {
        let normalized = normalize_editor_page(&json!({ "pageMode": "si", "format": "tabloid", "orientation": 3, "margins": "enormes" }));
        assert_eq!(
            normalized,
            json!({ "pageMode": false, "format": "a4", "orientation": "portrait", "margins": "normal", "pageNumbers": true })
        );
        assert_eq!(normalize_editor_page(&json!({ "format": " Letter ", "pageMode": true }))["format"], "letter");
    }

    #[test]
    fn landscape_swaps_the_paper_sides() {
        let geometry = page_geometry(&json!({ "format": "a5", "orientation": "landscape", "margins": "narrow", "pageNumbers": false }));
        assert_eq!(geometry, PageGeometry { width_mm: 210.0, height_mm: 148.0, margin_mm: 12.7, page_numbers: false });
        assert_eq!(PageGeometry::default(), PageGeometry { width_mm: 210.0, height_mm: 297.0, margin_mm: 25.4, page_numbers: true });
    }

    #[test]
    fn the_view_lists_formats_in_the_chosen_orientation() {
        let view = page_setup_view(&json!({ "orientation": "landscape", "format": "legal" }));
        assert_eq!(view["formats"][1], json!({ "id": "a4", "label": "A4", "widthMm": 297.0, "heightMm": 210.0 }));
        assert_eq!(view["margins"].as_array().map(Vec::len), Some(3));
        assert_eq!(view["widthMm"].as_f64().map(f64::round), Some(356.0));
    }

    #[test]
    fn a_pdf_needs_page_mode() {
        let continuous = json!({ "pageMode": false });
        let paged = json!({ "pageMode": true });
        let refused = ensure_export_allowed(ExportFormat::Pdf, &continuous).unwrap_err();
        assert_eq!(refused.code, BackendErrorCode::Unsupported);
        assert!(ensure_export_allowed(ExportFormat::Pdf, &Value::Null).is_err());
        assert!(ensure_export_allowed(ExportFormat::Pdf, &paged).is_ok());
        assert!(ensure_export_allowed(ExportFormat::Docx, &continuous).is_ok());
        assert_eq!(page_setup_view(&continuous)["canExportPdf"], false);
        assert_eq!(page_setup_view(&paged)["canExportPdf"], true);
    }
}
