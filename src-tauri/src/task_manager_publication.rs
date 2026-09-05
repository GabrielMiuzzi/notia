use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Arc, Mutex},
};

#[cfg(target_os = "windows")]
use rcgen::{CertificateParams, KeyPair};
#[cfg(target_os = "windows")]
use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer},
    ServerConfig, ServerConnection, StreamOwned,
};
#[cfg(target_os = "windows")]
use std::fs;
#[cfg(target_os = "windows")]
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
const MAX_HTTP_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const PASSWORD_HASH_ITERATIONS: u32 = 210_000;
const TASK_MANAGER_PUBLICATION_PATH: &str = "/task-manager";
#[cfg(target_os = "windows")]
const PUBLICATION_CERTIFICATE_VERSION: &str = "2";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedTask {
    title: String,
    detail: String,
    state: String,
    start_date: String,
    end_date: String,
    group: String,
    priority: String,
    dedicated_hours: f64,
    estimated_hours: f64,
    deviation_hours: f64,
    parent_task_name: String,
    order: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PublishedGroup {
    name: String,
    color: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PublishedBoard {
    name: String,
    color: String,
    groups: Vec<PublishedGroup>,
    tasks: Vec<PublishedTask>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TaskManagerPublicationPayload {
    #[serde(rename = "vaultPath")]
    vault_path: String,
    theme: String,
    #[serde(rename = "passwordHash")]
    password_hash: String,
    #[serde(rename = "approvedDevices", default)]
    approved_devices: Vec<PublishedDevice>,
    port: u16,
    #[serde(rename = "aiPreferences")]
    ai_preferences: PublishedAiPreferences,
    settings: Value,
    boards: Vec<PublishedBoard>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishedAiPreferences {
    ollama_url: String,
    #[serde(default)]
    api_key: String,
    selected_model: String,
    thinking_enabled: bool,
    thinking_level: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedAiStreamRequest {
    model: String,
    #[serde(default)]
    think: Value,
    #[serde(default)]
    messages: Vec<crate::services::ai_service::AiChatMessage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PublishedDevice {
    id: String,
    name: String,
}

#[derive(Clone, Default)]
pub struct TaskManagerPublicationState {
    inner: Arc<Mutex<PublicationRuntime>>,
}

#[derive(Default)]
struct PublicationRuntime {
    port: Option<u16>,
    payload: Option<TaskManagerPublicationPayload>,
    server_started: bool,
    authenticated_sessions: HashMap<String, String>,
    approved_devices: HashSet<String>,
    pending_devices: HashMap<String, String>,
    #[cfg(target_os = "windows")]
    change_subscribers: Vec<mpsc::Sender<()>>,
    #[cfg(target_os = "windows")]
    app_handle: Option<tauri::AppHandle>,
    #[cfg(target_os = "windows")]
    assets: Option<Arc<tauri::AssetResolver<tauri::Wry>>>,
}

#[tauri::command]
pub fn hash_task_manager_publication_password(password: String) -> Result<String, String> {
    validate_publication_password(&password)?;
    let mut salt = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    Ok(format_password_hash(password.as_bytes(), &salt))
}

#[tauri::command]
pub fn publish_task_manager_boards(
    app: tauri::AppHandle,
    state: tauri::State<'_, TaskManagerPublicationState>,
    payload: TaskManagerPublicationPayload,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, payload);
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        if payload.boards.is_empty() {
            return Err("Seleccioná al menos un tablero para publicar.".to_string());
        }
        if payload.vault_path.trim().is_empty() {
            return Err("No hay una biblioteca activa para publicar.".to_string());
        }
        if !is_valid_password_hash(&payload.password_hash) {
            return Err("Configurá una contraseña válida para publicar.".to_string());
        }
        if payload.port < 1024 {
            return Err("Elegí un puerto entre 1024 y 65535.".to_string());
        }
        let requested_port = payload.port;
        let runtime = state.inner.clone();
        let tls_config = publication_tls_config(&app)?;
        let should_start = {
            let mut guard = runtime
                .lock()
                .map_err(|_| "No se pudo actualizar la publicación.")?;
            guard.assets = Some(Arc::new(app.asset_resolver()));
            guard.payload = Some(payload);
            guard.approved_devices =
                guard
                    .payload
                    .as_ref()
                    .map_or_else(HashSet::new, |publication| {
                        publication
                            .approved_devices
                            .iter()
                            .map(|device| device.id.clone())
                            .collect()
                    });
            guard.pending_devices.clear();
            guard.authenticated_sessions.clear();
            guard.change_subscribers.clear();
            guard.app_handle = Some(app.clone());
            let should_start = !guard.server_started;
            guard.server_started = true;
            should_start
        };
        let port = if should_start {
            match start_publication_server(runtime.clone(), tls_config, requested_port) {
                Ok(port) => port,
                Err(error) => {
                    if let Ok(mut guard) = runtime.lock() {
                        guard.server_started = false;
                        guard.port = None;
                    }
                    return Err(error);
                }
            }
        } else {
            publication_port(&runtime)?
        };
        Ok(publication_url(port))
    }
}

#[tauri::command]
pub fn open_task_manager_publication(
    state: tauri::State<'_, TaskManagerPublicationState>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo abrir la publicación.")?;
        let port = guard
            .port
            .ok_or_else(|| "Primero publicá al menos un tablero.".to_string())?;
        if guard.payload.is_none() {
            return Err("Primero publicá al menos un tablero.".to_string());
        }
        let url = format!("https://127.0.0.1:{port}{TASK_MANAGER_PUBLICATION_PATH}");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|_| "No se pudo abrir el navegador predeterminado.")?;
        Ok(())
    }
}

#[tauri::command]
pub fn get_task_manager_publication_url(
    state: tauri::State<'_, TaskManagerPublicationState>,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo consultar la publicación.")?;
        let port = guard
            .port
            .filter(|_| guard.payload.is_some())
            .ok_or_else(|| "No hay tableros publicados.".to_string())?;
        Ok(publication_url(port))
    }
}

#[tauri::command]
pub fn list_pending_task_manager_publication_devices(
    state: tauri::State<'_, TaskManagerPublicationState>,
) -> Result<Vec<PublishedDevice>, String> {
    Ok(state
        .inner
        .lock()
        .map_err(|_| "No se pudo consultar los dispositivos.")?
        .pending_devices
        .iter()
        .map(|(id, name)| PublishedDevice {
            id: id.clone(),
            name: name.clone(),
        })
        .collect())
}
#[tauri::command]
pub fn approve_task_manager_publication_device(
    state: tauri::State<'_, TaskManagerPublicationState>,
    device_id: String,
) -> Result<PublishedDevice, String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "No se pudo aprobar el dispositivo.")?;
    let name = guard
        .pending_devices
        .remove(&device_id)
        .ok_or_else(|| "El dispositivo ya no está pendiente.".to_string())?;
    guard.approved_devices.insert(device_id.clone());
    Ok(PublishedDevice {
        id: device_id,
        name,
    })
}

#[tauri::command]
pub fn revoke_task_manager_publication_device(
    state: tauri::State<'_, TaskManagerPublicationState>,
    device_id: String,
) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "No se pudo revocar el dispositivo.")?;
    if !guard.approved_devices.remove(&device_id) {
        return Err("El dispositivo ya no tiene acceso.".to_string());
    }
    guard
        .authenticated_sessions
        .retain(|_, session_device_id| session_device_id != &device_id);
    Ok(())
}

#[tauri::command]
pub fn stop_task_manager_publication(
    state: tauri::State<'_, TaskManagerPublicationState>,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("La publicación de tableros solo está disponible en Windows.".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "No se pudo detener la publicación.")?;
        guard.payload = None;
        guard.authenticated_sessions.clear();
        Ok(())
    }
}

#[tauri::command]
pub fn notify_task_manager_publication_changed(
    state: tauri::State<'_, TaskManagerPublicationState>,
    vault_path: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, vault_path);
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let is_published_vault = state
            .inner
            .lock()
            .map_err(|_| "No se pudo notificar el cambio de Task Manager.")?
            .payload
            .as_ref()
            .is_some_and(|publication| publication.vault_path == vault_path);
        if is_published_vault {
            notify_publication_changed(&state.inner, &vault_path);
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn publication_tls_config(app: &tauri::AppHandle) -> Result<Arc<ServerConfig>, String> {
    let certificate_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "No se pudo resolver el directorio del certificado HTTPS.")?
        .join("task-manager-publication");
    fs::create_dir_all(&certificate_directory)
        .map_err(|_| "No se pudo preparar el directorio del certificado HTTPS.")?;

    let certificate_path = certificate_directory.join("certificate.der");
    let private_key_path = certificate_directory.join("private-key.der");
    let certificate_version_path = certificate_directory.join("version");
    let (certificate, private_key) = match (
        fs::read(&certificate_path),
        fs::read(&private_key_path),
        fs::read_to_string(&certificate_version_path),
    ) {
        (Ok(certificate), Ok(private_key), Ok(version))
            if version.trim() == PUBLICATION_CERTIFICATE_VERSION =>
        {
            (certificate, private_key)
        }
        _ => create_publication_certificate(
            &certificate_path,
            &private_key_path,
            &certificate_version_path,
        )?,
    };

    ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate)],
            PrivateKeyDer::Pkcs8(private_key.into()),
        )
        .map(Arc::new)
        .map_err(|_| "No se pudo cargar el certificado HTTPS de la publicación.".to_string())
}

#[cfg(target_os = "windows")]
fn create_publication_certificate(
    certificate_path: &std::path::Path,
    private_key_path: &std::path::Path,
    certificate_version_path: &std::path::Path,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let key_pair = KeyPair::generate()
        .map_err(|_| "No se pudo crear la clave privada HTTPS de la publicación.")?;
    let certificate = CertificateParams::new(publication_certificate_subject_names())
        .map_err(|_| "No se pudo preparar el certificado HTTPS de la publicación.")?
        .self_signed(&key_pair)
        .map_err(|_| "No se pudo crear el certificado HTTPS de la publicación.")?;
    let certificate_der = certificate.der().to_vec();
    let private_key_der = key_pair.serialize_der();
    fs::write(certificate_path, &certificate_der)
        .map_err(|_| "No se pudo guardar el certificado HTTPS de la publicación.")?;
    fs::write(private_key_path, &private_key_der)
        .map_err(|_| "No se pudo guardar la clave HTTPS de la publicación.")?;
    fs::write(certificate_version_path, PUBLICATION_CERTIFICATE_VERSION)
        .map_err(|_| "No se pudo guardar la versión del certificado HTTPS.")?;
    Ok((certificate_der, private_key_der))
}

#[cfg(target_os = "windows")]
fn publication_certificate_subject_names() -> Vec<String> {
    let mut names = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    if let Ok(adapters) = ipconfig::get_adapters() {
        names.extend(
            adapters
                .iter()
                .flat_map(|adapter| adapter.ip_addresses())
                .filter(|address| address.is_ipv4())
                .map(ToString::to_string),
        );
    }
    names.sort_unstable();
    names.dedup();
    names
}

#[cfg(target_os = "windows")]
fn start_publication_server(
    runtime: Arc<Mutex<PublicationRuntime>>,
    tls_config: Arc<ServerConfig>,
    requested_port: u16,
) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("0.0.0.0", requested_port)).map_err(|_| {
        let recommended_port = std::net::TcpListener::bind("0.0.0.0:0")
            .ok()
            .and_then(|listener| listener.local_addr().ok().map(|address| address.port()))
            .unwrap_or(52471);
        format!("El puerto {requested_port} no está disponible. Puerto libre recomendado: {recommended_port}.")
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| "No se pudo determinar el puerto.")?
        .port();
    runtime
        .lock()
        .map_err(|_| "No se pudo iniciar la publicación.")?
        .port = Some(port);
    std::thread::Builder::new()
        .name("notia-task-manager-publication".to_string())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let runtime = runtime.clone();
                let tls_config = tls_config.clone();
                let _ = std::thread::Builder::new()
                    .name("notia-task-manager-https".to_string())
                    .spawn(move || serve_publication_connection(stream, runtime, tls_config));
            }
        })
        .map_err(|_| "No se pudo iniciar el servidor de publicación.")?;
    Ok(port)
}

#[cfg(target_os = "windows")]
fn serve_publication_connection(
    stream: std::net::TcpStream,
    runtime: Arc<Mutex<PublicationRuntime>>,
    tls_config: Arc<ServerConfig>,
) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    let mut first_byte = [0_u8; 1];
    let is_tls = matches!(stream.peek(&mut first_byte), Ok(1)) && first_byte[0] == 22;
    if !is_tls {
        serve_http_redirect(stream);
        return;
    }
    let connection = match ServerConnection::new(tls_config) {
        Ok(connection) => connection,
        Err(_) => return,
    };
    serve_request(StreamOwned::new(connection, stream), runtime);
}

#[cfg(target_os = "windows")]
fn serve_http_redirect(mut stream: std::net::TcpStream) {
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
            "Abrí esta publicación mediante HTTPS.",
        ));
        return;
    };
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

#[cfg(target_os = "windows")]
fn serve_request<S: Read + Write>(mut stream: S, runtime: Arc<Mutex<PublicationRuntime>>) {
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
    let snapshot = runtime.lock().ok().and_then(|guard| {
        Some((
            guard.payload.clone()?,
            Arc::clone(guard.assets.as_ref()?),
            request_session_token(&request).is_some_and(|session| {
                guard
                    .authenticated_sessions
                    .get(session)
                    .is_some_and(|device_id| guard.approved_devices.contains(device_id))
            }),
        ))
    });
    let Some((publication, assets, authenticated)) = snapshot else {
        let _ = stream.write_all(&text_response(
            "404 Not Found",
            "Publicación no disponible.",
        ));
        return;
    };
    let base = TASK_MANAGER_PUBLICATION_PATH;
    if authenticated && method == "POST" && path == format!("{base}/ai/stream") {
        serve_publication_ai_stream(&mut stream, http_body(&request), &publication);
        return;
    }
    if authenticated && method == "GET" && path == format!("{base}/events") {
        serve_publication_events(&mut stream, &runtime, &publication.vault_path);
        return;
    }
    let response = if method == "GET" && (path == base || path == format!("{base}/")) {
        serve_login_page()
    } else if method == "POST" && path == format!("{base}/device") {
        serve_device_registration(http_body(&request), &runtime)
    } else if method == "POST" && path == format!("{base}/login") {
        serve_login(
            http_body(&request),
            request_header_value(&request, "x-notia-device-id"),
            &publication.password_hash,
            &runtime,
            base,
        )
    } else if !authenticated {
        json_response(
            "401 Unauthorized",
            serde_json::json!({ "error": "Ingresá la contraseña para acceder." }),
        )
    } else if method == "GET" && path == format!("{base}/app") {
        serve_publication_index(assets.as_ref())
    } else if method == "GET" && path == format!("{base}/bootstrap") {
        json_response(
            "200 OK",
            serde_json::json!({
                "vaultPath": publication.vault_path,
                "theme": publication.theme,
                "settings": publication.settings,
                "aiPreferences": {
                    "ollamaUrl": "https://127.0.0.1:1",
                    "apiKey": "",
                    "selectedModel": publication.ai_preferences.selected_model,
                    "thinkingEnabled": publication.ai_preferences.thinking_enabled,
                    "thinkingLevel": publication.ai_preferences.thinking_level,
                }
            }),
        )
    } else if method == "POST" && path == format!("{base}/invoke") {
        serve_invoke(http_body(&request), &runtime, &publication)
    } else if method == "GET" && path.starts_with(&format!("{base}/assets/")) {
        serve_asset(
            assets.as_ref(),
            path.trim_start_matches(&format!("{base}/")),
        )
    } else {
        text_response("404 Not Found", "No existe.")
    };
    let _ = stream.write_all(&response);
}

#[cfg(target_os = "windows")]
fn read_http_request<S: Read>(stream: &mut S) -> Result<Vec<u8>, &'static str> {
    let mut request = Vec::with_capacity(8192);
    let mut buffer = [0_u8; 8192];
    let mut expected_size = None;
    loop {
        let read = stream.read(&mut buffer).map_err(|_| "400 Bad Request")?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.len() > MAX_HTTP_REQUEST_BYTES {
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

fn validate_publication_password(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if !(8..=256).contains(&length) {
        return Err("La contraseña debe tener entre 8 y 256 caracteres.".to_string());
    }
    Ok(())
}

fn format_password_hash(password: &[u8], salt: &[u8]) -> String {
    let derived = pbkdf2_hmac_sha256(password, salt, PASSWORD_HASH_ITERATIONS);
    format!(
        "$notia-pbkdf2-sha256$v=1$i={PASSWORD_HASH_ITERATIONS}${}${}",
        encode_hex(salt),
        encode_hex(&derived)
    )
}

fn is_valid_password_hash(encoded: &str) -> bool {
    parse_password_hash(encoded).is_some()
}

fn password_matches_hash(password: &[u8], encoded: &str) -> bool {
    let Some((salt, expected)) = parse_password_hash(encoded) else {
        return false;
    };
    let actual = pbkdf2_hmac_sha256(password, &salt, PASSWORD_HASH_ITERATIONS);
    actual
        .iter()
        .zip(expected.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn parse_password_hash(encoded: &str) -> Option<(Vec<u8>, [u8; 32])> {
    let parts = encoded.split('$').collect::<Vec<_>>();
    if parts.len() != 6
        || !parts[0].is_empty()
        || parts[1] != "notia-pbkdf2-sha256"
        || parts[2] != "v=1"
        || parts[3] != format!("i={PASSWORD_HASH_ITERATIONS}")
    {
        return None;
    }
    let salt = decode_hex(parts[4])?;
    let derived = decode_hex(parts[5])?;
    if salt.len() != 16 || derived.len() != 32 {
        return None;
    }
    Some((salt, derived.try_into().ok()?))
}

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut first_input = Vec::with_capacity(salt.len() + 4);
    first_input.extend_from_slice(salt);
    first_input.extend_from_slice(&1_u32.to_be_bytes());

    let mut current = hmac_sha256(password, &first_input);
    let mut derived = current;
    for _ in 1..iterations {
        current = hmac_sha256(password, &current);
        for (target, value) in derived.iter_mut().zip(current.iter()) {
            *target ^= value;
        }
    }
    derived
}

fn hmac_sha256(key: &[u8], value: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut normalized_key = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        normalized_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= normalized_key[index];
        outer_pad[index] ^= normalized_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(value);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(target_os = "windows")]
fn serve_login_page() -> Vec<u8> {
    const LOGIN_HTML: &str = r#"<!doctype html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notia · Task Manager</title><style>
:root{font-family:Manrope,"Segoe UI",sans-serif;color:#f8f8f2;background:#282a36;color-scheme:dark}*{box-sizing:border-box}
body{min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#3a3452,#21222c 62%)}
main{width:min(420px,100%);padding:30px;border:1px solid #44475a;border-radius:16px;background:#282a36;box-shadow:0 22px 60px #0008}
h1{margin:0 0 8px;font-size:24px}p{margin:0 0 22px;color:#a6accd;line-height:1.5}label{display:grid;gap:8px;font-size:13px;font-weight:700}
input,button{width:100%;min-height:48px;border-radius:10px;font:inherit}input{padding:0 13px;border:1px solid #6272a4;background:#21222c;color:#f8f8f2;outline:none}
input:focus{border-color:#8be9fd;box-shadow:0 0 0 3px #8be9fd33}button{margin-top:16px;border:0;background:#bd93f9;color:#181927;font-weight:800;cursor:pointer}
button:disabled{opacity:.65;cursor:wait}#error{min-height:20px;margin:12px 0 0;color:#ff6b7c;font-size:13px}.remember{display:flex;align-items:center;gap:9px;margin-top:14px;font-weight:500}.remember input{width:18px;min-height:18px;padding:0;accent-color:#bd93f9}
</style></head><body><main><h1>Task Manager</h1><p>Ingresá la contraseña configurada en Notia para acceder a los tableros publicados.</p>
<form id="login"><label>Contraseña<input id="password" type="password" minlength="8" maxlength="256" autocomplete="current-password" required autofocus></label>
<label class="remember"><input id="remember" type="checkbox">Recordar contraseña en este dispositivo</label>
<button id="submit" type="submit">Acceder</button><div id="error" role="alert" aria-live="polite"></div></form></main>
<script>
const form=document.getElementById('login'),password=document.getElementById('password'),remember=document.getElementById('remember'),button=document.getElementById('submit'),error=document.getElementById('error');
const base=location.pathname.replace(/\/+$/,'');
const deviceId=localStorage.getItem('notia-task-manager-device-id')||crypto.randomUUID().replaceAll('-','');localStorage.setItem('notia-task-manager-device-id',deviceId);
const passwordDatabase='notia-task-manager-passwords',passwordKey='password',encryptionKey='encryption-key';
function openPasswordDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(passwordDatabase,1);request.onupgradeneeded=()=>{const database=request.result;database.createObjectStore('passwords');database.createObjectStore('keys')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function getStoredValue(database,store,key){return new Promise((resolve,reject)=>{const request=database.transaction(store,'readonly').objectStore(store).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function putStoredValue(database,store,key,value){return new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readwrite');transaction.objectStore(store).put(value,key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error)})}
function deleteStoredValue(database,store,key){return new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readwrite');transaction.objectStore(store).delete(key);transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error)})}
function bytesToBase64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)))}function base64ToBytes(value){return Uint8Array.from(atob(value),character=>character.charCodeAt(0))}
async function getEncryptionKey(database){let key=await getStoredValue(database,'keys',encryptionKey);if(key)return key;key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await putStoredValue(database,'keys',encryptionKey,key);return key}
async function loadRememberedPassword(){const database=await openPasswordDatabase(),stored=await getStoredValue(database,'passwords',passwordKey);if(!stored)return null;const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(stored.iv)},await getEncryptionKey(database),base64ToBytes(stored.ciphertext));return new TextDecoder().decode(decrypted)}
async function saveRememberedPassword(value){const database=await openPasswordDatabase(),iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await getEncryptionKey(database),new TextEncoder().encode(value));await putStoredValue(database,'passwords',passwordKey,{iv:bytesToBase64(iv),ciphertext:bytesToBase64(encrypted)})}
async function clearRememberedPassword(){const database=await openPasswordDatabase();await deleteStoredValue(database,'passwords',passwordKey)}
void loadRememberedPassword().then((value)=>{if(value){password.value=value;remember.checked=true}}).catch(()=>{remember.checked=false});
form.addEventListener('submit',async(event)=>{event.preventDefault();event.stopImmediatePropagation();button.disabled=true;error.textContent='';try{const response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json','x-notia-device-id':deviceId},body:JSON.stringify({password:password.value})});const body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo iniciar sesion.');if(remember.checked)await saveRememberedPassword(password.value);else await clearRememberedPassword();location.assign(base+'/app');}catch(reason){error.textContent=reason instanceof Error?reason.message:'No se pudo iniciar sesion.';password.select();button.disabled=false;}},true);
async function register(){try{const response=await fetch(base+'/device',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId,deviceName:navigator.userAgent.slice(0,80)})});const body=await response.json();if(body.approved){password.disabled=false;button.disabled=false;error.textContent='Dispositivo autorizado. Ingresá la contraseña.';return true;}password.disabled=true;button.disabled=true;error.textContent='Esperando autorización desde Notia en la PC anfitriona.';}catch{password.disabled=true;button.disabled=true;error.textContent='No se pudo confirmar la autorización con Notia.';}return false;}void (async()=>{while(!await register())await new Promise((resolve)=>setTimeout(resolve,2000));})();
form.addEventListener('submit',async(event)=>{event.preventDefault();button.disabled=true;error.textContent='';try{const response=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json','x-notia-device-id':deviceId},body:JSON.stringify({password:password.value})});const body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo iniciar sesión.');location.assign(base+'/app');}catch(reason){error.textContent=reason instanceof Error?reason.message:'No se pudo iniciar sesión.';password.select();button.disabled=false;}});
</script></body></html>"#;
    response("200 OK", "text/html; charset=utf-8", LOGIN_HTML.as_bytes())
}

#[cfg(target_os = "windows")]
fn serve_device_registration(body: &[u8], runtime: &Arc<Mutex<PublicationRuntime>>) -> Vec<u8> {
    let input = serde_json::from_slice::<Value>(body).ok();
    let device_id = input
        .as_ref()
        .and_then(|value| value.get("deviceId"))
        .and_then(Value::as_str);
    let name = input
        .as_ref()
        .and_then(|value| value.get("deviceName"))
        .and_then(Value::as_str);
    let Some((device_id, name)) = device_id.zip(name).filter(|(id, name)| {
        id.len() >= 16
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            && !name.trim().is_empty()
    }) else {
        return json_error("Dispositivo inválido.");
    };
    let approved = runtime.lock().ok().is_some_and(|mut guard| {
        if guard.approved_devices.contains(device_id) {
            true
        } else {
            guard.pending_devices.insert(
                device_id.to_string(),
                name.trim().chars().take(80).collect(),
            );
            false
        }
    });
    json_response("200 OK", serde_json::json!({ "approved": approved }))
}

#[cfg(target_os = "windows")]
fn serve_login(
    body: &[u8],
    device_id: Option<String>,
    expected_hash: &str,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    publication_path: &str,
) -> Vec<u8> {
    let Some(device_id) = device_id.filter(|id| {
        runtime
            .lock()
            .ok()
            .is_some_and(|guard| guard.approved_devices.contains(id))
    }) else {
        return json_response(
            "403 Forbidden",
            serde_json::json!({ "error": "Esperá la autorización del dispositivo desde Notia." }),
        );
    };
    let password = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("password")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    let Some(password) = password else {
        return json_error("Ingresá la contraseña.");
    };
    if validate_publication_password(&password).is_err() {
        return json_error("Contraseña incorrecta.");
    }
    let verified = password_matches_hash(password.as_bytes(), expected_hash);
    if !verified {
        return json_error("Contraseña incorrecta.");
    }

    let session = generate_session_token();
    let inserted = runtime.lock().ok().is_some_and(|mut guard| {
        let hash_is_current = guard
            .payload
            .as_ref()
            .is_some_and(|payload| payload.password_hash == expected_hash);
        if !hash_is_current {
            return false;
        }
        if guard.authenticated_sessions.len() >= 64 {
            guard.authenticated_sessions.clear();
        }
        if !guard.approved_devices.contains(&device_id) {
            return false;
        }
        guard
            .authenticated_sessions
            .insert(session.clone(), device_id);
        true
    });
    if !inserted {
        return json_error("La publicación cambió. Volvé a intentarlo.");
    }

    let cookie = format!(
        "Set-Cookie: notia_task_session={session}; Secure; HttpOnly; SameSite=Strict; Path={publication_path}; Max-Age=43200"
    );
    json_response_with_headers(
        "200 OK",
        serde_json::json!({ "ok": true }),
        &[cookie.as_str()],
    )
}

#[cfg(target_os = "windows")]
fn request_session_token(request: &[u8]) -> Option<&str> {
    let header_end = find_header_end(request)?;
    let headers = std::str::from_utf8(&request[..header_end]).ok()?;
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if !name.eq_ignore_ascii_case("cookie") {
            return None;
        }
        value.split(';').find_map(|cookie| {
            let (cookie_name, cookie_value) = cookie.trim().split_once('=')?;
            (cookie_name == "notia_task_session").then_some(cookie_value)
        })
    })
}

#[cfg(target_os = "windows")]
fn serve_invoke(
    body: &[u8],
    runtime: &Arc<Mutex<PublicationRuntime>>,
    publication: &TaskManagerPublicationPayload,
) -> Vec<u8> {
    let request: Value = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(_) => return json_error("Solicitud inválida."),
    };
    let Some(command) = request.get("command").and_then(Value::as_str) else {
        return json_error("Operación inválida.");
    };
    let payload = request
        .get("args")
        .and_then(|args| args.get("payload"))
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(result) = virtual_publication_result(command, &payload, publication) {
        return json_response("200 OK", serde_json::json!({ "result": result }));
    }
    if let Some(response) = serve_publication_ai_command(command, &payload, publication) {
        return response;
    }
    if !authorize_command(command, &payload, publication) {
        return json_error("La URL solo puede acceder a los tableros publicados.");
    }
    match crate::filesystem::commands::execute_desktop_filesystem_command(command, payload) {
        Ok(result) => {
            if is_mutating_publication_command(command) {
                notify_publication_changed(runtime, &publication.vault_path);
            }
            json_response(
                "200 OK",
                serde_json::json!({ "result": filter_publication_result(command, result, publication) }),
            )
        }
        Err(error) => json_error(&error),
    }
}

#[cfg(target_os = "windows")]
fn is_mutating_publication_command(command: &str) -> bool {
    matches!(
        command,
        "write_library_file" | "create_library_entry" | "library_entry_operation"
    )
}

#[cfg(target_os = "windows")]
fn notify_publication_changed(runtime: &Arc<Mutex<PublicationRuntime>>, vault_path: &str) {
    let app_handle = match runtime.lock() {
        Ok(mut guard) => {
            guard
                .change_subscribers
                .retain(|sender| sender.send(()).is_ok());
            guard.app_handle.clone()
        }
        Err(_) => return,
    };
    if let Some(app_handle) = app_handle {
        let _ = app_handle.emit(
            "task-manager-publication-changed",
            serde_json::json!({ "vaultPath": vault_path }),
        );
    }
}

#[cfg(target_os = "windows")]
fn serve_publication_events<S: Write>(
    stream: &mut S,
    runtime: &Arc<Mutex<PublicationRuntime>>,
    vault_path: &str,
) {
    let (sender, receiver) = mpsc::channel();
    if let Ok(mut guard) = runtime.lock() {
        guard.change_subscribers.push(sender);
    } else {
        return;
    }
    let headers = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: text/event-stream; charset=utf-8\r\n",
        "Cache-Control: no-cache\r\n",
        "Connection: keep-alive\r\n\r\n"
    );
    if stream.write_all(headers.as_bytes()).is_err() {
        return;
    }
    let initial = serde_json::json!({ "vaultPath": vault_path });
    if writeln!(stream, ": connected\ndata: {}\n", initial).is_err() || stream.flush().is_err() {
        return;
    }
    loop {
        match receiver.recv_timeout(std::time::Duration::from_secs(25)) {
            Ok(()) => {
                if writeln!(stream, "event: changed\ndata: {}\n", initial).is_err()
                    || stream.flush().is_err()
                {
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if writeln!(stream, ": keep-alive\n").is_err() || stream.flush().is_err() {
                    return;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[cfg(target_os = "windows")]
fn serve_publication_ai_command(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Option<Vec<u8>> {
    let settings = crate::services::ai_service::AiHttpSettings {
        ollama_url: publication.ai_preferences.ollama_url.clone(),
        api_key: publication.ai_preferences.api_key.clone(),
    };
    match command {
        "list_desktop_ai_models" => Some(
            match tauri::async_runtime::block_on(crate::services::ai_service::list_ollama_models(
                &settings,
            )) {
                Ok(result) => json_response("200 OK", serde_json::json!({ "result": result })),
                Err(error) => json_error(&error),
            },
        ),
        "run_desktop_ai_tool_chat" => {
            let messages = payload.get("messages").cloned().unwrap_or(Value::Null);
            let tools = payload.get("tools").cloned().unwrap_or(Value::Null);
            let think = payload.get("think").cloned().unwrap_or(Value::Bool(false));
            let requested_model = payload
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let model = if publication.ai_preferences.selected_model.trim().is_empty() {
                requested_model
            } else {
                publication.ai_preferences.selected_model.as_str()
            };
            let timeout_seconds = payload
                .get("timeoutSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(600);
            if !(1..=600).contains(&timeout_seconds) {
                return Some(json_error("El tiempo de espera de IA no es vÃ¡lido."));
            }
            Some(
                match tauri::async_runtime::block_on(
                    crate::services::ai_service::run_ollama_tool_chat(
                        &settings,
                        model,
                        &messages,
                        &tools,
                        &think,
                        timeout_seconds,
                    ),
                ) {
                    Ok(result) => json_response("200 OK", serde_json::json!({ "result": result })),
                    Err(error) => json_error(&error),
                },
            )
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn serve_publication_ai_stream<S: Write>(
    stream: &mut S,
    body: &[u8],
    publication: &TaskManagerPublicationPayload,
) {
    let request = match serde_json::from_slice::<PublishedAiStreamRequest>(body) {
        Ok(request) => request,
        Err(_) => {
            let _ = stream.write_all(&json_error("Solicitud de streaming invÃ¡lida."));
            return;
        }
    };
    let model = if publication.ai_preferences.selected_model.trim().is_empty() {
        request.model.as_str()
    } else {
        publication.ai_preferences.selected_model.as_str()
    };
    let settings = crate::services::ai_service::AiHttpSettings {
        ollama_url: publication.ai_preferences.ollama_url.clone(),
        api_key: publication.ai_preferences.api_key.clone(),
    };
    let headers = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: application/x-ndjson; charset=utf-8\r\n",
        "Transfer-Encoding: chunked\r\n",
        "Cache-Control: no-store, no-transform\r\n",
        "X-Content-Type-Options: nosniff\r\n",
        "Connection: close\r\n\r\n"
    );
    if stream.write_all(headers.as_bytes()).is_err() || stream.flush().is_err() {
        return;
    }

    let result = tauri::async_runtime::block_on(crate::services::ai_service::stream_ollama_chat(
        &settings,
        model,
        &request.messages,
        &request.think,
        |delta| {
            let event = match delta {
                crate::services::ai_service::AiChatStreamDelta::Thinking(delta) => {
                    serde_json::json!({ "type": "thinking", "delta": delta })
                }
                crate::services::ai_service::AiChatStreamDelta::Content(delta) => {
                    serde_json::json!({ "type": "delta", "delta": delta })
                }
            };
            let _ = write_chunked_json_line(stream, &event);
        },
    ));
    let final_event = match result {
        Ok(answer) => serde_json::json!({ "type": "done", "answer": answer }),
        Err(message) => serde_json::json!({ "type": "error", "message": message }),
    };
    let _ = write_chunked_json_line(stream, &final_event);
    let _ = stream.write_all(b"0\r\n\r\n");
    let _ = stream.flush();
}

#[cfg(target_os = "windows")]
fn write_chunked_json_line<S: Write>(stream: &mut S, value: &Value) -> std::io::Result<()> {
    let mut body = serde_json::to_vec(value).unwrap_or_else(|_| {
        b"{\"type\":\"error\",\"message\":\"No se pudo serializar el stream.\"}".to_vec()
    });
    body.push(b'\n');
    write!(stream, "{:X}\r\n", body.len())?;
    stream.write_all(&body)?;
    stream.write_all(b"\r\n")?;
    stream.flush()
}

#[cfg(target_os = "windows")]
fn virtual_publication_result(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> Option<Value> {
    let path = filesystem_paths(payload).into_iter().next()?;
    if is_virtual_publication_directory(&path, publication) {
        return match command {
            "path_exists" => Some(serde_json::json!({ "exists": true })),
            "is_directory_path" => Some(serde_json::json!({ "isDirectory": true })),
            _ => None,
        };
    }
    if !is_virtual_publication_file(&path, publication) {
        return None;
    }
    match command {
        "read_library_file" => {
            Some(serde_json::json!({ "ok": true, "content": "", "error": null }))
        }
        "write_library_file" => Some(serde_json::json!({ "ok": true, "error": null })),
        "path_exists" => Some(serde_json::json!({ "exists": true })),
        "is_directory_path" => Some(serde_json::json!({ "isDirectory": false })),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn is_virtual_publication_directory(
    path: &str,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    if selected_board_names(publication)
        .iter()
        .any(|name| name == "default")
    {
        return false;
    }
    task_roots(publication)
        .iter()
        .any(|root| path == format!("{root}/default") || path == format!("{root}/default/subtasks"))
}

#[cfg(target_os = "windows")]
fn is_virtual_publication_file(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    task_roots(publication).iter().any(|root| {
        matches!(
            path.strip_prefix(&format!("{root}/")),
            Some(
                "taskindex.md"
                    | "pomodoro.md"
                    | "finished/taskindexfinished.md"
                    | "cancelled/taskindexcancelled.md"
                    | "default/defaulttaskindex.md"
            )
        )
    })
}

#[cfg(target_os = "windows")]
fn authorize_command(
    command: &str,
    payload: &Value,
    publication: &TaskManagerPublicationPayload,
) -> bool {
    const COMMANDS: &[&str] = &[
        "read_library_tree",
        "read_markdown_files",
        "read_library_file",
        "write_library_file",
        "path_exists",
        "is_directory_path",
        "create_library_entry",
        "library_entry_operation",
    ];
    if !COMMANDS.contains(&command) {
        return false;
    }
    let paths = filesystem_paths(payload);
    if paths.iter().any(|path| path.contains("..")) {
        return false;
    }
    if matches!(command, "read_markdown_files" | "read_library_tree") {
        return paths.iter().all(|path| is_tasks_root(path, publication));
    }
    paths.iter().all(|path| {
        is_tasks_root(path, publication)
            || is_selected_board_path(path, publication)
            || is_authorized_archived_path(path, publication)
    })
}

#[cfg(target_os = "windows")]
fn filesystem_paths(payload: &Value) -> Vec<String> {
    const KEYS: &[&str] = &[
        "directoryPath",
        "filePath",
        "path",
        "targetPath",
        "sourcePath",
        "targetDirectoryPath",
    ];
    let Some(object) = payload.as_object() else {
        return Vec::new();
    };
    KEYS.iter()
        .filter_map(|key| object.get(*key).and_then(Value::as_str))
        .map(normalize_path)
        .collect()
}

#[cfg(target_os = "windows")]
fn filter_publication_result(
    command: &str,
    result: Value,
    publication: &TaskManagerPublicationPayload,
) -> Value {
    if command != "read_markdown_files" {
        return result;
    }
    match result {
        Value::Array(documents) => Value::Array(
            documents
                .into_iter()
                .filter(|document| {
                    let path = document
                        .get("path")
                        .and_then(Value::as_str)
                        .map(normalize_path)
                        .unwrap_or_default();
                    is_selected_board_path(&path, publication)
                        || document
                            .get("content")
                            .and_then(Value::as_str)
                            .is_some_and(|content| content_has_selected_board(content, publication))
                })
                .collect(),
        ),
        other => other,
    }
}

#[cfg(target_os = "windows")]
fn is_tasks_root(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    task_roots(publication).iter().any(|root| path == root)
}

#[cfg(target_os = "windows")]
fn is_selected_board_path(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    selected_board_roots(publication)
        .iter()
        .any(|root| path == root || path.starts_with(&format!("{root}/")))
}

#[cfg(target_os = "windows")]
fn is_authorized_archived_path(path: &str, publication: &TaskManagerPublicationPayload) -> bool {
    let is_archive = task_roots(publication).iter().any(|root| {
        path.starts_with(&format!("{root}/finished"))
            || path.starts_with(&format!("{root}/cancelled"))
            || path.starts_with(&format!("{root}/completadas"))
    });
    if !is_archive {
        return false;
    }
    if std::path::Path::new(path).is_dir() {
        return true;
    }
    std::fs::read_to_string(path)
        .ok()
        .is_some_and(|content| content_has_selected_board(&content, publication))
}

#[cfg(target_os = "windows")]
fn content_has_selected_board(content: &str, publication: &TaskManagerPublicationPayload) -> bool {
    let selected = selected_board_names(publication);
    frontmatter_board_name(content).is_some_and(|board| selected.contains(&board))
}

#[cfg(target_os = "windows")]
fn frontmatter_board_name(content: &str) -> Option<String> {
    let mut lines = content.trim_start_matches('\u{feff}').lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            return None;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("tablero") {
            let board = value.trim().trim_matches(['\'', '"']).trim().to_lowercase();
            return (!board.is_empty()).then_some(board);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn selected_board_names(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    publication
        .boards
        .iter()
        .map(|board| board.name.trim().to_lowercase())
        .collect()
}

#[cfg(target_os = "windows")]
fn task_roots(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    let vault = normalize_path(&publication.vault_path);
    vec![
        format!("{vault}/task-mannager"),
        format!("{vault}/task-manager"),
    ]
}

#[cfg(target_os = "windows")]
fn selected_board_roots(publication: &TaskManagerPublicationPayload) -> Vec<String> {
    task_roots(publication)
        .into_iter()
        .flat_map(|root| {
            selected_board_names(publication)
                .into_iter()
                .map(move |board| format!("{root}/{board}"))
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn serve_publication_index(assets: &tauri::AssetResolver<tauri::Wry>) -> Vec<u8> {
    let Some(asset) = assets.get("public-task-manager.html".to_string()) else {
        return text_response(
            "503 Service Unavailable",
            "Los recursos de Task Manager no están disponibles.",
        );
    };
    let html = String::from_utf8_lossy(asset.bytes()).replace(
        "/assets/",
        &format!("{TASK_MANAGER_PUBLICATION_PATH}/assets/"),
    );
    response("200 OK", "text/html; charset=utf-8", html.as_bytes())
}

#[cfg(target_os = "windows")]
fn serve_asset(assets: &tauri::AssetResolver<tauri::Wry>, relative_path: &str) -> Vec<u8> {
    if relative_path.contains("..") {
        return text_response("404 Not Found", "No existe.");
    }
    match assets.get(relative_path.to_string()) {
        Some(asset) => response("200 OK", asset.mime_type(), asset.bytes()),
        None => text_response("404 Not Found", "No existe."),
    }
}

#[cfg(target_os = "windows")]
fn local_network_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            socket.connect("8.8.8.8:80")?;
            socket.local_addr()
        })
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

#[cfg(target_os = "windows")]
fn publication_url(port: u16) -> String {
    format!(
        "https://{}:{port}{TASK_MANAGER_PUBLICATION_PATH}",
        local_network_ip()
    )
}

#[cfg(target_os = "windows")]
fn publication_port(runtime: &Arc<Mutex<PublicationRuntime>>) -> Result<u16, String> {
    runtime
        .lock()
        .map_err(|_| "No se pudo consultar la publicación.")?
        .port
        .ok_or_else(|| "La publicación no está disponible.".to_string())
}

#[cfg(target_os = "windows")]
fn generate_session_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(target_os = "windows")]
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

#[cfg(target_os = "windows")]
fn request_line_parts(request: &[u8]) -> Option<(&str, String)> {
    let line_end = request.windows(2).position(|window| window == b"\r\n")?;
    let line = std::str::from_utf8(&request[..line_end]).ok()?;
    let mut parts = line.split_whitespace();
    Some((parts.next()?, parts.next()?.split('?').next()?.to_string()))
}

#[cfg(target_os = "windows")]
fn request_host(request: &[u8]) -> Option<String> {
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

#[cfg(target_os = "windows")]
fn request_header_value(request: &[u8], header_name: &str) -> Option<String> {
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

#[cfg(target_os = "windows")]
fn find_header_end(request: &[u8]) -> Option<usize> {
    request.windows(4).position(|window| window == b"\r\n\r\n")
}

#[cfg(target_os = "windows")]
fn parse_content_length(headers: &[u8]) -> usize {
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

#[cfg(target_os = "windows")]
fn http_body(request: &[u8]) -> &[u8] {
    find_header_end(request)
        .map(|index| &request[index + 4..])
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn json_response(status: &str, value: Value) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    response(status, "application/json; charset=utf-8", &body)
}

#[cfg(target_os = "windows")]
fn json_response_with_headers(status: &str, value: Value, headers: &[&str]) -> Vec<u8> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    response_with_headers(status, "application/json; charset=utf-8", &body, headers)
}

#[cfg(target_os = "windows")]
fn json_error(message: &str) -> Vec<u8> {
    json_response("400 Bad Request", serde_json::json!({ "error": message }))
}

#[cfg(target_os = "windows")]
fn text_response(status: &str, message: &str) -> Vec<u8> {
    response(status, "text/plain; charset=utf-8", message.as_bytes())
}

#[cfg(target_os = "windows")]
fn response(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    response_with_headers(status, content_type, body, &[])
}

#[cfg(target_os = "windows")]
fn response_with_headers(
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    fn publication() -> TaskManagerPublicationPayload {
        TaskManagerPublicationPayload {
            vault_path: "C:/Vault".to_string(),
            theme: "dark".to_string(),
            password_hash: hash_task_manager_publication_password("contraseña-segura".to_string())
                .expect("password hash"),
            approved_devices: Vec::new(),
            port: 52471,
            ai_preferences: PublishedAiPreferences {
                ollama_url: "https://ollama.example".to_string(),
                api_key: String::new(),
                selected_model: "qwen3".to_string(),
                thinking_enabled: true,
                thinking_level: "medium".to_string(),
            },
            settings: Value::Null,
            boards: vec![PublishedBoard {
                name: "equipo".to_string(),
                color: "#123456".to_string(),
                groups: Vec::new(),
                tasks: Vec::new(),
            }],
        }
    }

    #[test]
    fn writes_ai_stream_events_as_http_chunks() {
        let mut output = Vec::new();
        write_chunked_json_line(
            &mut output,
            &serde_json::json!({ "type": "delta", "delta": "Hola" }),
        )
        .expect("stream chunk");

        let text = String::from_utf8(output).expect("utf8 chunk");
        let (size, remainder) = text.split_once("\r\n").expect("chunk size");
        let (body, ending) = remainder.split_once("\r\n").expect("chunk ending");
        assert_eq!(
            usize::from_str_radix(size, 16).expect("hex size"),
            body.len()
        );
        assert_eq!(ending, "");
        assert_eq!(
            serde_json::from_str::<Value>(body.trim()).expect("json body"),
            serde_json::json!({ "type": "delta", "delta": "Hola" })
        );
    }

    #[test]
    fn filters_documents_outside_published_boards() {
        let result = filter_publication_result(
            "read_markdown_files",
            serde_json::json!([
                { "path": "C:/Vault/task-mannager/equipo/visible.md", "content": "---\ntablero: equipo\n---" },
                { "path": "C:/Vault/task-mannager/privado/oculta.md", "content": "---\ntablero: privado\n---" },
                { "path": "C:/Vault/task-mannager/finished/visible.md", "content": "---\ntablero: equipo\n---" },
                { "path": "C:/Vault/task-mannager/finished/oculta.md", "content": "---\ntablero: privado\n---" },
                { "path": "C:/Vault/task-mannager/cancelled/sin-tablero.md", "content": "---\nestado: Cancelada\n---\n\ntablero: equipo" }
            ]),
            &publication(),
        );

        let documents = result.as_array().expect("filtered document array");
        assert_eq!(documents.len(), 2);
        assert!(documents.iter().all(|document| {
            document["path"]
                .as_str()
                .is_some_and(|path| !path.contains("privado"))
        }));
    }

    #[test]
    fn virtualizes_shared_indexes_needed_during_initialization() {
        let result = virtual_publication_result(
            "read_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/taskIndex.md" }),
            &publication(),
        );

        assert_eq!(
            result,
            Some(serde_json::json!({ "ok": true, "content": "", "error": null }))
        );
    }

    #[test]
    fn authorizes_selected_task_and_rejects_private_task() {
        let published = authorize_command(
            "write_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/equipo/ticket.md" }),
            &publication(),
        );
        let private = authorize_command(
            "write_library_file",
            &serde_json::json!({ "filePath": "C:/Vault/task-mannager/privado/ticket.md" }),
            &publication(),
        );

        assert!(published);
        assert!(!private);
    }

    #[test]
    fn hashes_and_verifies_publication_passwords() {
        let password = "clave-segura-123";
        let hash = hash_task_manager_publication_password(password.to_string())
            .expect("PBKDF2 password hash");

        assert_ne!(hash, password);
        assert!(hash.starts_with("$notia-pbkdf2-sha256$"));
        assert!(password_matches_hash(password.as_bytes(), &hash));
        assert!(!password_matches_hash(b"incorrecta", &hash));
    }

    #[test]
    fn pbkdf2_matches_the_sha256_reference_vector() {
        assert_eq!(
            encode_hex(&pbkdf2_hmac_sha256(b"password", b"salt", 1)),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
        assert_eq!(
            encode_hex(&pbkdf2_hmac_sha256(b"password", b"salt", 2)),
            "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
        );
    }

    #[test]
    fn rejects_short_publication_passwords() {
        assert!(hash_task_manager_publication_password("corta".to_string()).is_err());
    }

    #[test]
    fn creates_a_tls_certificate_accepted_by_rustls() {
        let directory = std::env::temp_dir().join(format!(
            "notia-task-manager-publication-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).expect("certificate test directory");
        let certificate_path = directory.join("certificate.der");
        let private_key_path = directory.join("private-key.der");
        let certificate_version_path = directory.join("version");
        let (certificate, private_key) = create_publication_certificate(
            &certificate_path,
            &private_key_path,
            &certificate_version_path,
        )
        .expect("self-signed certificate");

        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(certificate)],
                PrivateKeyDer::Pkcs8(private_key.into()),
            );

        assert!(config.is_ok());
        assert_eq!(
            fs::read_to_string(&certificate_version_path)
                .expect("certificate version")
                .trim(),
            PUBLICATION_CERTIFICATE_VERSION
        );
        fs::remove_dir_all(&directory).expect("remove certificate test directory");
    }

    #[test]
    fn reads_only_a_safe_host_header_for_https_redirects() {
        let request = b"GET /task-manager HTTP/1.1\r\nHost: 100.81.158.210:61522\r\n\r\n";
        assert_eq!(
            request_host(request).as_deref(),
            Some("100.81.158.210:61522")
        );

        let unsafe_request = b"GET / HTTP/1.1\r\nHost: bad host\r\n\r\n";
        assert_eq!(request_host(unsafe_request), None);
    }

    #[test]
    fn login_creates_an_http_only_session_only_for_the_correct_password() {
        let publication = publication();
        let runtime = Arc::new(Mutex::new(PublicationRuntime {
            payload: Some(publication.clone()),
            approved_devices: HashSet::from(["device-identifier-1234".to_string()]),
            ..PublicationRuntime::default()
        }));

        let rejected = serve_login(
            br#"{"password":"incorrecta"}"#,
            Some("device-identifier-1234".to_string()),
            &publication.password_hash,
            &runtime,
            TASK_MANAGER_PUBLICATION_PATH,
        );
        assert!(String::from_utf8_lossy(&rejected).starts_with("HTTP/1.1 400"));
        assert!(runtime
            .lock()
            .expect("runtime")
            .authenticated_sessions
            .is_empty());

        let accepted = serve_login(
            r#"{"password":"contraseña-segura"}"#.as_bytes(),
            Some("device-identifier-1234".to_string()),
            &publication.password_hash,
            &runtime,
            TASK_MANAGER_PUBLICATION_PATH,
        );
        let response = String::from_utf8_lossy(&accepted);
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.contains("Secure; HttpOnly; SameSite=Strict; Path=/task-manager"));
        assert_eq!(
            runtime
                .lock()
                .expect("runtime")
                .authenticated_sessions
                .len(),
            1
        );
    }
}
