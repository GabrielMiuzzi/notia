//! Rust side of the Android fingerprint plugin (`BiometricPlugin.kt`).
//!
//! The plugin keeps one Keystore key per alias that only works right after
//! a strong biometric. `seal` hands it a secret to encrypt behind the
//! fingerprint and `open` gets it back the same way; both block until the
//! person answers the system prompt, so they run off the async runtime.
//! Outside Android there is no sensor: everything reports `Unsupported`.

// Outside Android the plugin never answers, so most variants are unused.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use crate::host::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    Manager, Wry,
};

#[cfg(target_os = "android")]
use crate::host::plugin::PluginHandle;
#[cfg(target_os = "android")]
use base64::Engine as _;
#[cfg(target_os = "android")]
use serde::Deserialize;

/// Whether this device can unlock with a fingerprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BiometricAvailability {
    Available,
    /// It has a sensor but no fingerprint registered in Android.
    NotEnrolled,
    Unsupported,
}

/// Why the fingerprint did not return the secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BiometricFailure {
    /// The person closed the prompt or chose the password.
    Cancelled,
    /// Too many wrong fingers: Android blocks the sensor for a while.
    Lockout,
    /// The fingerprints of the device changed and Android discarded the key.
    Invalidated,
    /// The key is not on the device any more.
    Missing,
    /// Another fingerprint prompt is already open.
    Busy,
    Unavailable,
    Failed,
}

/// A secret sealed behind the fingerprint (base64).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SealedSecret {
    pub(crate) iv: String,
    pub(crate) ciphertext: String,
}

/// The texts of the system prompt.
pub(crate) struct PromptText<'a> {
    pub(crate) title: &'a str,
    pub(crate) subtitle: &'a str,
}

pub struct BiometricState {
    #[cfg(target_os = "android")]
    handle: Option<PluginHandle<Wry>>,
}

#[cfg(target_os = "android")]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginAnswer {
    ok: bool,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    availability: Option<String>,
    #[serde(default)]
    iv: Option<String>,
    #[serde(default)]
    ciphertext: Option<String>,
    #[serde(default)]
    secret: Option<String>,
}

#[cfg(target_os = "android")]
fn failure_of(code: Option<&str>) -> BiometricFailure {
    match code {
        Some("cancelled") => BiometricFailure::Cancelled,
        Some("lockout") => BiometricFailure::Lockout,
        Some("invalidated") => BiometricFailure::Invalidated,
        Some("missing") => BiometricFailure::Missing,
        Some("busy") => BiometricFailure::Busy,
        Some("unavailable") => BiometricFailure::Unavailable,
        _ => BiometricFailure::Failed,
    }
}

#[cfg(target_os = "android")]
fn run(state: &BiometricState, command: &str, payload: serde_json::Value) -> Result<PluginAnswer, BiometricFailure> {
    let handle = state.handle.as_ref().ok_or(BiometricFailure::Unavailable)?;
    let answer = handle
        .run_mobile_plugin::<PluginAnswer>(command, payload)
        .map_err(|_| BiometricFailure::Failed)?;
    if answer.ok {
        Ok(answer)
    } else {
        Err(failure_of(answer.code.as_deref()))
    }
}

#[cfg(target_os = "android")]
pub(crate) fn availability(state: &BiometricState) -> BiometricAvailability {
    match run(state, "status", serde_json::json!({})).ok().and_then(|answer| answer.availability).as_deref() {
        Some("available") => BiometricAvailability::Available,
        Some("not-enrolled") => BiometricAvailability::NotEnrolled,
        _ => BiometricAvailability::Unsupported,
    }
}

/// Seals `secret` under a new key for `alias`; asks for the fingerprint.
#[cfg(target_os = "android")]
pub(crate) fn seal(state: &BiometricState, alias: &str, secret: &[u8], text: PromptText<'_>) -> Result<SealedSecret, BiometricFailure> {
    let payload = serde_json::json!({
        "alias": alias,
        "secret": base64::engine::general_purpose::STANDARD.encode(secret),
        "title": text.title,
        "subtitle": text.subtitle,
    });
    let answer = run(state, "enable", payload)?;
    match (answer.iv, answer.ciphertext) {
        (Some(iv), Some(ciphertext)) => Ok(SealedSecret { iv, ciphertext }),
        _ => Err(BiometricFailure::Failed),
    }
}

/// Opens what `seal` returned; asks for the fingerprint.
#[cfg(target_os = "android")]
pub(crate) fn open(state: &BiometricState, alias: &str, sealed: &SealedSecret, text: PromptText<'_>) -> Result<Vec<u8>, BiometricFailure> {
    let payload = serde_json::json!({
        "alias": alias,
        "iv": sealed.iv,
        "ciphertext": sealed.ciphertext,
        "title": text.title,
        "subtitle": text.subtitle,
    });
    let secret = run(state, "unlock", payload)?.secret.ok_or(BiometricFailure::Failed)?;
    base64::engine::general_purpose::STANDARD.decode(secret).map_err(|_| BiometricFailure::Failed)
}

/// Deletes the key of `alias` from the Keystore.
#[cfg(target_os = "android")]
pub(crate) fn remove(state: &BiometricState, alias: &str) {
    let _ = run(state, "remove", serde_json::json!({ "alias": alias }));
}

#[cfg(not(target_os = "android"))]
pub(crate) fn availability(_state: &BiometricState) -> BiometricAvailability {
    BiometricAvailability::Unsupported
}

#[cfg(not(target_os = "android"))]
pub(crate) fn seal(_state: &BiometricState, _alias: &str, _secret: &[u8], _text: PromptText<'_>) -> Result<SealedSecret, BiometricFailure> {
    Err(BiometricFailure::Unavailable)
}

#[cfg(not(target_os = "android"))]
pub(crate) fn open(_state: &BiometricState, _alias: &str, _sealed: &SealedSecret, _text: PromptText<'_>) -> Result<Vec<u8>, BiometricFailure> {
    Err(BiometricFailure::Unavailable)
}

#[cfg(not(target_os = "android"))]
pub(crate) fn remove(_state: &BiometricState, _alias: &str) {}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-biometric")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = match api.register_android_plugin("com.gabriel.notia", "BiometricPlugin") {
                    Ok(handle) => Some(handle),
                    Err(error) => {
                        log::error!("[notia:biometric] Android plugin unavailable: {error}");
                        None
                    }
                };
                app.manage(BiometricState { handle });
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(BiometricState {});
            }
            Ok(())
        })
        .build()
}
