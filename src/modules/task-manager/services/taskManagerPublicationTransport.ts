import type { BackendTransport, Unsubscribe } from '../../../services/transport'
import {
  invokePublishedTaskManagerMutation,
  isTaskManagerPublicationMutationCommand,
} from './taskManagerPublicationClient'

export interface TaskManagerPublicationTransport extends BackendTransport {
  /** The reads the publication allows, as its bootstrap lists them. */
  allowCommands(commands: readonly string[]): void
}

/**
 * Backend of a published Task Manager page. Reads go to `<path>/invoke`;
 * mutations travel through the collaborative WebSocket of the publication
 * client, which also delivers the changes (so backend events are not used
 * here). The publication server authorizes every command by itself;
 * `supports` only tells the interface which reads it may skip.
 */
export function createTaskManagerPublicationTransport(
  publicationPath: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  onSessionExpired: () => void = () => window.location.assign(publicationPath),
): TaskManagerPublicationTransport {
  let sessionInvalid = false
  let rateLimitedUntil = 0
  let allowedCommands = new Set<string>()

  return {
    kind: 'published',
    platform: () => 'unknown',
    async call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
      if (isTaskManagerPublicationMutationCommand(command)) {
        return invokePublishedTaskManagerMutation(command, args) as Promise<T>
      }
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
    subscribe: (): Promise<Unsubscribe> => Promise.resolve(() => undefined),
    fileUrl: (path: string) => path,
    supports: (command: string) => isTaskManagerPublicationMutationCommand(command) || allowedCommands.has(command),
    allowCommands: (commands) => {
      allowedCommands = new Set(commands)
    },
  }
}
