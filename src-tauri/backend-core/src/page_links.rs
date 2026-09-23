//! `nextPage` / `previousPage` links between notes: reference parsing,
//! resolution relative to the note and frontmatter reads. The adapter walks
//! the chain for cycles and updates the opposite link of each target.

/// Referenced path of a page-link value (`[[path]]`, `[[alias|path]]`, plain
/// path); `None` for empty or `N/A`.
pub fn extract_link_path(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches(['"', '\'']).trim();
    if trimmed.is_empty() || trimmed == "N/A" {
        return None;
    }
    let reference = match trimmed.strip_prefix("[[").and_then(|inner| inner.strip_suffix("]]")) {
        Some(inner) => inner.rsplit('|').next().unwrap_or(inner).trim(),
        None => trimmed,
    };
    (!reference.is_empty()).then(|| reference.to_string())
}

/// Logical path of `reference` seen from the note at `current`: bare names
/// are siblings (with `.md` when there is no extension); references with a
/// folder are library-relative.
pub fn resolve_link_path(reference: &str, current: &str) -> Option<String> {
    let reference = reference.trim().replace('\\', "/");
    if reference.is_empty() || reference.split('/').any(|part| part == "..") {
        return None;
    }
    if reference.contains('/') {
        return Some(reference.trim_start_matches('/').to_string());
    }
    let name = if reference.contains('.') { reference } else { format!("{reference}.md") };
    Some(match current.rsplit_once('/') {
        Some((directory, _)) => format!("{directory}/{name}"),
        None => name,
    })
}

/// Unquoted value of a frontmatter key, if present.
pub fn frontmatter_value(source: &str, key: &str) -> Option<String> {
    let normalized = source.replace("\r\n", "\n");
    let body = normalized.strip_prefix("---\n")?;
    let end = body.find("\n---")?;
    body[..end].lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case(key)
            .then(|| value.trim().trim_matches(['"', '\'']).to_string())
    })
}

pub fn same_path(left: &str, right: &str) -> bool {
    left.replace('\\', "/").eq_ignore_ascii_case(&right.replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_resolves_page_links() {
        assert_eq!(extract_link_path("\"[[alias|6-10]]\"").as_deref(), Some("6-10"));
        assert_eq!(extract_link_path("N/A"), None);
        assert_eq!(resolve_link_path("6-10", "libro/1-5.md").as_deref(), Some("libro/6-10.md"));
        assert_eq!(resolve_link_path("otra/x.md", "libro/1.md").as_deref(), Some("otra/x.md"));
        assert_eq!(resolve_link_path("../x.md", "libro/1.md"), None);
        assert_eq!(
            frontmatter_value("---\nnextPage: \"[[b.md]]\"\n---\n", "nextpage").as_deref(),
            Some("[[b.md]]")
        );
        assert!(same_path("Libro/A.md", "libro/a.md"));
    }
}
