//! Credential of the owner of a headless server: a PBKDF2 hash stored in the
//! data folder. The password itself is never written.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::user_auth::{hash_password, verify_password};

const OWNER_FILE: &str = "owner.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerCredential {
    password_hash: String,
}

fn owner_file(server_dir: &Path) -> PathBuf {
    server_dir.join(OWNER_FILE)
}

/// Stores a new owner password, replacing the previous one.
pub(crate) fn set_owner_password(server_dir: &Path, password: &str) -> Result<(), String> {
    let credential = OwnerCredential { password_hash: hash_password(password)? };
    std::fs::create_dir_all(server_dir).map_err(|_| "No se pudo preparar la carpeta del servidor.".to_string())?;
    let body = serde_json::to_vec_pretty(&credential).map_err(|_| "No se pudo guardar la contraseña.".to_string())?;
    std::fs::write(owner_file(server_dir), body).map_err(|_| "No se pudo guardar la contraseña.".to_string())
}

pub(crate) fn has_owner_password(server_dir: &Path) -> bool {
    read_credential(server_dir).is_some()
}

pub(crate) fn verify_owner_password(server_dir: &Path, password: &str) -> bool {
    read_credential(server_dir).is_some_and(|credential| verify_password(password, &credential.password_hash))
}

fn read_credential(server_dir: &Path) -> Option<OwnerCredential> {
    let body = std::fs::read(owner_file(server_dir)).ok()?;
    serde_json::from_slice(&body).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_only_the_stored_password() {
        let directory = std::env::temp_dir().join(format!("notia-owner-test-{}", uuid::Uuid::new_v4()));
        assert!(!has_owner_password(&directory));
        assert!(set_owner_password(&directory, "corta").is_err());
        set_owner_password(&directory, "una contraseña larga").expect("password stored");
        assert!(has_owner_password(&directory));
        assert!(verify_owner_password(&directory, "una contraseña larga"));
        assert!(!verify_owner_password(&directory, "otra contraseña"));
        let stored = std::fs::read_to_string(directory.join(OWNER_FILE)).expect("credential");
        assert!(!stored.contains("una contraseña larga"));
        let _ = std::fs::remove_dir_all(&directory);
    }
}
