import { isWorkspaceAiSnapshot, type WorkspaceAiSnapshot } from './agentContracts'

/** Version of the serializable contract shared by every AI transport. */
export const GLOBAL_AI_REQUEST_VERSION = 1 as const

export type AiChannel = 'app' | 'public-url' | 'telegram'

export type AiAppSurface =
  | 'main-chat'
  | 'sidebar-chat'
  | 'document'
  | 'task-manager'
  | 'graph-view'
  | 'meeting'
  | 'finance'
  | 'other'

export type AiConsumptionSource =
  | { channel: 'app'; appSurface: AiAppSurface }
  | { channel: 'public-url'; appSurface?: never }
  | { channel: 'telegram'; appSurface?: never }

export interface AiActor {
  libraryUserId: string
  displayName?: string
  externalIdentity?: {
    provider: 'telegram'
    userId: number
    chatId: number
  }
}

export type AiChatPersistencePolicy = 'persistent' | 'ephemeral-no-memory' | 'published-no-memory'

export interface GlobalAiChatRequest {
  version: typeof GLOBAL_AI_REQUEST_VERSION
  libraryId: string
  requestId: string
  actor: AiActor
  source: AiConsumptionSource
  workspaceSnapshot: WorkspaceAiSnapshot
  requestedScope: string
  persistencePolicy: AiChatPersistencePolicy
  prompt: string
}

export type AiContextTag = string

export interface AiAccessPrincipal {
  libraryUserId: string
  roleId?: string
  allowedContexts: readonly AiContextTag[]
  allContexts: boolean
}

export type AiToolPolicy =
  | 'public'
  | 'library-read'
  | 'library-write'
  | 'task-read'
  | 'task-write'
  | 'finance-read'
  | 'finance-write'
  | 'memory'

export type AiToolProjection = 'full' | 'published-task-manager'

export type AiAuthorizationErrorCode =
  | 'missing-actor'
  | 'invalid-source'
  | 'unauthorized-context'
  | 'unauthorized-tool'
  | 'session-revoked'
  | 'library-mismatch'
  | 'resource-not-found'

export interface AiAuthorizationError {
  code: AiAuthorizationErrorCode
  message: string
  retryable: boolean
}

export interface AiResourceDescriptor {
  contextTag: AiContextTag
  libraryId?: string
  resourceId?: string
}

export interface AiAuthorizationDecision {
  allowed: boolean
  error?: AiAuthorizationError
}

const CHANNELS = new Set<AiChannel>(['app', 'public-url', 'telegram'])
const APP_SURFACES = new Set<AiAppSurface>([
  'main-chat', 'sidebar-chat', 'document', 'task-manager', 'graph-view', 'meeting', 'finance', 'other',
])
const PERSISTENCE_POLICIES = new Set<AiChatPersistencePolicy>([
  'persistent', 'ephemeral-no-memory', 'published-no-memory',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSnapshot(value: unknown): value is WorkspaceAiSnapshot {
  return isWorkspaceAiSnapshot(value)
}

export function isAiConsumptionSource(value: unknown): value is AiConsumptionSource {
  if (!isRecord(value) || typeof value.channel !== 'string' || !CHANNELS.has(value.channel as AiChannel)) return false
  if (value.channel === 'app') return typeof value.appSurface === 'string' && APP_SURFACES.has(value.appSurface as AiAppSurface)
  return value.appSurface === undefined
}

export function isAiActor(value: unknown): value is AiActor {
  if (!isRecord(value) || !nonEmptyString(value.libraryUserId)) return false
  if (value.displayName !== undefined && typeof value.displayName !== 'string') return false
  if (value.externalIdentity === undefined) return true
  const identity = value.externalIdentity
  return isRecord(identity)
    && identity.provider === 'telegram'
    && Number.isSafeInteger(identity.userId)
    && Number.isSafeInteger(identity.chatId)
}

export function isGlobalAiChatRequest(value: unknown): value is GlobalAiChatRequest {
  if (!isRecord(value)
    || value.version !== GLOBAL_AI_REQUEST_VERSION
    || !nonEmptyString(value.libraryId)
    || !nonEmptyString(value.requestId)
    || !isAiActor(value.actor)
    || !isAiConsumptionSource(value.source)
    || !isSnapshot(value.workspaceSnapshot)
    || !nonEmptyString(value.requestedScope)
    || typeof value.prompt !== 'string'
    || !PERSISTENCE_POLICIES.has(value.persistencePolicy as AiChatPersistencePolicy)) return false
  return true
}

export function createGlobalAiRequest(input: Omit<GlobalAiChatRequest, 'version'>): GlobalAiChatRequest {
  const request = { ...input, version: GLOBAL_AI_REQUEST_VERSION } satisfies GlobalAiChatRequest
  if (!isGlobalAiChatRequest(request)) throw new Error('La solicitud global de IA no cumple el contrato versionado.')
  return request
}

export function getSafeAiAuthorizationError(code: AiAuthorizationErrorCode): AiAuthorizationError {
  const messages: Record<AiAuthorizationErrorCode, string> = {
    'missing-actor': 'No se pudo resolver el usuario de Notia para esta solicitud.',
    'invalid-source': 'El origen de la solicitud de IA no es válido.',
    'unauthorized-context': 'No tenés autorización para acceder a ese contexto.',
    'unauthorized-tool': 'La herramienta solicitada no está autorizada para esta sesión.',
    'session-revoked': 'La sesión de IA ya no está autorizada.',
    'library-mismatch': 'La solicitud no pertenece a la biblioteca activa.',
    'resource-not-found': 'No se encontró el recurso solicitado.',
  }
  return { code, message: messages[code], retryable: code === 'session-revoked' }
}
