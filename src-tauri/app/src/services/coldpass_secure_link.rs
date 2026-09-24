//! Encrypted packets of the ColdPass Bluetooth link. The device expects
//! `KIND|iterations|salt|iv|cipher` in hex, with AES-256-CBC (PKCS#7) and a
//! key derived by PBKDF2-HMAC-SHA256 from the passkey. The passkey never
//! leaves the backend; the interface only sends the challenge or message.

use std::num::NonZeroU32;

use aes::cipher::block_padding::Pkcs7;
use aes::cipher::{BlockEncryptMut, KeyIvInit};
use ring::rand::{SecureRandom, SystemRandom};

const KDF_ITERATIONS: u32 = 120_000;
const SALT_LENGTH: usize = 16;
const IV_LENGTH: usize = 16;
const MAX_PLAINTEXT_BYTES: usize = 4_096;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn derive_key(passkey: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0_u8; 32];
    ring::pbkdf2::derive(
        ring::pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(KDF_ITERATIONS).expect("non-zero iterations"),
        salt,
        passkey.as_bytes(),
        &mut key,
    );
    key
}

fn encrypt(plaintext: &[u8], key: &[u8; 32], iv: &[u8; IV_LENGTH]) -> Vec<u8> {
    let mut buffer = vec![0_u8; plaintext.len() + IV_LENGTH];
    buffer[..plaintext.len()].copy_from_slice(plaintext);
    let length = cbc::Encryptor::<aes::Aes256>::new(key.into(), iv.into())
        .encrypt_padded_mut::<Pkcs7>(&mut buffer, plaintext.len())
        .map(<[u8]>::len)
        .unwrap_or_default();
    buffer.truncate(length);
    buffer
}

/// Packet of `kind` (`AUTH` or `MSG`) for `plaintext` under `passkey`.
pub fn encrypt_packet(kind: &str, plaintext: &str, passkey: &str) -> Result<String, String> {
    let passkey = passkey.trim();
    if passkey.is_empty() {
        return Err("La passkey no puede estar vacía.".to_string());
    }
    if !matches!(kind, "AUTH" | "MSG") || plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("El mensaje para ColdPass no es válido.".to_string());
    }
    let random = SystemRandom::new();
    let mut salt = [0_u8; SALT_LENGTH];
    let mut iv = [0_u8; IV_LENGTH];
    random
        .fill(&mut salt)
        .and_then(|()| random.fill(&mut iv))
        .map_err(|_| "No se pudo generar el cifrado para ColdPass.".to_string())?;
    let cipher = encrypt(plaintext.as_bytes(), &derive_key(passkey, &salt), &iv);
    Ok([kind.to_string(), KDF_ITERATIONS.to_string(), hex(&salt), hex(&iv), hex(&cipher)].join("|"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packets_have_the_device_format() {
        let packet = encrypt_packet("AUTH", "challenge", "clave").expect("packet");
        let parts = packet.split('|').collect::<Vec<_>>();
        assert_eq!(parts[..2], ["AUTH", "120000"]);
        assert_eq!((parts[2].len(), parts[3].len(), parts[4].len()), (32, 32, 32));
        assert!(encrypt_packet("MSG", "x", " ").is_err());
    }

    #[test]
    fn cbc_pads_to_whole_blocks() {
        let key = [7_u8; 32];
        let iv = [1_u8; IV_LENGTH];
        assert_eq!(encrypt(b"", &key, &iv).len(), 16);
        assert_eq!(encrypt(&[0_u8; 16], &key, &iv).len(), 32);
    }
}
