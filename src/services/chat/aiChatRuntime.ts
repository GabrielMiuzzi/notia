import { callBackend, subscribeBackend, type Unsubscribe } from '../transport'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { resolveAiPreferencesForTransport } from '../preferences/aiSettingsStorage'
import type { StoredChatAttachment, StoredChatDocument, StoredChatMessage } from './chatDocumentStorage'
import type { TaskExecutionStep } from './chatAgentTypes'
import type {
  AgentConfirmationDecision,
  AgentProgressEvent,
  MutationPreview,
  WorkspaceAiSnapshot,
} from '../../types/ai/agentContracts'

/**
 * Chat turn client. The backend reads the chat, picks the messages the agent
 * sees, runs the agent, saves the turn and names new chats; this module sends
 * the message, forwards the streamed events and relays the questions of the
 * agent to the views that answer them.
 */

const BACKEND_EVENT = 'notia:backend-event'
const INTERACTION_EVENT = 'ai-chat-interaction'
const TITLE_EVENT = 'ai-chat-title'

export type ChatTurnTarget =
  | { kind: 'saved'; path: string }
  | { kind: 'ephemeral'; document: StoredChatDocument }
  | { kind: 'transient'; messages: StoredChatMessage[] }

export interface ChatTurnInput {
  libraryId: string
  mode: 'chat' | 'meeting' | 'published'
  /** Preferences in use; the backend prefers the library's saved AI settings. */
  preferences?: AiPreferences
  scope?: string
  message: string
  /** Temporary context: the active room or view, or the Meeting transcript. */
  context?: string | null
  attachments?: StoredChatAttachment[]
  promptName?: string
  undoOperationId?: string
  workspace?: WorkspaceAiSnapshot | null
  selection?: {
    scopeKey: string | null
    files: string[]
    mode: 'direct' | 'index'
    keepChatContext: boolean
  }
  libraryUserId?: string
  /** Multichat room beside the chat; the backend adds its conversation as context. */
  multichatRoomId?: string
  chat: ChatTurnTarget
}

export interface ChatTurnOutcome {
  answer: string
  dataChanged: boolean
  document?: StoredChatDocument
  undoneOperationId?: string
}

export interface ChatTurnHandlers {
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
  requestClarification?: (question: string, signal: AbortSignal, choices?: string[]) => Promise<string>
  requestConfirmation?: (question: string, signal: AbortSignal, preview?: MutationPreview) => Promise<boolean | AgentConfirmationDecision>
  requestExecutionPlanApproval?: (steps: TaskExecutionStep[], signal: AbortSignal) => Promise<{ approved: boolean; steps?: TaskExecutionStep[] }>
}

export interface ChatTurnHandle {
  requestId: string
  abort: () => void
  promise: Promise<ChatTurnOutcome>
}

type Interaction =
  | { type: 'clarification'; question: string; choices: string[] }
  | { type: 'confirmation'; preview: Omit<MutationPreview, 'hunks' | 'assumptions' | 'risks'> & { hunks: Array<Omit<MutationPreview['hunks'][number], 'status'>> } }
  | { type: 'plan'; title: string; steps: TaskExecutionStep[] }

type InteractionAnswer =
  | { type: 'clarification'; answer: string }
  | { type: 'confirmation'; accepted: boolean; hunkIds: string[] }
  | { type: 'plan'; accepted: boolean; stepIds?: string[] }

interface BackendEventEnvelope {
  requestId: string
  sequence: number
  event: { type: string; [key: string]: unknown }
}

function turnError(error: unknown): Error {
  const value = error as { code?: unknown; message?: unknown } | null
  if (value && typeof value === 'object' && value.code === 'cancelled') {
    return new DOMException('Consulta cancelada.', 'AbortError')
  }
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  if (value && typeof value.message === 'string' && value.message.trim()) return new Error(value.message)
  return new Error('No se pudo completar la consulta con la IA.')
}

function forwardEvent(requestId: string, envelope: BackendEventEnvelope, handlers: ChatTurnHandlers): void {
  const event = envelope.event
  if (event.type === 'assistant-delta' && typeof event.delta === 'string') handlers.onMessageDelta?.(event.delta)
  if (event.type === 'thinking-summary' && typeof event.summary === 'string') handlers.onThinkingDelta?.(event.summary)
  if (event.type === 'tool-completed' && typeof event.toolName === 'string') {
    handlers.onAgentProgress?.({
      type: 'tool-completed',
      requestId,
      operationId: typeof event.operationId === 'string' ? event.operationId : null,
      round: typeof event.round === 'number' ? event.round : 0,
      toolName: event.toolName,
      ok: event.ok === true,
      changed: typeof event.changed === 'boolean' ? event.changed : null,
    })
  }
}

async function answerInteraction(
  interaction: Interaction,
  signal: AbortSignal,
  handlers: ChatTurnHandlers,
): Promise<InteractionAnswer | null> {
  if (interaction.type === 'clarification') {
    if (!handlers.requestClarification) return null
    const answer = await handlers.requestClarification(interaction.question, signal, interaction.choices.length ? interaction.choices : undefined)
    return { type: 'clarification', answer }
  }
  if (interaction.type === 'confirmation') {
    if (!handlers.requestConfirmation) return null
    // Hunks start pending; the confirmation view lets the person reject some.
    const preview: MutationPreview = {
      ...interaction.preview,
      hunks: interaction.preview.hunks.map((hunk) => ({ ...hunk, status: 'pending' as const })),
      assumptions: [],
      risks: [],
    }
    const decision = await handlers.requestConfirmation(preview.summary, signal, preview)
    const normalized = typeof decision === 'boolean' ? { accepted: decision } : decision
    return { type: 'confirmation', accepted: normalized.accepted, hunkIds: [...(normalized.hunkIds ?? [])] }
  }
  if (!handlers.requestExecutionPlanApproval) return null
  const decision = await handlers.requestExecutionPlanApproval(interaction.steps, signal)
  return { type: 'plan', accepted: decision.approved, stepIds: decision.steps?.map((step) => step.id) }
}

/** Starts a chat turn; the promise settles when the backend answered and saved it. */
export function startChatTurn(input: ChatTurnInput, handlers: ChatTurnHandlers = {}): ChatTurnHandle {
  const requestId = crypto.randomUUID()
  const controller = new AbortController()
  let lastSequence = 0

  const cancel = () => {
    void callBackend('ai_chat_cancel', { payload: { requestId } }).catch(() => undefined)
  }

  const run = async (): Promise<ChatTurnOutcome> => {
    const unlisteners: Unsubscribe[] = []
    try {
      unlisteners.push(await subscribeBackend<BackendEventEnvelope>(BACKEND_EVENT, (envelope) => {
        // Events can arrive twice (live emit plus replay); only newer ones count.
        if (envelope.requestId !== requestId || envelope.sequence <= lastSequence) return
        lastSequence = envelope.sequence
        forwardEvent(requestId, envelope, handlers)
      }))
      unlisteners.push(await subscribeBackend<{ requestId: string; interaction: Interaction }>(INTERACTION_EVENT, (event) => {
        if (event.requestId !== requestId) return
        void answerInteraction(event.interaction, controller.signal, handlers)
          .then((answer) => answer
            ? callBackend('ai_chat_answer', { payload: { requestId, answer } })
            : cancel())
          .catch(cancel)
      }))
      if (controller.signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError')
      const { preferences, ...request } = input
      return await callBackend<ChatTurnOutcome>('ai_chat_send', {
        payload: {
          ...request,
          requestId,
          settings: preferences ? resolveAiPreferencesForTransport(preferences) : undefined,
        },
      })
    } catch (error) {
      throw turnError(error)
    } finally {
      unlisteners.forEach((unlisten) => unlisten())
    }
  }

  return {
    requestId,
    abort: () => {
      if (controller.signal.aborted) return
      controller.abort()
      cancel()
    },
    promise: run(),
  }
}

/** AI titles the backend saves for new chats. */
export function subscribeChatTitles(
  handler: (event: { libraryId: string; path: string; title: string }) => void,
): Promise<Unsubscribe> {
  return subscribeBackend<{ libraryId: string; path: string; title: string }>(TITLE_EVENT, handler)
}
