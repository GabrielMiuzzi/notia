//! A Meeting recorded by a client in Host mode. The client records and
//! recognizes on its own device (microphone, Parakeet, speakers), so a
//! tablet can transcribe a meeting in the room; the meeting itself (its
//! lines, marks, notes, live answers, AI, note, export and tasks) lives on
//! the host, like the rest of the client's library. The client's speech
//! service reports to `meeting` as always, and `meeting` sends each change
//! here instead of keeping it: one ordered queue per device, retried while
//! the host does not answer, plus a heartbeat while the meeting is live so
//! the host can tell a client that vanished. The host applies the events
//! with `meeting_relay` (see `meeting::meeting_relay`).

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::backend::BackendError;
use crate::dto::speech::{DiarizedTranscriptDto, MeetingSessionOptions, SpeechTranscriptSegmentDto};
use crate::host::AppHandle;
use crate::services::speech_audio::CaptureSources;

/// Wait before sending again an event the host did not take.
const RETRY_DELAY: Duration = Duration::from_secs(3);
/// Time between two heartbeats of a live relayed meeting.
pub(crate) const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60);
/// Events kept while the host is unreachable (a long meeting has a few
/// thousand lines); past it the oldest lines are dropped.
const MAX_QUEUED_EVENTS: usize = 20_000;

/// A change of a relayed meeting, as it travels to the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum RelayEvent {
    Begin { microphone: bool, system: bool, options: Value },
    BeginFile { name: String },
    Line { span: Option<(u64, u64)>, text: String },
    Processing { duration_ms: u64 },
    Completed { text: String, speaker_count: u32, segments: Vec<RelaySegment>, duration_ms: u64 },
    Interrupted,
    Discarded,
    Heartbeat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelaySegment {
    start_ms: u64,
    end_ms: u64,
    speaker_id: Option<String>,
    text: String,
}

/// Body of `meeting_relay`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelayPayload {
    pub(crate) session_id: String,
    pub(crate) event: RelayEvent,
}

impl RelayEvent {
    pub(crate) fn begin(sources: CaptureSources, options: &MeetingSessionOptions) -> Self {
        Self::Begin {
            microphone: sources.microphone,
            system: sources.system,
            options: serde_json::to_value(options).unwrap_or(Value::Null),
        }
    }

    pub(crate) fn completed(transcript: &DiarizedTranscriptDto, duration_ms: u64) -> Self {
        Self::Completed {
            text: transcript.text.clone(),
            speaker_count: transcript.speaker_count,
            segments: transcript
                .segments
                .iter()
                .map(|segment| RelaySegment {
                    start_ms: segment.start_ms,
                    end_ms: segment.end_ms,
                    speaker_id: segment.speaker_id.clone(),
                    text: segment.text.clone(),
                })
                .collect(),
            duration_ms,
        }
    }

    /// Whether the meeting is over after this event: no more heartbeats.
    fn ends(&self) -> bool {
        matches!(self, Self::Completed { .. } | Self::Interrupted | Self::Discarded)
    }
}

/// The transcript a `Completed` event carries, as the host keeps it.
pub(crate) fn transcript_of(text: String, speaker_count: u32, segments: Vec<RelaySegment>) -> DiarizedTranscriptDto {
    DiarizedTranscriptDto {
        text,
        speaker_count,
        segments: segments
            .into_iter()
            .enumerate()
            .map(|(index, segment)| SpeechTranscriptSegmentDto {
                id: format!("segment-{}", index + 1),
                start_ms: segment.start_ms,
                end_ms: segment.end_ms,
                speaker_id: segment.speaker_id,
                text: segment.text,
                is_final: true,
            })
            .collect(),
    }
}

#[derive(Default)]
struct RelayQueue {
    events: VecDeque<RelayPayload>,
    /// The relayed meeting still recording or processing, for heartbeats.
    live: Option<String>,
    worker: bool,
}

fn queue() -> &'static (Mutex<RelayQueue>, Condvar) {
    static QUEUE: OnceLock<(Mutex<RelayQueue>, Condvar)> = OnceLock::new();
    QUEUE.get_or_init(|| (Mutex::new(RelayQueue::default()), Condvar::new()))
}

/// Queues `event` of the meeting `session_id` for the host, after the
/// events queued before it.
pub(crate) fn send(app: &AppHandle, session_id: &str, event: RelayEvent) {
    let (lock, ready) = queue();
    let Ok(mut state) = lock.lock() else { return };
    match &event {
        RelayEvent::Begin { .. } | RelayEvent::BeginFile { .. } => state.live = Some(session_id.to_string()),
        event if event.ends() && state.live.as_deref() == Some(session_id) => state.live = None,
        _ => {}
    }
    state.events.push_back(RelayPayload { session_id: session_id.to_string(), event });
    trim(&mut state.events);
    if !state.worker {
        state.worker = true;
        let app = app.clone();
        if std::thread::Builder::new().name("notia-meeting-relay".into()).spawn(move || run(&app)).is_err() {
            state.worker = false;
            log::error!("[notia:meeting] no se pudo iniciar el envío de la reunión al host");
        }
    }
    ready.notify_one();
}

/// Drops the oldest lines past the limit; the other events are kept.
fn trim(events: &mut VecDeque<RelayPayload>) {
    while events.len() > MAX_QUEUED_EVENTS {
        let Some(index) = events.iter().position(|payload| matches!(payload.event, RelayEvent::Line { .. } | RelayEvent::Heartbeat)) else {
            return;
        };
        events.remove(index);
        log::error!("[notia:meeting] el host no responde: se descartó una línea vieja de la reunión");
    }
}

/// Sends the queue in order. An event the host refuses for good is dropped
/// (a refused start also ends the recording here); one the host could not
/// take now is sent again. Without events, a live meeting gets heartbeats.
fn run(app: &AppHandle) {
    let (lock, ready) = queue();
    loop {
        let next = {
            let Ok(mut state) = lock.lock() else { return };
            if state.events.is_empty() {
                let Ok((waited, timeout)) = ready.wait_timeout(state, HEARTBEAT_INTERVAL) else { return };
                state = waited;
                if timeout.timed_out() && state.events.is_empty() {
                    if let Some(session_id) = state.live.clone() {
                        state.events.push_back(RelayPayload { session_id, event: RelayEvent::Heartbeat });
                    }
                }
            }
            state.events.front().cloned()
        };
        let Some(payload) = next else { continue };
        if !crate::host_client::uses_host(app) {
            // The device left Host mode or works offline: nobody to tell.
            if let Ok(mut state) = lock.lock() {
                state.events.clear();
                state.live = None;
            }
            continue;
        }
        let result = crate::host::async_runtime::block_on(crate::host_client::call_host::<Value>(
            app,
            "meeting_relay",
            json!({ "payload": payload }),
        ));
        match result {
            Ok(_) => pop(&payload),
            Err(error) if error.retryable => std::thread::sleep(RETRY_DELAY),
            Err(error) => {
                pop(&payload);
                refused(app, &payload, &error);
            }
        }
    }
}

fn pop(payload: &RelayPayload) {
    let (lock, _) = queue();
    if let Ok(mut state) = lock.lock() {
        if state.events.front() == Some(payload) {
            state.events.pop_front();
        }
    }
}

/// The host refused an event for good. A refused start ends the recording
/// here with the host's reason; the rest is only logged.
fn refused(app: &AppHandle, payload: &RelayPayload, error: &BackendError) {
    if matches!(payload.event, RelayEvent::Begin { .. } | RelayEvent::BeginFile { .. }) {
        if let Ok(mut state) = queue().0.lock() {
            if state.live.as_deref() == Some(payload.session_id.as_str()) {
                state.live = None;
            }
            state.events.retain(|queued| queued.session_id != payload.session_id);
        }
        crate::services::speech_service::abort_session(app, &payload.session_id, &error.message);
    } else {
        log::error!("[notia:meeting] el host rechazó un cambio de la reunión: {:?}", error.code);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_travel_as_tagged_json_and_back() {
        let payload = RelayPayload {
            session_id: "s-1".into(),
            event: RelayEvent::Line { span: Some((1_000, 2_500)), text: "Hola.".into() },
        };
        let wire = serde_json::to_value(&payload).expect("json");
        assert_eq!(wire, json!({ "sessionId": "s-1", "event": { "kind": "line", "span": [1_000, 2_500], "text": "Hola." } }));
        assert_eq!(serde_json::from_value::<RelayPayload>(wire).expect("payload"), payload);
        let processing = serde_json::to_value(RelayEvent::Processing { duration_ms: 9 }).expect("json");
        assert_eq!(processing, json!({ "kind": "processing", "durationMs": 9 }));
    }

    #[test]
    fn a_completed_meeting_keeps_its_turns() {
        let transcript = transcript_of(
            "Hola. Chau.".into(),
            2,
            vec![
                RelaySegment { start_ms: 0, end_ms: 900, speaker_id: Some("speaker-1".into()), text: "Hola.".into() },
                RelaySegment { start_ms: 1_000, end_ms: 1_800, speaker_id: Some("speaker-2".into()), text: "Chau.".into() },
            ],
        );
        let RelayEvent::Completed { segments, speaker_count, .. } = RelayEvent::completed(&transcript, 2_000) else {
            panic!("completed");
        };
        assert_eq!(speaker_count, 2);
        assert_eq!(segments[1].speaker_id.as_deref(), Some("speaker-2"));
        assert!(RelayEvent::Discarded.ends() && !RelayEvent::Heartbeat.ends());
    }

    #[test]
    fn a_full_queue_drops_old_lines_first() {
        let mut events = VecDeque::new();
        events.push_back(RelayPayload { session_id: "s".into(), event: RelayEvent::BeginFile { name: "a.mp3".into() } });
        for index in 0..MAX_QUEUED_EVENTS {
            events.push_back(RelayPayload { session_id: "s".into(), event: RelayEvent::Line { span: None, text: index.to_string() } });
        }
        trim(&mut events);
        assert_eq!(events.len(), MAX_QUEUED_EVENTS);
        assert!(matches!(events[0].event, RelayEvent::BeginFile { .. }));
        assert!(matches!(&events[1].event, RelayEvent::Line { text, .. } if text == "1"));
    }
}
