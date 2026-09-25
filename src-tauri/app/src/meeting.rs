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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notia_backend_core::ai_settings::{AiSettings, AiSettingsInput};
use notia_backend_core::meeting::{
    self, MeetingFilter, MeetingInsightsRequest, MeetingMark, MeetingRecord, MeetingSegment,
    MeetingSnapshotDto, MeetingSources, MeetingStart, MeetingStatus, SavedMeetingNote,
};
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

#[derive(Default)]
pub(crate) struct MeetingState {
    inner: Mutex<MeetingInner>,
    /// "Pasar por IA" is running.
    generating: AtomicBool,
}

#[derive(Default)]
struct MeetingInner {
    record: Option<MeetingRecord>,
    live: LiveAnswers,
}

#[derive(Default)]
struct LiveAnswers {
    settings: Option<AiSettings>,
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
    settings: AiSettings,
    control: RequestControl,
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
    inner.record = Some(MeetingRecord::new(
        session_id,
        start_labels(),
        MeetingSources { microphone: sources.microphone, system: sources.system },
        options.live_answers && settings.is_some(),
    ));
    inner.live.settings = settings;
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
    let settings = inner.live.settings.clone()?;
    let record = inner.record.as_mut()?;
    let answer_id = record.begin_answer(&question, asked_at_ms)?;
    let prompt = meeting::live_answer_prompt(&record.recent_context(), &question);
    let control = crate::ai_tasks::task_control();
    inner.live.running = Some((answer_id.clone(), control.clone()));
    Some(AnswerJob { meeting_id: record.id.clone(), answer_id, prompt, settings, control })
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
    let result = crate::ai_tasks::stream_complete(
        app,
        &job.settings,
        meeting::LIVE_ANSWER_SYSTEM_PROMPT,
        &job.prompt,
        &job.control,
        &mut |text| {
            if last_event.elapsed() < ANSWER_EVENT_INTERVAL {
                return;
            }
            last_event = Instant::now();
            let _ = with_record(app, &job.meeting_id, |record| {
                record.set_answer_text(&job.answer_id, text);
                Ok(())
            });
            let _ = app.emit(
                ANSWER_EVENT,
                json!({ "meetingId": job.meeting_id, "answerId": job.answer_id, "text": text }),
            );
        },
    );
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

/// The current meeting with its turns filtered; `None` without one.
pub(crate) fn meeting_snapshot(app: AppHandle, payload: MeetingSnapshotPayload) -> Result<Option<MeetingSnapshotDto>, BackendError> {
    let inner = lock(&app)?;
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

/// Marks the current moment of the recording.
pub(crate) fn meeting_add_mark(app: AppHandle, payload: MeetingIdPayload) -> Result<MeetingMark, BackendError> {
    let speech = app.state::<crate::services::speech_service::SpeechRuntimeState>();
    let at_ms = crate::services::speech_service::session_position_ms(&speech, &payload.meeting_id)
        .map_err(BackendError::invalid_input)?;
    let mark = with_record(&app, &payload.meeting_id, |record| record.add_mark(at_ms))?;
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
        inner.live.settings = settings;
    } else {
        inner.live.cancel();
    }
    drop(guard);
    announce(&app, &payload.meeting_id);
    Ok(())
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
        let control = crate::ai_tasks::task_control();
        inner.live.running = Some((payload.answer_id.clone(), control.clone()));
        AnswerJob {
            meeting_id: payload.meeting_id.clone(),
            answer_id: payload.answer_id,
            prompt,
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
                let answer = crate::ai_tasks::complete(&app, &settings, meeting::CORRECTION_SYSTEM_PROMPT, &batch.prompt, Vec::new())?;
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
            let answer = crate::ai_tasks::complete(&app, &settings, meeting::INSIGHTS_SYSTEM_PROMPT, &prompt, Vec::new())?;
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

/// Writes the meeting note, over the one saved before when it is still in
/// the same folder and unchanged. Returns its logical path.
fn save_note(app: &AppHandle, meeting_id: &str, library_id: &str, folder: &str) -> Result<String, BackendError> {
    let folder = note_folder(folder)?;
    let record = with_record(app, meeting_id, |record| {
        if record.status != MeetingStatus::Completed {
            return Err(BackendError::invalid_input("La reunión todavía no terminó de procesarse."));
        }
        Ok(record.clone())
    })?;
    let body = record.note_markdown();
    let content = notia_backend_core::markdown_editing::ensure_markdown_defaults(&body, record.start.unix_ms).unwrap_or(body);
    let previous = record.saved_note.clone().filter(|saved| {
        saved.logical_path.rsplit_once('/').map_or("", |(parent, _)| parent) == folder
    });
    let logical_path = crate::library_documents::with_documents(app, library_id, |documents| {
        if let Some(previous) = &previous {
            let locator = documents.locator(&previous.logical_path)?;
            match documents.adapter.write_locator(&locator, &content, Some(previous.revision.as_str())) {
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
        let file_name = record.note_file_name();
        for number in 1..=MAX_NOTE_NAME_ATTEMPTS {
            let path = in_folder(&folder, &meeting::numbered_file_name(&file_name, number));
            if documents.read(&path)?.is_none() {
                documents.write(&path, None, &content)?;
                return Ok(path);
            }
        }
        Err(BackendError::invalid_input("Ya hay demasiadas notas de reunión con este nombre en la carpeta."))
    })?;
    with_record(app, meeting_id, |record| {
        record.saved_note = Some(SavedMeetingNote {
            logical_path: logical_path.clone(),
            visible_path: crate::library_session::visible_path(app, library_id, &logical_path),
            revision: crate::filesystem::types::content_revision(&content),
        });
        Ok(())
    })?;
    crate::library_session::reindex_in_background(app, library_id);
    announce(app, meeting_id);
    Ok(logical_path)
}

/// "Guardar como nota": the meeting as a Markdown note of the library.
pub(crate) async fn meeting_save_note(app: AppHandle, payload: MeetingSavePayload) -> Result<MeetingSavedNoteDto, BackendError> {
    crate::host::async_runtime::spawn_blocking(move || {
        let logical_path = save_note(&app, &payload.meeting_id, &payload.library_id, &payload.folder)?;
        Ok(MeetingSavedNoteDto { path: crate::library_session::visible_path(&app, &payload.library_id, &logical_path) })
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
        let note = save_note(&app, &payload.meeting_id, &payload.library_id, &payload.folder)?;
        let receipt = crate::filesystem::adapter::export_library_document(
            app.state::<crate::library_registry::LibraryBindingRegistry>().inner(),
            app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>().inner(),
            &payload.library_id,
            &note,
            format,
            &crate::device_preferences::page_geometry(&app),
        )?;
        crate::library_session::reindex_in_background(&app, &payload.library_id);
        Ok(MeetingExportDto {
            path: crate::library_session::visible_path(&app, &payload.library_id, &receipt.destination_logical_path),
            note_path: crate::library_session::visible_path(&app, &payload.library_id, &note),
        })
    })
    .await
    .map_err(|_| BackendError::new(BackendErrorCode::Internal, "No se pudo exportar la reunión.", true))?
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
        let created = crate::task_manager_commands::create_owner_tasks(&app, &payload.library_id, &payload.board, &tasks)?;
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
