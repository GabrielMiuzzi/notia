//! The export model as a Word document (Office Open XML): styled headings
//! and paragraphs, real lists and tables, and formulas as Word equations.
//! The page takes the size, margins and numbering of the page setup.

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::document::{Align, Block, Document, Inline, List, Rgb, Table, TextStyle};
use super::math::{omml::omml, parse_math};
use super::escape_xml;
use crate::error::{BackendError, BackendErrorCode};
use crate::page_setup::PageGeometry;

const TWIPS_PER_MM: f64 = 1440.0 / 25.4;
/// Indent of each list or quote level, in twips (1 cm).
const LEVEL_INDENT: u32 = 567;
/// Room for a list marker before the item's text (0.5 cm).
const MARKER_HANG: u32 = 283;
const BULLETS: [&str; 3] = ["•", "◦", "▪"];
const BULLET_NUMBERING: u32 = 1;

const WORD_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const RELATIONSHIP_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MATH_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const PACKAGE_RELATIONSHIPS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const RELATIONSHIP_TYPE: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

pub(super) fn render_docx(document: &Document, page: &PageGeometry) -> Result<Vec<u8>, BackendError> {
    let content_width = ((page.width_mm - 2.0 * page.margin_mm) * TWIPS_PER_MM).max(1440.0) as u32;
    let mut body = Body { content_width, ..Body::default() };
    for block in &document.blocks {
        body.block(block, Context::default());
    }
    // Word wants a paragraph after a final table.
    if !matches!(document.blocks.last(), Some(Block::Paragraph { .. } | Block::Heading { .. })) {
        body.xml.push_str("<w:p/>");
    }

    let mut parts: Vec<(&str, String)> = vec![
        ("[Content_Types].xml", content_types(page.page_numbers)),
        ("_rels/.rels", package_relationships()),
        ("word/document.xml", document_xml(&body.xml, page)),
        ("word/_rels/document.xml.rels", document_relationships(&body.links, page.page_numbers)),
        ("word/styles.xml", styles()),
        ("word/numbering.xml", numbering(&body.ordered_lists)),
    ];
    if page.page_numbers {
        parts.push(("word/footer1.xml", footer()));
    }

    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, xml) in parts {
        archive.start_file(name, options).map_err(docx_error)?;
        archive.write_all(xml.as_bytes()).map_err(|error| docx_error(error.into()))?;
    }
    Ok(archive.finish().map_err(docx_error)?.into_inner())
}

fn docx_error(error: zip::result::ZipError) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, format!("No se pudo renderizar DOCX: {error}"), false)
}

/// What sits before the first paragraph of a list item.
#[derive(Debug, Clone, Copy)]
enum Marker {
    Numbered { numbering: u32, level: u32 },
    Task(bool),
}

#[derive(Debug, Clone, Copy, Default)]
struct Context {
    /// Left indent of the blocks, in twips.
    indent: u32,
    /// Nesting of lists, for the numbering level.
    list_level: u32,
    in_list: bool,
    in_quote: bool,
}

#[derive(Default)]
struct Body {
    xml: String,
    content_width: u32,
    /// Web addresses of the links, in relationship order.
    links: Vec<String>,
    /// Ordered lists, each numbered on its own: level and first number.
    ordered_lists: Vec<(u32, u64)>,
    /// Marker the next paragraph starts with.
    marker: Option<Marker>,
}

impl Body {
    fn block(&mut self, block: &Block, context: Context) {
        match block {
            Block::Heading { level, align, content } => {
                let style = format!("Heading{}", level.clamp(&1, &6));
                self.paragraph(Some(&style), *align, context, content, false);
            }
            Block::Paragraph { align, content } => self.paragraph(None, *align, context, content, false),
            Block::List(list) => self.list(list, context),
            Block::Quote(blocks) => {
                let inner = Context { indent: context.indent + LEVEL_INDENT / 2, in_quote: true, ..context };
                for block in blocks {
                    self.block(block, inner);
                }
            }
            Block::Code { text } => {
                self.paragraph_start(Some("NotiaCode"), Align::Left, context);
                for (index, line) in text.split('\n').enumerate() {
                    if index > 0 {
                        self.xml.push_str("<w:r><w:br/></w:r>");
                    }
                    self.text_run(line, &TextStyle::default(), false);
                }
                self.xml.push_str("</w:p>");
            }
            Block::Math(latex) => {
                let nodes = parse_math(latex);
                if nodes.is_empty() {
                    return;
                }
                self.paragraph_start(Some("NotiaFormula"), Align::Center, context);
                self.xml.push_str(&format!("<m:oMathPara><m:oMath>{}</m:oMath></m:oMathPara></w:p>", omml(&nodes)));
            }
            Block::Table(table) => self.table(table, context),
            Block::Rule => {
                self.marker = None;
                self.xml.push_str(&format!(
                    "<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"{}\"/></w:pBdr></w:pPr></w:p>",
                    Rgb::HAIRLINE.hex()
                ));
            }
        }
    }

    fn list(&mut self, list: &List, context: Context) {
        let level = context.list_level.min(8);
        let numbering = match list.start {
            Some(start) => {
                self.ordered_lists.push((level, start));
                BULLET_NUMBERING + self.ordered_lists.len() as u32
            }
            None => BULLET_NUMBERING,
        };
        let inner = Context {
            indent: context.indent + LEVEL_INDENT,
            list_level: context.list_level + 1,
            in_list: true,
            ..context
        };
        for item in &list.items {
            self.marker = Some(match item.task {
                Some(checked) => Marker::Task(checked),
                None => Marker::Numbered { numbering, level },
            });
            // The marker needs a paragraph to sit on.
            if !matches!(item.blocks.first(), Some(Block::Paragraph { .. } | Block::Heading { .. })) {
                self.paragraph(None, Align::Left, inner, &[], false);
            }
            for block in &item.blocks {
                self.block(block, inner);
            }
            self.marker = None;
        }
    }

    fn paragraph(&mut self, style: Option<&str>, align: Align, context: Context, content: &[Inline], bold: bool) {
        self.paragraph_start(style, align, context);
        self.runs(content, bold);
        self.xml.push_str("</w:p>");
    }

    /// Opens `<w:p>` with its properties, and the list marker if one is due.
    fn paragraph_start(&mut self, style: Option<&str>, align: Align, context: Context) {
        let marker = self.marker.take();
        let mut properties = String::new();
        if let Some(style) = style {
            properties.push_str(&format!("<w:pStyle w:val=\"{style}\"/>"));
        }
        if let Some(Marker::Numbered { numbering, level }) = marker {
            properties.push_str(&format!("<w:numPr><w:ilvl w:val=\"{level}\"/><w:numId w:val=\"{numbering}\"/></w:numPr>"));
        }
        if context.in_quote {
            properties.push_str(&format!(
                "<w:pBdr><w:left w:val=\"single\" w:sz=\"18\" w:space=\"8\" w:color=\"{}\"/></w:pBdr>",
                Rgb::HAIRLINE.hex()
            ));
        }
        if context.in_list && style.is_none() {
            properties.push_str("<w:spacing w:after=\"60\"/>");
        }
        match marker {
            Some(_) => properties.push_str(&format!("<w:ind w:left=\"{}\" w:hanging=\"{MARKER_HANG}\"/>", context.indent)),
            None if context.indent > 0 => properties.push_str(&format!("<w:ind w:left=\"{}\"/>", context.indent)),
            None => {}
        }
        let justification = match align {
            Align::Left => None,
            Align::Center => Some("center"),
            Align::Right => Some("right"),
        };
        if let Some(justification) = justification {
            properties.push_str(&format!("<w:jc w:val=\"{justification}\"/>"));
        }
        self.xml.push_str("<w:p>");
        if !properties.is_empty() {
            self.xml.push_str(&format!("<w:pPr>{properties}</w:pPr>"));
        }
        if let Some(Marker::Task(checked)) = marker {
            let box_character = if checked { "☒" } else { "☐" };
            self.xml.push_str(&format!(
                "<w:r><w:rPr><w:rFonts w:ascii=\"Segoe UI Symbol\" w:hAnsi=\"Segoe UI Symbol\"/></w:rPr><w:t xml:space=\"preserve\">{box_character} </w:t></w:r>"
            ));
        }
    }

    fn runs(&mut self, content: &[Inline], bold: bool) {
        let mut index = 0;
        while let Some(inline) = content.get(index) {
            match inline {
                Inline::Text { style, .. } if style.link.is_some() => {
                    let url = style.link.clone().unwrap_or_default();
                    let relationship = self.link_relationship(&url);
                    self.xml.push_str(&format!("<w:hyperlink r:id=\"{relationship}\" w:history=\"1\">"));
                    while let Some(Inline::Text { text, style }) = content.get(index) {
                        if style.link.as_deref() != Some(url.as_str()) {
                            break;
                        }
                        self.text_run(text, style, bold);
                        index += 1;
                    }
                    self.xml.push_str("</w:hyperlink>");
                    continue;
                }
                Inline::Text { text, style } => self.text_run(text, style, bold),
                Inline::Math(latex) => {
                    let nodes = parse_math(latex);
                    if !nodes.is_empty() {
                        self.xml.push_str(&format!("<m:oMath>{}</m:oMath>", omml(&nodes)));
                    }
                }
                Inline::Break => self.xml.push_str("<w:r><w:br/></w:r>"),
            }
            index += 1;
        }
    }

    fn text_run(&mut self, text: &str, style: &TextStyle, bold: bool) {
        let mut properties = String::new();
        if style.code {
            properties.push_str("<w:rStyle w:val=\"NotiaCodeChar\"/>");
        } else if style.link.is_some() {
            properties.push_str("<w:rStyle w:val=\"Hyperlink\"/>");
        }
        if style.bold || bold {
            properties.push_str("<w:b/><w:bCs/>");
        }
        if style.italic {
            properties.push_str("<w:i/><w:iCs/>");
        }
        if style.strike {
            properties.push_str("<w:strike/>");
        }
        if let Some(color) = style.color {
            properties.push_str(&format!("<w:color w:val=\"{}\"/>", color.rgb().hex()));
        }
        if style.underline {
            properties.push_str("<w:u w:val=\"single\"/>");
        }
        if let Some(color) = style.highlight {
            properties.push_str(&format!("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{}\"/>", color.highlight_rgb().hex()));
        }
        self.xml.push_str("<w:r>");
        if !properties.is_empty() {
            self.xml.push_str(&format!("<w:rPr>{properties}</w:rPr>"));
        }
        for (index, piece) in text.split('\t').enumerate() {
            if index > 0 {
                self.xml.push_str("<w:tab/>");
            }
            if !piece.is_empty() {
                self.xml.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", escape_xml(piece)));
            }
        }
        self.xml.push_str("</w:r>");
    }

    fn link_relationship(&mut self, url: &str) -> String {
        let index = match self.links.iter().position(|link| link == url) {
            Some(index) => index,
            None => {
                self.links.push(url.to_string());
                self.links.len() - 1
            }
        };
        format!("rIdLink{index}")
    }

    fn table(&mut self, table: &Table, context: Context) {
        self.marker = None;
        let count = table.rows.iter().map(Vec::len).chain([table.header.len(), table.columns.len()]).max().unwrap_or(0);
        if count == 0 {
            return;
        }
        let width = self.content_width.saturating_sub(context.indent).max(1440);
        let column = width / count as u32;
        let border = Rgb::HAIRLINE.hex();
        let edges = ["top", "left", "bottom", "right", "insideH", "insideV"]
            .iter()
            .map(|edge| format!("<w:{edge} w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"{border}\"/>"))
            .collect::<String>();
        self.xml.push_str(&format!(
            "<w:tbl><w:tblPr><w:tblW w:w=\"{width}\" w:type=\"dxa\"/><w:tblInd w:w=\"{}\" w:type=\"dxa\"/><w:tblBorders>{edges}</w:tblBorders>\
             <w:tblCellMar><w:top w:w=\"60\" w:type=\"dxa\"/><w:left w:w=\"100\" w:type=\"dxa\"/><w:bottom w:w=\"60\" w:type=\"dxa\"/><w:right w:w=\"100\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr><w:tblGrid>",
            context.indent
        ));
        for _ in 0..count {
            self.xml.push_str(&format!("<w:gridCol w:w=\"{column}\"/>"));
        }
        self.xml.push_str("</w:tblGrid>");
        if !table.header.is_empty() {
            self.table_row(&table.header, &table.columns, count, column, true);
        }
        for row in &table.rows {
            self.table_row(row, &table.columns, count, column, false);
        }
        self.xml.push_str("</w:tbl>");
    }

    fn table_row(&mut self, cells: &[Vec<Inline>], columns: &[Align], count: usize, width: u32, header: bool) {
        self.xml.push_str("<w:tr>");
        if header {
            self.xml.push_str("<w:trPr><w:tblHeader/></w:trPr>");
        }
        for index in 0..count {
            self.xml.push_str(&format!("<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/>"));
            if header {
                self.xml.push_str(&format!("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{}\"/>", Rgb::PANEL.hex()));
            }
            self.xml.push_str("</w:tcPr><w:p><w:pPr><w:spacing w:before=\"0\" w:after=\"0\"/>");
            match columns.get(index) {
                Some(Align::Center) => self.xml.push_str("<w:jc w:val=\"center\"/>"),
                Some(Align::Right) => self.xml.push_str("<w:jc w:val=\"right\"/>"),
                _ => {}
            }
            self.xml.push_str("</w:pPr>");
            if let Some(cell) = cells.get(index) {
                self.runs(cell, header);
            }
            self.xml.push_str("</w:p></w:tc>");
        }
        self.xml.push_str("</w:tr>");
    }
}

const XML_DECLARATION: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

fn content_types(footer: bool) -> String {
    let footer = if footer {
        "<Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/>"
    } else {
        ""
    };
    format!(
        "{XML_DECLARATION}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
         <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
         <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
         <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
         <Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\
         <Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>\
         {footer}</Types>"
    )
}

fn package_relationships() -> String {
    format!(
        "{XML_DECLARATION}<Relationships xmlns=\"{PACKAGE_RELATIONSHIPS_NS}\">\
         <Relationship Id=\"rId1\" Type=\"{RELATIONSHIP_TYPE}/officeDocument\" Target=\"word/document.xml\"/></Relationships>"
    )
}

fn document_relationships(links: &[String], footer: bool) -> String {
    let mut xml = format!(
        "{XML_DECLARATION}<Relationships xmlns=\"{PACKAGE_RELATIONSHIPS_NS}\">\
         <Relationship Id=\"rIdStyles\" Type=\"{RELATIONSHIP_TYPE}/styles\" Target=\"styles.xml\"/>\
         <Relationship Id=\"rIdNumbering\" Type=\"{RELATIONSHIP_TYPE}/numbering\" Target=\"numbering.xml\"/>"
    );
    if footer {
        xml.push_str(&format!("<Relationship Id=\"rIdFooter\" Type=\"{RELATIONSHIP_TYPE}/footer\" Target=\"footer1.xml\"/>"));
    }
    for (index, url) in links.iter().enumerate() {
        xml.push_str(&format!(
            "<Relationship Id=\"rIdLink{index}\" Type=\"{RELATIONSHIP_TYPE}/hyperlink\" Target=\"{}\" TargetMode=\"External\"/>",
            escape_xml(url)
        ));
    }
    xml.push_str("</Relationships>");
    xml
}

fn document_xml(body: &str, page: &PageGeometry) -> String {
    let twips = |mm: f64| (mm * TWIPS_PER_MM).round() as u32;
    let orientation = if page.width_mm > page.height_mm { " w:orient=\"landscape\"" } else { "" };
    let margin = twips(page.margin_mm);
    let footer = if page.page_numbers { "<w:footerReference w:type=\"default\" r:id=\"rIdFooter\"/>" } else { "" };
    format!(
        "{XML_DECLARATION}<w:document xmlns:w=\"{WORD_NS}\" xmlns:r=\"{RELATIONSHIP_NS}\" xmlns:m=\"{MATH_NS}\"><w:body>{body}\
         <w:sectPr>{footer}<w:pgSz w:w=\"{}\" w:h=\"{}\"{orientation}/>\
         <w:pgMar w:top=\"{margin}\" w:right=\"{margin}\" w:bottom=\"{margin}\" w:left=\"{margin}\" w:header=\"{half}\" w:footer=\"{half}\" w:gutter=\"0\"/>\
         </w:sectPr></w:body></w:document>",
        twips(page.width_mm),
        twips(page.height_mm),
        half = margin / 2,
    )
}

fn styles() -> String {
    let text = Rgb::TEXT.hex();
    let muted = Rgb::MUTED.hex();
    let code = Rgb::CODE_BACKGROUND.hex();
    let link = Rgb::LINK.hex();
    let mut xml = format!(
        "{XML_DECLARATION}<w:styles xmlns:w=\"{WORD_NS}\"><w:docDefaults><w:rPrDefault><w:rPr>\
         <w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:eastAsia=\"Arial\" w:cs=\"Arial\"/><w:color w:val=\"{text}\"/>\
         <w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"es-AR\"/></w:rPr></w:rPrDefault>\
         <w:pPrDefault><w:pPr><w:spacing w:after=\"140\" w:line=\"288\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>\
         <w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>\
         <w:style w:type=\"character\" w:default=\"1\" w:styleId=\"DefaultParagraphFont\"><w:name w:val=\"Default Paragraph Font\"/><w:uiPriority w:val=\"1\"/><w:semiHidden/></w:style>"
    );
    let headings = [(44, 360, 120), (34, 300, 100), (28, 240, 80), (24, 200, 60), (22, 200, 60), (22, 200, 60)];
    for (index, (size, before, after)) in headings.iter().enumerate() {
        let level = index + 1;
        let color = if level == 6 { format!("<w:color w:val=\"{muted}\"/>") } else { String::new() };
        xml.push_str(&format!(
            "<w:style w:type=\"paragraph\" w:styleId=\"Heading{level}\"><w:name w:val=\"heading {level}\"/><w:basedOn w:val=\"Normal\"/>\
             <w:next w:val=\"Normal\"/><w:uiPriority w:val=\"9\"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>\
             <w:spacing w:before=\"{before}\" w:after=\"{after}\"/><w:outlineLvl w:val=\"{index}\"/></w:pPr>\
             <w:rPr><w:b/><w:bCs/>{color}<w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size}\"/></w:rPr></w:style>"
        ));
    }
    let code_border = ["top", "left", "bottom", "right"]
        .iter()
        .map(|edge| format!("<w:{edge} w:val=\"single\" w:sz=\"4\" w:space=\"4\" w:color=\"{code}\"/>"))
        .collect::<String>();
    xml.push_str(&format!(
        "<w:style w:type=\"character\" w:styleId=\"Hyperlink\"><w:name w:val=\"Hyperlink\"/><w:basedOn w:val=\"DefaultParagraphFont\"/>\
         <w:uiPriority w:val=\"99\"/><w:unhideWhenUsed/><w:rPr><w:color w:val=\"{link}\"/><w:u w:val=\"single\"/></w:rPr></w:style>\
         <w:style w:type=\"character\" w:customStyle=\"1\" w:styleId=\"NotiaCodeChar\"><w:name w:val=\"Notia Code Char\"/>\
         <w:basedOn w:val=\"DefaultParagraphFont\"/><w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>\
         <w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{code}\"/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:customStyle=\"1\" w:styleId=\"NotiaCode\"><w:name w:val=\"Notia Code\"/><w:basedOn w:val=\"Normal\"/>\
         <w:pPr><w:pBdr>{code_border}</w:pBdr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{code}\"/>\
         <w:spacing w:before=\"60\" w:after=\"200\" w:line=\"240\" w:lineRule=\"auto\"/><w:ind w:left=\"80\" w:right=\"80\"/></w:pPr>\
         <w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/><w:sz w:val=\"19\"/><w:szCs w:val=\"19\"/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:customStyle=\"1\" w:styleId=\"NotiaFormula\"><w:name w:val=\"Notia Formula\"/><w:basedOn w:val=\"Normal\"/>\
         <w:pPr><w:spacing w:before=\"120\" w:after=\"200\"/><w:jc w:val=\"center\"/></w:pPr></w:style></w:styles>"
    ));
    xml
}

fn numbering(ordered_lists: &[(u32, u64)]) -> String {
    let mut xml = format!("{XML_DECLARATION}<w:numbering xmlns:w=\"{WORD_NS}\">");
    for (id, bullet) in [(0, true), (1, false)] {
        xml.push_str(&format!("<w:abstractNum w:abstractNumId=\"{id}\"><w:multiLevelType w:val=\"hybridMultilevel\"/>"));
        for level in 0..9u32 {
            let (format, text) = if bullet {
                ("bullet", BULLETS[level as usize % BULLETS.len()].to_string())
            } else {
                ("decimal", format!("%{}.", level + 1))
            };
            xml.push_str(&format!(
                "<w:lvl w:ilvl=\"{level}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"{format}\"/><w:lvlText w:val=\"{text}\"/>\
                 <w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{}\" w:hanging=\"{MARKER_HANG}\"/></w:pPr>\
                 <w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:hint=\"default\"/></w:rPr></w:lvl>",
                LEVEL_INDENT * (level + 1)
            ));
        }
        xml.push_str("</w:abstractNum>");
    }
    xml.push_str(&format!("<w:num w:numId=\"{BULLET_NUMBERING}\"><w:abstractNumId w:val=\"0\"/></w:num>"));
    for (index, (level, start)) in ordered_lists.iter().enumerate() {
        xml.push_str(&format!(
            "<w:num w:numId=\"{}\"><w:abstractNumId w:val=\"1\"/><w:lvlOverride w:ilvl=\"{level}\"><w:startOverride w:val=\"{start}\"/></w:lvlOverride></w:num>",
            BULLET_NUMBERING + 1 + index as u32
        ));
    }
    xml.push_str("</w:numbering>");
    xml
}

/// Page number, «n / N», centred at the foot of each page.
fn footer() -> String {
    let properties = format!("<w:rPr><w:color w:val=\"{}\"/><w:sz w:val=\"17\"/><w:szCs w:val=\"17\"/></w:rPr>", Rgb::MUTED.hex());
    let field = |instruction: &str| format!("<w:fldSimple w:instr=\" {instruction} \"><w:r>{properties}<w:t>1</w:t></w:r></w:fldSimple>");
    format!(
        "{XML_DECLARATION}<w:ftr xmlns:w=\"{WORD_NS}\" xmlns:r=\"{RELATIONSHIP_NS}\"><w:p><w:pPr><w:jc w:val=\"center\"/></w:pPr>\
         {}<w:r>{properties}<w:t xml:space=\"preserve\"> / </w:t></w:r>{}</w:p></w:ftr>",
        field("PAGE"),
        field("NUMPAGES")
    )
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::super::markdown::parse_markdown;
    use super::*;

    fn parts(markdown: &str, page: &PageGeometry) -> std::collections::BTreeMap<String, String> {
        let bytes = render_docx(&parse_markdown(markdown), page).expect("docx");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("zip");
        let mut parts = std::collections::BTreeMap::new();
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).expect("part");
            let mut xml = String::new();
            file.read_to_string(&mut xml).expect("utf-8");
            parts.insert(file.name().to_string(), xml);
        }
        parts
    }

    fn assert_well_formed(xml: &str) {
        let mut reader = quick_xml::Reader::from_str(xml);
        let mut depth = 0i32;
        loop {
            match reader.read_event().expect("well-formed XML") {
                quick_xml::events::Event::Start(_) => depth += 1,
                quick_xml::events::Event::End(_) => depth -= 1,
                quick_xml::events::Event::Eof => break,
                _ => {}
            }
        }
        assert_eq!(depth, 0);
    }

    const SAMPLE: &str = "# Título\n\nTexto **negrita**, *cursiva*, <u>subrayado</u> y [un enlace](https://example.com).\n\n\
        - uno\n  1. anidado\n- [x] tarea\n\n5. cinco\n6. seis\n\n> cita con $x^2$\n\n$$\n\\frac{a}{b} = \\sum_{i=1}^n i\n$$\n\n\
        | a | b |\n|---|:-:|\n| 1 | 2 |\n\n```\ncodigo  con\tespacios\n```\n\n---";

    #[test]
    fn writes_a_well_formed_package() {
        let parts = parts(SAMPLE, &PageGeometry::default());
        for name in ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml", "word/footer1.xml"] {
            let xml = parts.get(name).unwrap_or_else(|| panic!("missing {name}"));
            assert_well_formed(xml);
        }
    }

    #[test]
    fn writes_formatted_content_instead_of_markdown() {
        let parts = parts(SAMPLE, &PageGeometry::default());
        let document = &parts["word/document.xml"];
        assert!(document.contains("<w:pStyle w:val=\"Heading1\"/>"));
        assert!(document.contains("<w:b/><w:bCs/></w:rPr><w:t xml:space=\"preserve\">negrita</w:t>"));
        assert!(document.contains("<w:u w:val=\"single\"/></w:rPr><w:t xml:space=\"preserve\">subrayado</w:t>"));
        assert!(document.contains("<w:hyperlink r:id=\"rIdLink0\""));
        assert!(document.contains("<w:numPr><w:ilvl w:val=\"1\"/><w:numId w:val=\"2\"/></w:numPr>"));
        assert!(document.contains("☒"));
        assert!(document.contains("<m:oMathPara><m:oMath><m:f>"));
        assert!(document.contains("<m:oMath><m:sSup>"));
        assert!(document.contains("<w:tbl>"));
        assert!(document.contains("<w:tab/>"));
        for markdown in ["**", "# ", "$$", "\\frac", "| a"] {
            assert!(!document.contains(markdown), "{markdown} leaked into the document");
        }
        assert!(parts["word/numbering.xml"].contains("<w:startOverride w:val=\"5\"/>"));
        assert!(parts["word/_rels/document.xml.rels"].contains("Target=\"https://example.com\" TargetMode=\"External\""));
    }

    #[test]
    fn uses_the_page_setup() {
        let page = PageGeometry { width_mm: 297.0, height_mm: 210.0, margin_mm: 12.7, page_numbers: false };
        let parts = parts("Hola", &page);
        let document = &parts["word/document.xml"];
        assert!(document.contains("<w:pgSz w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\"/>"));
        assert!(document.contains("w:top=\"720\""));
        assert!(!document.contains("footerReference"));
        assert!(!parts.contains_key("word/footer1.xml"));
    }
}
