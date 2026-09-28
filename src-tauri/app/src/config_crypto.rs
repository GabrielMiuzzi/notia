//! Cryptography of the encrypted library configuration: AES-256-GCM for the
//! configuration and for the data key, PBKDF2-HMAC-SHA256 to derive the key
//! that seals the data key from the Owner's password. The stored shape and
//! its rules live in `backend_core::config_envelope`.

use std::num::NonZeroU32;

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::pbkdf2;
use ring::rand::{SecureRandom, SystemRandom};

use crate::backend::config_envelope::{
    ConfigEnvelope, Sealed, WrappedKey, KEY_AAD, KEY_BYTES, NONCE_BYTES, PASSWORD_KDF_ITERATIONS, PAYLOAD_AAD, SALT_BYTES,
};
use crate::backend::{BackendError, BackendErrorCode};

/// The random key that seals one library's configuration. Its bytes are
/// wiped when it is dropped.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct DataKey([u8; KEY_BYTES]);

impl DataKey {
    pub(crate) fn new() -> Result<Self, BackendError> {
        random_bytes().map(Self)
    }

    pub(crate) fn from_bytes(bytes: &[u8]) -> Option<Self> {
        bytes.try_into().ok().map(Self)
    }

    pub(crate) fn bytes(&self) -> &[u8; KEY_BYTES] {
        &self.0
    }
}

impl Drop for DataKey {
    fn drop(&mut self) {
        self.0.iter_mut().for_each(|byte| *byte = 0);
    }
}

impl std::fmt::Debug for DataKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DataKey(..)")
    }
}

fn random_bytes<const N: usize>() -> Result<[u8; N], BackendError> {
    let mut bytes = [0u8; N];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo generar una clave segura.", true))?;
    Ok(bytes)
}

fn derive(password: &str, salt: &[u8; SALT_BYTES], iterations: u32) -> Option<[u8; KEY_BYTES]> {
    let mut key = [0u8; KEY_BYTES];
    pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256, NonZeroU32::new(iterations)?, salt, password.as_bytes(), &mut key);
    Some(key)
}

fn aead_key(key: &[u8; KEY_BYTES]) -> Option<LessSafeKey> {
    UnboundKey::new(&AES_256_GCM, key).ok().map(LessSafeKey::new)
}

fn seal(key: &[u8; KEY_BYTES], plaintext: &[u8], aad: &[u8]) -> Result<Sealed, BackendError> {
    let failed = || BackendError::new(BackendErrorCode::Internal, "No se pudo cifrar la configuración.", false);
    let nonce_bytes = random_bytes::<NONCE_BYTES>()?;
    let mut data = plaintext.to_vec();
    aead_key(key)
        .ok_or_else(failed)?
        .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce_bytes), Aad::from(aad), &mut data)
        .map_err(|_| failed())?;
    Ok(Sealed::new(&nonce_bytes, &data))
}

fn open(key: &[u8; KEY_BYTES], sealed: &Sealed, aad: &[u8]) -> Option<Vec<u8>> {
    let (nonce, mut data) = sealed.decode()?;
    let plaintext = aead_key(key)?.open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(aad), &mut data).ok()?;
    Some(plaintext.to_vec())
}

/// Seals `data_key` with a key derived from `password` and a new salt.
pub(crate) fn wrap_key(data_key: &DataKey, password: &str) -> Result<WrappedKey, BackendError> {
    let salt = random_bytes::<SALT_BYTES>()?;
    let key = derive(password, &salt, PASSWORD_KDF_ITERATIONS)
        .ok_or_else(|| BackendError::new(BackendErrorCode::Internal, "No se pudo derivar la clave.", false))?;
    let sealed = seal(&key, data_key.bytes(), KEY_AAD)?;
    Ok(WrappedKey::new(PASSWORD_KDF_ITERATIONS, &salt, sealed))
}

/// The data key sealed in `wrapped`, or `None` when `password` is wrong.
pub(crate) fn unwrap_key(wrapped: &WrappedKey, password: &str) -> Option<DataKey> {
    let key = derive(password, &wrapped.salt_bytes()?, wrapped.iterations)?;
    DataKey::from_bytes(&open(&key, &wrapped.sealed, KEY_AAD)?)
}

/// The configuration `text` sealed with `data_key`, next to its wrapped key.
pub(crate) fn seal_config(data_key: &DataKey, wrapped: &WrappedKey, text: &str) -> Result<ConfigEnvelope, BackendError> {
    Ok(ConfigEnvelope::new(wrapped.clone(), seal(data_key.bytes(), text.as_bytes(), PAYLOAD_AAD)?))
}

/// The configuration text of `envelope`, or `None` when `data_key` is not
/// its key or the file was altered.
pub(crate) fn open_config(data_key: &DataKey, envelope: &ConfigEnvelope) -> Option<String> {
    String::from_utf8(open(data_key.bytes(), &envelope.payload, PAYLOAD_AAD)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_configuration_opens_only_with_its_key_and_password() {
        let data_key = DataKey::new().expect("key");
        let wrapped = wrap_key(&data_key, "contraseña-segura").expect("wrapped");
        let envelope = seal_config(&data_key, &wrapped, "{\"version\":1}").expect("sealed");
        assert_eq!(open_config(&data_key, &envelope).as_deref(), Some("{\"version\":1}"));

        let unwrapped = unwrap_key(&envelope.key, "contraseña-segura").expect("right password");
        assert!(unwrapped == data_key);
        assert!(unwrap_key(&envelope.key, "otra-contraseña").is_none());
        assert!(open_config(&DataKey::new().expect("key"), &envelope).is_none());

        // A new password seals the same key again; the payload stays valid.
        let rewrapped = wrap_key(&data_key, "nueva-contraseña").expect("rewrapped");
        assert!(unwrap_key(&rewrapped, "nueva-contraseña").is_some_and(|key| key == data_key));
        assert!(unwrap_key(&rewrapped, "contraseña-segura").is_none());
    }

    #[test]
    fn altered_or_swapped_ciphertexts_do_not_open() {
        let data_key = DataKey::new().expect("key");
        let wrapped = wrap_key(&data_key, "contraseña-segura").expect("wrapped");
        let mut envelope = seal_config(&data_key, &wrapped, "{\"telegram\":{}}").expect("sealed");
        let mut tampered = envelope.clone();
        tampered.payload.data = tampered.key.sealed.data.clone();
        tampered.payload.nonce = tampered.key.sealed.nonce.clone();
        // The sealed key is not accepted as configuration (different associated data).
        assert!(open_config(&data_key, &tampered).is_none());
        let (nonce, mut data) = envelope.payload.decode().expect("payload");
        data[0] ^= 1;
        envelope.payload = Sealed::new(&nonce, &data);
        assert!(open_config(&data_key, &envelope).is_none());
    }
}
