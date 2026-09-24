/** Agents a room can have; the backend enforces it. Used to cap the selection. */
export const MULTICHAT_MAX_AGENTS = 6 as const

export type MultichatSpeakerId = 'user' | `agent:${string}`
export type MultichatStatus =
  | 'configuration'
  | 'empty'
  | 'user-turn'
  | 'agent-turn'
  | 'waiting-user'
  | 'loading'
  | 'error'
  | 'cancelled'
  | 'agent-no-response'

export interface MultichatMessage {
  id: string
  speakerId: MultichatSpeakerId
  speakerName: string
  content: string
  createdAt: number
}

/** The room open beside the chat; the backend reads its conversation. */
export interface MultichatPanelContext {
  roomId: string
  label: string
}
