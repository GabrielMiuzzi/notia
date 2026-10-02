//! How this installation runs, Host or Client (`backend::connection`), kept
//! per device in the app data folder, and the commands of the «Modo de
//! ejecución» section of Settings.
//!
//! - **Host** (Windows and Linux): the server of `host_server` listens on
//!   the configured port. On Android, Host only means «uses its own
//!   library»: Android has no server.
//! - **Client**: `host_client` forwards the commands to the host and relays
//!   its events; the copy kind also keeps the library in `host_mirror`.
//!
//! A change of mode, kind or host reloads the interface: the bootstrap
//! decides again how it reaches the backend.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::backend::connection::{
    normalize_connection, parse_host_address, ClientKind, ConnectionSettings, HostAddress, RunMode,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Manager};

const FILE_NAME: &str = "connection.json";

#[derive(Default)]
pub(crate) struct ConnectionState {
    settings: Mutex<Option<ConnectionSettings>>,
}

fn file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|directory| directory.join(FILE_NAME))
}

fn read_file(app: &AppHandle) -> ConnectionSettings {
    let settings = file_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<ConnectionSettings>(&text).ok())
        .map(normalize_connection)
        .unwrap_or_default();
    // A client without a host cannot start: it runs as Host until one is saved.
    if settings.mode == RunMode::Client && settings.host_address.is_empty() {
        return ConnectionSettings { mode: RunMode::Host, ..settings };
    }
    settings
}

/// The settings of this device.
pub(crate) fn settings(app: &AppHandle) -> ConnectionSettings {
    let Some(state) = app.try_state::<ConnectionState>() else {
        return ConnectionSettings::default();
    };
    let mut cached = state.settings.lock().unwrap_or_else(|error| error.into_inner());
    cached.get_or_insert_with(|| read_file(app)).clone()
}

fn storage_error() -> BackendError {
    BackendError::new(BackendErrorCode::Storage, "No se pudo guardar el modo de ejecución en este equipo.", true)
}

/// Stores the settings of this device.
pub(crate) fn store(app: &AppHandle, settings: &ConnectionSettings) -> Result<(), BackendError> {
    let path = file_path(app).ok_or_else(storage_error)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| storage_error())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|_| storage_error())?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(|_| storage_error())?;
    std::fs::rename(&temporary, &path).map_err(|_| storage_error())?;
    if let Some(state) = app.try_state::<ConnectionState>() {
        *state.settings.lock().unwrap_or_else(|error| error.into_inner()) = Some(settings.clone());
    }
    Ok(())
}

/// The host this device uses, when it runs as a client.
pub(crate) fn client_host(app: &AppHandle) -> Option<(HostAddress, ClientKind, Option<String>)> {
    let settings = settings(app);
    if settings.mode != RunMode::Client {
        return None;
    }
    let address = parse_host_address(&settings.host_address).ok()?;
    Some((address, settings.client_kind, settings.host_certificate))
}

/// Whether this device runs as a client: the host runs the AI, the speech
/// recognition, Telegram and every background service of the library.
pub(crate) fn is_client(app: &AppHandle) -> bool {
    client_host(app).is_some()
}

/// Pins the certificate of the host seen on the first connection, while
/// the address is still the one saved.
pub(crate) fn pin_host_certificate(app: &AppHandle, address: &HostAddress, fingerprint: &str) {
    let mut settings = settings(app);
    if settings.mode != RunMode::Client || settings.host_address != address.display() || settings.host_certificate.is_some() {
        return;
    }
    settings.host_certificate = Some(fingerprint.to_string());
    if let Err(error) = store(app, &settings) {
        log::error!("[notia:connection] could not pin the host certificate: {}", error.message);
    }
}

/// Starts what the mode of this device needs: the server of a host or the
/// link of a client. Called once the window's application is built.
pub(crate) fn start(app: &AppHandle) {
    crate::services::telegram_service::set_client_device(is_client(app));
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    crate::host_server::reconfigure(app);
    crate::host_client::reconfigure(app);
    crate::client_status::refresh(app);
}

// ---------- Commands ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionView {
    mode: RunMode,
    client_kind: ClientKind,
    host_address: String,
    /// Whether this device can serve its library (not on Android).
    can_host: bool,
    server: crate::host_client::ServerView,
    link: crate::host_client::LinkView,
    /// Commands a client does not offer: they only work on the device that
    /// runs Notia (recording, pickers, the mail sign-in in the browser).
    host_only_commands: Vec<&'static str>,
    /// Whether this device can keep a copy to work offline.
    can_keep_copy: bool,
    /// Android: the copy needs a folder chosen by the person.
    copy_needs_folder: bool,
    /// Name of the chosen folder of the copy (Android).
    copy_folder: Option<String>,
    /// The window works on the copy, without the host.
    offline_copy: bool,
    /// The last sync of the copy.
    copy: Option<crate::host_mirror::CopyStatus>,
    /// Notes are edited together with the other windows of the host: this
    /// device is a connected client, or a host that listens.
    collaboration: bool,
    /// Name of this device, shown to the others in a shared note.
    device_name: String,
}

fn view(app: &AppHandle) -> ConnectionView {
    let settings = settings(app);
    ConnectionView {
        mode: settings.mode,
        client_kind: settings.client_kind,
        host_address: settings.host_address,
        can_host: cfg!(not(any(target_os = "android", target_os = "ios"))),
        server: server_view(app, settings.port),
        link: crate::host_client::link_view(app),
        host_only_commands: crate::registry::LOCAL_ONLY_COMMANDS
            .iter()
            .copied()
            .filter(|command| {
                !crate::backend::connection::is_client_local_command(command)
                    && !crate::registry::is_host_client_command(command)
            })
            .collect(),
        can_keep_copy: true,
        copy_needs_folder: cfg!(target_os = "android"),
        copy_folder: settings.copy_folder.as_ref().map(|folder| folder.name.clone()),
        offline_copy: crate::host_mirror::is_offline(app),
        copy: crate::host_mirror::last_status(app),
        collaboration: collaboration(app),
        device_name: device_name(),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn collaboration(app: &AppHandle) -> bool {
    crate::host_client::uses_host(app) || crate::host_server::view(app).listening
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn collaboration(app: &AppHandle) -> bool {
    crate::host_client::uses_host(app)
}

fn device_name() -> String {
    if cfg!(target_os = "android") {
        return "Android".to_string();
    }
    ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|name| !name.trim().is_empty()))
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok().map(|name| name.trim().to_string()).filter(|name| !name.is_empty()))
        .unwrap_or_else(|| "Este equipo".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn server_view(app: &AppHandle, _port: u16) -> crate::host_client::ServerView {
    crate::host_server::view(app)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn server_view(_app: &AppHandle, port: u16) -> crate::host_client::ServerView {
    crate::host_client::ServerView { listening: false, port, error: None }
}

pub(crate) fn connection_settings(app: &AppHandle) -> ConnectionView {
    view(app)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveConnectionPayload {
    mode: RunMode,
    #[serde(default)]
    client_kind: ClientKind,
    #[serde(default)]
    host_address: String,
    /// «Guardar» of the address: trusts the certificate the host shows next,
    /// even for the same address (the host was reinstalled).
    #[serde(default)]
    trust_new_certificate: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedConnection {
    connection: ConnectionView,
    /// The interface reloads: it reaches the backend another way.
    reload: bool,
}

/// The settings to store and whether the interface reloads.
fn next_settings(previous: &ConnectionSettings, payload: SaveConnectionPayload) -> Result<(ConnectionSettings, bool), BackendError> {
    let host_address = match payload.mode {
        RunMode::Client => parse_host_address(&payload.host_address)?.display(),
        // The address stays for when the person goes back to Client.
        RunMode::Host => parse_host_address(&payload.host_address)
            .map(|address| address.display())
            .unwrap_or_else(|_| previous.host_address.clone()),
    };
    let next = normalize_connection(ConnectionSettings {
        mode: payload.mode,
        client_kind: payload.client_kind,
        // Another host brings another certificate, trusted on first use.
        host_certificate: previous
            .host_certificate
            .clone()
            .filter(|_| host_address == previous.host_address && !payload.trust_new_certificate),
        host_address,
        port: previous.port,
        copy_folder: previous.copy_folder.clone(),
    });
    // On Android the copy lives in a folder the person chooses.
    if cfg!(target_os = "android") && next.mode == RunMode::Client && next.client_kind == ClientKind::Copy && next.copy_folder.is_none() {
        return Err(BackendError::invalid_input("Elegí la carpeta donde guardar la copia antes de guardar el host."));
    }
    let reload = next.mode != previous.mode
        || (next.mode == RunMode::Client
            && (next.client_kind != previous.client_kind || next.host_address != previous.host_address));
    Ok((next, reload))
}

/// Saves the mode of this device and applies it: the server starts or
/// stops, and a client connects to its host.
pub(crate) fn save_connection_settings(app: &AppHandle, payload: SaveConnectionPayload) -> Result<SavedConnection, BackendError> {
    let (next, reload) = next_settings(&settings(app), payload)?;
    store(app, &next)?;
    start(app);
    Ok(SavedConnection { connection: view(app), reload })
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestHostPayload {
    /// The saved host when absent.
    #[serde(default)]
    host_address: Option<String>,
}

pub(crate) async fn test_host_connection(app: AppHandle, payload: TestHostPayload) -> Result<crate::host_client::HostProbe, BackendError> {
    let saved = settings(&app);
    let text = payload.host_address.unwrap_or_else(|| saved.host_address.clone());
    let address = parse_host_address(&text)?;
    // The pin applies only to the saved host.
    let pin = saved.host_certificate.clone().filter(|_| address.display() == saved.host_address);
    Ok(crate::host_client::probe(&app, &address, pin).await)
}

/// Where the window of a client opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ClientOpening {
    /// The host answers: its sign-in, then the app on the host.
    Host,
    /// The host does not answer and the copy opened as a library of this
    /// device.
    Copy,
    /// The host does not answer and there is no copy to open.
    Offline,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedClient {
    opening: ClientOpening,
    /// Why the host is not used, when it is not.
    message: Option<String>,
    connection: ConnectionView,
}

/// Opens the window of a client. A «Con copia» client whose copy is ready
/// does not wait for a slow host: it opens the copy when the host does not
/// answer within the monitor's own time, and the monitor brings the window
/// back to the host when it answers. Coming back to the host, the copy
/// syncs in the background once the session opens.
pub(crate) async fn client_open(app: AppHandle) -> Result<OpenedClient, BackendError> {
    let saved = settings(&app);
    let address = parse_host_address(&saved.host_address)?;
    let copy_ready = crate::host_mirror::copy_ready(&app);
    let probe = if copy_ready {
        crate::host_client::probe_within(&app, &address, saved.host_certificate.clone(), crate::host_client::HEALTH_TIMEOUT).await
    } else {
        crate::host_client::probe(&app, &address, saved.host_certificate.clone()).await
    };
    let (opening, message) = if probe.ok {
        crate::host_mirror::leave_offline_copy(&app)?;
        (ClientOpening::Host, None)
    } else {
        let message = probe.message.unwrap_or_else(|| format!("El host {} no responde.", saved.host_address));
        if crate::host_mirror::keeps_copy(&app) {
            match crate::host_mirror::enter_offline_copy(&app) {
                Ok(_) => (ClientOpening::Copy, Some(message)),
                Err(error) => (ClientOpening::Offline, Some(format!("{message} {}", error.message))),
            }
        } else {
            (ClientOpening::Offline, Some(message))
        }
    };
    crate::client_status::refresh(&app);
    Ok(OpenedClient { opening, message, connection: view(&app) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{AppPaths, HostPorts};

    fn app(directory: &std::path::Path) -> AppHandle {
        let app = crate::host::AppContext::new(AppPaths::new(Some(directory.to_path_buf()), None), HostPorts::default());
        app.manage(ConnectionState::default());
        app
    }

    #[test]
    fn a_new_host_drops_the_pin_and_mode_changes_reload() {
        let pinned = ConnectionSettings {
            mode: RunMode::Client,
            host_address: "casa:6000".into(),
            host_certificate: Some("ab".repeat(32)),
            ..ConnectionSettings::default()
        };
        let payload = |mode, kind, address: &str| SaveConnectionPayload {
            mode,
            client_kind: kind,
            host_address: address.into(),
            trust_new_certificate: false,
        };

        let (same, reload) = next_settings(&pinned, payload(RunMode::Client, ClientKind::Copy, "Casa:6000")).expect("same");
        assert!(same.host_certificate.is_some() && !reload);
        let (other, reload) = next_settings(&pinned, payload(RunMode::Client, ClientKind::Copy, "otra")).expect("other");
        assert_eq!((other.host_address.as_str(), other.host_certificate.is_none(), reload), ("otra:52480", true, true));
        let (remote, reload) = next_settings(&pinned, payload(RunMode::Client, ClientKind::Remote, "casa:6000")).expect("kind");
        assert!(remote.host_certificate.is_some() && reload);
        // Back to Host keeps the address for later.
        let (host, reload) = next_settings(&pinned, payload(RunMode::Host, ClientKind::Copy, "")).expect("host");
        assert_eq!((host.mode, host.host_address.as_str(), reload), (RunMode::Host, "casa:6000", true));
        assert!(next_settings(&pinned, payload(RunMode::Client, ClientKind::Copy, "no válido")).is_err());
        let trust = SaveConnectionPayload { trust_new_certificate: true, ..payload(RunMode::Client, ClientKind::Copy, "casa:6000") };
        assert!(next_settings(&pinned, trust).expect("trust").0.host_certificate.is_none());
    }

    #[test]
    fn settings_are_stored_per_device() {
        let directory = std::env::temp_dir().join(format!("notia-connection-{}", uuid::Uuid::new_v4()));
        let app = app(&directory);
        assert_eq!(settings(&app), ConnectionSettings::default());
        assert!(!is_client(&app));

        let pinned = ConnectionSettings {
            mode: RunMode::Client,
            client_kind: ClientKind::Remote,
            host_address: "casa:6000".into(),
            host_certificate: Some("ab".repeat(32)),
            ..ConnectionSettings::default()
        };
        store(&app, &pinned).expect("write");
        assert!(is_client(&app));
        let (address, kind, pin) = client_host(&app).expect("client");
        assert_eq!((address.display().as_str(), kind, pin.is_some()), ("casa:6000", ClientKind::Remote, true));

        // Read back from the file by a fresh state.
        let reread = self::app(&directory);
        assert_eq!(settings(&reread), pinned);

        // A client file without host falls back to Host.
        std::fs::write(directory.join(FILE_NAME), r#"{"mode":"client","hostAddress":""}"#).expect("write");
        assert_eq!(settings(&self::app(&directory)).mode, RunMode::Host);
        let _ = std::fs::remove_dir_all(directory);
    }
}
