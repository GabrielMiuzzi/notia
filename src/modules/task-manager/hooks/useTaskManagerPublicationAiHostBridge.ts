import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import type { TaskExecutionStep } from '../../../services/chat/chatScopedAgentRuntime'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import { runPublishedTaskManagerHostChatReply } from '../services/publishedTaskManagerChatRuntime'

const PUBLISHED_AI_HOST_REQUEST_EVENT = 'notia-task-manager-publication-ai-request'
const MAX_PUBLISHED_SCOPE_PATHS = 1000
const MAX_PUBLISHED_CHAT_MESSAGES = 100
const MAX_PUBLISHED_CHAT_MESSAGE_LENGTH = 50_000
const MAX_PUBLISHED_CHAT_PROMPT_LENGTH = 50_000

interface PublishedAiHostRequest {
  requestId: string
  vaultPath: string
  prompt: string
  previousMessages: StoredChatMessage[]
  taskManagerScopeKey: string | null
  scopePaths: string[]
}

interface PublishedAiHostStreamEvent {
  type: 'thinking' | 'delta' | 'plan' | 'done' | 'error'
  delta?: string
  answer?: string
  message?: string
  steps?: TaskExecutionStep[]
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

function isPathInside(pathValue: string, parentPath: string): boolean {
  const path = comparablePath(pathValue)
  const parent = comparablePath(parentPath)
  return path === parent || path.startsWith(`${parent}/`)
}

function resolvePublishedScopePaths(vaultPath: string, scopePaths: string[]): string[] {
  if (scopePaths.length === 0 || scopePaths.length > MAX_PUBLISHED_SCOPE_PATHS) {
    throw new Error('El chat publicado no tiene un contexto de tableros válido.')
  }

  const normalizedVaultPath = normalizePath(vaultPath)
  const resolvedPaths = scopePaths.map((scopePath) => {
    if (typeof scopePath !== 'string' || scopePath.length > MAX_PUBLISHED_CHAT_MESSAGE_LENGTH) {
      throw new Error('El contexto del chat publicado no es válido.')
    }
    const normalizedScopePath = normalizePath(scopePath)
    if (!normalizedScopePath || normalizedScopePath.split('/').includes('..')) {
      throw new Error('El contexto del chat publicado contiene una ruta no válida.')
    }

    if (normalizedScopePath === 'published-vault') {
      return normalizedVaultPath
    }
    if (normalizedScopePath.startsWith('published-vault/')) {
      return `${normalizedVaultPath}/${normalizedScopePath.slice('published-vault/'.length)}`
    }
    if (!isPathInside(normalizedScopePath, normalizedVaultPath)) {
      throw new Error('El contexto del chat publicado está fuera de la biblioteca activa.')
    }
    return normalizedScopePath
  })

  return [...new Set(resolvedPaths)]
}

function parsePublishedAiHostRequest(value: unknown): PublishedAiHostRequest | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.requestId !== 'string'
    || typeof candidate.vaultPath !== 'string'
    || typeof candidate.prompt !== 'string'
    || !Array.isArray(candidate.previousMessages)
    || !Array.isArray(candidate.scopePaths)
    || (candidate.taskManagerScopeKey !== undefined && candidate.taskManagerScopeKey !== null && (typeof candidate.taskManagerScopeKey !== 'string' || candidate.taskManagerScopeKey.length > 200))
  ) return null
  if (
    !candidate.requestId.trim()
    || !candidate.vaultPath.trim()
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

  const scopePaths = candidate.scopePaths.filter((path): path is string => typeof path === 'string')
  if (scopePaths.length !== candidate.scopePaths.length) return null
  const taskManagerScopeKey = candidate.taskManagerScopeKey === null || candidate.taskManagerScopeKey === undefined
    ? null
    : candidate.taskManagerScopeKey.trim().slice(0, 200)

  return {
    requestId: candidate.requestId,
    vaultPath: candidate.vaultPath,
    prompt: candidate.prompt,
    previousMessages,
    taskManagerScopeKey,
    scopePaths,
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo ejecutar el chat de IA en la app host.'
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
      await invoke('publish_task_manager_ai_stream_event', { requestId, event })
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
        const scopePaths = resolvePublishedScopePaths(library.path, request.scopePaths)
        if (!request.prompt.trim()) throw new Error('La consulta de IA no puede estar vacía.')

        const answer = await runPublishedTaskManagerHostChatReply({
          aiPreferences: aiPreferencesRef.current,
          library,
          scopePaths,
          taskManagerScopeKey: request.taskManagerScopeKey,
          prompt: request.prompt,
          previousMessages: request.previousMessages,
          signal: controller.signal,
          onExecutionPlanChange: (steps) => reportDeliveryFailure(queueEvent({ type: 'plan', steps })),
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

    const unlistenPromise = listen<unknown>(PUBLISHED_AI_HOST_REQUEST_EVENT, (event) => {
      const request = parsePublishedAiHostRequest(event.payload)
      if (!request) return
      void handleRequest(request)
    })

    return () => {
      disposed = true
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])
}
