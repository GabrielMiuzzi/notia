//! Tauri host of Notia (feature `app`). Without that feature the crate only
//! provides the headless binary (`notia --headless`), which needs no Tauri.

#[cfg(feature = "app")]
mod tauri_host;
#[cfg(all(feature = "app", target_os = "windows"))]
mod windows_tray;

#[cfg(feature = "app")]
pub use tauri_host::run;
