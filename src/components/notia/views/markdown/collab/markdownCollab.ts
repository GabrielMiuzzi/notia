import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { collabServiceCtx } from '@milkdown/plugin-collab'
import { applyUpdate, Doc, mergeUpdates } from 'yjs'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import {
  base64ToBytes,
  bytesToBase64,
  joinCollab,
  leaveCollab,
  sendCollabAwareness,
  sendCollabUpdate,
  subscribeCollab,
} from '../../../../../services/collab/collabRuntime'
import { collabBlocksKey } from './collabBlocksPlugin'

/** Origin of what arrives from the room, so it is not sent back. */
const REMOTE = 'notia-remote'
/** Keystrokes travel together: one message every this many ms at most. */
const UPDATE_BATCH_MS = 120
const AWARENESS_THROTTLE_MS = 200
/** Tells the room this editor is still there. */
const HEARTBEAT_MS = 20_000

export interface MarkdownCollabOptions {
  crepe: Crepe
  libraryId: string
  path: string
  deviceName: string
  /** This editor saves the note (the backend picks one per room). */
  onSaverChange: (saver: boolean) => void
  /** The room ended (the host restarted): the note keeps working alone. */
  onLost: (message: string) => void
}

/** The clients whose awareness changed, as `Awareness` reports them. */
interface AwarenessChanges {
  added: number[]
  updated: number[]
  removed: number[]
}

export interface MarkdownCollabSession {
  awareness: Awareness
  destroy: () => void
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

/**
 * Binds the editor to the room of its note: its changes and cursor go to
 * the others and theirs come back into the editor (Yjs). The backend keeps
 * the room and decides who saves; this only moves the messages.
 */
export async function startMarkdownCollab(options: MarkdownCollabOptions): Promise<MarkdownCollabSession> {
  const { crepe } = options
  const joined = await joinCollab(options.libraryId, options.path, options.deviceName)
  const { room, peerId } = joined
  const doc = new Doc()
  joined.updates.forEach((update) => applyUpdate(doc, base64ToBytes(update), REMOTE))
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', { name: options.deviceName, color: joined.color })

  let active = true
  let saver = joined.saver
  options.onSaverChange(saver)

  const lose = (error: unknown) => {
    if (!active) return
    options.onLost(messageOf(error, 'La edición compartida se interrumpió.'))
  }

  let pending: Uint8Array[] = []
  let updateTimer: ReturnType<typeof setTimeout> | null = null
  const flushUpdates = () => {
    updateTimer = null
    if (pending.length === 0) return
    const merged = pending.length === 1 ? pending[0] : mergeUpdates(pending)
    pending = []
    void sendCollabUpdate(room, peerId, bytesToBase64(merged)).catch(lose)
  }
  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || !active) return
    pending.push(update)
    updateTimer ??= setTimeout(flushUpdates, UPDATE_BATCH_MS)
  }
  doc.on('update', onDocUpdate)

  let awarenessTimer: ReturnType<typeof setTimeout> | null = null
  const sendAwareness = () => {
    awarenessTimer = null
    if (!active) return
    const update = encodeAwarenessUpdate(awareness, [doc.clientID])
    void sendCollabAwareness(room, peerId, bytesToBase64(update)).catch(lose)
  }
  const onAwarenessUpdate = (_changes: unknown, origin: unknown) => {
    if (origin !== REMOTE) awarenessTimer ??= setTimeout(sendAwareness, AWARENESS_THROTTLE_MS)
  }
  awareness.on('update', onAwarenessUpdate)
  // The marks of the others' blocks follow their cursors. This editor's own
  // cursor (it moves with every keystroke) marks nothing, so it redraws nothing.
  const refreshBlocks = ({ added, updated, removed }: AwarenessChanges) => {
    if (!active) return
    if ([...added, ...updated, ...removed].every((clientId) => clientId === awareness.clientID)) return
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setMeta(collabBlocksKey, true))
    })
  }
  awareness.on('change', refreshBlocks)
  const heartbeat = setInterval(sendAwareness, HEARTBEAT_MS)

  const unsubscribe = await subscribeCollab({
    update: (message) => {
      if (message.room !== room || message.from === peerId) return
      applyUpdate(doc, base64ToBytes(message.update), REMOTE)
    },
    awareness: (message) => {
      if (message.room !== room || message.from === peerId) return
      applyAwarenessUpdate(awareness, base64ToBytes(message.update), REMOTE)
    },
    peers: (peers) => {
      if (peers.room !== room) return
      const next = peers.saver === peerId
      if (next !== saver) {
        saver = next
        options.onSaverChange(next)
      }
    },
  })

  crepe.editor.action((ctx) => {
    const service = ctx.get(collabServiceCtx)
    service.bindDoc(doc).setAwareness(awareness)
    // A new room starts from the note as the editor has it now.
    if (joined.initializer) service.applyTemplate(crepe.getMarkdown())
    service.connect()
  })
  sendAwareness()

  const destroy = () => {
    if (!active) return
    flushUpdates()
    active = false
    if (updateTimer) clearTimeout(updateTimer)
    if (awarenessTimer) clearTimeout(awarenessTimer)
    clearInterval(heartbeat)
    unsubscribe()
    doc.off('update', onDocUpdate)
    awareness.off('update', onAwarenessUpdate)
    awareness.off('change', refreshBlocks)
    try {
      crepe.editor.action((ctx) => { ctx.get(collabServiceCtx).disconnect() })
    } catch {
      // The editor is already gone.
    }
    awareness.destroy()
    doc.destroy()
    void leaveCollab(room, peerId).catch(() => {
      // The room forgets whoever stops answering.
    })
  }

  return { awareness, destroy }
}
