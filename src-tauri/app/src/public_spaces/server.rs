//! The HTTP servers of the public spaces: one listener per space on its
//! own port, each in its own thread with its own connection limit, so a
//! space never depends on another. Plain HTTP and read-only: the site,
//! its assets, the JSON of the space, its pages and search, its images and
//! the frame that draws XGraph boards.

use std::collections::HashMap;
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::backend::BackendError;
use crate::host::{AppHandle, Manager};
use crate::server::http::{json_response, read_http_request_limited, request_line_parts, request_query_param, response_with_headers, text_response};
use crate::server::rate::RateWindows;

use super::PublicSpacesState;

pub(super) const AVAILABLE: bool = true;
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(150);
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONNECTIONS: usize = 64;
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const REQUESTS_PER_MINUTE: usize = 600;
const SITE_ENTRY: &str = "public-space.html";
/// The page runs only its own scripts; images may come from the web.
const PAGE_SECURITY: &str = "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const XGRAPH_FRAME_ENTRY: &str = "public-space-xgraph.html";
/// An XGraph board runs the note's JavaScript, as in the editor. The page
/// opens this frame sandboxed without its origin, so the board cannot reach
/// the page, its storage or the network; it only lives inside the site.
const XGRAPH_FRAME_SECURITY: &str = "Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
/// The XGraph frame has no origin of its own, so it loads the site's modules
/// as another origin would. They are the same files every visitor gets.
const ASSET_SHARING: &str = "Access-Control-Allow-Origin: *";

pub(crate) struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
}

struct Server {
    app: AppHandle,
    id: String,
    stop: Arc<AtomicBool>,
    connections: AtomicUsize,
    rate: Mutex<RateWindows>,
}

/// Ids of the spaces whose server is listening.
pub(super) fn listening(app: &AppHandle) -> Vec<String> {
    app.state::<PublicSpacesState>().servers.lock().map(|servers| servers.keys().cloned().collect()).unwrap_or_default()
}

/// Starts, restarts (other port) or stops each server so it follows the
/// saved spaces. A space whose port is busy keeps the error for Settings.
pub(super) fn reconfigure(app: &AppHandle) {
    let wanted: HashMap<String, u16> = super::stored_spaces(app).into_iter().filter(|space| space.enabled).map(|space| (space.id, space.port)).collect();
    let state = app.state::<PublicSpacesState>();
    let mut servers = state.servers.lock().unwrap_or_else(|error| error.into_inner());
    servers.retain(|id, running| {
        let keep = wanted.get(id) == Some(&running.port);
        if !keep {
            running.stop.store(true, Ordering::SeqCst);
        }
        keep
    });
    if let Ok(mut errors) = state.errors.lock() {
        errors.retain(|id, _| wanted.contains_key(id));
    }
    for (id, port) in wanted {
        if servers.contains_key(&id) {
            continue;
        }
        match start(app, &id, port) {
            Ok(running) => {
                super::remember_error(app, &id, None);
                servers.insert(id, running);
            }
            Err(message) => {
                log::error!("[notia:public-spaces] a space did not start on port {port}");
                super::remember_error(app, &id, Some(message));
            }
        }
    }
}

fn start(app: &AppHandle, id: &str, port: u16) -> Result<Running, String> {
    // The previous listener of this port may still be closing.
    let mut bound = None;
    for _ in 0..10 {
        match TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port))) {
            Ok(listener) => {
                bound = Some(listener);
                break;
            }
            Err(_) => std::thread::sleep(ACCEPT_POLL_INTERVAL),
        }
    }
    let listener = bound.ok_or_else(|| format!("El puerto {port} está en uso por otro programa."))?;
    let stop = Arc::new(AtomicBool::new(false));
    let server = Arc::new(Server { app: app.clone(), id: id.to_string(), stop: Arc::clone(&stop), connections: AtomicUsize::new(0), rate: Mutex::new(RateWindows::default()) });
    std::thread::Builder::new()
        .name(format!("notia-public-space-{port}"))
        .spawn(move || run(listener, server))
        .map_err(|_| "No se pudo iniciar el servidor del espacio.".to_string())?;
    Ok(Running { port, stop })
}

fn run(listener: TcpListener, server: Arc<Server>) {
    let _ = listener.set_nonblocking(true);
    while !server.stop.load(Ordering::SeqCst) {
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(ACCEPT_POLL_INTERVAL);
                continue;
            }
            Err(_) => continue,
        };
        let _ = stream.set_nonblocking(false);
        if server.connections.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
            server.connections.fetch_sub(1, Ordering::SeqCst);
            continue;
        }
        let spawned = std::thread::Builder::new().name("notia-public-space-connection".into()).spawn({
            let server = Arc::clone(&server);
            move || {
                serve(stream, &server);
                server.connections.fetch_sub(1, Ordering::SeqCst);
            }
        });
        if spawned.is_err() {
            server.connections.fetch_sub(1, Ordering::SeqCst);
        }
    }
}

fn serve(mut stream: TcpStream, server: &Server) {
    let _ = stream.set_read_timeout(Some(REQUEST_READ_TIMEOUT));
    let peer = stream.peer_addr().map(|address| address.ip().to_string()).unwrap_or_default();
    let allowed = server.rate.lock().map(|mut rate| rate.allow(peer, REQUESTS_PER_MINUTE, Duration::from_secs(60))).unwrap_or(false);
    let reply = if !allowed {
        text_response("429 Too Many Requests", "Demasiadas solicitudes. Probá de nuevo en un minuto.")
    } else {
        match read_http_request_limited(&mut stream, MAX_REQUEST_BYTES) {
            Ok(request) => route(server, &request),
            Err(_) => text_response("400 Bad Request", "Solicitud inválida."),
        }
    };
    let _ = stream.write_all(&reply);
    let _ = stream.flush();
}

fn not_found() -> Vec<u8> {
    json_response("404 Not Found", serde_json::json!({ "error": "Esa página no está publicada." }))
}

fn route(server: &Server, request: &[u8]) -> Vec<u8> {
    let Some((method, path)) = request_line_parts(request) else {
        return text_response("400 Bad Request", "Solicitud inválida.");
    };
    if method != "GET" {
        return response_with_headers("405 Method Not Allowed", "text/plain; charset=utf-8", "Este sitio es de solo lectura.".as_bytes(), &["Allow: GET"]);
    }
    if let Some(asset) = path.strip_prefix("/assets/") {
        return serve_asset(&server.app, &format!("assets/{asset}"));
    }
    if path == "/favicon.ico" {
        return text_response("404 Not Found", "No existe.");
    }
    if path == "/xgraph-frame" {
        return serve_xgraph_frame(&server.app);
    }
    let api = path.starts_with("/api/") || path.starts_with("/files/");
    if !api {
        return serve_site(&server.app);
    }
    let snapshot = match super::snapshot(&server.app, &server.id) {
        Ok(snapshot) => snapshot,
        Err(_) => return json_response("503 Service Unavailable", serde_json::json!({ "error": "El espacio no está disponible." })),
    };
    match path.as_str() {
        "/api/space" => json_response("200 OK", snapshot.site.space_view()),
        "/api/page" => match request_query_param(request, "path").and_then(|url| snapshot.site.page_view(&url)) {
            Some(page) => json_response("200 OK", page),
            None => not_found(),
        },
        "/api/search" => json_response("200 OK", snapshot.site.search_view(&request_query_param(request, "q").unwrap_or_default())),
        files if files.starts_with("/files/") => match super::file_bytes(&server.app, &snapshot, files) {
            // An SVG opened by itself runs no script of its own.
            Some((bytes, mime)) => response_with_headers("200 OK", mime, &bytes, &["Content-Security-Policy: sandbox"]),
            None => text_response("404 Not Found", "No existe."),
        },
        _ => not_found(),
    }
}

/// A frontend file of the site. Debug builds read the current `dist/` on
/// disk (kept up to date by the development script); release builds serve
/// the files embedded in the program.
fn asset(app: &AppHandle, relative_path: &str) -> Option<(Vec<u8>, String)> {
    #[cfg(debug_assertions)]
    {
        let path = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/..")).join("..").join("dist").join(relative_path);
        if let Ok(bytes) = std::fs::read(&path) {
            return Some((bytes, mime_type(relative_path).to_string()));
        }
    }
    app.asset_resolver().get(relative_path.to_string()).map(|asset| (asset.bytes().to_vec(), asset.mime_type().to_string()))
}

#[cfg_attr(not(debug_assertions), allow(dead_code))]
fn mime_type(relative_path: &str) -> &'static str {
    match relative_path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn serve_asset(app: &AppHandle, relative_path: &str) -> Vec<u8> {
    if relative_path.contains("..") {
        return text_response("404 Not Found", "No existe.");
    }
    match asset(app, relative_path) {
        Some((bytes, mime)) => response_with_headers("200 OK", &mime, &bytes, &[ASSET_SHARING]),
        None => text_response("404 Not Found", "No existe."),
    }
}

fn serve_xgraph_frame(app: &AppHandle) -> Vec<u8> {
    match asset(app, XGRAPH_FRAME_ENTRY) {
        Some((bytes, _)) => response_with_headers("200 OK", "text/html; charset=utf-8", &bytes, &[XGRAPH_FRAME_SECURITY]),
        None => text_response("503 Service Unavailable", "Los recursos del sitio público no están disponibles."),
    }
}

fn serve_site(app: &AppHandle) -> Vec<u8> {
    match asset(app, SITE_ENTRY) {
        Some((bytes, _)) => response_with_headers("200 OK", "text/html; charset=utf-8", &bytes, &[PAGE_SECURITY]),
        None => text_response("503 Service Unavailable", "Los recursos del sitio público no están disponibles."),
    }
}

/// The address other devices of the network use.
pub(super) fn url(port: u16) -> String {
    format!("http://{}:{port}/", crate::server::network::local_network_ip())
}

pub(super) fn open_in_browser(url: &str) -> Result<(), BackendError> {
    let unavailable = || BackendError::new(crate::backend::BackendErrorCode::Unsupported, "No se pudo abrir el navegador predeterminado.", true);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn().map(|_| ()).map_err(|_| unavailable())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|_| unavailable())
    }
}
