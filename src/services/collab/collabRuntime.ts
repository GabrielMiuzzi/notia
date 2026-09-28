import { callBackend, subscribeBackend, type Unsubscribe } from '../transport'
import { fetchConnection } from '../connection/connectionRuntime'

/**
 * Collaborative editing of a note (`collab.rs`). The backend keeps the
 * room of each note, gives every person a color, picks who saves the note
 * and relays the changes and cursors as events; the editor only turns them
 * into its document (Yjs) and shows them.
 */
export interface CollabPeer {
  peerId: string
  name: string
  color: string
}

export interface CollabJoin {
  room: string
  peerId: string
  color: string
  /** The room is new: this editor fills it with the note. */
  initializer: boolean
  /** This editor writes the note to the library. */
  saver: boolean
  /** Changes of the room so far (Yjs updates in base64). */
  updates: string[]
  peers: CollabPeer[]
}

export interface CollabMessage {
  room: string
  from: string
  update: string
}

export interface CollabPeers {
  room: string
  peers: CollabPeer[]
  saver: string | null
}

export const COLLAB_UPDATE_EVENT = 'notia:collab-update'
export const COLLAB_AWARENESS_EVENT = 'notia:collab-awareness'
export const COLLAB_PEERS_EVENT = 'notia:collab-peers'

export function joinCollab(libraryId: string, path: string, name: string): Promise<CollabJoin> {
  return callBackend<CollabJoin>('collab_join', { payload: { libraryId, path, name } })
}

export function sendCollabUpdate(room: string, peerId: string, update: string): Promise<void> {
  return callBackend<void>('collab_update', { payload: { room, peerId, update } })
}

export function sendCollabAwareness(room: string, peerId: string, update: string): Promise<void> {
  return callBackend<void>('collab_awareness', { payload: { room, peerId, update } })
}

export function leaveCollab(room: string, peerId: string): Promise<void> {
  return callBackend<void>('collab_leave', { payload: { room, peerId } })
}

export async function subscribeCollab(handlers: {
  update: (message: CollabMessage) => void
  awareness: (message: CollabMessage) => void
  peers: (peers: CollabPeers) => void
}): Promise<Unsubscribe> {
  const stops = await Promise.all([
    subscribeBackend<CollabMessage>(COLLAB_UPDATE_EVENT, handlers.update),
    subscribeBackend<CollabMessage>(COLLAB_AWARENESS_EVENT, handlers.awareness),
    subscribeBackend<CollabPeers>(COLLAB_PEERS_EVENT, handlers.peers),
  ])
  return () => stops.forEach((stop) => stop())
}

export interface CollaborationSettings {
  enabled: boolean
  deviceName: string
}

let settings: Promise<CollaborationSettings> | null = null

/** Whether notes are edited together here (read once per window). */
export function collaborationSettings(): Promise<CollaborationSettings> {
  settings ??= fetchConnection()
    .then((view) => ({ enabled: view.collaboration, deviceName: view.deviceName }))
    .catch(() => ({ enabled: false, deviceName: '' }))
  return settings
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
