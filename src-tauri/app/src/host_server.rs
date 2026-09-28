//! The server of the Host mode: while this device runs as a host, the API
//! of `server::api` listens on the configured port (all interfaces, HTTPS
//! with the certificate of `host-server/tls` in the app data folder) and
//! the clients use this library through it. `GET /api/health` answers the
//! clients' «Probar conexión».

use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::backend::connection::RunMode;
use crate::host::{AppHandle, Manager};
use crate::host_client::ServerView;
use crate::server::api::{ApiServer, ServerKind};

const SERVER_DIRECTORY: &str = "host-server";

struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub(crate) struct HostServerState {
    running: Mutex<Option<Running>>,
    error: Mutex<Option<(u16, String)>>,
}

/// Starts or stops the server so it follows the saved mode and port.
pub(crate) fn reconfigure(app: &AppHandle) {
    let Some(state) = app.try_state::<HostServerState>() else {
        return;
    };
    let settings = crate::connection::settings(app);
    let wanted = (settings.mode == RunMode::Host).then_some(settings.port);
    let mut running = state.running.lock().unwrap_or_else(|error| error.into_inner());
    if running.as_ref().map(|server| server.port) == wanted {
        return;
    }
    if let Some(server) = running.take() {
        server.stop.store(true, Ordering::SeqCst);
    }
    *state.error.lock().unwrap_or_else(|error| error.into_inner()) = None;
    let Some(port) = wanted else {
        return;
    };
    match start(app, port) {
        Ok(server) => *running = Some(server),
        Err(message) => {
            log::error!("[notia:host] the server did not start on port {port}: {message}");
            *state.error.lock().unwrap_or_else(|error| error.into_inner()) = Some((port, message));
        }
    }
}

fn start(app: &AppHandle, port: u16) -> Result<Running, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "No se encontró la carpeta de datos de Notia.".to_string())?
        .join(SERVER_DIRECTORY);
    let tls = crate::server::tls::server_config(&directory.join("tls"))?;
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)))
        .map_err(|_| format!("El puerto {port} está en uso por otro programa."))?;
    let hub = app.state::<crate::server::SharedEventHub>().inner().0.clone();
    let server = Arc::new(ApiServer::new(app.clone(), hub, None, ServerKind::Host, None, None));
    let stop = Arc::clone(&server.stop);
    std::thread::Builder::new()
        .name("notia-host-server".into())
        .spawn(move || crate::server::api::run(listener, server, tls))
        .map_err(|_| "No se pudo iniciar el servidor del host.".to_string())?;
    Ok(Running { port, stop })
}

/// What Settings shows next to the port.
pub(crate) fn view(app: &AppHandle) -> ServerView {
    let port = crate::connection::settings(app).port;
    let Some(state) = app.try_state::<HostServerState>() else {
        return ServerView { listening: false, port, error: None };
    };
    let listening = state.running.lock().map(|running| running.is_some()).unwrap_or(false);
    let error = state
        .error
        .lock()
        .ok()
        .and_then(|error| error.clone())
        .filter(|(failed_port, _)| *failed_port == port)
        .map(|(_, message)| message);
    ServerView { listening, port, error }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::connection::{ConnectionSettings, RunMode};
    use crate::host::{AppPaths, HostPorts};

    #[test]
    fn a_client_does_not_listen() {
        let directory = std::env::temp_dir().join(format!("notia-host-server-{}", uuid::Uuid::new_v4()));
        let app = crate::create_app(AppPaths::new(Some(directory.clone()), None), HostPorts::default());
        let client = ConnectionSettings { mode: RunMode::Client, host_address: "casa:6000".into(), ..ConnectionSettings::default() };
        crate::connection::store(&app, &client).expect("store");
        reconfigure(&app);
        let view = view(&app);
        assert!(!view.listening && view.error.is_none());
        assert_eq!(view.port, client.port);
        let _ = std::fs::remove_dir_all(directory);
    }
}
