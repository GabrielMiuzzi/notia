//! Diagrams saved from a note: a Mermaid diagram as SVG or an XGraph graph
//! as PNG, written next to the note as «<note> - diagrama.svg».

use base64::Engine;
use serde::Deserialize;

use crate::export::MAX_EXPORT_NAME_ATTEMPTS;
use crate::BackendError;

const MAX_DIAGRAM_BYTES: usize = 16 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagramFormat {
    Svg,
    Png,
}

impl DiagramFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
        }
    }
}

/// The file's bytes: the SVG markup as it is, the PNG decoded from base64.
/// Scripts are refused, so the file cannot run anything when opened.
pub fn diagram_bytes(format: DiagramFormat, data: &str) -> Result<Vec<u8>, BackendError> {
    let bytes = match format {
        DiagramFormat::Svg => {
            let markup = data.trim();
            let lower = markup.to_ascii_lowercase();
            let starts = lower.starts_with("<svg") || lower.starts_with("<?xml");
            if !starts || !lower.contains("</svg>") || lower.contains("<script") || lower.contains("javascript:") {
                return Err(BackendError::invalid_input("El diagrama no es un SVG válido."));
            }
            markup.as_bytes().to_vec()
        }
        DiagramFormat::Png => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data.trim())
                .map_err(|_| BackendError::invalid_input("El gráfico no es un PNG válido."))?;
            if !bytes.starts_with(&PNG_SIGNATURE) {
                return Err(BackendError::invalid_input("El gráfico no es un PNG válido."));
            }
            bytes
        }
    };
    if bytes.is_empty() || bytes.len() > MAX_DIAGRAM_BYTES {
        return Err(BackendError::invalid_input("El diagrama es demasiado grande."));
    }
    Ok(bytes)
}

/// «folder/note - diagrama.svg», then «… (2).svg» and on while the name is taken.
pub fn diagram_destination_path(note_logical_path: &str, format: DiagramFormat, attempt: u32) -> Result<String, BackendError> {
    if attempt == 0 || attempt > MAX_EXPORT_NAME_ATTEMPTS {
        return Err(BackendError::invalid_input("Ya existen demasiados diagramas de esta nota en la carpeta."));
    }
    let path = note_logical_path.trim().trim_matches('/');
    let (parent, file_name) = path.rsplit_once('/').unwrap_or(("", path));
    let stem = file_name.strip_suffix(".md").or_else(|| file_name.strip_suffix(".MD"));
    let Some(stem) = stem.filter(|stem| !stem.is_empty()) else {
        return Err(BackendError::invalid_input("Solo se exportan diagramas de notas Markdown."));
    };
    let extension = format.extension();
    let name = if attempt == 1 {
        format!("{stem} - diagrama.{extension}")
    } else {
        format!("{stem} - diagrama ({attempt}).{extension}")
    };
    Ok(if parent.is_empty() { name } else { format!("{parent}/{name}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagrams_go_next_to_their_note() {
        assert_eq!(diagram_destination_path("Cursos/nota.md", DiagramFormat::Svg, 1).unwrap(), "Cursos/nota - diagrama.svg");
        assert_eq!(diagram_destination_path("nota.md", DiagramFormat::Png, 3).unwrap(), "nota - diagrama (3).png");
        assert!(diagram_destination_path("imagen.png", DiagramFormat::Svg, 1).is_err());
        assert!(diagram_destination_path("nota.md", DiagramFormat::Svg, 0).is_err());
    }

    #[test]
    fn only_clean_svg_and_real_png_are_saved() {
        assert!(diagram_bytes(DiagramFormat::Svg, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>").is_ok());
        assert!(diagram_bytes(DiagramFormat::Svg, "<svg><script>alert(1)</script></svg>").is_err());
        assert!(diagram_bytes(DiagramFormat::Svg, "<div></div>").is_err());
        let png = base64::engine::general_purpose::STANDARD.encode([PNG_SIGNATURE.as_slice(), &[0, 0, 0, 0]].concat());
        assert!(diagram_bytes(DiagramFormat::Png, &png).is_ok());
        assert!(diagram_bytes(DiagramFormat::Png, "bm8gZXMgcG5n").is_err());
    }
}
