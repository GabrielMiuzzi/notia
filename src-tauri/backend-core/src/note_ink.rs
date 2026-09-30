//! Handwriting over a note: the strokes the pen bar draws on the sheet.
//!
//! The strokes of `folder/note.md` live in `.notia/ink/folder/note.md.json`,
//! next to the library's other Notia data, so the note stays plain Markdown
//! and a Host copies them with the note. Both modes show the same strokes:
//! they are kept in the note's flow, the text as it is laid out out of page
//! mode (the sheet is as wide in both), and the editor moves them below the
//! page breaks in page mode. Strokes drawn on a page before that (`page` =
//! its index, coordinates of that page) are moved into the flow by the
//! editor the next time it lays the pages out (`replace_strokes`).
//!
//! Coordinates are CSS pixels of the unscaled sheet. This module validates
//! what the editor sends, smooths and
//! simplifies the strokes, finds what the eraser touches and says where the
//! strokes go when their note is renamed, moved, copied or deleted.

use serde::{Deserialize, Serialize};

use crate::device_preferences::PEN_COLORS;
use crate::BackendError;

/// Folder of the strokes, inside the library.
pub const INK_DIRECTORY: &str = ".notia/ink";
pub const MAX_STROKE_POINTS: usize = 4000;
pub const MAX_STROKES: usize = 5000;
/// Largest strokes file; a note past it takes no more strokes.
pub const MAX_INK_BYTES: usize = 8 * 1024 * 1024;
const MAX_ERASER_POINTS: usize = 512;
const MAX_LASSO_POINTS: usize = 4000;
/// Share of a stroke's points that must fall inside the lasso to select it.
const LASSO_INSIDE_SHARE: f64 = 0.5;
const MAX_ID_CHARS: usize = 64;
/// Widest sheet: an A4 in landscape is 1123 px.
const MAX_X: f64 = 4000.0;
/// Longest continuous sheet.
const MAX_Y: f64 = 1_000_000.0;
const MAX_PAGE: u32 = 10_000;
const MIN_WIDTH: f64 = 0.5;
const MAX_WIDTH: f64 = 64.0;
/// Points closer than this to the simplified line are dropped.
const SIMPLIFY_TOLERANCE: f64 = 0.35;
const INK_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InkTool {
    Pen,
    Highlighter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkStroke {
    pub id: String,
    pub tool: InkTool,
    /// One of the pen colors (`ink`, `teal`…), painted with the theme's token.
    pub color: String,
    pub width: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    /// `[x, y, pressure]`, pressure from 0 to 1.
    pub points: Vec<[f64; 3]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkDocument {
    #[serde(default = "ink_version")]
    pub version: u32,
    #[serde(default)]
    pub strokes: Vec<InkStroke>,
}

impl Default for InkDocument {
    fn default() -> Self {
        Self { version: INK_VERSION, strokes: Vec::new() }
    }
}

fn ink_version() -> u32 {
    INK_VERSION
}

/// A stroke as the editor sends it, before smoothing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeInput {
    pub id: String,
    pub tool: InkTool,
    pub color: String,
    pub width: f64,
    #[serde(default)]
    pub page: Option<u32>,
    pub points: Vec<[f64; 3]>,
    /// The pen's «Suavizado del trazo», 0 to 100.
    #[serde(default)]
    pub smoothing: f64,
}

fn invalid(message: &str) -> BackendError {
    BackendError::invalid_input(message)
}

/// Where the strokes of a note are kept.
pub fn ink_document_path(note_logical_path: &str) -> Result<String, BackendError> {
    let path = note_logical_path.trim().trim_matches('/');
    let valid_segments = path
        .split('/')
        .all(|segment| !segment.is_empty() && segment != "." && segment != ".." && !segment.contains('\\'));
    if path.is_empty() || !valid_segments || path.starts_with('.') || !path.to_ascii_lowercase().ends_with(".md") {
        return Err(invalid("Solo las notas Markdown de la biblioteca tienen trazos."));
    }
    Ok(format!("{INK_DIRECTORY}/{path}.json"))
}

/// The strokes file, or an empty one when the note has none. A damaged file
/// is an error, so a new stroke never overwrites it.
pub fn parse_document(text: Option<&str>) -> Result<InkDocument, BackendError> {
    let Some(text) = text.filter(|text| !text.trim().is_empty()) else {
        return Ok(InkDocument::default());
    };
    let mut document: InkDocument = serde_json::from_str(text)
        .map_err(|_| invalid("Los trazos de esta nota están dañados; no se modificaron."))?;
    document.strokes.retain(|stroke| check_stroke(stroke).is_ok());
    Ok(document)
}

pub fn serialize_document(document: &InkDocument) -> Result<String, BackendError> {
    let text = serde_json::to_string(document).map_err(|_| invalid("No se pudieron guardar los trazos."))?;
    if text.len() > MAX_INK_BYTES {
        return Err(invalid("Esta nota ya tiene demasiados trazos."));
    }
    Ok(text)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().count() <= MAX_ID_CHARS
        && id.chars().all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
}

fn check_point(point: &[f64; 3]) -> bool {
    point.iter().all(|value| value.is_finite())
        && (-MAX_WIDTH..=MAX_X).contains(&point[0])
        && (-MAX_WIDTH..=MAX_Y).contains(&point[1])
        && (0.0..=1.0).contains(&point[2])
}

fn check_stroke(stroke: &InkStroke) -> Result<(), BackendError> {
    if !valid_id(&stroke.id) {
        return Err(invalid("El trazo no tiene un identificador válido."));
    }
    if !PEN_COLORS.contains(&stroke.color.as_str()) {
        return Err(invalid("El color del trazo no es válido."));
    }
    if !stroke.width.is_finite() || !(MIN_WIDTH..=MAX_WIDTH).contains(&stroke.width) {
        return Err(invalid("El grosor del trazo no es válido."));
    }
    if stroke.page.is_some_and(|page| page > MAX_PAGE) {
        return Err(invalid("La página del trazo no es válida."));
    }
    if stroke.points.is_empty() || stroke.points.len() > MAX_STROKE_POINTS || !stroke.points.iter().all(check_point) {
        return Err(invalid("Los puntos del trazo no son válidos."));
    }
    Ok(())
}

fn round(value: f64, step: f64) -> f64 {
    (value / step).round() * step
}

/// Moving average of the positions: more smoothing, a steadier line. The
/// last point stays where the pen lifted.
fn smooth(points: &[[f64; 3]], smoothing: f64) -> Vec<[f64; 3]> {
    let strength = smoothing.clamp(0.0, 100.0) / 100.0;
    if strength == 0.0 || points.len() < 3 {
        return points.to_vec();
    }
    let follow = 1.0 - strength * 0.8;
    let mut smoothed = Vec::with_capacity(points.len());
    let mut current = points[0];
    smoothed.push(current);
    for point in &points[1..points.len() - 1] {
        current = [
            current[0] + (point[0] - current[0]) * follow,
            current[1] + (point[1] - current[1]) * follow,
            point[2],
        ];
        smoothed.push(current);
    }
    smoothed.push(points[points.len() - 1]);
    smoothed
}

fn distance_to_segment(point: [f64; 2], start: [f64; 2], end: [f64; 2]) -> f64 {
    let (dx, dy) = (end[0] - start[0], end[1] - start[1]);
    let length = dx * dx + dy * dy;
    let t = if length == 0.0 {
        0.0
    } else {
        (((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length).clamp(0.0, 1.0)
    };
    let (x, y) = (start[0] + t * dx, start[1] + t * dy);
    ((point[0] - x).powi(2) + (point[1] - y).powi(2)).sqrt()
}

fn xy(point: &[f64; 3]) -> [f64; 2] {
    [point[0], point[1]]
}

/// Ramer–Douglas–Peucker: keeps the points the shape needs, and the ones
/// where the pressure changes.
fn simplify(points: &[[f64; 3]]) -> Vec<[f64; 3]> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut pending = vec![(0, points.len() - 1)];
    while let Some((first, last)) = pending.pop() {
        let mut farthest = (0.0, first);
        for index in first + 1..last {
            let distance = distance_to_segment(xy(&points[index]), xy(&points[first]), xy(&points[last]));
            let pressure_step = (points[index][2] - points[first][2]).abs();
            let weight = distance.max(if pressure_step > 0.12 { SIMPLIFY_TOLERANCE * 2.0 } else { 0.0 });
            if weight > farthest.0 {
                farthest = (weight, index);
            }
        }
        if farthest.0 > SIMPLIFY_TOLERANCE {
            keep[farthest.1] = true;
            pending.push((first, farthest.1));
            pending.push((farthest.1, last));
        }
    }
    points.iter().zip(keep).filter_map(|(point, kept)| kept.then_some(*point)).collect()
}

/// Validates a new stroke and gives it its final shape: smoothed,
/// simplified and rounded to tenths of a pixel.
pub fn prepare_stroke(input: StrokeInput) -> Result<InkStroke, BackendError> {
    let draft = InkStroke {
        id: input.id,
        tool: input.tool,
        color: input.color,
        width: input.width,
        page: input.page,
        points: input.points,
    };
    check_stroke(&draft)?;
    let points = simplify(&smooth(&draft.points, input.smoothing))
        .into_iter()
        .map(|point| [round(point[0], 0.1), round(point[1], 0.1), round(point[2], 0.01)])
        .collect();
    Ok(InkStroke { width: round(draft.width, 0.1), points, ..draft })
}

pub fn add_stroke(document: &mut InkDocument, stroke: InkStroke) -> Result<(), BackendError> {
    if document.strokes.iter().any(|existing| existing.id == stroke.id) {
        return Err(invalid("El trazo ya estaba guardado."));
    }
    if document.strokes.len() >= MAX_STROKES {
        return Err(invalid("Esta nota ya tiene demasiados trazos."));
    }
    document.strokes.push(stroke);
    Ok(())
}

/// Puts new versions of strokes that are already kept (same id), for
/// example strokes drawn on a page moved into the flow. Unknown ids are
/// refused, so this never adds a stroke.
pub fn replace_strokes(document: &mut InkDocument, strokes: Vec<InkStroke>) -> Result<(), BackendError> {
    for stroke in strokes {
        check_stroke(&stroke)?;
        let Some(existing) = document.strokes.iter_mut().find(|existing| existing.id == stroke.id) else {
            return Err(invalid("El trazo que se quiere cambiar no existe."));
        };
        *existing = stroke;
    }
    Ok(())
}

/// Takes out the strokes with these ids and returns them, for undo.
pub fn remove_strokes(document: &mut InkDocument, ids: &[String]) -> Vec<InkStroke> {
    let (removed, kept) = std::mem::take(&mut document.strokes)
        .into_iter()
        .partition(|stroke| ids.contains(&stroke.id));
    document.strokes = kept;
    removed
}

/// Puts back strokes an undo returns; the ones already there are skipped.
pub fn restore_strokes(document: &mut InkDocument, strokes: Vec<InkStroke>) -> Result<(), BackendError> {
    for stroke in strokes {
        check_stroke(&stroke)?;
        if document.strokes.iter().any(|existing| existing.id == stroke.id) {
            continue;
        }
        add_stroke(document, stroke)?;
    }
    Ok(())
}

fn segments_distance(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> f64 {
    let cross = |o: [f64; 2], p: [f64; 2], q: [f64; 2]| (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    let (d1, d2, d3, d4) = (cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0)) {
        return 0.0;
    }
    distance_to_segment(a, c, d)
        .min(distance_to_segment(b, c, d))
        .min(distance_to_segment(c, a, b))
        .min(distance_to_segment(d, a, b))
}

fn touches(stroke: &InkStroke, eraser: &[[f64; 2]], radius: f64) -> bool {
    let reach = radius + stroke.width / 2.0;
    let pairs = |points: Vec<[f64; 2]>| -> Vec<([f64; 2], [f64; 2])> {
        if points.len() == 1 {
            vec![(points[0], points[0])]
        } else {
            points.windows(2).map(|pair| (pair[0], pair[1])).collect()
        }
    };
    let stroke_segments = pairs(stroke.points.iter().map(xy).collect());
    let eraser_segments = pairs(eraser.to_vec());
    eraser_segments
        .iter()
        .any(|(a, b)| stroke_segments.iter().any(|(c, d)| segments_distance(*a, *b, *c, *d) <= reach))
}

/// Takes out the strokes of the surface `page` that the eraser's path
/// touches and returns them, for undo.
pub fn erase(document: &mut InkDocument, page: Option<u32>, path: &[[f64; 2]], radius: f64) -> Result<Vec<InkStroke>, BackendError> {
    let valid_path = path.iter().all(|point| point.iter().all(|value| value.is_finite()));
    if path.is_empty() || path.len() > MAX_ERASER_POINTS || !valid_path || !radius.is_finite() || !(0.5..=64.0).contains(&radius) {
        return Err(invalid("El recorrido del borrador no es válido."));
    }
    let ids: Vec<String> = document
        .strokes
        .iter()
        .filter(|stroke| stroke.page == page && touches(stroke, path, radius))
        .map(|stroke| stroke.id.clone())
        .collect();
    Ok(remove_strokes(document, &ids))
}

/// Whether a point is inside a closed path (even–odd rule).
fn inside(point: [f64; 2], polygon: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let mut previous = polygon[polygon.len() - 1];
    for &current in polygon {
        let crosses = (current[1] > point[1]) != (previous[1] > point[1]);
        if crosses && point[0] < (previous[0] - current[0]) * (point[1] - current[1]) / (previous[1] - current[1]) + current[0] {
            inside = !inside;
        }
        previous = current;
    }
    inside
}

/// The strokes of the note's flow the lasso takes: at least half of their
/// points inside the closed path. Strokes still on a page are left out.
pub fn select_in_lasso(document: &InkDocument, lasso: &[[f64; 2]]) -> Result<Vec<String>, BackendError> {
    let valid = lasso.iter().all(|point| point.iter().all(|value| value.is_finite()));
    if lasso.len() < 3 || lasso.len() > MAX_LASSO_POINTS || !valid {
        return Err(invalid("El lazo no es válido."));
    }
    Ok(document
        .strokes
        .iter()
        .filter(|stroke| stroke.page.is_none())
        .filter(|stroke| {
            let taken = stroke.points.iter().filter(|point| inside(xy(point), lasso)).count();
            taken as f64 >= stroke.points.len() as f64 * LASSO_INSIDE_SHARE
        })
        .map(|stroke| stroke.id.clone())
        .collect())
}

/// Moves strokes by `(dx, dy)` and returns them as they are now. Nothing
/// moves when one of them would leave the sheet.
pub fn move_strokes(document: &mut InkDocument, ids: &[String], dx: f64, dy: f64) -> Result<Vec<InkStroke>, BackendError> {
    if !dx.is_finite() || !dy.is_finite() || ids.is_empty() {
        return Err(invalid("El movimiento de los trazos no es válido."));
    }
    let moved: Vec<InkStroke> = document
        .strokes
        .iter()
        .filter(|stroke| ids.contains(&stroke.id))
        .map(|stroke| InkStroke {
            points: stroke
                .points
                .iter()
                .map(|point| [round(point[0] + dx, 0.1), round(point[1] + dy, 0.1), point[2]])
                .collect(),
            ..stroke.clone()
        })
        .collect();
    if moved.len() != ids.len() {
        return Err(invalid("Algún trazo que se quiere mover ya no existe."));
    }
    for stroke in &moved {
        check_stroke(stroke).map_err(|_| invalid("Los trazos quedarían fuera de la hoja."))?;
    }
    replace_strokes(document, moved.clone())?;
    Ok(moved)
}

/// What happened to an entry of the library, for its notes' strokes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryChange {
    Delete { entry: String },
    Move { from: String, to: String },
    Copy { from: String, to: String },
}

impl EntryChange {
    pub fn source(&self) -> &str {
        match self {
            Self::Delete { entry } => entry,
            Self::Move { from, .. } | Self::Copy { from, .. } => from,
        }
    }
}

fn join(parent: &str, name: &str) -> String {
    let parent = parent.trim_matches('/');
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// The change an explorer operation makes, by its logical paths: the entry
/// (the parent folder for `paste`), the new name of a `rename`, the source
/// and mode (`copy`/`move`) of a `paste`.
pub fn entry_change(
    action: &str,
    logical_path: &str,
    name: Option<&str>,
    source: Option<&str>,
    mode: Option<&str>,
) -> Option<EntryChange> {
    let entry = logical_path.trim().trim_matches('/');
    match action {
        "delete" if !entry.is_empty() => Some(EntryChange::Delete { entry: entry.to_string() }),
        "rename" if !entry.is_empty() => {
            let name = name?.trim();
            let parent = entry.rsplit_once('/').map_or("", |(parent, _)| parent);
            Some(EntryChange::Move { from: entry.to_string(), to: join(parent, name) })
        }
        "paste" => {
            let source = source?.trim().trim_matches('/');
            let file_name = source.rsplit('/').next().filter(|name| !name.is_empty())?;
            let to = join(entry, file_name);
            if mode == Some("copy") {
                Some(EntryChange::Copy { from: source.to_string(), to })
            } else {
                Some(EntryChange::Move { from: source.to_string(), to })
            }
        }
        _ => None,
    }
}

/// Folder whose strokes files belong to the entry `entry`, when it is a folder.
pub fn ink_folder_of(entry: &str) -> String {
    format!("{INK_DIRECTORY}/{}/", entry.trim_matches('/'))
}

/// Where a strokes file goes when the entry `from` becomes `to`: the file of
/// the note itself, or one under the folder. `None` when it is not theirs.
pub fn relocated_ink_path(ink_path: &str, from: &str, to: &str) -> Option<String> {
    if let (Ok(own), Ok(target)) = (ink_document_path(from), ink_document_path(to)) {
        if ink_path == own {
            return Some(target);
        }
    }
    let rest = ink_path.strip_prefix(&ink_folder_of(from))?;
    Some(format!("{}{rest}", ink_folder_of(to)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, points: Vec<[f64; 3]>) -> StrokeInput {
        StrokeInput { id: id.to_string(), tool: InkTool::Pen, color: "teal".to_string(), width: 4.0, page: None, points, smoothing: 0.0 }
    }

    fn line(id: &str, page: Option<u32>, from: [f64; 2], to: [f64; 2]) -> InkStroke {
        InkStroke {
            id: id.to_string(),
            tool: InkTool::Pen,
            color: "ink".to_string(),
            width: 4.0,
            page,
            points: vec![[from[0], from[1], 0.5], [to[0], to[1], 0.5]],
        }
    }

    #[test]
    fn strokes_live_next_to_the_library_data_by_note_path() {
        assert_eq!(ink_document_path("Cursos/Ingles/anotaciones.md").unwrap(), ".notia/ink/Cursos/Ingles/anotaciones.md.json");
        assert!(ink_document_path("imagen.png").is_err());
        assert!(ink_document_path("../fuera.md").is_err());
        assert!(ink_document_path(".notia/ink/a.md").is_err());
        assert!(ink_document_path("").is_err());
    }

    #[test]
    fn a_new_stroke_is_simplified_and_rounded() {
        let points = (0..=100).map(|step| [step as f64 * 1.0001, 20.0, 0.5]).collect();
        let stroke = prepare_stroke(input("a-1", points)).unwrap();
        assert_eq!(stroke.points, vec![[0.0, 20.0, 0.5], [100.0, 20.0, 0.5]]);
    }

    #[test]
    fn pressure_changes_are_kept() {
        let points = vec![[0.0, 0.0, 0.2], [10.0, 0.0, 0.9], [20.0, 0.0, 0.2]];
        assert_eq!(prepare_stroke(input("p", points)).unwrap().points.len(), 3);
    }

    #[test]
    fn smoothing_steadies_the_line_and_keeps_its_ends() {
        let zigzag: Vec<[f64; 3]> = (0..20).map(|step| [step as f64 * 5.0, if step % 2 == 0 { 0.0 } else { 10.0 }, 0.5]).collect();
        let raw = prepare_stroke(input("r", zigzag.clone())).unwrap();
        let smooth = prepare_stroke(StrokeInput { smoothing: 100.0, ..input("s", zigzag.clone()) }).unwrap();
        let spread = |stroke: &InkStroke| stroke.points[1..stroke.points.len() - 1].iter().map(|point| point[1]).fold(0.0_f64, f64::max)
            - stroke.points[1..stroke.points.len() - 1].iter().map(|point| point[1]).fold(f64::MAX, f64::min);
        assert!(spread(&smooth) < spread(&raw));
        assert_eq!(smooth.points.first().map(|point| [point[0], point[1]]), Some([0.0, 0.0]));
        assert_eq!(smooth.points.last().map(|point| [point[0], point[1]]), Some([95.0, 10.0]));
    }

    #[test]
    fn invalid_strokes_are_refused() {
        assert!(prepare_stroke(StrokeInput { color: "#ff00ff".to_string(), ..input("c", vec![[1.0, 1.0, 0.5]]) }).is_err());
        assert!(prepare_stroke(input("x", vec![])).is_err());
        assert!(prepare_stroke(input("x", vec![[f64::NAN, 1.0, 0.5]])).is_err());
        assert!(prepare_stroke(input("x", vec![[1.0, 1.0, 2.0]])).is_err());
        assert!(prepare_stroke(input("con espacio", vec![[1.0, 1.0, 0.5]])).is_err());
        assert!(prepare_stroke(StrokeInput { width: 200.0, ..input("w", vec![[1.0, 1.0, 0.5]]) }).is_err());
    }

    #[test]
    fn strokes_drawn_on_a_page_are_moved_into_the_flow_by_id() {
        let mut document = InkDocument::default();
        add_stroke(&mut document, line("sheet", None, [0.0, 0.0], [10.0, 0.0])).unwrap();
        add_stroke(&mut document, line("page", Some(1), [0.0, 0.0], [10.0, 0.0])).unwrap();
        assert!(add_stroke(&mut document, line("page", Some(1), [0.0, 0.0], [1.0, 0.0])).is_err());
        replace_strokes(&mut document, vec![line("page", None, [0.0, 1150.0], [10.0, 1150.0])]).unwrap();
        assert_eq!(document.strokes.len(), 2);
        assert_eq!(document.strokes[1].page, None);
        assert_eq!(document.strokes[1].points[0][1], 1150.0);
        // Never adds a stroke, and validates what it puts.
        assert!(replace_strokes(&mut document, vec![line("otro", None, [0.0, 0.0], [1.0, 1.0])]).is_err());
        let mut invalid_color = line("sheet", None, [0.0, 0.0], [1.0, 1.0]);
        invalid_color.color = "fucsia".to_string();
        assert!(replace_strokes(&mut document, vec![invalid_color]).is_err());
    }

    #[test]
    fn the_lasso_takes_the_strokes_mostly_inside_and_they_move_together() {
        let mut document = InkDocument::default();
        add_stroke(&mut document, line("inside", None, [20.0, 20.0], [40.0, 40.0])).unwrap();
        add_stroke(&mut document, line("half", None, [50.0, 50.0], [150.0, 50.0])).unwrap();
        add_stroke(&mut document, line("outside", None, [200.0, 200.0], [220.0, 220.0])).unwrap();
        add_stroke(&mut document, line("on-page", Some(0), [20.0, 20.0], [40.0, 40.0])).unwrap();
        let lasso = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        assert_eq!(select_in_lasso(&document, &lasso).unwrap(), vec!["inside".to_string(), "half".to_string()]);
        assert!(select_in_lasso(&document, &lasso[..2]).is_err());

        let ids = vec!["inside".to_string(), "half".to_string()];
        let moved = move_strokes(&mut document, &ids, 10.0, 300.0).unwrap();
        assert_eq!(moved[0].points[0], [30.0, 320.0, 0.5]);
        assert_eq!(document.strokes[0].points[1], [50.0, 340.0, 0.5]);
        // Undo is the opposite move.
        move_strokes(&mut document, &ids, -10.0, -300.0).unwrap();
        assert_eq!(document.strokes[0].points[0], [20.0, 20.0, 0.5]);
        // Off the sheet or unknown: nothing moves.
        assert!(move_strokes(&mut document, &ids, 0.0, -1000.0).is_err());
        assert_eq!(document.strokes[0].points[0], [20.0, 20.0, 0.5]);
        assert!(move_strokes(&mut document, &["nada".to_string()], 1.0, 1.0).is_err());
    }

    #[test]
    fn the_eraser_takes_the_strokes_it_crosses_on_its_surface() {
        let mut document = InkDocument::default();
        add_stroke(&mut document, line("crossed", Some(0), [0.0, 50.0], [100.0, 50.0])).unwrap();
        add_stroke(&mut document, line("far", Some(0), [0.0, 200.0], [100.0, 200.0])).unwrap();
        add_stroke(&mut document, line("other-page", Some(1), [0.0, 50.0], [100.0, 50.0])).unwrap();
        let removed = erase(&mut document, Some(0), &[[50.0, 0.0], [50.0, 100.0]], 4.0).unwrap();
        assert_eq!(removed.iter().map(|stroke| stroke.id.as_str()).collect::<Vec<_>>(), vec!["crossed"]);
        assert_eq!(document.strokes.len(), 2);
        // Undo puts it back once.
        restore_strokes(&mut document, removed.clone()).unwrap();
        restore_strokes(&mut document, removed).unwrap();
        assert_eq!(document.strokes.len(), 3);
        assert!(erase(&mut document, None, &[], 4.0).is_err());
    }

    #[test]
    fn a_damaged_file_is_not_replaced() {
        assert!(parse_document(Some("{no es json")).is_err());
        assert_eq!(parse_document(None).unwrap(), InkDocument::default());
        let text = serialize_document(&InkDocument { version: 1, strokes: vec![line("a", None, [0.0, 0.0], [1.0, 1.0])] }).unwrap();
        assert_eq!(parse_document(Some(&text)).unwrap().strokes.len(), 1);
    }

    #[test]
    fn strokes_follow_their_note_when_it_moves() {
        assert_eq!(
            entry_change("rename", "Cursos/a.md", Some("b.md"), None, None),
            Some(EntryChange::Move { from: "Cursos/a.md".to_string(), to: "Cursos/b.md".to_string() })
        );
        assert_eq!(
            entry_change("paste", "Destino", None, Some("Cursos/a.md"), Some("copy")),
            Some(EntryChange::Copy { from: "Cursos/a.md".to_string(), to: "Destino/a.md".to_string() })
        );
        assert_eq!(entry_change("delete", "Cursos", None, None, None), Some(EntryChange::Delete { entry: "Cursos".to_string() }));
        assert_eq!(entry_change("create", "Cursos", Some("n.md"), None, None), None);
        assert_eq!(relocated_ink_path(".notia/ink/Cursos/a.md.json", "Cursos/a.md", "Cursos/b.md"), Some(".notia/ink/Cursos/b.md.json".to_string()));
        assert_eq!(relocated_ink_path(".notia/ink/Cursos/x/a.md.json", "Cursos", "Archivo/Cursos"), Some(".notia/ink/Archivo/Cursos/x/a.md.json".to_string()));
        assert_eq!(relocated_ink_path(".notia/ink/Otros/a.md.json", "Cursos", "Archivo"), None);
    }
}
