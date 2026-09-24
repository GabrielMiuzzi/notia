//! Dictation from a remote client: the browser records, sends the audio in
//! ordered PCM chunks and, with the last one, receives the text recognized
//! by the same recognizer Telegram voice notes use. The chunk contract and
//! the assembly live in `backend-core::remote_audio`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notia_backend_core::remote_audio::{RemoteAudioAssembler, RemoteAudioChunk};

use crate::host::{AppHandle, State};

/// Recordings kept open at once; a client that never finishes one loses it
/// after `IDLE_TIMEOUT`.
const MAX_SESSIONS: usize = 4;
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_RECORDING_SECONDS: u32 = 5 * 60;

#[derive(Default)]
pub struct RemoteSpeechState {
    sessions: Mutex<HashMap<String, (RemoteAudioAssembler, Instant)>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSpeechChunkPayload {
    chunk: RemoteAudioChunk,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSpeechCancelPayload {
    session_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSpeechResultDto {
    done: bool,
    text: Option<String>,
}

fn lock_error() -> String {
    "No se pudo acceder a la grabación remota.".to_string()
}

/// Adds a chunk to its recording; the first chunk (sequence 0) opens it.
/// Returns the finished recording when the chunk is the last one.
fn accept_chunk(state: &RemoteSpeechState, chunk: &RemoteAudioChunk) -> Result<Option<RemoteAudioAssembler>, String> {
    let mut sessions = state.sessions.lock().map_err(|_| lock_error())?;
    let now = Instant::now();
    sessions.retain(|_, (_, touched)| now.duration_since(*touched) < IDLE_TIMEOUT);
    if chunk.sequence == 0 {
        if sessions.contains_key(&chunk.session_id) {
            return Err("La grabación remota ya existe.".to_string());
        }
        if sessions.len() >= MAX_SESSIONS {
            return Err("Hay demasiadas grabaciones remotas abiertas.".to_string());
        }
        sessions.insert(
            chunk.session_id.clone(),
            (RemoteAudioAssembler::new(&chunk.session_id, MAX_RECORDING_SECONDS), now),
        );
    }
    let (assembler, touched) = sessions
        .get_mut(&chunk.session_id)
        .ok_or_else(|| "La grabación remota no existe o venció.".to_string())?;
    let finished = match assembler.push(chunk) {
        Ok(finished) => finished,
        Err(error) => {
            sessions.remove(&chunk.session_id);
            return Err(error.message);
        }
    };
    *touched = now;
    Ok(if finished { sessions.remove(&chunk.session_id).map(|(assembler, _)| assembler) } else { None })
}

pub async fn speech_remote_audio(
    app: AppHandle,
    state: State<'_, RemoteSpeechState>,
    payload: RemoteSpeechChunkPayload,
) -> Result<RemoteSpeechResultDto, String> {
    let Some(recording) = accept_chunk(&state, &payload.chunk)? else {
        return Ok(RemoteSpeechResultDto { done: false, text: None });
    };
    let samples = recording.into_recognizer_samples();
    let text = crate::host::async_runtime::spawn_blocking(move || transcribe(&app, &samples))
        .await
        .map_err(|_| "Falló el reconocimiento de la grabación remota.".to_string())??;
    Ok(RemoteSpeechResultDto { done: true, text: Some(text) })
}

pub fn speech_remote_audio_cancel(
    state: State<'_, RemoteSpeechState>,
    payload: RemoteSpeechCancelPayload,
) -> Result<(), String> {
    state.sessions.lock().map_err(|_| lock_error())?.remove(&payload.session_id);
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn transcribe(app: &AppHandle, samples: &[f32]) -> Result<String, String> {
    use crate::host::Manager;
    use crate::services::speech_service::{self, SpeechRuntimeState};

    let state = app.state::<SpeechRuntimeState>();
    if state.phase.lock().map_err(|_| lock_error())?.is_active() {
        return Err("El dictado local está usando el reconocedor de voz; probá de nuevo en unos segundos.".to_string());
    }
    let recognizer = speech_service::recognizer_cache(&state);
    speech_service::transcribe_external_audio(app, &recognizer, samples)
        .map_err(|error| error.replace("en el audio de Telegram", "en la grabación"))
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
fn transcribe(_app: &AppHandle, _samples: &[f32]) -> Result<String, String> {
    Err("El reconocimiento de voz no está disponible en esta plataforma.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use notia_backend_core::remote_audio::RemoteAudioEncoding;

    fn chunk(session: &str, sequence: u64, last: bool) -> RemoteAudioChunk {
        RemoteAudioChunk {
            session_id: session.into(),
            sequence,
            encoding: RemoteAudioEncoding::PcmS16le,
            sample_rate: 16_000,
            channels: 1,
            last,
            data_base64: base64::engine::general_purpose::STANDARD.encode([0_u8, 0x40]),
        }
    }

    #[test]
    fn recordings_open_with_the_first_chunk_and_close_with_the_last() {
        let state = RemoteSpeechState::default();
        assert!(accept_chunk(&state, &chunk("a", 1, false)).is_err());
        assert!(accept_chunk(&state, &chunk("a", 0, false)).expect("opened").is_none());
        assert!(accept_chunk(&state, &chunk("a", 0, false)).is_err());
        let finished = accept_chunk(&state, &chunk("a", 1, true)).expect("finished").expect("recording");
        assert_eq!(finished.into_recognizer_samples().len(), 2);
        assert!(accept_chunk(&state, &chunk("a", 2, false)).is_err());
    }

    #[test]
    fn a_broken_chunk_drops_its_recording_and_sessions_are_bounded() {
        let state = RemoteSpeechState::default();
        accept_chunk(&state, &chunk("a", 0, false)).expect("opened");
        assert!(accept_chunk(&state, &chunk("a", 5, false)).is_err());
        assert!(accept_chunk(&state, &chunk("a", 1, false)).is_err());
        for session in ["b", "c", "d", "e"] {
            accept_chunk(&state, &chunk(session, 0, false)).expect("opened");
        }
        assert!(accept_chunk(&state, &chunk("f", 0, false)).is_err());
    }
}
