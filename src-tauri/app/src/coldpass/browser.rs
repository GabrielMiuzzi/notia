//! The vault the Chrome extension opens through the Host mode server
//! (`server::browser`). The Owner types the password once in the extension:
//! it opens a session with its own copy of the vault key, apart from the
//! window's unlock, so locking ColdPass in Notia does not lock the browser.
//! A session ends when the extension signs out, after `IDLE_TTL` without
//! use (the extension renews it while Chrome is open), when the Owner's
//! password changes or when Notia closes. The extension only ever receives
//! the credentials of the page it is on.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;

use super::{
    decrypt_vault, new_id, now_ms, owner_vault_key, persist, random_password, vault_body, vault_format,
    vault_locator, with_adapter, ColdPassState, VaultFormat, VaultKey,
};
use crate::backend::coldpass::{
    browser_credential, credentials_for_page, parse_coldpass_markdown, should_offer_saving, upsert_coldpass_entry,
    ColdPassEntryDto, PasswordOptions,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Manager};

/// A session not used for this long ends.
const IDLE_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_SESSIONS: usize = 16;

/// What the extension's «Generar contraseña» draws.
const GENERATED_PASSWORD: PasswordOptions = PasswordOptions {
    length: 20,
    include_uppercase: true,
    include_numbers: true,
    include_special_characters: true,
    avoid_ambiguous: true,
};

struct BrowserSession {
    library_id: String,
    key: VaultKey,
    expires: Instant,
}

/// The extension's open sessions, by token.
#[derive(Default)]
pub(crate) struct BrowserVaults {
    sessions: Mutex<HashMap<String, BrowserSession>>,
}

/// A credential of the page, as the extension fills it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserCredentialDto {
    id: String,
    name: String,
    username: String,
    password: String,
}

fn unavailable() -> BackendError {
    BackendError::new(BackendErrorCode::Internal, "ColdPass no está disponible.", true)
}

fn legacy_vault() -> BackendError {
    BackendError::new(
        BackendErrorCode::Forbidden,
        "Abrí ColdPass una vez en Notia para pasar el vault a la contraseña del Owner.",
        true,
    )
}

fn new_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The credentials stored in the library's vault; none while it has no vault.
fn read_entries(app: &AppHandle, library_id: &str, key: &VaultKey) -> Result<Vec<ColdPassEntryDto>, BackendError> {
    let locator = vault_locator(library_id)?;
    with_adapter(app, library_id, |adapter| {
        if !adapter.exists_locator(&locator)? {
            return Ok(Vec::new());
        }
        let stored = adapter.read_locator(&locator)?;
        let content = vault_body(&stored);
        match vault_format(content)? {
            VaultFormat::Owner => Ok(parse_coldpass_markdown(&decrypt_vault(content, key)?, &mut new_id)),
            VaultFormat::Legacy => Err(legacy_vault()),
        }
    })
}

/// Runs `operation` on the vault's credentials. While Notia has the vault
/// unlocked its copy is the current one (every write goes through it); the
/// window's lock is held throughout, so a write here and one there never
/// overwrite each other. Returns the credentials to keep when they change.
fn with_entries<R>(
    app: &AppHandle,
    library_id: &str,
    key: &VaultKey,
    operation: impl FnOnce(&[ColdPassEntryDto]) -> Result<(R, Option<Vec<ColdPassEntryDto>>), BackendError>,
) -> Result<R, BackendError> {
    let state = app.state::<ColdPassState>();
    let mut vaults = state.vaults.lock().map_err(|_| unavailable())?;
    let window = vaults.get_mut(library_id).filter(|vault| vault.key.matches(key));
    let stored;
    let entries = match &window {
        Some(vault) => vault.entries.as_slice(),
        None => {
            stored = read_entries(app, library_id, key)?;
            stored.as_slice()
        }
    };
    let (result, changed) = operation(entries)?;
    if let Some(changed) = changed {
        persist(app, library_id, key, &changed)?;
        if let Some(vault) = window {
            vault.entries = changed;
        }
    }
    Ok(result)
}

impl BrowserVaults {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, BrowserSession>>, BackendError> {
        self.sessions.lock().map_err(|_| unavailable())
    }

    /// Checks the Owner's password against the library's vault and opens a
    /// session; returns its token.
    pub(crate) fn open(&self, app: &AppHandle, library_id: &str, password: &str) -> Result<String, BackendError> {
        let key = owner_vault_key(app, library_id, Some(password.to_string()))?;
        read_entries(app, library_id, &key)?;
        let token = new_token();
        let mut sessions = self.lock()?;
        let now = Instant::now();
        sessions.retain(|_, session| session.expires > now);
        if sessions.len() >= MAX_SESSIONS {
            if let Some(oldest) = sessions.iter().min_by_key(|(_, session)| session.expires).map(|(token, _)| token.clone()) {
                sessions.remove(&oldest);
            }
        }
        sessions.insert(token.clone(), BrowserSession { library_id: library_id.to_string(), key, expires: now + IDLE_TTL });
        Ok(token)
    }

    pub(crate) fn close(&self, token: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(token);
        }
    }

    /// Ends every session (the Owner's password changed).
    pub(crate) fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }

    /// The library of a live session, renewing it; `None` once it ended.
    pub(crate) fn library_of(&self, token: &str) -> Option<String> {
        self.with_session(token, |library_id, _| Ok(library_id.to_string())).ok().flatten()
    }

    /// Runs `operation` with the session's library and key and renews the
    /// session; `Ok(None)` when there is no such session.
    fn with_session<R>(
        &self,
        token: &str,
        operation: impl FnOnce(&str, &VaultKey) -> Result<R, BackendError>,
    ) -> Result<Option<R>, BackendError> {
        let mut sessions = self.lock()?;
        let now = Instant::now();
        let Some(session) = sessions.get_mut(token) else {
            return Ok(None);
        };
        if session.expires <= now {
            sessions.remove(token);
            return Ok(None);
        }
        session.expires = now + IDLE_TTL;
        operation(&session.library_id, &session.key).map(Some)
    }

    /// The credentials that belong on `page_url`.
    pub(crate) fn credentials(&self, app: &AppHandle, token: &str, page_url: &str) -> Result<Option<Vec<BrowserCredentialDto>>, BackendError> {
        self.with_session(token, |library_id, key| {
            with_entries(app, library_id, key, |entries| {
                let found = credentials_for_page(entries, page_url)
                    .into_iter()
                    .map(|entry| BrowserCredentialDto {
                        id: entry.id.clone(),
                        name: entry.name.clone(),
                        username: entry.username.clone(),
                        password: entry.password.clone(),
                    })
                    .collect();
                Ok((found, None))
            })
        })
    }

    /// Whether to offer saving the sign-in just used on `page_url`.
    pub(crate) fn offers_saving(
        &self,
        app: &AppHandle,
        token: &str,
        page_url: &str,
        username: &str,
        password: &str,
    ) -> Result<Option<bool>, BackendError> {
        self.with_session(token, |library_id, key| {
            with_entries(app, library_id, key, |entries| Ok((should_offer_saving(entries, page_url, username, password), None)))
        })
    }

    /// Saves the sign-in used on `page_url` as a new credential.
    pub(crate) fn save(&self, app: &AppHandle, token: &str, page_url: &str, username: &str, password: &str) -> Result<Option<()>, BackendError> {
        let credential = browser_credential(page_url, username, password)?;
        self.with_session(token, |library_id, key| {
            with_entries(app, library_id, key, |entries| {
                let mut changed = entries.to_vec();
                upsert_coldpass_entry(&mut changed, credential, None, &mut new_id, now_ms())?;
                Ok(((), Some(changed)))
            })
        })
    }

    /// A new password from ColdPass's generator.
    pub(crate) fn generate(&self, token: &str) -> Result<Option<String>, BackendError> {
        self.with_session(token, |_, _| random_password(&GENERATED_PASSWORD))
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::PathBuf;

    use crate::host::{AppHandle, AppPaths, HostPorts, Manager};

    /// An app with one library, selected, whose Owner is «owner» with
    /// `password`. Returns the temporary folder to remove afterwards.
    pub(crate) fn app_with_owner(password: &str) -> (AppHandle, String, PathBuf) {
        let root = std::env::temp_dir().join(format!("notia-browser-vault-{}", uuid::Uuid::new_v4()));
        let folder = root.join("Biblioteca");
        std::fs::create_dir_all(folder.join("ColdPass")).expect("library folder");
        let app = crate::create_app(AppPaths::new(Some(root.join("data")), None), HostPorts::default());
        app.manage(crate::mobile_directory_picker::AndroidDirectoryPickerState::empty());
        let library_id = crate::library_catalog::add_desktop_library(&app, &folder).expect("library").id;
        let ensure = serde_json::from_value(serde_json::json!({ "libraryId": library_id })).expect("payload");
        crate::library_config::backend_ensure_library_config(ensure, &app);
        let payload = serde_json::from_value(serde_json::json!({ "libraryId": library_id, "username": "owner", "password": password }))
            .expect("payload");
        crate::app_auth::app_auth_create_password(&app, payload).expect("owner password");
        (app, library_id, root)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::app_with_owner;
    use super::*;

    #[test]
    fn the_browser_vault_saves_through_the_window_and_outlives_its_lock() {
        let (app, library_id, root) = app_with_owner("contraseña-del-owner");
        let vaults = BrowserVaults::default();
        assert!(vaults.open(&app, &library_id, "otra").is_err());
        let token = vaults.open(&app, &library_id, "contraseña-del-owner").expect("browser session");

        // The window has the vault open: the browser's save reaches its copy.
        let unlock = serde_json::from_value(serde_json::json!({ "libraryId": library_id, "password": "contraseña-del-owner" }))
            .expect("payload");
        super::super::unlock_with_password(&app, unlock).expect("window unlock");
        vaults.save(&app, &token, "https://www.ejemplo.com/ingresar", "ana", "secreta-1").expect("save").expect("session");
        let window_names: Vec<String> = app.state::<ColdPassState>().vaults.lock().expect("vaults")[&library_id]
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        assert_eq!(window_names, ["ejemplo.com"]);

        // Locking ColdPass in Notia leaves the browser's session open.
        app.state::<ColdPassState>().lock_library(&library_id);
        let found = vaults.credentials(&app, &token, "https://login.ejemplo.com/").expect("read").expect("session");
        assert_eq!((found.len(), found[0].username.as_str(), found[0].password.as_str()), (1, "ana", "secreta-1"));
        assert_eq!(vaults.offers_saving(&app, &token, "https://ejemplo.com/", "ana", "x").expect("offer"), Some(false));
        assert_eq!(vaults.offers_saving(&app, &token, "https://ejemplo.com/", "beto", "x").expect("offer"), Some(true));
        assert_eq!(vaults.generate(&token).expect("generate").map(|password| password.chars().count()), Some(20));

        vaults.close(&token);
        assert!(vaults.credentials(&app, &token, "https://ejemplo.com/").expect("read").is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}
