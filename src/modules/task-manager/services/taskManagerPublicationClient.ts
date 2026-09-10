import type { TaskManagerSettings } from '../types/taskManagerTypes'
import {
  isRecord,
  PUBLICATION_VAULT_ALIAS,
  TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
  type PublicationConflict,
  type PublicationEvent,
  type PublicationHello,
  type TaskManagerMutation,
} from './taskManagerPublicationProtocol'

export type {
  MutationAck as TaskManagerPublicationAckFrame,
  PublicationHello as TaskManagerPublicationHelloFrame,
  PublicationWelcome as TaskManagerPublicationWelcomeFrame,
  TaskManagerMutation as TaskManagerPublicationMutateFrame,
} from './taskManagerPublicationProtocol'

const MUTATING_COMMAND_NAMES = [
  'write_library_file',
  'append_task_comment',
  'create_library_entry',
  'library_entry_operation',
  'begin_task_manager_publication_batch',
  'end_task_manager_publication_batch',
  'update_task_manager_publication_settings',
] as const
const MUTATING_COMMANDS = new Set<string>(MUTATING_COMMAND_NAMES)
const INITIAL_RECONNECT_DELAY_MS = 250
const MAX_RECONNECT_DELAY_MS = 5_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const MUTATION_TIMEOUT_MS = 15_000
const MAX_MUTATION_RETRIES = 2
const MAX_PENDING_MUTATIONS = 32
const MAX_PROTOCOL_ID_LENGTH = 128
const MAX_PROTOCOL_TEXT_LENGTH = 2_000

export type TaskManagerPublicationMutationCommand = typeof MUTATING_COMMAND_NAMES[number]

export interface TaskManagerPublicationMutationArgs {
  write_library_file: {
    payload: {
      filePath: string
      content: string
      expectedRevision?: string
    }
  }
  append_task_comment: {
    payload: {
      filePath: string
      comment: string
    }
  }
  create_library_entry: {
    payload: {
      directoryPath: string
      name: string
      kind: 'folder' | 'note'
    }
  }
  library_entry_operation: {
    payload: {
      action: 'delete' | 'rename' | 'paste'
      targetPath?: string
      newName?: string
      sourcePath?: string
      targetDirectoryPath?: string
      mode?: 'move'
    }
  }
  begin_task_manager_publication_batch: Record<string, never>
  end_task_manager_publication_batch: Record<string, never>
  update_task_manager_publication_settings: {
    settings: Pick<TaskManagerSettings, 'boards' | 'groups'>
  }
}

export type TaskManagerPublicationMutationRequest = {
  [Command in TaskManagerPublicationMutationCommand]: {
    command: Command
    args: TaskManagerPublicationMutationArgs[Command]
  }
}[TaskManagerPublicationMutationCommand]

export interface PublishedTaskManagerConnectionBootstrap {
  publicationEpoch: string
  revision: number
  sequence: number
  settings: TaskManagerSettings
}

export type TaskManagerPublicationChange = PublicationEvent

export type TaskManagerPublicationStatus =
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'paused'
  | 'offline'
  | 'conflict'
  | 'revoked'
  | 'stopped'
  | 'reconfigured'
  | 'closed'

export interface TaskManagerPublicationMutationOptions {
  signal?: AbortSignal
}

type PublicationListener = (change: TaskManagerPublicationChange) => void
type PublicationStatusListener = (status: TaskManagerPublicationStatus) => void

export type TaskManagerPublicationConflict = PublicationConflict

export class TaskManagerPublicationMutationError extends Error {
  readonly operationId: string
  readonly command: TaskManagerPublicationMutationCommand
  readonly retryable: boolean
  readonly outcome: 'failed' | 'unknown'
  readonly conflict?: TaskManagerPublicationConflict

  constructor(message: string, options: {
    operationId: string
    command: TaskManagerPublicationMutationCommand
    retryable: boolean
    outcome?: 'failed' | 'unknown'
    conflict?: TaskManagerPublicationConflict
  }) {
    super(message)
    this.name = 'TaskManagerPublicationMutationError'
    this.operationId = options.operationId
    this.command = options.command
    this.retryable = options.retryable
    this.outcome = options.outcome ?? 'failed'
    this.conflict = options.conflict
  }
}

interface PendingMutation {
  messageId: string
  operationId: string
  command: TaskManagerPublicationMutationCommand
  args: Record<string, unknown>
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  sent: boolean
  retryCount: number
  timeout?: number
  abortCleanup?: () => void
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function websocketUrl(publicationPath: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${publicationPath}/ws`
}

function parsePublicationChangedPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((path): path is string => (
    typeof path === 'string'
    && path.length <= 512
    && !path.includes('..')
    && !path.split('').some((character) => character.charCodeAt(0) < 32)
    && (path === PUBLICATION_VAULT_ALIAS || path.startsWith(`${PUBLICATION_VAULT_ALIAS}/`))
  )).slice(0, 32)
}

function isSafePublicationCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength) return undefined
  return value
}

function parseOptionalBoundedString(value: Record<string, unknown>, key: string, maxLength: number): string | undefined | null {
  if (!(key in value) || value[key] === undefined) return undefined
  const parsed = parseBoundedString(value[key], maxLength)
  return parsed ?? null
}

function asPublicationChange(value: unknown): TaskManagerPublicationChange | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }
  if (!['changed', 'resync-required', 'access-revoked', 'publication-stopped', 'publication-reconfigured'].includes(value.type)) {
    return null
  }
  if (value.protocolVersion !== TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION) {
    return null
  }
  const messageId = parseOptionalBoundedString(value, 'messageId', MAX_PROTOCOL_ID_LENGTH)
  const publicationEpoch = parseOptionalBoundedString(value, 'publicationEpoch', MAX_PROTOCOL_ID_LENGTH)
  const operationId = parseOptionalBoundedString(value, 'operationId', MAX_PROTOCOL_ID_LENGTH)
  const actorId = parseOptionalBoundedString(value, 'actorId', MAX_PROTOCOL_ID_LENGTH)
  const reason = parseOptionalBoundedString(value, 'reason', MAX_PROTOCOL_TEXT_LENGTH)
  if (messageId === null || publicationEpoch === null || operationId === null || actorId === null || reason === null) {
    return null
  }
  if (publicationEpoch !== undefined && publicationEpoch.trim().length === 0) return null
  if (operationId !== undefined && operationId.trim().length === 0) return null
  if (actorId !== undefined && actorId.trim().length === 0) return null
  if (('sequence' in value && value.sequence !== undefined && !isSafePublicationCounter(value.sequence))
    || ('revision' in value && value.revision !== undefined && !isSafePublicationCounter(value.revision))) {
    return null
  }
  return {
    type: value.type as TaskManagerPublicationChange['type'],
    protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
    messageId,
    publicationEpoch,
    revision: typeof value.revision === 'number' ? value.revision : undefined,
    sequence: typeof value.sequence === 'number' ? value.sequence : undefined,
    changedPaths: parsePublicationChangedPaths(value.changedPaths),
    operationId,
    actorId,
    reason,
    settings: value.settings,
  }
}

export function isTaskManagerPublicationMutationCommand(command: string): command is TaskManagerPublicationMutationCommand {
  return MUTATING_COMMANDS.has(command)
}

export class TaskManagerPublicationClient {
  private readonly publicationPath: string
  private readonly listeners = new Set<PublicationListener>()
  private readonly statusListeners = new Set<PublicationStatusListener>()
  private readonly pendingMutations = new Map<string, PendingMutation>()
  private readonly retiredPublicationEpochs = new Set<string>()
  private socket: WebSocket | null = null
  private reconnectTimer: number | undefined
  private reconnectAttempt = 0
  private stopped = false
  private welcomed = false
  private handshakeTimer: number | undefined
  private resyncing = false
  private publicationEpoch: string
  private sequence: number
  private revision: number
  private status: TaskManagerPublicationStatus = 'connecting'
  private terminalStatus = false
  private backgrounded = false
  private visibilityChangeHandler: (() => void) | null = null
  private activeBatchOperationId: string | null = null
  private batchNeedsResume = false
  private batchResumeMessageId: string | null = null

  constructor(publicationPath: string, bootstrap: PublishedTaskManagerConnectionBootstrap) {
    this.publicationPath = publicationPath
    this.publicationEpoch = bootstrap.publicationEpoch
    this.sequence = bootstrap.sequence
    this.revision = bootstrap.revision
    this.backgrounded = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    this.installLifecycleListeners()
    if (this.backgrounded) {
      this.setStatus('paused')
    } else {
      this.connect()
    }
  }

  subscribe(listener: PublicationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeStatus(listener: PublicationStatusListener): () => void {
    this.statusListeners.add(listener)
    listener(this.status)
    return () => this.statusListeners.delete(listener)
  }

  getStatus(): TaskManagerPublicationStatus {
    return this.status
  }

  setActiveBatchOperation(operationId: string | null): void {
    this.activeBatchOperationId = operationId
    this.batchResumeMessageId = null
    this.batchNeedsResume = operationId !== null
      && (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.welcomed)
  }

  invokeMutation(
    command: string,
    args: Record<string, unknown>,
    requestedOperationId?: string,
    options?: TaskManagerPublicationMutationOptions,
  ): Promise<unknown> {
    if (!isTaskManagerPublicationMutationCommand(command)) {
      return Promise.reject(new Error(`El comando publicado no es una mutación: ${command}`))
    }
    if (this.stopped || this.terminalStatus) {
      return Promise.reject(new Error('La publicación ya no acepta mutaciones.'))
    }
    if (this.pendingMutations.size >= MAX_PENDING_MUTATIONS) {
      return Promise.reject(new Error('Hay demasiadas mutaciones pendientes de confirmacion.'))
    }
    const operationId = requestedOperationId ?? createMessageId()
    if (
      operationId.length === 0
      || operationId.length > MAX_PROTOCOL_ID_LENGTH
      || operationId.split('').some((character) => character.charCodeAt(0) < 32)
    ) {
      return Promise.reject(new Error('La mutación publicada tiene un operationId inválido.'))
    }
    if (options?.signal?.aborted) {
      return Promise.reject(new TaskManagerPublicationMutationError(
        'La mutación fue cancelada antes de enviarse.',
        { operationId, command, retryable: false, outcome: 'failed' },
      ))
    }
    return new Promise((resolve, reject) => {
      const messageId = createMessageId()
      const pending: PendingMutation = {
        messageId,
        operationId,
        command,
        args,
        resolve,
        reject,
        sent: false,
        retryCount: 0,
      }
      this.pendingMutations.set(messageId, pending)
      if (options?.signal) {
        const abortHandler = () => {
          const current = this.pendingMutations.get(messageId)
          if (!current) return
          if (current.sent) this.sendMutationCancellation(operationId)
          if (current.timeout !== undefined) window.clearTimeout(current.timeout)
          current.timeout = undefined
          current.abortCleanup = undefined
          this.pendingMutations.delete(messageId)
          current.reject(new TaskManagerPublicationMutationError(
            current.sent
              ? 'La mutación se canceló después de enviarse y su resultado quedó sin confirmar.'
              : 'La mutación fue cancelada antes de enviarse.',
            {
              operationId,
              command: current.command,
              retryable: false,
              outcome: current.sent ? 'unknown' : 'failed',
            },
          ))
          this.flushPendingMutations()
        }
        pending.abortCleanup = () => options.signal?.removeEventListener('abort', abortHandler)
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }
      this.armMutationTimeout(messageId)
      this.flushPendingMutations()
    })
  }

  close(): void {
    this.stopped = true
    if (!this.terminalStatus) this.setStatus('closed')
    if (this.visibilityChangeHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler)
    }
    this.visibilityChangeHandler = null
    if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.clearHandshakeTimer()
    for (const [messageId, pending] of this.pendingMutations) {
      if (pending.timeout !== undefined) window.clearTimeout(pending.timeout)
      pending.abortCleanup?.()
      pending.abortCleanup = undefined
      pending.reject(new TaskManagerPublicationMutationError(
        'La conexión de publicación fue cerrada antes de confirmar la mutación.',
        {
          operationId: pending.operationId,
          command: pending.command,
          retryable: false,
          outcome: pending.sent ? 'unknown' : 'failed',
        },
      ))
      this.pendingMutations.delete(messageId)
    }
    this.disconnectSocket()
  }

  private setStatus(status: TaskManagerPublicationStatus): void {
    if (this.status === status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private disconnectSocket(): void {
    const socket = this.socket
    if (this.activeBatchOperationId) this.batchNeedsResume = true
    this.batchResumeMessageId = null
    this.socket = null
    this.welcomed = false
    this.clearHandshakeTimer()
    socket?.close()
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== undefined) window.clearTimeout(this.handshakeTimer)
    this.handshakeTimer = undefined
  }

  private acceptPublicationEpoch(publicationEpoch: string): void {
    if (publicationEpoch === this.publicationEpoch) return
    this.retiredPublicationEpochs.add(this.publicationEpoch)
    while (this.retiredPublicationEpochs.size > 8) {
      const oldestEpoch = this.retiredPublicationEpochs.values().next().value
      if (oldestEpoch === undefined) break
      this.retiredPublicationEpochs.delete(oldestEpoch)
    }
    this.publicationEpoch = publicationEpoch
    this.sequence = 0
    this.revision = 0
  }

  private installLifecycleListeners(): void {
    if (typeof document === 'undefined') return
    this.visibilityChangeHandler = () => this.handleVisibilityChange()
    document.addEventListener('visibilitychange', this.visibilityChangeHandler)
  }

  private handleVisibilityChange(): void {
    if (typeof document === 'undefined') return
    const hidden = document.hidden || document.visibilityState === 'hidden'
    if (hidden) {
      this.backgrounded = true
      if (this.reconnectTimer !== undefined) window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
      for (const pending of this.pendingMutations.values()) {
        pending.sent = false
        if (pending.timeout !== undefined) window.clearTimeout(pending.timeout)
        pending.timeout = undefined
      }
      this.disconnectSocket()
      if (!this.stopped && !this.terminalStatus) this.setStatus('paused')
      return
    }

    if (!this.backgrounded || this.stopped || this.terminalStatus) return
    this.backgrounded = false
    this.reconnectAttempt = 0
    this.resyncing = true
    this.setStatus('syncing')
    void this.refreshBootstrap().then((refreshed) => {
      this.resyncing = false
      if (this.backgrounded || this.stopped || this.terminalStatus) return
      if (!refreshed) {
        this.setStatus('offline')
        this.scheduleReconnect()
        return
      }
      for (const messageId of this.pendingMutations.keys()) this.armMutationTimeout(messageId)
      this.connect()
    })
  }

  private connect(): void {
    if (this.stopped || this.backgrounded || this.socket) return
    let socket: WebSocket
    try {
      socket = new WebSocket(websocketUrl(this.publicationPath))
    } catch {
      this.setStatus('offline')
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.setStatus('connecting')
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.reconnectAttempt = 0
      for (const pending of this.pendingMutations.values()) pending.sent = false
      const hello: PublicationHello = {
        type: 'hello',
        protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
        messageId: createMessageId(),
        publicationEpoch: this.publicationEpoch,
        lastSequence: this.sequence,
      }
      socket.send(JSON.stringify(hello))
    })
    this.handshakeTimer = window.setTimeout(() => {
      if (this.socket !== socket || this.welcomed) return
      this.setStatus('offline')
      this.disconnectSocket()
      this.scheduleReconnect()
    }, HANDSHAKE_TIMEOUT_MS)
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      this.handleMessage(event.data)
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      if (this.activeBatchOperationId) this.batchNeedsResume = true
      this.batchResumeMessageId = null
      this.socket = null
      this.welcomed = false
      this.clearHandshakeTimer()
      if (!this.stopped) {
        this.setStatus('offline')
        this.scheduleReconnect()
      }
    })
    socket.addEventListener('error', () => {
      if (this.socket !== socket) return
      // close is responsible for the bounded reconnect loop and pending operation retry.
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.backgrounded || this.reconnectTimer !== undefined) return
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      INITIAL_RECONNECT_DELAY_MS * (2 ** Math.min(this.reconnectAttempt, 5)),
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  private handleMessage(rawMessage: unknown): void {
    let message: unknown
    try {
      message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage
    } catch {
      return
    }
    if (!isRecord(message) || typeof message.type !== 'string') return

    if (message.type === 'error' && typeof message.error === 'string') {
      const normalizedError = message.error.toLowerCase()
      if (normalizedError.includes('capacidad')) {
        // Capacity is recoverable: keep the authenticated session and let the
        // socket close/reconnect when another client disconnects.
        this.setStatus('offline')
      } else if (normalizedError.includes('autoriz') || normalizedError.includes('acceso')) {
        this.emitChange({
          type: 'access-revoked',
          protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
          publicationEpoch: this.publicationEpoch,
          messageId: typeof message.messageId === 'string' ? message.messageId : undefined,
          reason: 'La sesión ya no está autorizada.',
        })
      } else if (normalizedError.includes('publicaci') || normalizedError.includes('sesión')) {
        this.emitChange({
          type: 'publication-reconfigured',
          protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
          publicationEpoch: this.publicationEpoch,
          messageId: typeof message.messageId === 'string' ? message.messageId : undefined,
          reason: 'La publicación ya no está disponible.',
        })
      }
      return
    }

    if (message.type === 'welcome') {
      if (message.protocolVersion !== TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION) return
      const publicationEpoch = parseBoundedString(message.publicationEpoch, MAX_PROTOCOL_ID_LENGTH)
      if (!publicationEpoch || publicationEpoch.trim().length === 0
        || !isSafePublicationCounter(message.sequence)
        || !isSafePublicationCounter(message.revision)) {
        return
      }
      this.clearHandshakeTimer()
      this.acceptPublicationEpoch(publicationEpoch)
      this.welcomed = true
      const replay = Array.isArray(message.replay) ? message.replay : []
      for (const item of replay) this.emitChange(item)
      this.sequence = Math.max(this.sequence, message.sequence)
      this.revision = Math.max(this.revision, message.revision)
      this.setStatus(this.resyncing ? 'syncing' : 'connected')
      if (!this.resyncing) {
        if (this.shouldResumeActiveBatch()) this.sendBatchResume()
        else {
          // If the connection dropped while the batch close was in flight,
          // retry that exact close. Reopening the batch first could resurrect
          // an operation that the server already completed and deduplicated.
          if (this.hasPendingActiveBatchEnd()) this.batchNeedsResume = false
          this.flushPendingMutations()
        }
      }
      return
    }

    if (message.type === 'ack') {
      if (message.protocolVersion !== TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION) return
      const messageId = parseBoundedString(message.messageId, MAX_PROTOCOL_ID_LENGTH) ?? ''
      const operationId = parseBoundedString(message.operationId, MAX_PROTOCOL_ID_LENGTH) ?? ''
      if (messageId === this.batchResumeMessageId && operationId === this.activeBatchOperationId) {
        this.batchResumeMessageId = null
        if (message.ok === true) {
          this.batchNeedsResume = false
          if (isSafePublicationCounter(message.sequence)) this.sequence = Math.max(this.sequence, message.sequence)
          if (isSafePublicationCounter(message.revision)) this.revision = Math.max(this.revision, message.revision)
          this.setStatus('connected')
          this.flushPendingMutations()
        } else {
          this.setStatus('offline')
          this.disconnectSocket()
          this.scheduleReconnect()
        }
        return
      }
      const pending = this.pendingMutations.get(messageId)
      if (!pending || pending.operationId !== operationId) return
      this.pendingMutations.delete(messageId)
      pending.abortCleanup?.()
      pending.abortCleanup = undefined
      if (pending.timeout !== undefined) window.clearTimeout(pending.timeout)
      pending.timeout = undefined
      const acknowledgedSequence = isSafePublicationCounter(message.sequence) ? message.sequence : undefined
      const shouldEmitAcknowledgedChange = message.ok === true
        && message.changed === true
        && acknowledgedSequence !== undefined
        && acknowledgedSequence > this.sequence
      if (acknowledgedSequence !== undefined) this.sequence = Math.max(this.sequence, acknowledgedSequence)
      if (isSafePublicationCounter(message.revision)) this.revision = Math.max(this.revision, message.revision)
      if (message.ok === true) {
        this.setStatus('connected')
        if (shouldEmitAcknowledgedChange) {
          for (const listener of this.listeners) {
            listener({
              type: 'changed',
              protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
              messageId: typeof message.messageId === 'string' ? message.messageId : undefined,
              publicationEpoch: typeof message.publicationEpoch === 'string' ? message.publicationEpoch : this.publicationEpoch,
              revision: isSafePublicationCounter(message.revision) ? message.revision : undefined,
              sequence: acknowledgedSequence,
              operationId: pending.operationId,
              changedPaths: parsePublicationChangedPaths(message.changedPaths),
              settings: isRecord(message.result) ? message.result.settings : undefined,
            })
          }
        }
        pending.resolve(message.result)
      }
      else {
        const error = typeof message.error === 'string' ? message.error : 'La mutación fue rechazada.'
        const conflict = isRecord(message.conflict) && typeof message.conflict.kind === 'string'
          ? {
              kind: message.conflict.kind,
              expectedRevision: isSafePublicationCounter(message.conflict.expectedRevision) ? message.conflict.expectedRevision : undefined,
              currentRevision: isSafePublicationCounter(message.conflict.currentRevision) ? message.conflict.currentRevision : undefined,
              operationId: parseBoundedString(message.conflict.operationId, MAX_PROTOCOL_ID_LENGTH),
              actorId: parseBoundedString(message.conflict.actorId, MAX_PROTOCOL_ID_LENGTH),
            }
          : undefined
        if (conflict || error.toLowerCase().includes('conflict') || error.toLowerCase().includes('conflicto')) {
          this.setStatus('conflict')
        }
        pending.reject(new TaskManagerPublicationMutationError(error, {
          operationId: pending.operationId,
          command: pending.command,
          retryable: message.retryable === true,
          outcome: message.outcome === 'unknown' ? 'unknown' : 'failed',
          conflict,
        }))
      }
      this.flushPendingMutations()
      return
    }

    if (message.type === 'resync-required') {
      if (message.protocolVersion !== TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION) return
      const notification = asPublicationChange(message)
      this.beginResync(
        typeof message.reason === 'string' ? message.reason : 'history-window',
        notification ?? undefined,
      )
      return
    }

    const change = asPublicationChange(message)
    if (change) this.emitChange(change)
  }

  private emitChange(rawChange: unknown): void {
    const change = asPublicationChange(rawChange)
    if (!change) return
    if (this.resyncing && change.type === 'changed') return
    if (change.publicationEpoch && change.publicationEpoch !== this.publicationEpoch) {
      // A delayed change from a retired socket must never reset the cursor
      // backwards. An unknown epoch is accepted as a fresh stream so the
      // client can recover even if the terminal frame was lost.
      if (this.retiredPublicationEpochs.has(change.publicationEpoch)) return
      this.acceptPublicationEpoch(change.publicationEpoch)
    }
    if (isSafePublicationCounter(change.sequence)) {
      if (
        !this.resyncing
        && change.type === 'changed'
        && change.sequence > this.sequence + 1
      ) {
        this.beginResync('sequence-gap')
        return
      }
      if (change.sequence <= this.sequence && change.type === 'changed') return
      this.sequence = Math.max(this.sequence, change.sequence)
    }
    if (isSafePublicationCounter(change.revision)) this.revision = Math.max(this.revision, change.revision)
    for (const listener of this.listeners) listener(change)
    if (change.type === 'access-revoked' || change.type === 'publication-stopped' || change.type === 'publication-reconfigured') {
      this.terminalStatus = true
      this.setStatus(change.type === 'access-revoked'
        ? 'revoked'
        : change.type === 'publication-stopped' ? 'stopped' : 'reconfigured')
      this.close()
    }
  }

  private flushPendingMutations(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.welcomed || this.resyncing || this.batchNeedsResume) return
    for (const pending of this.pendingMutations.values()) {
      if (pending.sent) return
      try {
        pending.sent = true
        const mutation: TaskManagerMutation = {
          type: 'mutate',
          protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
          // messageId identifies this individual idempotent write. operationId
          // may intentionally be shared by begin/write/end inside one batch.
          messageId: pending.messageId,
          operationId: pending.operationId,
          baseRevision: this.revision,
          command: pending.command,
          args: pending.args,
        }
        this.socket.send(JSON.stringify(mutation))
      } catch {
        pending.sent = false
        this.disconnectSocket()
        return
      }
      return
    }
  }

  private shouldResumeActiveBatch(): boolean {
    if (!this.activeBatchOperationId || !this.batchNeedsResume) return false
    return !this.hasPendingActiveBatchEnd()
  }

  private hasPendingActiveBatchEnd(): boolean {
    if (!this.activeBatchOperationId) return false
    return Array.from(this.pendingMutations.values()).some((pending) => (
      pending.operationId === this.activeBatchOperationId
      && pending.command === 'end_task_manager_publication_batch'
    ))
  }

  private sendBatchResume(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.welcomed || !this.activeBatchOperationId) return
    const messageId = createMessageId()
    this.batchResumeMessageId = messageId
    this.setStatus('syncing')
    try {
      this.socket.send(JSON.stringify({
        type: 'mutate',
        protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
        messageId,
        operationId: this.activeBatchOperationId,
        baseRevision: this.revision,
        command: 'begin_task_manager_publication_batch',
        args: {},
      } satisfies TaskManagerMutation))
    } catch {
      this.disconnectSocket()
      this.scheduleReconnect()
    }
  }

  private sendMutationCancellation(operationId: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.welcomed) return
    try {
      this.socket.send(JSON.stringify({
        type: 'cancel',
        protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
        messageId: createMessageId(),
        operationId,
      }))
    } catch {
      // The caller already received an unknown outcome. Do not retry it from
      // the reconnect path because cancellation ended ownership of this frame.
    }
  }

  private retryPendingMutation(messageId: string): void {
    const pending = this.pendingMutations.get(messageId)
    if (!pending || this.stopped) return
    pending.timeout = undefined
    if (pending.retryCount >= MAX_MUTATION_RETRIES) {
      this.pendingMutations.delete(messageId)
      pending.abortCleanup?.()
      pending.abortCleanup = undefined
      pending.reject(new TaskManagerPublicationMutationError(
        'La mutación no fue confirmada después de varios intentos. Actualizá el estado antes de volver a crearla.',
        {
          operationId: pending.operationId,
          command: pending.command,
          retryable: false,
          outcome: 'unknown',
        },
      ))
      this.setStatus('offline')
      this.flushPendingMutations()
      return
    }
    pending.retryCount += 1
    pending.sent = false
    if (this.backgrounded) {
      this.setStatus('paused')
      return
    }
    this.armMutationTimeout(messageId)
    this.disconnectSocket()
    this.scheduleReconnect()
  }

  private armMutationTimeout(messageId: string): void {
    const pending = this.pendingMutations.get(messageId)
    if (!pending || this.backgrounded || this.stopped) return
    if (pending.timeout !== undefined) window.clearTimeout(pending.timeout)
    pending.timeout = window.setTimeout(() => {
      this.retryPendingMutation(messageId)
    }, MUTATION_TIMEOUT_MS)
  }

  private async refreshBootstrap(): Promise<boolean> {
    try {
      const response = await fetch(`${this.publicationPath}/bootstrap`, { cache: 'no-store' })
      if (!response.ok) throw new Error('El bootstrap de publicación no está disponible.')
      const bootstrap = await response.json() as Partial<PublishedTaskManagerConnectionBootstrap>
      if (typeof bootstrap.publicationEpoch !== 'string'
        || bootstrap.publicationEpoch.trim().length === 0
        || bootstrap.publicationEpoch.length > MAX_PROTOCOL_ID_LENGTH
        || !isSafePublicationCounter(bootstrap.sequence)
        || !isSafePublicationCounter(bootstrap.revision)
        || !isRecord(bootstrap.settings)) {
        throw new Error('El bootstrap de publicación es inválido.')
      }
      this.acceptPublicationEpoch(bootstrap.publicationEpoch)
      this.sequence = bootstrap.sequence
      this.revision = bootstrap.revision
      for (const listener of this.listeners) {
        listener({
          type: 'changed',
          protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
          publicationEpoch: this.publicationEpoch,
          sequence: this.sequence,
          revision: this.revision,
          settings: bootstrap.settings,
        })
      }
      return true
    } catch (error) {
      console.warn('[task-manager] no se pudo resincronizar la publicación', error)
      return false
    }
  }

  private beginResync(reason: string, notification?: TaskManagerPublicationChange): void {
    if (this.resyncing || this.stopped || this.backgrounded) return
    this.resyncing = true
    this.setStatus('syncing')
    for (const pending of this.pendingMutations.values()) {
      pending.sent = false
      if (pending.timeout !== undefined) window.clearTimeout(pending.timeout)
      pending.timeout = undefined
    }
    if (notification) {
      for (const listener of this.listeners) listener(notification)
    } else {
      this.emitChange({
        type: 'resync-required',
        protocolVersion: TASK_MANAGER_PUBLICATION_PROTOCOL_VERSION,
        publicationEpoch: this.publicationEpoch,
        reason,
      })
    }
    void this.refreshBootstrap().then((refreshed) => {
      this.resyncing = false
      if (this.backgrounded || this.stopped || this.terminalStatus) return
      if (refreshed) {
        if (!this.welcomed) {
          this.connect()
          return
        }
        this.setStatus('connected')
        for (const messageId of this.pendingMutations.keys()) this.armMutationTimeout(messageId)
        this.flushPendingMutations()
        return
      }
      this.setStatus('offline')
      this.disconnectSocket()
      this.scheduleReconnect()
    })
  }

}

let activePublicationClient: TaskManagerPublicationClient | null = null
let activePublishedBatchOperationId: string | null = null

export function setActiveTaskManagerPublicationBatchOperation(operationId: string | null): void {
  activePublishedBatchOperationId = operationId
  activePublicationClient?.setActiveBatchOperation(operationId)
}

export function initializeTaskManagerPublicationClient(
  publicationPath: string,
  bootstrap: PublishedTaskManagerConnectionBootstrap,
): TaskManagerPublicationClient {
  activePublicationClient?.close()
  activePublicationClient = new TaskManagerPublicationClient(publicationPath, bootstrap)
  if (activePublishedBatchOperationId) {
    activePublicationClient.setActiveBatchOperation(activePublishedBatchOperationId)
  }
  return activePublicationClient
}

export function subscribeTaskManagerPublicationChanges(listener: PublicationListener): () => void {
  return activePublicationClient?.subscribe(listener) ?? (() => {})
}

export function subscribeTaskManagerPublicationStatus(listener: PublicationStatusListener): () => void {
  return activePublicationClient?.subscribeStatus(listener) ?? (() => {})
}

export function getTaskManagerPublicationStatus(): TaskManagerPublicationStatus | 'uninitialized' {
  return activePublicationClient?.getStatus() ?? 'uninitialized'
}

export function invokePublishedTaskManagerMutation(
  command: string,
  args: Record<string, unknown>,
  operationId?: string,
  options?: TaskManagerPublicationMutationOptions,
): Promise<unknown> {
  if (!activePublicationClient) {
    return Promise.reject(new Error('La conexión WebSocket de publicación todavía no está lista.'))
  }
  return activePublicationClient.invokeMutation(
    command,
    args,
    operationId ?? activePublishedBatchOperationId ?? undefined,
    options,
  )
}

export function invokeTaskManagerPublicationMutation(
  request: TaskManagerPublicationMutationRequest,
  operationId?: string,
  options?: TaskManagerPublicationMutationOptions,
): Promise<unknown> {
  return invokePublishedTaskManagerMutation(
    request.command,
    request.args,
    operationId,
    options,
  )
}
