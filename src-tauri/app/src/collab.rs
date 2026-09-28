//! Rooms of collaborative editing of a note. The editors (Milkdown with
//! Yjs, in each window) join the room of the note, send their changes and
//! their cursors, and receive the others' as events; this keeps the room:
//!
//! - **The changes** (Yjs updates, opaque here) so whoever joins later
//!   starts from the same document. The first to join fills it with the
//!   note (`initializer`).
//! - **The people**, each with a color of the palette and the name of their
//!   device, so every editor marks the block each one is writing.
//! - **The saver**: only one editor writes the note to the library (the
//!   others would fight over its revision). When it leaves, the next one
//!   saves.
//!
//! The host runs it for its own window and for its clients (through
//! `/api/invoke`); the events reach every window. A room ends with its last
//! person; the note on disk is the document.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Emitter, Manager};

pub(crate) const UPDATE_EVENT: &str = "notia:collab-update";
pub(crate) const AWARENESS_EVENT: &str = "notia:collab-awareness";
pub(crate) const PEERS_EVENT: &str = "notia:collab-peers";

/// A person who stopped answering (closed the window, lost the network)
/// leaves the room after this long.
const PEER_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_UPDATE_CHARS: usize = 4 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 40;
/// Accents of the palette, in the order people join.
const COLORS: &[&str] = &["#4FD1C5", "#6C8EFF", "#FFB86B", "#A78BFA", "#6FCF97", "#FF6B6B", "#D9B44A"];

struct Peer {
    id: String,
    name: String,
    color: &'static str,
    seen: Instant,
}

#[derive(Default)]
struct Room {
    /// Yjs updates in base64, in arrival order.
    updates: Vec<String>,
    peers: Vec<Peer>,
    saver: Option<String>,
    joined: usize,
}

#[derive(Default)]
pub(crate) struct CollabState {
    rooms: Mutex<HashMap<String, Room>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeerView {
    peer_id: String,
    name: String,
    color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeersEvent {
    room: String,
    peers: Vec<PeerView>,
    saver: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JoinView {
    room: String,
    peer_id: String,
    color: String,
    /// The room is new: this editor fills it with the note.
    initializer: bool,
    saver: bool,
    updates: Vec<String>,
    peers: Vec<PeerView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JoinPayload {
    library_id: String,
    path: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MessagePayload {
    room: String,
    peer_id: String,
    update: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LeavePayload {
    room: String,
    peer_id: String,
}

fn invalid(message: &str) -> BackendError {
    BackendError::invalid_input(message)
}

fn left_room() -> BackendError {
    BackendError::new(BackendErrorCode::NotFound, "La edición compartida de la nota terminó: volvé a abrirla.", true)
}

fn room_key(library_id: &str, path: &str) -> Result<String, BackendError> {
    let (library_id, path) = (library_id.trim(), path.trim());
    if library_id.is_empty() || path.is_empty() || path.chars().any(char::is_control) {
        return Err(invalid("La nota no es válida para editarla en conjunto."));
    }
    Ok(format!("{library_id}|{path}"))
}

fn peer_name(name: &str) -> String {
    let name: String = name.chars().filter(|c| !c.is_control()).take(MAX_NAME_CHARS).collect();
    let name = name.trim();
    if name.is_empty() { "Otro equipo".to_string() } else { name.to_string() }
}

fn is_update(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_UPDATE_CHARS
        && text.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
}

impl Room {
    fn views(&self) -> Vec<PeerView> {
        self.peers
            .iter()
            .map(|peer| PeerView { peer_id: peer.id.clone(), name: peer.name.clone(), color: peer.color.to_string() })
            .collect()
    }

    /// Drops who stopped answering; returns whether anyone left.
    fn prune(&mut self, now: Instant) -> bool {
        let before = self.peers.len();
        self.peers.retain(|peer| now.duration_since(peer.seen) < PEER_TIMEOUT);
        self.assign_saver();
        before != self.peers.len()
    }

    fn assign_saver(&mut self) {
        let saver_present = self.saver.as_ref().is_some_and(|saver| self.peers.iter().any(|peer| &peer.id == saver));
        if !saver_present {
            self.saver = self.peers.first().map(|peer| peer.id.clone());
        }
    }

    fn touch(&mut self, peer_id: &str, now: Instant) -> bool {
        match self.peers.iter_mut().find(|peer| peer.id == peer_id) {
            Some(peer) => {
                peer.seen = now;
                true
            }
            None => false,
        }
    }

    fn event(&self, room: &str) -> PeersEvent {
        PeersEvent { room: room.to_string(), peers: self.views(), saver: self.saver.clone() }
    }
}

fn rooms(app: &AppHandle) -> Result<std::sync::MutexGuard<'static, HashMap<String, Room>>, BackendError> {
    let state = app
        .try_state::<CollabState>()
        .ok_or_else(|| BackendError::new(BackendErrorCode::Internal, "La edición compartida no está disponible.", true))?;
    Ok(state.inner().rooms.lock().unwrap_or_else(|error| error.into_inner()))
}

/// Joins the room of a note.
pub(crate) fn collab_join(app: &AppHandle, payload: JoinPayload) -> Result<JoinView, BackendError> {
    let key = room_key(&payload.library_id, &payload.path)?;
    let now = Instant::now();
    let (view, event) = {
        let mut rooms = rooms(app)?;
        let room = rooms.entry(key.clone()).or_default();
        room.prune(now);
        let initializer = room.peers.is_empty() && room.updates.is_empty();
        let color = COLORS[room.joined % COLORS.len()];
        room.joined += 1;
        let peer_id = uuid::Uuid::new_v4().to_string();
        room.peers.push(Peer { id: peer_id.clone(), name: peer_name(&payload.name), color, seen: now });
        room.assign_saver();
        let view = JoinView {
            room: key.clone(),
            saver: room.saver.as_deref() == Some(peer_id.as_str()),
            peer_id,
            color: color.to_string(),
            initializer,
            updates: room.updates.clone(),
            peers: room.views(),
        };
        (view, room.event(&key))
    };
    let _ = app.emit(PEERS_EVENT, event);
    Ok(view)
}

/// A change of the document by `peer_id`, for everyone in the room.
pub(crate) fn collab_update(app: &AppHandle, payload: MessagePayload) -> Result<(), BackendError> {
    if !is_update(&payload.update) {
        return Err(invalid("El cambio de la nota no es válido."));
    }
    let left = {
        let mut rooms = rooms(app)?;
        let room = rooms.get_mut(&payload.room).ok_or_else(left_room)?;
        let now = Instant::now();
        if !room.touch(&payload.peer_id, now) {
            return Err(left_room());
        }
        room.updates.push(payload.update.clone());
        room.prune(now).then(|| room.event(&payload.room))
    };
    let _ = app.emit(UPDATE_EVENT, serde_json::json!({ "room": payload.room, "from": payload.peer_id, "update": payload.update }));
    if let Some(event) = left {
        let _ = app.emit(PEERS_EVENT, event);
    }
    Ok(())
}

/// Where `peer_id` is (cursor, selection, name), for everyone in the room.
/// It also tells the room the person is still there.
pub(crate) fn collab_awareness(app: &AppHandle, payload: MessagePayload) -> Result<(), BackendError> {
    if !is_update(&payload.update) {
        return Err(invalid("La posición en la nota no es válida."));
    }
    let left = {
        let mut rooms = rooms(app)?;
        let room = rooms.get_mut(&payload.room).ok_or_else(left_room)?;
        let now = Instant::now();
        if !room.touch(&payload.peer_id, now) {
            return Err(left_room());
        }
        room.prune(now).then(|| room.event(&payload.room))
    };
    let _ = app.emit(AWARENESS_EVENT, serde_json::json!({ "room": payload.room, "from": payload.peer_id, "update": payload.update }));
    if let Some(event) = left {
        let _ = app.emit(PEERS_EVENT, event);
    }
    Ok(())
}

/// Leaves the room; the last one ends it.
pub(crate) fn collab_leave(app: &AppHandle, payload: LeavePayload) -> Result<(), BackendError> {
    let event = {
        let mut rooms = rooms(app)?;
        let Some(room) = rooms.get_mut(&payload.room) else {
            return Ok(());
        };
        room.peers.retain(|peer| peer.id != payload.peer_id);
        room.prune(Instant::now());
        let event = room.event(&payload.room);
        if room.peers.is_empty() {
            rooms.remove(&payload.room);
        }
        event
    };
    let _ = app.emit(PEERS_EVENT, event);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{AppPaths, HostPorts};

    fn app() -> AppHandle {
        let app = crate::host::AppContext::new(AppPaths::default(), HostPorts::default());
        app.manage(CollabState::default());
        app
    }

    fn join(app: &AppHandle, name: &str) -> JoinView {
        collab_join(app, JoinPayload { library_id: "biblioteca".into(), path: "C:/Notas/idea.md".into(), name: name.into() }).expect("join")
    }

    #[test]
    fn the_first_fills_the_room_and_one_saves_at_a_time() {
        let app = app();
        let first = join(&app, "Notebook");
        assert!(first.initializer && first.saver && first.updates.is_empty());
        collab_update(&app, MessagePayload { room: first.room.clone(), peer_id: first.peer_id.clone(), update: "AQID".into() }).expect("update");

        let second = join(&app, "Teléfono");
        assert!(!second.initializer && !second.saver);
        assert_eq!(second.updates, vec!["AQID".to_string()]);
        assert_ne!(first.color, second.color);
        assert_eq!(second.peers.len(), 2);

        // The saver leaves: the next one saves.
        collab_leave(&app, LeavePayload { room: first.room.clone(), peer_id: first.peer_id.clone() }).expect("leave");
        let rooms = rooms(&app).expect("rooms");
        assert_eq!(rooms[&first.room].saver.as_deref(), Some(second.peer_id.as_str()));
        drop(rooms);

        // The last one ends the room: the next editor starts from the note.
        collab_leave(&app, LeavePayload { room: second.room.clone(), peer_id: second.peer_id.clone() }).expect("leave");
        assert!(join(&app, "Notebook").initializer);
    }

    #[test]
    fn refuses_bad_changes_and_people_outside_the_room() {
        let app = app();
        let peer = join(&app, "");
        assert_eq!(peer.peers[0].name, "Otro equipo");
        let bad = MessagePayload { room: peer.room.clone(), peer_id: peer.peer_id.clone(), update: "no es base64!".into() };
        assert!(collab_update(&app, bad).is_err());
        let stranger = MessagePayload { room: peer.room.clone(), peer_id: "otro".into(), update: "AQID".into() };
        assert!(collab_update(&app, stranger).is_err());
        let missing = MessagePayload { room: "x|y".into(), peer_id: peer.peer_id, update: "AQID".into() };
        assert!(collab_awareness(&app, missing).is_err());
    }

    #[test]
    fn people_who_stop_answering_leave() {
        let mut room = Room::default();
        let long_ago = Instant::now() - PEER_TIMEOUT - Duration::from_secs(1);
        room.peers.push(Peer { id: "a".into(), name: "A".into(), color: COLORS[0], seen: long_ago });
        room.peers.push(Peer { id: "b".into(), name: "B".into(), color: COLORS[1], seen: Instant::now() });
        room.saver = Some("a".into());
        assert!(room.prune(Instant::now()));
        assert_eq!(room.saver.as_deref(), Some("b"));
    }
}
