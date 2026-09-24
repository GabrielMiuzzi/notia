//! HTTPS + WebSocket server of Notia for desktop hosts (Windows and Linux):
//! request handling, certificate, network addresses and rate limits shared
//! by the Task Manager publication and the headless mode.

mod assets;
mod events;
pub mod headless;
pub(crate) mod http;
pub(crate) mod network;
mod owner;
pub(crate) mod rate;
pub(crate) mod tls;
