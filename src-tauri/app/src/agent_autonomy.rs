//! The autonomous agent's clock. Every minute, for the selected library,
//! `thoughts.md` is created again when it is missing. When the library's
//! Telegram bot runs on this device with the autonomous agent on, the
//! hourly review is queued when due and, every two minutes, the Gmail
//! accounts are checked for new mail in Recibidos, all of it in one run.
//!
//! The runs go through the Telegram worker (`enqueue_autonomous`), so they
//! only happen where the bot runs and only reach the Owner. The last review
//! and each account's Gmail history cursor are kept per device in
//! `app_data/agent-autonomy/`, so a restart neither repeats a review nor
//! announces old mail. The rules live in `backend_core::agent_autonomy`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::backend::agent_autonomy::{
    hourly_trigger, is_review_due, mail_trigger, new_mail, AutonomousKind, MAIL_POLL_INTERVAL_MS, MAX_TRIGGER_MAILS,
};
use crate::backend::mail_tools::{history_url, message_metadata_url, message_summary, parse_history_page, profile_history_id, profile_url, MailAccountRef};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Manager};
use crate::mail_tools::{gmail_accounts, gmail_session, GmailSession};
use crate::telegram_worker::{enqueue_autonomous, AutonomousEnqueue};

const TICK: Duration = Duration::from_secs(60);
/// The first tick waits for the app to open its library.
const FIRST_TICK_DELAY: Duration = Duration::from_secs(60);
/// History pages read per account and poll; more new mail than that in two
/// minutes is left for the hourly review.
const MAX_HISTORY_PAGES: usize = 5;
const STATE_DIRECTORY: &str = "agent-autonomy";

pub(crate) fn init() -> crate::host::plugin::TauriPlugin<crate::host::Wry> {
    crate::host::plugin::Builder::new("agent-autonomy")
        .setup(|app, _api| {
            let app = app.clone();
            let _ = std::thread::Builder::new().name("notia-agent-autonomy".into()).spawn(move || {
                std::thread::sleep(FIRST_TICK_DELAY);
                let mut clock = Clock::default();
                loop {
                    tick(&app, &mut clock);
                    std::thread::sleep(TICK);
                }
            });
            Ok(())
        })
        .build()
}

/// What the clock remembers between ticks, in memory only.
#[derive(Default)]
struct Clock {
    /// Whether the last check of `thoughts.md` failed, so a lasting failure
    /// is logged once.
    thoughts_failing: bool,
    last_mail_poll: Option<Instant>,
}

/// Per-device state of a library's autonomous agent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutonomyState {
    #[serde(default)]
    last_review_ms: Option<i64>,
    /// Gmail history id reached per account address.
    #[serde(default)]
    gmail: HashMap<String, String>,
}

fn tick(app: &AppHandle, clock: &mut Clock) {
    let Some(library) = crate::library_catalog::selected_library(app) else {
        return;
    };
    if app.state::<crate::library_registry::LibraryBindingRegistry>().lookup(&library.id).is_err() {
        return;
    }
    match crate::agent_workspace::ensure_thoughts_file(app, &library.id) {
        Ok(_) => clock.thoughts_failing = false,
        Err(error) => {
            if !clock.thoughts_failing {
                log::error!("[notia:autonomy] no se pudo recrear thoughts.md: {:?}", error.code);
            }
            clock.thoughts_failing = true;
        }
    }
    let enabled = crate::library_config::read_library_config(app, &library.id)
        .ok()
        .flatten()
        .is_some_and(|config| crate::backend::library_config::autonomous_agent_enabled(&config));
    if !enabled || !crate::telegram_worker::bot_runs_for(app, &library.id) {
        return;
    }
    let before = read_state(app, &library.id);
    let mut state = before.clone();
    review_when_due(app, &library.id, &mut state);
    if clock.last_mail_poll.is_none_or(|last| last.elapsed() >= Duration::from_millis(MAIL_POLL_INTERVAL_MS as u64)) {
        clock.last_mail_poll = Some(Instant::now());
        watch_mail(app, &library.id, &mut state);
    }
    if state != before {
        write_state(app, &library.id, &state);
    }
}

/// Queues the hourly review when an hour passed since the last one. The
/// first time, the review is due an hour later.
fn review_when_due(app: &AppHandle, library_id: &str, state: &mut AutonomyState) {
    let now = now_ms();
    let Some(last) = state.last_review_ms else {
        state.last_review_ms = Some(now);
        return;
    };
    if !is_review_due(last, now) {
        return;
    }
    let trigger = hourly_trigger(&crate::local_time::local_now().1);
    // Busy or unavailable: it is tried again on the next tick.
    if enqueue_autonomous(app, library_id, AutonomousKind::HourlyReview, trigger) == AutonomousEnqueue::Queued {
        state.last_review_ms = Some(now);
    }
}

/// Looks for new mail in every connected account and queues one run for
/// all of it. The cursors move on when the run was queued or nobody can
/// be told (the Owner has not linked Telegram); while another autonomous
/// run is busy they stay, so the next poll includes the same mail.
fn watch_mail(app: &AppHandle, library_id: &str, state: &mut AutonomyState) {
    let accounts = gmail_accounts(app, library_id);
    state.gmail.retain(|email, _| accounts.iter().any(|account| &account.email == email));
    let mut cursors = state.gmail.clone();
    let mut arrived = Vec::<(MailAccountRef, String)>::new();
    for (index, account) in accounts.iter().enumerate() {
        match poll_account(app, library_id, account, state.gmail.get(&account.email).map(String::as_str)) {
            Ok((cursor, added)) => {
                cursors.insert(account.email.clone(), cursor);
                arrived.extend(added.into_iter().map(|id| (account.clone(), id)));
            }
            // Neither the address nor the error body: only which account.
            Err(error) => log::error!(
                "[notia:autonomy] la cuenta {} ({}) no se revisó: {:?}",
                index + 1,
                account.account_type.id(),
                error.code
            ),
        }
    }
    if arrived.is_empty() {
        state.gmail = cursors;
        return;
    }
    let mails = arrived
        .iter()
        .take(MAX_TRIGGER_MAILS)
        .filter_map(|(account, id)| read_mail(app, library_id, account, id))
        .collect::<Vec<_>>();
    let trigger = mail_trigger(&crate::local_time::local_now().1, &mails, arrived.len());
    if enqueue_autonomous(app, library_id, AutonomousKind::NewMail, trigger) != AutonomousEnqueue::Busy {
        state.gmail = cursors;
    }
}

/// The account's new cursor and the messages that arrived since `cursor`.
/// Without a cursor (first look) or with one Gmail no longer knows, it
/// starts from now: mail that already arrived does not count.
fn poll_account(
    app: &AppHandle,
    library_id: &str,
    account: &MailAccountRef,
    cursor: Option<&str>,
) -> Result<(String, Vec<String>), BackendError> {
    // Getting the session may refresh the token, which blocks by itself.
    let session = gmail_session(app, library_id, account)?;
    crate::host::async_runtime::block_on(async {
        let Some(start) = cursor else {
            return Ok((current_cursor(&session).await?, Vec::new()));
        };
        let mut added = Vec::<String>::new();
        let mut latest = start.to_string();
        let mut page_token = None::<String>;
        for _ in 0..MAX_HISTORY_PAGES {
            let answer = match session.get(&history_url(start, page_token.as_deref())).await {
                Ok(answer) => answer,
                Err(error) if error.code == BackendErrorCode::NotFound => return Ok((current_cursor(&session).await?, Vec::new())),
                Err(error) => return Err(error),
            };
            let page = parse_history_page(&answer);
            for id in page.added {
                if !added.contains(&id) {
                    added.push(id);
                }
            }
            if let Some(id) = page.history_id {
                latest = id;
            }
            match page.next_page_token {
                Some(token) => page_token = Some(token),
                None => break,
            }
        }
        Ok((latest, added))
    })
}

async fn current_cursor(session: &GmailSession) -> Result<String, BackendError> {
    profile_history_id(&session.get(&profile_url()).await?)
        .ok_or_else(|| BackendError::new(BackendErrorCode::ProviderUnavailable, "Gmail no devolvió el historial de la cuenta.", true))
}

/// Sender, subject, date and snippet of one new message, or `None` when it
/// cannot be read (for example, it was deleted meanwhile).
fn read_mail(app: &AppHandle, library_id: &str, account: &MailAccountRef, id: &str) -> Option<crate::backend::agent_autonomy::NewMail> {
    let session = gmail_session(app, library_id, account).ok()?;
    let message = crate::host::async_runtime::block_on(session.get(&message_metadata_url(id))).ok()?;
    Some(new_mail(&message_summary(&message, &[]), account))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or_default()
}

fn state_file(app: &AppHandle, library_id: &str) -> Option<PathBuf> {
    let key = library_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
    app.path().app_data_dir().ok().map(|directory| directory.join(STATE_DIRECTORY).join(format!("{key}.json")))
}

fn read_state(app: &AppHandle, library_id: &str) -> AutonomyState {
    state_file(app, library_id)
        .and_then(|file| std::fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_state(app: &AppHandle, library_id: &str, state: &AutonomyState) {
    let Some(file) = state_file(app, library_id) else {
        return;
    };
    let Ok(text) = serde_json::to_string(state) else {
        return;
    };
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let temporary = file.with_extension("json.tmp");
    if std::fs::write(&temporary, text).is_err() || std::fs::rename(&temporary, &file).is_err() {
        log::error!("[notia:autonomy] no se pudo guardar el estado del agente autónomo");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_state_survives_a_round_trip_and_old_files() {
        let mut state = AutonomyState { last_review_ms: Some(42), ..AutonomyState::default() };
        state.gmail.insert("ana@gmail.com".into(), "901".into());
        let text = serde_json::to_string(&state).expect("json");
        assert!(text.contains("\"lastReviewMs\":42"));
        assert_eq!(serde_json::from_str::<AutonomyState>(&text).expect("state"), state);
        assert_eq!(serde_json::from_str::<AutonomyState>("{}").expect("empty"), AutonomyState::default());
    }
}
