import type { TaskManagerSettings } from '../types/taskManagerTypes'

export const TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION = 1 as const
export const PUBLICATION_VAULT_ALIAS = 'published-vault' as const

export type TaskManagerPublicationChangeType =
  | 'changed'
  | 'resync-required'
  | 'access-revoked'
  | 'publication-stopped'
  | 'publication-reconfigured'

export interface PublicationSession {
  protocolVersion: typeof TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
  publicationEpoch: string
  sequence: number
  revision: number
  actorId?: string
}

export interface PublicationSnapshot extends PublicationSession {
  settings: TaskManagerSettings
}

export interface TaskManagerMutation {
  type: 'mutate'
  protocolVersion: typeof TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
  messageId: string
  operationId: string
  baseRevision: number
  command: string
  args: Record<string, unknown>
}

export interface PublicationHello {
  type: 'hello'
  protocolVersion: typeof TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
  messageId: string
  publicationEpoch: string
  lastSequence: number
}

export interface PublicationCancel {
  type: 'cancel'
  protocolVersion: typeof TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
  messageId: string
  operationId: string
}

export interface PublicationConflict {
  kind: string
  expectedRevision?: number
  currentRevision?: number
  actorId?: string
  operationId?: string
}

export interface MutationAck {
  type: 'ack'
  protocolVersion: typeof TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
  messageId: string
  operationId: string
  ok: boolean
  result?: unknown
  error?: string
  retryable?: boolean
  cancelled?: boolean
  conflict?: PublicationConflict
  changed?: boolean
  changedPaths?: string[]
  sequence?: number
  revision?: number
  outcome?: 'applied' | 'failed' | 'unknown'
}

export interface PublicationEvent {
  type: TaskManagerPublicationChangeType
  protocolVersion: typeof TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
  messageId?: string
  publicationEpoch?: string
  sequence?: number
  revision?: number
  actorId?: string
  changedPaths?: string[]
  operationId?: string
  reason?: string
  settings?: unknown
}

export interface ResyncRequired extends PublicationSession {
  type: 'resync-required'
  messageId: string
  reason?: string
}

export interface PublicationWelcome extends PublicationSession {
  type: 'welcome'
  messageId: string
  replay: PublicationEvent[]
}

export type PublicationWireFrame =
  | PublicationHello
  | PublicationCancel
  | TaskManagerMutation
  | MutationAck
  | PublicationWelcome
  | PublicationEvent
  | ResyncRequired

export function isPublicationSession(value: unknown): value is PublicationSession {
  if (!isRecord(value)) return false
  return value.protocolVersion === TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION
    && typeof value.publicationEpoch === 'string'
    && value.publicationEpoch.trim().length > 0
    && typeof value.sequence === 'number'
    && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0
    && typeof value.revision === 'number'
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
