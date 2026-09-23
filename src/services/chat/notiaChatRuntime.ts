import type { AiImageAttachment, CancelableAiReplyHandle } from '../ai/aiRuntime'
import { resolveAiPreferencesForTransport, type AiPreferences } from '../preferences/aiSettingsStorage'
import type { StoredChatAttachment, StoredChatMessage } from './chatDocumentStorage'
import type { AgentConfirmationDecision, AgentProgressEvent, MutationPreview } from '../../types/ai/agentContracts'
import { createGlobalAiRequest, isGlobalAiChatRequest, type AiAppSurface, type GlobalAiChatRequest } from '../../types/ai/globalAiContract'
import type { TaskExecutionStep } from './chatAgentTypes'
import {
  configureBackendProvider,
  cancelBackendRequest,
  createBackendEventCursor,
  rememberUndoableBackendOperation,
  undoRememberedBackendOperation,
  resumeBackendRequest,
  runBackendRequest,
  subscribeBackendEvents,
  type BackendOperationRequest,
  type BackendResumeDecision,
  type BackendMessage,
  type BackendRequestEnvelope,
  type BackendScope,
} from '../backend/backendRuntime'

/**
 * UI adapter of a chat request: identity, selected prompt and the callbacks
 * that show the backend's clarifications, confirmations and plans. Tools,
 * prompts and authorization live in the Rust runtime.
 */
export interface NotiaChatAgent {
  libraryId?: string
  actor?: { libraryUserId: string; displayName?: string }
  /** Selected `.agent/promps` file. The backend runtime composes the prompt from it. */
  promptName?: string
  /** Operation the user asked to undo; Rust performs it directly. */
  undoOperationId?: string
  requestClarification?: (question: string, signal: AbortSignal, choices?: string[]) => Promise<string>
  requestConfirmation?: (question: string, signal: AbortSignal, preview?: MutationPreview) => Promise<boolean | AgentConfirmationDecision>
  requestExecutionPlanApproval?: (steps: TaskExecutionStep[], signal: AbortSignal) => Promise<{ approved: boolean; suggestion?: string; steps?: TaskExecutionStep[] }>
}

export interface NotiaChatReplyInput {
  requestId?: string
  globalRequest?: GlobalAiChatRequest
  prompt: string
  previousMessages: StoredChatMessage[]
  agent: NotiaChatAgent
  image?: AiImageAttachment | null
  /** Files of the conversation; the backend quotes their text and sends their pages as images. */
  attachments?: StoredChatAttachment[]
}

export interface NotiaChatReplyOptions {
  abortSignal?: AbortSignal
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentRoundStart?: (round: number) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
}

export interface GlobalAiChatReplyInput extends Omit<NotiaChatReplyInput, 'requestId' | 'prompt'> {
  request: GlobalAiChatRequest
}

/**
 * Single public execution facade for app, publication and Telegram adapters.
 * Transport-specific code supplies callbacks and an already-built agent; it
 * cannot alter identity, channel, library or the request id during a turn.
 */
export function runGlobalAiChat(
  preferences: AiPreferences,
  input: GlobalAiChatReplyInput,
  options: NotiaChatReplyOptions = {},
): Promise<string> {
  if (!isGlobalAiChatRequest(input.request)) {
    return Promise.reject(new Error('La solicitud global de IA es inválida o está incompleta.'))
  }
  if (input.agent.libraryId && input.agent.libraryId !== input.request.libraryId) {
    return Promise.reject(new Error('La solicitud global de IA no pertenece a la biblioteca activa.'))
  }
  if (isTauriBackendRuntimeAvailable()) {
    return runBackendGlobalAiChat(preferences, input, options)
  }
  return runNotiaChatReply(preferences, {
    ...input,
    requestId: input.request.requestId,
    prompt: input.request.prompt,
    globalRequest: input.request,
  }, options)
}

/** The Rust runtime is the execution path on every Tauri host (Windows and Android). */
function isTauriBackendRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function backendScope(value: string): BackendScope {
  if (value.includes('finance')) return 'finance'
  if (value.includes('task')) return 'task-manager'
  if (value.includes('graph')) return 'graph'
  if (value.includes('document')) return 'document'
  return 'library'
}

function backendChannel(request: GlobalAiChatRequest): 'app' | 'telegram' | 'meeting' | 'published' | 'multichat' {
  if (request.source.channel === 'telegram') return 'telegram'
  if (request.source.channel === 'public-url') return 'published'
  if (request.source.appSurface === 'meeting') return 'meeting'
  if (request.source.appSurface === 'multichat') return 'multichat'
  return 'app'
}

function backendSnapshot(request: GlobalAiChatRequest) {
  const snapshot = request.workspaceSnapshot
  return {
    snapshotVersion: snapshot.snapshotVersion,
    view: snapshot.view,
    scope: backendScope(String(snapshot.scope)),
    libraryId: request.libraryId,
    activeDocument: snapshot.activeDocument
      ? {
          path: snapshot.activeDocument.path,
          name: snapshot.activeDocument.name,
          kind: snapshot.activeDocument.kind,
          revision: snapshot.activeDocumentRevision ?? 0,
          dirty: snapshot.activeDocumentDirty,
        }
      : undefined,
    openTabs: snapshot.openTabs.map((tab) => ({
      path: tab.path,
      name: tab.name,
      kind: tab.kind,
      revision: tab.revision,
      dirty: tab.dirty,
    })),
    capabilities: {
      canReadActiveDocument: snapshot.capabilities.canReadActiveDocument,
      canReadLibrary: snapshot.capabilities.canReadLibrary,
      canWriteActiveDocument: snapshot.capabilities.canWriteActiveDocument,
      canWriteLibrary: snapshot.capabilities.canWriteLibrary,
      canSearchWeb: snapshot.capabilities.canSearchWeb,
      canAskClarification: snapshot.capabilities.canAskClarification,
      canRequestConfirmation: snapshot.capabilities.canRequestConfirmation,
    },
    capturedAt: snapshot.capturedAt,
    selection: snapshot.selection && snapshot.activeDocument?.path === snapshot.selection.documentPath
      ? {
          documentPath: snapshot.selection.documentPath,
          from: snapshot.selection.from,
          to: snapshot.selection.to,
          blocks: snapshot.selection.blocks.map((block) => ({ index: block.index, type: block.type, text: block.text })),
        }
      : undefined,
  }
}

function backendMessages(input: GlobalAiChatReplyInput): BackendMessage[] {
  const messages: BackendMessage[] = input.previousMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  messages.push({ role: 'user', content: input.request.prompt })
  const current = messages[messages.length - 1]
  if (input.image) {
    current.images = [input.image.base64, ...(input.image.additionalBase64 ?? [])]
  }
  if (input.attachments?.length) {
    current.attachments = input.attachments.map((attachment) => ({
      name: attachment.name,
      mediaType: attachment.mimeType,
      kind: attachment.kind,
      ...(attachment.kind === 'text' ? {} : { pages: [attachment.base64, ...(attachment.additionalBase64 ?? [])].filter(Boolean) }),
      ...(attachment.textContent ? { textContent: attachment.textContent } : {}),
      ...(attachment.extractedText ? { extractedText: attachment.extractedText } : {}),
      ...(attachment.pageCount ? { pageCount: attachment.pageCount } : {}),
    }))
  }
  return messages
}

function normalizeBackendPreview(value: unknown): MutationPreview | undefined {
  if (!value || typeof value !== 'object') return undefined
  const preview = value as {
    operationId?: unknown
    summary?: unknown
    documents?: unknown
    hunks?: unknown
    allowedActions?: unknown
  }
  if (typeof preview.operationId !== 'string' || typeof preview.summary !== 'string') return undefined
  const documents = Array.isArray(preview.documents) ? preview.documents.filter((document): document is { path: string; expectedRevision: number; currentRevision: number } => (
    typeof document === 'object'
    && document !== null
    && typeof (document as { path?: unknown }).path === 'string'
    && typeof (document as { expectedRevision?: unknown }).expectedRevision === 'number'
    && typeof (document as { currentRevision?: unknown }).currentRevision === 'number'
  )) : []
  const hunks = Array.isArray(preview.hunks) ? preview.hunks.filter((hunk): hunk is { id: string; documentPath: string; startLine: number; endLine: number; oldText: string; newText: string } => (
    typeof hunk === 'object'
    && hunk !== null
    && typeof (hunk as { id?: unknown }).id === 'string'
    && typeof (hunk as { documentPath?: unknown }).documentPath === 'string'
    && typeof (hunk as { oldText?: unknown }).oldText === 'string'
    && typeof (hunk as { newText?: unknown }).newText === 'string'
  )).map((hunk) => ({ ...hunk, status: 'pending' as const })) : []
  const allowedActions = Array.isArray(preview.allowedActions)
    ? preview.allowedActions.filter((action): action is MutationPreview['allowedActions'][number] => typeof action === 'string')
    : ['apply-all', 'reject', 'cancel'] as const
  return {
    operationId: preview.operationId,
    summary: preview.summary,
    documents,
    hunks,
    assumptions: [],
    risks: [],
    allowedActions,
  }
}

async function runBackendGlobalAiChat(
  preferences: AiPreferences,
  input: GlobalAiChatReplyInput,
  options: NotiaChatReplyOptions,
): Promise<string> {
  if (input.agent.undoOperationId) {
    const undone = await undoRememberedBackendOperation(input.agent.undoOperationId)
    options.onAgentProgress?.({
      type: 'tool-completed',
      requestId: input.request.requestId,
      operationId: input.agent.undoOperationId,
      round: 0,
      toolName: 'undo_ai_operation',
      ok: true,
      changed: true,
    })
    return undone.path
      ? `Deshice el último cambio de IA en \`${undone.path}\`.`
      : 'Deshice el último cambio de IA.'
  }
  // Fallback only: Rust runs each request with its library's saved AI settings.
  const transport = resolveAiPreferencesForTransport(preferences)
  await configureBackendProvider({
    ollamaUrl: transport.ollamaUrl,
    model: transport.selectedModel,
    apiKey: transport.apiKey,
    think: transport.thinkingEnabled ? transport.thinkingLevel : false,
  })
  const envelope: BackendRequestEnvelope = {
    protocolVersion: 2,
    request: {
      type: 'run',
      payload: {
        context: {
          requestId: input.request.requestId,
          libraryId: input.request.libraryId,
          actor: {
            libraryUserId: input.request.actor.libraryUserId,
            externalIdentity: input.request.actor.externalIdentity
              ? {
                  provider: input.request.actor.externalIdentity.provider,
                  userId: String(input.request.actor.externalIdentity.userId),
                  chatId: input.request.actor.externalIdentity.chatId,
                }
              : undefined,
          },
          channel: backendChannel(input.request),
          scope: backendScope(input.request.requestedScope),
          persistencePolicy: input.request.persistencePolicy,
        },
        messages: backendMessages(input),
        snapshot: backendSnapshot(input.request),
        // An empty projection asks Rust for its canonical catalog. The client
        // agent is only a UI adapter and must never be able to grant, mutate,
        // or redefine a backend tool by sending metadata from TypeScript.
        tools: [],
        idempotencyKey: `${input.request.libraryId}:${input.request.requestId}`,
        promptName: input.agent.promptName,
      },
    },
  }
  if (envelope.request.type !== 'run') throw new Error('El sobre backend no es una ejecución.')
  const runIdentity = {
    context: envelope.request.payload.context,
    idempotencyKey: envelope.request.payload.idempotencyKey,
    requestId: input.request.requestId,
  }
  const cursor = createBackendEventCursor(input.request.requestId)
  const unlisten = await subscribeBackendEvents((event) => {
    if (!cursor.accept(event)) return
    const eventType = event.event.type
    if (eventType === 'assistant-delta' && typeof event.event.delta === 'string') options.onMessageDelta?.(event.event.delta)
    if (eventType === 'thinking-summary' && typeof event.event.summary === 'string') options.onThinkingDelta?.(event.event.summary)
    if (eventType === 'round-started' && typeof event.event.round === 'number') options.onAgentRoundStart?.(event.event.round)
    if (eventType === 'tool-completed' && typeof event.event.toolName === 'string') {
      const operationId = typeof event.event.operationId === 'string' ? event.event.operationId : null
      const ok = event.event.ok === true
      const changed = typeof event.event.changed === 'boolean' ? event.event.changed : null
      if (operationId && ok && changed) {
        rememberUndoableBackendOperation(operationId, runIdentity)
      }
      options.onAgentProgress?.({
        type: 'tool-completed',
        requestId: input.request.requestId,
        operationId,
        round: typeof event.event.round === 'number' ? event.event.round : 0,
        toolName: event.event.toolName,
        ok,
        changed,
      })
    }
  })
  const signal = options.abortSignal ?? new AbortController().signal
  // Aborting while Rust executes stops the provider/tool loop by request
  // identity; aborting while waiting for a decision cancels the interaction.
  let awaitingDecision = false
  const cancelRun = () => {
    if (awaitingDecision) return
    void cancelBackendRequest(runIdentity).catch(() => undefined)
  }
  signal.addEventListener('abort', cancelRun, { once: true })
  try {
    if (signal.aborted) throw new DOMException('La operación backend fue cancelada.', 'AbortError')
    let response = await runBackendRequest(envelope)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const responseValue = response.response as {
        payload?: {
          response?: { response?: { markdown?: string; telegramHtml?: string } }
          error?: { message?: string; code?: string }
          status?: {
            lastEventSequence?: number
            operation?: { operationId: string; generation: number }
            interaction?: { type: string; payload: Record<string, unknown> }
          }
        }
      }
      const backendError = responseValue.payload?.error
      if (backendError && typeof backendError.message === 'string') {
        throw new Error(backendError.message)
      }
      const channelResponse = responseValue.payload?.response?.response
      // Telegram receives the HTML the backend derived from Markdown with every
      // model-written tag escaped; other channels render Markdown.
      if (backendChannel(input.request) === 'telegram' && typeof channelResponse?.telegramHtml === 'string') {
        return channelResponse.telegramHtml
      }
      const markdown = channelResponse?.markdown
      if (typeof markdown === 'string') return markdown
      const status = responseValue.payload?.status
      if (!status?.operation || !status.interaction) break
      const operationRequest: BackendOperationRequest = { ...runIdentity, operation: status.operation }
      if (signal.aborted) {
        await cancelBackendRequest(operationRequest).catch(() => undefined)
        throw new DOMException('La operación backend fue cancelada.', 'AbortError')
      }
      awaitingDecision = true
      let decision: BackendResumeDecision
      if (status.interaction.type === 'clarification' && input.agent.requestClarification) {
        const payload = status.interaction.payload
        const optionsValue = Array.isArray(payload.options)
          ? payload.options.filter((option): option is { label: string } => typeof option === 'object' && option !== null && typeof (option as { label?: unknown }).label === 'string')
          : undefined
        const answer = await input.agent.requestClarification(
          typeof payload.question === 'string' ? payload.question : 'Falta una aclaración.',
          signal,
          optionsValue?.map((option) => option.label),
        )
        decision = {
          type: 'clarification',
          payload: {
            clarificationId: String(payload.clarificationId ?? ''),
            operation: status.operation,
            answer,
          },
        }
      } else if (status.interaction.type === 'confirmation' && input.agent.requestConfirmation) {
        const payload = status.interaction.payload
        const preview = normalizeBackendPreview(payload.preview)
        const accepted = await input.agent.requestConfirmation(
          preview?.summary ?? 'Confirmar operación backend',
          signal,
          preview,
        )
        const normalized = typeof accepted === 'boolean' ? { accepted } : accepted
        decision = {
          type: 'confirmation',
          payload: {
            operationId: status.operation.operationId,
            accepted: normalized.accepted,
            hunkIds: normalized.hunkIds ? [...normalized.hunkIds] : [],
          },
        }
      } else if (status.interaction.type === 'plan' && input.agent.requestExecutionPlanApproval) {
        const payload = status.interaction.payload
        const steps = Array.isArray(payload.steps)
          ? payload.steps.filter((step): step is { id: string; label: string; status?: string } => (
              typeof step === 'object'
              && step !== null
              && typeof (step as { id?: unknown }).id === 'string'
              && typeof (step as { label?: unknown }).label === 'string'
            )).map((step) => ({
              id: step.id,
              label: step.label,
              status: step.status === 'completed' ? 'completed' : step.status === 'blocked' ? 'blocked' : 'pending',
            } as TaskExecutionStep))
          : []
        const planDecision = await input.agent.requestExecutionPlanApproval(steps, signal)
        decision = {
          type: 'plan',
          payload: {
            planId: String(payload.planId ?? ''),
            generation: Number(payload.generation ?? 0),
            accepted: planDecision.approved,
            stepIds: (planDecision.steps ?? steps).map((step) => step.id),
          },
        }
      } else {
        break
      }
      if (signal.aborted) {
        await cancelBackendRequest(operationRequest).catch(() => undefined)
        throw new DOMException('La operación backend fue cancelada.', 'AbortError')
      }
      awaitingDecision = false
      response = await resumeBackendRequest({
        ...operationRequest,
        lastEventSequence: Math.max(status.lastEventSequence ?? 0, cursor.lastSequence),
        decision,
      })
    }
    throw new Error('El runtime backend no devolvió una respuesta final.')
  } finally {
    signal.removeEventListener('abort', cancelRun)
    unlisten()
  }
}

export function createAppAiRequest(input: Omit<GlobalAiChatRequest, 'version' | 'source'> & {
  source?: never
  appSurface: AiAppSurface
}): GlobalAiChatRequest {
  return createGlobalAiRequest({
    ...input,
    source: { channel: 'app', appSurface: input.appSurface },
  })
}

export function runNotiaChatReply(
  preferences: AiPreferences,
  input: NotiaChatReplyInput,
  options: NotiaChatReplyOptions = {},
): Promise<string> {
  void preferences
  void input
  void options
  // The Rust runtime is the only agent executor; a request without a
  // library and a workspace snapshot cannot run.
  return Promise.reject(new Error('La solicitud de IA necesita una biblioteca activa y un contexto válido para ejecutarse en el backend.'))
}

export function startNotiaChatReply(
  preferences: AiPreferences,
  input: NotiaChatReplyInput,
  options: Omit<NotiaChatReplyOptions, 'abortSignal'> = {},
): CancelableAiReplyHandle {
  const controller = new AbortController()
  return {
    abort: () => controller.abort(),
    promise: runNotiaChatReply(preferences, input, { ...options, abortSignal: controller.signal }),
  }
}

export function startGlobalAiChat(
  preferences: AiPreferences,
  input: GlobalAiChatReplyInput,
  options: Omit<NotiaChatReplyOptions, 'abortSignal'> = {},
): CancelableAiReplyHandle {
  const controller = new AbortController()
  return {
    abort: () => controller.abort(),
    promise: runGlobalAiChat(preferences, input, { ...options, abortSignal: controller.signal }),
  }
}
