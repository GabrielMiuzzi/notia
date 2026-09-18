export const MULTICHAT_MAX_MESSAGES = 40 as const
export const MULTICHAT_MIN_AGENTS = 1 as const
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

export interface MultichatDynamic {
  fileName: string
  name: string
  content: string
}

export interface MultichatAgent {
  fileName: string
  name: string
  prompt: string
  icon: string
  color: string
}

export interface MultichatMessage {
  id: string
  speakerId: MultichatSpeakerId
  speakerName: string
  content: string
  createdAt: number
}

export interface MultichatSerializedMessage {
  speaker: MultichatSpeakerId
  name: string
  content: string
}

export interface MultichatRoundState {
  status: MultichatStatus
  automaticRounds: number
  automaticRoundLimit: number
  activeAgentId: string | null
  error: string | null
}

export interface MultichatRoom {
  id: string
  dynamic: MultichatDynamic
  agents: readonly MultichatAgent[]
  contextContent: string
  messages: readonly MultichatMessage[]
  round: MultichatRoundState
  cancelled: boolean
  libraryId: string
}

export interface MultichatPanelContext {
  roomId: string
  label: string
  dynamicName: string
  agentNames: readonly string[]
  contextContent: string
  messages: readonly MultichatSerializedMessage[]
}
