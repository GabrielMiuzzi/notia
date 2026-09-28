//! HTTPS + WebSocket server of Notia for desktop hosts (Windows and Linux):
//! request handling, certificate, network addresses and rate limits shared
//! by the Task Manager publication and the headless mode.

pub(crate) mod api;
mod assets;
pub(crate) mod events;
pub mod headless;
pub(crate) mod http;
pub(crate) mod network;
mod owner;
pub(crate) mod rate;
pub(crate) mod tls;

/// Hub every event of the application reaches, for the clients of the
/// Host mode and the headless server (see `events::TeeEvents`).
pub(crate) struct SharedEventHub(pub(crate) std::sync::Arc<events::EventHub>);
