export type Unsubscribe = () => void

/**
 * Where the backend runs for this interface:
 * - `local`: inside the same app (Tauri IPC).
 * - `remote`: a headless Notia server reached over HTTPS + WebSocket.
 * - `published`: the Task Manager publication of a host.
 */
export type BackendKind = 'local' | 'remote' | 'published'

/** Operating system the backend runs on; decides which features exist. */
export type BackendPlatform = 'windows' | 'linux' | 'android' | 'macos' | 'unknown'

/** How the interface reaches the backend. */
export interface BackendTransport {
  kind: BackendKind
  platform(): BackendPlatform
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>
  subscribe<T>(event: string, handler: (payload: T) => void): Promise<Unsubscribe>
  fileUrl(path: string): string
  /** Whether the backend offers `command` to this client. Only visual: the
   * backend still refuses what it does not allow. */
  supports(command: string): boolean
}
