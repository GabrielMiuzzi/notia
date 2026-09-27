//! Telegram bot of the selected library, run by the backend so it keeps
//! working while the WebView is hidden, reloaded or closed to the tray.
//!
//! A supervisor starts one worker per (library, bot token) from the library
//! configuration. The worker polls Telegram on one thread and runs queued
//! requests on another through the Rust agent runtime; confirmations,
//! clarifications and plans pause the run and resume it with the user's
//! answer. A message sent while the chat's request runs goes through a short
//! parallel call to the model that decides whether it stops that request or
//! waits in the queue (see `backend_core::turn_interrupts`). Photos, images
//! and PDFs go to the library chat like text: the model decides what kind of
//! request they are (see `backend_core::tool_routing`), and the parts of an
//! album become one request. Offsets,
//! processed updates and the queue survive restarts; the text of queued
//! requests is never stored.
//!
//! The autonomous agent (`agent_autonomy`) also runs here, as requests of
//! the Owner's chat that Notia queues by itself: they only read, show no
//! progress, are never stored, send their answer only when it is not
//! silence, and give way as soon as the Owner writes.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::host::{AppHandle, Emitter, Manager};

use crate::backend::agent_autonomy::{self as autonomy, AutonomousKind};
use crate::backend::telegram_bot as bot;
use crate::backend::{
    AgentRequest, BackendActor, BackendChannel, BackendMessage, BackendRequest, BackendRequestContext,
    BackendRequestEnvelope, BackendResponse, BackendScope, MessageRole, PersistencePolicy,
    ProtocolVersion, ResumeDecision, ResumeRequest,
};
use crate::backend::chat_attachments::MessageAttachment;
use crate::library_catalog::CatalogLibrary;
use crate::library_users::LibraryDatabaseContext;
use crate::services::telegram_service::{self as telegram, IncomingTelegramUpdate, TelegramDocument, TelegramPhoto};

const SUPERVISOR_INTERVAL: Duration = Duration::from_secs(5);
const POLL_RETRY_DELAY: Duration = Duration::from_secs(3);
const CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(120);
const CLARIFICATION_TIMEOUT: Duration = Duration::from_secs(600);
const PROGRESS_INTERVAL: Duration = Duration::from_secs(2);
const LINK_TIMEOUT: Duration = Duration::from_secs(120);
const LINK_MAX_ATTEMPTS: u32 = 5;
const LINK_COOLDOWN: Duration = Duration::from_secs(30);
const MAX_PROCESSED_UPDATES: usize = 200;
/// A cancel sent before the run registered its control is tried again.
const CANCEL_RETRY_DELAY: Duration = Duration::from_millis(500);
const CANCEL_ATTEMPTS: u32 = 120;
/// The parts of an album arrive as separate updates, usually within a
/// second; the album is sent once no part arrived for this long.
const ALBUM_WINDOW: Duration = Duration::from_millis(1500);
const ALBUM_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Telegram albums hold up to 10 photos or files.
const MAX_ALBUM_PARTS: usize = 10;
const OWNER: &str = "user-owner";
/// Event emitted to the interface after a Telegram request changed data.
pub(crate) const LIBRARY_CHANGED_EVENT: &str = "notia://telegram-library-changed";

#[derive(Default)]
pub(crate) struct TelegramWorkerState {
    running: Mutex<Option<RunningWorker>>,
}

struct RunningWorker {
    key: WorkerKey,
    stop: Arc<AtomicBool>,
    worker: Arc<Worker>,
}

/// What happened to a run the autonomous agent asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutonomousEnqueue {
    Queued,
    /// Another autonomous run is still queued or running.
    Busy,
    /// No bot runs for the library, or its Owner has not linked Telegram.
    Unavailable,
}

fn running_worker(app: &AppHandle, library_id: &str) -> Option<Arc<Worker>> {
    let state = app.state::<TelegramWorkerState>();
    let running = state.running.lock().ok()?;
    running
        .as_ref()
        .filter(|running| running.key.library_id == library_id && !running.worker.stopped())
        .map(|running| Arc::clone(&running.worker))
}

/// Whether the bot of `library_id` runs on this device, the only place its
/// autonomous agent can write from.
pub(crate) fn bot_runs_for(app: &AppHandle, library_id: &str) -> bool {
    running_worker(app, library_id).is_some()
}

/// Queues a run of the autonomous agent in the Owner's Telegram chat of
/// `library_id`, with `trigger` as its request.
pub(crate) fn enqueue_autonomous(app: &AppHandle, library_id: &str, kind: AutonomousKind, trigger: String) -> AutonomousEnqueue {
    match running_worker(app, library_id) {
        Some(worker) => worker.enqueue_autonomous(kind, trigger),
        None => AutonomousEnqueue::Unavailable,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkerKey {
    library_id: String,
    token: String,
}

/// Plugin that starts the supervisor keeping the worker in line with the
/// selected library and its Telegram configuration.
pub(crate) fn init() -> crate::host::plugin::TauriPlugin<crate::host::Wry> {
    crate::host::plugin::Builder::new("telegram-worker")
        .setup(|app, _api| {
            let app = app.clone();
            let _ = std::thread::Builder::new().name("notia-telegram-supervisor".into()).spawn(move || loop {
                std::thread::sleep(SUPERVISOR_INTERVAL);
                reconcile(&app);
            });
            Ok(())
        })
        .build()
}

fn desired_worker(app: &AppHandle) -> Option<(WorkerKey, CatalogLibrary)> {
    let library = crate::library_catalog::selected_library(app)?;
    app.state::<crate::library_registry::LibraryBindingRegistry>().lookup(&library.id).ok()?;
    let config = crate::library_config::read_library_config(app, &library.id).ok()??;
    let section = config.get("telegram")?;
    let token = section.get("botToken").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if section.get("enabled").and_then(Value::as_bool) != Some(true) || token.is_empty() {
        return None;
    }
    Some((WorkerKey { library_id: library.id.clone(), token }, library))
}

fn reconcile(app: &AppHandle) {
    let desired = desired_worker(app);
    let state = app.state::<TelegramWorkerState>();
    let Ok(mut running) = state.running.lock() else {
        return;
    };
    if running.as_ref().map(|running| &running.key) == desired.as_ref().map(|(key, _)| key) {
        return;
    }
    if let Some(previous) = running.take() {
        previous.stop.store(true, Ordering::SeqCst);
    }
    if let Some((key, library)) = desired {
        let stop = Arc::new(AtomicBool::new(false));
        if let Some(worker) = Worker::start(app.clone(), library, key.token.clone(), Arc::clone(&stop)) {
            *running = Some(RunningWorker { key, stop, worker });
        }
    }
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
enum JobAttachment {
    Photo(TelegramPhoto),
    /// A PDF or an image sent as a file (`telegram::document_kind`).
    #[serde(alias = "pdf")]
    Document(TelegramDocument),
}

/// A queued request as stored on disk: without its text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredJob {
    request_id: String,
    chat_id: i64,
    telegram_user_id: i64,
    library_user_id: String,
    /// Files of the request: a photo, a document or the parts of an album.
    #[serde(default)]
    attachments: Vec<JobAttachment>,
    /// The single file older queues stored; read into `attachments`.
    #[serde(default, skip_serializing)]
    attachment: Option<JobAttachment>,
}

impl StoredJob {
    fn adopt_legacy_attachment(&mut self) {
        if let Some(attachment) = self.attachment.take() {
            self.attachments.insert(0, attachment);
        }
    }
}

/// Parts of an album that are still arriving; they become one request.
struct PendingAlbum {
    telegram_user_id: i64,
    library_user_id: String,
    text: String,
    attachments: Vec<JobAttachment>,
    last_part: Instant,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerFile {
    offset: i64,
    #[serde(default)]
    processed: VecDeque<i64>,
    #[serde(default)]
    jobs: Vec<StoredJob>,
}

#[derive(Debug, Clone)]
struct Job {
    stored: StoredJob,
    text: String,
    /// Set when Notia queued the run by itself; such a job is never stored.
    autonomous: Option<AutonomousKind>,
}

/// The request running now, so a message of its chat can stop it. Its text
/// stays in memory only, for the decision about new messages.
struct CurrentRun {
    chat_id: i64,
    text: String,
    context: BackendRequestContext,
    idempotency_key: String,
    cancelled: Arc<AtomicBool>,
    autonomous: bool,
}

/// Identity of a job's run while it goes on.
struct ActiveRun {
    context: BackendRequestContext,
    idempotency_key: String,
    cancelled: Arc<AtomicBool>,
}

enum Reply {
    Decision(bool),
    Text(String, Option<usize>),
}

#[derive(Debug, Clone)]
enum Prompt {
    Confirmation { id: String },
    Clarification { choices: Vec<String> },
}

#[derive(Debug, Clone)]
enum LinkStep {
    Username,
    NewPassword,
    ConfirmPassword(String),
    ExistingPassword,
}

#[derive(Debug, Clone)]
struct LinkFlow {
    step: LinkStep,
    user_id: Option<String>,
    expires_at: Instant,
    attempts: u32,
    blocked_until: Option<Instant>,
}

struct Worker {
    app: AppHandle,
    library: CatalogLibrary,
    token: String,
    stop: Arc<AtomicBool>,
    file: PathBuf,
    persisted: Mutex<WorkerFile>,
    queue: Mutex<VecDeque<Job>>,
    queue_ready: Condvar,
    interrupted: Mutex<Vec<StoredJob>>,
    active: Mutex<Option<StoredJob>>,
    current: Mutex<Option<CurrentRun>>,
    prompt: Mutex<Option<(i64, Prompt, mpsc::Sender<Reply>)>>,
    history: Mutex<HashMap<i64, VecDeque<BackendMessage>>>,
    links: Mutex<HashMap<i64, LinkFlow>>,
    albums: Mutex<HashMap<(i64, String), PendingAlbum>>,
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    crate::host::async_runtime::block_on(future)
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..24].to_string()
}

impl Worker {
    fn start(app: AppHandle, library: CatalogLibrary, token: String, stop: Arc<AtomicBool>) -> Option<Arc<Worker>> {
        let bot_id = token.split(':').next().unwrap_or("bot").chars().filter(char::is_ascii_digit).collect::<String>();
        let library_key = library.id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
        let directory = app.path().app_data_dir().map(|directory| directory.join("telegram")).ok()?;
        let file = directory.join(format!("{library_key}-{bot_id}.json"));
        let mut persisted = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<WorkerFile>(&text).ok())
            .unwrap_or_default();
        persisted.jobs.iter_mut().for_each(StoredJob::adopt_legacy_attachment);
        let worker = Arc::new(Worker {
            app,
            library,
            token,
            stop,
            file,
            interrupted: Mutex::new(persisted.jobs.clone()),
            persisted: Mutex::new(WorkerFile { jobs: Vec::new(), ..persisted }),
            queue: Mutex::new(VecDeque::new()),
            queue_ready: Condvar::new(),
            active: Mutex::new(None),
            current: Mutex::new(None),
            prompt: Mutex::new(None),
            history: Mutex::new(HashMap::new()),
            links: Mutex::new(HashMap::new()),
            albums: Mutex::new(HashMap::new()),
        });
        worker.persist();
        worker.notify_interrupted();
        let executor = Arc::clone(&worker);
        let _ = std::thread::Builder::new().name("notia-telegram-executor".into()).spawn(move || executor.run_queue());
        let poller = Arc::clone(&worker);
        let _ = std::thread::Builder::new().name("notia-telegram-poller".into()).spawn(move || poller.poll());
        Some(worker)
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn persist(&self) {
        let Ok(mut persisted) = self.persisted.lock() else {
            return;
        };
        let mut jobs = self.active.lock().map(|active| active.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
        jobs.extend(self.interrupted.lock().map(|items| items.clone()).unwrap_or_default());
        jobs.extend(
            self.queue
                .lock()
                .map(|queue| queue.iter().filter(|job| job.autonomous.is_none()).map(|job| job.stored.clone()).collect::<Vec<_>>())
                .unwrap_or_default(),
        );
        persisted.jobs = jobs;
        let Ok(text) = serde_json::to_string(&*persisted) else {
            return;
        };
        if let Some(parent) = self.file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let temporary = self.file.with_extension("json.tmp");
        if std::fs::write(&temporary, text).is_ok() {
            let _ = std::fs::rename(&temporary, &self.file);
        }
    }

    fn send(&self, chat_id: i64, text: &str) -> Option<i64> {
        block_on(telegram::send_message(&self.token, chat_id, text, Vec::new(), None)).ok()
    }

    fn send_html(&self, chat_id: i64, html: &str, buttons: Vec<(String, String)>) -> Option<i64> {
        match block_on(telegram::send_message(&self.token, chat_id, html, buttons.clone(), Some("HTML"))) {
            Ok(id) => Some(id),
            // Telegram rejects malformed HTML; the text still reaches the user.
            Err(_) => block_on(telegram::send_message(&self.token, chat_id, &strip_html(html), buttons, None)).ok(),
        }
    }

    /// Sends a Markdown text as one or more messages, split between
    /// paragraphs so a long answer is neither cut nor loses its format.
    fn send_markdown(&self, chat_id: i64, markdown: &str) {
        self.send_parts(chat_id, bot::telegram_html_parts(markdown), Vec::new());
    }

    /// Sends whole the agent's notes the person has not read since the last
    /// delivery (see `bot::notes_to_deliver`).
    fn deliver_notes(
        &self,
        chat_id: i64,
        runtime: &crate::backend_runtime::BackendRuntimeState,
        context: &BackendRequestContext,
        seen_events: &mut u64,
        asking: bool,
    ) {
        let events = runtime.request_events(context, *seen_events).unwrap_or_default();
        *seen_events = events.iter().map(|envelope| envelope.sequence).max().unwrap_or(*seen_events);
        let events = events.into_iter().map(|envelope| envelope.event).collect::<Vec<_>>();
        for note in bot::notes_to_deliver(&events, asking) {
            self.send_markdown(chat_id, &note);
        }
    }

    /// Sends the HTML parts of one text in order; the buttons go with the last.
    fn send_parts(&self, chat_id: i64, parts: Vec<String>, buttons: Vec<(String, String)>) {
        let last = parts.len().saturating_sub(1);
        for (index, part) in parts.into_iter().enumerate() {
            self.send_html(chat_id, &part, if index == last { buttons.clone() } else { Vec::new() });
        }
    }

    fn notify_interrupted(&self) {
        let jobs = self.interrupted.lock().map(|jobs| jobs.clone()).unwrap_or_default();
        let mut by_chat = HashMap::<i64, usize>::new();
        for job in &jobs {
            *by_chat.entry(job.chat_id).or_default() += 1;
        }
        for (chat_id, count) in by_chat {
            self.send(chat_id, &bot::interrupted_message(count));
        }
    }

    fn database_context(&self) -> LibraryDatabaseContext {
        LibraryDatabaseContext {
            library_path: self.library.path.clone(),
            android_directory_uri: self.library.android_tree_uri.clone(),
        }
    }

    fn library_config(&self) -> Value {
        crate::library_config::read_library_config(&self.app, &self.library.id).ok().flatten().unwrap_or(Value::Null)
    }

    // -----------------------------------------------------------------------
    // Polling
    // -----------------------------------------------------------------------

    fn poll(self: Arc<Self>) {
        while !self.stopped() {
            let offset = self.persisted.lock().map(|file| file.offset).unwrap_or_default();
            let updates = match block_on(telegram::get_updates(&self.token, offset)) {
                Ok(updates) => updates,
                Err(_) => {
                    std::thread::sleep(POLL_RETRY_DELAY);
                    continue;
                }
            };
            for update in updates {
                if self.stopped() {
                    break;
                }
                let seen = {
                    let Ok(mut file) = self.persisted.lock() else {
                        return;
                    };
                    file.offset = file.offset.max(update.update_id + 1);
                    let seen = file.processed.contains(&update.update_id);
                    if !seen {
                        file.processed.push_back(update.update_id);
                        while file.processed.len() > MAX_PROCESSED_UPDATES {
                            file.processed.pop_front();
                        }
                    }
                    seen
                };
                self.persist();
                if !seen {
                    self.handle_update(update);
                }
            }
        }
        // Stopping keeps the queue on disk: it becomes interrupted and is
        // only resumed with the explicit recovery command.
        if let Ok(mut queue) = self.queue.lock() {
            // Autonomous runs are dropped: the next review asks again.
            let drained = queue.drain(..).filter(|job| job.autonomous.is_none()).map(|job| job.stored).collect::<Vec<_>>();
            if let Ok(mut interrupted) = self.interrupted.lock() {
                interrupted.extend(drained);
            }
        }
        self.queue_ready.notify_all();
        self.persist();
    }

    fn handle_update(self: &Arc<Self>, update: IncomingTelegramUpdate) {
        if update.chat_type != "private" {
            self.send(update.chat_id, "Notia solo responde en chats privados.");
            return;
        }
        let Some(library_user_id) = self.linked_user(&update) else {
            return;
        };
        if let Some(callback_id) = update.callback_query_id.as_deref() {
            let _ = block_on(telegram::answer_callback(&self.token, callback_id));
        }
        if let Some(data) = update.callback_data.as_deref() {
            self.handle_callback(update.chat_id, data);
            return;
        }
        let mut text = update.text.as_deref().map(str::trim).unwrap_or_default().to_string();
        if text.is_empty() {
            if let Some(audio) = update.audio.as_ref() {
                match transcribe(&self.app, &self.token, audio) {
                    Ok(transcription) => {
                        text = format!(
                            "{}\n\n[Origen: audio de Telegram fileId={}; conservar esta referencia si se crea una operación financiera.]",
                            transcription.trim(),
                            audio_file_id(audio)
                        );
                        let acknowledgement = transcription.chars().take(3_000).collect::<String>();
                        self.send_html(
                            update.chat_id,
                            &format!("Solicitud <b>{}</b> recibida y en proceso.", crate::backend::escape_telegram_html(&acknowledgement)),
                            Vec::new(),
                        );
                    }
                    Err(message) => {
                        self.send(update.chat_id, &message);
                        return;
                    }
                }
            }
        }
        if update.document.as_ref().is_some_and(|document| telegram::document_kind(document).is_none()) {
            self.send(update.chat_id, "Por ahora recibo fotos, imágenes JPG o PNG y documentos PDF.");
            return;
        }
        let attachment = update
            .photo
            .clone()
            .map(JobAttachment::Photo)
            .or_else(|| update.document.clone().map(JobAttachment::Document));
        if text.is_empty() && attachment.is_none() {
            return;
        }
        // The Owner comes first: a run Notia started by itself gives way.
        self.stop_autonomous_run(update.chat_id);
        if let (Some(attachment), Some(group)) = (attachment.clone(), update.media_group_id.clone()) {
            self.collect_album_part(update.chat_id, group, update.user.id, library_user_id, text, attachment);
            return;
        }
        if attachment.is_none() && text.to_lowercase() == bot::RECOVERY_COMMAND {
            self.recover(update.chat_id);
            return;
        }
        if attachment.is_none() && self.answer_prompt(update.chat_id, &text) {
            return;
        }
        // A message of the chat whose request runs may ask to stop it; the
        // decision runs beside the request and the polling goes on.
        if attachment.is_none() && self.running_request(update.chat_id).is_some() {
            let worker = Arc::clone(self);
            let (chat_id, telegram_user_id) = (update.chat_id, update.user.id);
            let _ = std::thread::Builder::new()
                .name("notia-telegram-interrupt".into())
                .spawn(move || worker.interrupt(chat_id, telegram_user_id, library_user_id, text));
            return;
        }
        self.enqueue(update.chat_id, update.user.id, library_user_id, text, attachment.into_iter().collect(), true);
    }

    /// Adds a part of an album; the first part waits until no other part
    /// arrived for `ALBUM_WINDOW` and queues the whole album as one request,
    /// with the caption any of its parts carried.
    fn collect_album_part(
        self: &Arc<Self>,
        chat_id: i64,
        group: String,
        telegram_user_id: i64,
        library_user_id: String,
        text: String,
        attachment: JobAttachment,
    ) {
        let key = (chat_id, group);
        let first = {
            let Ok(mut albums) = self.albums.lock() else {
                return;
            };
            match albums.get_mut(&key) {
                Some(album) => {
                    if album.attachments.len() < MAX_ALBUM_PARTS {
                        album.attachments.push(attachment);
                    }
                    if album.text.is_empty() {
                        album.text = text;
                    }
                    album.last_part = Instant::now();
                    false
                }
                None => {
                    albums.insert(
                        key.clone(),
                        PendingAlbum { telegram_user_id, library_user_id, text, attachments: vec![attachment], last_part: Instant::now() },
                    );
                    true
                }
            }
        };
        if !first {
            return;
        }
        let worker = Arc::clone(self);
        let _ = std::thread::Builder::new().name("notia-telegram-album".into()).spawn(move || loop {
            std::thread::sleep(ALBUM_POLL_INTERVAL);
            let complete = {
                let Ok(mut albums) = worker.albums.lock() else {
                    return;
                };
                match albums.get(&key) {
                    Some(album) if album.last_part.elapsed() >= ALBUM_WINDOW => albums.remove(&key),
                    Some(_) => continue,
                    None => return,
                }
            };
            if let Some(album) = complete {
                worker.enqueue(chat_id, album.telegram_user_id, album.library_user_id, album.text, album.attachments, true);
            }
            return;
        });
    }

    /// Text and context of the request that runs for `chat_id` because the
    /// person asked for it (an autonomous run never decides about messages).
    fn running_request(&self, chat_id: i64) -> Option<(String, BackendRequestContext)> {
        self.current
            .lock()
            .ok()?
            .as_ref()
            .filter(|run| run.chat_id == chat_id && !run.autonomous)
            .map(|run| (run.text.clone(), run.context.clone()))
    }

    /// Drops the queued autonomous run of `chat_id` and cancels, without
    /// telling the chat, the one that runs, so the message just received
    /// goes first.
    fn stop_autonomous_run(self: &Arc<Self>, chat_id: i64) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.retain(|job| job.autonomous.is_none() || job.stored.chat_id != chat_id);
        }
        let request_id = self.current.lock().ok().and_then(|current| {
            current.as_ref().filter(|run| run.chat_id == chat_id && run.autonomous).map(|run| run.context.request_id.clone())
        });
        let Some(request_id) = request_id else {
            return;
        };
        let worker = Arc::clone(self);
        let _ = std::thread::Builder::new()
            .name("notia-telegram-autonomy-stop".into())
            .spawn(move || worker.cancel_current(chat_id, &request_id));
    }

    /// Queues an autonomous run in the Owner's chat, unless one is already
    /// queued or running or the Owner has not linked Telegram.
    fn enqueue_autonomous(&self, kind: AutonomousKind, trigger: String) -> AutonomousEnqueue {
        let running = self.current.lock().map(|current| current.as_ref().is_some_and(|run| run.autonomous)).unwrap_or(true);
        let queued = self.queue.lock().map(|queue| queue.iter().any(|job| job.autonomous.is_some())).unwrap_or(true);
        if running || queued {
            return AutonomousEnqueue::Busy;
        }
        let Ok(Some((telegram_user_id, chat_id))) = crate::library_users::owner_telegram_link(&self.app, &self.database_context()) else {
            return AutonomousEnqueue::Unavailable;
        };
        // Only the autonomy thread queues these runs, so none arrived meanwhile.
        let Ok(mut queue) = self.queue.lock() else {
            return AutonomousEnqueue::Unavailable;
        };
        queue.push_back(Job {
            stored: StoredJob {
                request_id: short_id(),
                chat_id,
                telegram_user_id,
                library_user_id: OWNER.to_string(),
                attachments: Vec::new(),
                attachment: None,
            },
            text: trigger,
            autonomous: Some(kind),
        });
        drop(queue);
        self.queue_ready.notify_all();
        AutonomousEnqueue::Queued
    }

    fn cancel_requested(&self, chat_id: i64) -> bool {
        self.current
            .lock()
            .ok()
            .and_then(|current| current.as_ref().filter(|run| run.chat_id == chat_id).map(|run| run.cancelled.load(Ordering::SeqCst)))
            .unwrap_or(false)
    }

    /// Decides whether a message sent during the chat's request stops it,
    /// stops it and runs next, or waits in the queue.
    fn interrupt(self: &Arc<Self>, chat_id: i64, telegram_user_id: i64, library_user_id: String, text: String) {
        let Some((running, context)) = self.running_request(chat_id) else {
            // The request ended meanwhile: the message is a new one.
            self.enqueue(chat_id, telegram_user_id, library_user_id, text, Vec::new(), true);
            return;
        };
        let decision = crate::backend_runtime::classify_interrupt(&self.app, &context, &running, &text);
        match (decision.cancels(), decision.queues()) {
            (true, true) => {
                self.send_html(chat_id, &format!("{} Después sigo con tu nuevo pedido.", bot::CANCELLING_MESSAGE), Vec::new());
                self.enqueue(chat_id, telegram_user_id, library_user_id, text, Vec::new(), false);
                self.cancel_current(chat_id, &context.request_id);
            }
            (true, false) => {
                self.send_html(chat_id, bot::CANCELLING_MESSAGE, Vec::new());
                self.cancel_current(chat_id, &context.request_id);
            }
            _ => self.enqueue(chat_id, telegram_user_id, library_user_id, text, Vec::new(), true),
        }
    }

    /// Stops the chat's request `request_id`: the question or confirmation
    /// it waits on is dropped, or its run is cancelled. A cancel that
    /// arrives before the run registered its control is tried again while
    /// that request is still the current one.
    fn cancel_current(&self, chat_id: i64, request_id: &str) {
        let target = self.current.lock().ok().and_then(|current| {
            current.as_ref().filter(|run| run.chat_id == chat_id && run.context.request_id == request_id).map(|run| {
                run.cancelled.store(true, Ordering::SeqCst);
                (run.context.clone(), run.idempotency_key.clone())
            })
        });
        let Some((context, idempotency_key)) = target else {
            return;
        };
        let dropped_prompt = self
            .prompt
            .lock()
            .map(|mut prompt| {
                let waiting = prompt.as_ref().is_some_and(|(prompt_chat, ..)| *prompt_chat == chat_id);
                if waiting {
                    *prompt = None;
                }
                waiting
            })
            .unwrap_or(false);
        if dropped_prompt {
            return;
        }
        let runtime = self.app.state::<crate::backend_runtime::BackendRuntimeState>().inner().clone();
        for _ in 0..CANCEL_ATTEMPTS {
            let still_current = self
                .current
                .lock()
                .map(|current| current.as_ref().is_some_and(|run| run.context.request_id == request_id))
                .unwrap_or(false);
            if !still_current {
                return;
            }
            let cancelled = {
                let registry = self.app.state::<crate::library_registry::LibraryBindingRegistry>();
                crate::backend_runtime::execute_backend_request(
                    &self.app,
                    cancel_envelope(&context, &idempotency_key, None),
                    &runtime,
                    registry.inner(),
                )
            };
            if cancelled.is_ok_and(|envelope| !matches!(envelope.response, BackendResponse::Error { .. })) {
                return;
            }
            std::thread::sleep(CANCEL_RETRY_DELAY);
        }
    }

    fn handle_callback(&self, chat_id: i64, data: &str) {
        let Ok(prompt) = self.prompt.lock() else {
            return;
        };
        let Some((prompt_chat, kind, sender)) = prompt.as_ref() else {
            return;
        };
        if *prompt_chat != chat_id {
            return;
        }
        match kind {
            Prompt::Confirmation { id } => {
                let mut parts = data.split(':');
                if parts.next() == Some("confirm") && parts.next() == Some(id.as_str()) {
                    let accepted = parts.next() == Some("yes");
                    let _ = sender.send(Reply::Decision(accepted));
                }
            }
            Prompt::Clarification { choices } => {
                if let Some(index) = data.strip_prefix("choice:").and_then(|value| value.parse::<usize>().ok()) {
                    if let Some(choice) = choices.get(index) {
                        let _ = sender.send(Reply::Text(choice.clone(), Some(index)));
                    }
                }
            }
        }
    }

    /// Delivers a typed answer to the pending confirmation or question.
    fn answer_prompt(&self, chat_id: i64, text: &str) -> bool {
        let Ok(prompt) = self.prompt.lock() else {
            return false;
        };
        let Some((prompt_chat, kind, sender)) = prompt.as_ref() else {
            return false;
        };
        if *prompt_chat != chat_id {
            return false;
        }
        match kind {
            Prompt::Confirmation { .. } => match bot::parse_confirmation_decision(text) {
                Some(decision) => sender.send(Reply::Decision(decision)).is_ok(),
                None => false,
            },
            Prompt::Clarification { choices } => {
                let (answer, index) = bot::resolve_choice_reply(text, choices);
                sender.send(Reply::Text(answer, index)).is_ok()
            }
        }
    }

    fn recover(&self, chat_id: i64) {
        let recovered = self
            .interrupted
            .lock()
            .map(|mut items| {
                let (mine, others): (Vec<_>, Vec<_>) = items.drain(..).partition(|job| job.chat_id == chat_id);
                *items = others;
                mine
            })
            .unwrap_or_default();
        if recovered.is_empty() {
            self.send(chat_id, "No hay solicitudes interrumpidas para reanudar.");
            return;
        }
        let (recoverable, resend): (Vec<_>, Vec<_>) = recovered.into_iter().partition(|job| !job.attachments.is_empty());
        let count = recoverable.len();
        if let Ok(mut queue) = self.queue.lock() {
            queue.extend(recoverable.into_iter().map(|stored| Job { stored, text: String::new(), autonomous: None }));
        }
        self.persist();
        self.queue_ready.notify_all();
        let mut message = if count > 0 {
            format!("{count} solicitud(es) con documento marcada(s) para reanudar.")
        } else {
            "No hay solicitudes con contenido recuperable.".to_string()
        };
        if !resend.is_empty() {
            message.push_str(&format!(
                " {} solicitud(es) de texto requieren que las reenvíes: no guardo el texto original para proteger tu privacidad.",
                resend.len()
            ));
        }
        self.send(chat_id, &message);
    }

    fn enqueue(
        &self,
        chat_id: i64,
        telegram_user_id: i64,
        library_user_id: String,
        text: String,
        attachments: Vec<JobAttachment>,
        announce: bool,
    ) {
        let document = !attachments.is_empty();
        let ahead = {
            let Ok(mut queue) = self.queue.lock() else {
                return;
            };
            let pending = queue.iter().filter(|job| job.autonomous.is_none()).count();
            if pending >= bot::MAX_PENDING_REQUESTS {
                drop(queue);
                self.send(chat_id, "No puedo aceptar más de 10 solicitudes pendientes. Esperá a que termine alguna e intentá nuevamente.");
                return;
            }
            let ahead = pending + usize::from(self.active.lock().map(|active| active.is_some()).unwrap_or(false));
            queue.push_back(Job {
                stored: StoredJob {
                    request_id: short_id(),
                    chat_id,
                    telegram_user_id,
                    library_user_id,
                    attachments,
                    attachment: None,
                },
                text,
                autonomous: None,
            });
            ahead
        };
        self.persist();
        self.queue_ready.notify_all();
        if announce && ahead > 0 {
            self.send_html(chat_id, &bot::queued_message(ahead, document), Vec::new());
        }
    }

    // -----------------------------------------------------------------------
    // Linking
    // -----------------------------------------------------------------------

    /// Library user linked to this Telegram account, or `None` while the
    /// account is being linked (the flow answers the chat itself).
    fn linked_user(&self, update: &IncomingTelegramUpdate) -> Option<String> {
        let context = self.database_context();
        let resolved = crate::library_users::resolve_library_telegram_user(
            self.app.clone(),
            crate::library_users::ResolveTelegramUserPayload {
                context: context.clone(),
                telegram_user_id: update.user.id,
                telegram_chat_id: update.chat_id,
            },
        );
        match resolved {
            Ok(Some(user)) => return Some(user.id),
            Ok(None) => {}
            Err(_) => {
                self.send(update.chat_id, "No se pudo verificar el enlace. Intentá nuevamente en unos segundos.");
                return None;
            }
        }
        self.link_step(update, context);
        None
    }

    fn link_step(&self, update: &IncomingTelegramUpdate, context: LibraryDatabaseContext) {
        let chat_id = update.chat_id;
        let now = Instant::now();
        let text = update.text.as_deref().map(str::trim).unwrap_or_default().to_string();
        let command = text.to_lowercase();
        let Ok(mut links) = self.links.lock() else {
            return;
        };
        if links.get(&chat_id).and_then(|flow| flow.blocked_until).is_some_and(|until| until > now)
            && !matches!(command.as_str(), "/start" | "/cancelar" | "/cancel")
        {
            drop(links);
            self.send(chat_id, "Demasiados intentos. Esperá unos segundos antes de volver a intentar o escribí /start para reiniciar el enlace.");
            return;
        }
        if command == "/start" {
            links.insert(chat_id, LinkFlow { step: LinkStep::Username, user_id: None, expires_at: now + LINK_TIMEOUT, attempts: 0, blocked_until: None });
            drop(links);
            self.send(chat_id, "Para vincular Telegram, escribí tu nombre de usuario de Notia. Escribí /cancelar para detener el enlace.");
            return;
        }
        if matches!(command.as_str(), "/cancelar" | "/cancel") {
            links.remove(&chat_id);
            drop(links);
            self.send(chat_id, "Enlace cancelado. Escribí /start cuando quieras intentarlo nuevamente.");
            return;
        }
        let Some(mut flow) = links.get(&chat_id).cloned().filter(|flow| flow.expires_at > now) else {
            links.remove(&chat_id);
            drop(links);
            self.send(chat_id, "No tenés un usuario de Notia vinculado. Escribí /start para iniciar sesión y vincular este chat.");
            return;
        };
        if text.is_empty() || update.audio.is_some() || update.photo.is_some() || update.document.is_some() || update.callback_query_id.is_some() {
            drop(links);
            self.send(chat_id, "Durante el enlace solo se aceptan respuestas de texto. Escribí /cancelar para detenerlo.");
            return;
        }
        let fail = |flow: &mut LinkFlow| {
            flow.attempts += 1;
            if flow.attempts >= LINK_MAX_ATTEMPTS {
                flow.blocked_until = Some(now + LINK_COOLDOWN);
            }
        };
        let reply = match flow.step.clone() {
            LinkStep::Username => {
                match crate::library_users::find_library_user(
                    self.app.clone(),
                    crate::library_users::FindLibraryUserPayload { context, name: text },
                ) {
                    Ok(Some(user)) => {
                        flow.step = if user.password_configured { LinkStep::ExistingPassword } else { LinkStep::NewPassword };
                        flow.user_id = Some(user.id);
                        if user.password_configured {
                            "Escribí la contraseña de tu usuario de Notia."
                        } else {
                            "Este usuario todavía no tiene contraseña. Escribí una nueva de 8 a 256 caracteres."
                        }
                    }
                    Ok(None) => {
                        fail(&mut flow);
                        "No se pudo completar el enlace con esos datos. Revisá el nombre e intentá nuevamente."
                    }
                    Err(_) => "No se pudo completar el enlace. Intentá nuevamente.",
                }
            }
            LinkStep::NewPassword => {
                if !(8..=256).contains(&text.chars().count()) {
                    "La contraseña debe tener entre 8 y 256 caracteres. Intentá nuevamente."
                } else {
                    flow.step = LinkStep::ConfirmPassword(text);
                    "Repetí la nueva contraseña para confirmarla."
                }
            }
            LinkStep::ConfirmPassword(password) if password != text => {
                flow.step = LinkStep::NewPassword;
                fail(&mut flow);
                "Las contraseñas no coinciden. Escribí una nueva contraseña para intentarlo otra vez."
            }
            LinkStep::ConfirmPassword(_) | LinkStep::ExistingPassword => {
                let linked = crate::library_users::link_library_user_telegram(
                    self.app.clone(),
                    crate::library_users::LinkTelegramPayload {
                        context,
                        user_id: flow.user_id.clone().unwrap_or_default(),
                        telegram_user_id: update.user.id,
                        telegram_chat_id: chat_id,
                        password: text,
                    },
                );
                if linked.is_ok() {
                    links.remove(&chat_id);
                    drop(links);
                    self.send(chat_id, "Telegram quedó vinculado. Ya podés enviar consultas.");
                    return;
                }
                fail(&mut flow);
                if flow.blocked_until.is_some() {
                    "Se alcanzó el límite de intentos. Escribí /start más tarde para reintentar."
                } else {
                    "No se pudo verificar la contraseña. Intentá nuevamente o escribí /cancelar."
                }
            }
        };
        links.insert(chat_id, flow);
        drop(links);
        self.send(chat_id, reply);
    }

    // -----------------------------------------------------------------------
    // Execution
    // -----------------------------------------------------------------------

    fn run_queue(self: Arc<Self>) {
        while !self.stopped() {
            let job = {
                let Ok(queue) = self.queue.lock() else {
                    return;
                };
                let Ok((mut queue, _)) = self.queue_ready.wait_timeout(queue, Duration::from_secs(1)) else {
                    return;
                };
                queue.pop_front()
            };
            let Some(job) = job else {
                continue;
            };
            // Runs Notia started by itself are never stored nor resumed.
            if let Some(kind) = job.autonomous {
                self.run_autonomous(&job, kind);
                if let Ok(mut current) = self.current.lock() {
                    *current = None;
                }
                continue;
            }
            if let Ok(mut active) = self.active.lock() {
                *active = Some(job.stored.clone());
            }
            self.persist();
            let chat_id = job.stored.chat_id;
            let result = self.run_job(&job);
            if let Ok(mut current) = self.current.lock() {
                *current = None;
            }
            if let Err(message) = result {
                self.send(chat_id, &message);
            }
            if let Ok(mut active) = self.active.lock() {
                *active = None;
            }
            self.persist();
        }
    }

    /// Text and files of the request, downloading its attachments. Each
    /// file adds an origin line with its evidence reference; photos and
    /// images go as images and a PDF as its extracted text. A file that
    /// cannot be read is named in the request while the others go on.
    fn prepare_input(&self, job: &Job) -> Result<(String, Vec<MessageAttachment>), String> {
        let text = job.text.trim().to_string();
        let files = &job.stored.attachments;
        if files.is_empty() {
            if text.is_empty() {
                return Err("La solicitud perdió su texto al reiniciar; reenviala.".to_string());
            }
            return Ok((text, Vec::new()));
        }
        let mut origins = Vec::new();
        let mut attachments = Vec::new();
        let mut unread = Vec::new();
        for (index, file) in files.iter().enumerate() {
            match self.read_attachment(index + 1, file) {
                Ok((origin, attachment)) => {
                    origins.push(origin);
                    attachments.push(attachment);
                }
                Err(reason) => unread.push(reason),
            }
        }
        if attachments.is_empty() {
            return Err(unread.into_iter().next().unwrap_or_else(|| "No se pudo leer el archivo.".to_string()));
        }
        let request = if text.is_empty() { bot::DOCUMENT_PROMPT.to_string() } else { text };
        let mut prompt = format!("{request}\n\n{}", origins.join("\n"));
        if !unread.is_empty() {
            prompt.push_str(&format!("\n[No se pudieron leer: {}]", unread.join(" ")));
        }
        Ok((prompt, attachments))
    }

    /// Downloads one file of the request: its origin line and its attachment.
    fn read_attachment(&self, number: usize, file: &JobAttachment) -> Result<(String, MessageAttachment), String> {
        use crate::backend::chat_attachments::{MessageAttachmentKind, MAX_TEXT_CHARS};
        let image = |name: String, media_type: &str, bytes: Vec<u8>| MessageAttachment {
            name,
            media_type: media_type.to_string(),
            kind: MessageAttachmentKind::Image,
            pages: vec![base64::engine::general_purpose::STANDARD.encode(bytes)],
            text_content: None,
            extracted_text: None,
            page_count: None,
        };
        match file {
            JobAttachment::Photo(photo) => {
                let bytes = block_on(telegram::download_photo(&self.token, photo))?;
                let origin = format!(
                    "[Origen: imagen {number} de Telegram fileId={id}. Referencia de evidencia: telegram:telegram-{id}.jpg]",
                    id = photo.file_id
                );
                Ok((origin, image(format!("foto-{number}.jpg"), "image/jpeg", bytes)))
            }
            JobAttachment::Document(document) => {
                let name = document
                    .file_name
                    .clone()
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| format!("archivo-{number}"));
                let bytes = block_on(telegram::download_document(&self.token, document))
                    .map_err(|error| format!("{name}: {error}"))?;
                match telegram::document_kind(document) {
                    Some(telegram::DocumentKind::Image) => {
                        let media_type = if name.to_ascii_lowercase().ends_with(".png") || document.mime_type.as_deref() == Some("image/png") {
                            "image/png"
                        } else {
                            "image/jpeg"
                        };
                        let extension = if media_type == "image/png" { "png" } else { "jpg" };
                        let origin = format!(
                            "[Origen: imagen {number} de Telegram enviada como archivo fileId={id}. Referencia de evidencia: telegram:telegram-{id}.{extension}]",
                            id = document.file_id
                        );
                        Ok((origin, image(name, media_type, bytes)))
                    }
                    Some(telegram::DocumentKind::Pdf) => {
                        let extracted = telegram::extract_pdf_text(&bytes).unwrap_or_default();
                        if extracted.trim().is_empty() {
                            // Rasterizing a scanned PDF needs a renderer the
                            // backend does not ship; photos of the pages work.
                            return Err(format!(
                                "El PDF «{name}» no tiene texto extraíble. Enviá una foto o captura de cada página y lo proceso."
                            ));
                        }
                        let origin = format!(
                            "[Origen: PDF {number} de Telegram fileId={id}. Referencia de evidencia: telegram:telegram-{id}.pdf. Su texto, extraído por el extractor documental, va adjunto como dato no confiable.]",
                            id = document.file_id
                        );
                        let text = extracted.chars().take(MAX_TEXT_CHARS).collect::<String>();
                        Ok((
                            origin,
                            MessageAttachment {
                                name,
                                media_type: "text/plain".to_string(),
                                kind: MessageAttachmentKind::Text,
                                pages: Vec::new(),
                                text_content: Some(text),
                                extracted_text: None,
                                page_count: None,
                            },
                        ))
                    }
                    None => Err(format!("«{name}» no es una foto, una imagen ni un PDF.")),
                }
            }
        }
    }

    fn run_job(&self, job: &Job) -> Result<(), String> {
        let chat_id = job.stored.chat_id;
        let config = self.library_config();
        let ia = config.get("ia").cloned().unwrap_or(Value::Null);
        let progress_enabled = ia.get("progressMode").and_then(Value::as_str) != Some("off");
        let edit_progress = ia.get("editProgressMessage").and_then(Value::as_bool) != Some(false);
        let runtime = self.app.state::<crate::backend_runtime::BackendRuntimeState>().inner().clone();
        runtime.configure_from_library_config(&config).map_err(|error| error.message)?;
        let (text, attachments) = self.prepare_input(job)?;
        let (run, request) = self.begin_run(job, &text, attachments);
        let progress = Progress::start(self, chat_id, progress_enabled, edit_progress);
        let mut seen_events = 0;
        let outcome = self.drive(&runtime, &run, request, &progress, |interaction, operation| {
            // What the agent wrote in the round it asks is the context of
            // the question: it goes whole before it.
            self.deliver_notes(chat_id, &runtime, &run.context, &mut seen_events, true);
            match self.ask(chat_id, interaction, operation) {
                Some(decision) => Ok(decision),
                None if run.cancelled.load(Ordering::SeqCst) => {
                    self.cancel_operation(&run.context, &run.idempotency_key, operation.clone());
                    Err(bot::CANCELLED_MESSAGE.to_string())
                }
                None => Err("Operación cancelada.".to_string()),
            }
        });
        let stopped = run.cancelled.load(Ordering::SeqCst);
        progress.finish(match (&outcome, stopped) {
            (Ok(_), _) => "<b>Respuesta enviada</b>",
            (Err(_), true) => "<b>Solicitud cancelada</b>",
            (Err(_), false) => "<b>No pude completar la operación</b>",
        });
        if stopped && outcome.is_err() {
            // The next request of the chat knows what was cancelled.
            self.remember(chat_id, text, bot::CANCELLED_MESSAGE.to_string());
            return Err(bot::CANCELLED_MESSAGE.to_string());
        }
        // A failed request stays in the chat's history too, so «seguí» or
        // «¿qué pasó?» has its context.
        if let Err(error) = &outcome {
            self.remember(chat_id, text.clone(), format!("No pude terminar: {error}"));
        }
        let response = outcome?;
        if stopped {
            self.send(chat_id, bot::TOO_LATE_TO_CANCEL_MESSAGE);
        }
        // What the progress showed clipped arrives whole before the answer.
        self.deliver_notes(chat_id, &runtime, &run.context, &mut seen_events, false);
        self.send_markdown(chat_id, &response.response.markdown);
        self.remember(chat_id, text, response.response.markdown.clone());
        if response.changed {
            let _ = self.app.emit(LIBRARY_CHANGED_EVENT, &self.library.id);
        }
        Ok(())
    }

    /// Runs a request Notia queued by itself. Nothing reaches the chat but
    /// the agent's message, and only when it is not silence; the message
    /// then joins the chat's history, so a reply has its context, and
    /// becomes a thought, so the next runs know it was said.
    fn run_autonomous(&self, job: &Job, kind: AutonomousKind) {
        let chat_id = job.stored.chat_id;
        let runtime = self.app.state::<crate::backend_runtime::BackendRuntimeState>().inner().clone();
        if let Err(error) = runtime.configure_from_library_config(&self.library_config()) {
            log::error!("[notia:autonomy] no se pudo preparar la corrida {}: {:?}", kind.id(), error.code);
            return;
        }
        let (run, request) = self.begin_run(job, &job.text, Vec::new());
        let silent_progress = Progress::start(self, chat_id, false, false);
        let mut question = None;
        let outcome = self.drive(&runtime, &run, request, &silent_progress, |interaction, operation| {
            // Nobody waits for an answer: a question becomes the message
            // and any other pause ends the run.
            if let crate::backend::PendingInteraction::Clarification(request) = &interaction {
                let options = request.options.iter().map(|option| format!("\n- {}", option.label)).collect::<String>();
                question = Some(format!("{}{options}", request.question.trim()));
            }
            self.cancel_operation(&run.context, &run.idempotency_key, operation.clone());
            Err("La corrida autónoma no espera respuestas.".to_string())
        });
        // The Owner wrote meanwhile: their message goes first and the next
        // run can bring this up again.
        if run.cancelled.load(Ordering::SeqCst) {
            return;
        }
        let message = match (outcome, question) {
            (Ok(response), _) => response.response.markdown,
            (Err(_), Some(question)) => question,
            // A failed run sends nothing; `drive` logged backend errors.
            (Err(_), None) => return,
        };
        if autonomy::is_silent(&message) {
            return;
        }
        self.send_markdown(chat_id, &message);
        self.keep_autonomous_message(chat_id, kind, message);
    }

    /// Keeps a message Notia sent by itself in the chat's history and in
    /// the agent's thoughts.
    fn keep_autonomous_message(&self, chat_id: i64, kind: AutonomousKind, message: String) {
        if let Err(error) = crate::agent_knowledge::keep_thought(&self.app, &self.library.id, &autonomy::sent_thought(&message)) {
            log::error!("[notia:autonomy] no se pudo anotar el mensaje enviado: {:?}", error.code);
        }
        self.remember(chat_id, autonomy::autonomous_history_note(kind), message);
    }

    /// Context and first request of a job's run, registered as the chat's
    /// current run so a message of the chat can stop it.
    fn begin_run(&self, job: &Job, text: &str, attachments: Vec<MessageAttachment>) -> (ActiveRun, BackendRequest) {
        let chat_id = job.stored.chat_id;
        let owner = job.stored.library_user_id == OWNER;
        let context = BackendRequestContext {
            request_id: job.stored.request_id.clone(),
            library_id: self.library.id.clone(),
            actor: BackendActor {
                library_user_id: job.stored.library_user_id.clone(),
                external_identity: Some(crate::backend::context::ExternalIdentity {
                    provider: "telegram".into(),
                    user_id: job.stored.telegram_user_id.to_string(),
                    chat_id: Some(chat_id),
                }),
            },
            channel: BackendChannel::Telegram,
            // Text, photos and documents all go to the library chat, where
            // the model picks the tools the request needs.
            scope: BackendScope::Library,
            persistence_policy: if owner { PersistencePolicy::Persistent } else { PersistencePolicy::EphemeralNoMemory },
        };
        let mut messages = self.history.lock().map(|history| history.get(&chat_id).map(|items| items.iter().cloned().collect::<Vec<_>>()).unwrap_or_default()).unwrap_or_default();
        messages.push(BackendMessage { role: MessageRole::User, content: text.to_string(), images: Vec::new(), attachments });
        let idempotency_key = format!("{}:{}", self.library.id, job.stored.request_id);
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut current) = self.current.lock() {
            *current = Some(CurrentRun {
                chat_id,
                text: text.to_string(),
                context: context.clone(),
                idempotency_key: idempotency_key.clone(),
                cancelled: Arc::clone(&cancelled),
                autonomous: job.autonomous.is_some(),
            });
        }
        let request = BackendRequest::Run(AgentRequest {
            context: context.clone(),
            messages,
            snapshot: None,
            tools: Vec::new(),
            attachments: Vec::new(),
            idempotency_key: idempotency_key.clone(),
            prompt_name: None,
            tool_access: Default::default(),
            library_search: true,
            autonomous: job.autonomous.is_some(),
        });
        (ActiveRun { context, idempotency_key, cancelled }, request)
    }

    /// Runs `request` until the agent answers. Each pause (a confirmation,
    /// plan or question) is resumed with what `pause` decides, or ends the
    /// run with its error. A cancelled run ends with the cancel message.
    fn drive(
        &self,
        runtime: &crate::backend_runtime::BackendRuntimeState,
        run: &ActiveRun,
        mut request: BackendRequest,
        progress: &Progress,
        mut pause: impl FnMut(crate::backend::PendingInteraction, &crate::backend::OperationToken) -> Result<ResumeDecision, String>,
    ) -> Result<crate::backend::AgentResponse, String> {
        loop {
            let running = Arc::new(AtomicBool::new(true));
            let observer = progress.observe(runtime, &run.context, Arc::clone(&running));
            let result = {
                let registry = self.app.state::<crate::library_registry::LibraryBindingRegistry>();
                crate::backend_runtime::execute_backend_request(
                    &self.app,
                    BackendRequestEnvelope { protocol_version: ProtocolVersion::default(), request },
                    runtime,
                    registry.inner(),
                )
            };
            running.store(false, Ordering::SeqCst);
            if let Some(observer) = observer {
                let _ = observer.join();
            }
            let response = match result {
                Ok(envelope) => envelope.response,
                Err(error) => {
                    crate::backend_runtime::log_request_failure(runtime, "telegram", &run.context, &error);
                    return Err(error.message);
                }
            };
            let stopped = run.cancelled.load(Ordering::SeqCst);
            match response {
                // The run finished before the cancel reached it.
                BackendResponse::Result { response } => return Ok(response),
                BackendResponse::Operation { status } | BackendResponse::Resumed { status, .. } if stopped => {
                    if let Some(operation) = status.operation {
                        self.cancel_operation(&run.context, &run.idempotency_key, operation);
                    }
                    return Err(bot::CANCELLED_MESSAGE.to_string());
                }
                _ if stopped => return Err(bot::CANCELLED_MESSAGE.to_string()),
                BackendResponse::Error { error, .. } => {
                    crate::backend_runtime::log_request_failure(runtime, "telegram", &run.context, &error);
                    return Err(error.message);
                }
                BackendResponse::Operation { status } | BackendResponse::Resumed { status, .. } => {
                    let (Some(operation), Some(interaction)) = (status.operation.clone(), status.interaction.clone()) else {
                        return Err("El runtime no devolvió una respuesta final.".to_string());
                    };
                    let decision = pause(interaction, &operation)?;
                    request = BackendRequest::Resume(ResumeRequest {
                        context: run.context.clone(),
                        idempotency_key: run.idempotency_key.clone(),
                        request_id: run.context.request_id.clone(),
                        operation,
                        last_event_sequence: status.last_event_sequence,
                        decision,
                    });
                }
                _ => return Err("El runtime no devolvió una respuesta final.".to_string()),
            }
        }
    }

    /// Adds a request and its answer to the chat's recent history.
    fn remember(&self, chat_id: i64, request: String, answer: String) {
        if let Ok(mut history) = self.history.lock() {
            let entries = history.entry(chat_id).or_default();
            entries.push_back(BackendMessage { role: MessageRole::User, content: request, images: Vec::new(), attachments: Vec::new() });
            entries.push_back(BackendMessage { role: MessageRole::Assistant, content: answer, images: Vec::new(), attachments: Vec::new() });
            while entries.len() > bot::MAX_HISTORY_MESSAGES {
                entries.pop_front();
            }
        }
    }

    /// Marks the operation a cancelled run was waiting on as cancelled.
    fn cancel_operation(&self, context: &BackendRequestContext, idempotency_key: &str, operation: crate::backend::OperationToken) {
        let runtime = self.app.state::<crate::backend_runtime::BackendRuntimeState>().inner().clone();
        let registry = self.app.state::<crate::library_registry::LibraryBindingRegistry>();
        let _ = crate::backend_runtime::execute_backend_request(
            &self.app,
            cancel_envelope(context, idempotency_key, Some(operation)),
            &runtime,
            registry.inner(),
        );
    }

    /// Shows the pending interaction and waits for the user's answer.
    fn ask(
        &self,
        chat_id: i64,
        interaction: crate::backend::PendingInteraction,
        operation: &crate::backend::OperationToken,
    ) -> Option<ResumeDecision> {
        use crate::backend::PendingInteraction as Interaction;
        if self.cancel_requested(chat_id) {
            return None;
        }
        let (sender, receiver) = mpsc::channel();
        let confirm_buttons = |id: &str| {
            vec![("Confirmar".to_string(), format!("confirm:{id}:yes")), ("Cancelar".to_string(), format!("confirm:{id}:no"))]
        };
        let (prompt, timeout) = match &interaction {
            Interaction::Confirmation(request) => {
                let id = short_id()[..8].to_string();
                self.send_parts(chat_id, bot::confirmation_parts(&request.preview), confirm_buttons(&id));
                (Prompt::Confirmation { id }, CONFIRMATION_TIMEOUT)
            }
            Interaction::Plan(plan) => {
                let id = short_id()[..8].to_string();
                self.send_parts(chat_id, bot::plan_parts(plan), confirm_buttons(&id));
                (Prompt::Confirmation { id }, CONFIRMATION_TIMEOUT)
            }
            Interaction::Clarification(request) => {
                let choices = request.options.iter().map(|option| option.label.clone()).collect::<Vec<_>>();
                let buttons = choices
                    .iter()
                    .enumerate()
                    .map(|(index, label)| (label.chars().take(bot::MAX_BUTTON_CHARS).collect(), format!("choice:{index}")))
                    .collect();
                self.send_parts(chat_id, bot::question_parts(&request.question, &choices), buttons);
                (Prompt::Clarification { choices }, CLARIFICATION_TIMEOUT)
            }
        };
        if let Ok(mut pending) = self.prompt.lock() {
            *pending = Some((chat_id, prompt, sender));
        }
        // A cancel that arrived while the question was being sent drops it.
        let reply = if self.cancel_requested(chat_id) { None } else { receiver.recv_timeout(timeout).ok() };
        if let Ok(mut pending) = self.prompt.lock() {
            *pending = None;
        }
        // A cancel dropped the question: the run stops without an answer.
        if self.cancel_requested(chat_id) {
            return None;
        }
        match (interaction, reply) {
            (Interaction::Confirmation(_), reply) => {
                let accepted = matches!(reply, Some(Reply::Decision(true)));
                self.send(chat_id, match reply {
                    Some(Reply::Decision(true)) => "Confirmación recibida. Aplicando el cambio…",
                    Some(_) => "Operación cancelada.",
                    None => "La confirmación venció después de 2 minutos. No se aplicaron cambios.",
                });
                Some(ResumeDecision::Confirmation(crate::backend::ConfirmationDecision {
                    operation_id: operation.operation_id.clone(),
                    accepted,
                    hunk_ids: Vec::new(),
                }))
            }
            (Interaction::Plan(plan), reply) => Some(ResumeDecision::Plan(crate::backend::PlanDecision {
                plan_id: plan.plan_id.clone(),
                generation: plan.generation,
                accepted: matches!(reply, Some(Reply::Decision(true))),
                step_ids: plan.steps.iter().map(|step| step.id.clone()).collect(),
                suggestion: None,
            })),
            (Interaction::Clarification(request), Some(Reply::Text(answer, index))) => {
                Some(ResumeDecision::Clarification(crate::backend::ClarificationAnswer {
                    clarification_id: request.clarification_id.clone(),
                    operation: operation.clone(),
                    answer,
                    option_id: index.and_then(|index| request.options.get(index)).map(|option| option.id.clone()),
                }))
            }
            (Interaction::Clarification(_), _) => None,
        }
    }
}

/// Progress message of a running request, edited while events arrive
/// (or sent anew when the user turned editing off).
struct Progress {
    token: String,
    chat_id: i64,
    enabled: bool,
    edit: bool,
    message_id: Arc<Mutex<Option<i64>>>,
    last_sequence: Arc<Mutex<u64>>,
    events: Arc<Mutex<Vec<crate::backend::BackendEvent>>>,
}

impl Progress {
    fn start(worker: &Worker, chat_id: i64, enabled: bool, edit: bool) -> Progress {
        let message_id = if enabled { worker.send_html(chat_id, "<b>Preparando la solicitud</b>", Vec::new()) } else { None };
        Progress {
            token: worker.token.clone(),
            chat_id,
            enabled,
            edit,
            message_id: Arc::new(Mutex::new(message_id)),
            last_sequence: Arc::new(Mutex::new(0)),
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Polls the request's events while it runs and updates the message.
    fn observe(
        &self,
        runtime: &crate::backend_runtime::BackendRuntimeState,
        context: &BackendRequestContext,
        running: Arc<AtomicBool>,
    ) -> Option<std::thread::JoinHandle<()>> {
        if !self.enabled {
            return None;
        }
        let runtime = runtime.clone();
        let context = context.clone();
        let message_id = Arc::clone(&self.message_id);
        let last_sequence = Arc::clone(&self.last_sequence);
        let events = Arc::clone(&self.events);
        let (token, chat_id, edit) = (self.token.clone(), self.chat_id, self.edit);
        std::thread::Builder::new()
            .name("notia-telegram-progress".into())
            .spawn(move || {
                let mut shown = String::new();
                while running.load(Ordering::SeqCst) {
                    std::thread::sleep(PROGRESS_INTERVAL);
                    let after = last_sequence.lock().map(|value| *value).unwrap_or_default();
                    let Ok(batch) = runtime.request_events(&context, after) else {
                        continue;
                    };
                    let message = {
                        let Ok(mut seen) = events.lock() else {
                            return;
                        };
                        for envelope in batch {
                            if let Ok(mut last) = last_sequence.lock() {
                                *last = (*last).max(envelope.sequence);
                            }
                            // Stream fragments do not change the progress
                            // message and a long answer has thousands.
                            if !matches!(
                                envelope.event,
                                notia_backend_core::BackendEvent::ThinkingSummary { .. }
                                    | notia_backend_core::BackendEvent::AssistantDelta { .. }
                            ) {
                                seen.push(envelope.event);
                            }
                        }
                        bot::progress_message(&seen)
                    };
                    let Some(message) = message.filter(|message| *message != shown) else {
                        continue;
                    };
                    shown = message.clone();
                    let current = message_id.lock().ok().and_then(|value| *value);
                    match current.filter(|_| edit) {
                        Some(id) => {
                            let _ = block_on(telegram::edit_message(&token, chat_id, id, &message, Vec::new(), Some("HTML")));
                        }
                        None => {
                            let sent = block_on(telegram::send_message(&token, chat_id, &message, Vec::new(), Some("HTML"))).ok();
                            if let Ok(mut value) = message_id.lock() {
                                *value = sent;
                            }
                        }
                    }
                }
            })
            .ok()
    }

    /// Leaves the progress message with the outcome `text` (HTML).
    fn finish(&self, text: &str) {
        let Some(id) = self.message_id.lock().ok().and_then(|value| *value).filter(|_| self.enabled && self.edit) else {
            return;
        };
        let _ = block_on(telegram::edit_message(&self.token, self.chat_id, id, text, Vec::new(), Some("HTML")));
    }
}

fn cancel_envelope(
    context: &BackendRequestContext,
    idempotency_key: &str,
    operation: Option<crate::backend::OperationToken>,
) -> BackendRequestEnvelope {
    BackendRequestEnvelope {
        protocol_version: ProtocolVersion::default(),
        request: BackendRequest::Cancel(crate::backend::CancelRequest {
            context: context.clone(),
            idempotency_key: idempotency_key.to_string(),
            request_id: context.request_id.clone(),
            operation,
        }),
    }
}

fn strip_html(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn audio_file_id(audio: &telegram::TelegramAudio) -> String {
    serde_json::to_value(audio)
        .ok()
        .and_then(|value| value.get("fileId").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default()
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn transcribe(app: &AppHandle, token: &str, audio: &telegram::TelegramAudio) -> Result<String, String> {
    let state = app.state::<crate::services::speech_service::SpeechRuntimeState>();
    if state.phase.lock().map_err(|_| "No se pudo consultar el estado de voz.".to_string())?.is_active() {
        return Err("El dictado local está usando el reconocedor de voz; reenviá el audio en unos segundos.".to_string());
    }
    let bytes = block_on(telegram::download_audio(token, audio))?;
    let recognizer = crate::services::speech_service::recognizer_cache(&state);
    let samples = crate::services::telegram_audio::decode_telegram_ogg_opus(bytes)?;
    crate::services::speech_service::transcribe_external_audio(app, &recognizer, &samples)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
fn transcribe(_app: &AppHandle, _token: &str, _audio: &telegram::TelegramAudio) -> Result<String, String> {
    Err("La transcripción de audios de Telegram no está disponible en esta plataforma.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_jobs_never_keep_the_request_text() {
        let job = StoredJob {
            request_id: "r".into(),
            chat_id: 1,
            telegram_user_id: 2,
            library_user_id: OWNER.into(),
            attachments: Vec::new(),
            attachment: None,
        };
        let text = serde_json::to_string(&WorkerFile { offset: 3, processed: VecDeque::from([1, 2]), jobs: vec![job] }).expect("json");
        assert!(!text.contains("text"));
        let restored: WorkerFile = serde_json::from_str(&text).expect("restore");
        assert_eq!((restored.offset, restored.jobs.len()), (3, 1));
    }

    #[test]
    fn a_queue_saved_by_an_older_version_keeps_its_file() {
        let saved = r#"{"offset":1,"jobs":[{"requestId":"r","chatId":1,"telegramUserId":2,"libraryUserId":"user-owner","attachment":{"kind":"pdf","value":{"fileId":"f","fileName":"resumen.pdf"}},"finance":true}]}"#;
        let mut file: WorkerFile = serde_json::from_str(saved).expect("older queue");
        file.jobs.iter_mut().for_each(StoredJob::adopt_legacy_attachment);
        let job = &file.jobs[0];
        assert!(job.attachment.is_none());
        assert!(matches!(job.attachments.as_slice(), [JobAttachment::Document(document)] if document.file_id == "f"));
        let text = serde_json::to_string(&file).expect("json");
        assert!(text.contains("\"attachments\":[{\"kind\":\"document\"") && !text.contains("\"attachment\":") && !text.contains("finance"));
    }

    #[test]
    fn html_fallback_keeps_the_words() {
        assert_eq!(strip_html("<b>Hola</b> &lt;x&gt; &amp; más"), "Hola <x> & más");
    }
}
