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
    Arc<StdMutex<Option<crate::services::sherpa_offline::OfflineVadRecognizer>>>;

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
        Some(recognizer) => recognizer,
        None => {
            let runtime = crate::services::sherpa_runtime::resolve_platform_runtime_path(app)?;
            let model =
                crate::services::speech_model_repository::resolve_offline_nemo_transducer_model(
                    app, "es",
                )?;
            crate::services::sherpa_offline::OfflineVadRecognizer::load(&runtime, &model)?
        }
    };
    let result = (|| {
        let mut parts = Vec::new();
        for chunk in samples.chunks(3_200) {
            let update = recognizer.accept_waveform(chunk)?;
            if !update.text.trim().is_empty() {
                parts.push(update.text);
            }
        }
        let final_update = recognizer.finish()?;
        if !final_update.text.trim().is_empty() {
            parts.push(final_update.text);
        }
        let text = parts.join(" ").trim().to_string();
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

#[cfg(any(target_os = "windows", target_os = "android"))]
struct ActivePlatformSpeechSession {
    session_id: String,
    audio_capture: crate::services::speech_audio::PlatformAudioCapture,
    worker: crate::services::speech_worker::SpeechWorker,
    started_at: Instant,
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
                let runtime = crate::services::sherpa_runtime::resolve_platform_runtime_path(&app)?;
                let model = crate::services::speech_model_repository::resolve_offline_nemo_transducer_model(&app, "es")?;
                crate::services::sherpa_offline::OfflineVadRecognizer::load(&runtime, &model)
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
    model: crate::services::sherpa_offline::OfflineNemoTransducerConfig,
    diarization_model: Option<crate::services::speech_model_repository::ResolvedDiarizationModel>,
) -> Result<(), String> {
    let mut slot = state
        .active_session
        .lock()
        .map_err(|_| "No se pudo bloquear la sesion de voz.".to_string())?;
    if slot.is_some() {
        return Err("Ya existe una sesion de voz activa.".to_string());
    }
    let runtime_path = crate::services::sherpa_runtime::resolve_platform_runtime_path(app)?;
    let recognizer_runtime_path = runtime_path.clone();
    let recognizer_cache = Arc::clone(&state.preloaded_recognizer);
    let recycler_cache = Arc::clone(&recognizer_cache);
    let buffer = crate::services::speech_audio::create_shared_pcm_buffer();
    let capture = crate::services::speech_audio::PlatformAudioCapture::start_with_buffer(
        Arc::clone(&buffer),
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
                return Ok(recognizer);
            }
            crate::services::sherpa_offline::OfflineVadRecognizer::load(
                &recognizer_runtime_path,
                &model,
            )
        },
        move |event| {
            handle_worker_event(
                &callback_app,
                &callback_session_id,
                started_at,
                &callback_confirmed,
                &runtime_path,
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
    });
    Ok(())
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
    runtime_path: &std::path::Path,
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
                update.text
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
                Some(model) => match crate::services::sherpa_diarization::process(
                    runtime_path,
                    model,
                    &samples,
                ) {
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

#[cfg(any(target_os = "windows", target_os = "android"))]
fn append_text(target: &mut String, text: &str) {
    let text = text.trim();
    if text.is_empty() || target.trim_end().ends_with(text) {
        return;
    }
    if !target.is_empty() {
        target.push(' ');
    }
    target.push_str(text);
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
    let total_duration = diarization
        .segments
        .iter()
        .map(|segment| (segment.end_seconds - segment.start_seconds).max(0.0))
        .sum::<f32>();
    let mut word_offset = 0_usize;
    let mut segments = Vec::with_capacity(diarization.segments.len());
    for (index, segment) in diarization.segments.iter().enumerate() {
        let remaining = words.len().saturating_sub(word_offset);
        let word_count = if index + 1 == diarization.segments.len() {
            remaining
        } else if total_duration > 0.0 {
            let duration = (segment.end_seconds - segment.start_seconds).max(0.0);
            ((duration / total_duration * words.len() as f32).round() as usize).min(remaining)
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
    runtime_compatible: bool,
    audio_available: bool,
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
    let supported = platform_supported && runtime_compatible && audio_available;
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
    "La integracion nativa con sherpa-onnx todavia no esta disponible.".to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        current_capabilities, validate_start_input, SpeechPhase, MAX_SPEECH_SESSION_SECONDS,
    };
    use crate::dto::speech::SpeechModelStatusDto;

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
        assert!(!capabilities.supported);
        assert!(!capabilities.asr_model_installed);
        assert!(!capabilities.diarization_model_installed);
    }
}
