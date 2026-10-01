//! The link of a client with its host (Client mode).
//!
//! - **HTTPS with a pinned certificate.** The host signs its own
//!   certificate; the client trusts the one it sees on the first connection
//!   (its SHA-256 goes to the connection settings) and refuses any other
//!   until the person saves the address again.
//! - **Sign-in with the library's Owner** (`/api/auth/*`): the sign-in
//!   window of the app sends the Owner's user name and password to the
//!   host. The session lives in memory; «Recordar sesión» keeps the
//!   password sealed on this device to sign in again at start.
//! - **Commands** go to `/api/invoke` (`forward`); library files to
//!   `/api/file` (`fetch_file`, the `notiahost` scheme of the window).
//! - **Events** of the host arrive over its WebSocket and are emitted here,
//!   so the interface listens to them as if they were local.
//! - **The monitor** checks `/api/health` and emits `notia:host-link` when
//!   the host stops or starts answering.

use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::Method;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConnection, DigitallySignedStruct, SignatureScheme, StreamOwned};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tungstenite::client::IntoClientRequest;
use tungstenite::Message;

use crate::backend::connection::{HostAddress, HOST_PROTOCOL_VERSION};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Emitter, Manager};
use crate::registry::{Dispatch, Reply};

const SESSION_COOKIE: &str = "notia_session";
/// Event of the interface when the host starts or stops answering, or the
/// session ends.
pub(crate) const LINK_EVENT: &str = "notia:host-link";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);
/// Commands such as preparing a speech model or exporting run long.
const INVOKE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MONITOR_ONLINE_INTERVAL: Duration = Duration::from_secs(10);
const MONITOR_OFFLINE_INTERVAL: Duration = Duration::from_secs(4);
const EVENTS_READ_TIMEOUT: Duration = Duration::from_secs(1);
const EVENTS_RETRY: Duration = Duration::from_secs(2);
const MAX_EVENT_MESSAGE_BYTES: usize = 64 * 1024 * 1024;

// ---------- State ----------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LinkState {
    #[default]
    Unknown,
    Online,
    Offline,
}

#[derive(Default)]
struct Link {
    state: LinkState,
    /// Id and name of the library the host serves.
    library_id: Option<String>,
    library: Option<String>,
    /// Operating system of the host (`/api/health`).
    platform: Option<String>,
    message: Option<String>,
    session: Option<String>,
    /// The Owner's user name and password of this run, to open a new
    /// session when the host restarts. Only in memory.
    credentials: Option<(String, String)>,
}

#[derive(Clone)]
struct HttpClient {
    address: HostAddress,
    pin: Option<String>,
    client: reqwest::Client,
    seen: Arc<Mutex<Option<String>>>,
}

#[derive(Default)]
pub(crate) struct HostClientState {
    /// The host of the running link.
    target: Mutex<Option<HostAddress>>,
    link: Mutex<Link>,
    http: Mutex<Option<HttpClient>>,
    /// Changes with the settings; the threads of an older link stop.
    generation: AtomicU64,
    events_running: AtomicBool,
}

fn state(app: &AppHandle) -> Option<crate::host::State<'static, HostClientState>> {
    app.try_state::<HostClientState>()
}

fn with_link<T>(app: &AppHandle, read: impl FnOnce(&mut Link) -> T) -> Option<T> {
    let state = state(app)?;
    let mut link = state.link.lock().unwrap_or_else(|error| error.into_inner());
    Some(read(&mut link))
}

fn current_generation(app: &AppHandle) -> u64 {
    state(app).map(|state| state.generation.load(Ordering::SeqCst)).unwrap_or_default()
}

/// Follows the saved settings: another host or mode ends the current link;
/// a client starts its monitor. A newly pinned certificate keeps the link.
pub(crate) fn reconfigure(app: &AppHandle) {
    let Some(state) = state(app) else {
        return;
    };
    let target = crate::connection::client_host(app).map(|(address, _, _)| address);
    {
        let mut current = state.target.lock().unwrap_or_else(|error| error.into_inner());
        if *current == target {
            return;
        }
        current.clone_from(&target);
    }
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.http.lock().unwrap_or_else(|error| error.into_inner()) = None;
    *state.link.lock().unwrap_or_else(|error| error.into_inner()) = Link::default();
    if target.is_none() {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("notia-host-link".into())
        .spawn(move || monitor(app, generation));
    if spawned.is_err() {
        log::error!("[notia:client] the host monitor did not start");
    }
}

// ---------- Views ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerView {
    pub(crate) listening: bool,
    pub(crate) port: u16,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkView {
    state: LinkState,
    library: Option<String>,
    platform: Option<String>,
    signed_in: bool,
    message: Option<String>,
}

pub(crate) fn link_view(app: &AppHandle) -> LinkView {
    with_link(app, |link| LinkView {
        state: link.state,
        library: link.library.clone(),
        platform: link.platform.clone(),
        signed_in: link.session.is_some(),
        message: link.message.clone(),
    })
    .unwrap_or(LinkView { state: LinkState::Unknown, library: None, platform: None, signed_in: false, message: None })
}

fn emit_link(app: &AppHandle) {
    let _ = app.emit(LINK_EVENT, link_view(app));
}

/// Whether the commands of this device run on its host: a client does,
/// except while it works offline on its copy.
pub(crate) fn uses_host(app: &AppHandle) -> bool {
    crate::connection::is_client(app) && !crate::host_mirror::is_offline(app)
}

/// Id and name of the library the host serves, once known.
pub(crate) fn served_library(app: &AppHandle) -> Option<(String, String)> {
    with_link(app, |link| Some((link.library_id.clone()?, link.library.clone().unwrap_or_default()))).flatten()
}

fn remember_library(app: &AppHandle, body: &Value, id_key: &str, name_key: &str) {
    let id = body.get(id_key).and_then(Value::as_str).map(str::to_owned);
    let name = body.get(name_key).and_then(Value::as_str).map(str::to_owned);
    with_link(app, |link| {
        if id.is_some() {
            link.library_id = id;
            link.library = name;
        }
    });
}

fn set_state(app: &AppHandle, next: LinkState, library: Option<Option<String>>, message: Option<String>) {
    let changed = with_link(app, |link| {
        let changed = link.state != next || link.message != message;
        link.state = next;
        link.message = message;
        if let Some(library) = library {
            link.library = library;
        }
        changed
    });
    if changed == Some(true) {
        emit_link(app);
    }
}

// ---------- TLS with a pinned certificate ----------

fn fingerprint(certificate: &[u8]) -> String {
    Sha256::digest(certificate).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Accepts the host's certificate by its fingerprint instead of a
/// certificate authority; without a pin yet, accepts it and remembers it.
#[derive(Debug)]
struct PinnedCertificate {
    pin: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let seen = fingerprint(end_entity.as_ref());
        if let Ok(mut last) = self.seen.lock() {
            *last = Some(seen.clone());
        }
        match &self.pin {
            Some(pin) if *pin != seen => Err(rustls::Error::General("certificado del host distinto".into())),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

fn tls_config(pin: Option<String>, seen: Arc<Mutex<Option<String>>>) -> Result<rustls::ClientConfig, BackendError> {
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let verifier = Arc::new(PinnedCertificate { pin, seen, provider: Arc::clone(&provider) });
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|_| internal("No se pudo preparar la conexión segura con el host."))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth())
}

fn build_http(address: HostAddress, pin: Option<String>) -> Result<HttpClient, BackendError> {
    let seen = Arc::new(Mutex::new(None));
    let client = reqwest::Client::builder()
        .tls_backend_preconfigured(tls_config(pin.clone(), Arc::clone(&seen))?)
        .connect_timeout(CONNECT_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|_| internal("No se pudo preparar la conexión con el host."))?;
    Ok(HttpClient { address, pin, client, seen })
}

fn http(app: &AppHandle) -> Result<HttpClient, BackendError> {
    let (address, _, pin) = crate::connection::client_host(app).ok_or_else(not_client)?;
    let state = state(app).ok_or_else(not_client)?;
    let mut cached = state.http.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(http) = cached.as_ref().filter(|http| http.address == address && http.pin == pin) {
        return Ok(http.clone());
    }
    let http = build_http(address, pin)?;
    *cached = Some(http.clone());
    Ok(http)
}

// ---------- Errors ----------

fn internal(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, message, true)
}

fn not_client() -> BackendError {
    BackendError::new(BackendErrorCode::Unsupported, "Este equipo no está configurado como cliente.", false)
}

fn unreachable_error() -> BackendError {
    BackendError::new(BackendErrorCode::ProviderUnavailable, "No se pudo contactar al host de Notia.", true)
}

fn certificate_changed_error() -> BackendError {
    BackendError::new(
        BackendErrorCode::Forbidden,
        "El certificado del host cambió. Si reinstalaste Notia en el host, editá su dirección en Configuraciones → General y guardala otra vez.",
        false,
    )
}

fn signed_out_error() -> BackendError {
    BackendError::new(BackendErrorCode::Unauthorized, "La sesión con el host terminó. Volvé a iniciar sesión.", false)
}

enum Failure {
    Unreachable,
    CertificateChanged,
}

impl Failure {
    fn error(&self) -> BackendError {
        match self {
            Self::Unreachable => unreachable_error(),
            Self::CertificateChanged => certificate_changed_error(),
        }
    }
}

/// The error of a refused request: the backend error as the host sent it,
/// or its message.
fn host_error(body: &Value, fallback: &str) -> BackendError {
    match body.get("error") {
        Some(error @ Value::Object(_)) => serde_json::from_value(error.clone())
            .unwrap_or_else(|_| BackendError::new(BackendErrorCode::Internal, fallback, true)),
        Some(Value::String(message)) if !message.trim().is_empty() => {
            BackendError::new(BackendErrorCode::Unauthorized, message.clone(), false)
        }
        _ => BackendError::new(BackendErrorCode::Internal, fallback, true),
    }
}

fn error_value(error: BackendError) -> Value {
    serde_json::to_value(error).unwrap_or_else(|_| Value::String("No se pudo contactar al host de Notia.".into()))
}

// ---------- Requests ----------

struct HostReply {
    status: u16,
    body: Value,
    session: Option<String>,
}

fn session_from(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers.get_all(reqwest::header::SET_COOKIE).iter().find_map(|value| {
        let text = value.to_str().ok()?;
        let token = text.split(';').next()?.trim().strip_prefix(SESSION_COOKIE)?.strip_prefix('=')?;
        (!token.is_empty()).then(|| token.to_string())
    })
}

/// Percent-encodes a query value.
fn encode_query(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

async fn send(
    http: &HttpClient,
    method: Method,
    path: &str,
    body: Option<&Value>,
    session: Option<&str>,
    timeout: Duration,
) -> Result<reqwest::Response, Failure> {
    let mut request = http
        .client
        .request(method, format!("{}{path}", http.address.base_url()))
        .timeout(timeout)
        // The host accepts writes only from its own origin.
        .header(reqwest::header::ORIGIN, http.address.base_url());
    if let Some(session) = session {
        request = request.header(reqwest::header::COOKIE, format!("{SESSION_COOKIE}={session}"));
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    request.send().await.map_err(|_| {
        let seen = http.seen.lock().ok().and_then(|seen| seen.clone());
        match (&http.pin, seen) {
            (Some(pin), Some(seen)) if *pin != seen => Failure::CertificateChanged,
            _ => Failure::Unreachable,
        }
    })
}

/// Pins the certificate seen on the first answer of the saved host.
fn pin_seen(app: &AppHandle, http: &HttpClient) {
    if http.pin.is_some() {
        return;
    }
    if let Some(seen) = http.seen.lock().ok().and_then(|seen| seen.clone()) {
        crate::connection::pin_host_certificate(app, &http.address, &seen);
    }
}

async fn request_json(
    app: &AppHandle,
    method: Method,
    path: &str,
    body: Option<&Value>,
    timeout: Duration,
) -> Result<HostReply, BackendError> {
    let http = http(app)?;
    let session = with_link(app, |link| link.session.clone()).flatten();
    let response = match send(&http, method, path, body, session.as_deref(), timeout).await {
        Ok(response) => response,
        Err(failure) => {
            let message = matches!(failure, Failure::CertificateChanged).then(|| failure.error().message);
            set_state(app, LinkState::Offline, None, message);
            return Err(failure.error());
        }
    };
    pin_seen(app, &http);
    set_state(app, LinkState::Online, None, None);
    let status = response.status().as_u16();
    let session = session_from(response.headers());
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    Ok(HostReply { status, body, session })
}

/// A request of the signed-in Owner: a session the host no longer knows
/// (it restarted) is opened again with the credentials of this run.
async fn authenticated(app: &AppHandle, method: Method, path: &str, body: Option<&Value>, timeout: Duration) -> Result<HostReply, BackendError> {
    let reply = request_json(app, method.clone(), path, body, timeout).await?;
    if reply.status != 401 {
        return Ok(reply);
    }
    if renew_session(app).await {
        let reply = request_json(app, method, path, body, timeout).await?;
        if reply.status != 401 {
            return Ok(reply);
        }
    }
    end_session(app);
    Err(signed_out_error())
}

fn end_session(app: &AppHandle) {
    let had = with_link(app, |link| {
        link.credentials = None;
        link.session.take().is_some()
    });
    if had == Some(true) {
        emit_link(app);
    }
}

async fn renew_session(app: &AppHandle) -> bool {
    let Some((username, password)) = with_link(app, |link| link.credentials.clone()).flatten() else {
        return false;
    };
    open_session(app, &username, &password).await.is_ok()
}

async fn open_session(app: &AppHandle, username: &str, password: &str) -> Result<(), BackendError> {
    let body = json!({ "username": username, "password": password });
    let reply = request_json(app, Method::POST, "/api/auth/login", Some(&body), SHORT_TIMEOUT).await?;
    let token = match (reply.status, reply.session) {
        (200, Some(token)) => token,
        _ => return Err(host_error(&reply.body, "El host no aceptó el inicio de sesión.")),
    };
    with_link(app, |link| {
        link.session = Some(token);
        link.credentials = Some((username.to_string(), password.to_string()));
    });
    emit_link(app);
    start_events(app);
    Ok(())
}

// ---------- Commands of the interface ----------

/// Runs `command` on the host.
pub(crate) fn forward(app: &AppHandle, command: &str, args: Value) -> Dispatch {
    let app = app.clone();
    let command = command.to_string();
    Dispatch::Pending(Box::pin(async move { invoke(&app, &command, args).await }))
}

/// Runs `command` on the host and reads its result.
pub(crate) async fn call_host<T: serde::de::DeserializeOwned>(app: &AppHandle, command: &str, args: Value) -> Result<T, BackendError> {
    match invoke(app, command, args).await {
        Ok(value) => serde_json::from_value(value).map_err(|_| internal("El host respondió algo inesperado.")),
        Err(error) => Err(serde_json::from_value(error).unwrap_or_else(|_| internal("El host no pudo completar la operación."))),
    }
}

/// [`call_host`] for synchronous code. Runs on its own thread, so it also
/// works from a blocking task of the async runtime.
pub(crate) fn call_host_blocking<T: serde::de::DeserializeOwned + Send + 'static>(
    app: &AppHandle,
    command: &str,
    args: Value,
) -> Result<T, BackendError> {
    let app = app.clone();
    let command = command.to_string();
    std::thread::spawn(move || crate::host::async_runtime::block_on(call_host::<T>(&app, &command, args)))
        .join()
        .map_err(|_| internal("El host no pudo completar la operación."))?
}

async fn invoke(app: &AppHandle, command: &str, args: Value) -> Reply {
    let body = json!({ "command": command, "args": args });
    let reply = authenticated(app, Method::POST, "/api/invoke", Some(&body), INVOKE_TIMEOUT)
        .await
        .map_err(error_value)?;
    match reply.status {
        200 => Ok(reply.body.get("result").cloned().unwrap_or(Value::Null)),
        // The backend error of the host, as is.
        400 => Err(reply.body.get("error").cloned().unwrap_or(Value::Null)),
        _ => Err(error_value(host_error(&reply.body, "El host no pudo completar la operación."))),
    }
}

/// A file of the host's library, for the `notiahost` scheme of the window.
pub(crate) async fn fetch_file(app: &AppHandle, path: &str) -> Option<(String, Vec<u8>)> {
    let http = http(app).ok()?;
    let session = with_link(app, |link| link.session.clone()).flatten()?;
    let path = format!("/api/file?path={}", encode_query(path));
    let response = send(&http, Method::GET, &path, None, Some(&session), INVOKE_TIMEOUT).await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = response.bytes().await.ok()?;
    Some((mime, bytes.to_vec()))
}

// ---------- Sign-in with the host (the app_auth commands of a client) ----------

fn data_key(library_id: &str) -> String {
    format!("host-{library_id}")
}

fn session_key(library_id: &str) -> String {
    format!("host-session-{library_id}")
}

/// What the sign-in window shows for the library the host serves: open
/// when this device has a session, with what this device remembers.
pub(crate) async fn auth_status(app: &AppHandle) -> Result<Value, BackendError> {
    let reply = request_json(app, Method::GET, "/api/auth/status", None, SHORT_TIMEOUT).await?;
    if reply.status != 200 {
        return Err(host_error(&reply.body, "No se pudo revisar el inicio de sesión en el host."));
    }
    let mut status = reply.body;
    let host_state = status.get("state").and_then(Value::as_str).unwrap_or("none").to_string();
    let library_id = status.get("libraryId").and_then(Value::as_str).map(str::to_owned);
    let (Some(library_id), true) = (library_id, host_state != "none") else {
        return Err(BackendError::new(
            BackendErrorCode::NotFound,
            "El host no tiene una biblioteca abierta. Abrí una en el host y volvé a intentar.",
            true,
        ));
    };
    remember_library(app, &status, "libraryId", "libraryName");
    set_state(app, LinkState::Online, None, None);

    let mut signed_in = has_session(app).await;
    if !signed_in && host_state != "setup" {
        if let Some((username, password)) = crate::config_vault::remembered_credentials(app, &session_key(&library_id)) {
            signed_in = open_session(app, &username, &password).await.is_ok();
        }
    }
    status["state"] = json!(match (signed_in, host_state.as_str()) {
        (true, _) => "unlocked",
        (false, "setup") => "setup",
        _ => "locked",
    });
    status["remembered"] = crate::config_vault::remembered_credentials(app, &data_key(&library_id))
        .map(|(username, password)| json!({ "username": username, "password": password }))
        .unwrap_or(Value::Null);
    status["sessionRemembered"] = json!(crate::config_vault::remembered_credentials(app, &session_key(&library_id)).is_some());
    Ok(status)
}

async fn has_session(app: &AppHandle) -> bool {
    if with_link(app, |link| link.session.is_none()).unwrap_or(true) {
        return false;
    }
    match request_json(app, Method::GET, "/api/session", None, SHORT_TIMEOUT).await {
        Ok(reply) if reply.body.get("authenticated").and_then(Value::as_bool) == Some(true) => true,
        Ok(_) => renew_session(app).await,
        Err(_) => false,
    }
}

pub(crate) async fn auth_login(
    app: &AppHandle,
    library_id: &str,
    username: &str,
    password: &str,
    remember_session: bool,
    remember_data: bool,
) -> Result<Value, BackendError> {
    let username = username.trim();
    open_session(app, username, password).await?;
    remember(app, &session_key(library_id), remember_session.then_some((username, password)))?;
    remember(app, &data_key(library_id), remember_data.then_some((username, password)))?;
    auth_status(app).await
}

fn remember(app: &AppHandle, key: &str, credentials: Option<(&str, &str)>) -> Result<(), BackendError> {
    match credentials {
        Some((username, password)) => crate::config_vault::remember_credentials(app, key, username, password),
        None => {
            crate::config_vault::forget_credentials(app, key);
            Ok(())
        }
    }
}

async fn password_flow(app: &AppHandle, path: &str, body: Value) -> Result<(), BackendError> {
    let reply = request_json(app, Method::POST, path, Some(&body), SHORT_TIMEOUT).await?;
    match reply.status {
        200 => Ok(()),
        _ => Err(host_error(&reply.body, "El host no pudo guardar la contraseña.")),
    }
}

pub(crate) async fn auth_first_login(app: &AppHandle, username: &str) -> Result<(), BackendError> {
    password_flow(app, "/api/auth/first-login", json!({ "username": username })).await
}

pub(crate) async fn auth_create_password(app: &AppHandle, username: &str, password: &str) -> Result<Value, BackendError> {
    password_flow(app, "/api/auth/create-password", json!({ "username": username, "password": password })).await?;
    auth_status(app).await
}

/// The host ends every session when the password changes; this device
/// opens a new one with the new password.
pub(crate) async fn auth_change_password(
    app: &AppHandle,
    library_id: &str,
    username: &str,
    current: &str,
    new: &str,
) -> Result<Value, BackendError> {
    let body = json!({ "username": username, "current": current, "new": new });
    password_flow(app, "/api/auth/change-password", body).await?;
    for key in [session_key(library_id), data_key(library_id)] {
        if let Some((remembered, _)) = crate::config_vault::remembered_credentials(app, &key) {
            let _ = crate::config_vault::remember_credentials(app, &key, &remembered, new);
        }
    }
    end_session(app);
    let _ = open_session(app, username.trim(), new).await;
    auth_status(app).await
}

pub(crate) async fn auth_logout(app: &AppHandle, library_id: Option<&str>) -> Result<Value, BackendError> {
    let _ = request_json(app, Method::POST, "/api/auth/logout", Some(&json!({})), SHORT_TIMEOUT).await;
    if let Some(library_id) = library_id {
        crate::config_vault::forget_credentials(app, &session_key(library_id));
    }
    end_session(app);
    auth_status(app).await
}

// ---------- «Probar conexión» ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HostProbe {
    ok: bool,
    library: Option<String>,
    latency_ms: u64,
    message: Option<String>,
}

/// Asks `address` for its health, trusting `pin` (or any certificate the
/// first time, pinned when the address is the saved host).
pub(crate) async fn probe(app: &AppHandle, address: &HostAddress, pin: Option<String>) -> HostProbe {
    let started = Instant::now();
    let failed = |message: &str| HostProbe { ok: false, library: None, latency_ms: 0, message: Some(message.to_string()) };
    let Ok(http) = build_http(address.clone(), pin) else {
        return failed("No se pudo preparar la conexión con el host.");
    };
    let response = match send(&http, Method::GET, "/api/health", None, None, SHORT_TIMEOUT).await {
        Ok(response) => response,
        Err(failure) => return failed(&failure.error().message),
    };
    let latency_ms = started.elapsed().as_millis() as u64;
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    if body.get("app").and_then(Value::as_str) != Some("notia") {
        return failed("En esa dirección no responde un host de Notia.");
    }
    if body.get("protocolVersion").and_then(Value::as_u64) != Some(u64::from(HOST_PROTOCOL_VERSION)) {
        return failed("El host usa otra versión de Notia: actualizá ambos equipos.");
    }
    pin_seen(app, &http);
    let library = body.get("library").and_then(Value::as_str).map(str::to_owned);
    if crate::connection::client_host(app).is_some_and(|(saved, _, _)| saved == *address) {
        let platform = body.get("platform").and_then(Value::as_str).map(str::to_owned);
        with_link(app, |link| link.platform = platform);
        set_state(app, LinkState::Online, Some(library.clone()), None);
    }
    HostProbe { ok: true, library, latency_ms, message: None }
}

// ---------- Monitor ----------

fn monitor(app: AppHandle, generation: u64) {
    while current_generation(&app) == generation {
        let online = crate::host::async_runtime::block_on(check_health(&app));
        if online && with_link(&app, |link| link.session.is_some()).unwrap_or(false) {
            start_events(&app);
            // The copy follows the host while there is connection.
            if crate::host_mirror::keeps_copy(&app) && !crate::host_mirror::is_offline(&app) {
                if let Err(error) = crate::host::async_runtime::block_on(crate::host_mirror::sync(&app)) {
                    log::warn!("[notia:client] the copy did not sync: {}", error.message);
                }
            }
        }
        let wait = if online { MONITOR_ONLINE_INTERVAL } else { MONITOR_OFFLINE_INTERVAL };
        let until = Instant::now() + wait;
        while Instant::now() < until && current_generation(&app) == generation {
            std::thread::sleep(Duration::from_millis(250));
        }
    }
}

async fn check_health(app: &AppHandle) -> bool {
    match request_json(app, Method::GET, "/api/health", None, CONNECT_TIMEOUT).await {
        Ok(reply) if reply.status == 200 => {
            let platform = reply.body.get("platform").and_then(Value::as_str).map(str::to_owned);
            with_link(app, |link| link.platform = platform);
            remember_library(app, &reply.body, "libraryId", "library");
            set_state(app, LinkState::Online, None, None);
            true
        }
        Ok(_) => {
            set_state(app, LinkState::Offline, None, Some("El host no responde como un host de Notia.".into()));
            false
        }
        Err(_) => false,
    }
}

// ---------- Events of the host ----------

type EventSocket = tungstenite::WebSocket<StreamOwned<ClientConnection, TcpStream>>;

fn start_events(app: &AppHandle) {
    let Some(state) = state(app) else {
        return;
    };
    if state.events_running.swap(true, Ordering::SeqCst) {
        return;
    }
    let generation = current_generation(app);
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("notia-host-events".into()).spawn(move || {
        relay_events(&app, generation);
        if let Some(state) = self::state(&app) {
            state.events_running.store(false, Ordering::SeqCst);
        }
    });
    if spawned.is_err() {
        state.events_running.store(false, Ordering::SeqCst);
    }
}

/// Emits here every event of the host while this device has a session.
/// A reconnection asks for what it missed (`since`).
fn relay_events(app: &AppHandle, generation: u64) {
    let mut since = 0_u64;
    while current_generation(app) == generation {
        let Some(session) = with_link(app, |link| link.session.clone()).flatten() else {
            return;
        };
        let Some((address, _, pin)) = crate::connection::client_host(app) else {
            return;
        };
        match open_events(&address, pin, &session, since) {
            Ok(mut socket) => read_events(app, generation, &session, &mut socket, &mut since),
            Err(EventsError::SignedOut) => {
                if !crate::host::async_runtime::block_on(renew_session(app)) {
                    end_session(app);
                    return;
                }
            }
            Err(EventsError::Failed) => std::thread::sleep(EVENTS_RETRY),
        }
    }
}

enum EventsError {
    SignedOut,
    Failed,
}

fn open_events(address: &HostAddress, pin: Option<String>, session: &str, since: u64) -> Result<EventSocket, EventsError> {
    let socket_address = (address.host.as_str(), address.port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
        .ok_or(EventsError::Failed)?;
    let stream = TcpStream::connect_timeout(&socket_address, CONNECT_TIMEOUT).map_err(|_| EventsError::Failed)?;
    let _ = stream.set_read_timeout(Some(SHORT_TIMEOUT));
    let config = tls_config(pin, Arc::new(Mutex::new(None))).map_err(|_| EventsError::Failed)?;
    let server_name = ServerName::try_from(address.host.clone()).map_err(|_| EventsError::Failed)?;
    let connection = ClientConnection::new(Arc::new(config), server_name).map_err(|_| EventsError::Failed)?;
    let query = if since > 0 { format!("?since={since}") } else { String::new() };
    let mut request = format!("wss://{}/api/events{query}", address.display())
        .into_client_request()
        .map_err(|_| EventsError::Failed)?;
    let headers = request.headers_mut();
    headers.insert("Cookie", format!("{SESSION_COOKIE}={session}").parse().map_err(|_| EventsError::Failed)?);
    headers.insert("Origin", address.base_url().parse().map_err(|_| EventsError::Failed)?);
    let config = tungstenite::protocol::WebSocketConfig {
        max_message_size: Some(MAX_EVENT_MESSAGE_BYTES),
        max_frame_size: Some(MAX_EVENT_MESSAGE_BYTES),
        ..Default::default()
    };
    match tungstenite::client::client_with_config(request, StreamOwned::new(connection, stream), Some(config)) {
        Ok((socket, _)) => {
            let _ = socket.get_ref().sock.set_read_timeout(Some(EVENTS_READ_TIMEOUT));
            Ok(socket)
        }
        Err(tungstenite::HandshakeError::Failure(tungstenite::Error::Http(response))) if response.status() == 401 => {
            Err(EventsError::SignedOut)
        }
        Err(_) => Err(EventsError::Failed),
    }
}

fn read_events(app: &AppHandle, generation: u64, session: &str, socket: &mut EventSocket, since: &mut u64) {
    loop {
        let same_session = with_link(app, |link| link.session.as_deref() == Some(session)).unwrap_or(false);
        if current_generation(app) != generation || !same_session {
            let _ = socket.close(None);
            return;
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let Ok(message) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                if let Some(seq) = message.get("seq").and_then(Value::as_u64) {
                    *since = (*since).max(seq);
                }
                if let Some(event) = message.get("event").and_then(Value::as_str) {
                    let payload = message.get("payload").cloned().unwrap_or(Value::Null);
                    let _ = app.emit(event, payload);
                }
            }
            Ok(Message::Close(_)) => return,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_session_cookie_and_encodes_queries() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.append(reqwest::header::SET_COOKIE, "otra=1; Path=/".parse().expect("header"));
        headers.append(reqwest::header::SET_COOKIE, "notia_session=abc123; HttpOnly; Secure".parse().expect("header"));
        assert_eq!(session_from(&headers).as_deref(), Some("abc123"));
        let mut cleared = reqwest::header::HeaderMap::new();
        cleared.append(reqwest::header::SET_COOKIE, "notia_session=; Max-Age=0".parse().expect("header"));
        assert_eq!(session_from(&cleared), None);
        assert_eq!(encode_query("C:/Notas/foto 1.png"), "C%3A%2FNotas%2Ffoto%201.png");
    }

    #[test]
    fn refused_requests_keep_the_backend_error_of_the_host() {
        let error = BackendError::new(BackendErrorCode::NotFound, "No existe.", false);
        let body = json!({ "error": error });
        assert_eq!(host_error(&body, "x"), error);
        let message = host_error(&json!({ "error": "Contraseña incorrecta." }), "x");
        assert_eq!((message.code, message.message.as_str()), (BackendErrorCode::Unauthorized, "Contraseña incorrecta."));
        assert_eq!(host_error(&Value::Null, "Falló.").message, "Falló.");
    }

    #[test]
    fn a_client_device_never_calls_telegram() {
        crate::services::telegram_service::set_client_device(true);
        let refused = crate::host::async_runtime::block_on(crate::services::telegram_service::check_bot("1:abc"));
        crate::services::telegram_service::set_client_device(false);
        assert!(refused.is_err_and(|message| message.contains("modo cliente")));
    }

    #[test]
    fn a_pinned_certificate_refuses_another_one() {
        let seen = Arc::new(Mutex::new(None));
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let certificate = CertificateDer::from(vec![1_u8, 2, 3]);
        let name = ServerName::try_from("192.168.0.10").expect("name");
        let first_use = PinnedCertificate { pin: None, seen: Arc::clone(&seen), provider: Arc::clone(&provider) };
        assert!(first_use.verify_server_cert(&certificate, &[], &name, &[], UnixTime::now()).is_ok());
        let seen_pin = seen.lock().expect("seen").clone().expect("fingerprint");
        assert_eq!(seen_pin, fingerprint(&[1, 2, 3]));
        let pinned = PinnedCertificate { pin: Some(seen_pin), seen: Arc::clone(&seen), provider: Arc::clone(&provider) };
        assert!(pinned.verify_server_cert(&certificate, &[], &name, &[], UnixTime::now()).is_ok());
        let other = CertificateDer::from(vec![9_u8]);
        assert!(pinned.verify_server_cert(&other, &[], &name, &[], UnixTime::now()).is_err());
    }

    /// Records what the application of the client emits.
    #[derive(Default)]
    struct Recorder(Mutex<Vec<(String, Value)>>);

    impl crate::host::EventSink for Recorder {
        fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
            self.0.lock().expect("events").push((event.to_string(), payload));
            Ok(())
        }
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[test]
    fn a_client_signs_in_runs_commands_and_receives_the_events_of_its_host() {
        use crate::backend::connection::{ClientKind, ConnectionSettings, RunMode};
        use crate::host::{AppPaths, HostPorts};

        let root = std::env::temp_dir().join(format!("notia-host-link-{}", uuid::Uuid::new_v4()));
        let (host, port, stop, library_id) = test_host::start(&root);

        let recorder = Arc::new(Recorder::default());
        let client = crate::create_app(
            AppPaths::new(Some(root.join("client")), None),
            HostPorts { events: Some(recorder.clone()), ..HostPorts::default() },
        );
        let settings = ConnectionSettings {
            mode: RunMode::Client,
            client_kind: ClientKind::Remote,
            host_address: format!("127.0.0.1:{port}"),
            ..ConnectionSettings::default()
        };
        crate::connection::store(&client, &settings).expect("settings");

        crate::host::async_runtime::block_on(async {
            let status = auth_status(&client).await.expect("status");
            assert_eq!((status["state"].as_str(), status["libraryName"].as_str()), (Some("locked"), Some("Biblioteca")));
            // The certificate seen first is pinned.
            assert!(crate::connection::settings(&client).host_certificate.is_some());
            assert!(invoke(&client, "backend_library_catalog", json!({})).await.is_err());

            assert!(auth_login(&client, &library_id, "Owner", "otra", false, false).await.is_err());
            let status = auth_login(&client, &library_id, "Owner", "contraseña-1", false, false).await.expect("login");
            assert_eq!(served_library(&client), Some((library_id.clone(), "Biblioteca".to_string())));
            assert_eq!(status["state"], "unlocked");
            let catalog = invoke(&client, "backend_library_catalog", json!({})).await.expect("catalog");
            assert_eq!(catalog["libraries"][0]["id"], library_id.as_str());
            // The host's libraries stay: a client cannot empty its catalog
            // nor drop the binding of its library.
            let empty = json!({ "catalog": { "libraries": [], "selectedLibraryId": null } });
            let refused = invoke(&client, "backend_save_library_catalog", empty).await.expect_err("catalog");
            assert_eq!(refused["code"], "forbidden");
            assert!(invoke(&client, "revoke_library_binding", json!({ "libraryId": library_id })).await.is_err());
            let kept = invoke(&client, "backend_library_catalog", json!({})).await.expect("catalog kept");
            assert_eq!(kept["libraries"][0]["id"], library_id.as_str());
            assert!(crate::library_catalog::selected_library(&host).is_some());

            // A client never turns Telegram on in its host.
            let telegram_on = json!({ "payload": { "libraryId": library_id, "config": {
                "telegram": { "enabled": true, "botToken": "1:abc" },
                "panelDesplegable": { "refreshIntervalMs": 45_000 },
            } } });
            let written = invoke(&client, "backend_write_library_config", telegram_on).await.expect("write");
            assert_eq!(written["ok"], true);
            let stored = crate::library_config::read_library_config(&host, &library_id).expect("read").expect("config");
            assert_eq!(stored["panelDesplegable"]["refreshIntervalMs"], 45_000);
            assert_ne!(stored["telegram"]["enabled"], true);

            // A client keeps its meeting on its device: the host never shows
            // one, but stores the note of a meeting the client recorded.
            assert!(invoke(&client, "meeting_snapshot", json!({ "payload": {} })).await.is_err());
            let note = json!({ "payload": {
                "libraryId": library_id,
                "folder": "",
                "fileName": "Reunión de equipo.md",
                "content": "# Reunión de equipo\n\nBuen día a todos.\n",
            } });
            let stored = invoke(&client, "meeting_store_note", note.clone()).await.expect("note");
            assert_eq!(stored["logicalPath"], "Reunión de equipo.md");
            // Over the note saved before while it did not change.
            let mut again = note.clone();
            again["payload"]["previous"] = json!({ "logicalPath": stored["logicalPath"], "revision": stored["revision"] });
            again["payload"]["content"] = json!("# Reunión de equipo\n\nBuen día.\n");
            let rewritten = invoke(&client, "meeting_store_note", again).await.expect("rewrite");
            assert_eq!(rewritten["logicalPath"], stored["logicalPath"]);
            // Without it, a second note gets a free name.
            let second = invoke(&client, "meeting_store_note", note).await.expect("second");
            assert_ne!(second["logicalPath"], stored["logicalPath"]);
            let bad = json!({ "payload": { "libraryId": library_id, "folder": "../x", "fileName": "a.md", "content": "x" } });
            assert!(invoke(&client, "meeting_store_note", bad).await.is_err());
        });

        // What only works on the device running Notia is not offered.
        let refused = crate::registry::dispatch_app_invoke(&client, "main", &json!({ "command": "library_pick_directory" }));
        assert!(matches!(refused, Dispatch::Ready(Err(error)) if error["code"] == "unsupported"));

        // Events of the host reach the client's interface.
        let _ = host.emit("notia:prueba", json!({ "ok": true }));
        let deadline = Instant::now() + Duration::from_secs(10);
        let received = loop {
            let received = recorder.0.lock().expect("events").iter().any(|(event, payload)| event == "notia:prueba" && payload["ok"] == true);
            if received || Instant::now() > deadline {
                break received;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        assert!(received, "the event of the host did not arrive");

        stop.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_dir_all(&root);
    }
}

/// A host serving a library on 127.0.0.1, for the tests of the client.
#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
pub(crate) mod test_host {
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use crate::host::{AppContext, AppPaths, HostPorts, Manager};
    use crate::server::api::{ApiServer, ServerKind};

    /// Starts a host whose Owner signs in with `owner` / `contraseña-1`.
    /// Returns its application, port, stop flag and library id.
    pub(crate) fn start(root: &Path) -> (AppContext, u16, Arc<AtomicBool>, String) {
        let folder = root.join("Biblioteca");
        std::fs::create_dir_all(folder.join(".notia")).expect("library folder");
        let host = crate::create_app(AppPaths::new(Some(root.join("host")), None), HostPorts::default());
        host.manage(crate::mobile_directory_picker::AndroidDirectoryPickerState::empty());
        let library_id = crate::library_catalog::add_desktop_library(&host, &folder).expect("library").id;
        crate::app_auth::host_create_password(&host, "owner", "contraseña-1").expect("password");

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("address").port();
        let tls = crate::server::tls::server_config(&root.join("tls")).expect("tls");
        let hub = host.state::<crate::server::SharedEventHub>().inner().0.clone();
        let server = Arc::new(ApiServer::new(host.clone(), hub, None, ServerKind::Host, None, None));
        let stop = Arc::clone(&server.stop);
        std::thread::spawn(move || crate::server::api::run(listener, server, tls));
        (host, port, stop, library_id)
    }
}
