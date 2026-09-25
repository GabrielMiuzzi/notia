//! Headless mode: `notia --headless` runs the application without a window
//! and serves it over HTTPS + WebSocket to remote clients on the network.
//!
//! Routes:
//! - `GET /api/health`: liveness and protocol version (public).
//! - `POST /api/auth/login` `{ password }`, `POST /api/auth/logout`,
//!   `GET /api/session`: owner session in an `HttpOnly` cookie.
//! - `GET /api/capabilities`: commands a remote client may call.
//! - `POST /api/invoke` `{ command, args }`: runs a command of the registry
//!   and answers `{ result }` or `{ error }` (the backend error as is).
//! - `GET /api/events[?since=N]` (WebSocket): every event of the
//!   application as `{ seq, event, payload }`, first those after `N` the
//!   client missed (or `notia:events-lost` when they are no longer kept).
//! - Anything else: files of the interface (`--static-dir`), falling back to
//!   `index.html` for the routes of the single-page application.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rand::RngCore;
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use serde_json::Value;
use tungstenite::{accept_with_config, protocol::WebSocketConfig, Message};

use super::assets::DirectoryAssets;
use super::events::EventHub;
use super::http::{
    http_body, is_websocket_upgrade, json_response, json_response_with_headers, read_http_request_limited,
    request_cookie, request_line_parts, request_origin_is_expected, request_query_param, response,
    response_with_headers, serve_http_redirect,
    text_response, websocket_timeout, PrefixedStream,
};
use super::rate::RateWindows;
use super::{network, owner, tls};
use crate::host::plugin::PluginApi;
use crate::host::{AppContext, AppPaths, AssetSource, DataDirLock, HostPorts};
use crate::registry::{dispatch_app_invoke, is_remote_command, Dispatch, COMMAND_NAMES, LOCAL_ONLY_COMMANDS};

/// Identifier of the application; the headless server uses the same data
/// folder the window uses.
const APP_IDENTIFIER: &str = "com.gabriel.notia";
pub const DEFAULT_PORT: u16 = 52480;
const PROTOCOL_VERSION: u16 = 1;
const SESSION_COOKIE: &str = "notia_session";
const SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_SESSIONS: usize = 64;
const MAX_CONNECTIONS: usize = 128;
/// Chat attachments travel inside commands, so requests may be large.
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_EVENT_CLIENT_MESSAGE_BYTES: usize = 64 * 1024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(50);
const EVENT_PING_INTERVAL: Duration = Duration::from_secs(30);
/// Largest library file served to the interface (images, attachments).
const MAX_LIBRARY_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// Policy of the interface pages: the same the app window uses, with the
/// server origin for requests and WebSocket, and no framing by other sites.
/// Inline and evaluated scripts are needed by XGraph and the editors.
const INTERFACE_CONTENT_SECURITY_POLICY: &str = "Content-Security-Policy: default-src 'self'; \
    script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
    img-src 'self' data: blob: https:; media-src 'self' data: blob:; font-src 'self' data:; \
    worker-src 'self' blob:; connect-src 'self'; frame-src 'self' blob: data:; object-src 'none'; \
    base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
/// Label of the "window" remote clients act from.
const REMOTE_WINDOW_LABEL: &str = "remote";
const OWNER_PASSWORD_VARIABLE: &str = "NOTIA_OWNER_PASSWORD";

const USAGE: &str = "Uso: notia --headless [opciones]

  --data-dir <carpeta>      Datos de Notia (por defecto, los de la aplicación).
  --resource-dir <carpeta>  Recursos (modelos de voz, runtimes). Por defecto, la carpeta del ejecutable.
  --static-dir <carpeta>    Interfaz compilada (dist) para los clientes remotos.
  --bind <dirección:puerto> Dirección de escucha (por defecto 0.0.0.0:52480).
  --set-owner-password      Guarda la contraseña del dueño y termina. La lee de
                            NOTIA_OWNER_PASSWORD o de la entrada estándar.
  --add-library <carpeta>   Agrega una carpeta de este equipo como biblioteca y
                            termina (la opción se puede repetir).";

/// Whether the command line asks for the headless mode.
pub fn requested(mut args: impl Iterator<Item = String>) -> bool {
    args.any(|argument| argument == "--headless")
}

#[derive(Debug, Clone, PartialEq)]
struct Options {
    data_dir: PathBuf,
    resource_dir: Option<PathBuf>,
    static_dir: Option<PathBuf>,
    bind: SocketAddr,
    set_owner_password: bool,
    add_libraries: Vec<PathBuf>,
}

fn default_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")));
    base.map(|base| base.join(APP_IDENTIFIER))
}

fn executable_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

fn parse_options(args: &[String], default_data: Option<PathBuf>, executable: Option<PathBuf>) -> Result<Options, String> {
    let mut data_dir = None;
    let mut resource_dir = None;
    let mut static_dir = None;
    let mut bind = SocketAddr::from(([0, 0, 0, 0], DEFAULT_PORT));
    let mut set_owner_password = false;
    let mut add_libraries = Vec::new();
    let mut arguments = args.iter();
    while let Some(argument) = arguments.next() {
        let (name, inline) = match argument.split_once('=') {
            Some((name, value)) => (name, Some(value.to_string())),
            None => (argument.as_str(), None),
        };
        let mut value = || {
            inline
                .clone()
                .or_else(|| arguments.next().cloned())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("Falta el valor de {name}."))
        };
        match name {
            "--headless" => {}
            "--set-owner-password" => set_owner_password = true,
            "--data-dir" => data_dir = Some(PathBuf::from(value()?)),
            "--resource-dir" => resource_dir = Some(PathBuf::from(value()?)),
            "--static-dir" => static_dir = Some(PathBuf::from(value()?)),
            "--add-library" => add_libraries.push(PathBuf::from(value()?)),
            "--bind" => {
                bind = value()?
                    .parse()
                    .map_err(|_| "--bind espera dirección:puerto, por ejemplo 0.0.0.0:52480.".to_string())?
            }
            other => return Err(format!("Opción desconocida: {other}.")),
        }
    }
    let data_dir = data_dir
        .or(default_data)
        .ok_or_else(|| "No se pudo determinar la carpeta de datos; indicá --data-dir.".to_string())?;
    let resource_dir = resource_dir.or_else(|| executable.clone());
    let static_dir = static_dir.or_else(|| executable.map(|dir| dir.join("dist")).filter(|dir| dir.is_dir()));
    Ok(Options { data_dir, resource_dir, static_dir, bind, set_owner_password, add_libraries })
}

/// Runs the headless mode and returns the process exit code.
pub fn run(args: Vec<String>) -> i32 {
    attach_parent_console();
    if args.iter().any(|argument| argument == "--help" || argument == "-h") {
        println!("{USAGE}");
        return 0;
    }
    let options = match parse_options(&args, default_data_dir(), executable_dir()) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}\n\n{USAGE}");
            return 2;
        }
    };
    let server_dir = options.data_dir.join("headless-server");
    if options.set_owner_password {
        return store_owner_password(&server_dir);
    }
    if !options.add_libraries.is_empty() {
        return add_libraries(&options);
    }
    if !owner::has_owner_password(&server_dir) {
        eprintln!("El servidor no tiene contraseña de dueño. Definila con: notia --headless --set-owner-password");
        return 2;
    }
    match serve(options, server_dir) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn store_owner_password(server_dir: &Path) -> i32 {
    let password = match std::env::var(OWNER_PASSWORD_VARIABLE) {
        Ok(password) => password,
        Err(_) => {
            println!("Contraseña del dueño (entre 8 y 256 caracteres):");
            let mut line = String::new();
            if std::io::stdin().read_line(&mut line).is_err() {
                eprintln!("No se pudo leer la contraseña.");
                return 1;
            }
            line.trim_end_matches(['\r', '\n']).to_string()
        }
    };
    match owner::set_owner_password(server_dir, &password) {
        Ok(()) => {
            println!("Contraseña guardada.");
            0
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

/// Registers local folders as libraries, with the data the server and the
/// window use; neither may be running meanwhile (the data folder lock).
fn add_libraries(options: &Options) -> i32 {
    let _lock = match DataDirLock::acquire(&options.data_dir) {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let app = crate::create_app(
        AppPaths::new(Some(options.data_dir.clone()), options.resource_dir.clone()),
        HostPorts::default(),
    );
    crate::library_registry::load_persisted_bindings(&app);
    let mut code = 0;
    for folder in &options.add_libraries {
        match crate::library_catalog::add_desktop_library(&app, folder) {
            Ok(library) => println!("Biblioteca «{}» lista ({}).", library.name, library.path),
            Err(error) => {
                eprintln!("{}: {}", folder.display(), error.message);
                code = 1;
            }
        }
    }
    code
}

fn serve(options: Options, server_dir: PathBuf) -> Result<(), String> {
    let lock = DataDirLock::acquire(&options.data_dir)?;
    let tls = tls::server_config(&server_dir.join("tls"))?;
    let listener = TcpListener::bind(options.bind)
        .map_err(|_| format!("No se pudo escuchar en {}.", options.bind))?;
    let port = listener.local_addr().map(|address| address.port()).unwrap_or(options.bind.port());

    let hub = Arc::new(EventHub::default());
    let assets = options
        .static_dir
        .clone()
        .map(|dir| Arc::new(DirectoryAssets::new(dir)) as Arc<dyn AssetSource>);
    let app = crate::create_app(
        AppPaths::new(Some(options.data_dir.clone()), options.resource_dir.clone()),
        HostPorts { events: Some(hub.clone()), assets: assets.clone(), dialogs: None },
    );
    for hook in crate::startup_hooks() {
        let name = hook.name();
        if let Err(error) = hook.run_setup(&app, PluginApi::new(None)) {
            log::error!("[notia:headless] startup hook {name} failed: {error}");
        }
    }

    let server = Arc::new(HeadlessServer {
        app,
        hub,
        assets,
        server_dir,
        sessions: Mutex::new(HashMap::new()),
        rates: Mutex::new(RateWindows::default()),
        connections: AtomicUsize::new(0),
        _lock: lock,
    });
    println!("Notia headless escuchando en https://{}:{port}/", network::local_network_ip());
    if server.assets.is_none() {
        println!("Sin interfaz: indicá --static-dir para servir la aplicación web.");
    }
    for stream in listener.incoming().flatten() {
        if server.connections.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
            server.connections.fetch_sub(1, Ordering::SeqCst);
            continue;
        }
        let server = Arc::clone(&server);
        let tls = Arc::clone(&tls);
        let spawned = std::thread::Builder::new().name("notia-headless-connection".into()).spawn({
            let server = Arc::clone(&server);
            move || {
                serve_connection(stream, &server, tls);
                server.connections.fetch_sub(1, Ordering::SeqCst);
            }
        });
        if spawned.is_err() {
            server.connections.fetch_sub(1, Ordering::SeqCst);
        }
    }
    Ok(())
}

struct HeadlessServer {
    app: AppContext,
    hub: Arc<EventHub>,
    assets: Option<Arc<dyn AssetSource>>,
    server_dir: PathBuf,
    sessions: Mutex<HashMap<String, Instant>>,
    rates: Mutex<RateWindows>,
    connections: AtomicUsize,
    _lock: DataDirLock,
}

impl HeadlessServer {
    fn allow(&self, key: String, limit: usize) -> bool {
        self.rates
            .lock()
            .is_ok_and(|mut rates| rates.allow(key, limit, Duration::from_secs(60)))
    }

    fn session_active(&self, token: &str) -> bool {
        let Ok(mut sessions) = self.sessions.lock() else {
            return false;
        };
        match sessions.get(token) {
            Some(expires) if *expires > Instant::now() => true,
            Some(_) => {
                sessions.remove(token);
                false
            }
            None => false,
        }
    }

    fn open_session(&self) -> Option<String> {
        let mut bytes = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let mut sessions = self.sessions.lock().ok()?;
        let now = Instant::now();
        sessions.retain(|_, expires| *expires > now);
        if sessions.len() >= MAX_SESSIONS {
            let oldest = sessions.iter().min_by_key(|(_, expires)| **expires).map(|(token, _)| token.clone())?;
            sessions.remove(&oldest);
        }
        sessions.insert(token.clone(), now + SESSION_TTL);
        Some(token)
    }

    fn close_session(&self, token: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(token);
        }
    }
}

fn serve_connection(stream: TcpStream, server: &HeadlessServer, tls: Arc<ServerConfig>) {
    let _ = stream.set_read_timeout(Some(REQUEST_READ_TIMEOUT));
    let peer = stream.peer_addr().map(|address| address.ip().to_string()).unwrap_or_else(|_| "unknown".into());
    let mut first_byte = [0_u8; 1];
    let is_tls = matches!(stream.peek(&mut first_byte), Ok(1)) && first_byte[0] == 22;
    if !is_tls {
        serve_http_redirect(stream);
        return;
    }
    let Ok(raw) = stream.try_clone() else {
        return;
    };
    let Ok(connection) = ServerConnection::new(tls) else {
        return;
    };
    serve_request(StreamOwned::new(connection, stream), &raw, server, &peer);
}

fn session_cookie(token: &str, max_age: u64) -> String {
    format!("Set-Cookie: {SESSION_COOKIE}={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age={max_age}")
}

fn error_body(status: &str, message: &str) -> Vec<u8> {
    json_response(status, serde_json::json!({ "error": message }))
}

fn serve_request<S: Read + Write>(mut stream: S, raw: &TcpStream, server: &HeadlessServer, peer: &str) {
    let request = match read_http_request_limited(&mut stream, MAX_REQUEST_BYTES) {
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
    let session = request_cookie(&request, SESSION_COOKIE)
        .filter(|token| server.session_active(token))
        .map(str::to_owned);

    if method == "GET" && path == "/api/events" {
        let Some(session) = session else {
            let _ = stream.write_all(&error_body("401 Unauthorized", "Iniciá sesión para continuar."));
            return;
        };
        if !is_websocket_upgrade(&request) {
            let _ = stream.write_all(&text_response("426 Upgrade Required", "Esta ruta requiere WebSocket."));
            return;
        }
        let _ = raw.set_read_timeout(Some(EVENT_POLL_INTERVAL));
        let since = request_query_param(&request, "since").and_then(|value| value.parse::<u64>().ok());
        serve_events(PrefixedStream::new(request, stream), server, &session, since);
        return;
    }

    let response = route(&request, method, &path, session.as_deref(), server, peer);
    let _ = stream.write_all(&response);
}

fn route(
    request: &[u8],
    method: &str,
    path: &str,
    session: Option<&str>,
    server: &HeadlessServer,
    peer: &str,
) -> Vec<u8> {
    let is_api = path == "/api" || path.starts_with("/api/");
    if method == "POST" && !request_origin_is_expected(request) {
        return error_body("403 Forbidden", "Origen no autorizado.");
    }
    match (method, path) {
        ("GET", "/api/health") => json_response(
            "200 OK",
            serde_json::json!({ "ok": true, "protocolVersion": PROTOCOL_VERSION }),
        ),
        ("POST", "/api/auth/login") => login(http_body(request), server, peer),
        ("POST", "/api/auth/logout") => {
            if let Some(token) = session {
                server.close_session(token);
            }
            json_response_with_headers("200 OK", serde_json::json!({ "ok": true }), &[&session_cookie("", 0)])
        }
        ("GET", "/api/session") => json_response("200 OK", serde_json::json!({ "authenticated": session.is_some() })),
        _ if is_api && session.is_none() => error_body("401 Unauthorized", "Iniciá sesión para continuar."),
        ("GET", "/api/capabilities") => json_response("200 OK", capabilities()),
        ("GET", "/api/file") => serve_library_file(request, &server.app),
        ("POST", "/api/invoke") => {
            let session = session.unwrap_or_default();
            if !server.allow(format!("invoke:{session}"), 600) {
                return json_response_with_headers(
                    "429 Too Many Requests",
                    serde_json::json!({ "error": "Demasiadas operaciones. Esperá unos segundos.", "retryable": true }),
                    &["Retry-After: 30"],
                );
            }
            invoke(http_body(request), &server.app)
        }
        _ if is_api => error_body("404 Not Found", "No existe."),
        ("GET", _) | ("HEAD", _) => serve_static(server.assets.as_deref(), path),
        _ => error_body("405 Method Not Allowed", "Método no permitido."),
    }
}

fn capabilities() -> Value {
    let remote: Vec<&str> = COMMAND_NAMES.iter().copied().filter(|command| is_remote_command(command)).collect();
    serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "platform": std::env::consts::OS,
        "commands": remote,
        "localOnlyCommands": LOCAL_ONLY_COMMANDS,
    })
}

fn login(body: &[u8], server: &HeadlessServer, peer: &str) -> Vec<u8> {
    if !server.allow(format!("login:{peer}"), 30) {
        return json_response_with_headers(
            "429 Too Many Requests",
            serde_json::json!({ "error": "Demasiados intentos. Esperá un minuto.", "retryable": true }),
            &["Retry-After: 60"],
        );
    }
    let password = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| value.get("password").and_then(Value::as_str).map(str::to_owned));
    let Some(password) = password else {
        return error_body("400 Bad Request", "Falta la contraseña.");
    };
    if !owner::verify_owner_password(&server.server_dir, &password) {
        return error_body("401 Unauthorized", "Contraseña incorrecta.");
    }
    match server.open_session() {
        Some(token) => json_response_with_headers(
            "200 OK",
            serde_json::json!({ "ok": true }),
            &[&session_cookie(&token, SESSION_TTL.as_secs())],
        ),
        None => error_body("500 Internal Server Error", "No se pudo abrir la sesión."),
    }
}

fn invoke(body: &[u8], app: &AppContext) -> Vec<u8> {
    let Ok(request) = serde_json::from_slice::<Value>(body) else {
        return error_body("400 Bad Request", "Solicitud inválida.");
    };
    let command = request.get("command").and_then(Value::as_str).unwrap_or_default();
    if !is_remote_command(command) {
        return error_body("403 Forbidden", "Esta operación solo está disponible en el equipo que ejecuta Notia.");
    }
    let reply = match dispatch_app_invoke(app, REMOTE_WINDOW_LABEL, &request) {
        Dispatch::Ready(reply) => reply,
        Dispatch::Pending(task) => crate::host::async_runtime::block_on(task),
    };
    match reply {
        Ok(result) => json_response("200 OK", serde_json::json!({ "result": result })),
        Err(error) => json_response("400 Bad Request", serde_json::json!({ "error": error })),
    }
}

/// A file of a registered library, for the interface to show (images).
/// Served sandboxed so an SVG or HTML file cannot run scripts on this origin.
fn serve_library_file(request: &[u8], app: &AppContext) -> Vec<u8> {
    use crate::host::Manager;
    let Some(path) = request_query_param(request, "path").filter(|path| !path.trim().is_empty()) else {
        return error_body("400 Bad Request", "Falta la ruta del archivo.");
    };
    let path = Path::new(&path);
    let registry = app.state::<crate::library_registry::LibraryBindingRegistry>();
    if !registry.contains_desktop_path(path) {
        return error_body("403 Forbidden", "La ruta está fuera de las bibliotecas registradas.");
    }
    let Ok(metadata) = std::fs::metadata(path) else {
        return error_body("404 Not Found", "No existe.");
    };
    if !metadata.is_file() {
        return error_body("404 Not Found", "No existe.");
    }
    if metadata.len() > MAX_LIBRARY_FILE_BYTES {
        return error_body("413 Payload Too Large", "El archivo supera el tamaño permitido.");
    }
    match std::fs::read(path) {
        Ok(bytes) => response_with_headers(
            "200 OK",
            super::assets::mime_type(&path.to_string_lossy()),
            &bytes,
            &["Content-Security-Policy: sandbox"],
        ),
        Err(_) => error_body("404 Not Found", "No existe."),
    }
}

fn serve_static(assets: Option<&dyn AssetSource>, path: &str) -> Vec<u8> {
    let Some(assets) = assets else {
        return text_response(
            "200 OK",
            "Servidor Notia headless activo. La interfaz se sirve indicando --static-dir.",
        );
    };
    let requested = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
    // Unknown routes belong to the single-page application.
    match assets.get(requested).or_else(|| assets.get("index.html")) {
        Some(asset) if asset.mime_type().starts_with("text/html") => response_with_headers(
            "200 OK",
            asset.mime_type(),
            asset.bytes(),
            &[INTERFACE_CONTENT_SECURITY_POLICY],
        ),
        Some(asset) => response("200 OK", asset.mime_type(), asset.bytes()),
        None => text_response("404 Not Found", "No existe."),
    }
}

fn serve_events<S: Read + Write>(stream: PrefixedStream<S>, server: &HeadlessServer, session: &str, since: Option<u64>) {
    let config = WebSocketConfig {
        max_message_size: Some(MAX_EVENT_CLIENT_MESSAGE_BYTES),
        max_frame_size: Some(MAX_EVENT_CLIENT_MESSAGE_BYTES),
        ..WebSocketConfig::default()
    };
    let Ok(mut socket) = accept_with_config(stream, Some(config)) else {
        return;
    };
    let (receiver, replay) = server.hub.subscribe(since);
    for message in replay {
        if socket.send(Message::text(message)).is_err() {
            return;
        }
    }
    let mut last_ping = Instant::now();
    loop {
        if !server.session_active(session) {
            let _ = socket.close(None);
            let _ = socket.flush();
            return;
        }
        match receiver.recv_timeout(EVENT_POLL_INTERVAL) {
            Ok(message) => {
                if socket.send(Message::text(message)).is_err() {
                    return;
                }
                continue;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        match socket.read() {
            Ok(Message::Close(_)) => return,
            Ok(_) => {}
            Err(error) if websocket_timeout(&error) => {}
            Err(_) => return,
        }
        if last_ping.elapsed() >= EVENT_PING_INTERVAL {
            if socket.send(Message::Ping(Vec::new().into())).is_err() {
                return;
            }
            last_ping = Instant::now();
        }
    }
}

/// A release build on Windows has no console of its own; attach to the one
/// that launched the headless server so its messages are visible.
#[cfg(target_os = "windows")]
fn attach_parent_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    // SAFETY: plain Win32 call without pointers; failure only means there is
    // no parent console (or one is already attached).
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(target_os = "windows"))]
fn attach_parent_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parses_the_headless_options() {
        let options = parse_options(
            &args(&["--headless", "--data-dir", "D", "--bind=127.0.0.1:9000", "--static-dir", "web"]),
            None,
            Some(PathBuf::from("exe")),
        )
        .expect("options");
        assert_eq!(options.data_dir, PathBuf::from("D"));
        assert_eq!(options.bind, "127.0.0.1:9000".parse::<SocketAddr>().unwrap());
        assert_eq!(options.static_dir, Some(PathBuf::from("web")));
        assert_eq!(options.resource_dir, Some(PathBuf::from("exe")));
        assert!(!options.set_owner_password);
        assert!(options.add_libraries.is_empty());
        let adding = parse_options(
            &args(&["--headless", "--add-library", "A", "--add-library=B"]),
            Some(PathBuf::from("d")),
            None,
        )
        .expect("options");
        assert_eq!(adding.add_libraries, vec![PathBuf::from("A"), PathBuf::from("B")]);
    }

    #[test]
    fn uses_the_application_data_folder_by_default_and_rejects_unknown_options() {
        let options = parse_options(&args(&["--headless"]), Some(PathBuf::from("appdata")), None).expect("options");
        assert_eq!(options.data_dir, PathBuf::from("appdata"));
        assert_eq!(options.bind.port(), DEFAULT_PORT);
        assert!(parse_options(&args(&["--headless"]), None, None).is_err());
        assert!(parse_options(&args(&["--headless", "--port", "1"]), Some(PathBuf::from("d")), None).is_err());
        assert!(parse_options(&args(&["--headless", "--bind"]), Some(PathBuf::from("d")), None).is_err());
        assert!(requested(args(&["notia", "--headless"]).into_iter()));
        assert!(!requested(args(&["notia"]).into_iter()));
    }

    #[test]
    fn capabilities_leave_out_local_only_commands() {
        let value = capabilities();
        let commands = value["commands"].as_array().expect("commands");
        assert!(commands.iter().any(|command| command == "task_manager_board_view"));
        assert!(!commands.iter().any(|command| command == "start_speech_session"));
        assert!(commands.iter().any(|command| command == "speech_remote_audio"));
        assert_eq!(value["platform"], std::env::consts::OS);
    }

    #[test]
    fn library_files_are_served_only_inside_registered_libraries() {
        let root = std::env::temp_dir().join(format!("notia-file-route-{}", uuid::Uuid::new_v4()));
        let library = root.join("biblioteca");
        std::fs::create_dir_all(&library).expect("library folder");
        std::fs::write(library.join("foto.png"), b"png").expect("image");
        std::fs::write(root.join("secreto.txt"), b"no").expect("outside file");
        let app = crate::create_app(AppPaths::new(Some(root.join("data")), None), HostPorts::default());
        crate::library_catalog::add_desktop_library(&app, &library).expect("library registered");
        let request = |path: &std::path::Path| {
            let encoded: String = path
                .to_string_lossy()
                .bytes()
                .map(|byte| if byte.is_ascii_alphanumeric() { (byte as char).to_string() } else { format!("%{byte:02X}") })
                .collect();
            format!("GET /api/file?path={encoded} HTTP/1.1\r\nHost: h\r\n\r\n").into_bytes()
        };
        let served = String::from_utf8_lossy(&serve_library_file(&request(&library.join("foto.png")), &app)).into_owned();
        assert!(served.starts_with("HTTP/1.1 200"));
        assert!(served.contains("Content-Type: image/png"));
        assert!(served.contains("Content-Security-Policy: sandbox"));
        let outside = serve_library_file(&request(&root.join("secreto.txt")), &app);
        assert!(String::from_utf8_lossy(&outside).starts_with("HTTP/1.1 403"));
        let traversal = serve_library_file(&request(&library.join("..").join("secreto.txt")), &app);
        assert!(String::from_utf8_lossy(&traversal).starts_with("HTTP/1.1 403"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn interface_pages_carry_the_content_security_policy() {
        let root = std::env::temp_dir().join(format!("notia-static-csp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("assets")).expect("static folder");
        std::fs::write(root.join("index.html"), b"<html></html>").expect("index");
        std::fs::write(root.join("assets/app.js"), b"ok").expect("script");
        let assets = DirectoryAssets::new(root.clone());
        let page = String::from_utf8_lossy(&serve_static(Some(&assets), "/biblioteca")).into_owned();
        assert!(page.contains("Content-Security-Policy: default-src 'self';"));
        assert!(page.contains("frame-ancestors 'none'"));
        let script = String::from_utf8_lossy(&serve_static(Some(&assets), "/assets/app.js")).into_owned();
        assert!(!script.contains("Content-Security-Policy"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn remote_invoke_refuses_local_only_and_runs_registry_commands() {
        let app = crate::create_app(AppPaths::default(), HostPorts::default());
        let refused = invoke(br#"{"command":"start_speech_session","args":{}}"#, &app);
        assert!(String::from_utf8_lossy(&refused).starts_with("HTTP/1.1 403"));
        let missing = invoke(br#"{"command":"finance_overview"}"#, &app);
        let text = String::from_utf8_lossy(&missing);
        assert!(text.starts_with("HTTP/1.1 400"));
        assert!(text.contains("missing required key payload"));
    }
}
