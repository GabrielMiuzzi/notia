use crate::dto::speech::{
    DiarizedTranscriptDto, SpeechCapabilitiesDto, SpeechErrorDto, SpeechModelStatusDto,
    SpeechPartialEventDto, SpeechSegmentsEventDto, SpeechSessionEventDto, SpeechSessionStateDto,
    SpeechTranscriptSegmentDto,
};
use std::sync::Mutex;
#[cfg(any(target_os = "windows", target_os = "android"))]
use std::sync::{Arc, Mutex as StdMutex};
#[cfg(any(target_os = "windows", target_os = "android"))]
use std::time::Instant;
#[cfg(any(target_os = "windows", target_os = "android"))]
use tauri::{AppHandle, Emitter, Manager};

pub const MAX_SPEECH_SESSION_SECONDS: u32 = 12 * 60 * 60;
#[cfg(any(target_os = "windows", target_os = "android"))]
const DIARIZATION_CHUNK_SAMPLES: usize = 16_000 * 15 * 60;
#[cfg(any(target_os = "windows", target_os = "android"))]
const GLOBAL_SPEAKER_MATCH_THRESHOLD: f32 = 0.72;
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
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub fn prepare_recognizer(
    app: &AppHandle,
    model: &str,
    language: &str,
    device: &str,
) -> Result<(), String> {
    let resolved = crate::services::speech_model_repository::resolve_qwen3_asr_model(
        app, model, language, device,
    )?;
    let state = app.state::<SpeechRuntimeState>();
    {
        let cache = state
            .preloaded_recognizer
            .lock()
            .map_err(|_| "No se pudo acceder al modelo precargado.".to_string())?;
        if cache
            .as_ref()
            .is_some_and(|recognizer| recognizer.matches(&resolved))
        {
            return Ok(());
        }
    }
    let recognizer = crate::services::qwen3_asr_service::Qwen3AsrRecognizer::load(app, &resolved)?;
    *state
        .preloaded_recognizer
        .lock()
        .map_err(|_| "No se pudo guardar el modelo precargado.".to_string())? = Some(recognizer);
    log::info!("[notia:speech] selected offline recognizer prepared");
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
pub fn prepare_recognizer(
    _app: &tauri::AppHandle,
    _model: &str,
    _language: &str,
    _device: &str,
) -> Result<(), String> {
    Err(not_integrated_error())
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
    max_duration_seconds: u32,
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
        max_duration_seconds,
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
    _max_duration_seconds: u32,
    _capture_system_audio: bool,
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
        SpeechWorkerEvent::Finished { update, audio } => {
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
                        diarize_recorded_audio(app, runtime_path, model, &audio)
                    }) {
                    Ok(transcript) => transcript,
                    Err(message) => {
                        log::warn!(
                            "[notia:speech] diarization failed; preserving ASR transcript: {message}"
                        );
                        transcript_without_diarization(&text, audio.duration_ms())
                    }
                },
                None => transcript_without_diarization(&text, audio.duration_ms()),
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
fn diarize_recorded_audio(
    app: &AppHandle,
    runtime_path: &std::path::Path,
    model: &crate::services::speech_model_repository::ResolvedDiarizationModel,
    audio: &crate::services::speech_worker::RecordedAudio,
) -> Result<DiarizedTranscriptDto, String> {
    let embedding_extractor =
        match crate::services::sherpa_diarization::SpeakerEmbeddingExtractor::new(
            runtime_path,
            model,
        ) {
            Ok(extractor) => Some(extractor),
            Err(message) => {
                log::warn!(
                "[notia:speech] speaker embedding matching unavailable; keeping window-local speakers: {message}"
            );
                None
            }
        };
    let mut speaker_registry = GlobalSpeakerRegistry::new();
    let mut transcript = DiarizedTranscriptDto {
        text: String::new(),
        segments: Vec::new(),
        speaker_count: 0,
    };
    let mut chunk_index = 0_usize;
    let mut chunk_start_ms = 0_u64;
    audio.for_each_chunk(DIARIZATION_CHUNK_SAMPLES, |samples| {
        let diarization =
            crate::services::sherpa_diarization::process(runtime_path, model, samples)?;
        let embeddings = match embedding_extractor.as_ref() {
            Some(extractor) => match extractor.extract(samples, &diarization) {
                Ok(embeddings) => embeddings,
                Err(message) => {
                    log::warn!(
                        "[notia:speech] speaker embeddings failed for diarization window; keeping unmatched speakers local: {message}"
                    );
                    Vec::new()
                }
            },
            None => Vec::new(),
        };
        let speaker_mapping = speaker_registry.remap_chunk(&diarization, &embeddings);
        let chunk = transcribe_diarized_turns(app, samples, &diarization)?;
        append_diarized_chunk(
            &mut transcript,
            chunk,
            chunk_start_ms,
            chunk_index,
            &speaker_mapping,
            speaker_registry.len() as u32,
        );
        chunk_index = chunk_index.saturating_add(1);
        chunk_start_ms = chunk_start_ms.saturating_add(
            (samples.len() as u64)
                .saturating_mul(1_000)
                .checked_div(16_000)
                .unwrap_or(0),
        );
        Ok(())
    })?;
    if transcript.segments.is_empty() {
        return Err("La diarización no produjo segmentos de voz.".to_string());
    }
    Ok(transcript)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
struct GlobalSpeakerRegistry {
    profiles: Vec<GlobalSpeakerProfile>,
    observed_speakers: std::collections::BTreeSet<String>,
    next_speaker_index: usize,
}

#[cfg(any(target_os = "windows", target_os = "android"))]
struct GlobalSpeakerProfile {
    id: String,
    centroid: Vec<f32>,
    observations: usize,
}

#[cfg(any(target_os = "windows", target_os = "android"))]
impl GlobalSpeakerRegistry {
    fn new() -> Self {
        Self {
            profiles: Vec::new(),
            observed_speakers: std::collections::BTreeSet::new(),
            next_speaker_index: 0,
        }
    }

    fn len(&self) -> usize {
        self.observed_speakers.len()
    }

    fn remap_chunk(
        &mut self,
        diarization: &crate::services::sherpa_diarization::DiarizationResult,
        embeddings: &[crate::services::sherpa_diarization::SpeakerEmbedding],
    ) -> std::collections::BTreeMap<String, String> {
        let local_speakers = diarization
            .segments
            .iter()
            .map(|segment| format!("speaker-{}", segment.speaker + 1))
            .collect::<std::collections::BTreeSet<_>>();
        let embedding_by_speaker = embeddings
            .iter()
            .map(|embedding| {
                (
                    format!("speaker-{}", embedding.speaker + 1),
                    embedding.vector.as_slice(),
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut candidates = Vec::new();
        for (local_speaker, embedding) in &embedding_by_speaker {
            for (profile_index, profile) in self.profiles.iter().enumerate() {
                if let Some(score) = cosine_similarity(embedding, &profile.centroid) {
                    candidates.push((score, local_speaker.as_str(), profile_index));
                }
            }
        }
        candidates.sort_by(|left, right| {
            right
                .0
                .partial_cmp(&left.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut mapping = std::collections::BTreeMap::new();
        let mut claimed_profiles = std::collections::BTreeSet::new();
        for (score, local_speaker, profile_index) in candidates {
            if score < GLOBAL_SPEAKER_MATCH_THRESHOLD
                || mapping.contains_key(local_speaker)
                || !claimed_profiles.insert(profile_index)
            {
                continue;
            }
            let global_speaker = self.profiles[profile_index].id.clone();
            mapping.insert(local_speaker.to_string(), global_speaker);
            self.observed_speakers
                .insert(self.profiles[profile_index].id.clone());
            self.update_profile(profile_index, embedding_by_speaker[local_speaker]);
        }

        for local_speaker in local_speakers {
            if mapping.contains_key(&local_speaker) {
                continue;
            }
            let global_speaker = self.allocate_speaker_id();
            if let Some(embedding) = embedding_by_speaker.get(&local_speaker) {
                self.profiles.push(GlobalSpeakerProfile {
                    id: global_speaker.clone(),
                    centroid: normalize_embedding(embedding),
                    observations: 1,
                });
            } else {
                // A very short turn may not yield an embedding. Keep a unique
                // ID for this occurrence without poisoning the match registry.
            }
            mapping.insert(local_speaker, global_speaker);
        }
        mapping
    }

    fn allocate_speaker_id(&mut self) -> String {
        let id = global_speaker_id(self.next_speaker_index);
        self.next_speaker_index = self.next_speaker_index.saturating_add(1);
        self.observed_speakers.insert(id.clone());
        id
    }

    fn update_profile(&mut self, profile_index: usize, embedding: &[f32]) {
        let profile = &mut self.profiles[profile_index];
        if profile.centroid.len() != embedding.len() {
            return;
        }
        let previous_weight = profile.observations as f32;
        for (centroid, value) in profile.centroid.iter_mut().zip(embedding) {
            *centroid = (*centroid * previous_weight + *value) / (previous_weight + 1.0);
        }
        profile.centroid = normalize_embedding(&profile.centroid);
        profile.observations = profile.observations.saturating_add(1);
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn global_speaker_id(profile_index: usize) -> String {
    format!("speaker-{}", profile_index + 1)
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn normalize_embedding(embedding: &[f32]) -> Vec<f32> {
    let norm = embedding
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    if norm <= f32::EPSILON || !norm.is_finite() {
        return embedding.to_vec();
    }
    embedding.iter().map(|value| value / norm).collect()
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn cosine_similarity(left: &[f32], right: &[f32]) -> Option<f32> {
    if left.len() != right.len() || left.is_empty() {
        return None;
    }
    let left_norm = left.iter().map(|value| value * value).sum::<f32>().sqrt();
    let right_norm = right.iter().map(|value| value * value).sum::<f32>().sqrt();
    if !left_norm.is_finite()
        || !right_norm.is_finite()
        || left_norm <= f32::EPSILON
        || right_norm <= f32::EPSILON
    {
        return None;
    }
    Some(
        left.iter()
            .zip(right)
            .map(|(left, right)| left * right)
            .sum::<f32>()
            / (left_norm * right_norm),
    )
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn append_diarized_chunk(
    target: &mut DiarizedTranscriptDto,
    mut chunk: DiarizedTranscriptDto,
    chunk_start_ms: u64,
    chunk_index: usize,
    speaker_mapping: &std::collections::BTreeMap<String, String>,
    speaker_count: u32,
) {
    if !target.text.is_empty() && !chunk.text.is_empty() {
        target.text.push(' ');
    }
    target.text.push_str(&chunk.text);
    target.speaker_count = speaker_count;
    for segment in &mut chunk.segments {
        segment.id = format!("segment-{}", target.segments.len() + 1);
        segment.start_ms = segment.start_ms.saturating_add(chunk_start_ms);
        segment.end_ms = segment.end_ms.saturating_add(chunk_start_ms);
        if let Some(speaker_id) = &segment.speaker_id {
            segment.speaker_id = Some(
                speaker_mapping
                    .get(speaker_id)
                    .cloned()
                    .unwrap_or_else(|| format!("chunk-{chunk_index}-{speaker_id}")),
            );
        }
    }
    target.segments.extend(chunk.segments);
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
fn transcribe_diarized_turns(
    app: &AppHandle,
    samples: &[f32],
    diarization: &crate::services::sherpa_diarization::DiarizationResult,
) -> Result<DiarizedTranscriptDto, String> {
    use crate::services::speech_worker::StreamingRecognizer;

    const SAMPLE_RATE: f32 = 16_000.0;
    const ASR_CHUNK_SAMPLES: usize = 3_200;
    const MIN_TURN_SAMPLES: usize = 12_800;

    let turns = merge_adjacent_speaker_segments(&diarization.segments);
    if turns.is_empty() {
        return Err("La diarización no detectó turnos de voz.".to_string());
    }
    let cache = recognizer_cache(&app.state::<SpeechRuntimeState>());
    let mut recognizer = cache
        .lock()
        .map_err(|_| "No se pudo acceder al modelo precargado.".to_string())?
        .take()
        .ok_or_else(|| {
            "El reconocedor no estaba disponible para alinear los turnos.".to_string()
        })?;

    let result = (|| {
        let mut transcript_segments = Vec::with_capacity(turns.len());
        let mut complete_text = String::new();
        for turn in turns {
            let start = (turn.start_seconds.max(0.0) * SAMPLE_RATE).round() as usize;
            let end = (turn.end_seconds.max(turn.start_seconds) * SAMPLE_RATE).round() as usize;
            let start = start.min(samples.len());
            let end = end.min(samples.len());
            if end <= start {
                continue;
            }
            let mut padded_samples = Vec::new();
            let turn_samples = if end - start < MIN_TURN_SAMPLES {
                padded_samples.extend_from_slice(&samples[start..end]);
                padded_samples.resize(MIN_TURN_SAMPLES, 0.0);
                padded_samples.as_slice()
            } else {
                &samples[start..end]
            };
            recognizer.reset_session()?;
            let mut turn_text = String::new();
            for chunk in turn_samples.chunks(ASR_CHUNK_SAMPLES) {
                let update = recognizer.accept_waveform(chunk)?;
                if update.endpoint_detected {
                    append_text(&mut turn_text, &update.text);
                    recognizer.reset_after_endpoint()?;
                }
            }
            let final_update = recognizer.finish()?;
            append_text(&mut turn_text, &final_update.text);
            let turn_text = turn_text.trim().to_string();
            if turn_text.is_empty() {
                continue;
            }
            if !complete_text.is_empty() {
                complete_text.push(' ');
            }
            complete_text.push_str(&turn_text);
            transcript_segments.push(SpeechTranscriptSegmentDto {
                id: format!("segment-{}", transcript_segments.len() + 1),
                start_ms: seconds_to_ms(turn.start_seconds),
                end_ms: seconds_to_ms(turn.end_seconds),
                speaker_id: Some(format!("speaker-{}", turn.speaker + 1)),
                text: turn_text,
                is_final: true,
            });
        }
        if transcript_segments.is_empty() {
            return Err("La segunda pasada ASR no produjo texto para los turnos.".to_string());
        }
        Ok(DiarizedTranscriptDto {
            text: complete_text,
            segments: transcript_segments,
            speaker_count: diarization.speaker_count,
        })
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
#[cfg(test)]
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
    #[cfg(any(target_os = "windows", target_os = "android"))]
    use super::GlobalSpeakerRegistry;
    use super::{
        append_text, commit_external_update, current_capabilities, nearest_sentence_boundary,
        unconfirmed_suffix, validate_start_input, SpeechPhase, MAX_SPEECH_SESSION_SECONDS,
    };
    use crate::dto::speech::SpeechModelStatusDto;
    #[cfg(any(target_os = "windows", target_os = "android"))]
    use crate::services::sherpa_diarization::{
        DiarizationResult, DiarizationSegment, SpeakerEmbedding,
    };
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

    #[cfg(any(target_os = "windows", target_os = "android"))]
    #[test]
    fn global_speaker_registry_matches_local_ids_across_windows() {
        let mut registry = GlobalSpeakerRegistry::new();
        let first_window = DiarizationResult {
            speaker_count: 2,
            segments: vec![
                DiarizationSegment {
                    start_seconds: 0.0,
                    end_seconds: 3.0,
                    speaker: 0,
                },
                DiarizationSegment {
                    start_seconds: 3.0,
                    end_seconds: 6.0,
                    speaker: 1,
                },
            ],
        };
        let first_mapping = registry.remap_chunk(
            &first_window,
            &[
                SpeakerEmbedding {
                    speaker: 0,
                    vector: vec![1.0, 0.0],
                },
                SpeakerEmbedding {
                    speaker: 1,
                    vector: vec![0.0, 1.0],
                },
            ],
        );
        let second_window = DiarizationResult {
            speaker_count: 2,
            segments: vec![
                DiarizationSegment {
                    start_seconds: 0.0,
                    end_seconds: 3.0,
                    speaker: 8,
                },
                DiarizationSegment {
                    start_seconds: 3.0,
                    end_seconds: 6.0,
                    speaker: 4,
                },
            ],
        };
        let second_mapping = registry.remap_chunk(
            &second_window,
            &[
                SpeakerEmbedding {
                    speaker: 8,
                    vector: vec![0.02, 0.99],
                },
                SpeakerEmbedding {
                    speaker: 4,
                    vector: vec![0.98, 0.04],
                },
            ],
        );

        assert_eq!(registry.len(), 2);
        assert_eq!(first_mapping["speaker-1"], second_mapping["speaker-5"]);
        assert_eq!(first_mapping["speaker-2"], second_mapping["speaker-9"]);
        assert_ne!(second_mapping["speaker-5"], second_mapping["speaker-9"]);
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
