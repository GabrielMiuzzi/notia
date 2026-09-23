use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::error::BackendError;

pub const MAX_UNIQUE_WEB_SEARCHES: usize = 6;
const MAX_QUERY_CHARS: usize = 240;
const MAX_RESULTS: u32 = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchRequest {
    pub query: String,
    pub max_results: u32,
    pub freshness: String,
    pub domains: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebSearchReservation {
    New,
    Duplicate,
    LimitReached,
}

#[derive(Debug, Default)]
pub struct WebSearchTracker {
    keys: HashSet<String>,
}

impl WebSearchTracker {
    pub fn reserve(&mut self, request: &WebSearchRequest) -> WebSearchReservation {
        let key = web_search_key(request);
        if self.keys.contains(&key) {
            return WebSearchReservation::Duplicate;
        }
        if self.keys.len() >= MAX_UNIQUE_WEB_SEARCHES {
            return WebSearchReservation::LimitReached;
        }
        self.keys.insert(key);
        WebSearchReservation::New
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }
}

pub fn sanitize_web_search_request(
    query: &str,
    max_results: Option<u32>,
    freshness: Option<&str>,
    domains: &[String],
) -> Result<WebSearchRequest, BackendError> {
    let normalized_query = query
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized_query.is_empty() || normalized_query.chars().count() > MAX_QUERY_CHARS {
        return Err(BackendError::invalid_input(
            "La consulta de búsqueda web no es válida.",
        ));
    }
    let lower = normalized_query.to_lowercase();
    let private_markers = [
        "bearer ",
        "api key",
        "api_key",
        "access_token",
        "password",
        "secret",
        "cookie:",
        "mi nombre",
        "me llamo",
        "mi correo",
        "mi sueldo",
        "cuenta bancaria",
        "tarjeta de credito",
    ];
    if lower.contains('@') || private_markers.iter().any(|marker| lower.contains(marker)) {
        return Err(BackendError::invalid_input(
            "La búsqueda web fue bloqueada porque la consulta no es pública y segura.",
        ));
    }
    let domains = domains
        .iter()
        .map(|domain| domain.trim().to_lowercase())
        .filter(|domain| !domain.is_empty())
        .collect::<HashSet<_>>();
    if domains.len() > 5 || domains.iter().any(|domain| !valid_domain(domain)) {
        return Err(BackendError::invalid_input(
            "Los dominios de búsqueda web no son válidos.",
        ));
    }
    let mut domains = domains.into_iter().collect::<Vec<_>>();
    domains.sort();
    Ok(WebSearchRequest {
        query: normalized_query,
        max_results: max_results.unwrap_or(5).clamp(1, MAX_RESULTS),
        freshness: match freshness.unwrap_or("any") {
            "day" | "week" | "month" | "year" | "any" => freshness.unwrap_or("any").to_string(),
            _ => {
                return Err(BackendError::invalid_input(
                    "La frescura de búsqueda no es válida.",
                ))
            }
        },
        domains,
    })
}

fn valid_domain(domain: &str) -> bool {
    domain.split('.').count() >= 2
        && domain.split('.').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
        })
        && domain
            .rsplit('.')
            .next()
            .is_some_and(|part| part.len() >= 2)
}

pub fn web_search_key(request: &WebSearchRequest) -> String {
    format!(
        "{}|{}|{}|{}",
        request.query.to_lowercase(),
        request.max_results,
        request.freshness,
        request.domains.join(",")
    )
}

pub fn normalize_http_url(value: &str) -> Option<String> {
    let trimmed = value
        .trim()
        .trim_end_matches(|character: char| ".,!?;:)".contains(character));
    let scheme_end = trimmed.find("://")?;
    let scheme = &trimmed[..scheme_end];
    if !matches!(scheme, "http" | "https") || trimmed[scheme_end + 3..].is_empty() {
        return None;
    }
    if trimmed.contains('@') || trimmed.chars().any(char::is_control) {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn validate_citations(
    answer: &str,
    returned_urls: &HashSet<String>,
) -> Result<(), BackendError> {
    let urls = answer
        .split_whitespace()
        .filter_map(normalize_http_url)
        .collect::<Vec<_>>();
    if urls.iter().any(|url| !returned_urls.contains(url)) {
        return Err(BackendError::invalid_input(
            "La respuesta contiene una cita web que no fue devuelta por la búsqueda.",
        ));
    }
    Ok(())
}

/// Replacement for a URL cited without having been returned by `search_web`.
pub const UNVERIFIED_CITATION: &str = "[enlace no verificado]";

fn citation_key(url: &str) -> String {
    url.trim_end_matches('/').to_ascii_lowercase()
}

/// Replaces every http(s) URL in `answer` that was not returned by a web
/// search of the same request. URLs inside Markdown links are handled too:
/// the delimiter set stops at `)`, `]`, `>`, quotes and whitespace.
pub fn strip_unverified_citations(answer: &str, returned_urls: &HashSet<String>) -> String {
    let allowed = returned_urls
        .iter()
        .map(|url| citation_key(url))
        .collect::<HashSet<_>>();
    let mut output = String::with_capacity(answer.len());
    let mut rest = answer;
    while let Some(start) = ["https://", "http://"]
        .iter()
        .filter_map(|scheme| rest.find(scheme))
        .min()
    {
        output.push_str(&rest[..start]);
        let candidate = &rest[start..];
        let end = candidate
            .find(|character: char| {
                character.is_whitespace() || matches!(character, ')' | ']' | '>' | '<' | '"' | '\'')
            })
            .unwrap_or(candidate.len());
        let raw = &candidate[..end];
        let url = raw.trim_end_matches(|character: char| ".,!?;:".contains(character));
        let trailing = &raw[url.len()..];
        if allowed.contains(&citation_key(url)) {
            output.push_str(url);
        } else {
            output.push_str(UNVERIFIED_CITATION);
        }
        output.push_str(trailing);
        rest = &candidate[end..];
    }
    output.push_str(rest);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_only_urls_the_search_did_not_return() {
        let returned = HashSet::from(["https://fuente.test/nota".to_string()]);
        let answer = "Ver [fuente](https://fuente.test/nota/) y https://inventada.test/x.";
        assert_eq!(
            strip_unverified_citations(answer, &returned),
            "Ver [fuente](https://fuente.test/nota/) y [enlace no verificado]."
        );
    }

    #[test]
    fn sanitizes_and_deduplicates_public_queries() {
        let request = sanitize_web_search_request("  Rust\nrelease notes ", Some(99), None, &[])
            .expect("query is public");
        assert_eq!(request.max_results, 10);
        let mut tracker = WebSearchTracker::default();
        assert_eq!(tracker.reserve(&request), WebSearchReservation::New);
        assert_eq!(tracker.reserve(&request), WebSearchReservation::Duplicate);
    }

    #[test]
    fn blocks_private_queries_and_limits_unique_searches() {
        assert!(
            sanitize_web_search_request("mi correo es user@example.com", None, None, &[]).is_err()
        );
        let mut tracker = WebSearchTracker::default();
        for index in 0..MAX_UNIQUE_WEB_SEARCHES {
            let request =
                sanitize_web_search_request(&format!("rust release {index}"), None, None, &[])
                    .expect("query");
            assert_eq!(tracker.reserve(&request), WebSearchReservation::New);
        }
        let request =
            sanitize_web_search_request("rust release extra", None, None, &[]).expect("query");
        assert_eq!(
            tracker.reserve(&request),
            WebSearchReservation::LimitReached
        );
    }

    #[test]
    fn accepts_only_returned_http_citations() {
        let returned = ["https://rust-lang.org/releases".to_string()]
            .into_iter()
            .collect();
        assert!(validate_citations("Fuente https://rust-lang.org/releases", &returned).is_ok());
        assert!(validate_citations("Fuente https://example.com", &returned).is_err());
    }
}
