//! Fonts of the PDF export. Text uses Liberation Sans (Arial's metrics, so it
//! matches the Word export), formulas use KaTeX's fonts (the ones the editor
//! draws them with) and code uses the standard Courier. All but Courier are
//! embedded, subset to the glyphs a document uses.

use std::sync::OnceLock;

use ttf_parser::{Face, GlyphId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(super) enum FontId {
    Sans,
    SansBold,
    SansItalic,
    SansBoldItalic,
    /// Standard PDF font, not embedded; glyph ids are WinAnsi codes.
    Courier,
    MainRegular,
    MainBold,
    MainItalic,
    MathItalic,
    MathBoldItalic,
    Ams,
    Size1,
    Size2,
    Size3,
    Size4,
    Caligraphic,
    Fraktur,
    Script,
    SansSerif,
    Typewriter,
}

const EMBEDDED: [(FontId, &str, &[u8]); 19] = [
    (FontId::Sans, "LiberationSans", include_bytes!("../../../fonts/liberation/LiberationSans-Regular.ttf")),
    (FontId::SansBold, "LiberationSans-Bold", include_bytes!("../../../fonts/liberation/LiberationSans-Bold.ttf")),
    (FontId::SansItalic, "LiberationSans-Italic", include_bytes!("../../../fonts/liberation/LiberationSans-Italic.ttf")),
    (FontId::SansBoldItalic, "LiberationSans-BoldItalic", include_bytes!("../../../fonts/liberation/LiberationSans-BoldItalic.ttf")),
    (FontId::MainRegular, "KaTeX_Main-Regular", include_bytes!("../../../fonts/katex/KaTeX_Main-Regular.ttf")),
    (FontId::MainBold, "KaTeX_Main-Bold", include_bytes!("../../../fonts/katex/KaTeX_Main-Bold.ttf")),
    (FontId::MainItalic, "KaTeX_Main-Italic", include_bytes!("../../../fonts/katex/KaTeX_Main-Italic.ttf")),
    (FontId::MathItalic, "KaTeX_Math-Italic", include_bytes!("../../../fonts/katex/KaTeX_Math-Italic.ttf")),
    (FontId::MathBoldItalic, "KaTeX_Math-BoldItalic", include_bytes!("../../../fonts/katex/KaTeX_Math-BoldItalic.ttf")),
    (FontId::Ams, "KaTeX_AMS-Regular", include_bytes!("../../../fonts/katex/KaTeX_AMS-Regular.ttf")),
    (FontId::Size1, "KaTeX_Size1-Regular", include_bytes!("../../../fonts/katex/KaTeX_Size1-Regular.ttf")),
    (FontId::Size2, "KaTeX_Size2-Regular", include_bytes!("../../../fonts/katex/KaTeX_Size2-Regular.ttf")),
    (FontId::Size3, "KaTeX_Size3-Regular", include_bytes!("../../../fonts/katex/KaTeX_Size3-Regular.ttf")),
    (FontId::Size4, "KaTeX_Size4-Regular", include_bytes!("../../../fonts/katex/KaTeX_Size4-Regular.ttf")),
    (FontId::Caligraphic, "KaTeX_Caligraphic-Regular", include_bytes!("../../../fonts/katex/KaTeX_Caligraphic-Regular.ttf")),
    (FontId::Fraktur, "KaTeX_Fraktur-Regular", include_bytes!("../../../fonts/katex/KaTeX_Fraktur-Regular.ttf")),
    (FontId::Script, "KaTeX_Script-Regular", include_bytes!("../../../fonts/katex/KaTeX_Script-Regular.ttf")),
    (FontId::SansSerif, "KaTeX_SansSerif-Regular", include_bytes!("../../../fonts/katex/KaTeX_SansSerif-Regular.ttf")),
    (FontId::Typewriter, "KaTeX_Typewriter-Regular", include_bytes!("../../../fonts/katex/KaTeX_Typewriter-Regular.ttf")),
];

/// Courier's advance and extent, in ems (Adobe's metrics).
const COURIER_ADVANCE: f32 = 0.6;
const COURIER_ASCENT: f32 = 0.629;
const COURIER_DESCENT: f32 = 0.157;

pub(super) struct EmbeddedFont {
    pub id: FontId,
    pub name: &'static str,
    pub data: &'static [u8],
    pub face: Face<'static>,
    units_per_em: f32,
}

/// Ink box of a glyph, in ems; y grows upwards from the baseline.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct Bounds {
    pub x_min: f32,
    pub y_min: f32,
    pub x_max: f32,
    pub y_max: f32,
}

pub(super) struct Fonts {
    embedded: Vec<EmbeddedFont>,
}

/// The fonts, parsed once; `None` only if a bundled font were corrupt.
pub(super) fn fonts() -> Option<&'static Fonts> {
    static FONTS: OnceLock<Option<Fonts>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let embedded = EMBEDDED
                .iter()
                .map(|(id, name, data)| {
                    let face = Face::parse(data, 0).ok()?;
                    let units_per_em = f32::from(face.units_per_em());
                    Some(EmbeddedFont { id: *id, name, data, face, units_per_em })
                })
                .collect::<Option<Vec<_>>>()?;
            Some(Fonts { embedded })
        })
        .as_ref()
}

impl Fonts {
    pub fn embedded(&self, id: FontId) -> Option<&EmbeddedFont> {
        self.embedded.iter().find(|font| font.id == id)
    }

    /// Glyph of `ch` in `font`, if the font has it.
    pub fn glyph(&self, font: FontId, ch: char) -> Option<u16> {
        if font == FontId::Courier {
            return win_ansi(ch).map(u16::from);
        }
        let face = &self.embedded(font)?.face;
        face.glyph_index(ch).map(|GlyphId(id)| id).filter(|id| *id != 0)
    }

    /// Advance of a glyph, in ems.
    pub fn advance(&self, font: FontId, glyph: u16) -> f32 {
        if font == FontId::Courier {
            return COURIER_ADVANCE;
        }
        self.embedded(font)
            .and_then(|embedded| Some(f32::from(embedded.face.glyph_hor_advance(GlyphId(glyph))?) / embedded.units_per_em))
            .unwrap_or(0.0)
    }

    pub fn bounds(&self, font: FontId, glyph: u16) -> Bounds {
        if font == FontId::Courier {
            return Bounds { x_min: 0.0, y_min: -COURIER_DESCENT, x_max: COURIER_ADVANCE, y_max: COURIER_ASCENT };
        }
        let Some(embedded) = self.embedded(font) else { return Bounds::default() };
        let scale = embedded.units_per_em;
        embedded
            .face
            .glyph_bounding_box(GlyphId(glyph))
            .map(|rect| Bounds {
                x_min: f32::from(rect.x_min) / scale,
                y_min: f32::from(rect.y_min) / scale,
                x_max: f32::from(rect.x_max) / scale,
                y_max: f32::from(rect.y_max) / scale,
            })
            .unwrap_or_default()
    }

    pub fn is_italic(&self, font: FontId) -> bool {
        matches!(font, FontId::SansItalic | FontId::SansBoldItalic | FontId::MainItalic | FontId::MathItalic | FontId::MathBoldItalic)
    }

    /// The first font of `chain` that has `ch`, with its glyph. A character
    /// no font has (an emoji) is drawn as `?` in the first font, and `ch`
    /// says so, so the text copied out of the PDF matches what it shows.
    pub fn find(&self, ch: char, chain: &[FontId]) -> Found {
        chain
            .iter()
            .find_map(|font| self.glyph(*font, ch).map(|glyph| Found { font: *font, glyph, ch }))
            .or_else(|| chain.first().and_then(|font| self.glyph(*font, '?').map(|glyph| Found { font: *font, glyph, ch: '?' })))
            .unwrap_or(Found { font: FontId::Sans, glyph: 0, ch: '?' })
    }
}

/// A character's glyph and the font it comes from.
#[derive(Debug, Clone, Copy)]
pub(super) struct Found {
    pub font: FontId,
    pub glyph: u16,
    /// The character drawn: `ch` itself, or `?` when no font has it.
    pub ch: char,
}

/// Fonts that stand in, in order, for characters a text font lacks.
pub(super) fn text_chain(font: FontId) -> &'static [FontId] {
    use FontId::*;
    match font {
        Sans => &[Sans, MainRegular, Ams, MathItalic, Size1],
        SansBold => &[SansBold, MainBold, Sans, MainRegular, Ams, MathItalic, Size1],
        SansItalic => &[SansItalic, MainItalic, Sans, MainRegular, Ams, MathItalic, Size1],
        SansBoldItalic => &[SansBoldItalic, SansBold, MainBold, Sans, MainRegular, Ams, MathItalic, Size1],
        Courier => &[Courier, Sans, MainRegular, Ams],
        _ => &[MainRegular, Sans, Ams, MathItalic, Size1],
    }
}

/// The WinAnsi code of `ch`, for the standard fonts.
pub(super) fn win_ansi(ch: char) -> Option<u8> {
    let code = u32::from(ch);
    if (0x20..=0x7e).contains(&code) || (0xa0..=0xff).contains(&code) {
        return u8::try_from(code).ok();
    }
    Some(match ch {
        '€' => 0x80,
        '‚' => 0x82,
        'ƒ' => 0x83,
        '„' => 0x84,
        '…' => 0x85,
        '†' => 0x86,
        '‡' => 0x87,
        'ˆ' => 0x88,
        '‰' => 0x89,
        'Š' => 0x8a,
        '‹' => 0x8b,
        'Œ' => 0x8c,
        'Ž' => 0x8e,
        '‘' => 0x91,
        '’' => 0x92,
        '“' => 0x93,
        '”' => 0x94,
        '•' => 0x95,
        '–' => 0x96,
        '—' => 0x97,
        '˜' => 0x98,
        '™' => 0x99,
        'š' => 0x9a,
        '›' => 0x9b,
        'œ' => 0x9c,
        'ž' => 0x9e,
        'Ÿ' => 0x9f,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_bundled_font() {
        let fonts = fonts().expect("fonts");
        for (id, ..) in EMBEDDED {
            assert!(fonts.embedded(id).is_some(), "{id:?}");
        }
    }

    #[test]
    fn covers_spanish_text_and_common_math() {
        let fonts = fonts().expect("fonts");
        for ch in "áéíóúñÑ¿¡«»“”–—…•€°±×÷→≤≥≠≈∞∑∫√αβπΩ∂∇∈∀∃∅⊂⇒".chars() {
            let found = fonts.find(ch, text_chain(FontId::Sans));
            assert_eq!(found.ch, ch);
            assert_ne!(fonts.glyph(found.font, ch), None, "{ch}");
        }
        let emoji = fonts.find('😀', text_chain(FontId::Sans));
        assert_eq!((emoji.font, emoji.ch), (FontId::Sans, '?'));
        assert_eq!(win_ansi('ñ'), Some(0xf1));
        assert_eq!(win_ansi('→'), None);
        assert!((fonts.advance(FontId::Sans, fonts.glyph(FontId::Sans, 'a').expect("a")) - 0.556).abs() < 0.001);
    }
}
