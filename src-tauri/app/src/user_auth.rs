use rand::RngCore;
use sha2::{Digest, Sha256};

pub const PASSWORD_HASH_ITERATIONS: u32 = 210_000;
pub const PASSWORD_MIN_LENGTH: usize = 8;
pub const PASSWORD_MAX_LENGTH: usize = 256;

pub fn validate_password(password: &str) -> Result<(), String> {
    let length = password.chars().count();
    if !(PASSWORD_MIN_LENGTH..=PASSWORD_MAX_LENGTH).contains(&length) {
        return Err("La contraseña debe tener entre 8 y 256 caracteres.".to_string());
    }
    Ok(())
}

pub fn hash_password(password: &str) -> Result<String, String> {
    validate_password(password)?;
    let mut salt = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    Ok(format_password_hash(password.as_bytes(), &salt))
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    let Some((salt, expected)) = parse_password_hash(encoded) else {
        return false;
    };
    let actual = pbkdf2_hmac_sha256(password.as_bytes(), &salt, PASSWORD_HASH_ITERATIONS);
    actual
        .iter()
        .zip(expected.iter())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn format_password_hash(password: &[u8], salt: &[u8]) -> String {
    let derived = pbkdf2_hmac_sha256(password, salt, PASSWORD_HASH_ITERATIONS);
    format!(
        "$notia-pbkdf2-sha256$v=1$i={PASSWORD_HASH_ITERATIONS}${}${}",
        encode_hex(salt),
        encode_hex(&derived)
    )
}

fn parse_password_hash(encoded: &str) -> Option<(Vec<u8>, [u8; 32])> {
    let parts = encoded.split('$').collect::<Vec<_>>();
    if parts.len() != 6
        || !parts[0].is_empty()
        || parts[1] != "notia-pbkdf2-sha256"
        || parts[2] != "v=1"
        || parts[3] != format!("i={PASSWORD_HASH_ITERATIONS}")
    {
        return None;
    }
    let salt = decode_hex(parts[4])?;
    let derived = decode_hex(parts[5])?;
    if salt.len() != 16 || derived.len() != 32 {
        return None;
    }
    Some((salt, derived.try_into().ok()?))
}

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut first_input = Vec::with_capacity(salt.len() + 4);
    first_input.extend_from_slice(salt);
    first_input.extend_from_slice(&1_u32.to_be_bytes());
    let mut current = hmac_sha256(password, &first_input);
    let mut derived = current;
    for _ in 1..iterations {
        current = hmac_sha256(password, &current);
        for (target, value) in derived.iter_mut().zip(current.iter()) {
            *target ^= value;
        }
    }
    derived
}

fn hmac_sha256(key: &[u8], value: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut normalized_key = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        normalized_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized_key[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= normalized_key[index];
        outer_pad[index] ^= normalized_key[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(value);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().into()
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{encode_hex, hash_password, parse_password_hash, pbkdf2_hmac_sha256, verify_password};

    #[test]
    fn hashes_are_salted_and_verifiable() {
        let first = hash_password("contraseña-segura").expect("hash");
        let second = hash_password("contraseña-segura").expect("hash");
        assert_ne!(first, second);
        assert!(parse_password_hash(&first).is_some());
        assert!(verify_password("contraseña-segura", &first));
        assert!(!verify_password("incorrecta", &first));
        assert!(hash_password("corta").is_err());
    }

    #[test]
    fn pbkdf2_matches_the_sha256_reference_vector() {
        assert_eq!(
            encode_hex(&pbkdf2_hmac_sha256(b"password", b"salt", 1)),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
        assert_eq!(
            encode_hex(&pbkdf2_hmac_sha256(b"password", b"salt", 2)),
            "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
        );
    }
}
