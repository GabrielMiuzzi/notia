//! Addresses of a public space: the URL of each page and published file,
//! and links of a note resolved against the library.

/// Characters a path segment keeps as they are in a URL.
fn is_unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~')
}

fn encode_segment(segment: &str) -> String {
    segment
        .bytes()
        .map(|byte| if is_unreserved(byte) { (byte as char).to_string() } else { format!("%{byte:02X}") })
        .collect()
}

pub(crate) fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn encode_path(path: &str) -> String {
    path.split('/').map(encode_segment).collect::<Vec<_>>().join("/")
}

/// URL of the page of the note at `path` (`Docs/Guía.md` → `/Docs/Gu%C3%ADa`).
pub fn page_url(path: &str) -> String {
    let path = path.strip_suffix(".md").or_else(|| path.strip_suffix(".MD")).unwrap_or(path);
    format!("/{}", encode_path(path))
}

/// URL of a published file (an image of a note).
pub fn file_url(path: &str) -> String {
    format!("/files/{}", encode_path(path))
}

/// The logical path behind a page URL path, with `.md`. `None` when it
/// does not decode or climbs out of the library.
pub fn page_path_of_url(url_path: &str) -> Option<String> {
    let path = url_path.split(['?', '#']).next()?.trim_matches('/');
    let path = percent_decode(path)?;
    if path.is_empty() || path.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..") {
        return None;
    }
    Some(format!("{path}.md"))
}

/// The logical path behind `/files/...`.
pub fn file_path_of_url(url_path: &str) -> Option<String> {
    let rest = url_path.strip_prefix("/files/")?;
    let path = percent_decode(rest.split(['?', '#']).next()?)?;
    (!path.is_empty() && !path.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..")).then_some(path)
}

/// Whether `href` leaves the space for another site.
pub(crate) fn is_external(href: &str) -> bool {
    let lower = href.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

/// Whether `href` names a scheme other than the web ones (`javascript:`,
/// `data:`, `file:`): those links are dropped.
pub(crate) fn is_foreign_scheme(href: &str) -> bool {
    let trimmed = href.trim();
    let scheme_end = trimmed.find(':');
    let path_start = trimmed.find(['/', '?', '#']).unwrap_or(trimmed.len());
    scheme_end.is_some_and(|end| end < path_start) && !is_external(trimmed)
}

/// `href` (relative to the note at `current`, or from the library root
/// when it starts with `/`) as a library path, without its `#fragment`.
pub(crate) fn resolve_relative(current: &str, href: &str) -> Option<(String, Option<String>)> {
    let (target, fragment) = match href.split_once('#') {
        Some((target, fragment)) => (target, Some(fragment.to_string()).filter(|fragment| !fragment.is_empty())),
        None => (href, None),
    };
    let target = percent_decode(target.split('?').next().unwrap_or_default().trim())?.replace('\\', "/");
    if target.is_empty() {
        return None;
    }
    let mut segments: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        current.rsplit_once('/').map_or_else(Vec::new, |(folder, _)| folder.split('/').collect())
    };
    for segment in target.trim_start_matches('/').split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    (!segments.is_empty()).then(|| (segments.join("/"), fragment))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_urls_round_trip_with_accents_spaces_and_signs() {
        let path = "Cursos/programacion/que-es/¿Que es un lenguaje.md";
        let url = page_url(path);
        assert_eq!(url, "/Cursos/programacion/que-es/%C2%BFQue%20es%20un%20lenguaje");
        assert_eq!(page_path_of_url(&url).as_deref(), Some(path));
        assert_eq!(page_path_of_url("/a/../b"), None);
        assert_eq!(file_path_of_url(&file_url("Docs/img/a b.png")).as_deref(), Some("Docs/img/a b.png"));
    }

    #[test]
    fn relative_links_resolve_inside_the_library() {
        assert_eq!(resolve_relative("Docs/guia/uno.md", "dos.md"), Some(("Docs/guia/dos.md".into(), None)));
        assert_eq!(resolve_relative("Docs/guia/uno.md", "../img/a%20b.png"), Some(("Docs/img/a b.png".into(), None)));
        assert_eq!(resolve_relative("Docs/uno.md", "/Otros/x.md#parte"), Some(("Otros/x.md".into(), Some("parte".into()))));
        assert_eq!(resolve_relative("uno.md", "../../x.md"), None);
        assert!(is_foreign_scheme("javascript:alert(1)"));
        assert!(is_foreign_scheme(" data:text/html,x"));
        assert!(!is_foreign_scheme("https://gitbook.com"));
        assert!(!is_foreign_scheme("guia/uno.md"));
        assert!(!is_foreign_scheme("#seccion"));
    }
}
