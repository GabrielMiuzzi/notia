import { callBackend, subscribeBackend, type Unsubscribe } from '../transport'
import type { MultichatMessage, MultichatStatus } from '../../types/multichat'

/**
 * Multichat client. The backend keeps the room, picks the speakers of each
 * round, streams every answer and decides when automatic rounds stop; this
 * module opens rooms, sends messages and forwards the room events.
 */

export interface MultichatFileOption {
  fileName: string
  name: string
  /** The file can be read and is not empty. */
  valid: boolean
}

export interface MultichatCatalog {
  dynamics: MultichatFileOption[]
  agents: MultichatFileOption[]
}

export interface MultichatRoomView {
  roomId: string
  libraryId: string
  dynamic: { fileName: string; name: string }
  agents: Array<{ fileName: string; name: string }>
  contextContent: string
  messages: MultichatMessage[]
  round: {
    status: MultichatStatus
    automaticRounds: number
    automaticRoundLimit: number
    activeAgentId: string | null
    error: string | null
  }
  cancelled: boolean
}

export type MultichatEvent =
  | { roomId: string; kind: 'room'; room: MultichatRoomView }
  | { roomId: string; kind: 'agentStart'; agentId: string; agentName: string }
  | { roomId: string; kind: 'thinking'; agentId: string; delta: string }
  | { roomId: string; kind: 'delta'; agentId: string; delta: string }

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

async function call<T>(command: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  try {
    return await callBackend<T>(command, { payload })
  } catch (error) {
    throw new Error(errorMessage(error, fallback))
  }
}

export function loadMultichatCatalog(libraryId: string): Promise<MultichatCatalog> {
  return call('multichat_catalog', { libraryId }, 'No se pudieron cargar dinámicas y agentes.')
}

export function openMultichatRoom(input: {
  libraryId: string
  dynamicFile: string
  agentFiles: string[]
  context: string
}): Promise<MultichatRoomView> {
  return call('multichat_open', input, 'No se pudo crear la sala.')
}

/** Sends the person's message; the room streams `multichat-event` until the rounds end. */
export function sendMultichatMessage(roomId: string, content: string): Promise<MultichatRoomView> {
  return call('multichat_send', { roomId, content }, 'Falló un agente.')
}

export async function cancelMultichatRound(roomId: string): Promise<void> {
  await callBackend('multichat_cancel', { payload: { roomId } })
}

export async function closeMultichatRoom(roomId: string): Promise<void> {
  await callBackend('multichat_close', { payload: { roomId } })
}

export function subscribeMultichatEvents(handler: (event: MultichatEvent) => void): Promise<Unsubscribe> {
  return subscribeBackend<MultichatEvent>('multichat-event', handler)
}
