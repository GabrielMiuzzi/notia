//! How a client's link with its host is, said outside the window: on
//! Android, a fixed notification while Notia is open (connecting, connected,
//! syncing the copy, a failed sync, or without the host).
//!
//! The state comes from `host_client` (the link and the session) and
//! `host_mirror` (the copy); both call [`refresh`] when it changes. The
//! notification only shows what [`describe`] decides.

use serde::Serialize;

use crate::backend::connection::ClientKind;
use crate::host::AppHandle;
use crate::host_client::LinkState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum StatusKind {
    Connecting,
    Connected,
    Syncing,
    /// The host answers but the copy did not sync.
    Failed,
    /// The host does not answer.
    Offline,
}

impl StatusKind {
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Syncing => "syncing",
            Self::Failed => "failed",
            Self::Offline => "offline",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientStatus {
    pub(crate) kind: StatusKind,
    pub(crate) title: String,
    pub(crate) text: String,
}

/// What the status is made of.
#[derive(Debug, Clone, Default)]
pub(crate) struct StatusInput {
    /// `None` when this device is not a client.
    pub(crate) client_kind: Option<ClientKind>,
    pub(crate) host_address: String,
    pub(crate) link: LinkState,
    pub(crate) library: Option<String>,
    pub(crate) signed_in: bool,
    pub(crate) link_message: Option<String>,
    /// The window works on the copy, without the host.
    pub(crate) on_copy: bool,
    /// The copy is moving files or the database.
    pub(crate) transferring: bool,
    /// The error of the last sync of the copy.
    pub(crate) sync_error: Option<String>,
}

fn status(kind: StatusKind, title: &str, text: String) -> Option<ClientStatus> {
    Some(ClientStatus { kind, title: title.to_string(), text })
}

/// The status of the link, or `None` when this device is not a client.
pub(crate) fn describe(input: &StatusInput) -> Option<ClientStatus> {
    let kind = input.client_kind?;
    let library = input.library.as_deref().filter(|name| !name.trim().is_empty()).unwrap_or("la biblioteca");
    let host = input.host_address.as_str();
    if input.on_copy {
        return if input.link == LinkState::Online {
            status(StatusKind::Connecting, "El host volvió a responder", "Notia vuelve al host y sincroniza la copia en segundo plano.".into())
        } else {
            status(
                StatusKind::Offline,
                "Sin conexión con el host",
                format!("Trabajás con la copia local. Se sincroniza con {host} cuando vuelva a responder."),
            )
        };
    }
    match input.link {
        LinkState::Unknown => status(StatusKind::Connecting, "Conectando con el host", format!("{host}…")),
        LinkState::Offline => {
            let text = input.link_message.clone().unwrap_or_else(|| format!("{host} no responde. Reintentando…"));
            status(StatusKind::Offline, "No se pudo conectar con el host", text)
        }
        LinkState::Online if !input.signed_in => {
            status(StatusKind::Connecting, "Host disponible", format!("Iniciá sesión en Notia para usar {library}."))
        }
        LinkState::Online if kind == ClientKind::Copy && input.transferring => {
            status(StatusKind::Syncing, "Sincronizando la copia", format!("{library} con {host}."))
        }
        LinkState::Online => match (kind, &input.sync_error) {
            (ClientKind::Copy, Some(error)) => status(StatusKind::Failed, "No se pudo sincronizar la copia", error.clone()),
            (ClientKind::Copy, None) => status(StatusKind::Connected, "Conectado con el host", format!("{library} en {host} · copia al día.")),
            (ClientKind::Remote, _) => status(StatusKind::Connected, "Conectado con el host", format!("{library} en {host}.")),
        },
    }
}

/// The status of this device now.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn current(app: &AppHandle) -> Option<ClientStatus> {
    let (_, client_kind, _) = crate::connection::client_host(app)?;
    let link = crate::host_client::link_view(app);
    describe(&StatusInput {
        client_kind: Some(client_kind),
        host_address: crate::connection::settings(app).host_address,
        link: link.state,
        library: link.library,
        signed_in: link.signed_in,
        link_message: link.message,
        on_copy: crate::host_mirror::is_offline(app),
        transferring: crate::host_mirror::is_transferring(app),
        sync_error: crate::host_mirror::last_error(app),
    })
}

/// Shows the status again when it changed (Android); elsewhere the window
/// already shows it.
pub(crate) fn refresh(app: &AppHandle) {
    #[cfg(target_os = "android")]
    android::show(app, current(app));
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

#[cfg(target_os = "android")]
mod android {
    use std::sync::mpsc::{self, Sender};
    use std::sync::{Mutex, OnceLock};

    use super::ClientStatus;
    use crate::host::{AppHandle, Manager};
    use crate::mobile_continuity::{clear_android_connection_status, show_android_connection_status, ContinuityState};

    /// The plugin is called from its own thread, in order: the callers hold
    /// locks of the link or the copy, and only the last status matters.
    static NOTIFIER: OnceLock<Mutex<Sender<Option<ClientStatus>>>> = OnceLock::new();

    pub(super) fn show(app: &AppHandle, status: Option<ClientStatus>) {
        let sender = NOTIFIER.get_or_init(|| {
            let (sender, receiver) = mpsc::channel::<Option<ClientStatus>>();
            let app = app.clone();
            let spawned = std::thread::Builder::new().name("notia-link-status".into()).spawn(move || {
                // `None` inside means «no notification»; the outer one, not
                // shown yet (a notification left by an earlier run goes).
                let mut shown: Option<Option<ClientStatus>> = None;
                while let Ok(mut next) = receiver.recv() {
                    while let Ok(newer) = receiver.try_recv() {
                        next = newer;
                    }
                    if shown.as_ref() == Some(&next) {
                        continue;
                    }
                    let Some(state) = app.try_state::<ContinuityState>() else {
                        continue;
                    };
                    let done = match &next {
                        Some(status) => show_android_connection_status(&state, status.kind.as_str(), &status.title, &status.text),
                        None => clear_android_connection_status(&state),
                    };
                    if done {
                        shown = Some(next);
                    }
                }
            });
            if spawned.is_err() {
                log::error!("[notia:client] the link status notifier did not start");
            }
            Mutex::new(sender)
        });
        if let Ok(sender) = sender.lock() {
            let _ = sender.send(status);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy_client(link: LinkState) -> StatusInput {
        StatusInput {
            client_kind: Some(ClientKind::Copy),
            host_address: "casa:52480".into(),
            link,
            library: Some("Notas".into()),
            signed_in: true,
            ..StatusInput::default()
        }
    }

    #[test]
    fn a_host_shows_no_status() {
        assert_eq!(describe(&StatusInput::default()), None);
    }

    #[test]
    fn the_status_follows_the_link_and_the_copy() {
        let kind = |input: &StatusInput| describe(input).expect("status").kind;
        assert_eq!(kind(&copy_client(LinkState::Unknown)), StatusKind::Connecting);
        assert_eq!(kind(&copy_client(LinkState::Online)), StatusKind::Connected);
        assert_eq!(kind(&StatusInput { transferring: true, ..copy_client(LinkState::Online) }), StatusKind::Syncing);
        let failed = describe(&StatusInput { sync_error: Some("Sin espacio.".into()), ..copy_client(LinkState::Online) }).expect("failed");
        assert_eq!((failed.kind, failed.text.as_str()), (StatusKind::Failed, "Sin espacio."));
        assert_eq!(kind(&StatusInput { signed_in: false, ..copy_client(LinkState::Online) }), StatusKind::Connecting);

        let offline = describe(&copy_client(LinkState::Offline)).expect("offline");
        assert_eq!((offline.kind, offline.text.as_str()), (StatusKind::Offline, "casa:52480 no responde. Reintentando…"));
        let on_copy = describe(&StatusInput { on_copy: true, ..copy_client(LinkState::Offline) }).expect("copy");
        assert_eq!(on_copy.title, "Sin conexión con el host");
        assert_eq!(kind(&StatusInput { on_copy: true, ..copy_client(LinkState::Online) }), StatusKind::Connecting);
    }

    #[test]
    fn a_remote_client_has_no_copy_to_sync() {
        let remote = StatusInput { client_kind: Some(ClientKind::Remote), transferring: true, sync_error: Some("x".into()), ..copy_client(LinkState::Online) };
        let status = describe(&remote).expect("status");
        assert_eq!((status.kind, status.text.as_str()), (StatusKind::Connected, "Notas en casa:52480."));
    }
}
