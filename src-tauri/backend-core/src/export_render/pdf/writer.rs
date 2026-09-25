//! Laid-out pages to PDF bytes. Embedded fonts are subset to the glyphs the
//! document uses and carry a ToUnicode map, so text can be searched and
//! copied; streams are compressed.

use std::collections::BTreeMap;

use pdf_writer::types::{ActionType, AnnotationType, CidFontType, FontFlags, LineCapStyle, LineJoinStyle, SystemInfo};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str, TextStr};
use subsetter::GlyphRemapper;

use super::fonts::{FontId, Fonts};
use super::Draw;
use crate::error::{BackendError, BackendErrorCode};
use crate::export_render::document::Rgb;

/// A page ready to write: draws in PDF coordinates (points, origin at the
/// bottom left).
pub(super) struct PageContent {
    pub draws: Vec<Draw>,
}

const IDENTITY: SystemInfo = SystemInfo { registry: Str(b"Adobe"), ordering: Str(b"Identity"), supplement: 0 };

pub(super) fn write_pdf(fonts: &Fonts, pages: &[PageContent], width: f32, height: f32) -> Result<Vec<u8>, BackendError> {
    // Glyphs used per font, with the character each one shows.
    let mut used: BTreeMap<FontId, BTreeMap<u16, char>> = BTreeMap::new();
    for page in pages {
        for draw in &page.draws {
            if let Draw::Glyphs { font, glyphs, .. } = draw {
                let entry = used.entry(*font).or_default();
                for glyph in glyphs {
                    entry.entry(glyph.id).or_insert(glyph.ch);
                }
            }
        }
    }

    let mut next = 1;
    let mut reference = || {
        let id = Ref::new(next);
        next += 1;
        id
    };
    let catalog = reference();
    let tree = reference();
    let info = reference();
    let mut pdf = Pdf::new();

    // Fonts: resource name, remapper (embedded fonts) and object.
    let mut resources: BTreeMap<FontId, (String, Option<GlyphRemapper>, Ref)> = BTreeMap::new();
    for (index, (font, glyphs)) in used.iter().enumerate() {
        let name = format!("F{index}");
        let font_ref = reference();
        if *font == FontId::Courier {
            pdf.type1_font(font_ref).base_font(Name(b"Courier")).encoding_predefined(Name(b"WinAnsiEncoding"));
            resources.insert(*font, (name, None, font_ref));
            continue;
        }
        let embedded = fonts.embedded(*font).ok_or_else(|| pdf_error("falta una fuente"))?;
        let remapper = GlyphRemapper::new_from_glyphs_sorted(&glyphs.keys().copied().collect::<Vec<_>>());
        let subset = subsetter::subset(embedded.data, 0, &remapper).map_err(|_| pdf_error("no se pudo recortar una fuente"))?;
        let (cid_ref, descriptor_ref, file_ref, cmap_ref) = (reference(), reference(), reference(), reference());
        let base_name = format!("{}+{}", subset_tag(*font, glyphs), embedded.name);

        pdf.type0_font(font_ref)
            .base_font(Name(base_name.as_bytes()))
            .encoding_predefined(Name(b"Identity-H"))
            .descendant_font(cid_ref)
            .to_unicode(cmap_ref);

        let face = &embedded.face;
        let scale = 1000.0 / f32::from(face.units_per_em());
        let widths = remapper
            .remapped_gids()
            .map(|old| f32::from(face.glyph_hor_advance(ttf_parser::GlyphId(old)).unwrap_or(0)) * scale)
            .collect::<Vec<_>>();
        let mut cid = pdf.cid_font(cid_ref);
        cid.subtype(CidFontType::Type2)
            .base_font(Name(base_name.as_bytes()))
            .system_info(IDENTITY)
            .font_descriptor(descriptor_ref)
            .default_width(0.0)
            .cid_to_gid_map_predefined(Name(b"Identity"));
        cid.widths().consecutive(0, widths);
        cid.finish();

        let mut flags = FontFlags::SYMBOLIC;
        if fonts.is_italic(*font) {
            flags |= FontFlags::ITALIC;
        }
        if embedded.name.starts_with("KaTeX") {
            flags |= FontFlags::SERIF;
        }
        let bounds = face.global_bounding_box();
        pdf.font_descriptor(descriptor_ref)
            .name(Name(base_name.as_bytes()))
            .flags(flags)
            .bbox(Rect::new(
                f32::from(bounds.x_min) * scale,
                f32::from(bounds.y_min) * scale,
                f32::from(bounds.x_max) * scale,
                f32::from(bounds.y_max) * scale,
            ))
            .italic_angle(face.italic_angle())
            .ascent(f32::from(face.ascender()) * scale)
            .descent(f32::from(face.descender()) * scale)
            .cap_height(f32::from(face.capital_height().unwrap_or(face.ascender())) * scale)
            .stem_v(80.0)
            .font_file2(file_ref);
        let compressed = compress(&subset);
        pdf.stream(file_ref, &compressed)
            .filter(Filter::FlateDecode)
            .pair(Name(b"Length1"), i32::try_from(subset.len()).unwrap_or(i32::MAX));

        let pairs = glyphs.iter().filter_map(|(old, ch)| remapper.get(*old).map(|new| (new, *ch))).collect::<Vec<_>>();
        pdf.stream(cmap_ref, &to_unicode(&pairs));
        resources.insert(*font, (name, Some(remapper), font_ref));
    }

    let page_refs = pages.iter().map(|_| (reference(), reference())).collect::<Vec<_>>();
    for (page, (page_ref, content_ref)) in pages.iter().zip(&page_refs) {
        let mut content = Content::new();
        content.set_line_cap(LineCapStyle::RoundCap);
        content.set_line_join(LineJoinStyle::RoundJoin);
        let mut links = Vec::new();
        for draw in &page.draws {
            match draw {
                Draw::Rect { x, y, width, height, color } => {
                    fill(&mut content, *color);
                    content.rect(*x, *y, *width, *height);
                    content.fill_nonzero();
                }
                Draw::Line { points, width, color } => {
                    let Some((first, rest)) = points.split_first() else { continue };
                    let (r, g, b) = rgb(*color);
                    content.set_stroke_rgb(r, g, b);
                    content.set_line_width(*width);
                    content.move_to(first.0, first.1);
                    for point in rest {
                        content.line_to(point.0, point.1);
                    }
                    content.stroke();
                }
                Draw::Glyphs { x, y, font, size, color, glyphs, h_scale, v_scale } => {
                    let Some((name, remapper, _)) = resources.get(font) else { continue };
                    let mut bytes = Vec::with_capacity(glyphs.len() * 2);
                    for glyph in glyphs {
                        match remapper {
                            Some(remapper) => bytes.extend(remapper.get(glyph.id).unwrap_or(0).to_be_bytes()),
                            None => bytes.push(u8::try_from(glyph.id).unwrap_or(b'?')),
                        }
                    }
                    fill(&mut content, *color);
                    content.begin_text();
                    content.set_font(Name(name.as_bytes()), *size);
                    content.set_text_matrix([*h_scale, 0.0, 0.0, *v_scale, *x, *y]);
                    content.show(Str(&bytes));
                    content.end_text();
                }
                Draw::Link { x, y, width, height, url } => links.push((Rect::new(*x, *y, x + width, y + height), url.clone())),
            }
        }
        let annotation_refs = links.iter().map(|_| reference()).collect::<Vec<_>>();
        for ((rect, url), annotation_ref) in links.iter().zip(&annotation_refs) {
            let mut annotation = pdf.annotation(*annotation_ref);
            annotation.subtype(AnnotationType::Link).rect(*rect).border(0.0, 0.0, 0.0, None);
            annotation.action().action_type(ActionType::Uri).uri(Str(url.as_bytes()));
        }

        let mut page_writer = pdf.page(*page_ref);
        page_writer.media_box(Rect::new(0.0, 0.0, width, height)).parent(tree).contents(*content_ref);
        if !annotation_refs.is_empty() {
            page_writer.annotations(annotation_refs.iter().copied());
        }
        let mut page_resources = page_writer.resources();
        let mut font_resources = page_resources.fonts();
        for (name, _, font_ref) in resources.values() {
            font_resources.pair(Name(name.as_bytes()), *font_ref);
        }
        font_resources.finish();
        page_resources.finish();
        page_writer.finish();
        pdf.stream(*content_ref, &compress(&content.finish())).filter(Filter::FlateDecode);
    }

    pdf.pages(tree).kids(page_refs.iter().map(|(page_ref, _)| *page_ref)).count(i32::try_from(pages.len()).unwrap_or(i32::MAX));
    pdf.catalog(catalog).pages(tree);
    pdf.document_info(info).producer(TextStr("Notia"));
    Ok(pdf.finish())
}

fn pdf_error(reason: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, format!("No se pudo renderizar el PDF: {reason}."), false)
}

fn rgb(color: Rgb) -> (f32, f32, f32) {
    (f32::from(color.0) / 255.0, f32::from(color.1) / 255.0, f32::from(color.2) / 255.0)
}

fn fill(content: &mut Content, color: Rgb) {
    let (r, g, b) = rgb(color);
    content.set_fill_rgb(r, g, b);
}

/// A ToUnicode map in the plain form of the PDF specification's example,
/// which every reader parses.
fn to_unicode(pairs: &[(u16, char)]) -> Vec<u8> {
    let mut cmap = String::from(
        "/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
         /CMapName /Adobe-Identity-UCS def
/CMapType 2 def
         1 begincodespacerange
<0000> <FFFF>
endcodespacerange
",
    );
    for chunk in pairs.chunks(100) {
        cmap.push_str(&format!("{} beginbfchar
", chunk.len()));
        for (glyph, ch) in chunk {
            let mut units = [0u16; 2];
            let unicode = ch.encode_utf16(&mut units).iter().map(|unit| format!("{unit:04X}")).collect::<String>();
            cmap.push_str(&format!("<{glyph:04X}> <{unicode}>
"));
        }
        cmap.push_str("endbfchar
");
    }
    cmap.push_str("endcmap
CMapName currentdict /CMap defineresource pop
end
end
");
    cmap.into_bytes()
}

fn compress(data: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(data, 6)
}

/// The six capital letters a subset font's name starts with, different for
/// each subset.
fn subset_tag(font: FontId, glyphs: &BTreeMap<u16, char>) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for value in std::iter::once(font as u16).chain(glyphs.keys().copied()) {
        hash ^= u64::from(value);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    (0..6)
        .map(|index| char::from(b'A' + ((hash >> (index * 5)) % 26) as u8))
        .collect()
}
