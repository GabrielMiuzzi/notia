//! Adaptador de eventos para el host Tauri.
//!
//! El core backend no importa Tauri. Este módulo traduce eventos seguros del
//! runtime a eventos de la ventana cuando el cliente local está disponible.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use crate::host::{AppHandle, Emitter};

use crate::backend::{
    BackendError, BackendErrorCode, BackendEvent, BackendEventEnvelope, BackendEventSink,
    BackendLimits, BackendRequestContext, BackendRequestEnvelope, ProtocolVersion,
};

pub const BACKEND_EVENT: &str = "notia:backend-event";
const MAX_REPLAY_EVENTS_PER_REQUEST: usize = 512;
const MAX_REPLAY_REQUESTS: usize = 256;

/// Valida el sobre local sin ejecutar lógica de dominio. La misma frontera se
/// puede reutilizar cuando exista el transporte headless HTTP/WebSocket.
pub fn validate_backend_request(
    request: BackendRequestEnvelope,
) -> Result<BackendRequestEnvelope, BackendError> {
    request.protocol_version.validate()?;
    request.request.validate(&BackendLimits::default())?;
    Ok(request)
}

/// Identidad de un stream de eventos. El `requestId` lo elige el cliente, por
/// lo que el historial se aísla además por biblioteca y usuario.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EventStreamKey {
    library_id: String,
    library_user_id: String,
    request_id: String,
}

impl EventStreamKey {
    pub fn new(context: &BackendRequestContext) -> Self {
        Self::from_parts(
            &context.library_id,
            &context.actor.library_user_id,
            &context.request_id,
        )
    }

    pub fn from_parts(library_id: &str, library_user_id: &str, request_id: &str) -> Self {
        Self {
            library_id: library_id.to_string(),
            library_user_id: library_user_id.to_string(),
            request_id: request_id.to_string(),
        }
    }
}

#[derive(Debug, Default)]
struct EventHistory {
    next_sequence: u64,
    events: VecDeque<BackendEventEnvelope>,
}

/// Historial acotado de eventos por stream. Conserva la secuencia aunque se
/// descarten eventos antiguos, de modo que un cliente que reconecta nunca
/// recibe dos veces la misma secuencia.
#[derive(Debug, Default)]
pub struct BackendEventStore {
    streams: Mutex<HashMap<EventStreamKey, EventHistory>>,
}

impl BackendEventStore {
    fn append(
        &self,
        key: &EventStreamKey,
        event: BackendEvent,
    ) -> Result<BackendEventEnvelope, BackendError> {
        let mut streams = self
            .streams
            .lock()
            .map_err(|_| internal_error("No se pudo proteger el historial del backend."))?;
        if !streams.contains_key(key) && streams.len() >= MAX_REPLAY_REQUESTS {
            let eviction_key = streams.keys().next().cloned();
            if let Some(eviction_key) = eviction_key {
                streams.remove(&eviction_key);
            }
        }
        let history = streams.entry(key.clone()).or_default();
        history.next_sequence = history.next_sequence.saturating_add(1);
        let envelope = BackendEventEnvelope {
            protocol_version: ProtocolVersion::default(),
            request_id: key.request_id.clone(),
            sequence: history.next_sequence,
            event,
        };
        history.events.push_back(envelope.clone());
        while history.events.len() > MAX_REPLAY_EVENTS_PER_REQUEST {
            history.events.pop_front();
        }
        Ok(envelope)
    }

    /// Devuelve los eventos posteriores a `after_sequence` del stream.
    pub fn replay_since(
        &self,
        key: &EventStreamKey,
        after_sequence: u64,
    ) -> Result<Vec<BackendEventEnvelope>, BackendError> {
        let streams = self
            .streams
            .lock()
            .map_err(|_| internal_error("No se pudo leer el historial del backend."))?;
        Ok(streams
            .get(key)
            .map(|history| {
                history
                    .events
                    .iter()
                    .filter(|event| event.sequence > after_sequence)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Última secuencia emitida para el stream, o 0 si no existe.
    pub fn last_sequence(&self, key: &EventStreamKey) -> u64 {
        self.streams
            .lock()
            .ok()
            .and_then(|streams| streams.get(key).map(|history| history.next_sequence))
            .unwrap_or(0)
    }
}

/// Sink de un request concreto: todos los eventos se registran bajo la
/// identidad completa del request antes de emitirse a la ventana.
#[derive(Clone)]
pub struct TauriBackendEventSink {
    app: AppHandle,
    store: Arc<BackendEventStore>,
    key: EventStreamKey,
}

impl TauriBackendEventSink {
    pub fn for_request(
        app: AppHandle,
        store: Arc<BackendEventStore>,
        context: &BackendRequestContext,
    ) -> Self {
        Self {
            app,
            store,
            key: EventStreamKey::new(context),
        }
    }
}

impl BackendEventSink for TauriBackendEventSink {
    fn publish(&self, event: BackendEvent) -> Result<(), BackendError> {
        if event.request_id() != self.key.request_id {
            return Err(BackendError::invalid_input(
                "El evento no pertenece a la solicitud activa.",
            ));
        }
        let envelope = self.store.append(&self.key, event)?;
        // El historial ya quedó registrado: si la ventana no está disponible
        // (oculta, recargando o destruida) el cliente recupera el evento por
        // replay y la operación backend continúa.
        if let Err(error) = self.app.emit(BACKEND_EVENT, envelope) {
            log::warn!("[notia:backend] evento no emitido a la ventana: {error}");
        }
        Ok(())
    }
}

fn internal_error(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, message, true)
}

#[cfg(test)]
mod tests {
    use super::{BackendEventStore, EventStreamKey, MAX_REPLAY_EVENTS_PER_REQUEST};
    use crate::backend::BackendEvent;

    fn event(request_id: &str) -> BackendEvent {
        BackendEvent::RequestReceived {
            request_id: request_id.to_string(),
        }
    }

    #[test]
    fn replay_is_isolated_by_library_and_user() {
        let store = BackendEventStore::default();
        let owner = EventStreamKey::from_parts("library-a", "user-1", "request-1");
        let other_user = EventStreamKey::from_parts("library-a", "user-2", "request-1");
        let other_library = EventStreamKey::from_parts("library-b", "user-1", "request-1");
        store.append(&owner, event("request-1")).expect("append");
        assert_eq!(store.replay_since(&owner, 0).expect("replay").len(), 1);
        assert!(store.replay_since(&other_user, 0).expect("replay").is_empty());
        assert!(store.replay_since(&other_library, 0).expect("replay").is_empty());
    }

    #[test]
    fn sequences_stay_monotonic_after_the_history_is_trimmed() {
        let store = BackendEventStore::default();
        let key = EventStreamKey::from_parts("library-a", "user-1", "request-1");
        for _ in 0..(MAX_REPLAY_EVENTS_PER_REQUEST + 3) {
            store.append(&key, event("request-1")).expect("append");
        }
        let replay = store.replay_since(&key, 0).expect("replay");
        assert_eq!(replay.len(), MAX_REPLAY_EVENTS_PER_REQUEST);
        assert_eq!(replay.first().map(|event| event.sequence), Some(4));
        assert_eq!(
            store.last_sequence(&key),
            (MAX_REPLAY_EVENTS_PER_REQUEST + 3) as u64
        );
        assert!(store
            .replay_since(&key, store.last_sequence(&key))
            .expect("replay")
            .is_empty());
    }
}
