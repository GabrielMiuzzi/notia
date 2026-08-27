use crate::dto::speech::{
    DiarizedTranscriptDto, SpeechCapabilitiesDto, SpeechErrorDto, SpeechModelStatusDto,
    SpeechPartialEventDto, SpeechSegmentsEventDto, SpeechSessionEventDto, SpeechSessionStateDto,
    SpeechTranscriptSegmentDto,
};
use std::sync::Mutex;
#[cfg(any(target_os = "windows", target_os = "android"))]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex as StdMutex,
};
#[cfg(any(target_os = "windows", target_os = "android"))]
use std::time::Instant;
#[cfg(any(target_os = "windows", target_os = "android"))]
use tauri::{AppHandle, Emitter, Manager};

pub const MAX_SPEECH_SESSION_SECONDS: u32 = 900;
#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) type PreloadedRecognizer =
    Arc<StdMutex<Option<crate::services::qwen3_asr_service::Qwen3AsrRecognizer>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpeechPhase {
    Idle,
    Preparing,
    Recording,
    Paused,
    Finalizing,
}

const ACTIVE_SPEECH_PHASES: [SpeechPhase; 3] = [
    SpeechPhase::Recording,
    SpeechPhase::Paused,
    SpeechPhase::Finalizing,
];

pub struct SpeechRuntimeState {
    pub phase: Mutex<SpeechPhase>,
    #[cfg(any(target_os = "windows", target_os = "android"))]
    active_session: Mutex<Option<ActivePlatformSpeechSession>>,
    #[cfg(any(target_os = "windows", target_os = "android"))]
    preloaded_recognizer: PreloadedRecognizer,
    #[cfg(any(target_os = "windows", target_os = "android"))]
    preload_started: AtomicBool,
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn recognizer_cache(state: &SpeechRuntimeState) -> PreloadedRecognizer {
    Arc::clone(&state.preloaded_recognizer)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn transcribe_external_audio(
    app: &AppHandle,
    cache: &PreloadedRecognizer,
    samples: &[f32],
) -> Result<String, String> {
    use crate::services::speech_worker::StreamingRecognizer;

    let mut recognizer = match cache
        .lock()
        .map_err(|_| "No se pudo acceder al modelo precargado.".to_string())?
        .take()
    {
        Some(recognizer)
            if recognizer.matches(
                &crate::services::speech_model_repository::resolve_qwen3_asr_model(
                    app, "0.6b", "es", "cpu",
                )?,
            ) =>
        {
            recognizer
        }
        Some(_) | None => {
            let model = crate::services::speech_model_repository::resolve_qwen3_asr_model(
                app, "0.6b", "es", "cpu",
            )?;
            crate::services::qwen3_asr_service::Qwen3AsrRecognizer::load(app, &model)?
        }
    };
    let result = (|| {
        let mut text = String::new();
        for chunk in samples.chunks(3_200) {
            let update = recognizer.accept_waveform(chunk)?;
            if commit_external_update(&mut text, &update, false) {
                recognizer.reset_after_endpoint()?;
            }
        }
        let final_update = recognizer.finish()?;
        commit_external_update(&mut text, &final_update, true);
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err("No se detecto voz en el audio de Telegram.".to_string());
        }
        Ok(text)
    })();
    let reset_result = recognizer.reset_session();
    if reset_result.is_ok() {
        if let Ok(mut slot) = cache.lock() {
            *slot = Some(recognizer);
        }
    }
    reset_result?;
    result
}

fn commit_external_update(
    target: &mut String,
    update: &crate::services::speech_worker::RecognitionUpdate,
    is_final: bool,
) -> bool {
    if update.endpoint_detected || is_final {
        append_text(target, &update.text);
    }
    update.endpoint_detected
}

#[cfg(any(target_os = "windows", target_os = "android"))]
struct ActivePlatformSpeechSession {
    session_id: String,
    audio_capture: crate::services::speech_audio::PlatformAudioCapture,
    worker: crate::services::speech_worker::SpeechWorker,
    started_at: Instant,
    confirmed_text: Arc<StdMutex<String>>,
}

impl Default for SpeechRuntimeState {
    fn default() -> Self {
        Self {
            phase: Mutex::new(SpeechPhase::Idle),
            #[cfg(any(target_os = "windows", target_os = "android"))]
            active_session: Mutex::new(None),
            #[cfg(any(target_os = "windows", target_os = "android"))]
            preloaded_recognizer: Arc::new(StdMutex::new(None)),
            #[cfg(any(target_os = "windows", target_os = "android"))]
            preload_started: AtomicBool::new(false),
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn preload_at_startup(app: AppHandle) {
    let state = app.state::<SpeechRuntimeState>();
    if state
        .preload_started
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let cache = Arc::clone(&state.preloaded_recognizer);
    if let Err(error) = std::thread::Builder::new()
        .name("notia-speech-preload".to_string())
        .spawn(move || {
            let result = (|| {
                let model = crate::services::speech_model_repository::resolve_qwen3_asr_model(
                    &app, "0.6b", "es", "cpu",
                )?;
                crate::services::qwen3_asr_service::Qwen3AsrRecognizer::load(&app, &model)
            })();
            match result {
                Ok(recognizer) => {
                    if let Ok(mut slot) = cache.lock() {
                        *slot = Some(recognizer);
                    }
                    log::info!("[notia:speech] offline recognizer preloaded");
                }
                Err(error) => log::warn!("[notia:speech] preload failed: {error}"),
            }
        })
    {
        log::warn!("[notia:speech] could not start preload: {error}");
    }
}

pub fn runtime_integrated() -> bool {
    cfg!(any(target_os = "windows", target_os = "android"))
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn start_platform_session(
    app: &AppHandle,
    state: &SpeechRuntimeState,
    session_id: String,
    model: crate::services::qwen3_asr_service::Qwen3AsrModelConfig,
    diarization_model: Option<crate::services::speech_model_repository::ResolvedDiarizationModel>,
    capture_system_audio: bool,
) -> Result<(), String> {
    let mut slot = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la sesion de voz.".to_string())?;
    if slot.is_some() {
        return Err("Ya existe una sesion de voz activa.".to_string());
    }
    let diarization_runtime_path = diarization_model
        .as_ref()
        .map(|_| crate::services::sherpa_runtime::resolve_platform_runtime_path(app))
        .transpose()?;
    let recognizer_app = app.clone();
    let recognizer_cache = Arc::clone(&state.preloaded_recognizer);
    let recycler_cache = Arc::clone(&recognizer_cache);
    let buffer = crate::services::speech_audio::create_shared_pcm_buffer();
    let capture = crate::services::speech_audio::PlatformAudioCapture::start_with_buffer(
        Arc::clone(&buffer),
        capture_system_audio,
    )?;
    let started_at = Instant::now();
    let confirmed_text = Arc::new(StdMutex::new(String::new()));
    let callback_app = app.clone();
    let callback_session_id = session_id.clone();
    let callback_confirmed = Arc::clone(&confirmed_text);
    let worker = crate::services::speech_worker::SpeechWorker::start_with_recycler(
        buffer,
        move || {
            if let Some(recognizer) = recognizer_cache
                .lock()
                .map_err(|_| "No se pudo acceder al modelo precargado.".to_string())?
                .take()
            {
                if recognizer.matches(&model) {
                    return Ok(recognizer);
                }
            }
            crate::services::qwen3_asr_service::Qwen3AsrRecognizer::load(&recognizer_app, &model)
        },
        move |event| {
            handle_worker_event(
                &callback_app,
                &callback_session_id,
                started_at,
                &callback_confirmed,
                diarization_runtime_path.as_deref(),
                diarization_model.as_ref(),
                event,
            );
        },
        move |recognizer| {
            if let Ok(mut slot) = recycler_cache.lock() {
                *slot = Some(recognizer);
            }
        },
    )?;
    *slot = Some(ActivePlatformSpeechSession {
        session_id,
        audio_capture: capture,
        worker,
        started_at,
        confirmed_text,
    });
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn consume_platform_turn(
    state: &SpeechRuntimeState,
    session_id: &str,
) -> Result<String, String> {
    let slot = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la sesion de voz.".to_string())?;
    let session = slot
        .as_ref()
        .filter(|session| session.session_id == session_id)
        .ok_or_else(|| "La sesion de voz no coincide con la sesion activa.".to_string())?;
    session.audio_capture.pause()?;
    session.worker.pause()?;
    let mut confirmed = session
        .confirmed_text
        .lock()
        .map_err(|_| "No se pudo obtener el turno reconocido.".to_string())?;
    let text = std::mem::take(&mut *confirmed).trim().to_string();
    drop(confirmed);
    if text.is_empty() {
        session.worker.resume()?;
        session.audio_capture.resume()?;
        return Err("No se detecto voz en este turno.".to_string());
    }
    Ok(text)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn consume_platform_turn(
    _state: &SpeechRuntimeState,
    _session_id: &str,
) -> Result<String, String> {
    Err("La captura de voz todavia no esta integrada en esta plataforma.".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn start_platform_session(
    _app: &tauri::AppHandle,
    _state: &SpeechRuntimeState,
    _session_id: String,
    _diarization_enabled: bool,
) -> Result<(), String> {
    Err("La captura de voz todavia no esta integrada en esta plataforma.".to_string())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn pause_platform_audio(state: &SpeechRuntimeState) -> Result<(), String> {
    let slot = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la captura de voz.".to_string())?;
    let session = slot
        .as_ref()
        .ok_or_else(|| "No hay una captura de voz activa.".to_string())?;
    session.audio_capture.pause()?;
    session.worker.pause()
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn pause_platform_audio(_state: &SpeechRuntimeState) -> Result<(), String> {
    Err("La captura de voz todavia no esta integrada en esta plataforma.".to_string())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn resume_platform_audio(state: &SpeechRuntimeState) -> Result<(), String> {
    let slot = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la captura de voz.".to_string())?;
    let session = slot
        .as_ref()
        .ok_or_else(|| "No hay una captura de voz activa.".to_string())?;
    session.audio_capture.resume()?;
    session.worker.resume()
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn resume_platform_audio(_state: &SpeechRuntimeState) -> Result<(), String> {
    Err("La captura de voz todavia no esta integrada en esta plataforma.".to_string())
}

pub fn cancel_platform_audio(state: &SpeechRuntimeState) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        let session = state
            .active_session
            .lock()
            .map_err(|_| "No se pudo bloquear la captura de voz.".to_string())?
            .take();
        if let Some(session) = session {
            session.worker.cancel()?;
            session.worker.join()?;
        }
    }
    let mut phase = state
        .phase
        .lock()
        .map_err(|_| "No se pudo bloquear el estado de voz.".to_string())?;
    *phase = SpeechPhase::Idle;
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn stop_platform_session(state: &SpeechRuntimeState) -> Result<(), String> {
    let session = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la sesion de voz.".to_string())?
        .take()
        .ok_or_else(|| "No hay una sesion de voz activa.".to_string())?;
    session.audio_capture.pause()?;
    session.worker.stop()?;
    session.worker.join()
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn stop_platform_session(_state: &SpeechRuntimeState) -> Result<(), String> {
    Err("La captura de voz todavia no esta integrada en esta plataforma.".to_string())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn validate_active_session(
    state: &SpeechRuntimeState,
    session_id: &str,
) -> Result<u64, String> {
    let slot = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la sesion de voz.".to_string())?;
    let session = slot
        .as_ref()
        .filter(|session| session.session_id == session_id)
        .ok_or_else(|| "La sesion de voz no coincide con la sesion activa.".to_string())?;
    Ok(session
        .started_at
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn validate_active_session(
    _state: &SpeechRuntimeState,
    _session_id: &str,
) -> Result<u64, String> {
    Err("No hay una sesion de voz activa.".to_string())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn handle_worker_event(
    app: &AppHandle,
    session_id: &str,
    started_at: Instant,
    confirmed_text: &Arc<StdMutex<String>>,
    diarization_runtime_path: Option<&std::path::Path>,
    diarization_model: Option<&crate::services::speech_model_repository::ResolvedDiarizationModel>,
    event: crate::services::speech_worker::SpeechWorkerEvent,
) {
    use crate::services::speech_worker::SpeechWorkerEvent;
    match event {
        SpeechWorkerEvent::Ready => {
            set_runtime_phase(app, SpeechPhase::Recording);
            emit_state(
                app,
                session_id,
                SpeechSessionStateDto::Recording {
                    elapsed_ms: elapsed_ms(started_at),
                    has_speech: false,
                },
            );
        }
        SpeechWorkerEvent::Partial(update) => {
            let Ok(mut confirmed) = confirmed_text.lock() else {
                emit_error(
                    app,
                    session_id,
                    "internal",
                    "No se pudo actualizar la transcripcion.",
                );
                return;
            };
            let partial = if update.endpoint_detected {
                append_text(&mut confirmed, &update.text);
                String::new()
            } else {
                unconfirmed_suffix(&confirmed, &update.text)
            };
            let _ = app.emit(
                "speech://partial",
                SpeechPartialEventDto {
                    session_id: session_id.to_string(),
                    confirmed_text: confirmed.clone(),
                    partial_text: partial,
                },
            );
        }
        SpeechWorkerEvent::Finished { update, samples } => {
            let text = match confirmed_text.lock() {
                Ok(mut confirmed) => {
                    append_text(&mut confirmed, &update.text);
                    confirmed.clone()
                }
                Err(_) => update.text,
            };
            let transcript = match diarization_model {
                Some(model) => match diarization_runtime_path
                    .ok_or_else(|| "No se encontró el runtime de diarización.".to_string())
                    .and_then(|runtime_path| {
                        crate::services::sherpa_diarization::process(runtime_path, model, &samples)
                    }) {
                    Ok(result) => build_diarized_transcript(&text, &result),
                    Err(message) => {
                        log::warn!(
                            "[notia:speech] diarization failed; preserving ASR transcript: {message}"
                        );
                        transcript_without_diarization(&text, elapsed_ms(started_at))
                    }
                },
                None => transcript_without_diarization(&text, elapsed_ms(started_at)),
            };
            let _ = app.emit(
                "speech://segments",
                SpeechSegmentsEventDto {
                    session_id: session_id.to_string(),
                    transcript: transcript.clone(),
                },
            );
            emit_state(
                app,
                session_id,
                SpeechSessionStateDto::Completed { transcript },
            );
            set_runtime_phase(app, SpeechPhase::Idle);
        }
        SpeechWorkerEvent::Error(message) => {
            emit_error(app, session_id, "internal", &message);
            set_runtime_phase(app, SpeechPhase::Idle);
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn elapsed_ms(started_at: Instant) -> u64 {
    started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn append_text(target: &mut String, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    let target_words = target.split_whitespace().collect::<Vec<_>>();
    let incoming_words = text.split_whitespace().collect::<Vec<_>>();
    let overlap = matching_boundary_words(&target_words, &incoming_words);
    if overlap == incoming_words.len() {
        return;
    }
    normalize_transcript_chunk_boundary(target, incoming_words[overlap]);
    if !target.is_empty() {
        target.push(' ');
    }
    target.push_str(&incoming_words[overlap..].join(" "));
}

fn normalize_transcript_chunk_boundary(target: &mut String, next_word: &str) {
    let starts_lowercase = next_word.chars().next().is_some_and(char::is_lowercase);
    if !starts_lowercase || !target.ends_with('.') {
        return;
    }
    target.pop();
    if matches!(
        next_word.to_lowercase().as_str(),
        "aunque" | "pero" | "porque" | "pues" | "sino"
    ) {
        target.push(',');
    }
}

fn unconfirmed_suffix(confirmed: &str, partial: &str) -> String {
    let confirmed_words = confirmed.split_whitespace().collect::<Vec<_>>();
    let partial_words = partial.split_whitespace().collect::<Vec<_>>();
    let overlap = matching_boundary_words(&confirmed_words, &partial_words);
    partial_words[overlap..].join(" ")
}

fn matching_boundary_words(left_words: &[&str], right_words: &[&str]) -> usize {
    let exact_overlap = (1..=left_words.len().min(right_words.len()))
        .rev()
        .find(|&count| {
            left_words[left_words.len() - count..]
                .iter()
                .zip(&right_words[..count])
                .all(|(left, right)| words_match(left, right))
        })
        .unwrap_or(0);
    if exact_overlap > 0 {
        return exact_overlap;
    }

    // Forced endpoints retain audio from the previous window. The model can
    // render that same boundary slightly differently (for example,
    // `Espartinas` / `las partinas`). Reconcile a sufficiently long fuzzy
    // boundary so that one changed word does not duplicate the whole overlap.
    const MAX_BOUNDARY_WORDS: usize = 12;
    const MIN_FUZZY_BOUNDARY_WORDS: usize = 4;
    const MAX_BOUNDARY_EDITS: usize = 2;
    let max_left = left_words.len().min(MAX_BOUNDARY_WORDS);
    let max_right = right_words.len().min(MAX_BOUNDARY_WORDS);
    let mut best: Option<(usize, usize, usize)> = None;

    for left_count in MIN_FUZZY_BOUNDARY_WORDS..=max_left {
        for right_count in MIN_FUZZY_BOUNDARY_WORDS..=max_right {
            let span = left_count.max(right_count);
            let allowed_edits = (span / 3).min(MAX_BOUNDARY_EDITS);
            if left_count.abs_diff(right_count) > allowed_edits {
                continue;
            }
            let distance = boundary_edit_distance(
                &left_words[left_words.len() - left_count..],
                &right_words[..right_count],
            );
            if distance == 0 || distance > allowed_edits {
                continue;
            }
            let candidate = (span, usize::MAX - distance, right_count);
            if best.is_none_or(|current| candidate > current) {
                best = Some(candidate);
            }
        }
    }

    best.map_or(0, |(_, _, right_count)| right_count)
}

fn boundary_edit_distance(left: &[&str], right: &[&str]) -> usize {
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    let mut current = vec![0; right.len() + 1];
    for (left_index, left_word) in left.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_word) in right.iter().enumerate() {
            let substitution =
                previous[right_index] + usize::from(!words_match(left_word, right_word));
            current[right_index + 1] = substitution
                .min(previous[right_index + 1] + 1)
                .min(current[right_index] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn words_match(left: &str, right: &str) -> bool {
    left.trim_matches(|character: char| !character.is_alphanumeric())
        .eq_ignore_ascii_case(right.trim_matches(|character: char| !character.is_alphanumeric()))
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn transcript_without_diarization(text: &str, elapsed_ms: u64) -> DiarizedTranscriptDto {
    let text = text.trim().to_string();
    let segments = (!text.is_empty())
        .then(|| SpeechTranscriptSegmentDto {
            id: "segment-1".to_string(),
            start_ms: 0,
            end_ms: elapsed_ms,
            speaker_id: None,
            text: text.clone(),
            is_final: true,
        })
        .into_iter()
        .collect();
    DiarizedTranscriptDto {
        text,
        segments,
        speaker_count: 0,
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn build_diarized_transcript(
    text: &str,
    diarization: &crate::services::sherpa_diarization::DiarizationResult,
) -> DiarizedTranscriptDto {
    let words = text.split_whitespace().collect::<Vec<_>>();
    let diarization_segments = merge_adjacent_speaker_segments(&diarization.segments);
    let total_duration = diarization_segments
        .iter()
        .map(|segment| (segment.end_seconds - segment.start_seconds).max(0.0))
        .sum::<f32>();
    let mut word_offset = 0_usize;
    let mut elapsed_duration = 0.0_f32;
    let mut segments = Vec::with_capacity(diarization_segments.len());
    for (index, segment) in diarization_segments.iter().enumerate() {
        let remaining = words.len().saturating_sub(word_offset);
        let duration = (segment.end_seconds - segment.start_seconds).max(0.0);
        elapsed_duration += duration;
        let word_count = if index + 1 == diarization_segments.len() {
            remaining
        } else if total_duration > 0.0 {
            let ideal_boundary =
                (elapsed_duration / total_duration * words.len() as f32).round() as usize;
            let boundary =
                nearest_sentence_boundary(&words, word_offset, ideal_boundary).min(words.len());
            boundary.saturating_sub(word_offset).min(remaining)
        } else {
            0
        };
        let segment_text = words[word_offset..word_offset + word_count].join(" ");
        word_offset += word_count;
        segments.push(SpeechTranscriptSegmentDto {
            id: format!("segment-{}", index + 1),
            start_ms: seconds_to_ms(segment.start_seconds),
            end_ms: seconds_to_ms(segment.end_seconds),
            speaker_id: Some(format!("speaker-{}", segment.speaker + 1)),
            text: segment_text,
            is_final: true,
        });
    }
    DiarizedTranscriptDto {
        text: text.trim().to_string(),
        segments,
        speaker_count: diarization.speaker_count,
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn merge_adjacent_speaker_segments(
    source: &[crate::services::sherpa_diarization::DiarizationSegment],
) -> Vec<crate::services::sherpa_diarization::DiarizationSegment> {
    let mut merged: Vec<crate::services::sherpa_diarization::DiarizationSegment> = Vec::new();
    for segment in source {
        if let Some(previous) = merged.last_mut() {
            if previous.speaker == segment.speaker
                && segment.start_seconds <= previous.end_seconds + 0.5
            {
                previous.end_seconds = previous.end_seconds.max(segment.end_seconds);
                continue;
            }
        }
        merged.push(segment.clone());
    }
    merged
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn nearest_sentence_boundary(words: &[&str], minimum: usize, ideal: usize) -> usize {
    const MAX_BOUNDARY_SHIFT_WORDS: usize = 12;
    let lower = ideal
        .saturating_sub(MAX_BOUNDARY_SHIFT_WORDS)
        .max(minimum.saturating_add(1));
    let upper = ideal
        .saturating_add(MAX_BOUNDARY_SHIFT_WORDS)
        .min(words.len().saturating_sub(1));
    (lower..=upper)
        .filter(|&boundary| {
            words[boundary - 1]
                .trim_end_matches(|character: char| matches!(character, '\"' | '\'' | ')' | ']'))
                .ends_with(['.', '?', '!'])
        })
        .min_by_key(|&boundary| boundary.abs_diff(ideal))
        .unwrap_or_else(|| ideal.clamp(minimum.saturating_add(1), words.len()))
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn seconds_to_ms(value: f32) -> u64 {
    (value.max(0.0) * 1_000.0).round().min(u64::MAX as f32) as u64
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn emit_state(app: &AppHandle, session_id: &str, state: SpeechSessionStateDto) {
    let _ = app.emit(
        "speech://state",
        SpeechSessionEventDto {
            session_id: session_id.to_string(),
            state,
        },
    );
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn emit_session_state(app: &AppHandle, session_id: &str, state: SpeechSessionStateDto) {
    emit_state(app, session_id, state);
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn emit_error(app: &AppHandle, session_id: &str, code: &str, message: &str) {
    emit_state(
        app,
        session_id,
        SpeechSessionStateDto::Error {
            error: SpeechErrorDto {
                code: code.to_string(),
                message: message.to_string(),
            },
        },
    );
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn set_runtime_phase(app: &AppHandle, phase: SpeechPhase) {
    if let Ok(mut current) = app.state::<SpeechRuntimeState>().phase.lock() {
        *current = phase;
    }
}

impl SpeechPhase {
    pub fn is_active(self) -> bool {
        self == Self::Preparing || ACTIVE_SPEECH_PHASES.contains(&self)
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Idle, Self::Preparing)
                | (Self::Preparing, Self::Recording)
                | (Self::Preparing, Self::Idle)
                | (Self::Recording, Self::Paused)
                | (Self::Recording, Self::Finalizing)
                | (Self::Recording, Self::Idle)
                | (Self::Paused, Self::Recording)
                | (Self::Paused, Self::Finalizing)
                | (Self::Paused, Self::Idle)
                | (Self::Finalizing, Self::Idle)
        )
    }
}

pub fn current_capabilities(
    model_status: &SpeechModelStatusDto,
    _diarization_runtime_compatible: bool,
    _audio_available: bool,
    permission: &str,
) -> SpeechCapabilitiesDto {
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        "other"
    };

    let platform_supported = cfg!(any(target_os = "windows", target_os = "android"));
    let asr_ready = model_status
        .profiles
        .iter()
        .any(|profile| profile.asr_ready);
    let diarization_ready = model_status
        .profiles
        .iter()
        .any(|profile| profile.diarization_ready);
    let supported = platform_supported;
    SpeechCapabilitiesDto {
        supported,
        platform: platform.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        permission: permission.to_string(),
        asr_model_installed: asr_ready,
        diarization_model_installed: diarization_ready,
        unavailable_reason: (!supported).then(|| {
            if platform_supported {
                "not-integrated"
            } else {
                "unsupported-platform"
            }
            .to_string()
        }),
    }
}

pub fn validate_start_input(language: &str, max_duration_seconds: u32) -> Result<(), String> {
    if language.trim().is_empty() || language.len() > 16 {
        return Err("El idioma solicitado para el dictado no es valido.".to_string());
    }
    if !(1..=MAX_SPEECH_SESSION_SECONDS).contains(&max_duration_seconds) {
        return Err(format!(
            "La duracion del dictado debe estar entre 1 y {MAX_SPEECH_SESSION_SECONDS} segundos."
        ));
    }
    Ok(())
}

pub fn not_integrated_error() -> String {
    "La integración nativa con llama.cpp y Qwen3-ASR todavía no está disponible.".to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        append_text, commit_external_update, current_capabilities, nearest_sentence_boundary,
        unconfirmed_suffix, validate_start_input, SpeechPhase, MAX_SPEECH_SESSION_SECONDS,
    };
    use crate::dto::speech::SpeechModelStatusDto;
    use crate::services::speech_worker::RecognitionUpdate;

    #[test]
    fn speech_phase_rejects_invalid_transitions() {
        assert!(!SpeechPhase::Idle.is_active());
        assert!(SpeechPhase::Recording.is_active());
        assert!(SpeechPhase::Idle.can_transition_to(SpeechPhase::Preparing));
        assert!(!SpeechPhase::Idle.can_transition_to(SpeechPhase::Recording));
        assert!(SpeechPhase::Paused.can_transition_to(SpeechPhase::Finalizing));
        assert!(!SpeechPhase::Finalizing.can_transition_to(SpeechPhase::Paused));
    }

    #[test]
    fn start_input_is_bounded() {
        assert!(validate_start_input("es", MAX_SPEECH_SESSION_SECONDS).is_ok());
        assert!(validate_start_input("", 10).is_err());
        assert!(validate_start_input("es", 0).is_err());
        assert!(validate_start_input("es", MAX_SPEECH_SESSION_SECONDS + 1).is_err());
    }

    #[test]
    fn capabilities_do_not_claim_unvalidated_models() {
        let capabilities = current_capabilities(
            &SpeechModelStatusDto {
                schema_version: 1,
                profiles: Vec::new(),
            },
            false,
            false,
            "unavailable",
        );
        assert_eq!(
            capabilities.supported,
            cfg!(any(target_os = "windows", target_os = "android"))
        );
        assert!(!capabilities.asr_model_installed);
        assert!(!capabilities.diarization_model_installed);
    }

    #[test]
    fn confirmed_utterances_reconcile_overlapping_boundary_words() {
        let mut transcript = "La transcripcion de la reunion".to_string();
        append_text(&mut transcript, "de la reunion continúa ahora");
        assert_eq!(transcript, "La transcripcion de la reunion continúa ahora");
    }

    #[test]
    fn external_audio_does_not_append_repeated_partial_hypotheses() {
        let mut transcript = String::new();
        for _ in 0..3 {
            assert!(!commit_external_update(
                &mut transcript,
                &RecognitionUpdate {
                    text: "Que es Spring Boot.".to_string(),
                    endpoint_detected: false,
                },
                false,
            ));
        }
        commit_external_update(
            &mut transcript,
            &RecognitionUpdate {
                text: "Que es Spring Boot.".to_string(),
                endpoint_detected: false,
            },
            true,
        );
        assert_eq!(transcript, "Que es Spring Boot.");
    }

    #[test]
    fn confirmed_utterances_reconcile_fuzzy_audio_overlap() {
        let mut transcript =
            "Hola, buenas tardes. Hoy estamos en Espartinas para hacer unas preguntas".to_string();
        append_text(
            &mut transcript,
            "las partinas para hacer unas preguntas sobre el ahorro",
        );
        assert_eq!(
            transcript,
            "Hola, buenas tardes. Hoy estamos en Espartinas para hacer unas preguntas sobre el ahorro"
        );
    }

    #[test]
    fn confirmed_utterances_keep_distinct_text() {
        let mut transcript = "Hola equipo".to_string();
        append_text(&mut transcript, "empecemos la reunión");
        assert_eq!(transcript, "Hola equipo empecemos la reunión");
    }

    #[test]
    fn partial_text_hides_audio_overlap_already_confirmed() {
        assert_eq!(
            unconfirmed_suffix(
                "La transcripcion de la reunion",
                "de la reunion continua ahora"
            ),
            "continua ahora"
        );
    }

    #[test]
    fn confirmed_chunks_repair_false_sentence_boundaries() {
        let mut transcript = "preguntas sobre el ahorro.".to_string();
        append_text(&mut transcript, "y contaminación del agua");
        assert_eq!(
            transcript,
            "preguntas sobre el ahorro y contaminación del agua"
        );

        let mut transcript = "Hay muchos factores.".to_string();
        append_text(&mut transcript, "pero sobre todo está el ser humano");
        assert_eq!(
            transcript,
            "Hay muchos factores, pero sobre todo está el ser humano"
        );
    }

    #[test]
    fn diarization_moves_word_allocation_to_a_sentence_boundary() {
        let words =
            "Cuáles son las causas de la contaminación del agua? Hombre hay muchos factores"
                .split_whitespace()
                .collect::<Vec<_>>();
        let boundary = nearest_sentence_boundary(&words, 0, 6);
        assert_eq!(
            words[..boundary].join(" "),
            "Cuáles son las causas de la contaminación del agua?"
        );
        assert_eq!(words[boundary..].join(" "), "Hombre hay muchos factores");
    }
}
