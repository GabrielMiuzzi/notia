//! What Notia's Chrome extensions (`chrome-ext/`) share on the Host mode
//! server: every request of theirs comes from an extension page
//! (`Origin: chrome-extension://…`), which no web page can send, and after
//! the sign-in carries its session's token as `Authorization: Bearer`, never
//! a cookie, because every extension shares the browser's cookies but not
//! each other's storage.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::RngCore;

/// A session not used for this long ends; the extensions renew theirs while
/// Chrome is open.
const IDLE_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_SESSIONS: usize = 16;

pub(super) fn origin_is_extension(request: &[u8]) -> bool {
    super::super::http::request_header_value(request, "origin").is_some_and(|origin| {
        origin
            .strip_prefix("chrome-extension://")
            .is_some_and(|id| !id.is_empty() && id.chars().all(|character| character.is_ascii_lowercase()))
    })
}

pub(super) fn bearer(request: &[u8]) -> Option<String> {
    let value = super::super::http::request_header_value(request, "authorization")?;
    let token = value.strip_prefix("Bearer ")?.trim();
    (!token.is_empty()).then(|| token.to_string())
}

pub(super) fn new_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Sessions of an extension whose Owner signed in, by token.
#[derive(Default)]
pub(crate) struct ExtensionSessions {
    tokens: Mutex<HashMap<String, Instant>>,
}

impl ExtensionSessions {
    pub(super) fn open(&self) -> Option<String> {
        let token = new_token();
        let mut tokens = self.tokens.lock().ok()?;
        let now = Instant::now();
        tokens.retain(|_, expires| *expires > now);
        if tokens.len() >= MAX_SESSIONS {
            let oldest = tokens.iter().min_by_key(|(_, expires)| **expires).map(|(token, _)| token.clone())?;
            tokens.remove(&oldest);
        }
        tokens.insert(token.clone(), now + IDLE_TTL);
        Some(token)
    }

    /// Whether `token` is a live session, renewing it.
    pub(super) fn touch(&self, token: &str) -> bool {
        let Ok(mut tokens) = self.tokens.lock() else {
            return false;
        };
        let now = Instant::now();
        match tokens.get_mut(token) {
            Some(expires) if *expires > now => {
                *expires = now + IDLE_TTL;
                true
            }
            Some(_) => {
                tokens.remove(token);
                false
            }
            None => false,
        }
    }

    pub(super) fn close(&self, token: &str) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.remove(token);
        }
    }

    /// Ends every session (the Owner's password changed).
    pub(super) fn close_all(&self) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.clear();
        }
    }
}
