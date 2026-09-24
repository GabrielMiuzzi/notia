//! Delivers the events of the application to the connected remote clients.
//! Every event gets a sequence number and the last ones are kept, so a
//! client that reconnects receives what it missed before the live events.

use std::collections::VecDeque;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::Mutex;

use serde_json::Value;

use crate::host::EventSink;

/// Messages a slow client may have pending before it is disconnected.
const CLIENT_QUEUE_LIMIT: usize = 256;
/// Events kept for clients that reconnect.
const HISTORY_LIMIT: usize = 512;
/// Sent instead of a replay when the missed events are no longer kept; the
/// client then reloads what it shows.
pub(crate) const EVENTS_LOST: &str = "notia:events-lost";

struct HubState {
    next_sequence: u64,
    history: VecDeque<(u64, String)>,
    subscribers: Vec<SyncSender<String>>,
}

pub(crate) struct EventHub {
    state: Mutex<HubState>,
}

impl Default for EventHub {
    /// Numbering starts at the start time in microseconds, so the sequences
    /// of a restarted server are above those a client saw before: its
    /// reconnection then reports lost events instead of an empty replay.
    fn default() -> Self {
        let started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_micros() as u64)
            .unwrap_or_default();
        Self::starting_after(started)
    }
}

fn message(sequence: u64, event: &str, payload: &Value) -> String {
    serde_json::json!({ "seq": sequence, "event": event, "payload": payload }).to_string()
}

impl EventHub {
    fn starting_after(sequence: u64) -> Self {
        Self {
            state: Mutex::new(HubState {
                next_sequence: sequence,
                history: VecDeque::new(),
                subscribers: Vec::new(),
            }),
        }
    }

    /// New subscription and the events after `since` the client missed. The
    /// replay and the subscription are taken together, so no event falls
    /// between them. The subscription ends when the receiver is dropped.
    pub(crate) fn subscribe(&self, since: Option<u64>) -> (Receiver<String>, Vec<String>) {
        let (sender, receiver) = sync_channel(CLIENT_QUEUE_LIMIT);
        let Ok(mut state) = self.state.lock() else {
            return (receiver, Vec::new());
        };
        let replay = match since {
            None => Vec::new(),
            Some(since) => {
                let oldest = state.history.front().map(|(sequence, _)| *sequence);
                // A sequence ahead of the server comes from an earlier run.
                let from_other_run = since > state.next_sequence;
                let missed_unkept = since + 1 < state.next_sequence
                    && oldest.is_none_or(|oldest| oldest > since + 1);
                if from_other_run || missed_unkept {
                    vec![message(0, EVENTS_LOST, &Value::Null)]
                } else {
                    state
                        .history
                        .iter()
                        .filter(|(sequence, _)| *sequence > since)
                        .map(|(_, text)| text.clone())
                        .collect()
                }
            }
        };
        state.subscribers.push(sender);
        (receiver, replay)
    }

    #[cfg(test)]
    fn subscriber_count(&self) -> usize {
        self.state.lock().map(|state| state.subscribers.len()).unwrap_or_default()
    }
}

impl EventSink for EventHub {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "event hub unavailable".to_string())?;
        state.next_sequence += 1;
        let text = message(state.next_sequence, event, &payload);
        let sequence = state.next_sequence;
        state.history.push_back((sequence, text.clone()));
        if state.history.len() > HISTORY_LIMIT {
            state.history.pop_front();
        }
        // Closed or overflowing clients are dropped; they replay on reconnect.
        state.subscribers.retain(|subscriber| match subscriber.try_send(text.clone()) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Value {
        serde_json::from_str(text).expect("json")
    }

    #[test]
    fn delivers_numbered_events_and_forgets_closed_clients() {
        let hub = EventHub::starting_after(0);
        let (first, _) = hub.subscribe(None);
        let (second, _) = hub.subscribe(None);
        drop(second);
        hub.emit("multichat-event", serde_json::json!({ "roomId": "r" })).expect("emit");
        let message = parse(&first.recv().expect("message"));
        assert_eq!(message["seq"], 1);
        assert_eq!(message["event"], "multichat-event");
        assert_eq!(message["payload"]["roomId"], "r");
        assert_eq!(hub.subscriber_count(), 1);
    }

    #[test]
    fn a_reconnecting_client_receives_what_it_missed() {
        let hub = EventHub::starting_after(0);
        for index in 0..3 {
            hub.emit("task-manager-changed", serde_json::json!({ "index": index })).expect("emit");
        }
        let (_, replay) = hub.subscribe(Some(1));
        let sequences: Vec<Value> = replay.iter().map(|text| parse(text)["seq"].clone()).collect();
        assert_eq!(sequences, vec![serde_json::json!(2), serde_json::json!(3)]);
        let (_, nothing) = hub.subscribe(Some(3));
        assert!(nothing.is_empty());
    }

    #[test]
    fn reports_lost_events_when_the_history_no_longer_has_them() {
        let hub = EventHub::starting_after(0);
        for _ in 0..HISTORY_LIMIT + 5 {
            hub.emit("notia-library-tree-changed", Value::Null).expect("emit");
        }
        let (_, replay) = hub.subscribe(Some(1));
        assert_eq!(replay.len(), 1);
        assert_eq!(parse(&replay[0])["event"], EVENTS_LOST);
    }

    #[test]
    fn a_client_of_an_earlier_run_learns_that_it_lost_events() {
        let earlier = EventHub::starting_after(0);
        earlier.emit("task-manager-changed", Value::Null).expect("emit");
        let restarted = EventHub::starting_after(1_000);
        let (_, behind) = restarted.subscribe(Some(1));
        assert_eq!(parse(&behind[0])["event"], EVENTS_LOST);
        let (_, ahead) = EventHub::starting_after(0).subscribe(Some(1));
        assert_eq!(parse(&ahead[0])["event"], EVENTS_LOST);
    }

    #[test]
    fn a_new_server_numbers_after_the_previous_ones() {
        assert!(EventHub::default().state.lock().expect("state").next_sequence > 1_000_000);
    }
}
