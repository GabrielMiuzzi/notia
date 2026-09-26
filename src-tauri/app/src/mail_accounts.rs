//! Commands of the settings' «Cuentas asociadas»: the library's Google Cloud
//! client (Client ID and Client secret, typed or imported from the JSON
//! Google downloads) and the Gmail account connected with the OAuth flow of
//! `backend_core::mail_accounts`. The browser signs in at Google and comes
//! back to a listener on the loopback address. The client and the tokens
//! are kept in `.notia/notiaConfig.json` of the library and never reach the
//! WebView.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::backend::mail_accounts::{
    authorization_url, check_room_for, client_check_body, client_check_result, code_exchange_body, find_account,
    google_cloud_client, mail_accounts_view, parse_google_client_json, parse_redirect, parse_token_response,
    profile_email, stored_account, validate_google_client, with_account_type, with_google_cloud, with_mail_account,
    without_mail_account, without_mail_accounts, AuthorizationRequest, GrantedTokens, MailAccountType,
    MailAccountsView, MailProvider, OAuthClient, RedirectOutcome, REDIRECT_HOST,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::AppHandle;

/// How long the browser has to come back with the authorization.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(150);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECT_REQUEST_BYTES: usize = 16 * 1024;
/// The JSON Google downloads for a client is well under a kilobyte.
const MAX_CLIENT_JSON_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailAccountsPayload {
    library_id: String,
    #[serde(default)]
    provider: Option<String>,
    /// Address of the account a command changes (or reconnects).
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    account_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleCloudPayload {
    #[serde(default)]
    library_id: String,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    client_secret: String,
}

/// Client ID and Client secret read from the JSON Google downloads, to fill
/// the form before saving.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleCloudCredentials {
    client_id: String,
    client_secret: String,
}

fn provider_of(payload: &MailAccountsPayload) -> Result<MailProvider, BackendError> {
    MailProvider::parse(payload.provider.as_deref().unwrap_or("gmail"))
}

fn email_of(payload: &MailAccountsPayload) -> Result<String, BackendError> {
    payload
        .email
        .as_deref()
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(str::to_string)
        .ok_or_else(|| BackendError::invalid_input("Falta la dirección de la cuenta."))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0)
}

/// Random text of URL-safe characters, for the PKCE verifier and the state.
fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buffer);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer)
}

fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn internal() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo completar la operación.", true)
}

fn unreachable_provider() -> BackendError {
    BackendError::new(
        BackendErrorCode::ProviderUnavailable,
        "No se pudo comunicar con Google. Revisá la conexión a internet.",
        true,
    )
}

fn not_configured() -> BackendError {
    BackendError::new(
        BackendErrorCode::Unsupported,
        "Configurá las credenciales de Google Cloud antes de conectar la cuenta.",
        false,
    )
}

// ---------- The connection waiting for the browser ----------

/// Cancel flag of the connection waiting for the browser; one at a time.
fn pending_connection() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    static PENDING: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

/// Starts waiting for a new connection and cancels the one before it.
fn begin_pending() -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut pending) = pending_connection().lock() {
        if let Some(previous) = pending.replace(flag.clone()) {
            previous.store(true, Ordering::SeqCst);
        }
    }
    flag
}

fn end_pending(flag: &Arc<AtomicBool>) {
    if let Ok(mut pending) = pending_connection().lock() {
        if pending.as_ref().is_some_and(|current| Arc::ptr_eq(current, flag)) {
            *pending = None;
        }
    }
}

/// Keeps the Android process alive while the browser is in front.
struct AndroidWork<'a>(&'a AppHandle);

impl<'a> AndroidWork<'a> {
    fn begin(app: &'a AppHandle) -> Self {
        use crate::host::Manager;
        crate::mobile_continuity::begin_android_work(&app.state::<crate::mobile_continuity::ContinuityState>(), Some("dataSync"));
        Self(app)
    }
}

impl Drop for AndroidWork<'_> {
    fn drop(&mut self) {
        use crate::host::Manager;
        crate::mobile_continuity::end_android_work(&self.0.state::<crate::mobile_continuity::ContinuityState>());
    }
}

/// Listener on the loopback address, on a free port.
struct Loopback {
    listener: TcpListener,
    port: u16,
}

fn bind_loopback() -> Result<Loopback, BackendError> {
    let unavailable = || BackendError::new(BackendErrorCode::Unsupported, "No se pudo preparar la vuelta del navegador.", true);
    let listener = TcpListener::bind((REDIRECT_HOST, 0)).map_err(|_| unavailable())?;
    let port = listener.local_addr().map_err(|_| unavailable())?.port();
    listener.set_nonblocking(true).map_err(|_| unavailable())?;
    Ok(Loopback { listener, port })
}

fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Page the browser shows once it is back.
fn respond(mut stream: TcpStream, status: &str, title: &str, message: &str) {
    let body = format!(
        "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Notia</title></head>\
         <body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0F1420;color:#EDF0F5;font-family:system-ui,sans-serif\">\
         <main style=\"max-width:420px;padding:32px;text-align:center\"><h1 style=\"font-size:20px;margin:0 0 8px\">{}</h1><p style=\"margin:0;color:#8892A6;line-height:1.5\">{}</p></main></body></html>",
        html_escape(title),
        html_escape(message),
    );
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Reads one request; `None` when it was not the redirect (keep waiting).
fn answer(mut stream: TcpStream, state: &str) -> Option<Result<String, BackendError>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut request = Vec::new();
    let mut chunk = [0u8; 2048];
    while request.len() < MAX_REDIRECT_REQUEST_BYTES && !request.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => request.extend_from_slice(&chunk[..read]),
        }
    }
    let text = String::from_utf8_lossy(&request);
    let target = text.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or_default();
    match parse_redirect(target, state) {
        Ok(RedirectOutcome::Ignored) => {
            respond(stream, "404 Not Found", "Notia", "");
            None
        }
        Ok(RedirectOutcome::Code(code)) => {
            respond(stream, "200 OK", "Listo", "Notia está terminando de conectar la cuenta. Ya podés cerrar esta pestaña y volver a Notia.");
            Some(Ok(code))
        }
        Err(error) => {
            respond(stream, "200 OK", "No se pudo conectar la cuenta", &error.message);
            Some(Err(error))
        }
    }
}

/// Waits for the browser's redirect and returns the authorization code.
fn wait_for_code(loopback: Loopback, state: &str, cancel: &AtomicBool) -> Result<String, BackendError> {
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(BackendError::new(BackendErrorCode::Cancelled, "Se canceló la conexión de la cuenta.", true));
        }
        if Instant::now() >= deadline {
            return Err(BackendError::new(
                BackendErrorCode::Timeout,
                "No se completó el inicio de sesión a tiempo. Volvé a intentar.",
                true,
            ));
        }
        if let Ok((stream, _)) = loopback.listener.accept() {
            if let Some(result) = answer(stream, state) {
                return result;
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn open_browser(app: &AppHandle, url: &str) -> Result<(), BackendError> {
    #[cfg(not(target_os = "android"))]
    let failed = || BackendError::new(BackendErrorCode::Unsupported, "No se pudo abrir el navegador.", true);
    #[cfg(target_os = "android")]
    {
        use crate::host::Manager;
        crate::mobile_continuity::open_android_url(&app.state::<crate::mobile_continuity::ContinuityState>(), url)
            .map_err(|message| BackendError::new(BackendErrorCode::Unsupported, message, true))
    }
    // `cmd start` would split the address at every `&`; the URL protocol
    // handler takes it whole.
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map(|_| ())
            .map_err(|_| failed())
    }
    #[cfg(not(any(target_os = "android", target_os = "windows")))]
    {
        let _ = app;
        std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ()).map_err(|_| failed())
    }
}

// ---------- Google's endpoints ----------

fn http_client() -> Result<reqwest::Client, BackendError> {
    reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build().map_err(|_| unreachable_provider())
}

/// POSTs a form to Google's token endpoint and reads its JSON answer, also
/// when it is an error.
async fn post_token_form(provider: MailProvider, body: String) -> Result<Value, BackendError> {
    let response = http_client()?
        .post(provider.token_endpoint())
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(reqwest::header::ACCEPT, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| unreachable_provider())?;
    response.json::<Value>().await.map_err(|_| unreachable_provider())
}

async fn exchange_code(
    provider: MailProvider,
    client: &OAuthClient,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<GrantedTokens, BackendError> {
    parse_token_response(&post_token_form(provider, code_exchange_body(client, code, verifier, redirect_uri)).await?)
}

async fn fetch_email(provider: MailProvider, access_token: &str) -> Result<String, BackendError> {
    let response = http_client()?
        .get(provider.profile_endpoint())
        .bearer_auth(access_token)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| unreachable_provider())?;
    let unreadable = || BackendError::new(BackendErrorCode::ProviderUnavailable, "No se pudo leer la dirección de la cuenta.", true);
    if !response.status().is_success() {
        return Err(unreadable());
    }
    let profile = response.json::<Value>().await.map_err(|_| unreadable())?;
    profile_email(&profile).ok_or_else(unreadable)
}

// ---------- Commands ----------

async fn blocking<T: Send + 'static>(task: impl FnOnce() -> Result<T, BackendError> + Send + 'static) -> Result<T, BackendError> {
    crate::host::async_runtime::spawn_blocking(task).await.map_err(|_| internal())?
}

fn read_config(app: &AppHandle, library_id: &str) -> Result<Option<Value>, BackendError> {
    crate::library_config::read_library_config(app, library_id)
}

fn update_view(app: &AppHandle, library_id: &str, change: impl FnOnce(Value) -> Value) -> Result<MailAccountsView, BackendError> {
    let config = crate::library_config::update_library_config(app, library_id, change)?;
    Ok(mail_accounts_view(Some(&config)))
}

/// Whether the library has a Google Cloud client and which account is connected.
pub(crate) async fn backend_mail_accounts(app: AppHandle, payload: MailAccountsPayload) -> Result<MailAccountsView, BackendError> {
    blocking(move || Ok(mail_accounts_view(read_config(&app, &payload.library_id)?.as_ref()))).await
}

/// Stores the Google Cloud client the person entered.
pub(crate) async fn backend_save_google_cloud_credentials(app: AppHandle, payload: GoogleCloudPayload) -> Result<MailAccountsView, BackendError> {
    let client = validate_google_client(&payload.client_id, &payload.client_secret)?;
    blocking(move || update_view(&app, &payload.library_id, |config| with_google_cloud(&config, Some(&client)))).await
}

/// Asks Google whether the Client ID and Client secret belong together,
/// without signing in; the form's values are checked before saving them.
pub(crate) async fn backend_check_google_cloud_credentials(payload: GoogleCloudPayload) -> Result<(), BackendError> {
    let client = validate_google_client(&payload.client_id, &payload.client_secret)?;
    client_check_result(&post_token_form(MailProvider::Gmail, client_check_body(&client)).await?)
}

/// Removes the Google Cloud client and, since they cannot connect without
/// one, the Gmail accounts.
pub(crate) async fn backend_remove_google_cloud_credentials(app: AppHandle, payload: GoogleCloudPayload) -> Result<MailAccountsView, BackendError> {
    blocking(move || update_view(&app, &payload.library_id, |config| without_mail_accounts(&with_google_cloud(&config, None)))).await
}

fn read_picked_json(app: &AppHandle, file: crate::host::dialog::FilePath) -> Result<String, BackendError> {
    let unreadable = || BackendError::new(BackendErrorCode::Storage, "No se pudo leer el archivo elegido.", true);
    let too_big = || BackendError::invalid_input("El archivo es demasiado grande para ser el JSON de un cliente OAuth.");
    match file {
        crate::host::dialog::FilePath::Path(path) => {
            let _ = app;
            if std::fs::metadata(&path).map_err(|_| unreadable())?.len() as usize > MAX_CLIENT_JSON_BYTES {
                return Err(too_big());
            }
            std::fs::read_to_string(&path).map_err(|_| unreadable())
        }
        crate::host::dialog::FilePath::Url(url) => {
            #[cfg(target_os = "android")]
            {
                use crate::host::Manager;
                let picker = app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>();
                let content = crate::mobile_directory_picker::read_android_content_text(picker.inner(), url.as_str())
                    .map_err(|_| unreadable())?;
                if content.len() > MAX_CLIENT_JSON_BYTES {
                    return Err(too_big());
                }
                Ok(content)
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, url);
                Err(unreadable())
            }
        }
    }
}

/// Opens a file picker for the JSON Google downloads and returns its Client
/// ID and Client secret; `None` when the person closed the picker.
pub(crate) async fn backend_import_google_cloud_json(app: AppHandle) -> Result<Option<GoogleCloudCredentials>, BackendError> {
    blocking(move || {
        use crate::host::dialog::DialogExt;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Importar el JSON del cliente OAuth")
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let client = parse_google_client_json(&read_picked_json(&app, file)?)?;
        Ok(Some(GoogleCloudCredentials { client_id: client.client_id, client_secret: client.client_secret }))
    })
    .await
}

/// Signs in at Google in the browser and adds the account, or updates it
/// when its address is already connected. Reconnecting suggests the known
/// address (`email`) and keeps the account type and, when Google sends no
/// new one, the refresh token.
pub(crate) async fn backend_connect_mail_account(app: AppHandle, payload: MailAccountsPayload) -> Result<MailAccountsView, BackendError> {
    let provider = provider_of(&payload)?;
    let hint = payload.email.clone().filter(|email| !email.trim().is_empty());
    let library_id = payload.library_id;
    let config = {
        let app = app.clone();
        let library_id = library_id.clone();
        blocking(move || read_config(&app, &library_id)).await?
    };
    let client = google_cloud_client(config.as_ref()).ok_or_else(not_configured)?;
    // A new account needs room before the browser opens.
    check_room_for(config.as_ref(), hint.as_deref().unwrap_or_default())?;
    let previous = hint.as_deref().and_then(|email| find_account(config.as_ref(), email)).cloned();

    let loopback = bind_loopback()?;
    let redirect_uri = format!("http://{REDIRECT_HOST}:{}/", loopback.port);
    let verifier = random_token(48);
    let state = random_token(24);
    let login_hint = previous.as_ref().and_then(|account| account.get("email")).and_then(Value::as_str);
    let url = authorization_url(
        provider,
        &AuthorizationRequest {
            client_id: &client.client_id,
            redirect_uri: &redirect_uri,
            state: &state,
            code_challenge: &pkce_challenge(&verifier),
            login_hint,
        },
    );

    let cancel = begin_pending();
    let code = {
        let _work = AndroidWork::begin(&app);
        let waited = match open_browser(&app, &url) {
            Ok(()) => {
                let cancel = cancel.clone();
                blocking(move || wait_for_code(loopback, &state, &cancel)).await
            }
            Err(error) => Err(error),
        };
        end_pending(&cancel);
        waited?
    };

    let tokens = exchange_code(provider, &client, &code, &verifier, &redirect_uri).await?;
    let email = fetch_email(provider, &tokens.access_token).await?;
    blocking(move || {
        let config = read_config(&app, &library_id)?;
        check_room_for(config.as_ref(), &email)?;
        // The person may sign in with another address than the one suggested.
        let account = stored_account(&tokens, &email, now_ms(), find_account(config.as_ref(), &email));
        update_view(&app, &library_id, |config| with_mail_account(&config, account))
    })
    .await
}

/// Stops waiting for the browser.
pub(crate) fn backend_cancel_mail_account_connection() -> Result<(), BackendError> {
    if let Ok(pending) = pending_connection().lock() {
        if let Some(flag) = pending.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

/// Removes the account with `email` and its tokens from the library.
pub(crate) async fn backend_disconnect_mail_account(app: AppHandle, payload: MailAccountsPayload) -> Result<MailAccountsView, BackendError> {
    let email = email_of(&payload)?;
    blocking(move || update_view(&app, &payload.library_id, |config| without_mail_account(&config, &email))).await
}

/// Marks the account with `email` as work, personal or school.
pub(crate) async fn backend_set_mail_account_type(app: AppHandle, payload: MailAccountsPayload) -> Result<MailAccountsView, BackendError> {
    let email = email_of(&payload)?;
    let account_type = MailAccountType::parse(payload.account_type.as_deref().unwrap_or_default())?;
    blocking(move || {
        let mut refused = None;
        let view = update_view(&app, &payload.library_id, |config| match with_account_type(&config, &email, account_type) {
            Ok(changed) => changed,
            Err(error) => {
                refused = Some(error);
                config
            }
        })?;
        refused.map_or(Ok(view), Err)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pkce_challenge_is_the_base64url_sha256_of_the_verifier() {
        // RFC 7636, appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let token = random_token(48);
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_'));
    }

    #[test]
    fn the_loopback_listener_takes_the_code_and_skips_other_requests() {
        let loopback = bind_loopback().expect("loopback");
        let port = loopback.port;
        let browser = std::thread::spawn(move || {
            for target in ["/favicon.ico", "/?code=abc&state=estado"] {
                let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
                write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").expect("write");
                let mut page = String::new();
                let _ = stream.read_to_string(&mut page);
            }
        });
        let code = wait_for_code(loopback, "estado", &AtomicBool::new(false)).expect("code");
        browser.join().expect("browser");
        assert_eq!(code, "abc");
    }

    #[test]
    fn a_cancelled_connection_stops_waiting() {
        let loopback = bind_loopback().expect("loopback");
        let error = wait_for_code(loopback, "estado", &AtomicBool::new(true)).unwrap_err();
        assert_eq!(error.code, BackendErrorCode::Cancelled);
    }
}
