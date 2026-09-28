//! ColdPass vault adapter: encryption, the unlocked session and its
//! commands. The vault key comes from the Owner's password: HKDF-SHA256
//! derives it from the data key of the library's configuration, which the
//! Owner's password opens (`app_auth::owner_data_key`). A password change
//! only seals that data key again, so the vault never needs re-encrypting.
//! Vaults from before used their own passkey (PBKDF2, 250 000 rounds); the
//! first unlock asks for it once and re-encrypts the vault with the Owner's
//! key. Keys stay in the backend; the WebView receives only the entries it
//! renders.

use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::Mutex;

use base64::Engine as _;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use crate::host::{AppHandle, Manager, State};

use crate::backend::coldpass::{
    coldpass_entry_views, empty_coldpass_markdown, parse_coldpass_csv, parse_coldpass_markdown,
    stringify_coldpass_markdown, upsert_coldpass_entry, ColdPassEntryDto, ColdPassEntryView,
};
use crate::backend::{BackendError, BackendErrorCode, DocumentLocatorDto};
use crate::config_crypto::DataKey;
use crate::filesystem::adapter::TauriFilesystemDocumentAdapter;
use crate::library_registry::LibraryBindingRegistry;
use crate::mobile_directory_picker::AndroidDirectoryPickerState;

const VAULT_HEADER: &str = "<!-- NOTIA_COLDPASS_OWNER_V1 -->";
const LEGACY_HEADER: &str = "<!-- NOTIA_COLDPASS_AES256_PBKDF2_V1 -->";
/// Associated data of the sealed vault.
const VAULT_AAD: &[u8] = b"notia-coldpass-v1";
/// HKDF inputs that separate the vault key from the configuration key.
const KEY_SALT: &[u8] = b"notia-coldpass";
const KEY_INFO: &[u8] = b"notia-coldpass-vault-key-v1";
const KEY_BYTES: usize = 32;
const NONCE_BYTES: usize = 12;
const LEGACY_PBKDF2_ITERATIONS: u32 = 250_000;
const LEGACY_IV_BYTES: usize = 12;
const VAULT_LOGICAL_PATH: &str = "ColdPass/ColdPass.md";
const MAX_CSV_BYTES: usize = 5 * 1024 * 1024;
const MAX_SECRET_CHARS: usize = 1_024;

/// The key that seals one library's vault. Its bytes are wiped when it is
/// dropped and compared in constant time.
struct VaultKey([u8; KEY_BYTES]);

impl VaultKey {
    fn from_data_key(data_key: &DataKey) -> Result<Self, BackendError> {
        let prk = ring::hkdf::Salt::new(ring::hkdf::HKDF_SHA256, KEY_SALT).extract(data_key.bytes());
        let okm = prk.expand(&[KEY_INFO], ring::hkdf::HKDF_SHA256).map_err(|_| crypto_error())?;
        let mut key = [0u8; KEY_BYTES];
        okm.fill(&mut key).map_err(|_| crypto_error())?;
        Ok(Self(key))
    }

    fn aead(&self) -> Result<LessSafeKey, BackendError> {
        Ok(LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &self.0).map_err(|_| crypto_error())?))
    }

    fn matches(&self, other: &VaultKey) -> bool {
        self.0.iter().zip(other.0.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
    }
}

impl Drop for VaultKey {
    fn drop(&mut self) {
        self.0.iter_mut().for_each(|byte| *byte = 0);
    }
}

struct UnlockedVault {
    key: VaultKey,
    entries: Vec<ColdPassEntryDto>,
    pending_import: Option<Vec<ColdPassEntryDto>>,
}

/// Unlocked vaults by library. Locking the view, signing the Owner out or
/// revoking a library drops them.
#[derive(Default)]
pub(crate) struct ColdPassState {
    vaults: Mutex<HashMap<String, UnlockedVault>>,
}

impl ColdPassState {
    /// Drops the unlocked vault of a library (lock, sign-out, revocation).
    pub(crate) fn lock_library(&self, library_id: &str) {
        if let Ok(mut vaults) = self.vaults.lock() {
            vaults.remove(library_id);
        }
    }
}

fn crypto_error() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "No se pudo cifrar el vault.", false)
}

fn damaged_vault() -> BackendError {
    BackendError::new(BackendErrorCode::Storage, "El vault de ColdPass está dañado o no es de esta biblioteca.", false)
}

fn wrong_legacy_passkey() -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, "La passkey anterior no es válida o el vault está dañado.", true)
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn decode(value: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::STANDARD.decode(value.trim()).ok()
}

/// The `name: value` line of a vault file body.
fn field<'a>(body: &'a str, name: &str) -> Option<&'a str> {
    body.lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(key, _)| key.trim() == name)
        .map(|(_, value)| value.trim())
}

/// Which key a stored vault needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VaultFormat {
    Owner,
    Legacy,
}

fn vault_format(content: &str) -> Result<VaultFormat, BackendError> {
    let content = content.trim_start();
    if content.starts_with(VAULT_HEADER) {
        Ok(VaultFormat::Owner)
    } else if content.starts_with(LEGACY_HEADER) {
        Ok(VaultFormat::Legacy)
    } else {
        Err(BackendError::invalid_input("El archivo de ColdPass no tiene el formato esperado."))
    }
}

fn encrypt_vault(plaintext: &str, key: &VaultKey) -> Result<String, BackendError> {
    let mut nonce = [0u8; NONCE_BYTES];
    SystemRandom::new().fill(&mut nonce).map_err(|_| crypto_error())?;
    let mut data = plaintext.as_bytes().to_vec();
    key.aead()?
        .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(VAULT_AAD), &mut data)
        .map_err(|_| crypto_error())?;
    Ok(format!("{VAULT_HEADER}\nnonce: {}\nciphertext: {}", encode(&nonce), encode(&data)))
}

fn decrypt_vault(content: &str, key: &VaultKey) -> Result<String, BackendError> {
    let body = content.trim().strip_prefix(VAULT_HEADER).ok_or_else(damaged_vault)?;
    let nonce: [u8; NONCE_BYTES] = field(body, "nonce")
        .and_then(decode)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(damaged_vault)?;
    let mut data = field(body, "ciphertext").and_then(decode).ok_or_else(damaged_vault)?;
    let plaintext = key
        .aead()?
        .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(VAULT_AAD), &mut data)
        .map_err(|_| damaged_vault())?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| damaged_vault())
}

fn legacy_key(passkey: &str, salt: &[u8]) -> Result<LessSafeKey, BackendError> {
    let mut key = [0u8; KEY_BYTES];
    ring::pbkdf2::derive(
        ring::pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(LEGACY_PBKDF2_ITERATIONS).expect("non-zero iterations"),
        salt,
        passkey.as_bytes(),
        &mut key,
    );
    let aead = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &key).map_err(|_| crypto_error())?);
    key.iter_mut().for_each(|byte| *byte = 0);
    Ok(aead)
}

/// Opens a vault sealed with its own passkey, as before the Owner's key.
fn decrypt_legacy_vault(content: &str, passkey: &str) -> Result<String, BackendError> {
    let body = content.trim().strip_prefix(LEGACY_HEADER).ok_or_else(wrong_legacy_passkey)?;
    let salt = field(body, "salt").and_then(decode).ok_or_else(wrong_legacy_passkey)?;
    let iv: [u8; LEGACY_IV_BYTES] = field(body, "iv")
        .and_then(decode)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(wrong_legacy_passkey)?;
    let mut data = field(body, "ciphertext").and_then(decode).ok_or_else(wrong_legacy_passkey)?;
    let plaintext = legacy_key(passkey, &salt)?
        .open_in_place(Nonce::assume_unique_for_key(iv), Aad::empty(), &mut data)
        .map_err(|_| wrong_legacy_passkey())?;
    String::from_utf8(plaintext.to_vec()).map_err(|_| wrong_legacy_passkey())
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn vault_locator(library_id: &str) -> Result<DocumentLocatorDto, BackendError> {
    DocumentLocatorDto::new(library_id, VAULT_LOGICAL_PATH, None, None)
}

/// Runs `operation` with the filesystem adapter of the library.
fn with_adapter<R>(
    app: &AppHandle,
    library_id: &str,
    operation: impl FnOnce(&TauriFilesystemDocumentAdapter<'_>) -> Result<R, BackendError>,
) -> Result<R, BackendError> {
    let registry = app.state::<LibraryBindingRegistry>();
    let picker = app.state::<AndroidDirectoryPickerState>();
    operation(&TauriFilesystemDocumentAdapter::for_library(registry.inner(), library_id, picker.inner())?)
}

fn persist(app: &AppHandle, library_id: &str, key: &VaultKey, entries: &[ColdPassEntryDto]) -> Result<(), BackendError> {
    let encrypted = encrypt_vault(&stringify_coldpass_markdown(entries)?, key)?;
    with_adapter(app, library_id, |adapter| adapter.upsert_text_locator(&vault_locator(library_id)?, &encrypted))
}

fn locked() -> BackendError {
    BackendError::new(BackendErrorCode::Forbidden, "ColdPass está bloqueado.", true)
}

fn secret(value: Option<String>, missing: &str) -> Result<String, BackendError> {
    value
        .filter(|value| !value.is_empty() && value.chars().count() <= MAX_SECRET_CHARS)
        .ok_or_else(|| BackendError::invalid_input(missing))
}

/// The vault key opened with the Owner's password.
fn owner_vault_key(app: &AppHandle, library_id: &str, password: Option<String>) -> Result<VaultKey, BackendError> {
    let password = secret(password, "Ingresá la contraseña del Owner.")?;
    VaultKey::from_data_key(&crate::app_auth::owner_data_key(app, library_id, &password)?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassPayload {
    library_id: String,
    /// The Owner's password: unlocks the vault and confirms deletions and
    /// imports.
    #[serde(default)]
    password: Option<String>,
    /// The passkey of a vault from before, asked once to migrate it.
    #[serde(default)]
    legacy_passkey: Option<String>,
    #[serde(default)]
    entry: Option<ColdPassEntryDto>,
    #[serde(default)]
    entry_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassEntriesDto {
    entries: Vec<ColdPassEntryView>,
}

impl ColdPassEntriesDto {
    fn of(entries: &[ColdPassEntryDto]) -> Self {
        Self { entries: coldpass_entry_views(entries, now_ms()) }
    }
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

/// A deletion or an import asks for the Owner's password again: it must
/// open the key of the unlocked vault. The key is derived before taking the
/// session lock, because PBKDF2 takes a moment.
fn ensure_same_key(vault: &UnlockedVault, confirmed: &VaultKey) -> Result<(), BackendError> {
    if vault.key.matches(confirmed) {
        Ok(())
    } else {
        Err(BackendError::new(BackendErrorCode::Forbidden, "La contraseña del Owner no coincide con la del vault.", true))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColdPassStatusDto {
    /// The library already has a vault; a first unlock creates it.
    exists: bool,
    /// The vault still uses its own passkey: the first unlock asks for it
    /// once to move it to the Owner's key.
    needs_legacy_passkey: bool,
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

/// Whether the library has a vault and which key it needs.
pub(crate) async fn coldpass_status(app: AppHandle, payload: ColdPassPayload) -> Result<ColdPassStatusDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let locator = vault_locator(&payload.library_id)?;
        with_adapter(&app, &payload.library_id, |adapter| {
            if !adapter.exists_locator(&locator)? {
                return Ok(ColdPassStatusDto { exists: false, needs_legacy_passkey: false });
            }
            let format = vault_format(&adapter.read_locator(&locator)?)?;
            Ok(ColdPassStatusDto { exists: true, needs_legacy_passkey: format == VaultFormat::Legacy })
        })
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

/// Opens the vault of the library with the Owner's password, creating it on
/// first use. A vault from before is opened with `legacyPasskey` and saved
/// again with the Owner's key.
pub(crate) async fn coldpass_unlock(app: AppHandle, payload: ColdPassPayload) -> Result<ColdPassEntriesDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let key = owner_vault_key(&app, &payload.library_id, payload.password)?;
        let locator = vault_locator(&payload.library_id)?;
        let markdown = with_adapter(&app, &payload.library_id, |adapter| {
            if !adapter.exists_locator(&locator)? {
                let markdown = empty_coldpass_markdown();
                adapter.upsert_text_locator(&locator, &encrypt_vault(&markdown, &key)?)?;
                return Ok(markdown);
            }
            let content = adapter.read_locator(&locator)?;
            match vault_format(&content)? {
                VaultFormat::Owner => decrypt_vault(&content, &key),
                VaultFormat::Legacy => {
                    let passkey = secret(
                        payload.legacy_passkey,
                        "Este vault todavía usa su passkey anterior: ingresala una vez para pasarlo a la contraseña del Owner.",
                    )?;
                    let markdown = decrypt_legacy_vault(&content, &passkey)?;
                    // The same text, sealed with the Owner's key: the old
                    // passkey is not needed any more.
                    adapter.upsert_text_locator(&locator, &encrypt_vault(&markdown, &key)?)?;
                    Ok(markdown)
                }
            }
        })?;
        let entries = parse_coldpass_markdown(&markdown, &mut new_id);
        let response = ColdPassEntriesDto::of(&entries);
        app.state::<ColdPassState>()
            .vaults
            .lock()
            .map_err(|_| locked())?
            .insert(payload.library_id.clone(), UnlockedVault { key, entries, pending_import: None });
        Ok(response)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo abrir ColdPass.", true))?
}

pub(crate) fn coldpass_lock(payload: ColdPassPayload, state: State<'_, ColdPassState>) -> Result<(), BackendError> {
    state.lock_library(&payload.library_id);
    Ok(())
}

/// Adds a credential or edits the one with `entryId`.
pub(crate) async fn coldpass_save_entry(app: AppHandle, payload: ColdPassPayload) -> Result<ColdPassEntriesDto, BackendError> {
    // The vault write runs off the main thread.
    crate::host::async_runtime::spawn_blocking(move || {
        let entry = payload.entry.ok_or_else(|| BackendError::invalid_input("Falta la credencial."))?;
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            let mut entries = vault.entries.clone();
            upsert_coldpass_entry(&mut entries, entry, payload.entry_id.as_deref(), &mut new_id, now_ms())?;
            persist(&app, &payload.library_id, &vault.key, &entries)?;
            vault.entries = entries;
            Ok(ColdPassEntriesDto::of(&vault.entries))
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true))?
}

/// Deletes a credential after the Owner's password is confirmed again.
pub(crate) async fn coldpass_delete_entry(app: AppHandle, payload: ColdPassPayload) -> Result<ColdPassEntriesDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let entry_id = payload.entry_id.ok_or_else(|| BackendError::invalid_input("Falta la credencial."))?;
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |_| Ok(()))?;
        let confirmed = owner_vault_key(&app, &payload.library_id, payload.password)?;
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            ensure_same_key(vault, &confirmed)?;
            let entries = vault
                .entries
                .iter()
                .filter(|entry| entry.id != entry_id)
                .cloned()
                .collect::<Vec<_>>();
            persist(&app, &payload.library_id, &vault.key, &entries)?;
            vault.entries = entries;
            Ok(ColdPassEntriesDto::of(&vault.entries))
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
/// the unlocked session until the import is confirmed with the Owner's
/// password. The WebView never sends a file path.
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

/// Appends the pending CSV import after the Owner's password is confirmed
/// again.
pub(crate) async fn coldpass_confirm_import(app: AppHandle, payload: ColdPassPayload) -> Result<ColdPassEntriesDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |_| Ok(()))?;
        let confirmed = owner_vault_key(&app, &payload.library_id, payload.password)?;
        with_vault(&app.state::<ColdPassState>(), &payload.library_id, |vault| {
            ensure_same_key(vault, &confirmed)?;
            let pending = vault
                .pending_import
                .take()
                .ok_or_else(|| BackendError::invalid_input("No hay una importación pendiente."))?;
            let mut entries = vault.entries.clone();
            if entries.len() + pending.len() > crate::backend::coldpass::MAX_COLDPASS_ENTRIES {
                return Err(BackendError::invalid_input("El vault superaría el máximo de credenciales."));
            }
            entries.extend(pending);
            persist(&app, &payload.library_id, &vault.key, &entries)?;
            vault.entries = entries;
            Ok(ColdPassEntriesDto::of(&vault.entries))
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopySecretPayload {
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopySecretDto {
    clears_after_seconds: u64,
}

/// Copies a password or user to this device's clipboard and clears it after
/// 30 s if nothing else was copied meanwhile.
pub(crate) fn coldpass_copy_secret(app: AppHandle, payload: CopySecretPayload) -> Result<CopySecretDto, BackendError> {
    crate::secret_clipboard::copy_secret(&app, &payload.text)?;
    Ok(CopySecretDto { clears_after_seconds: crate::secret_clipboard::CLEAR_AFTER.as_secs() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> VaultKey {
        VaultKey::from_data_key(&DataKey::from_bytes(&[byte; KEY_BYTES]).expect("data key")).expect("vault key")
    }

    /// A vault as the previous versions wrote it.
    fn legacy_vault(plaintext: &str, passkey: &str) -> String {
        let salt = [7u8; 16];
        let iv = [9u8; LEGACY_IV_BYTES];
        let mut data = plaintext.as_bytes().to_vec();
        legacy_key(passkey, &salt)
            .expect("key")
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(iv), Aad::empty(), &mut data)
            .expect("seal");
        format!("{LEGACY_HEADER}\nsalt: {}\niv: {}\nciphertext: {}", encode(&salt), encode(&iv), encode(&data))
    }

    #[test]
    fn the_vault_opens_only_with_the_key_of_its_owner() {
        let encrypted = encrypt_vault("| name |", &key(1)).expect("encrypt");
        assert!(encrypted.starts_with(VAULT_HEADER));
        assert_eq!(vault_format(&encrypted).expect("format"), VaultFormat::Owner);
        assert_eq!(decrypt_vault(&encrypted, &key(1)).expect("decrypt"), "| name |");
        assert!(decrypt_vault(&encrypted, &key(2)).is_err());
        let altered = encrypted.replace("ciphertext: ", "ciphertext: AA");
        assert!(decrypt_vault(&altered, &key(1)).is_err());
    }

    #[test]
    fn the_vault_key_is_derived_from_the_data_key_and_not_equal_to_it() {
        let data_key = DataKey::from_bytes(&[1u8; KEY_BYTES]).expect("data key");
        let derived = VaultKey::from_data_key(&data_key).expect("vault key");
        assert_ne!(&derived.0, data_key.bytes());
        assert!(derived.matches(&key(1)));
        assert!(!derived.matches(&key(2)));
    }

    #[test]
    fn a_vault_from_before_opens_with_its_passkey_and_moves_to_the_owner_key() {
        let legacy = legacy_vault("| name | website |", "clave vieja");
        assert_eq!(vault_format(&legacy).expect("format"), VaultFormat::Legacy);
        assert!(decrypt_legacy_vault(&legacy, "otra").is_err());
        let markdown = decrypt_legacy_vault(&legacy, "clave vieja").expect("legacy");
        let migrated = encrypt_vault(&markdown, &key(3)).expect("migrate");
        assert_eq!(decrypt_vault(&migrated, &key(3)).expect("open"), "| name | website |");
        assert!(vault_format("hola").is_err());
    }
}
