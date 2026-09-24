//! Periodic `speech://levels` events with the loudness of each source of a
//! capture: a Meeting session or an audio check before recording.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::dto::speech::SpeechLevelsEventDto;
use crate::host::{AppHandle, Emitter};
use crate::services::speech_audio::{CaptureSources, SharedCaptureMeter};

const LEVELS_EVENT: &str = "speech://levels";
const INTERVAL: Duration = Duration::from_millis(100);

/// Emits the levels until dropped or until `lifetime` runs out, when it
/// calls `on_expired` once.
pub struct LevelReporter {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl LevelReporter {
    pub fn start(
        app: AppHandle,
        id: String,
        meter: SharedCaptureMeter,
        sources: CaptureSources,
        lifetime: Option<(Duration, Box<dyn FnOnce() + Send>)>,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("notia-speech-levels".to_string())
            .spawn(move || {
                let started_at = Instant::now();
                let (limit, mut on_expired) = match lifetime {
                    Some((limit, on_expired)) => (Some(limit), Some(on_expired)),
                    None => (None, None),
                };
                while !thread_stop.load(Ordering::Acquire) {
                    std::thread::sleep(INTERVAL);
                    if limit.is_some_and(|limit| started_at.elapsed() >= limit) {
                        thread_stop.store(true, Ordering::Release);
                        if let Some(on_expired) = on_expired.take() {
                            on_expired();
                        }
                        break;
                    }
                    let (microphone, system) = meter.take_levels();
                    let _ = app.emit(
                        LEVELS_EVENT,
                        SpeechLevelsEventDto {
                            session_id: id.clone(),
                            microphone: sources.microphone.then_some(microphone),
                            system: sources.system.then_some(system),
                        },
                    );
                }
            })
            .map_err(|error| format!("No se pudo iniciar el medidor de audio: {error}"))?;
        Ok(Self { stop, thread: Some(thread) })
    }
}

impl Drop for LevelReporter {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let Some(thread) = self.thread.take() else { return };
        // The expiry callback may drop the reporter from its own thread,
        // which cannot wait for itself.
        if thread.thread().id() != std::thread::current().id() {
            let _ = thread.join();
        }
    }
}
