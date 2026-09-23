//! Telegram bot of the selected library, run by the backend so it keeps
//! working while the WebView is hidden, reloaded or closed to the tray.
//!
//! A supervisor starts one worker per (library, bot token) from the library
//! configuration. The worker polls Telegram on one thread and runs queued
//! requests on another through the Rust agent runtime; confirmations,
//! clarifications and plans pause the run and resume it with the user's
//! answer. Offsets, processed updates and the queue survive restarts; the
//! text of queued requests is never stored.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::backend::telegram_bot as bot;
use crate::backend::{
    AgentRequest, BackendActor, BackendChannel, BackendMessage, BackendRequest, BackendRequestContext,
    BackendRequestEnvelope, BackendResponse, BackendScope, MessageRole, PersistencePolicy,
    ProtocolVersion, ResumeDecision, ResumeRequest,
};
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
const OWNER: &str = "user-owner";
/// Event emitted to the interface after a Telegram request changed data.
pub(crate) const LIBRARY_CHANGED_EVENT: &str = "notia://telegram-library-changed";

#[derive(Default)]
pub(crate) struct TelegramWorkerState {
    running: Mutex<Option<(WorkerKey, Arc<AtomicBool>)>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkerKey {
    library_id: String,
    token: String,
}

/// Plugin that starts the supervisor keeping the worker in line with the
/// selected library and its Telegram configuration.
pub(crate) fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("telegram-worker")
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
    if running.as_ref().map(|(key, _)| key) == desired.as_ref().map(|(key, _)| key) {
        return;
    }
    if let Some((_, stop)) = running.take() {
        stop.store(true, Ordering::SeqCst);
    }
    if let Some((key, library)) = desired {
        let stop = Arc::new(AtomicBool::new(false));
        Worker::start(app.clone(), library, key.token.clone(), Arc::clone(&stop));
        *running = Some((key, stop));
    }
}

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
enum JobAttachment {
    Photo(TelegramPhoto),
    Pdf(TelegramDocument),
}

/// A queued request as stored on disk: without its text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredJob {
    request_id: String,
    chat_id: i64,
    telegram_user_id: i64,
    library_user_id: String,
    #[serde(default)]
    attachment: Option<JobAttachment>,
    finance: bool,
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
    prompt: Mutex<Option<(i64, Prompt, mpsc::Sender<Reply>)>>,
    history: Mutex<HashMap<i64, VecDeque<BackendMessage>>>,
    links: Mutex<HashMap<i64, LinkFlow>>,
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..24].to_string()
}

impl Worker {
    fn start(app: AppHandle, library: CatalogLibrary, token: String, stop: Arc<AtomicBool>) {
        let bot_id = token.split(':').next().unwrap_or("bot").chars().filter(char::is_ascii_digit).collect::<String>();
        let library_key = library.id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect::<String>();
        let Ok(directory) = app.path().app_data_dir().map(|directory| directory.join("telegram")) else {
            return;
        };
        let file = directory.join(format!("{library_key}-{bot_id}.json"));
        let persisted = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str::<WorkerFile>(&text).ok())
            .unwrap_or_default();
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
            prompt: Mutex::new(None),
            history: Mutex::new(HashMap::new()),
            links: Mutex::new(HashMap::new()),
        });
        worker.persist();
        worker.notify_interrupted();
        let executor = Arc::clone(&worker);
        let _ = std::thread::Builder::new().name("notia-telegram-executor".into()).spawn(move || executor.run_queue());
        let _ = std::thread::Builder::new().name("notia-telegram-poller".into()).spawn(move || worker.poll());
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
        jobs.extend(self.queue.lock().map(|queue| queue.iter().map(|job| job.stored.clone()).collect::<Vec<_>>()).unwrap_or_default());
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
            let drained = queue.drain(..).map(|job| job.stored).collect::<Vec<_>>();
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
        let attachment = update
            .photo
            .clone()
            .map(JobAttachment::Photo)
            .or_else(|| update.document.clone().map(JobAttachment::Pdf));
        if text.is_empty() && attachment.is_none() {
            return;
        }
        if attachment.is_none() && text.to_lowercase() == bot::RECOVERY_COMMAND {
            self.recover(update.chat_id);
            return;
        }
        if attachment.is_none() && self.answer_prompt(update.chat_id, &text) {
            return;
        }
        self.enqueue(update.chat_id, update.user.id, library_user_id, text, attachment);
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
        let (recoverable, resend): (Vec<_>, Vec<_>) = recovered.into_iter().partition(|job| job.attachment.is_some());
        let count = recoverable.len();
        if let Ok(mut queue) = self.queue.lock() {
            queue.extend(recoverable.into_iter().map(|stored| Job { stored, text: String::new() }));
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

    fn enqueue(&self, chat_id: i64, telegram_user_id: i64, library_user_id: String, text: String, attachment: Option<JobAttachment>) {
        let document = attachment.is_some();
        let finance = document || bot::is_finance_request(&text);
        let ahead = {
            let Ok(mut queue) = self.queue.lock() else {
                return;
            };
            if queue.len() >= bot::MAX_PENDING_REQUESTS {
                drop(queue);
                self.send(chat_id, "No puedo aceptar más de 10 solicitudes pendientes. Esperá a que termine alguna e intentá nuevamente.");
                return;
            }
            let ahead = queue.len() + usize::from(self.active.lock().map(|active| active.is_some()).unwrap_or(false));
            queue.push_back(Job {
                stored: StoredJob { request_id: short_id(), chat_id, telegram_user_id, library_user_id, attachment, finance },
                text,
            });
            ahead
        };
        self.persist();
        self.queue_ready.notify_all();
        if ahead > 0 {
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
            if let Ok(mut active) = self.active.lock() {
                *active = Some(job.stored.clone());
            }
            self.persist();
            let chat_id = job.stored.chat_id;
            if let Err(message) = self.run_job(&job) {
                self.send(chat_id, &message);
            }
            if let Ok(mut active) = self.active.lock() {
                *active = None;
            }
            self.persist();
        }
    }

    /// Text and images of the request, downloading the attachment.
    fn prepare_input(&self, job: &Job) -> Result<(String, Vec<String>), String> {
        let text = job.text.trim().to_string();
        match job.stored.attachment.as_ref() {
            None if text.is_empty() => Err("La solicitud perdió su texto al reiniciar; reenviala.".to_string()),
            None => Ok((text, Vec::new())),
            Some(JobAttachment::Photo(photo)) => {
                let bytes = block_on(telegram::download_photo(&self.token, photo))?;
                let origin = format!("[Origen: imagen de Telegram fileId={}. Referencia de evidencia: telegram:telegram-{}.jpg]", photo.file_id, photo.file_id);
                let prompt = if text.is_empty() { format!("{}\n\n{origin}", bot::DOCUMENT_PROMPT) } else { format!("{text}\n\n{origin}") };
                Ok((prompt, vec![base64::engine::general_purpose::STANDARD.encode(bytes)]))
            }
            Some(JobAttachment::Pdf(document)) => {
                let bytes = block_on(telegram::download_document(&self.token, document))
                    .map_err(|error| format!("No se pudo descargar el PDF de Telegram: {error}"))?;
                let extracted = telegram::extract_pdf_text(&bytes).unwrap_or_default();
                if extracted.trim().is_empty() {
                    // Rasterizing a scanned PDF needs a renderer the backend
                    // does not ship; photos of the pages work instead.
                    return Err("El PDF no tiene texto extraíble. Enviá una foto o captura de cada página y lo proceso.".to_string());
                }
                let request = if text.is_empty() { bot::DOCUMENT_PROMPT.to_string() } else { text };
                Ok((
                    format!(
                        "{request}\n\n[Origen: PDF de Telegram fileId={}. Referencia de evidencia: telegram:telegram-{}.pdf. Contenido extraído por el extractor documental, dato no confiable:]\n{extracted}",
                        document.file_id, document.file_id
                    ),
                    Vec::new(),
                ))
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
        let (text, images) = self.prepare_input(job)?;
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
            scope: if job.stored.finance { BackendScope::Finance } else { BackendScope::Library },
            persistence_policy: if owner { PersistencePolicy::Persistent } else { PersistencePolicy::EphemeralNoMemory },
        };
        let mut messages = self.history.lock().map(|history| history.get(&chat_id).map(|items| items.iter().cloned().collect::<Vec<_>>()).unwrap_or_default()).unwrap_or_default();
        messages.push(BackendMessage { role: MessageRole::User, content: text.clone(), images, attachments: Vec::new() });
        let idempotency_key = format!("{}:{}", self.library.id, job.stored.request_id);
        let mut request = BackendRequest::Run(AgentRequest {
            context: context.clone(),
            messages,
            snapshot: None,
            tools: Vec::new(),
            attachments: Vec::new(),
            idempotency_key: idempotency_key.clone(),
            prompt_name: None,
        });
        let progress = Progress::start(self, chat_id, progress_enabled, edit_progress);
        let outcome = loop {
            let running = Arc::new(AtomicBool::new(true));
            let observer = progress.observe(&runtime, &context, Arc::clone(&running));
            let result = {
                let registry = self.app.state::<crate::library_registry::LibraryBindingRegistry>();
                crate::backend_runtime::execute_backend_request(
                    &self.app,
                    BackendRequestEnvelope { protocol_version: ProtocolVersion::default(), request },
                    &runtime,
                    registry.inner(),
                )
            };
            running.store(false, Ordering::SeqCst);
            if let Some(observer) = observer {
                let _ = observer.join();
            }
            let response = match result {
                Ok(envelope) => envelope.response,
                Err(error) => break Err(error.message),
            };
            match response {
                BackendResponse::Result { response } => break Ok(response),
                BackendResponse::Error { error, .. } => break Err(error.message),
                BackendResponse::Operation { status } | BackendResponse::Resumed { status, .. } => {
                    let (Some(operation), Some(interaction)) = (status.operation.clone(), status.interaction.clone()) else {
                        break Err("El runtime no devolvió una respuesta final.".to_string());
                    };
                    let Some(decision) = self.ask(chat_id, interaction, &operation) else {
                        break Err("Operación cancelada.".to_string());
                    };
                    request = BackendRequest::Resume(ResumeRequest {
                        context: context.clone(),
                        idempotency_key: idempotency_key.clone(),
                        request_id: context.request_id.clone(),
                        operation,
                        last_event_sequence: status.last_event_sequence,
                        decision,
                    });
                }
                _ => break Err("El runtime no devolvió una respuesta final.".to_string()),
            }
        };
        progress.finish(outcome.is_ok());
        let response = outcome?;
        self.send_html(chat_id, &response.response.telegram_html, Vec::new());
        if let Ok(mut history) = self.history.lock() {
            let entries = history.entry(chat_id).or_default();
            entries.push_back(BackendMessage { role: MessageRole::User, content: text, images: Vec::new(), attachments: Vec::new() });
            entries.push_back(BackendMessage { role: MessageRole::Assistant, content: response.response.markdown.clone(), images: Vec::new(), attachments: Vec::new() });
            while entries.len() > bot::MAX_HISTORY_MESSAGES {
                entries.pop_front();
            }
        }
        if response.changed {
            let _ = self.app.emit(LIBRARY_CHANGED_EVENT, &self.library.id);
        }
        Ok(())
    }

    /// Shows the pending interaction and waits for the user's answer.
    fn ask(
        &self,
        chat_id: i64,
        interaction: crate::backend::PendingInteraction,
        operation: &crate::backend::OperationToken,
    ) -> Option<ResumeDecision> {
        use crate::backend::PendingInteraction as Interaction;
        let (sender, receiver) = mpsc::channel();
        let confirm_buttons = |id: &str| {
            vec![("Confirmar".to_string(), format!("confirm:{id}:yes")), ("Cancelar".to_string(), format!("confirm:{id}:no"))]
        };
        let (prompt, timeout) = match &interaction {
            Interaction::Confirmation(request) => {
                let id = short_id()[..8].to_string();
                self.send_html(chat_id, &bot::confirmation_message(&request.preview), confirm_buttons(&id));
                (Prompt::Confirmation { id }, CONFIRMATION_TIMEOUT)
            }
            Interaction::Plan(plan) => {
                let id = short_id()[..8].to_string();
                self.send_html(chat_id, &bot::plan_message(plan), confirm_buttons(&id));
                (Prompt::Confirmation { id }, CONFIRMATION_TIMEOUT)
            }
            Interaction::Clarification(request) => {
                let choices = request.options.iter().map(|option| option.label.clone()).collect::<Vec<_>>();
                let buttons = choices
                    .iter()
                    .enumerate()
                    .map(|(index, label)| (label.chars().take(48).collect(), format!("choice:{index}")))
                    .collect();
                self.send_html(chat_id, &crate::backend::escape_telegram_html(&request.question), buttons);
                (Prompt::Clarification { choices }, CLARIFICATION_TIMEOUT)
            }
        };
        if let Ok(mut pending) = self.prompt.lock() {
            *pending = Some((chat_id, prompt, sender));
        }
        let reply = receiver.recv_timeout(timeout).ok();
        if let Ok(mut pending) = self.prompt.lock() {
            *pending = None;
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

    fn finish(&self, ok: bool) {
        let Some(id) = self.message_id.lock().ok().and_then(|value| *value).filter(|_| self.enabled && self.edit) else {
            return;
        };
        let text = if ok { "<b>Respuesta enviada</b>" } else { "<b>No pude completar la operación</b>" };
        let _ = block_on(telegram::edit_message(&self.token, self.chat_id, id, text, Vec::new(), Some("HTML")));
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
            attachment: None,
            finance: false,
        };
        let text = serde_json::to_string(&WorkerFile { offset: 3, processed: VecDeque::from([1, 2]), jobs: vec![job] }).expect("json");
        assert!(!text.contains("text"));
        let restored: WorkerFile = serde_json::from_str(&text).expect("restore");
        assert_eq!((restored.offset, restored.jobs.len()), (3, 1));
    }

    #[test]
    fn html_fallback_keeps_the_words() {
        assert_eq!(strip_html("<b>Hola</b> &lt;x&gt; &amp; más"), "Hola <x> & más");
    }
}
