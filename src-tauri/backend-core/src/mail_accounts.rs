//! Mail accounts connected to a library through OAuth 2.0: authorization
//! code with PKCE and a loopback redirect, the flow Google documents for
//! installed apps. The browser signs in at the provider; Notia never sees
//! the password. Gmail is the only provider.
//!
//! Notia is a desktop app: whoever installs it uses their own Google Cloud
//! project. Its OAuth client (Client ID and Client secret of a «Desktop
//! app» client) is entered in the settings and kept in the library
//! configuration, like the Ollama API key.
//!
//! This module holds the rules: the provider and its permissions, the
//! Google Cloud client, the authorization address, the browser's answer,
//! the token response and the `googleCloud` and `mailAccounts` sections of
//! `.notia/notiaConfig.json`. The host runs the loopback listener, opens the
//! browser and makes the HTTP calls.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::error::{BackendError, BackendErrorCode};

/// Section of the library configuration that holds the accounts and their
/// tokens. It never leaves the backend (`without_google_secrets`).
pub const MAIL_ACCOUNTS_KEY: &str = "mailAccounts";
/// Section with the Google Cloud OAuth client. It never leaves the backend.
pub const GOOGLE_CLOUD_KEY: &str = "googleCloud";

const MAX_EMAIL_CHARS: usize = 320;
const MAX_TOKEN_CHARS: usize = 8192;
const MAX_SCOPE_CHARS: usize = 1024;
const MAX_CLIENT_CHARS: usize = 256;
const GOOGLE_CLIENT_ID_SUFFIX: &str = ".apps.googleusercontent.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MailProvider {
    Gmail,
}

impl MailProvider {
    pub const ALL: [MailProvider; 1] = [MailProvider::Gmail];

    pub fn id(self) -> &'static str {
        match self {
            Self::Gmail => "gmail",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Gmail => "Gmail",
        }
    }

    pub fn parse(value: &str) -> Result<Self, BackendError> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.id() == value.trim())
            .ok_or_else(|| BackendError::invalid_input("El proveedor de correo no es válido."))
    }

    /// Reading, sending, deleting (to the trash), moving and marking mail,
    /// reading and creating Google Calendar events, plus the address of the
    /// account. Permanent deletion would need full access
    /// (`https://mail.google.com/`).
    pub fn scopes(self) -> &'static str {
        match self {
            Self::Gmail => "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
        }
    }

    pub fn authorization_endpoint(self) -> &'static str {
        match self {
            Self::Gmail => "https://accounts.google.com/o/oauth2/v2/auth",
        }
    }

    pub fn token_endpoint(self) -> &'static str {
        match self {
            Self::Gmail => "https://oauth2.googleapis.com/token",
        }
    }

    /// Where the address of the signed-in account is read.
    pub fn profile_endpoint(self) -> &'static str {
        match self {
            Self::Gmail => "https://openidconnect.googleapis.com/v1/userinfo",
        }
    }
}

/// What the account is for; the person picks it after connecting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MailAccountType {
    Laboral,
    #[default]
    Personal,
    Estudiantil,
}

impl MailAccountType {
    pub fn id(self) -> &'static str {
        match self {
            Self::Laboral => "laboral",
            Self::Personal => "personal",
            Self::Estudiantil => "estudiantil",
        }
    }

    pub fn parse(value: &str) -> Result<Self, BackendError> {
        match value.trim() {
            "laboral" => Ok(Self::Laboral),
            "personal" => Ok(Self::Personal),
            "estudiantil" => Ok(Self::Estudiantil),
            _ => Err(BackendError::invalid_input("El tipo de cuenta no es válido.")),
        }
    }
}

/// Permission to read and create events; accounts connected before it was
/// asked for must reconnect to use the calendar.
pub const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";

/// Host of the loopback redirect: Google's clients for installed apps take
/// the loopback IP on any port.
pub const REDIRECT_HOST: &str = "127.0.0.1";

/// OAuth client of the library's Google Cloud project. The secret of a
/// «Desktop app» client is not confidential for Google, but Notia keeps it
/// in the backend anyway.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

/// Checks the Client ID and Client secret the person entered.
pub fn validate_google_client(client_id: &str, client_secret: &str) -> Result<OAuthClient, BackendError> {
    let client_id = client_id.trim();
    let client_secret = client_secret.trim();
    let well_formed = |value: &str| !value.is_empty() && value.chars().count() <= MAX_CLIENT_CHARS && !value.chars().any(char::is_whitespace);
    if !well_formed(client_id) || !client_id.ends_with(GOOGLE_CLIENT_ID_SUFFIX) {
        return Err(BackendError::invalid_input(
            "El Client ID no es válido: termina en .apps.googleusercontent.com.",
        ));
    }
    if !well_formed(client_secret) {
        return Err(BackendError::invalid_input("El Client secret no es válido."));
    }
    Ok(OAuthClient { client_id: client_id.to_string(), client_secret: client_secret.to_string() })
}

/// Reads the JSON Google downloads for an OAuth client. Only a «Desktop
/// app» client (`installed`) can use the loopback redirect.
pub fn parse_google_client_json(text: &str) -> Result<OAuthClient, BackendError> {
    let value = serde_json::from_str::<Value>(text)
        .map_err(|_| BackendError::invalid_input("El archivo no es el JSON de un cliente OAuth de Google."))?;
    if value.get("web").is_some() {
        return Err(BackendError::invalid_input(
            "Ese JSON es de un cliente web. Creá un ID de cliente de tipo App de escritorio.",
        ));
    }
    let installed = value
        .get("installed")
        .ok_or_else(|| BackendError::invalid_input("El archivo no es el JSON de un cliente OAuth de Google."))?;
    let text = |key: &str| installed.get(key).and_then(Value::as_str).unwrap_or_default();
    validate_google_client(text("client_id"), text("client_secret"))
}

/// The library's Google Cloud client, when it was configured.
pub fn google_cloud_client(config: Option<&Value>) -> Option<OAuthClient> {
    let section = config?.get(GOOGLE_CLOUD_KEY)?;
    let text = |key: &str| section.get(key).and_then(Value::as_str).unwrap_or_default();
    validate_google_client(text("clientId"), text("clientSecret")).ok()
}

/// The stored Google Cloud section; `None` when it is missing or invalid.
pub fn normalize_google_cloud(value: Option<&Value>) -> Option<Value> {
    let section = value?;
    let text = |key: &str| section.get(key).and_then(Value::as_str).unwrap_or_default();
    let client = validate_google_client(text("clientId"), text("clientSecret")).ok()?;
    Some(json!({ "clientId": client.client_id, "clientSecret": client.client_secret }))
}

/// The configuration with the Google Cloud client set, or removed with `None`.
pub fn with_google_cloud(config: &Value, client: Option<&OAuthClient>) -> Value {
    let mut config = config.clone();
    if let Some(object) = config.as_object_mut() {
        match client {
            Some(client) => {
                object.insert(
                    GOOGLE_CLOUD_KEY.to_string(),
                    json!({ "clientId": client.client_id, "clientSecret": client.client_secret }),
                );
            }
            None => {
                object.remove(GOOGLE_CLOUD_KEY);
            }
        }
    }
    config
}

/// Percent-encodes everything but RFC 3986's unreserved characters.
pub fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = value.get(index + 1..index + 3)?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(decoded).ok()
}

/// `application/x-www-form-urlencoded` body of the token requests.
pub fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// What the authorization address needs besides the provider.
pub struct AuthorizationRequest<'a> {
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    /// `BASE64URL(SHA-256(verifier))`, without padding.
    pub code_challenge: &'a str,
    /// Address of the account being reconnected.
    pub login_hint: Option<&'a str>,
}

/// Address the browser opens to sign in and grant the permissions. Offline
/// access with consent always returns a refresh token.
pub fn authorization_url(provider: MailProvider, request: &AuthorizationRequest<'_>) -> String {
    let mut pairs = vec![
        ("client_id", request.client_id),
        ("redirect_uri", request.redirect_uri),
        ("response_type", "code"),
        ("scope", provider.scopes()),
        ("state", request.state),
        ("code_challenge", request.code_challenge),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ];
    if let Some(hint) = request.login_hint.filter(|hint| !hint.is_empty()) {
        pairs.push(("login_hint", hint));
    }
    format!("{}?{}", provider.authorization_endpoint(), form_body(&pairs))
}

/// What the browser brought back to the loopback address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedirectOutcome {
    /// Not the redirect (for example `/favicon.ico`): keep waiting.
    Ignored,
    Code(String),
}

/// Reads the target of the request the browser sent to the loopback
/// address (`/?code=…&state=…`). A different `state` is refused, so another
/// page cannot hand Notia a code of its own.
pub fn parse_redirect(target: &str, expected_state: &str) -> Result<RedirectOutcome, BackendError> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/" {
        return Ok(RedirectOutcome::Ignored);
    }
    let mut parameters = Map::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if let (Some(key), Some(value)) = (percent_decode(key), percent_decode(value)) {
            parameters.insert(key, Value::String(value));
        }
    }
    let text = |key: &str| parameters.get(key).and_then(Value::as_str).unwrap_or_default();
    if text("state") != expected_state {
        return Err(BackendError::new(
            BackendErrorCode::Forbidden,
            "La respuesta del navegador no corresponde a esta conexión. Volvé a intentar.",
            true,
        ));
    }
    match text("error") {
        "" => {}
        "access_denied" | "consent_required" => {
            return Err(BackendError::new(BackendErrorCode::Cancelled, "No se otorgó el permiso a Notia.", true));
        }
        _ => {
            return Err(BackendError::new(
                BackendErrorCode::ProviderUnavailable,
                "El proveedor rechazó la autorización. Volvé a intentar.",
                true,
            ));
        }
    }
    let code = text("code");
    if code.is_empty() || code.len() > MAX_TOKEN_CHARS {
        return Err(BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "El proveedor no devolvió un código de autorización.",
            true,
        ));
    }
    Ok(RedirectOutcome::Code(code.to_string()))
}

/// Form of the request that trades the authorization code for tokens.
pub fn code_exchange_body(client: &OAuthClient, code: &str, verifier: &str, redirect_uri: &str) -> String {
    form_body(&[
        ("client_id", client.client_id.as_str()),
        ("client_secret", client.client_secret.as_str()),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", redirect_uri),
    ])
}

/// A token request with a code that cannot exist: Google checks the client
/// before the code, so the answer tells whether the credentials are right
/// without signing in (`client_check_result`).
pub fn client_check_body(client: &OAuthClient) -> String {
    form_body(&[
        ("client_id", client.client_id.as_str()),
        ("client_secret", client.client_secret.as_str()),
        ("grant_type", "authorization_code"),
        ("code", "notia-client-check"),
        ("redirect_uri", "http://127.0.0.1/"),
    ])
}

/// Reads the answer to `client_check_body`: a rejected code means Google
/// accepted the client; a rejected client means the credentials are wrong.
pub fn client_check_result(answer: &Value) -> Result<(), BackendError> {
    match answer.get("error").and_then(Value::as_str).unwrap_or_default() {
        "invalid_grant" => Ok(()),
        "invalid_client" | "unauthorized_client" => Err(BackendError::new(
            BackendErrorCode::Unauthorized,
            "Google no reconoce el Client ID o el Client secret. Revisá que sean del mismo cliente.",
            false,
        )),
        _ => Err(BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "No se pudo verificar el cliente con Google. Volvé a intentar.",
            true,
        )),
    }
}

/// Form that trades the refresh token for a new access token.
pub fn refresh_body(client: &OAuthClient, refresh_token: &str) -> String {
    form_body(&[
        ("client_id", client.client_id.as_str()),
        ("client_secret", client.client_secret.as_str()),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ])
}

/// Most accounts a library connects.
pub const MAX_MAIL_ACCOUNTS: usize = 10;

/// The connected accounts, with their tokens, in the order they were connected.
pub fn connected_accounts(config: Option<&Value>) -> Vec<&Value> {
    config
        .and_then(|config| config.get(MAIL_ACCOUNTS_KEY))
        .and_then(Value::as_array)
        .map(|accounts| accounts.iter().collect())
        .unwrap_or_default()
}

/// Address of a stored account; it identifies the account.
pub fn account_email(account: &Value) -> &str {
    account.get("email").and_then(Value::as_str).unwrap_or_default()
}

/// The connected account with `email`, without case.
pub fn find_account<'a>(config: Option<&'a Value>, email: &str) -> Option<&'a Value> {
    connected_accounts(config)
        .into_iter()
        .find(|account| account_email(account).eq_ignore_ascii_case(email.trim()))
}

/// Refuses a new account once the library has the most it connects.
pub fn check_room_for(config: Option<&Value>, email: &str) -> Result<(), BackendError> {
    if find_account(config, email).is_none() && connected_accounts(config).len() >= MAX_MAIL_ACCOUNTS {
        return Err(BackendError::new(
            BackendErrorCode::Conflict,
            format!("Se pueden conectar hasta {MAX_MAIL_ACCOUNTS} cuentas por biblioteca. Desconectá una para sumar otra."),
            false,
        ));
    }
    Ok(())
}

/// The stored access token while it is valid for at least another minute.
pub fn fresh_access_token(account: &Value, now_ms: u64) -> Option<String> {
    let token = account.get("accessToken").and_then(Value::as_str).filter(|token| !token.is_empty())?;
    let expires_at = account.get("expiresAtMs").and_then(Value::as_u64).unwrap_or(0);
    (expires_at > now_ms.saturating_add(60_000)).then(|| token.to_string())
}

/// The account after a refresh: new access token and expiry, the same
/// refresh token unless Google rotated it, the same permissions unless
/// Google listed them again.
pub fn with_refreshed_tokens(account: &Value, tokens: &GrantedTokens, now_ms: u64) -> Value {
    let mut account = account.clone();
    if let Some(object) = account.as_object_mut() {
        object.insert("accessToken".into(), json!(tokens.access_token));
        object.insert(
            "expiresAtMs".into(),
            json!(now_ms.saturating_add(tokens.expires_in_seconds.saturating_mul(1000))),
        );
        if let Some(refresh_token) = &tokens.refresh_token {
            object.insert("refreshToken".into(), json!(refresh_token));
        }
        if !tokens.scope.is_empty() {
            object.insert("scope".into(), json!(tokens.scope));
        }
    }
    account
}

/// Whether the account granted `scope`.
pub fn account_has_scope(account: &Value, scope: &str) -> bool {
    account
        .get("scope")
        .and_then(Value::as_str)
        .is_some_and(|granted| granted.split_whitespace().any(|item| item == scope))
}

/// Tokens the provider granted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantedTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in_seconds: u64,
    pub scope: String,
}

/// Reads the token endpoint's answer; its error fields become a message
/// that does not echo anything the provider sent.
pub fn parse_token_response(value: &Value) -> Result<GrantedTokens, BackendError> {
    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default();
    if !text("error").is_empty() {
        return Err(BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "El proveedor no aceptó la autorización. Volvé a conectar la cuenta.",
            true,
        ));
    }
    let access_token = text("access_token");
    if access_token.is_empty() || access_token.len() > MAX_TOKEN_CHARS {
        return Err(BackendError::new(
            BackendErrorCode::ProviderUnavailable,
            "El proveedor no devolvió un token de acceso.",
            true,
        ));
    }
    let refresh_token = Some(text("refresh_token")).filter(|token| !token.is_empty() && token.len() <= MAX_TOKEN_CHARS);
    Ok(GrantedTokens {
        access_token: access_token.to_string(),
        refresh_token: refresh_token.map(str::to_string),
        expires_in_seconds: value.get("expires_in").and_then(Value::as_u64).unwrap_or(3600),
        scope: text("scope").chars().take(MAX_SCOPE_CHARS).collect(),
    })
}

/// Address of the account from the provider's profile (`email`).
pub fn profile_email(profile: &Value) -> Option<String> {
    profile
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| email.contains('@') && email.chars().count() <= MAX_EMAIL_CHARS)
        .map(str::to_string)
}

fn stored_account_type(account: Option<&Value>) -> MailAccountType {
    account
        .and_then(|account| account.get("accountType"))
        .and_then(Value::as_str)
        .and_then(|value| MailAccountType::parse(value).ok())
        .unwrap_or_default()
}

/// What a stored account is for (personal when it was never chosen).
pub fn account_type(account: &Value) -> MailAccountType {
    stored_account_type(Some(account))
}

/// The stored account after a connection. Reconnecting keeps the account
/// type and, when the provider sends no new one, the refresh token.
pub fn stored_account(tokens: &GrantedTokens, email: &str, now_ms: u64, previous: Option<&Value>) -> Value {
    let refresh_token = tokens
        .refresh_token
        .clone()
        .or_else(|| previous.and_then(|account| account.get("refreshToken")).and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default();
    json!({
        "provider": MailProvider::Gmail.id(),
        "email": email,
        "accessToken": tokens.access_token,
        "refreshToken": refresh_token,
        "expiresAtMs": now_ms.saturating_add(tokens.expires_in_seconds.saturating_mul(1000)),
        "scope": tokens.scope,
        "connectedAtMs": now_ms,
        "accountType": stored_account_type(previous).id(),
    })
}

fn normalize_account(value: &Value) -> Option<Value> {
    let text = |key: &str, max: usize| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| text.chars().count() <= max)
            .unwrap_or_default()
            .to_string()
    };
    let provider = MailProvider::parse(value.get("provider").and_then(Value::as_str).unwrap_or("gmail")).ok()?;
    let email = text("email", MAX_EMAIL_CHARS);
    let access_token = text("accessToken", MAX_TOKEN_CHARS);
    let refresh_token = text("refreshToken", MAX_TOKEN_CHARS);
    if !email.contains('@') || (access_token.is_empty() && refresh_token.is_empty()) {
        return None;
    }
    let number = |key: &str| value.get(key).and_then(Value::as_u64).unwrap_or(0);
    Some(json!({
        "provider": provider.id(),
        "email": email,
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "expiresAtMs": number("expiresAtMs"),
        "scope": text("scope", MAX_SCOPE_CHARS),
        "connectedAtMs": number("connectedAtMs"),
        "accountType": stored_account_type(Some(value)).id(),
    }))
}

/// The stored accounts: valid ones, one per address, at most
/// `MAX_MAIL_ACCOUNTS`; `None` when there is none, so the configuration
/// does not keep an empty list. The first version kept one account per
/// provider in an object; it is read as a list.
pub fn normalize_mail_accounts(value: Option<&Value>) -> Option<Value> {
    let items: Vec<&Value> = match value? {
        Value::Array(items) => items.iter().collect(),
        Value::Object(section) => MailProvider::ALL.iter().filter_map(|provider| section.get(provider.id())).collect(),
        _ => return None,
    };
    let mut accounts: Vec<Value> = Vec::new();
    for account in items.into_iter().filter_map(normalize_account) {
        let unique = accounts.iter().all(|kept| !account_email(kept).eq_ignore_ascii_case(account_email(&account)));
        if unique && accounts.len() < MAX_MAIL_ACCOUNTS {
            accounts.push(account);
        }
    }
    (!accounts.is_empty()).then_some(Value::Array(accounts))
}

fn with_accounts(config: &Value, accounts: Vec<Value>) -> Value {
    let mut config = config.clone();
    if let Some(object) = config.as_object_mut() {
        match normalize_mail_accounts(Some(&Value::Array(accounts))) {
            Some(section) => {
                object.insert(MAIL_ACCOUNTS_KEY.to_string(), section);
            }
            None => {
                object.remove(MAIL_ACCOUNTS_KEY);
            }
        }
    }
    config
}

/// The configuration with `account` added, or replacing the one with its
/// address.
pub fn with_mail_account(config: &Value, account: Value) -> Value {
    let mut accounts = connected_accounts(Some(config)).into_iter().cloned().collect::<Vec<_>>();
    match accounts.iter_mut().find(|kept| account_email(kept).eq_ignore_ascii_case(account_email(&account))) {
        Some(kept) => *kept = account,
        None => accounts.push(account),
    }
    with_accounts(config, accounts)
}

/// The configuration without the account with `email`.
pub fn without_mail_account(config: &Value, email: &str) -> Value {
    let accounts = connected_accounts(Some(config))
        .into_iter()
        .filter(|account| !account_email(account).eq_ignore_ascii_case(email.trim()))
        .cloned()
        .collect();
    with_accounts(config, accounts)
}

/// The configuration without any connected account.
pub fn without_mail_accounts(config: &Value) -> Value {
    with_accounts(config, Vec::new())
}

/// The configuration with the type of the account with `email` changed.
pub fn with_account_type(config: &Value, email: &str, account_type: MailAccountType) -> Result<Value, BackendError> {
    let mut account = find_account(Some(config), email)
        .cloned()
        .ok_or_else(|| BackendError::new(BackendErrorCode::NotFound, "La cuenta ya no está conectada.", false))?;
    if let Some(object) = account.as_object_mut() {
        object.insert("accountType".into(), json!(account_type.id()));
    }
    Ok(with_mail_account(config, account))
}

/// The configuration as clients may see it: without the Google Cloud client
/// and the accounts' tokens.
pub fn without_google_secrets(mut config: Value) -> Value {
    if let Some(object) = config.as_object_mut() {
        object.remove(MAIL_ACCOUNTS_KEY);
        object.remove(GOOGLE_CLOUD_KEY);
    }
    config
}

/// A connected account as the settings show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccountView {
    pub provider: MailProvider,
    pub label: &'static str,
    pub email: String,
    pub connected_at_ms: u64,
    pub account_type: MailAccountType,
}

/// A provider the settings offer and whether the library can connect it
/// (its Google Cloud client is configured).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailProviderView {
    pub provider: MailProvider,
    pub label: &'static str,
    pub configured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccountsView {
    /// The library has a Google Cloud client.
    pub google_cloud_configured: bool,
    pub providers: Vec<MailProviderView>,
    pub accounts: Vec<MailAccountView>,
}

/// What the settings show: the Google Cloud client state, the providers and
/// the connected accounts of the library, in the order they were connected.
pub fn mail_accounts_view(config: Option<&Value>) -> MailAccountsView {
    let configured = google_cloud_client(config).is_some();
    MailAccountsView {
        google_cloud_configured: configured,
        providers: MailProvider::ALL
            .into_iter()
            .map(|provider| MailProviderView { provider, label: provider.label(), configured })
            .collect(),
        accounts: connected_accounts(config)
            .into_iter()
            .map(|account| MailAccountView {
                provider: MailProvider::Gmail,
                label: MailProvider::Gmail.label(),
                email: account_email(account).to_string(),
                connected_at_ms: account.get("connectedAtMs").and_then(Value::as_u64).unwrap_or(0),
                account_type: account_type(account),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENT_ID: &str = "123-abc.apps.googleusercontent.com";

    fn query(url: &str) -> Map<String, Value> {
        let (_, query) = url.split_once('?').expect("query");
        query
            .split('&')
            .map(|pair| {
                let (key, value) = pair.split_once('=').expect("pair");
                (key.to_string(), Value::String(percent_decode(value).expect("decoded")))
            })
            .collect()
    }

    #[test]
    fn the_authorization_address_asks_for_mail_permissions_with_pkce() {
        let request = AuthorizationRequest {
            client_id: CLIENT_ID,
            redirect_uri: "http://127.0.0.1:5123/",
            state: "estado",
            code_challenge: "reto",
            login_hint: Some("ana@gmail.com"),
        };
        let google = authorization_url(MailProvider::Gmail, &request);
        assert!(google.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        let parameters = query(&google);
        assert_eq!(
            parameters["scope"],
            "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events"
        );
        assert_eq!(parameters["redirect_uri"], "http://127.0.0.1:5123/");
        assert_eq!(parameters["code_challenge_method"], "S256");
        assert_eq!(parameters["access_type"], "offline");
        assert_eq!(parameters["login_hint"], "ana@gmail.com");
        let first_time = query(&authorization_url(MailProvider::Gmail, &AuthorizationRequest { login_hint: None, ..request }));
        assert!(!first_time.contains_key("login_hint"));
        assert_eq!(MailProvider::parse("outlook").unwrap_err().code, BackendErrorCode::InvalidInput);
    }

    #[test]
    fn the_google_cloud_client_is_validated_imported_and_kept_in_the_backend() {
        let client = validate_google_client(&format!("  {CLIENT_ID} "), " secreto ").expect("client");
        assert_eq!(client.client_secret, "secreto");
        assert!(validate_google_client("123-abc", "secreto").is_err());
        assert!(validate_google_client(CLIENT_ID, "con espacio").is_err());

        let downloaded = json!({ "installed": { "client_id": CLIENT_ID, "client_secret": "secreto", "redirect_uris": ["http://localhost"] } });
        assert_eq!(parse_google_client_json(&downloaded.to_string()).expect("json"), client);
        let web = json!({ "web": { "client_id": CLIENT_ID, "client_secret": "secreto" } });
        assert!(parse_google_client_json(&web.to_string()).unwrap_err().message.contains("App de escritorio"));
        assert!(parse_google_client_json("no es json").is_err());

        let config = with_google_cloud(&json!({ "version": 1 }), Some(&client));
        assert_eq!(google_cloud_client(Some(&config)), Some(client));
        assert!(mail_accounts_view(Some(&config)).google_cloud_configured);
        assert!(without_google_secrets(config.clone()).get(GOOGLE_CLOUD_KEY).is_none());
        assert!(!mail_accounts_view(Some(&with_google_cloud(&config, None))).providers[0].configured);
        assert_eq!(normalize_google_cloud(Some(&json!({ "clientId": "x", "clientSecret": "y" }))), None);
    }

    #[test]
    fn the_client_check_tells_right_from_wrong_credentials() {
        let client = OAuthClient { client_id: CLIENT_ID.into(), client_secret: "secreto".into() };
        assert!(client_check_body(&client).contains("code=notia-client-check"));
        assert!(client_check_result(&json!({ "error": "invalid_grant" })).is_ok());
        assert_eq!(client_check_result(&json!({ "error": "invalid_client" })).unwrap_err().code, BackendErrorCode::Unauthorized);
        assert_eq!(client_check_result(&json!({})).unwrap_err().code, BackendErrorCode::ProviderUnavailable);
    }

    #[test]
    fn the_redirect_gives_the_code_only_with_the_same_state() {
        assert_eq!(
            parse_redirect("/?code=4%2F0Ab&scope=email&state=abc", "abc").expect("code"),
            RedirectOutcome::Code("4/0Ab".into())
        );
        assert_eq!(parse_redirect("/favicon.ico", "abc").expect("ignored"), RedirectOutcome::Ignored);
        assert_eq!(parse_redirect("/?code=x&state=otro", "abc").unwrap_err().code, BackendErrorCode::Forbidden);
        assert_eq!(parse_redirect("/?error=access_denied&state=abc", "abc").unwrap_err().code, BackendErrorCode::Cancelled);
        assert_eq!(parse_redirect("/?state=abc", "abc").unwrap_err().code, BackendErrorCode::ProviderUnavailable);
    }

    #[test]
    fn token_responses_and_profiles_are_read_without_echoing_errors() {
        let tokens = parse_token_response(&json!({ "access_token": "a", "refresh_token": "r", "expires_in": 3599, "scope": "email" })).expect("tokens");
        assert_eq!(tokens.refresh_token.as_deref(), Some("r"));
        assert_eq!(tokens.expires_in_seconds, 3599);
        let refused = parse_token_response(&json!({ "error": "invalid_grant", "error_description": "secreto" })).unwrap_err();
        assert!(!refused.message.contains("secreto"));
        assert_eq!(profile_email(&json!({ "email": "ana@gmail.com" })).as_deref(), Some("ana@gmail.com"));
        assert_eq!(profile_email(&json!({ "email": "sin-arroba" })), None);
    }

    #[test]
    fn the_code_exchange_sends_the_client_and_the_verifier() {
        let client = OAuthClient { client_id: CLIENT_ID.into(), client_secret: "secreto".into() };
        let body = code_exchange_body(&client, "4/0Ab", "verificador", "http://127.0.0.1:5123/");
        assert!(body.contains("client_secret=secreto"));
        assert!(body.contains("code=4%2F0Ab"));
        assert!(body.contains("code_verifier=verificador"));
        assert!(body.contains("grant_type=authorization_code"));
    }

    #[test]
    fn a_library_keeps_several_accounts_each_with_its_type() {
        let tokens = GrantedTokens { access_token: "a".into(), refresh_token: None, expires_in_seconds: 10, scope: "email".into() };
        let previous = json!({ "refreshToken": "viejo", "accountType": "laboral" });
        let work = stored_account(&tokens, "ana@empresa.com", 1_000, Some(&previous));
        assert_eq!(work["refreshToken"], "viejo");
        assert_eq!(work["expiresAtMs"], 11_000);
        assert_eq!(work["accountType"], "laboral");
        let school = stored_account(&tokens, "ana@uni.edu", 1_000, None);
        assert_eq!(school["accountType"], "personal");

        let config = with_mail_account(&with_mail_account(&json!({ "version": 1 }), work), school);
        assert_eq!(connected_accounts(Some(&config)).len(), 2);
        let config = with_account_type(&config, "ANA@uni.edu", MailAccountType::Estudiantil).expect("type");
        let view = mail_accounts_view(Some(&config));
        assert_eq!(view.accounts.iter().map(|account| (account.email.as_str(), account.account_type)).collect::<Vec<_>>(), [
            ("ana@empresa.com", MailAccountType::Laboral),
            ("ana@uni.edu", MailAccountType::Estudiantil),
        ]);
        assert!(without_google_secrets(config.clone()).get(MAIL_ACCOUNTS_KEY).is_none());

        // Reconnecting an address replaces its account instead of adding one.
        let again = with_mail_account(&config, stored_account(&tokens, "ana@uni.edu", 2_000, find_account(Some(&config), "ana@uni.edu")));
        assert_eq!(connected_accounts(Some(&again)).len(), 2);
        assert_eq!(find_account(Some(&again), "ana@uni.edu").expect("school")["accountType"], "estudiantil");

        let fewer = without_mail_account(&config, "ana@empresa.com");
        assert_eq!(connected_accounts(Some(&fewer)).len(), 1);
        assert!(without_mail_accounts(&config).get(MAIL_ACCOUNTS_KEY).is_none());
        assert_eq!(with_account_type(&fewer, "ana@empresa.com", MailAccountType::Laboral).unwrap_err().code, BackendErrorCode::NotFound);
        assert_eq!(MailAccountType::parse("otro").unwrap_err().code, BackendErrorCode::InvalidInput);
    }

    #[test]
    fn accounts_are_capped_deduplicated_and_read_from_the_first_format() {
        let account = |email: &str| json!({ "email": email, "accessToken": "a" });
        let legacy = normalize_mail_accounts(Some(&json!({ "gmail": account("ana@x.com"), "outlook": account("ana@y.com") }))).expect("legacy");
        assert_eq!(legacy, json!([{ "provider": "gmail", "email": "ana@x.com", "accessToken": "a", "refreshToken": "", "expiresAtMs": 0, "scope": "", "connectedAtMs": 0, "accountType": "personal" }]));
        let many = (0..12).map(|index| account(&format!("u{index}@x.com"))).chain([account("U0@x.com")]).collect::<Vec<_>>();
        let config = json!({ MAIL_ACCOUNTS_KEY: normalize_mail_accounts(Some(&Value::Array(many))).expect("many") });
        assert_eq!(connected_accounts(Some(&config)).len(), MAX_MAIL_ACCOUNTS);
        assert!(check_room_for(Some(&config), "u0@x.com").is_ok());
        assert_eq!(check_room_for(Some(&config), "nueva@x.com").unwrap_err().code, BackendErrorCode::Conflict);
        assert_eq!(normalize_mail_accounts(Some(&json!([{ "email": "sin-arroba", "accessToken": "a" }, { "provider": "outlook", "email": "a@b.com", "accessToken": "a" }]))), None);
    }

    #[test]
    fn access_tokens_are_refreshed_before_they_expire() {
        let account = json!({ "accessToken": "viejo", "refreshToken": "r", "expiresAtMs": 200_000, "scope": format!("email {CALENDAR_SCOPE}") });
        assert_eq!(fresh_access_token(&account, 100_000).as_deref(), Some("viejo"));
        assert_eq!(fresh_access_token(&account, 150_000), None);
        assert!(account_has_scope(&account, CALENDAR_SCOPE));
        assert!(!account_has_scope(&json!({ "scope": "email" }), CALENDAR_SCOPE));

        let tokens = GrantedTokens { access_token: "nuevo".into(), refresh_token: None, expires_in_seconds: 3600, scope: String::new() };
        let refreshed = with_refreshed_tokens(&account, &tokens, 1_000);
        assert_eq!(refreshed["accessToken"], "nuevo");
        assert_eq!(refreshed["refreshToken"], "r");
        assert_eq!(refreshed["expiresAtMs"], 3_601_000);
        assert!(account_has_scope(&refreshed, CALENDAR_SCOPE));
        let client = OAuthClient { client_id: CLIENT_ID.into(), client_secret: "s".into() };
        assert!(refresh_body(&client, "r").contains("grant_type=refresh_token"));
    }

    #[test]
    fn form_bodies_encode_reserved_characters() {
        assert_eq!(form_body(&[("a b", "c&d=e/f")]), "a%20b=c%26d%3De%2Ff");
    }
}
