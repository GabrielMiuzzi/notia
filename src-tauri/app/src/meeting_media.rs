//! Audio and video files a Meeting transcribes. The interface sends the
//! person's file in ordered chunks (a dropped or picked file has no path in
//! the WebView, on Windows and on Android alike); the backend writes them to
//! a temporary copy, reads the whole audio once (duration and waveform, and
//! proof it can be decoded) and, when the person asks, transcribes it in a
//! speech session like a recording (see `speech_file`). The copy is removed
//! when the session read it, when it is discarded, or once it gets old.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine as _;
use notia_backend_core::meeting::{MeetingFileKind, MeetingSourceFile};
use serde::{Deserialize, Serialize};

use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Manager};
use crate::services::media_decoder::{self, MediaSummary};

/// Largest file accepted: about two hours of a video call.
const MAX_MEDIA_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Largest chunk, once decoded from Base64.
const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;
/// Files being uploaded or waiting to be transcribed at once.
const MAX_UPLOADS: usize = 3;
/// An upload nobody touched for this long is dropped.
const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// A leftover copy older than this is removed (a crash, a closed window).
const STALE_COPY_AGE: Duration = Duration::from_secs(6 * 60 * 60);
const MEDIA_DIRECTORY: &str = "meeting-media";
const MAX_EXPECTED_SPEAKERS: u32 = 10;

#[derive(Default)]
pub(crate) struct MeetingMediaState {
    uploads: Mutex<HashMap<String, MediaUpload>>,
}

struct MediaUpload {
    file: MeetingSourceFile,
    path: PathBuf,
    expected_bytes: u64,
    written_bytes: u64,
    /// Present once the whole file arrived and its audio was read.
    summary: Option<MediaSummary>,
    touched: Instant,
}

impl Drop for MediaUpload {
    fn drop(&mut self) {
        // A copy handed to a session moved out as an empty path.
        if !self.path.as_os_str().is_empty() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaBeginPayload {
    name: String,
    byte_length: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaChunkPayload {
    media_id: String,
    offset: u64,
    /// Base64 of the bytes that start at `offset`.
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaIdPayload {
    media_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartFileSessionPayload {
    media_id: String,
    language: String,
    #[serde(default = "enabled")]
    diarization_enabled: bool,
    #[serde(default)]
    expected_speakers: Option<u32>,
}

fn enabled() -> bool {
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaBeginDto {
    media_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaChunkDto {
    received_bytes: u64,
}

/// A file ready to transcribe, as the interface shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeetingMediaDto {
    media_id: String,
    name: String,
    kind: MeetingFileKind,
    byte_length: u64,
    duration_ms: u64,
    /// Waveform heights between 0 and 1.
    peaks: Vec<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartFileSessionDto {
    session_id: String,
}

fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}

fn internal(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, message, true)
}

fn gone() -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, "El archivo ya no está disponible; volvé a elegirlo.", false)
}

fn media_directory(app: &AppHandle) -> Result<PathBuf, BackendError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| internal("No se encontró la carpeta de datos de Notia."))?
        .join(MEDIA_DIRECTORY);
    std::fs::create_dir_all(&directory).map_err(|_| internal("No se pudo preparar la carpeta temporal del archivo."))?;
    Ok(directory)
}

/// Removes copies older than `STALE_COPY_AGE` that no upload holds. A copy a
/// session is still reading stays: the upload handed it over recently.
fn remove_stale_copies(directory: &std::path::Path, kept: &[PathBuf]) {
    let Ok(entries) = std::fs::read_dir(directory) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > STALE_COPY_AGE);
        if old && !kept.contains(&path) {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Opens an upload for a file of `byteLength` bytes named `name`.
pub(crate) fn meeting_media_begin(app: AppHandle, payload: MediaBeginPayload) -> Result<MediaBeginDto, BackendError> {
    let file = MeetingSourceFile::from_name(&payload.name).map_err(invalid)?;
    if payload.byte_length == 0 {
        return Err(invalid("El archivo está vacío."));
    }
    if payload.byte_length > MAX_MEDIA_BYTES {
        return Err(invalid("El archivo supera los 2 GB que Meeting puede transcribir."));
    }
    let directory = media_directory(&app)?;
    let state = app.state::<MeetingMediaState>();
    let mut uploads = state.uploads.lock().map_err(|_| internal("No se pudo preparar el archivo."))?;
    uploads.retain(|_, upload| upload.touched.elapsed() < UPLOAD_IDLE_TIMEOUT);
    if uploads.len() >= MAX_UPLOADS {
        return Err(invalid("Ya hay archivos cargándose; esperá a que terminen o quitá alguno."));
    }
    remove_stale_copies(&directory, &uploads.values().map(|upload| upload.path.clone()).collect::<Vec<_>>());
    let media_id = uuid::Uuid::new_v4().simple().to_string();
    let extension = file.name.rsplit_once('.').map_or("bin", |(_, extension)| extension).to_ascii_lowercase();
    let path = directory.join(format!("{media_id}.{extension}"));
    std::fs::File::create(&path).map_err(|_| internal("No se pudo crear la copia temporal del archivo."))?;
    uploads.insert(
        media_id.clone(),
        MediaUpload { file, path, expected_bytes: payload.byte_length, written_bytes: 0, summary: None, touched: Instant::now() },
    );
    Ok(MediaBeginDto { media_id })
}

/// Checks that a chunk continues the upload where it stopped and fits in it.
fn check_chunk(upload: &MediaUpload, offset: u64, length: usize) -> Result<(), BackendError> {
    if upload.summary.is_some() {
        return Err(invalid("El archivo ya se terminó de cargar."));
    }
    if offset != upload.written_bytes {
        return Err(invalid("Los fragmentos del archivo llegaron desordenados; volvé a elegirlo."));
    }
    if length == 0 || length > MAX_CHUNK_BYTES {
        return Err(invalid("El fragmento del archivo no es válido."));
    }
    if upload.written_bytes + length as u64 > upload.expected_bytes {
        return Err(invalid("El archivo es más grande de lo que se anunció."));
    }
    Ok(())
}

/// Appends the next chunk of an upload.
pub(crate) fn meeting_media_chunk(app: AppHandle, payload: MediaChunkPayload) -> Result<MediaChunkDto, BackendError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.data.as_bytes())
        .map_err(|_| invalid("El fragmento del archivo no es válido."))?;
    let state = app.state::<MeetingMediaState>();
    let mut uploads = state.uploads.lock().map_err(|_| internal("No se pudo guardar el archivo."))?;
    let upload = uploads.get_mut(&payload.media_id).ok_or_else(gone)?;
    check_chunk(upload, payload.offset, bytes.len())?;
    let mut copy = OpenOptions::new()
        .append(true)
        .open(&upload.path)
        .map_err(|_| internal("No se pudo escribir la copia temporal del archivo."))?;
    copy.write_all(&bytes).map_err(|_| internal("No se pudo escribir la copia temporal del archivo; revisá el espacio libre."))?;
    upload.written_bytes += bytes.len() as u64;
    upload.touched = Instant::now();
    Ok(MediaChunkDto { received_bytes: upload.written_bytes })
}

/// Closes an upload: reads the whole audio for its duration and waveform.
/// A file that cannot be decoded is removed.
pub(crate) async fn meeting_media_finish(app: AppHandle, payload: MediaIdPayload) -> Result<MeetingMediaDto, BackendError> {
    let (path, file, byte_length) = {
        let state = app.state::<MeetingMediaState>();
        let uploads = state.uploads.lock().map_err(|_| internal("No se pudo leer el archivo."))?;
        let upload = uploads.get(&payload.media_id).ok_or_else(gone)?;
        if upload.written_bytes != upload.expected_bytes {
            return Err(invalid("El archivo no terminó de cargarse."));
        }
        (upload.path.clone(), upload.file.clone(), upload.expected_bytes)
    };
    let summary = crate::host::async_runtime::spawn_blocking(move || media_decoder::summarize(&path, &AtomicBool::new(false)))
        .await
        .map_err(|_| internal("La lectura del archivo terminó de forma inesperada."))?;
    let state = app.state::<MeetingMediaState>();
    let mut uploads = state.uploads.lock().map_err(|_| internal("No se pudo leer el archivo."))?;
    let summary = match summary {
        Ok(summary) => summary,
        Err(error) => {
            uploads.remove(&payload.media_id);
            return Err(invalid(format!("No se pudo leer el audio de «{}»: {error}", file.name)));
        }
    };
    let upload = uploads.get_mut(&payload.media_id).ok_or_else(gone)?;
    upload.summary = Some(summary.clone());
    upload.touched = Instant::now();
    Ok(MeetingMediaDto {
        media_id: payload.media_id,
        name: file.name,
        kind: file.kind,
        byte_length,
        duration_ms: summary.duration_ms,
        peaks: summary.peaks,
    })
}

/// Drops an upload and its copy.
pub(crate) fn meeting_media_discard(app: AppHandle, payload: MediaIdPayload) -> Result<(), BackendError> {
    let state = app.state::<MeetingMediaState>();
    state.uploads.lock().map_err(|_| internal("No se pudo quitar el archivo."))?.remove(&payload.media_id);
    Ok(())
}

/// Takes a finished upload for its session: the copy now belongs to the
/// session, which removes it once read.
fn take_ready_upload(app: &AppHandle, media_id: &str) -> Result<(MeetingSourceFile, PathBuf, u64), BackendError> {
    let state = app.state::<MeetingMediaState>();
    let mut uploads = state.uploads.lock().map_err(|_| internal("No se pudo leer el archivo."))?;
    let duration_ms = uploads
        .get(media_id)
        .ok_or_else(gone)?
        .summary
        .as_ref()
        .map(|summary| summary.duration_ms)
        .ok_or_else(|| invalid("El archivo todavía se está leyendo."))?;
    let mut upload = uploads.remove(media_id).ok_or_else(gone)?;
    let path = std::mem::take(&mut upload.path);
    Ok((upload.file.clone(), path, duration_ms))
}

/// Transcribes an uploaded file as a Meeting: the meeting exists before the
/// first line and is processing from the start; the session reports the
/// share of the file transcribed and then separates the speakers.
pub(crate) async fn meeting_start_file_session(
    app: AppHandle,
    payload: StartFileSessionPayload,
) -> Result<StartFileSessionDto, BackendError> {
    use crate::services::speech_service::{self, SpeechPhase, SpeechRuntimeState};
    speech_service::validate_start_input(&payload.language, speech_service::MAX_SPEECH_SESSION_SECONDS).map_err(invalid)?;
    if payload.expected_speakers.is_some_and(|count| !(2..=MAX_EXPECTED_SPEAKERS).contains(&count)) {
        return Err(invalid(format!("La cantidad de hablantes debe estar entre 2 y {MAX_EXPECTED_SPEAKERS}.")));
    }
    if !speech_service::runtime_integrated() {
        return Err(invalid(speech_service::not_integrated_error()));
    }
    {
        let state = app.state::<SpeechRuntimeState>();
        let phase = *state.phase.lock().map_err(|_| internal("No se pudo leer el estado de voz."))?;
        if phase.is_active() || !phase.can_transition_to(SpeechPhase::Preparing) {
            return Err(invalid("Ya hay una grabación o una transcripción en curso."));
        }
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        let (file, path, duration_ms) = take_ready_upload(&app, &payload.media_id)?;
        // Transcribing a long file keeps going with the screen off.
        #[cfg(target_os = "android")]
        let continuity_started = crate::mobile_continuity::begin_android_work(
            app.state::<crate::mobile_continuity::ContinuityState>().inner(),
            None,
        );
        let session_id = uuid::Uuid::new_v4().to_string();
        {
            let state = app.state::<SpeechRuntimeState>();
            *state.phase.lock().map_err(|_| internal("No se pudo leer el estado de voz."))? = SpeechPhase::Preparing;
        }
        speech_service::emit_session_state(&app, &session_id, crate::dto::speech::SpeechSessionStateDto::Preparing { progress: None });
        crate::meeting::begin_file(&app, &session_id, file);
        let worker_app = app.clone();
        let worker_session_id = session_id.clone();
        let failure_path = path.clone();
        let language = payload.language;
        let diarization_enabled = payload.diarization_enabled;
        let expected_speakers = payload.expected_speakers;
        let started = crate::host::async_runtime::spawn_blocking(move || {
            let model = crate::services::speech_model_repository::resolve_asr_model(&worker_app, &language)?;
            let diarization_model = diarization_enabled
                .then(|| crate::services::speech_model_repository::resolve_diarization_model(&worker_app, &language))
                .transpose()?;
            let state = worker_app.state::<SpeechRuntimeState>();
            speech_service::start_file_session(
                &worker_app,
                &state,
                worker_session_id,
                model,
                diarization_model,
                speech_service::FileCapture { path, duration_ms, expected_speakers },
            )
        })
        .await
        .map_err(|error| format!("El inicio de la transcripción terminó de forma inesperada: {error}"))
        .and_then(|result| result);
        if let Err(error) = started {
            if let Ok(mut phase) = app.state::<SpeechRuntimeState>().phase.lock() {
                *phase = SpeechPhase::Idle;
            }
            crate::meeting::discard_session(&app, &session_id);
            let _ = std::fs::remove_file(failure_path);
            #[cfg(target_os = "android")]
            if continuity_started {
                crate::mobile_continuity::end_android_work(app.state::<crate::mobile_continuity::ContinuityState>().inner());
            }
            return Err(invalid(error));
        }
        Ok(StartFileSessionDto { session_id })
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        // Without a speech runtime the file is never read.
        let _ = (take_ready_upload, payload.media_id, payload.diarization_enabled);
        Err(invalid(speech_service::not_integrated_error()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upload(expected_bytes: u64, written_bytes: u64) -> MediaUpload {
        MediaUpload {
            file: MeetingSourceFile::from_name("entrevista.mp4").expect("file"),
            path: PathBuf::new(),
            expected_bytes,
            written_bytes,
            summary: None,
            touched: Instant::now(),
        }
    }

    #[test]
    fn chunks_continue_the_upload_in_order_and_within_its_size() {
        let upload = upload(10, 4);
        assert!(check_chunk(&upload, 4, 6).is_ok());
        assert!(check_chunk(&upload, 0, 4).is_err(), "out of order");
        assert!(check_chunk(&upload, 4, 7).is_err(), "bigger than announced");
        assert!(check_chunk(&upload, 4, 0).is_err(), "empty");
        let mut finished = upload;
        finished.summary = Some(MediaSummary { duration_ms: 1_000, peaks: Vec::new() });
        assert!(check_chunk(&finished, 4, 1).is_err(), "already finished");
    }

    #[test]
    fn stale_copies_go_and_recent_or_held_ones_stay() {
        let directory = std::env::temp_dir().join(format!("notia-meeting-media-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("directory");
        let recent = directory.join("reciente.mp3");
        std::fs::write(&recent, b"x").expect("recent");
        remove_stale_copies(&directory, &[]);
        assert!(recent.exists(), "a recent copy stays");
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn a_dropped_upload_removes_its_copy_unless_a_session_took_it() {
        let directory = std::env::temp_dir().join(format!("notia-meeting-media-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("directory");
        let copy = directory.join("copia.mp3");
        std::fs::write(&copy, b"x").expect("copy");
        let mut held = upload(1, 1);
        held.path = copy.clone();
        drop(held);
        assert!(!copy.exists());
        std::fs::write(&copy, b"x").expect("copy");
        let mut taken = upload(1, 1);
        taken.path = copy.clone();
        let path = std::mem::take(&mut taken.path);
        drop(taken);
        assert!(path.exists(), "the session owns the copy");
        std::fs::remove_dir_all(&directory).ok();
    }
}
