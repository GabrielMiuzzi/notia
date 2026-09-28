//! Encrypted form of the library configuration (`.notia/notiaConfig.json`).
//!
//! The configuration is sealed with a random data key (AES-256-GCM). That
//! key is sealed in turn with a key derived from the Owner's password
//! (PBKDF2-HMAC-SHA256), so changing the password only seals the data key
//! again. Without the password the file cannot be read: there is no
//! recovery. This module owns the stored shape; the app adapter does the
//! cryptography.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{BackendError, BackendErrorCode};

pub const ENVELOPE_VERSION: u8 = 1;
pub const CIPHER_AES_256_GCM: &str = "aes-256-gcm";
pub const KDF_PBKDF2_SHA256: &str = "pbkdf2-sha256";
/// PBKDF2 rounds for a new password.
pub const PASSWORD_KDF_ITERATIONS: u32 = 600_000;
const MIN_KDF_ITERATIONS: u32 = 100_000;
const MAX_KDF_ITERATIONS: u32 = 10_000_000;
pub const SALT_BYTES: usize = 16;
pub const NONCE_BYTES: usize = 12;
pub const KEY_BYTES: usize = 32;
/// Associated data of the sealed data key and of the sealed configuration,
/// so one can never be passed off as the other.
pub const KEY_AAD: &[u8] = b"notia-config-key-v1";
pub const PAYLOAD_AAD: &[u8] = b"notia-config-v1";
const ENCRYPTED_MARKER: &str = "notiaEncrypted";

/// A nonce and the ciphertext sealed with it (tag included), in base64.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sealed {
    pub nonce: String,
    pub data: String,
}

impl Sealed {
    pub fn new(nonce: &[u8; NONCE_BYTES], data: &[u8]) -> Self {
        Self { nonce: encode(nonce), data: encode(data) }
    }

    /// The nonce and the ciphertext, or `None` when they are not valid.
    pub fn decode(&self) -> Option<([u8; NONCE_BYTES], Vec<u8>)> {
        let nonce = decode(&self.nonce)?.try_into().ok()?;
        let data = decode(&self.data)?;
        (!data.is_empty()).then_some((nonce, data))
    }
}

/// The data key sealed with the key derived from the Owner's password.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WrappedKey {
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
    pub sealed: Sealed,
}

impl WrappedKey {
    pub fn new(iterations: u32, salt: &[u8; SALT_BYTES], sealed: Sealed) -> Self {
        Self { kdf: KDF_PBKDF2_SHA256.to_string(), iterations, salt: encode(salt), sealed }
    }

    pub fn salt_bytes(&self) -> Option<[u8; SALT_BYTES]> {
        decode(&self.salt)?.try_into().ok()
    }
}

/// The stored encrypted configuration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEnvelope {
    pub notia_encrypted: u8,
    pub cipher: String,
    pub key: WrappedKey,
    pub payload: Sealed,
}

impl ConfigEnvelope {
    pub fn new(key: WrappedKey, payload: Sealed) -> Self {
        Self { notia_encrypted: ENVELOPE_VERSION, cipher: CIPHER_AES_256_GCM.to_string(), key, payload }
    }

    fn validate(&self) -> Result<(), BackendError> {
        let valid = self.notia_encrypted == ENVELOPE_VERSION
            && self.cipher == CIPHER_AES_256_GCM
            && self.key.kdf == KDF_PBKDF2_SHA256
            && (MIN_KDF_ITERATIONS..=MAX_KDF_ITERATIONS).contains(&self.key.iterations)
            && self.key.salt_bytes().is_some()
            && self.key.sealed.decode().is_some()
            && self.payload.decode().is_some();
        if valid { Ok(()) } else { Err(damaged()) }
    }
}

/// What `.notia/notiaConfig.json` holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredConfig {
    /// A configuration from before the Owner had a password.
    Plain(String),
    Encrypted(ConfigEnvelope),
}

/// Tells an encrypted file from a plain one. A file that says it is
/// encrypted but is damaged is an error, never plain text to overwrite.
pub fn classify_stored_config(text: &str) -> Result<StoredConfig, BackendError> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Ok(StoredConfig::Plain(text.to_string()));
    };
    if value.get(ENCRYPTED_MARKER).is_none() {
        return Ok(StoredConfig::Plain(text.to_string()));
    }
    let envelope = serde_json::from_value::<ConfigEnvelope>(value).map_err(|_| damaged())?;
    envelope.validate()?;
    Ok(StoredConfig::Encrypted(envelope))
}

pub fn serialize_envelope(envelope: &ConfigEnvelope) -> Result<String, BackendError> {
    serde_json::to_string_pretty(envelope)
        .map_err(|_| BackendError::invalid_input("No se pudo guardar la configuración cifrada."))
}

/// Error of a library whose configuration is encrypted and not unlocked.
pub fn locked_error() -> BackendError {
    BackendError::new(
        BackendErrorCode::Unauthorized,
        "La biblioteca está bloqueada: iniciá sesión con el usuario Owner.",
        false,
    )
}

fn damaged() -> BackendError {
    BackendError::new(
        BackendErrorCode::Storage,
        "La configuración cifrada de la biblioteca está dañada.",
        false,
    )
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode(text: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::STANDARD.decode(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope() -> ConfigEnvelope {
        ConfigEnvelope::new(
            WrappedKey::new(PASSWORD_KDF_ITERATIONS, &[1; SALT_BYTES], Sealed::new(&[2; NONCE_BYTES], &[3; 48])),
            Sealed::new(&[4; NONCE_BYTES], &[5; 40]),
        )
    }

    #[test]
    fn plain_and_encrypted_files_are_told_apart() {
        let plain = "{\"version\":1,\"contexts\":[]}";
        assert_eq!(classify_stored_config(plain).expect("plain"), StoredConfig::Plain(plain.to_string()));
        assert_eq!(classify_stored_config("no json").expect("plain"), StoredConfig::Plain("no json".to_string()));
        let text = serialize_envelope(&envelope()).expect("serialized");
        assert!(text.contains("\"notiaEncrypted\": 1") && text.contains("aes-256-gcm") && text.contains("pbkdf2-sha256"));
        assert_eq!(classify_stored_config(&text).expect("encrypted"), StoredConfig::Encrypted(envelope()));
        let (nonce, data) = envelope().payload.decode().expect("payload");
        assert_eq!((nonce, data.len()), ([4; NONCE_BYTES], 40));
        assert_eq!(envelope().key.salt_bytes(), Some([1; SALT_BYTES]));
    }

    #[test]
    fn a_damaged_envelope_is_an_error_not_plain_text() {
        assert!(classify_stored_config("{\"notiaEncrypted\": 1}").is_err());
        let mut weak = envelope();
        weak.key.iterations = 10;
        assert!(classify_stored_config(&serialize_envelope(&weak).expect("text")).is_err());
        let mut short_nonce = envelope();
        short_nonce.payload.nonce = encode(&[1; 4]);
        assert!(classify_stored_config(&serialize_envelope(&short_nonce).expect("text")).is_err());
        assert_eq!(locked_error().code, BackendErrorCode::Unauthorized);
    }
}
