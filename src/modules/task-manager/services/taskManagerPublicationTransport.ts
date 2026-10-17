import type { BackendTransport, Unsubscribe } from '../../../services/transport'
import {
  invokePublishedTaskManagerMutation,
  isTaskManagerPublicationMutationCommand,
} from './taskManagerPublicationClient'
import { createPublishedChatChannel, PUBLISHED_CHAT_COMMANDS } from './publishedChatChannel'

export interface TaskManagerPublicationTransport extends BackendTransport {
  /** The reads the publication allows, as its bootstrap lists them. */
  allowCommands(commands: readonly string[]): void
}

/**
 * Backend of a published Task Manager page. Reads go to `<path>/invoke`;
 * mutations travel through the collaborative WebSocket of the publication
 * client, which also delivers the changes. The chat's commands and events
 * go through the publication's chat endpoints (`publishedChatChannel`).
 * The publication server authorizes every command by itself; `supports`
 * only tells the interface which reads it may skip.
 */
export function createTaskManagerPublicationTransport(
  publicationPath: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  onSessionExpired: () => void = () => window.location.assign(publicationPath),
): TaskManagerPublicationTransport {
  let sessionInvalid = false
  let rateLimitedUntil = 0
  let allowedCommands = new Set<string>()
  const chat = createPublishedChatChannel(publicationPath, fetchImpl)

  return {
    kind: 'published',
    platform: () => 'unknown',
    async call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (isTaskManagerPublicationMutationCommand(command)) {
        return invokePublishedTaskManagerMutation(command, args) as Promise<T>
      }
      if (PUBLISHED_CHAT_COMMANDS.has(command)) return chat.call<T>(command, args)
      if (sessionInvalid) {
        throw new Error('La sesión publicada venció. Volvé a iniciar sesión.')
      }
      if (Date.now() < rateLimitedUntil) {
        throw new Error('Hay demasiadas lecturas pendientes. Esperá unos segundos.')
      }
      const response = await fetchImpl(`${publicationPath}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, args }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (response.status === 401) {
        sessionInvalid = true
        onSessionExpired()
        throw new Error('La sesión publicada venció. Volvé a iniciar sesión.')
      }
      if (response.status === 429) {
        const retryAfterSeconds = Number.parseInt(response.headers.get('retry-after') ?? '30', 10)
        rateLimitedUntil = Date.now() + (Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 30) * 1000
      }
      if (!response.ok || !body || typeof body !== 'object' || !('result' in body)) {
        throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : 'No se pudo ejecutar la operación de Task Manager.')
      }
      return (body as { result: T }).result
    },
    subscribe: <T,>(event: string, handler: (payload: T) => void): Promise<Unsubscribe> => Promise.resolve(chat.subscribe(event, handler)),
    fileUrl: (path: string) => path,
    supports: (command: string) => isTaskManagerPublicationMutationCommand(command) || PUBLISHED_CHAT_COMMANDS.has(command) || allowedCommands.has(command),
    allowCommands: (commands) => {
      allowedCommands = new Set(commands)
    },
  }
}
