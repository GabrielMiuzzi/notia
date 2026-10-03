//! Meeting: the recording being made or just finished and what the person
//! does with it.
//!
//! A speech session started with Meeting options creates the record; the
//! speech service reports its confirmed lines, the processing and the
//! diarized transcript. The interface reads a snapshot and changes it with
//! the commands below; every change emits `meeting://changed`, except a new
//! line, which travels alone in `meeting://line` so a long meeting is not
//! read again line after line, and the live answers stream their text with
//! `meeting://answer`. The record lives in
//! memory until the person discards it, starts another recording or saves
//! it as a library note.
//!
//! On a client in Host mode the meeting is the device's own: it records,
//! recognizes and keeps the meeting here (a tablet in the room works even
//! without the network). Only what touches the host goes there: the note
//! and its export (`meeting_store_note`), the tasks (`meeting_store_tasks`)
//! and the AI (`meeting_ai_complete`), because the AI settings of the
//! library point to the host's provider.
//!
//! The AI of a recording (live answers and Notas IA) may consult the part
//! of the library the person chose when starting it: the passages that
//! match each request travel in its prompt. They are read where the library
//! is (this device, or the host for a client), once every
//! [`CORPUS_TTL`]. Notas IA rewrites its notes every
//! [`meeting_ai::NOTES_PASS_INTERVAL_MS`] while recording, once more when
//! the recording stops, and whenever the person calls the agent.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notia_backend_core::ai_settings::{AiSettings, AiSettingsInput};
use notia_backend_core::meeting::{
    self, MeetingFilter, MeetingInsightsRequest, MeetingMark, MeetingRecord, MeetingSegment,
    MeetingSnapshotDto, MeetingSourceFile, MeetingSources, MeetingStart, MeetingStatus, SavedMeetingNote,
};
use notia_backend_core::meeting_ai::{self, ContextCorpus, LibraryNote, MeetingAiContext, MeetingContextOptionsDto};
use notia_backend_core::RequestControl;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::backend::{BackendError, BackendErrorCode, ExportFormat};
use crate::dto::speech::{DiarizedTranscriptDto, MeetingSessionOptions};
use crate::host::{AppHandle, Emitter, Manager};
use crate::services::speech_audio::CaptureSources;

const CHANGED_EVENT: &str = "meeting://changed";
const ANSWER_EVENT: &str = "meeting://answer";
const LINE_EVENT: &str = "meeting://line";
/// Least time between two streamed updates of a live answer.
const ANSWER_EVENT_INTERVAL: Duration = Duration::from_millis(80);
const MAX_FOLDER_CHARS: usize = 200;
const MAX_NOTE_NAME_ATTEMPTS: usize = 50;
/// How long the library notes read for a meeting's AI are reused.
const CORPUS_TTL: Duration = Duration::from_secs(10 * 60);
/// Characters of the last lines a live answer looks up in the library,
/// besides its question.
const LIVE_ANSWER_QUERY_CHARS: usize = 600;
/// Time between two looks at the Notas IA schedule.
const NOTES_SCHEDULE_TICK: Duration = Duration::from_secs(1);

#[derive(Default)]
pub(crate) struct MeetingState {
    inner: Mutex<MeetingInner>,
    /// "Pasar por IA" is running.
    generating: AtomicBool,
    /// The library notes last read for a meeting's AI.
    corpus: Mutex<Option<CachedCorpus>>,
    /// One reading of the library at a time.
    corpus_build: Mutex<()>,
}

struct CachedCorpus {
    context: MeetingAiContext,
    read_at: Instant,
    corpus: Arc<ContextCorpus>,
}

#[derive(Default)]
struct MeetingInner {
    record: Option<MeetingRecord>,
    /// Provider preferences of the live answers and Notas IA.
    settings: Option<AiSettings>,
    /// The part of the library the meeting's AI consults.
    ai_context: Option<MeetingAiContext>,
    live: LiveAnswers,
}

#[derive(Default)]
struct LiveAnswers {
    /// Answer being generated and how to cancel it.
    running: Option<(String, RequestControl)>,
    /// Latest question asked while another answer was being generated.
    queued: Option<(String, u64)>,
}

impl LiveAnswers {
    fn cancel(&mut self) {
        if let Some((_, control)) = self.running.take() {
            control.cancel();
        }
        self.queued = None;
    }
}

/// A live answer ready to run on its own thread.
struct AnswerJob {
    meeting_id: String,
    answer_id: String,
    prompt: String,
    library: Option<LibraryLookup>,
    settings: AiSettings,
    control: RequestControl,
}

/// A notes pass ready to ask the AI.
struct NotesJob {
    meeting_id: String,
    prompt: String,
    library: Option<LibraryLookup>,
    settings: AiSettings,
}

/// What a request may read of the library and what to look up in it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryLookup {
    context: MeetingAiContext,
    query: String,
}

fn now_ms() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

fn state(app: &AppHandle) -> &MeetingState {
    app.state::<MeetingState>().inner()
}

fn lock(app: &AppHandle) -> Result<std::sync::MutexGuard<'_, MeetingInner>, BackendError> {
    state(app)
        .inner
        .lock()
        .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo acceder a la reunión.", true))
}

fn announce(app: &AppHandle, meeting_id: &str) {
    let _ = app.emit(CHANGED_EVENT, json!({ "meetingId": meeting_id }));
}

/// Whether this device is a client working on its host: the library and
/// the AI provider are the host's.
fn uses_host(app: &AppHandle) -> bool {
    crate::host_client::uses_host(app)
}

/// Which AI request of a meeting; the system prompt follows from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MeetingAiKind {
    Correction,
    Insights,
    LiveAnswer,
    Notes,
}

impl MeetingAiKind {
    fn system_prompt(self) -> &'static str {
        match self {
            Self::Correction => meeting::CORRECTION_SYSTEM_PROMPT,
            Self::Insights => meeting::INSIGHTS_SYSTEM_PROMPT,
            Self::LiveAnswer => meeting::LIVE_ANSWER_SYSTEM_PROMPT,
            Self::Notes => meeting_ai::NOTES_SYSTEM_PROMPT,
        }
    }

    /// Characters of library passages the request carries.
    fn library_budget(self) -> usize {
        match self {
            Self::LiveAnswer => meeting_ai::LIVE_ANSWER_LIBRARY_CHARS,
            Self::Notes => meeting_ai::NOTES_LIBRARY_CHARS,
            Self::Correction | Self::Insights => 0,
        }
    }
}

/// The notes of the library `context` admits, read once every
/// [`CORPUS_TTL`]. Hidden folders (`.agent`, `.notia`) stay out.
fn library_corpus(app: &AppHandle, context: &MeetingAiContext) -> Result<Arc<ContextCorpus>, BackendError> {
    let meeting_state = state(app);
    let cached = || {
        meeting_state.corpus.lock().ok().and_then(|cache| {
            cache
                .as_ref()
                .filter(|cached| cached.context == *context && cached.read_at.elapsed() < CORPUS_TTL)
                .map(|cached| cached.corpus.clone())
        })
    };
    if let Some(corpus) = cached() {
        return Ok(corpus);
    }
    let _building = meeting_state.corpus_build.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(corpus) = cached() {
        return Ok(corpus);
    }
    let notes = crate::library_graph::library_notes(app, &context.library_id)?
        .into_iter()
        .filter(|(path, tag, _)| {
            !path.split('/').any(|segment| segment.starts_with('.')) && context.admits(path, tag.as_deref())
        })
        .map(|(path, _, content)| LibraryNote { path, content })
        .collect();
    let corpus = Arc::new(ContextCorpus::new(notes));
    if let Ok(mut cache) = meeting_state.corpus.lock() {
        *cache = Some(CachedCorpus { context: context.clone(), read_at: Instant::now(), corpus: corpus.clone() });
    }
    Ok(corpus)
}

/// `prompt` with the library passages that match the lookup. Without the
/// library (unreadable, nothing matches) the request goes on with the
/// transcript alone.
fn with_library_passages(app: &AppHandle, kind: MeetingAiKind, prompt: &str, library: Option<&LibraryLookup>) -> String {
    let Some(lookup) = library.filter(|_| kind.library_budget() > 0) else {
        return prompt.to_string();
    };
    match library_corpus(app, &lookup.context) {
        Ok(corpus) => meeting_ai::with_library(prompt, corpus.passages(&lookup.query, kind.library_budget()).as_deref()),
        Err(error) => {
            log::warn!("[notia:meeting] the library context could not be read ({:?})", error.code);
            prompt.to_string()
        }
    }
}

/// Reads the library context in the background so the first request of the
/// recording does not wait for it.
fn warm_library_corpus(app: AppHandle, context: MeetingAiContext) {
    let spawned = std::thread::Builder::new().name("notia-meeting-library".to_string()).spawn(move || {
        if let Err(error) = library_corpus(&app, &context) {
            log::warn!("[notia:meeting] the library context could not be read ({:?})", error.code);
        }
    });
    if let Err(error) = spawned {
        log::warn!("[notia:meeting] library context thread not started: {error}");
    }
}

/// The provider preferences as they travel to the host.
fn settings_input(settings: &AiSettings) -> AiSettingsInput {
    AiSettingsInput {
        ollama_url: settings.ollama_url.clone(),
        api_key: settings.api_key.clone(),
        selected_model: settings.selected_model.clone(),
        thinking_enabled: settings.thinking_enabled,
        thinking_level: settings.thinking_level,
    }
}

/// Completes an AI request of a meeting, with the library passages of
/// `library`: on this device, or on the host for a client (its library and
/// provider are the host's).
fn complete_text(
    app: &AppHandle,
    settings: &AiSettings,
    kind: MeetingAiKind,
    prompt: &str,
    library: Option<&LibraryLookup>,
) -> Result<String, BackendError> {
    if uses_host(app) {
        return crate::host_client::call_host_blocking(
            app,
            "meeting_ai_complete",
            json!({ "payload": {
                "settings": settings_input(settings),
                "kind": kind,
                "prompt": prompt,
                "library": library,
            } }),
        );
    }
    let prompt = with_library_passages(app, kind, prompt, library);
    crate::ai_tasks::complete(app, settings, kind.system_prompt(), &prompt, Vec::new())
}

fn missing() -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, "La reunión ya no está disponible.", false)
}

/// Runs `change` on the record `meeting_id`.
fn with_record<T>(
    app: &AppHandle,
    meeting_id: &str,
    change: impl FnOnce(&mut MeetingRecord) -> Result<T, BackendError>,
) -> Result<T, BackendError> {
    let mut inner = lock(app)?;
    let record = inner.record.as_mut().filter(|record| record.id == meeting_id).ok_or_else(missing)?;
    change(record)
}

/// Labels of this moment in the device's time zone.
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
fn start_labels() -> MeetingStart {
    let now = chrono::Local::now();
    MeetingStart {
        date_label: now.format("%d/%m/%Y %H:%M").to_string(),
        file_stamp: now.format("%Y-%m-%d %H.%M").to_string(),
        unix_ms: now.timestamp_millis().max(0) as u64,
    }
}

// --- Hooks of the speech session ------------------------------------------

/// A Meeting session is starting: its record replaces the previous one.
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
pub(crate) fn begin(app: &AppHandle, session_id: &str, sources: CaptureSources, options: &MeetingSessionOptions) {
    let settings = options.settings.as_ref().map(AiSettingsInput::normalize);
    let Ok(mut inner) = lock(app) else { return };
    inner.live.cancel();
    let mut record = MeetingRecord::new(
        session_id,
        start_labels(),
        MeetingSources { microphone: sources.microphone, system: sources.system },
        options.live_answers && settings.is_some(),
    );
    record.set_ai_notes(options.ai_notes && settings.is_some(), now_ms());
    inner.record = Some(record);
    inner.settings = settings;
    inner.ai_context = options.ai_context.clone();
    drop(inner);
    announce(app, session_id);
    if let Some(context) = options.ai_context.clone().filter(|_| !uses_host(app)) {
        warm_library_corpus(app.clone(), context);
    }
    spawn_notes_schedule(app.clone(), session_id.to_string());
}

/// A meeting transcribed from `file`. It exists before the first line of
/// the file arrives and is processing from the start: there is nothing to
/// capture and no live answers.
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
pub(crate) fn begin_file(app: &AppHandle, session_id: &str, file: MeetingSourceFile) {
    let Ok(mut inner) = lock(app) else { return };
    inner.live.cancel();
    inner.record = Some(MeetingRecord::from_file(session_id, start_labels(), file));
    inner.settings = None;
    inner.ai_context = None;
    drop(inner);
    announce(app, session_id);
}

/// The recognizer confirmed `text`, spoken during `span` (ms of the recording).
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
pub(crate) fn on_line(app: &AppHandle, session_id: &str, span: Option<(u64, u64)>, text: &str) {
    if text.trim().is_empty() {
        return;
    }
    let job = {
        let Ok(mut guard) = lock(app) else { return };
        let inner = &mut *guard;
        let Some(record) = inner.record.as_mut().filter(|record| record.id == session_id) else { return };
        let (start_ms, end_ms) = span.unwrap_or((record.duration_ms, record.duration_ms));
        let Some(line) = record.push_line(start_ms, end_ms, text) else { return };
        let _ = app.emit(
            LINE_EVENT,
            json!({ "meetingId": session_id, "line": line, "durationMs": record.duration_ms }),
        );
        let question = (line.question && record.live_answers)
            .then(|| meeting::detect_questions(&line.text).pop())
            .flatten();
        match question {
            Some(question) => request_answer(inner, question, line.start_ms),
            None => None,
        }
    };
    // Only a new live answer changes something else than the lines.
    if let Some(job) = job {
        announce(app, session_id);
        spawn_answer(app.clone(), job);
    }
}

/// The recording stopped and its speakers are being separated.
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
pub(crate) fn on_processing(app: &AppHandle, session_id: &str, duration_ms: u64) {
    let changed = with_record(app, session_id, |record| {
        record.begin_processing(duration_ms);
        Ok(())
    });
    if changed.is_ok() {
        if let Ok(mut inner) = lock(app) {
            inner.live.queued = None;
        }
        announce(app, session_id);
    }
}

#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
pub(crate) fn on_completed(app: &AppHandle, session_id: &str, transcript: &DiarizedTranscriptDto, duration_ms: u64) {
    let segments = transcript
        .segments
        .iter()
        .map(|segment| MeetingSegment {
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            speaker_id: segment.speaker_id.clone(),
            text: segment.text.clone(),
        })
        .collect();
    if with_record(app, session_id, |record| {
        record.complete(segments, duration_ms);
        Ok(())
    })
    .is_ok()
    {
        announce(app, session_id);
    }
}

/// The session failed: what was recognized stays as the transcript.
#[cfg_attr(not(any(target_os = "windows", target_os = "android")), allow(dead_code))]
pub(crate) fn on_interrupted(app: &AppHandle, session_id: &str) {
    let changed = with_record(app, session_id, |record| {
        if record.status != MeetingStatus::Completed {
            let duration_ms = record.duration_ms;
            record.complete(Vec::new(), duration_ms);
        }
        Ok(())
    });
    if changed.is_ok() {
        announce(app, session_id);
    }
}

/// The session was cancelled or could not start: its record goes away.
pub(crate) fn discard_session(app: &AppHandle, session_id: &str) {
    let Ok(mut inner) = lock(app) else { return };
    if inner.record.as_ref().is_some_and(|record| record.id == session_id) {
        inner.live.cancel();
        inner.record = None;
        drop(inner);
        announce(app, session_id);
    }
}

// --- Live answers -----------------------------------------------------------

/// Starts answering `question` now, or queues it behind the running answer.
fn request_answer(inner: &mut MeetingInner, question: String, asked_at_ms: u64) -> Option<AnswerJob> {
    if inner.live.running.is_some() {
        inner.live.queued = Some((question, asked_at_ms));
        return None;
    }
    let settings = inner.settings.clone()?;
    let record = inner.record.as_mut()?;
    let answer_id = record.begin_answer(&question, asked_at_ms)?;
    let prompt = meeting::live_answer_prompt(&record.recent_context(), &question);
    let library = answer_lookup(inner.ai_context.as_ref(), record, &question);
    let control = crate::ai_tasks::task_control();
    inner.live.running = Some((answer_id.clone(), control.clone()));
    Some(AnswerJob { meeting_id: record.id.clone(), answer_id, prompt, library, settings, control })
}

/// What a live answer looks up in the library: its question and the last
/// words said.
fn answer_lookup(context: Option<&MeetingAiContext>, record: &MeetingRecord, question: &str) -> Option<LibraryLookup> {
    context.map(|context| LibraryLookup {
        context: context.clone(),
        query: format!("{question}\n{}", record.recent_lines(LIVE_ANSWER_QUERY_CHARS)),
    })
}

/// Runs `job` and then each question queued meanwhile, on one thread.
fn spawn_answer(app: AppHandle, job: AnswerJob) {
    let spawned = std::thread::Builder::new().name("notia-meeting-answer".to_string()).spawn(move || {
        let mut job = Some(job);
        while let Some(current) = job.take() {
            job = run_answer(&app, current);
        }
    });
    if let Err(error) = spawned {
        log::warn!("[notia:meeting] live answer thread not started: {error}");
    }
}

/// Streams one answer into the record; returns the queued question to
/// answer next.
fn run_answer(app: &AppHandle, job: AnswerJob) -> Option<AnswerJob> {
    let mut last_event = Instant::now() - ANSWER_EVENT_INTERVAL;
    let show = |text: &str| {
        let _ = with_record(app, &job.meeting_id, |record| {
            record.set_answer_text(&job.answer_id, text);
            Ok(())
        });
        let _ = app.emit(ANSWER_EVENT, json!({ "meetingId": job.meeting_id, "answerId": job.answer_id, "text": text }));
    };
    // A client asks its host, which answers at once instead of streaming.
    let result = if uses_host(app) {
        complete_text(app, &job.settings, MeetingAiKind::LiveAnswer, &job.prompt, job.library.as_ref())
            .inspect(|text| show(text))
    } else {
        let prompt = with_library_passages(app, MeetingAiKind::LiveAnswer, &job.prompt, job.library.as_ref());
        crate::ai_tasks::stream_complete(
            app,
            &job.settings,
            meeting::LIVE_ANSWER_SYSTEM_PROMPT,
            &prompt,
            &job.control,
            &mut |text| {
                if last_event.elapsed() >= ANSWER_EVENT_INTERVAL {
                    last_event = Instant::now();
                    show(text);
                }
            },
        )
    };
    let next = {
        let Ok(mut guard) = lock(app) else { return None };
        let inner = &mut *guard;
        if inner.live.running.as_ref().is_some_and(|(id, _)| *id == job.answer_id) {
            inner.live.running = None;
        }
        let record = inner.record.as_mut().filter(|record| record.id == job.meeting_id)?;
        record.finish_answer(&job.answer_id, result.map_err(|error| error.message));
        let queued = if record.live_answers { inner.live.queued.take() } else { None };
        queued.and_then(|(question, asked_at_ms)| request_answer(inner, question, asked_at_ms))
    };
    announce(app, &job.meeting_id);
    next
}

// --- Notas IA -----------------------------------------------------------------

/// Starts a notes pass of `meeting_id`: `manual` for "Llamar agente". `None`
/// when an automatic pass has nothing new to read.
fn begin_notes(app: &AppHandle, meeting_id: &str, manual: bool) -> Result<Option<NotesJob>, BackendError> {
    let job = {
        let mut guard = lock(app)?;
        let inner = &mut *guard;
        let record = inner.record.as_mut().filter(|record| record.id == meeting_id).ok_or_else(missing)?;
        let settings = inner
            .settings
            .clone()
            .ok_or_else(|| BackendError::invalid_input("Configurá la IA para usar Notas IA."))?;
        let Some(pass) = record.begin_notes_pass(manual)? else { return Ok(None) };
        let library = inner.ai_context.clone().map(|context| LibraryLookup { context, query: pass.query });
        NotesJob { meeting_id: meeting_id.to_string(), prompt: pass.prompt, library, settings }
    };
    announce(app, meeting_id);
    Ok(Some(job))
}

/// Asks the AI for the notes of `job` and keeps them; while recording, the
/// next automatic pass comes one interval later.
fn finish_notes(app: &AppHandle, job: NotesJob) {
    let answer = complete_text(app, &job.settings, MeetingAiKind::Notes, &job.prompt, job.library.as_ref())
        .map_err(|error| error.message);
    let finished = with_record(app, &job.meeting_id, |record| {
        let next = (record.status == MeetingStatus::Live).then(|| now_ms() + meeting_ai::NOTES_PASS_INTERVAL_MS);
        record.finish_notes_pass(answer, next);
        Ok(())
    });
    if finished.is_ok() {
        announce(app, &job.meeting_id);
    }
}

/// The automatic notes passes of the recording `meeting_id`, on their own
/// thread: each one when it is due, and a last one with what was said
/// since the previous pass when the recording stops.
fn spawn_notes_schedule(app: AppHandle, meeting_id: String) {
    let spawned = std::thread::Builder::new().name("notia-meeting-notes".to_string()).spawn(move || loop {
        std::thread::sleep(NOTES_SCHEDULE_TICK);
        let (live, due, enabled, running) = {
            let Ok(inner) = lock(&app) else { return };
            let Some(record) = inner.record.as_ref().filter(|record| record.id == meeting_id) else { return };
            let notes = &record.ai_notes;
            (record.status == MeetingStatus::Live, record.notes_pass_due(now_ms()), notes.enabled, notes.running)
        };
        if live {
            if !due {
                continue;
            }
            match begin_notes(&app, &meeting_id, false) {
                Ok(Some(job)) => finish_notes(&app, job),
                // Nothing new, or no AI: the next look is one interval later.
                started => {
                    if let Err(error) = started {
                        log::warn!("[notia:meeting] the automatic notes pass did not start ({:?})", error.code);
                    }
                    let postponed = with_record(&app, &meeting_id, |record| {
                        record.ai_notes.next_pass_at = Some(now_ms() + meeting_ai::NOTES_PASS_INTERVAL_MS);
                        Ok(())
                    });
                    if postponed.is_ok() {
                        announce(&app, &meeting_id);
                    }
                }
            }
            continue;
        }
        if !enabled {
            return;
        }
        // The pass the person called finishes before the last one.
        if running {
            continue;
        }
        if let Ok(Some(job)) = begin_notes(&app, &meeting_id, false) {
            finish_notes(&app, job);
        }
        return;
    });
    if let Err(error) = spawned {
        log::warn!("[notia:meeting] notes schedule thread not started: {error}");
    }
}

// --- Commands ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSnapshotPayload {
    /// The current meeting when missing.
    #[serde(default)]
    meeting_id: Option<String>,
    #[serde(default)]
    filter: MeetingFilter,
}

/// A meeting still recording or processing while no speech session runs
/// (a worker that ended without reporting it, such as a stop that failed)
/// keeps the lines it has and finishes, so the interface never shows a
/// recording that cannot be paused or finished. Every session that owns a
/// meeting keeps the speech phase away from idle until it has reported its
/// end.
fn settle_orphaned_record(app: &AppHandle, inner: &mut MeetingInner) {
    let Some(record) = inner.record.as_mut() else { return };
    if record.status == MeetingStatus::Completed {
        return;
    }
    let speech = app.state::<crate::services::speech_service::SpeechRuntimeState>();
    let idle = speech
        .phase
        .lock()
        .is_ok_and(|phase| *phase == crate::services::speech_service::SpeechPhase::Idle);
    if idle {
        log::error!("[notia:meeting] the recording's speech session ended without reporting it; the meeting keeps its lines");
        let duration_ms = record.duration_ms;
        record.complete(Vec::new(), duration_ms);
        inner.live.cancel();
    }
}

/// The current meeting, unfiltered, and when it started (ms since the
/// epoch); `None` without one.
pub(crate) fn current_meeting(app: &AppHandle) -> Option<(MeetingSnapshotDto, u64)> {
    let mut inner = lock(app).ok()?;
    settle_orphaned_record(app, &mut inner);
    inner.record.as_ref().map(|record| (record.snapshot(&MeetingFilter::default()), record.start.unix_ms))
}

/// The current meeting with its turns filtered; `None` without one.
pub(crate) fn meeting_snapshot(app: AppHandle, payload: MeetingSnapshotPayload) -> Result<Option<MeetingSnapshotDto>, BackendError> {
    let mut inner = lock(&app)?;
    settle_orphaned_record(&app, &mut inner);
    Ok(inner
        .record
        .as_ref()
        .filter(|record| payload.meeting_id.as_ref().is_none_or(|id| *id == record.id))
        .map(|record| record.snapshot(&payload.filter)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingIdPayload {
    meeting_id: String,
}

/// The transcript as the chat reads it (`[mm:ss] Nombre: texto` and the
/// notes), built when a question is sent instead of with every new line.
pub(crate) fn meeting_context(app: AppHandle, payload: MeetingIdPayload) -> Result<String, BackendError> {
    with_record(&app, &payload.meeting_id, |record| Ok(record.context_text()))
}

/// Forgets a finished meeting ("Nueva grabación").
pub(crate) fn meeting_discard(app: AppHandle, payload: MeetingIdPayload) -> Result<(), BackendError> {
    let mut inner = lock(&app)?;
    let record = inner.record.as_ref().filter(|record| record.id == payload.meeting_id).ok_or_else(missing)?;
    if record.status != MeetingStatus::Completed {
        return Err(BackendError::invalid_input("Finalizá o cancelá la grabación antes de empezar otra."));
    }
    inner.live.cancel();
    inner.record = None;
    drop(inner);
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingAddMarkPayload {
    meeting_id: String,
    /// What the person wants to remember; the last words said when missing.
    #[serde(default)]
    label: Option<String>,
    /// The moment the person started the mark (ms of the recording); now
    /// when missing. A later moment than now is now.
    #[serde(default)]
    at_ms: Option<u64>,
}

/// Marks a moment of the recording: the current one, or the one the person
/// started the mark at.
pub(crate) fn meeting_add_mark(app: AppHandle, payload: MeetingAddMarkPayload) -> Result<MeetingMark, BackendError> {
    let speech = app.state::<crate::services::speech_service::SpeechRuntimeState>();
    let position_ms = crate::services::speech_service::session_position_ms(&speech, &payload.meeting_id)
        .map_err(BackendError::invalid_input)?;
    let at_ms = payload.at_ms.map_or(position_ms, |at_ms| at_ms.min(position_ms));
    let mark = with_record(&app, &payload.meeting_id, |record| record.add_mark(at_ms, payload.label.as_deref()))?;
    announce(&app, &payload.meeting_id);
    Ok(mark)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingMarkPayload {
    meeting_id: String,
    mark_id: String,
}

pub(crate) fn meeting_remove_mark(app: AppHandle, payload: MeetingMarkPayload) -> Result<(), BackendError> {
    with_record(&app, &payload.meeting_id, |record| record.remove_mark(&payload.mark_id))?;
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingNotesPayload {
    meeting_id: String,
    notes: String,
}

pub(crate) fn meeting_set_notes(app: AppHandle, payload: MeetingNotesPayload) -> Result<(), BackendError> {
    with_record(&app, &payload.meeting_id, |record| record.set_notes(&payload.notes))?;
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingLiveAnswersPayload {
    meeting_id: String,
    enabled: bool,
    #[serde(default)]
    settings: Option<AiSettingsInput>,
}

/// Turns the live answers on or off; turning them off stops the running one.
pub(crate) fn meeting_set_live_answers(app: AppHandle, payload: MeetingLiveAnswersPayload) -> Result<(), BackendError> {
    let mut guard = lock(&app)?;
    let inner = &mut *guard;
    let settings = payload.settings.as_ref().map(AiSettingsInput::normalize);
    if payload.enabled && settings.is_none() {
        return Err(BackendError::invalid_input("Configurá la IA para usar las respuestas en vivo."));
    }
    let record = inner.record.as_mut().filter(|record| record.id == payload.meeting_id).ok_or_else(missing)?;
    record.live_answers = payload.enabled;
    if payload.enabled {
        inner.settings = settings;
    } else {
        inner.live.cancel();
    }
    drop(guard);
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingAiNotesPayload {
    meeting_id: String,
    enabled: bool,
    #[serde(default)]
    settings: Option<AiSettingsInput>,
}

/// Turns Notas IA on or off. The notes taken stay either way.
pub(crate) fn meeting_set_ai_notes(app: AppHandle, payload: MeetingAiNotesPayload) -> Result<(), BackendError> {
    let mut guard = lock(&app)?;
    let inner = &mut *guard;
    let settings = payload.settings.as_ref().map(AiSettingsInput::normalize);
    if payload.enabled && settings.is_none() {
        return Err(BackendError::invalid_input("Configurá la IA para usar Notas IA."));
    }
    let record = inner.record.as_mut().filter(|record| record.id == payload.meeting_id).ok_or_else(missing)?;
    if record.source_file.is_some() {
        return Err(BackendError::invalid_input("Notas IA acompaña las grabaciones, no los archivos subidos."));
    }
    record.set_ai_notes(payload.enabled, now_ms());
    if settings.is_some() {
        inner.settings = settings;
    }
    drop(guard);
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingCallNotesAgentPayload {
    meeting_id: String,
    #[serde(default)]
    settings: Option<AiSettingsInput>,
}

/// "Llamar agente": a notes pass now, with everything said so far. It runs
/// in the background; the snapshot says when it ends.
pub(crate) fn meeting_call_notes_agent(app: AppHandle, payload: MeetingCallNotesAgentPayload) -> Result<(), BackendError> {
    if let Some(settings) = &payload.settings {
        lock(&app)?.settings = Some(settings.normalize());
    }
    let job = begin_notes(&app, &payload.meeting_id, true)?
        .ok_or_else(|| BackendError::invalid_input("Todavía no hay nada transcripto para tomar notas."))?;
    let worker = app.clone();
    let spawned = std::thread::Builder::new()
        .name("notia-meeting-notes-call".to_string())
        .spawn(move || finish_notes(&worker, job));
    if let Err(error) = spawned {
        log::warn!("[notia:meeting] notes agent thread not started: {error}");
        let _ = with_record(&app, &payload.meeting_id, |record| {
            record.finish_notes_pass(Err("No se pudo llamar al agente. Probá de nuevo.".to_string()), None);
            Ok(())
        });
        announce(&app, &payload.meeting_id);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingContextOptionsPayload {
    library_id: String,
}

/// The folders and contexts the AI of a recording can be limited to. Runs
/// where the library is (the host for a client).
pub(crate) async fn meeting_ai_context_options(
    app: AppHandle,
    payload: MeetingContextOptionsPayload,
) -> Result<MeetingContextOptionsDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let (files, _) = crate::library_inventory::inventory_files(&app, &payload.library_id)?;
        let catalog = crate::library_graph::context_tags(&app, &payload.library_id);
        Ok(meeting_ai::context_options(&files, &catalog))
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron leer las carpetas y los contextos.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingRegenerateAnswerPayload {
    meeting_id: String,
    answer_id: String,
    /// Ask for a shorter version of the current answer.
    #[serde(default)]
    shorter: bool,
    settings: AiSettingsInput,
}

/// Generates a live answer again, or a shorter version of it.
pub(crate) fn meeting_regenerate_answer(app: AppHandle, payload: MeetingRegenerateAnswerPayload) -> Result<(), BackendError> {
    let job = {
        let mut guard = lock(&app)?;
        let inner = &mut *guard;
        if inner.live.running.is_some() {
            return Err(BackendError::invalid_input("Esperá a que termine la respuesta en curso."));
        }
        let record = inner.record.as_mut().filter(|record| record.id == payload.meeting_id).ok_or_else(missing)?;
        let (question, previous) = record.restart_answer(&payload.answer_id)?;
        let context = record.recent_context();
        let prompt = if payload.shorter && !previous.trim().is_empty() {
            meeting::shorter_answer_prompt(&context, &question, &previous)
        } else {
            meeting::live_answer_prompt(&context, &question)
        };
        let library = answer_lookup(inner.ai_context.as_ref(), record, &question);
        let control = crate::ai_tasks::task_control();
        inner.live.running = Some((payload.answer_id.clone(), control.clone()));
        AnswerJob {
            meeting_id: payload.meeting_id.clone(),
            answer_id: payload.answer_id,
            prompt,
            library,
            settings: payload.settings.normalize(),
            control,
        }
    };
    announce(&app, &payload.meeting_id);
    spawn_answer(app, job);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingPinAnswerPayload {
    meeting_id: String,
    answer_id: String,
    pinned: bool,
}

/// Keeps a live answer in the meeting note, or stops keeping it.
pub(crate) fn meeting_pin_answer(app: AppHandle, payload: MeetingPinAnswerPayload) -> Result<(), BackendError> {
    with_record(&app, &payload.meeting_id, |record| record.pin_answer(&payload.answer_id, payload.pinned))?;
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingRenameSpeakerPayload {
    meeting_id: String,
    speaker_id: String,
    name: String,
}

pub(crate) fn meeting_rename_speaker(app: AppHandle, payload: MeetingRenameSpeakerPayload) -> Result<(), BackendError> {
    with_record(&app, &payload.meeting_id, |record| record.rename_speaker(&payload.speaker_id, &payload.name))?;
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingMergeSpeakersPayload {
    meeting_id: String,
    source_id: String,
    target_id: String,
}

/// Gives every turn of one speaker to another.
pub(crate) fn meeting_merge_speakers(app: AppHandle, payload: MeetingMergeSpeakersPayload) -> Result<(), BackendError> {
    with_record(&app, &payload.meeting_id, |record| record.merge_speakers(&payload.source_id, &payload.target_id))?;
    announce(&app, &payload.meeting_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingInsightsPayload {
    meeting_id: String,
    settings: AiSettingsInput,
    request: MeetingInsightsRequest,
}

/// Clears the running flag of "Pasar por IA" however it ends.
struct GeneratingGuard<'a>(&'a AtomicBool);

impl Drop for GeneratingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// "Pasar por IA": corrects the transcript and produces the summary, the key
/// points and the tasks that were asked for.
pub(crate) async fn meeting_generate_insights(app: AppHandle, payload: MeetingInsightsPayload) -> Result<(), BackendError> {
    if payload.request.is_empty() {
        return Err(BackendError::invalid_input("Elegí qué generar con IA."));
    }
    crate::host::async_runtime::spawn_blocking(move || {
        let meeting_state = state(&app);
        if meeting_state.generating.swap(true, Ordering::AcqRel) {
            return Err(BackendError::invalid_input("La IA ya está trabajando sobre esta reunión."));
        }
        let _generating = GeneratingGuard(&meeting_state.generating);
        let settings = payload.settings.normalize();
        let request = payload.request;
        let record = with_record(&app, &payload.meeting_id, |record| {
            if record.status != MeetingStatus::Completed {
                return Err(BackendError::invalid_input("La reunión todavía no terminó de procesarse."));
            }
            Ok(record.clone())
        })?;
        if request.correct {
            let mut corrections = std::collections::HashMap::new();
            for batch in record.correction_batches() {
                let answer = complete_text(&app, &settings, MeetingAiKind::Correction, &batch.prompt, None)?;
                corrections.extend(meeting::parse_corrections(&answer, &batch));
            }
            with_record(&app, &payload.meeting_id, |record| {
                record.apply_corrections(&corrections);
                Ok(())
            })?;
            announce(&app, &payload.meeting_id);
        }
        if request.wants_insights() {
            let context = with_record(&app, &payload.meeting_id, |record| Ok(record.context_text()))?;
            let prompt = meeting::insights_prompt(&context, request)?;
            let answer = complete_text(&app, &settings, MeetingAiKind::Insights, &prompt, None)?;
            let parsed = meeting::parse_insights(&answer, request)?;
            with_record(&app, &payload.meeting_id, |record| {
                record.apply_insights(parsed);
                Ok(())
            })?;
            announce(&app, &payload.meeting_id);
        }
        Ok(())
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "La operación de IA se interrumpió.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSavePayload {
    meeting_id: String,
    library_id: String,
    /// Folder inside the library; the root when empty.
    #[serde(default)]
    folder: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSavedNoteDto {
    /// The note as the explorer shows it.
    path: String,
}

/// `Reuniones/Equipo` from what the person typed, rejecting anything that
/// could leave the library.
fn note_folder(folder: &str) -> Result<String, BackendError> {
    let folder = folder.trim().replace('\\', "/");
    let folder = folder.trim_matches('/');
    if folder.chars().count() > MAX_FOLDER_CHARS {
        return Err(BackendError::invalid_input("El nombre de la carpeta es demasiado largo."));
    }
    let valid = folder.is_empty()
        || folder.split('/').all(|segment| {
            let segment = segment.trim();
            !segment.is_empty() && segment != "." && segment != ".." && !segment.contains(['\0', ':'])
        });
    if !valid {
        return Err(BackendError::invalid_input("La carpeta para guardar la reunión no es válida."));
    }
    Ok(folder.split('/').map(str::trim).collect::<Vec<_>>().join("/"))
}

fn in_folder(folder: &str, name: &str) -> String {
    if folder.is_empty() { name.to_string() } else { format!("{folder}/{name}") }
}

/// The note saved before, to write over while it did not change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviousNote {
    logical_path: String,
    revision: String,
}

/// A meeting note written in the library, and its export when asked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredNote {
    logical_path: String,
    visible_path: String,
    revision: String,
    #[serde(default)]
    export_path: Option<String>,
}

/// Writes `content` as the meeting note in `folder` of the library, over
/// `previous` when it is still there and unchanged, or under a free name
/// from `file_name`, and exports it to `export` when asked. Runs where the
/// library is: this device, or the host for a client.
fn write_note_here(
    app: &AppHandle,
    library_id: &str,
    folder: &str,
    file_name: &str,
    content: &str,
    previous: Option<&PreviousNote>,
    export: Option<ExportFormat>,
) -> Result<StoredNote, BackendError> {
    let logical_path = crate::library_documents::with_documents(app, library_id, |documents| {
        if let Some(previous) = previous {
            let locator = documents.locator(&previous.logical_path)?;
            match documents.adapter.write_locator(&locator, content, Some(previous.revision.as_str())) {
                Ok(()) => return Ok(previous.logical_path.clone()),
                Err(error) if error.code == BackendErrorCode::NotFound => {}
                Err(error) if error.code == BackendErrorCode::Conflict => {
                    return Err(BackendError::new(
                        BackendErrorCode::Conflict,
                        "La nota de la reunión cambió desde que la guardaste. Guardala en otra carpeta o revisá la nota.",
                        false,
                    ))
                }
                Err(error) => return Err(error),
            }
        }
        for number in 1..=MAX_NOTE_NAME_ATTEMPTS {
            let path = in_folder(folder, &meeting::numbered_file_name(file_name, number));
            if documents.read(&path)?.is_none() {
                documents.write(&path, None, content)?;
                return Ok(path);
            }
        }
        Err(BackendError::invalid_input("Ya hay demasiadas notas de reunión con este nombre en la carpeta."))
    })?;
    let export_path = match export {
        Some(format) => {
            let receipt = crate::filesystem::adapter::export_library_document(
                app.state::<crate::library_registry::LibraryBindingRegistry>().inner(),
                app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>().inner(),
                library_id,
                &logical_path,
                format,
                &crate::device_preferences::page_geometry(app),
            )?;
            Some(crate::library_session::visible_path(app, library_id, &receipt.destination_logical_path))
        }
        None => None,
    };
    crate::library_session::reindex_in_background(app, library_id);
    Ok(StoredNote {
        visible_path: crate::library_session::visible_path(app, library_id, &logical_path),
        logical_path,
        revision: crate::filesystem::types::content_revision(content),
        export_path,
    })
}

/// Saves the meeting note (and its export), over the one saved before when
/// it is still in the same folder and unchanged.
fn save_note(
    app: &AppHandle,
    meeting_id: &str,
    library_id: &str,
    folder: &str,
    export: Option<ExportFormat>,
) -> Result<StoredNote, BackendError> {
    let folder = note_folder(folder)?;
    let record = with_record(app, meeting_id, |record| {
        if record.status != MeetingStatus::Completed {
            return Err(BackendError::invalid_input("La reunión todavía no terminó de procesarse."));
        }
        Ok(record.clone())
    })?;
    let body = record.note_markdown();
    let content = notia_backend_core::markdown_editing::ensure_markdown_defaults(&body, record.start.unix_ms).unwrap_or(body);
    let previous = record
        .saved_note
        .clone()
        .filter(|saved| saved.logical_path.rsplit_once('/').map_or("", |(parent, _)| parent) == folder)
        .map(|saved| PreviousNote { logical_path: saved.logical_path, revision: saved.revision });
    let file_name = record.note_file_name();
    let stored = if uses_host(app) {
        crate::host_client::call_host_blocking::<StoredNote>(
            app,
            "meeting_store_note",
            json!({ "payload": {
                "libraryId": library_id,
                "folder": folder,
                "fileName": file_name,
                "content": content,
                "previous": previous,
                "export": export,
            } }),
        )?
    } else {
        write_note_here(app, library_id, &folder, &file_name, &content, previous.as_ref(), export)?
    };
    with_record(app, meeting_id, |record| {
        record.saved_note = Some(SavedMeetingNote {
            logical_path: stored.logical_path.clone(),
            visible_path: stored.visible_path.clone(),
            revision: stored.revision.clone(),
        });
        Ok(())
    })?;
    announce(app, meeting_id);
    Ok(stored)
}

/// "Guardar como nota": the meeting as a Markdown note of the library.
pub(crate) async fn meeting_save_note(app: AppHandle, payload: MeetingSavePayload) -> Result<MeetingSavedNoteDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let stored = save_note(&app, &payload.meeting_id, &payload.library_id, &payload.folder, None)?;
        Ok(MeetingSavedNoteDto { path: stored.visible_path })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo guardar la reunión.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingExportPayload {
    meeting_id: String,
    library_id: String,
    #[serde(default)]
    folder: String,
    /// `pdf` or `docx`.
    format: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingExportDto {
    /// The exported file as the explorer shows it.
    path: String,
    /// The meeting note it was exported from.
    note_path: String,
}

/// Saves the meeting note and exports it next to it.
pub(crate) async fn meeting_export(app: AppHandle, payload: MeetingExportPayload) -> Result<MeetingExportDto, BackendError> {
    let format = match payload.format.trim().to_ascii_lowercase().as_str() {
        "pdf" => ExportFormat::Pdf,
        "docx" => ExportFormat::Docx,
        _ => return Err(BackendError::invalid_input("Formato de exportación no válido.")),
    };
    crate::host::async_runtime::spawn_blocking(move || {
        let stored = save_note(&app, &payload.meeting_id, &payload.library_id, &payload.folder, Some(format))?;
        Ok(MeetingExportDto {
            path: stored.export_path.unwrap_or_default(),
            note_path: stored.visible_path,
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo exportar la reunión.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingStoreNotePayload {
    library_id: String,
    folder: String,
    file_name: String,
    content: String,
    #[serde(default)]
    previous: Option<PreviousNote>,
    #[serde(default)]
    export: Option<ExportFormat>,
}

/// Writes in this host's library the note of a meeting a client recorded
/// and keeps on its device (and exports it when asked).
pub(crate) async fn meeting_store_note(app: AppHandle, payload: MeetingStoreNotePayload) -> Result<StoredNote, BackendError> {
    let folder = note_folder(&payload.folder)?;
    let file_name = payload.file_name.trim().to_string();
    if file_name.is_empty() || file_name.contains(['/', '\\']) || !file_name.to_ascii_lowercase().ends_with(".md") {
        return Err(BackendError::invalid_input("El nombre de la nota de la reunión no es válido."));
    }
    crate::host::async_runtime::spawn_blocking(move || {
        write_note_here(
            &app,
            &payload.library_id,
            &folder,
            &file_name,
            &payload.content,
            payload.previous.as_ref(),
            payload.export,
        )
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo guardar la reunión.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingAiCompletePayload {
    settings: AiSettingsInput,
    kind: MeetingAiKind,
    prompt: String,
    /// The library passages to add, read here.
    #[serde(default)]
    library: Option<LibraryLookup>,
}

/// Completes on this host an AI request of a meeting a client keeps on its
/// device: the library's AI settings point to this host's provider, and
/// the library context is read here.
pub(crate) async fn meeting_ai_complete(app: AppHandle, payload: MeetingAiCompletePayload) -> Result<String, BackendError> {
    let library = payload
        .library
        .map(|lookup| {
            Ok::<_, BackendError>(LibraryLookup { context: lookup.context.normalized()?, query: lookup.query })
        })
        .transpose()?;
    crate::host::async_runtime::spawn_blocking(move || {
        let prompt = with_library_passages(&app, payload.kind, &payload.prompt, library.as_ref());
        crate::ai_tasks::complete(&app, &payload.settings.normalize(), payload.kind.system_prompt(), &prompt, Vec::new())
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "La operación de IA se interrumpió.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingBoardsPayload {
    library_id: String,
}

/// Task Manager boards the tasks of a meeting can go to.
pub(crate) async fn meeting_task_boards(app: AppHandle, payload: MeetingBoardsPayload) -> Result<Vec<String>, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        crate::task_manager_commands::owner_board_names(&app, &payload.library_id)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron leer los tableros.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSendTasksPayload {
    meeting_id: String,
    library_id: String,
    board: String,
    task_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingSentTasksDto {
    created: usize,
}

/// Creates the chosen meeting tasks, not sent before, in a Task Manager board.
pub(crate) async fn meeting_send_tasks(app: AppHandle, payload: MeetingSendTasksPayload) -> Result<MeetingSentTasksDto, BackendError> {
    if payload.board.trim().is_empty() {
        return Err(BackendError::invalid_input("Elegí un tablero del Task Manager."));
    }
    crate::host::async_runtime::spawn_blocking(move || {
        let pending = with_record(&app, &payload.meeting_id, |record| Ok(record.pending_tasks(&payload.task_ids)))?;
        if pending.is_empty() {
            return Err(BackendError::invalid_input("No hay tareas nuevas para enviar."));
        }
        let tasks = pending.iter().map(|task| (task.title.clone(), task.detail.clone())).collect::<Vec<_>>();
        let created = if uses_host(&app) {
            crate::host_client::call_host_blocking::<usize>(
                &app,
                "meeting_store_tasks",
                json!({ "payload": { "libraryId": payload.library_id, "board": payload.board, "tasks": tasks } }),
            )?
        } else {
            crate::task_manager_commands::create_owner_tasks(&app, &payload.library_id, &payload.board, &tasks)?
        };
        let sent = pending.into_iter().map(|task| task.id).collect::<Vec<_>>();
        with_record(&app, &payload.meeting_id, |record| {
            record.mark_tasks_sent(&sent);
            Ok(())
        })?;
        announce(&app, &payload.meeting_id);
        Ok(MeetingSentTasksDto { created })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron crear las tareas.", true))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingStoreTasksPayload {
    library_id: String,
    board: String,
    /// Title and detail of each task.
    tasks: Vec<(String, String)>,
}

/// Creates in this host's Task Manager the tasks of a meeting a client
/// keeps on its device. Returns how many it created.
pub(crate) async fn meeting_store_tasks(app: AppHandle, payload: MeetingStoreTasksPayload) -> Result<usize, BackendError> {
    if payload.board.trim().is_empty() || payload.tasks.is_empty() {
        return Err(BackendError::invalid_input("Elegí un tablero y al menos una tarea."));
    }
    crate::host::async_runtime::spawn_blocking(move || {
        crate::task_manager_commands::create_owner_tasks(&app, &payload.library_id, &payload.board, &payload.tasks)
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudieron crear las tareas.", true))?
}

#[cfg(test)]
mod tests {
    use super::note_folder;

    #[test]
    fn note_folders_stay_inside_the_library() {
        assert_eq!(note_folder(" /Reuniones\\Equipo/ ").unwrap(), "Reuniones/Equipo");
        assert_eq!(note_folder("").unwrap(), "");
        assert!(note_folder("../fuera").is_err());
        assert!(note_folder("a//b").is_err());
        assert!(note_folder("C:/Windows").is_err());
    }
}
