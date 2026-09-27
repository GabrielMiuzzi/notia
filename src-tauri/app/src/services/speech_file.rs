//! An audio or video file fed into a speech session. A thread decodes the
//! file (`media_decoder`) and pushes its 16 kHz samples into the session's
//! queue at the pace the recognizer takes them, so nothing is dropped and
//! the same worker, archive and speaker separation as a recording apply.
//! When the whole file is in, the session finishes like a stopped recording.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::dto::speech::SpeechSessionStateDto;
use crate::host::AppHandle;
use crate::services::media_decoder::{self, OUTPUT_SAMPLE_RATE};
use crate::services::speech_audio::{SharedCaptureMeter, SharedPcmBuffer};

/// Samples the queue may hold ahead of the recognizer: well under the
/// queue's capacity, which drops the oldest audio when it overflows.
const FEED_AHEAD_SAMPLES: usize = OUTPUT_SAMPLE_RATE as usize * 5;
const ROOM_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// The thread feeding a file into a session. Dropping it stops the feed;
/// the thread ends on its own and removes the file it read.
pub struct FileFeeder {
    cancel: Arc<AtomicBool>,
}

impl FileFeeder {
    pub fn start(
        app: AppHandle,
        session_id: String,
        path: PathBuf,
        duration_ms: u64,
        buffer: SharedPcmBuffer,
        meter: SharedCaptureMeter,
    ) -> Result<Self, String> {
        let cancel = Arc::new(AtomicBool::new(false));
        let thread_cancel = Arc::clone(&cancel);
        thread::Builder::new()
            .name("notia-speech-file".to_string())
            .spawn(move || feed(&app, &session_id, &path, duration_ms, &buffer, &meter, &thread_cancel))
            .map_err(|error| format!("No se pudo iniciar la lectura del archivo: {error}"))?;
        Ok(Self { cancel })
    }
}

impl Drop for FileFeeder {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

fn feed(
    app: &AppHandle,
    session_id: &str,
    path: &std::path::Path,
    duration_ms: u64,
    buffer: &SharedPcmBuffer,
    meter: &SharedCaptureMeter,
    cancel: &AtomicBool,
) {
    let total_samples = duration_ms.saturating_mul(u64::from(OUTPUT_SAMPLE_RATE)) / 1_000;
    let mut progress = FeedProgress::new(total_samples);
    let result = media_decoder::decode(path, cancel, |samples| {
        wait_for_room(buffer, samples.len(), cancel)?;
        buffer
            .lock()
            .map_err(|_| "No se pudo pasar el audio del archivo al reconocedor.".to_string())?
            .push(samples.iter().copied());
        meter.add_delivered(samples.len());
        if let Some(fraction) = progress.advance(samples.len()) {
            crate::services::speech_service::emit_session_state(
                app,
                session_id,
                SpeechSessionStateDto::Finalizing { progress: Some(fraction), stage: Some("transcribing") },
            );
        }
        Ok(())
    });
    // The recognizer archives what it heard; the uploaded copy is not needed.
    let _ = std::fs::remove_file(path);
    match result {
        Ok(()) => crate::services::speech_service::finish_file_session(app, session_id),
        Err(_) if cancel.load(Ordering::Relaxed) => {}
        Err(error) => {
            // A file damaged near its end keeps what was recognized until then.
            log::warn!("[notia:speech] the file could not be read to the end: {error}");
            crate::services::speech_service::finish_file_session(app, session_id);
        }
    }
}

/// Waits until the queue has room for `incoming` samples. An empty queue
/// always takes the chunk, whatever its size.
fn wait_for_room(buffer: &SharedPcmBuffer, incoming: usize, cancel: &AtomicBool) -> Result<(), String> {
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Se canceló la transcripción del archivo.".to_string());
        }
        let queued = buffer
            .lock()
            .map_err(|_| "No se pudo leer la cola de audio.".to_string())?
            .stats()
            .buffered_samples;
        if queued == 0 || queued + incoming <= FEED_AHEAD_SAMPLES {
            return Ok(());
        }
        thread::sleep(ROOM_POLL_INTERVAL);
    }
}

/// Share of the file already fed, reported once per percentage point and
/// kept under 1 until the recognizer finishes.
struct FeedProgress {
    total_samples: u64,
    fed_samples: u64,
    reported_percent: Option<u64>,
}

impl FeedProgress {
    fn new(total_samples: u64) -> Self {
        Self { total_samples: total_samples.max(1), fed_samples: 0, reported_percent: None }
    }

    fn advance(&mut self, samples: usize) -> Option<f32> {
        self.fed_samples = self.fed_samples.saturating_add(samples as u64);
        let percent = (self.fed_samples * 100 / self.total_samples).min(99);
        if self.reported_percent == Some(percent) {
            return None;
        }
        self.reported_percent = Some(percent);
        Some(percent as f32 / 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_is_reported_once_per_point_and_never_reaches_one() {
        let mut progress = FeedProgress::new(1_000);
        assert_eq!(progress.advance(5), Some(0.0));
        assert_eq!(progress.advance(4), None);
        assert_eq!(progress.advance(1), Some(0.01));
        assert_eq!(progress.advance(2_000), Some(0.99));
        assert_eq!(progress.advance(10), None);
    }

    #[test]
    fn the_feed_waits_for_room_and_stops_when_cancelled() {
        let buffer = crate::services::speech_audio::create_shared_pcm_buffer();
        let cancel = AtomicBool::new(false);
        assert!(wait_for_room(&buffer, FEED_AHEAD_SAMPLES * 2, &cancel).is_ok(), "an empty queue takes any chunk");
        buffer.lock().expect("buffer").push(std::iter::repeat_n(0.1, FEED_AHEAD_SAMPLES));
        cancel.store(true, Ordering::Relaxed);
        assert!(wait_for_room(&buffer, 1, &cancel).is_err(), "a full queue waits until cancelled");
    }
}
