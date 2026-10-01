//! El cuerpo que muestra los músculos: los SVG de `Gym/` (frente y espalda,
//! masculino y femenino) leídos como trazos. Cada músculo es un `<path>`
//! con `data-muscle`; el resto es la silueta (relleno claro) o el contorno.
//! La pantalla los pinta con los colores del tema.

use serde::Serialize;

use super::{BodySex, MUSCLES};

/// Archivo de cada vista, dentro de `Gym/`.
pub fn body_file(sex: BodySex, back: bool) -> &'static str {
    match (sex, back) {
        (BodySex::Male, false) => "cuerpo-frente-masculino.svg",
        (BodySex::Male, true) => "cuerpo-espalda-masculino.svg",
        (BodySex::Female, false) => "cuerpo-frente-femenino.svg",
        (BodySex::Female, true) => "cuerpo-espalda-femenino.svg",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusclePath {
    /// Clave de `MUSCLES`.
    pub muscle: String,
    pub d: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BodyFigure {
    pub view_box: String,
    /// Relleno del cuerpo.
    pub silhouette: Vec<String>,
    /// Contorno.
    pub outline: Vec<String>,
    pub muscles: Vec<MusclePath>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BodyView {
    pub sex: String,
    pub front: Option<BodyFigure>,
    pub back: Option<BodyFigure>,
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let mut search = 0;
    while let Some(found) = tag[search..].find(&needle) {
        let start = search + found;
        // `d="` también aparece dentro de `id="`: el atributo empieza tras un espacio.
        if start == 0 || tag.as_bytes()[start - 1].is_ascii_whitespace() {
            let value_start = start + needle.len();
            let end = tag[value_start..].find('"')?;
            return Some(tag[value_start..value_start + end].to_string());
        }
        search = start + needle.len();
    }
    None
}

/// Un SVG del cuerpo como trazos. `None` si no tiene `viewBox` ni trazos.
pub fn parse_body_svg(svg: &str) -> Option<BodyFigure> {
    let svg_tag_start = svg.find("<svg")?;
    let svg_tag_end = svg[svg_tag_start..].find('>')? + svg_tag_start;
    let view_box = attribute(&svg[svg_tag_start..svg_tag_end], "viewBox")?;
    let mut figure = BodyFigure { view_box, ..BodyFigure::default() };
    let mut rest = &svg[svg_tag_end..];
    while let Some(start) = rest.find("<path") {
        let Some(end) = rest[start..].find('>') else { break };
        let tag = &rest[start..start + end];
        rest = &rest[start + end..];
        let Some(d) = attribute(tag, "d").filter(|d| !d.trim().is_empty()) else { continue };
        if let Some(name) = attribute(tag, "data-muscle") {
            if let Some((key, _, _)) = MUSCLES.iter().find(|(_, _, svg_name)| svg_name.eq_ignore_ascii_case(name.trim())) {
                figure.muscles.push(MusclePath { muscle: key.to_string(), d });
            }
            continue;
        }
        // La silueta es clara; el contorno, oscuro.
        let fill = attribute(tag, "fill").unwrap_or_default().to_ascii_uppercase();
        if fill == "#E8E8F5" || fill == "#FFFFFF" || fill == "WHITE" {
            figure.silhouette.push(d);
        } else {
            figure.outline.push(d);
        }
    }
    (!figure.muscles.is_empty() || !figure.silhouette.is_empty()).then_some(figure)
}
