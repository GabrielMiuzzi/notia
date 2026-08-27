use crate::services::speech_audio::{PcmBufferStats, SharedPcmBuffer, SPEECH_SAMPLE_RATE};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const PCM_CHUNK_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize / 5;
const CONTROL_POLL_INTERVAL: Duration = Duration::from_millis(20);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RECORDED_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize * 15 * 60;

#[derive(Debug, Clone, PartialEq)]
pub struct RecognitionUpdate {
    pub text: String,
    pub endpoint_detected: bool,
}

pub trait StreamingRecognizer {
    fn update_capture_stats(&mut self, _stats: PcmBufferStats) {}
    fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String>;
    fn finish(&mut self) -> Result<RecognitionUpdate, String>;
    fn reset_after_endpoint(&mut self) -> Result<(), String>;
    fn reset_session(&mut self) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq)]
pub enum SpeechWorkerEvent {
    Ready,
    Partial(RecognitionUpdate),
    Finished {
        update: RecognitionUpdate,
        samples: Vec<f32>,
    },
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerCommand {
    Pause,
    Resume,
    Stop,
    Cancel,
}

pub struct SpeechWorker {
    command_tx: Sender<WorkerCommand>,
    join_handle: Option<JoinHandle<()>>,
}

impl SpeechWorker {
    #[cfg(test)]
    pub fn start<R, F, C>(
        buffer: SharedPcmBuffer,
        recognizer_factory: F,
        event_callback: C,
    ) -> Result<Self, String>
    where
        R: StreamingRecognizer + 'static,
        F: FnOnce() -> Result<R, String> + Send + 'static,
        C: Fn(SpeechWorkerEvent) + Send + 'static,
    {
        Self::start_with_recycler(buffer, recognizer_factory, event_callback, drop)
    }

    pub fn start_with_recycler<R, F, C, D>(
        buffer: SharedPcmBuffer,
        recognizer_factory: F,
        event_callback: C,
        recognizer_recycler: D,
    ) -> Result<Self, String>
    where
        R: StreamingRecognizer + 'static,
        F: FnOnce() -> Result<R, String> + Send + 'static,
        C: Fn(SpeechWorkerEvent) + Send + 'static,
        D: FnOnce(R) + Send + 'static,
    {
        let (command_tx, command_rx) = mpsc::channel();
        let (startup_tx, startup_rx) = mpsc::sync_channel(1);
        let join_handle = thread::Builder::new()
            .name("notia-speech-asr".to_string())
            .spawn(move || {
                run_worker(
                    buffer,
                    command_rx,
                    startup_tx,
                    recognizer_factory,
                    event_callback,
                    recognizer_recycler,
                )
            })
            .map_err(|error| format!("No se pudo iniciar el worker de voz: {error}"))?;
        let worker = Self {
            command_tx,
            join_handle: Some(join_handle),
        };
        match startup_rx.recv_timeout(STARTUP_TIMEOUT) {
            Ok(Ok(())) => Ok(worker),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("El reconocedor de voz excedio el tiempo de inicio.".to_string()),
        }
    }

    pub fn pause(&self) -> Result<(), String> {
        self.send(WorkerCommand::Pause)
    }

    pub fn resume(&self) -> Result<(), String> {
        self.send(WorkerCommand::Resume)
    }

    pub fn stop(&self) -> Result<(), String> {
        self.send(WorkerCommand::Stop)
    }

    pub fn cancel(&self) -> Result<(), String> {
        self.send(WorkerCommand::Cancel)
    }

    pub fn join(mut self) -> Result<(), String> {
        self.join_inner()
    }

    fn send(&self, command: WorkerCommand) -> Result<(), String> {
        self.command_tx
            .send(command)
            .map_err(|_| "El worker de voz ya no esta disponible.".to_string())
    }

    fn join_inner(&mut self) -> Result<(), String> {
        let Some(handle) = self.join_handle.take() else {
            return Ok(());
        };
        handle
            .join()
            .map_err(|_| "El worker de voz finalizo de forma inesperada.".to_string())
    }
}

impl Drop for SpeechWorker {
    fn drop(&mut self) {
        if self.join_handle.is_some() {
            let _ = self.command_tx.send(WorkerCommand::Cancel);
            let _ = self.join_inner();
        }
    }
}

fn run_worker<R, F, C, D>(
    buffer: SharedPcmBuffer,
    command_rx: Receiver<WorkerCommand>,
    startup_tx: SyncSender<Result<(), String>>,
    recognizer_factory: F,
    event_callback: C,
    recognizer_recycler: D,
) where
    R: StreamingRecognizer,
    F: FnOnce() -> Result<R, String>,
    C: Fn(SpeechWorkerEvent),
    D: FnOnce(R),
{
    let recognizer = match recognizer_factory() {
        Ok(recognizer) => recognizer,
        Err(error) => {
            let _ = startup_tx.send(Err(error));
            return;
        }
    };
    let mut recognizer = RecycledRecognizer::new(recognizer, recognizer_recycler);
    if startup_tx.send(Ok(())).is_err() {
        return;
    }
    event_callback(SpeechWorkerEvent::Ready);
    let mut paused = false;
    let mut recorded_samples = Vec::new();
    loop {
        match command_rx.recv_timeout(CONTROL_POLL_INTERVAL) {
            Ok(WorkerCommand::Pause) => paused = true,
            Ok(WorkerCommand::Resume) => paused = false,
            Ok(WorkerCommand::Cancel) | Err(RecvTimeoutError::Disconnected) => return,
            Ok(WorkerCommand::Stop) => {
                if let Err(error) = drain_all(
                    &buffer,
                    recognizer.get_mut(),
                    &event_callback,
                    &mut recorded_samples,
                ) {
                    event_callback(SpeechWorkerEvent::Error(error));
                    return;
                }
                match recognizer.get_mut().finish() {
                    Ok(update) => match recognizer.recycle_now() {
                        Ok(()) => event_callback(SpeechWorkerEvent::Finished {
                            update,
                            samples: recorded_samples,
                        }),
                        Err(error) => event_callback(SpeechWorkerEvent::Error(error)),
                    },
                    Err(error) => event_callback(SpeechWorkerEvent::Error(error)),
                }
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        if paused {
            continue;
        }
        match take_ready_chunk(&buffer) {
            Ok(samples) if samples.is_empty() => {}
            Ok(samples) => {
                match read_buffer_stats(&buffer) {
                    Ok(stats) => recognizer.get_mut().update_capture_stats(stats),
                    Err(error) => {
                        event_callback(SpeechWorkerEvent::Error(error));
                        return;
                    }
                }
                if let Err(error) = archive_samples(&mut recorded_samples, &samples)
                    .and_then(|()| process_samples(recognizer.get_mut(), &samples, &event_callback))
                {
                    event_callback(SpeechWorkerEvent::Error(error));
                    return;
                }
            }
            Err(error) => {
                event_callback(SpeechWorkerEvent::Error(error));
                return;
            }
        }
    }
}

struct RecycledRecognizer<R: StreamingRecognizer, D: FnOnce(R)> {
    recognizer: Option<R>,
    recycler: Option<D>,
}

impl<R: StreamingRecognizer, D: FnOnce(R)> RecycledRecognizer<R, D> {
    fn new(recognizer: R, recycler: D) -> Self {
        Self {
            recognizer: Some(recognizer),
            recycler: Some(recycler),
        }
    }

    fn get_mut(&mut self) -> &mut R {
        self.recognizer.as_mut().expect("recognizer is present")
    }

    fn recycle_now(&mut self) -> Result<(), String> {
        let Some(mut recognizer) = self.recognizer.take() else {
            return Ok(());
        };
        recognizer.reset_session()?;
        if let Some(recycler) = self.recycler.take() {
            recycler(recognizer);
        }
        Ok(())
    }
}

impl<R: StreamingRecognizer, D: FnOnce(R)> Drop for RecycledRecognizer<R, D> {
    fn drop(&mut self) {
        let Some(mut recognizer) = self.recognizer.take() else {
            return;
        };
        if recognizer.reset_session().is_ok() {
            if let Some(recycler) = self.recycler.take() {
                recycler(recognizer);
            }
        }
    }
}

fn drain_all<R, C>(
    buffer: &SharedPcmBuffer,
    recognizer: &mut R,
    callback: &C,
    recorded_samples: &mut Vec<f32>,
) -> Result<(), String>
where
    R: StreamingRecognizer,
    C: Fn(SpeechWorkerEvent),
{
    loop {
        let samples = take_samples(buffer, PCM_CHUNK_SAMPLES)?;
        if samples.is_empty() {
            return Ok(());
        }
        archive_samples(recorded_samples, &samples)?;
        process_samples(recognizer, &samples, callback)?;
    }
}

fn archive_samples(target: &mut Vec<f32>, samples: &[f32]) -> Result<(), String> {
    if target.len().saturating_add(samples.len()) > MAX_RECORDED_SAMPLES {
        return Err("La sesion alcanzo el limite de quince minutos.".to_string());
    }
    target.extend_from_slice(samples);
    Ok(())
}

fn process_samples<R, C>(recognizer: &mut R, samples: &[f32], callback: &C) -> Result<(), String>
where
    R: StreamingRecognizer,
    C: Fn(SpeechWorkerEvent),
{
    let update = recognizer.accept_waveform(samples)?;
    let endpoint = update.endpoint_detected;
    callback(SpeechWorkerEvent::Partial(update));
    if endpoint {
        recognizer.reset_after_endpoint()?;
    }
    Ok(())
}

fn take_samples(buffer: &SharedPcmBuffer, max_samples: usize) -> Result<Vec<f32>, String> {
    buffer
        .lock()
        .map_err(|_| "No se pudo bloquear la cola PCM del worker.".to_string())
        .map(|mut buffer| buffer.drain(max_samples))
}

fn take_ready_chunk(buffer: &SharedPcmBuffer) -> Result<Vec<f32>, String> {
    buffer
        .lock()
        .map_err(|_| "No se pudo bloquear la cola PCM del worker.".to_string())
        .map(|mut buffer| {
            if buffer.stats().buffered_samples < PCM_CHUNK_SAMPLES {
                Vec::new()
            } else {
                buffer.drain(PCM_CHUNK_SAMPLES)
            }
        })
}

fn read_buffer_stats(buffer: &SharedPcmBuffer) -> Result<PcmBufferStats, String> {
    buffer
        .lock()
        .map_err(|_| "No se pudo consultar la cola PCM del worker.".to_string())
        .map(|buffer| buffer.stats())
}

#[cfg(test)]
mod tests {
    use super::{RecognitionUpdate, SpeechWorker, SpeechWorkerEvent, StreamingRecognizer};
    use crate::services::speech_audio::BoundedPcmBuffer;
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    struct FakeRecognizer {
        accepted_samples: usize,
    }

    impl StreamingRecognizer for FakeRecognizer {
        fn accept_waveform(&mut self, samples: &[f32]) -> Result<RecognitionUpdate, String> {
            self.accepted_samples += samples.len();
            Ok(RecognitionUpdate {
                text: self.accepted_samples.to_string(),
                endpoint_detected: false,
            })
        }

        fn finish(&mut self) -> Result<RecognitionUpdate, String> {
            Ok(RecognitionUpdate {
                text: format!("final:{}", self.accepted_samples),
                endpoint_detected: false,
            })
        }

        fn reset_after_endpoint(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn reset_session(&mut self) -> Result<(), String> {
            self.accepted_samples = 0;
            Ok(())
        }
    }

    #[test]
    fn stop_drains_pcm_and_emits_a_final_result() {
        let mut pcm = BoundedPcmBuffer::with_capacity(16).expect("valid test buffer");
        pcm.push([0.1, 0.2, 0.3]);
        let pcm = Arc::new(Mutex::new(pcm));
        let events = Arc::new(Mutex::new(Vec::new()));
        let callback_events = Arc::clone(&events);
        let worker = SpeechWorker::start(
            pcm,
            || Ok(FakeRecognizer::default()),
            move |event| {
                callback_events.lock().expect("event lock").push(event);
            },
        )
        .expect("start worker");
        worker.stop().expect("stop worker");
        worker.join().expect("join worker");
        let events = events.lock().expect("read events");
        assert!(events.iter().any(|event| matches!(
            event,
            SpeechWorkerEvent::Finished { update, samples } if update.text == "final:3" && samples.len() == 3
        )));
    }

    #[test]
    fn cancel_does_not_finalize_recognition() {
        let pcm = Arc::new(Mutex::new(
            BoundedPcmBuffer::with_capacity(16).expect("valid test buffer"),
        ));
        let events = Arc::new(Mutex::new(Vec::new()));
        let callback_events = Arc::clone(&events);
        let worker = SpeechWorker::start(
            pcm,
            || Ok(FakeRecognizer::default()),
            move |event| {
                callback_events.lock().expect("event lock").push(event);
            },
        )
        .expect("start worker");
        worker.pause().expect("pause worker");
        worker.resume().expect("resume worker");
        worker.cancel().expect("cancel worker");
        worker.join().expect("join worker");
        assert!(!events
            .lock()
            .expect("read events")
            .iter()
            .any(|event| matches!(event, SpeechWorkerEvent::Finished { .. })));
    }

    #[test]
    fn cancel_resets_and_recycles_recognizer() {
        let pcm = Arc::new(Mutex::new(
            BoundedPcmBuffer::with_capacity(16).expect("valid test buffer"),
        ));
        let recycled = Arc::new(Mutex::new(None));
        let recycled_result = Arc::clone(&recycled);
        let worker = SpeechWorker::start_with_recycler(
            pcm,
            || {
                Ok(FakeRecognizer {
                    accepted_samples: 7,
                })
            },
            |_| {},
            move |recognizer| {
                *recycled_result.lock().expect("recycle lock") = Some(recognizer);
            },
        )
        .expect("start worker");

        worker.cancel().expect("cancel worker");
        worker.join().expect("join worker");

        assert_eq!(
            recycled
                .lock()
                .expect("read recycled recognizer")
                .as_ref()
                .expect("recognizer was recycled")
                .accepted_samples,
            0
        );
    }

    #[test]
    fn stop_recycles_recognizer_before_emitting_finished() {
        let mut pcm = BoundedPcmBuffer::with_capacity(16).expect("valid test buffer");
        pcm.push([0.1, 0.2, 0.3]);
        let pcm = Arc::new(Mutex::new(pcm));
        let recycled = Arc::new(Mutex::new(false));
        let callback_recycled = Arc::clone(&recycled);
        let recycler_recycled = Arc::clone(&recycled);
        let observed = Arc::new(Mutex::new(false));
        let callback_observed = Arc::clone(&observed);
        let worker = SpeechWorker::start_with_recycler(
            pcm,
            || Ok(FakeRecognizer::default()),
            move |event| {
                if matches!(event, SpeechWorkerEvent::Finished { .. }) {
                    *callback_observed.lock().expect("observation lock") =
                        *callback_recycled.lock().expect("recycle lock");
                }
            },
            move |_| *recycler_recycled.lock().expect("recycle lock") = true,
        )
        .expect("start worker");

        worker.stop().expect("stop worker");
        worker.join().expect("join worker");

        assert!(*observed.lock().expect("read observation"));
    }
}
