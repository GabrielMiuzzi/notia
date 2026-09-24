//! HTTP/1.1 over a blocking stream: request reading, header helpers and
//! responses. Shared by the Task Manager publication and the headless server.
//! Every response closes the connection (`Connection: close`).

use std::io::{self, Cursor, Read, Write};

use serde_json::Value;
use tungstenite::Error as WebSocketError;

/// Value of a cookie sent by the client.
pub(crate) fn request_cookie<'a>(request: &'a [u8], cookie_name: &str) -> Option<&'a str> {
    let header_end = find_header_end(request)?;
    let headers = std::str::from_utf8(&request[..header_end]).ok()?;
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if !name.eq_ignore_ascii_case("cookie") {
            return None;
        }
        value.split(';').find_map(|cookie| {
            let (name, value) = cookie.trim().split_once('=')?;
            (name == cookie_name).then_some(value)
        })
    })
}

/// Value of a query parameter of the request line, percent-decoded.
pub(crate) fn request_query_param(request: &[u8], name: &str) -> Option<String> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let line = std::str::from_utf8(&request[..line_end]).ok()?;
    let target = line.split_whitespace().nth(1)?;
    let (_, query) = target.split_once('?')?;
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        (percent_decode(key)? == name).then(|| percent_decode(value)).flatten()
    })
}

/// `%XX` and `+` decoding; `None` when the result is not UTF-8.
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
                output.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).ok()
}

pub(crate) const MAX_HTTP_REQUEST_BYTES: usize = 2 * 1024 * 1024;

pub(crate) fn serve_http_redirect(mut stream: std::net::TcpStream) {
    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(status) => {
            let _ = stream.write_all(&text_response(status, "Solicitud HTTP inválida."));
            return;
        }
    };
    let Some((method, path)) = request_line_parts(&request) else {
        let _ = stream.write_all(&text_response("400 Bad Request", "Solicitud inválida."));
        return;
    };
    let Some(host) = request_host(&request) else {
        let _ = stream.write_all(&text_response(
            "400 Bad Request",
            "Abrí esta dirección mediante HTTPS.",
        ));
        return;
    };
    if !is_safe_redirect_host(&host) {
        let _ = stream.write_all(&text_response(
            "400 Bad Request",
            "El host de la dirección no es válido.",
        ));
        return;
    }
    let status = if method == "GET" || method == "HEAD" {
        "308 Permanent Redirect"
    } else {
        "426 Upgrade Required"
    };
    let location = format!("Location: https://{host}{path}");
    let response = response_with_headers(
        status,
        "text/plain; charset=utf-8",
        "Usá HTTPS.".as_bytes(),
        &[&location],
    );
    let _ = stream.write_all(&response);
}

pub(crate) fn read_http_request<S: Read>(stream: &mut S) -> Result<Vec<u8>, &'static str> {
    read_http_request_limited(stream, MAX_HTTP_REQUEST_BYTES)
}

/// Reads one request of at most `max_bytes` (headers and body).
pub(crate) fn read_http_request_limited<S: Read>(stream: &mut S, max_bytes: usize) -> Result<Vec<u8>, &'static str> {
    let mut request = Vec::with_capacity(8192);
    let mut buffer = [0_u8; 8192];
    let mut expected_size = None;
    loop {
        let read = stream.read(&mut buffer).map_err(|_| "400 Bad Request")?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.len() > max_bytes {
            return Err("413 Payload Too Large");
        }
        if expected_size.is_none() {
            if let Some(header_end) = find_header_end(&request) {
                expected_size = Some(header_end + 4 + parse_content_length(&request[..header_end]));
            }
        }
        if expected_size.is_some_and(|size| request.len() >= size) {
            break;
        }
    }
    Ok(request)
}

pub(crate) fn is_websocket_upgrade(request: &[u8]) -> bool {
    let Some(upgrade) = request_header_value(request, "upgrade") else {
        return false;
    };
    let Some(connection) = request_header_value(request, "connection") else {
        return false;
    };
    let Some(version) = request_header_value(request, "sec-websocket-version") else {
        return false;
    };
    request_header_value(request, "sec-websocket-key").is_some()
        && upgrade.eq_ignore_ascii_case("websocket")
        && connection
            .split(',')
            .any(|value| value.trim().eq_ignore_ascii_case("upgrade"))
        && version.trim() == "13"
        && request_origin_is_expected(request)
}

pub(crate) fn request_origin_is_expected(request: &[u8]) -> bool {
    let Some(origin) = request_header_value(request, "origin") else {
        return false;
    };
    request_host(request).is_some_and(|host| {
        origin
            .trim_end_matches('/')
            .eq_ignore_ascii_case(&format!("https://{host}"))
    })
}

pub(crate) struct PrefixedStream<S> {
    prefix: Cursor<Vec<u8>>,
    stream: S,
}

impl<S> PrefixedStream<S> {
    pub(crate) fn new(prefix: Vec<u8>, stream: S) -> Self {
        Self {
            prefix: Cursor::new(prefix),
            stream,
        }
    }
}

impl<S: Read> Read for PrefixedStream<S> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.prefix.read(buffer)?;
        if read > 0 {
            return Ok(read);
        }
        self.stream.read(buffer)
    }
}

impl<S: Write> Write for PrefixedStream<S> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.stream.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

pub(crate) fn websocket_timeout(error: &WebSocketError) -> bool {
    matches!(
        error,
        WebSocketError::Io(io_error)
            if matches!(io_error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut)
    )
}

pub(crate) fn request_line_parts(request: &[u8]) -> Option<(&str, String)> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let line = std::str::from_utf8(&request[..line_end]).ok()?;
    let mut parts = line.split_whitespace();
    Some((parts.next()?, parts.next()?.split('?').next()?.to_string()))
}

pub(crate) fn request_host(request: &[u8]) -> Option<String> {
    let header_end = find_header_end(request)?;
    let headers = std::str::from_utf8(&request[..header_end]).ok()?;
    let host = headers.lines().skip(1).find_map(|line| {
        line.split_once(':')
            .and_then(|(name, value)| name.eq_ignore_ascii_case("host").then(|| value.trim()))
    })?;
    (!host.is_empty()
        && host.len() <= 255
        && host.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | ':' | '[' | ']' | '-')
        }))
    .then(|| host.to_string())
}

pub(crate) fn is_safe_redirect_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    let host_without_port = if host.starts_with('[') {
        let Some(closing_bracket) = host.find(']') else {
            return false;
        };
        let remainder = &host[closing_bracket + 1..];
        if !remainder.is_empty() {
            let Some(port) = remainder.strip_prefix(':') else {
                return false;
            };
            if port.parse::<u16>().is_err() {
                return false;
            }
        }
        &host[1..closing_bracket]
    } else if host.matches(':').count() == 1 {
        let Some((host_without_port, port)) = host.split_once(':') else {
            return false;
        };
        if port.parse::<u16>().is_err() {
            return false;
        }
        host_without_port
    } else {
        if host.contains(':') {
            return false;
        }
        host
    };

    host_without_port.eq_ignore_ascii_case("localhost")
        || host_without_port.parse::<std::net::IpAddr>().is_ok()
}

pub(crate) fn request_header_value(request: &[u8], header_name: &str) -> Option<String> {
    let header_end = find_header_end(request)?;
    std::str::from_utf8(&request[..header_end])
        .ok()?
        .lines()
        .skip(1)
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case(header_name)
                    .then(|| value.trim().to_string())
            })
        })
}

pub(crate) fn find_header_end(request: &[u8]) -> Option<usize> {
    request.windows(4).position(|window| window == b"\r\n\r\n")
}

pub(crate) fn parse_content_length(headers: &[u8]) -> usize {
    String::from_utf8_lossy(headers)
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
        })
        .unwrap_or(0)
}

pub(crate) fn http_body(request: &[u8]) -> &[u8] {
    find_header_end(request)
        .map(|index| &request[index + 4..])
        .unwrap_or_default()
}

pub(crate) fn json_response(status: &str, value: Value) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    response(status, "application/json; charset=utf-8", &body)
}

pub(crate) fn json_response_with_headers(status: &str, value: Value, headers: &[&str]) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    response_with_headers(status, "application/json; charset=utf-8", &body, headers)
}

pub(crate) fn json_error(message: &str) -> Vec<u8> {
    json_response("400 Bad Request", serde_json::json!({ "error": message }))
}

pub(crate) fn text_response(status: &str, message: &str) -> Vec<u8> {
    response(status, "text/plain; charset=utf-8", message.as_bytes())
}

pub(crate) fn response(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    response_with_headers(status, content_type, body, &[])
}

pub(crate) fn response_with_headers(
    status: &str,
    content_type: &str,
    body: &[u8],
    extra_headers: &[&str],
) -> Vec<u8> {
    let extra_headers = if extra_headers.is_empty() {
        String::new()
    } else {
        format!("{}\r\n", extra_headers.join("\r\n"))
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n{extra_headers}Connection: close\r\n\r\n",
        body.len()
    );
    let mut output = header.into_bytes();
    output.extend_from_slice(body);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_percent_encoded_query_parameters() {
        let request = b"GET /api/file?path=C%3A%2FNotas%2Ffoto%201.png&x=1 HTTP/1.1\r\nHost: h\r\n\r\n";
        assert_eq!(request_query_param(request, "path").as_deref(), Some("C:/Notas/foto 1.png"));
        assert_eq!(request_query_param(request, "x").as_deref(), Some("1"));
        assert_eq!(request_query_param(request, "y"), None);
        assert_eq!(request_query_param(b"GET /api/file?path=%ZZ HTTP/1.1\r\n\r\n", "path"), None);
    }
}
