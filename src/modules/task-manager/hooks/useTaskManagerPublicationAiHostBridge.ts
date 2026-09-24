import { callBackend, subscribeBackend } from '../../../services/transport'
import { useEffect, useRef } from 'react'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import type { AgentProgressEvent, AgentProgressPhase } from '../../../types/ai/agentContracts'
import { describeAiFeedbackError } from '../../../services/ai/aiFeedbackRuntime'
import { runPublishedTaskManagerHostChatReply } from '../services/publishedTaskManagerChatRuntime'

const PUBLISHED_AI_HOST_REQUEST_EVENT = 'notia-task-manager-publication-ai-request'
const MAX_PUBLISHED_CHAT_MESSAGES = 100
const MAX_PUBLISHED_CHAT_MESSAGE_LENGTH = 50_000
const MAX_PUBLISHED_CHAT_PROMPT_LENGTH = 50_000

interface PublishedAiHostRequest {
  requestId: string
  vaultPath: string
  libraryUserId: string
  prompt: string
  previousMessages: StoredChatMessage[]
}

interface PublishedAiHostStreamEvent {
  type: 'thinking' | 'delta' | 'progress' | 'done' | 'error'
  delta?: string
  answer?: string
  message?: string
}

interface UseTaskManagerPublicationAiHostBridgeInput {
  activeLibrary: NotiaLibrary | null
  aiPreferences: AiPreferences
}

function normalizePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function comparablePath(pathValue: string): string {
  return normalizePath(pathValue).toLocaleLowerCase()
}

function parsePublishedAiHostRequest(value: unknown): PublishedAiHostRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.requestId !== 'string'
    || typeof candidate.vaultPath !== 'string'
    || typeof candidate.libraryUserId !== 'string'
    || typeof candidate.prompt !== 'string'
    || !Array.isArray(candidate.previousMessages)
  ) return null
  if (
    !candidate.requestId.trim()
    || !candidate.vaultPath.trim()
    || !candidate.libraryUserId.trim()
    || candidate.prompt.length > MAX_PUBLISHED_CHAT_PROMPT_LENGTH
  ) return null

  const previousMessages = candidate.previousMessages.filter((message): message is StoredChatMessage => {
    if (!message || typeof message !== 'object') return false
    const item = message as Record<string, unknown>
    return (item.role === 'user' || item.role === 'assistant')
      && typeof item.content === 'string'
      && item.content.length <= MAX_PUBLISHED_CHAT_MESSAGE_LENGTH
  })
  if (previousMessages.length !== candidate.previousMessages.length || previousMessages.length > MAX_PUBLISHED_CHAT_MESSAGES) {
    return null
  }

  return {
    requestId: candidate.requestId,
    vaultPath: candidate.vaultPath,
    libraryUserId: candidate.libraryUserId,
    prompt: candidate.prompt,
    previousMessages,
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return describeAiFeedbackError(error, 'No se pudo ejecutar el chat de IA en la app host.')
}

function publicationProgressLabel(event: AgentProgressEvent): string {
  if (event.type === 'web-search-started') return 'Buscando fuentes públicas…'
  if (event.type === 'verification-started') return 'Verificando el resultado…'
  if (event.type === 'clarification-required') return 'Necesito una aclaración.'
  if (event.type === 'confirmation-required') return 'Espero tu confirmación.'
  if (event.type === 'completed') return 'Respuesta preparada.'
  if (event.type === 'cancelled') return 'Operación cancelada.'
  if (event.type === 'failed') return 'No pude completar la operación.'
  if (event.type === 'phase-changed') {
    const labels: Record<AgentProgressPhase, string> = {
      preparing: 'Preparando la solicitud…', planning: 'Organizando los pasos…', reading: 'Leyendo la información necesaria…',
      searching: 'Buscando fuentes públicas…', responding: 'Redactando la respuesta…', executing: 'Ejecutando la operación autorizada…',
      'waiting-clarification': 'Necesito una aclaración.', 'waiting-confirmation': 'Espero tu confirmación.',
      verifying: 'Verificando el resultado…', completed: 'Respuesta preparada.', cancelled: 'Operación cancelada.', failed: 'No pude completar la operación.',
    }
    return labels[event.phase]
  }
  if (event.type === 'plan-created') return 'Organizando los pasos…'
  if (event.type === 'step-started') return 'Ejecutando el siguiente paso…'
  if (event.type === 'multimodal-stage') return 'Procesando el archivo recibido…'
  if (event.type === 'tool-started') return 'Consultando la información autorizada…'
  return 'Procesando la solicitud…'
}

export function useTaskManagerPublicationAiHostBridge({
  activeLibrary,
  aiPreferences,
}: UseTaskManagerPublicationAiHostBridgeInput): void {
  const activeLibraryRef = useRef(activeLibrary)
  const aiPreferencesRef = useRef(aiPreferences)
  const inFlightRequestsRef = useRef(new Set<string>())
  activeLibraryRef.current = activeLibrary
  aiPreferencesRef.current = aiPreferences

  useEffect(() => {
    let disposed = false

    const sendEvent = async (requestId: string, event: PublishedAiHostStreamEvent): Promise<void> => {
      if (disposed) throw new DOMException('Puente de IA publicado cerrado.', 'AbortError')
      await callBackend('publish_task_manager_ai_stream_event', { requestId, event })
    }

    const handleRequest = async (request: PublishedAiHostRequest): Promise<void> => {
      if (disposed || inFlightRequestsRef.current.has(request.requestId)) return
      inFlightRequestsRef.current.add(request.requestId)
      const controller = new AbortController()
      let pendingEvents = Promise.resolve()
      const queueEvent = (event: PublishedAiHostStreamEvent): Promise<void> => {
        const nextEvent = pendingEvents.then(() => sendEvent(request.requestId, event))
        pendingEvents = nextEvent
        return nextEvent
      }
      const reportDeliveryFailure = (delivery: Promise<void>) => {
        void delivery.catch(() => controller.abort())
      }

      try {
        const library = activeLibraryRef.current
        if (!library?.path || comparablePath(library.path) !== comparablePath(request.vaultPath)) {
          throw new Error('La biblioteca publicada no está activa en la app host.')
        }
        // The backend restricts the question to the published boards.
        const answer = await runPublishedTaskManagerHostChatReply({
          aiPreferences: aiPreferencesRef.current,
          library,
          libraryUserId: request.libraryUserId,
          prompt: request.prompt,
          previousMessages: request.previousMessages,
          signal: controller.signal,
          onAgentProgress: (event) => reportDeliveryFailure(queueEvent({ type: 'progress', message: publicationProgressLabel(event) })),
          onThinkingDelta: (delta) => reportDeliveryFailure(queueEvent({ type: 'thinking', delta })),
          onMessageDelta: (delta) => reportDeliveryFailure(queueEvent({ type: 'delta', delta })),
        })
        await pendingEvents
        await queueEvent({ type: 'done', answer })
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted) {
          await pendingEvents.catch(() => undefined)
          await sendEvent(request.requestId, { type: 'error', message: errorMessage(error) }).catch(() => undefined)
        }
      } finally {
        inFlightRequestsRef.current.delete(request.requestId)
      }
    }

    const unlistenPromise = subscribeBackend<unknown>(PUBLISHED_AI_HOST_REQUEST_EVENT, (payload) => {
      const request = parsePublishedAiHostRequest(payload)
      if (!request) return
      void handleRequest(request)
    })

    return () => {
      disposed = true
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])
}
