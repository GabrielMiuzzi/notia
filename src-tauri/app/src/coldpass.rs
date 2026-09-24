//! ColdPass vault adapter: encryption compatible with the existing files
//! (AES-256-GCM, PBKDF2-HMAC-SHA256 with 250 000 iterations), the unlocked
//! session and its commands. The passkey stays in the backend; the WebView
//! receives only the entries it renders.

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::Mutex;

use base64::Engine as _;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager, State};

use crate::backend::coldpass::{
    empty_coldpass_markdown, parse_coldpass_csv, parse_coldpass_markdown,
    stringify_coldpass_markdown, upsert_coldpass_entry, ColdPassEntryDto,
};
use crate::backend::{BackendError, BackendErrorCode, DocumentLocatorDto};
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const ENCRYPTED_HEADER: &str = "<!-- NOTIA_COLDPASS_AES256_PBKDF2_V1 -->";
const PBKDF2_ITERATIONS: u32 = 250_000;
const SALT_LENGTH: usize = 16;
const IV_LENGTH: usize = 12;
const VAULT_LOGICAL_PATH: &str = "ColdPass/ColdPass.md";
const MAX_CSV_BYTES: usize = 5 * 1024 * 1024;
const MAX_PASSKEY_CHARS: usize = 1_024;

struct UnlockedVault {
    passkey: String,
    entries: Vec<ColdPassEntryDto>,
    pending_import: Option<Vec<ColdPassEntryDto>>,
}

/// Unlocked vaults by library. Locking or revoking a library drops them.
#[derive(Default)]
pub(crate) struct ColdPassState {
    vaults: Mutex<HashMap<String, UnlockedVault>>,
}

impl ColdPassState {
    /// Drops the unlocked vault of a library (lock, revocation).
    pub(crate) fn lock_library(&self, library_id: &str) {
        if let Ok(mut vaults) = self.vaults.lock() {
            vaults.remove(library_id);
        }
    }
}

fn derive_key(passkey: &str, salt: &[u8]) -> Result<LessSafeKey, BackendError> {
    let mut key = [0u8; 32];
    ring::pbkdf2::derive(
        ring::pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(PBKDF2_ITERATIONS).expect("non-zero iterations"),
        salt,
        passkey.as_bytes(),
        &mut key,
    );
    let unbound = UnboundKey::new(&AES_256_GCM, &key).map_err(|_| crypto_error())?;
    Ok(LessSafeKey::new(unbound))
}

fn crypto_error() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo cifrar el vault.", false)
}

fn invalid_passkey() -> BackendError {
    BackendError::new(
        BackendErrorCode::Forbidden,
        "La passkey no es válida o el vault está dañado.",
        true,
    )
}

pub(crate) fn encrypt_vault(plaintext: &str, passkey: &str) -> Result<String, BackendError> {
    let random = SystemRandom::new();
    let mut salt = [0u8; SALT_LENGTH];
    let mut iv = [0u8; IV_LENGTH];
    random.fill(&mut salt).map_err(|_| crypto_error())?;
    random.fill(&mut iv).map_err(|_| crypto_error())?;
    let key = derive_key(passkey, &salt)?;
    let mut data = plaintext.as_bytes().to_vec();
    key.seal_in_place_append_tag(Nonce::assume_unique_for_key(iv), Aad::empty(), &mut data)
        .map_err(|_| crypto_error())?;
    let encode = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!(
        "{ENCRYPTED_HEADER}\nsalt: {}\niv: {}\nciphertext: {}",
        encode(&salt),
        encode(&iv),
        encode(&data)
    ))
}

pub(crate) fn decrypt_vault(content: &str, passkey: &str) -> Result<String, BackendError> {
    let normalized = content.trim();
    let body = normalized
        .strip_prefix(ENCRYPTED_HEADER)
        .ok_or_else(|| BackendError::invalid_input("El archivo de ColdPass no tiene el formato esperado."))?;
    let field = |name: &str| {
        body.lines()
            .filter_map(|line| line.split_once(':'))
            .find(|(key, _)| key.trim() == name)
            .map(|(_, value)| value.trim().to_string())
            .ok_or_else(invalid_passkey)
    };
    let decode = |value: String| {
        base64::engine::general_purpose::STANDARD
            .decode(value)
            .map_err(|_| invalid_passkey())
    };
    let salt = decode(field("salt")?)?;
    let iv: [u8; IV_LENGTH] = decode(field("iv")?)?.try_into().map_err(|_| invalid_passkey())?;
    let mut data = decode(field("ciphertext")?)?;
    let key = derive_key(passkey, &salt)?;
    let plaintext = key
        .open_in_place(Nonce::assume_unique_for_key(iv), Aad::empty(), &mut data)
        .map_err(|_| invalid_passkey())?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| invalid_passkey())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Constant-time comparison so a wrong passkey takes as long as a right one.
fn same_passkey(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    left.len() == right.len()
        && left.iter().zip(right).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn vault_locator(library_id: &str) -> Result<DocumentLocatorDto, BackendError> {
    DocumentLocatorDto::new(library_id, VAULT_LOGICAL_PATH, None, None)
}

fn persist(
    app: &AppHandle,
    library_id: &str,
    passkey: &str,
    entries: &[ColdPassEntryDto],
) -> Result<(), BackendError> {
    let encrypted = encrypt_vault(&stringify_coldpass_markdown(entries)?, passkey)?;
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    TauriFilesystemDocumentAdapter::for_library(registry.inner(), library_id, picker.inner())?
        .upsert_text_locator(&vault_locator(library_id)?, &encrypted)
}

fn locked() -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, "ColdPass está bloqueado.", true)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassPayload {
    library_id: String,
    #[serde(default)]
    passkey: Option<String>,
    #[serde(default)]
    entry: Option<ColdPassEntryDto>,
    #[serde(default)]
    entry_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassEntriesDto {
    entries: Vec<ColdPassEntryDto>,
}

fn with_vault<R>(
    state: &ColdPassState,
    library_id: &str,
    operation: impl FnOnce(&mut UnlockedVault) -> Result<R, BackendError>,
) -> Result<R, BackendError> {
    let mut vaults = state
        .vaults
        .lock()
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true))?;
    let vault = vaults.get_mut(library_id).ok_or_else(locked)?;
    operation(vault)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassStatusDto {
    /// The library already has a vault; a first unlock creates it.
    exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratePasswordPayload {
    options: crate::backend::coldpass::PasswordOptions,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedPasswordDto {
    password: String,
    brute_force_seconds: f64,
}

/// Whether the library already has a vault.
pub(crate) async fn coldpass_status(app: AppHandle, payload: ColdPassPayload) -> Result<ColdPassStatusDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let registry = app.state::<LibraryBindingRegistry>();
        let picker = app.state::<AndroidDirectoryPickerState>();
        let adapter = TauriFilesystemDocumentAdapter::for_library(registry.inner(), &payload.library_id, picker.inner())?;
        Ok(ColdPassStatusDto { exists: adapter.exists_locator(&vault_locator(&payload.library_id)?)? })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo consultar ColdPass.", true))?
}

/// A random password with the chosen options and how long a brute-force
/// attack would take.
pub(crate) fn coldpass_generate_password(payload: GeneratePasswordPayload) -> Result<GeneratedPasswordDto, BackendError> {
    let random = SystemRandom::new();
    let mut failed = false;
    // Rejection sampling keeps every character equally likely.
    let mut index = |size: usize| -> usize {
        let limit = u32::MAX - u32::MAX % size as u32;
        loop {
            let mut bytes = [0u8; 4];
            if random.fill(&mut bytes).is_err() {
                failed = true;
                return 0;
            }
            let value = u32::from_le_bytes(bytes);
            if value < limit {
                return (value % size as u32) as usize;
            }
        }
    };
    let password = crate::backend::coldpass::generate_password(&payload.options, &mut index);
    if failed {
        return Err(BackendError::new(BackendErrorCode::Internal, "No se pudo generar la password.", true));
    }
    Ok(GeneratedPasswordDto {
        password,
        brute_force_seconds: crate::backend::coldpass::brute_force_seconds(&payload.options),
    })
}

/// Opens (or creates, on first use) the vault of the library.
pub(crate) async fn coldpass_unlock(
    app: AppHandle,
    payload: ColdPassPayload,
) -> Result<ColdPassEntriesDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let passkey = payload
            .passkey
            .filter(|passkey| !passkey.is_empty() && passkey.chars().count() <= MAX_PASSKEY_CHARS)
            .ok_or_else(|| BackendError::invalid_input("La passkey no es válida."))?;
        let registry = app.state::<LibraryBindingRegistry>();
        let picker = app.state::<AndroidDirectoryPickerState>();
        let adapter = TauriFilesystemDocumentAdapter::for_library(
            registry.inner(),
            &payload.library_id,
            picker.inner(),
        )?;
        let locator = vault_locator(&payload.library_id)?;
        let entries = if adapter.exists_locator(&locator)? {
            let markdown = decrypt_vault(&adapter.read_locator(&locator)?, &passkey)?;
            parse_coldpass_markdown(&markdown, &mut new_id)
        } else {
            adapter.upsert_text_locator(&locator, &encrypt_vault(&empty_coldpass_markdown(), &passkey)?)?;
            Vec::new()
        };
        app.state::<ColdPassState>()
            .vaults
            .lock()
            .map_err(|_| locked())?
            .insert(
                payload.library_id.clone(),
                UnlockedVault { passkey, entries: entries.clone(), pending_import: None },
            );
        Ok(ColdPassEntriesDto { entries })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo abrir ColdPass.", true))?
}

pub(crate) fn coldpass_lock(payload: ColdPassPayload, state: State<'_, ColdPassState>) -> Result<(), BackendError> {
    state.lock_library(&payload.library_id);
    Ok(())
}

/// Adds a credential or edits the one with `entryId`.
pub(crate) async fn coldpass_save_entry(
    app: AppHandle,
    payload: ColdPassPayload,
) -> Result<ColdPassEntriesDto, BackendError> {
    // Key derivation and the vault write run off the main thread.
    crate::host::async_runtime::spawn_blocking(move || {
        let entry = payload.entry.ok_or_else(|| BackendError::invalid_input("Falta la credencial."))?;
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            let mut entries = vault.entries.clone();
            upsert_coldpass_entry(&mut entries, entry, payload.entry_id.as_deref(), &mut new_id)?;
            persist(&app, &payload.library_id, &vault.passkey, &entries)?;
            vault.entries = entries.clone();
            Ok(ColdPassEntriesDto { entries })
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true))?
}

/// Deletes a credential after the passkey is confirmed again.
pub(crate) async fn coldpass_delete_entry(
    app: AppHandle,
    payload: ColdPassPayload,
) -> Result<ColdPassEntriesDto, BackendError> {
    // Key derivation and the vault write run off the main thread.
    crate::host::async_runtime::spawn_blocking(move || {
        let entry_id = payload.entry_id.ok_or_else(|| BackendError::invalid_input("Falta la credencial."))?;
        let passkey = payload.passkey.unwrap_or_default();
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            if !same_passkey(&vault.passkey, &passkey) {
                return Err(BackendError::new(BackendErrorCode::Forbidden, "La passkey no coincide.", true));
            }
            let entries = vault
                .entries
                .iter()
                .filter(|entry| entry.id != entry_id)
                .cloned()
                .collect::<Vec<_>>();
            persist(&app, &payload.library_id, &vault.passkey, &entries)?;
            vault.entries = entries.clone();
            Ok(ColdPassEntriesDto { entries })
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassImportPreview {
    source_file_name: String,
    imported_count: usize,
    skipped_row_count: usize,
}

fn read_picked_csv(app: &AppHandle, file: crate::host::dialog::FilePath) -> Result<(String, String), BackendError> {
    let unreadable = || BackendError::new(BackendErrorCode::Storage, "No se pudo leer el CSV seleccionado.", true);
    match file {
        crate::host::dialog::FilePath::Path(path) => {
            let name = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "vault.csv".to_string());
            let metadata = std::fs::metadata(&path).map_err(|_| unreadable())?;
            if metadata.len() as usize > MAX_CSV_BYTES {
                return Err(BackendError::invalid_input("El CSV supera el tamaño permitido."));
            }
            let _ = app;
            Ok((name, std::fs::read_to_string(&path).map_err(|_| unreadable())?))
        }
        crate::host::dialog::FilePath::Url(url) => {
            #[cfg(target_os = "android")]
            {
                let picker = app.state::<AndroidDirectoryPickerState>();
                let content = crate::mobile_directory_picker::read_android_content_text(picker.inner(), url.as_str())
                    .map_err(|_| unreadable())?;
                if content.len() > MAX_CSV_BYTES {
                    return Err(BackendError::invalid_input("El CSV supera el tamaño permitido."));
                }
                Ok(("vault.csv".to_string(), content))
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, url);
                Err(unreadable())
            }
        }
    }
}

/// Opens the native picker, parses the chosen CSV and keeps the result in
/// the unlocked session until the import is confirmed with the passkey. The
/// WebView never sends a file path.
pub(crate) async fn coldpass_pick_csv_import(
    app: AppHandle,
    payload: ColdPassPayload,
) -> Result<Option<ColdPassImportPreview>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        use crate::host::dialog::DialogExt;
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |_| Ok(()))?;
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Importar vault CSV")
            .add_filter("CSV", &["csv"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let (source_file_name, content) = read_picked_csv(&app, file)?;
        let import = parse_coldpass_csv(&content, &mut new_id)?;
        let preview = ColdPassImportPreview {
            source_file_name,
            imported_count: import.entries.len(),
            skipped_row_count: import.skipped_row_count,
        };
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            vault.pending_import = Some(import.entries);
            Ok(())
        })?;
        Ok(Some(preview))
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo importar el CSV.", true))?
}

/// Appends the pending CSV import after the passkey is confirmed again.
pub(crate) async fn coldpass_confirm_import(
    app: AppHandle,
    payload: ColdPassPayload,
) -> Result<ColdPassEntriesDto, BackendError> {
    // Key derivation and the vault write run off the main thread.
    crate::host::async_runtime::spawn_blocking(move || {
        let passkey = payload.passkey.unwrap_or_default();
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            if !same_passkey(&vault.passkey, &passkey) {
                return Err(BackendError::new(BackendErrorCode::Forbidden, "La passkey no coincide.", true));
            }
            let pending = vault
                .pending_import
                .take()
                .ok_or_else(|| BackendError::invalid_input("No hay una importación pendiente."))?;
            let mut entries = vault.entries.clone();
            if entries.len() + pending.len() > crate::backend::coldpass::MAX_COLDPASS_ENTRIES {
                return Err(BackendError::invalid_input("El vault superaría el máximo de credenciales."));
            }
            entries.extend(pending);
            persist(&app, &payload.library_id, &vault.passkey, &entries)?;
            vault.entries = entries.clone();
            Ok(ColdPassEntriesDto { entries })
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_encryption_round_trips_and_rejects_a_wrong_passkey() {
        let encrypted = encrypt_vault("| name |", "clave").expect("encrypt");
        assert!(encrypted.starts_with(ENCRYPTED_HEADER));
        assert_eq!(decrypt_vault(&encrypted, "clave").expect("decrypt"), "| name |");
        assert!(decrypt_vault(&encrypted, "otra").is_err());
        assert!(!same_passkey("clave", "clavx"));
        assert!(same_passkey("clave", "clave"));
    }
}
