import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export const BACKEND_EVENT = 'notia:backend-event'

export type BackendChannel = 'app' | 'telegram' | 'meeting' | 'published' | 'multichat'
export type BackendScope = 'library' | 'document' | 'task-manager' | 'graph' | 'finance'
export type PersistencePolicy = 'persistent' | 'ephemeral-no-memory' | 'published-no-memory'

export interface BackendRequestContext {
  requestId: string
  libraryId: string
  actor: { libraryUserId: string; externalIdentity?: { provider: string; userId: string; chatId?: number } }
  channel: BackendChannel
  scope: BackendScope
  persistencePolicy: PersistencePolicy
}

/** File attached to a message; the backend validates it and composes the prompt. */
export interface BackendMessageAttachment {
  name: string
  mediaType: string
  kind: 'image' | 'pdf' | 'text'
  pages?: string[]
  textContent?: string
  extractedText?: string
  pageCount?: number
}

export interface BackendMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]
  attachments?: BackendMessageAttachment[]
}

export interface BackendToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  scopes: BackendScope[]
  readOnly: boolean
  requiresConfirmation: boolean
}

export interface BackendSnapshot {
  snapshotVersion: number
  view: string
  scope: BackendScope
  libraryId: string
  activeDocument?: { path: string; name: string; kind: string; revision: number; dirty: boolean }
  openTabs: Array<{ path: string; name: string; kind: string; revision: number; dirty: boolean }>
  capabilities: Record<string, boolean>
  capturedAt: number
  /** Editor selection of the active document; Rust validates and bounds it. */
  selection?: {
    documentPath: string
    from: number
    to: number
    blocks: Array<{ index: number; type: string; text: string }>
  }
}

export interface BackendRunRequest {
  context: BackendRequestContext
  messages: BackendMessage[]
  snapshot?: BackendSnapshot
  /** Names are only a client-side projection; Rust owns every definition. */
  tools?: BackendToolDefinition[]
  attachments?: Array<{ id: string; name: string; kind: 'image' | 'document'; mediaType: string; byteLength: number }>
  idempotencyKey: string
  /** Custom prompt file under `.agent/promps`; Rust composes the final prompt. */
  promptName?: string
}

export interface BackendOperationToken {
  operationId: string
  generation: number
}

export type BackendResumeDecision =
  | { type: 'clarification'; payload: { clarificationId: string; operation: BackendOperationToken; answer: string; optionId?: string } }
  | { type: 'confirmation'; payload: { operationId: string; accepted: boolean; hunkIds?: string[] } }
  | { type: 'plan'; payload: { planId: string; generation: number; accepted: boolean; stepIds?: string[] } }

export interface BackendOperationRequest {
  context: BackendRequestContext
  idempotencyKey: string
  requestId: string
  operation: BackendOperationToken
}

/**
 * Identifies a request without an interaction token. Rust resolves it to the
 * active run or the latest interaction of the same library, user and request.
 */
export interface BackendRequestIdentity {
  context: BackendRequestContext
  idempotencyKey: string
  requestId: string
  operation?: BackendOperationToken
}

export type BackendRequestEnvelope = {
  protocolVersion: number
  request:
    | { type: 'run'; payload: BackendRunRequest }
    | { type: 'resume'; payload: BackendOperationRequest & { lastEventSequence: number; decision: BackendResumeDecision } }
    | { type: 'cancel'; payload: BackendRequestIdentity }
    | { type: 'get-operation'; payload: BackendRequestIdentity & { lastEventSequence?: number } }
    | { type: 'review'; payload: BackendOperationRequest }
    | { type: 'undo'; payload: BackendOperationRequest }
}

export interface BackendResponseEnvelope {
  protocolVersion: number
  response: Record<string, unknown>
}

export interface BackendEventEnvelope {
  protocolVersion: number
  requestId: string
  sequence: number
  event: { type: string; [key: string]: unknown }
}

export async function configureBackendProvider(input: {
  ollamaUrl: string
  model: string
  apiKey?: string
  think?: unknown
}): Promise<void> {
  await invoke('configure_backend_provider', { payload: input })
}

export async function runBackendRequest(
  envelope: BackendRequestEnvelope,
): Promise<BackendResponseEnvelope> {
  return invoke<BackendResponseEnvelope>('run_backend_request', { envelope })
}

export async function resumeBackendRequest(
  payload: BackendOperationRequest & { lastEventSequence: number; decision: BackendResumeDecision },
): Promise<BackendResponseEnvelope> {
  return runBackendRequest({ protocolVersion: 2, request: { type: 'resume', payload } })
}

/** Cancels the active run (without `operation`) or a pending interaction. */
export async function cancelBackendRequest(
  payload: BackendRequestIdentity,
): Promise<BackendResponseEnvelope> {
  return runBackendRequest({ protocolVersion: 2, request: { type: 'cancel', payload } })
}

/** Re-attaches to a request by identity after a reload or reconnection. */
export async function getBackendOperation(
  payload: BackendRequestIdentity & { lastEventSequence?: number },
): Promise<BackendResponseEnvelope> {
  return runBackendRequest({ protocolVersion: 2, request: { type: 'get-operation', payload } })
}

export async function reviewBackendOperation(
  payload: BackendOperationRequest,
): Promise<BackendResponseEnvelope> {
  return runBackendRequest({ protocolVersion: 2, request: { type: 'review', payload } })
}

export async function undoBackendOperation(
  payload: BackendOperationRequest,
): Promise<BackendResponseEnvelope> {
  return runBackendRequest({ protocolVersion: 2, request: { type: 'undo', payload } })
}

/** Replays events of one request of the given library user after a sequence. */
export async function replayBackendEvents(
  context: Pick<BackendRequestContext, 'requestId' | 'libraryId' | 'actor'>,
  afterSequence = 0,
): Promise<BackendEventEnvelope[]> {
  return invoke<BackendEventEnvelope[]>('replay_backend_events', {
    payload: {
      requestId: context.requestId,
      libraryId: context.libraryId,
      libraryUserId: context.actor.libraryUserId,
      afterSequence,
    },
  })
}

/**
 * Tracks the last applied sequence of one request stream. Events can arrive
 * twice (live emit plus replay) or out of order; only newer ones are applied.
 */
export function createBackendEventCursor(requestId: string) {
  let lastSequence = 0
  return {
    get lastSequence() {
      return lastSequence
    },
    accept(event: BackendEventEnvelope): boolean {
      if (event.requestId !== requestId || event.sequence <= lastSequence) return false
      lastSequence = event.sequence
      return true
    },
  }
}

/** Bounded, session-only map from an operation id to the request that owns it. */
const MAX_UNDOABLE_OPERATIONS = 50
const undoableOperations = new Map<string, Omit<BackendRequestIdentity, 'operation'>>()

/** Remembers the request of a changed operation so the UI can undo it later. */
export function rememberUndoableBackendOperation(
  operationId: string,
  identity: Omit<BackendRequestIdentity, 'operation'>,
): void {
  undoableOperations.delete(operationId)
  undoableOperations.set(operationId, identity)
  while (undoableOperations.size > MAX_UNDOABLE_OPERATIONS) {
    const oldest = undoableOperations.keys().next().value
    if (oldest === undefined) break
    undoableOperations.delete(oldest)
  }
}

/**
 * Undoes a document change through the backend. Rust re-reads the stored
 * operation, verifies the document revision and restores the previous state;
 * the client only supplies the operation id it saw in a `tool-completed` event.
 */
export async function undoRememberedBackendOperation(operationId: string): Promise<{ path?: string }> {
  const identity = undoableOperations.get(operationId)
  if (!identity) throw new Error('La operación ya no está disponible para deshacer en esta sesión.')
  const status = await getBackendOperation(identity)
  const operation = (status.response as { payload?: { status?: { operation?: BackendOperationToken } } })
    .payload?.status?.operation
  if (!operation || operation.operationId !== operationId) {
    throw new Error('La operación ya no es la última de su solicitud y no puede deshacerse.')
  }
  const response = await undoBackendOperation({ ...identity, operation })
  const payload = (response.response as { payload?: { result?: { result?: { data?: { path?: string } } }; error?: { message?: string } } }).payload
  if (payload?.error?.message) throw new Error(payload.error.message)
  undoableOperations.delete(operationId)
  return { path: payload?.result?.result?.data?.path }
}

export function subscribeBackendEvents(
  callback: (event: BackendEventEnvelope) => void,
): Promise<UnlistenFn> {
  return listen<BackendEventEnvelope>(BACKEND_EVENT, (event) => callback(event.payload))
}
