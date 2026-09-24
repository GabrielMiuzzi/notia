import type { BackendPlatform, BackendTransport, Unsubscribe } from './types'

/** What a headless server offers to this client (`GET /api/capabilities`). */
export interface RemoteCapabilities {
  protocolVersion: number
  platform: string
  commands: string[]
  localOnlyCommands: string[]
}

export interface RemoteTransportOptions {
  capabilities: RemoteCapabilities
  /** Called when the server no longer accepts the session. */
  onSessionExpired: () => void
  fetchImpl?: typeof fetch
  createSocket?: (url: string) => WebSocket
  eventsUrl?: string
}

const KNOWN_PLATFORMS: BackendPlatform[] = ['windows', 'linux', 'android', 'macos']

const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 15_000

function defaultEventsUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${window.location.host}/api/events`
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === 'string' && error.trim()) return error
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  }
  return fallback
}

/** Event the server sends when a reconnecting client missed events it no
 * longer keeps; the interface then offers to reload. */
export const EVENTS_LOST_EVENT = 'notia:events-lost'

/**
 * Events of the server over one WebSocket shared by every subscription. It
 * reconnects with backoff while someone listens and asks for the events it
 * missed (`since` = last sequence received), so none is lost in between.
 */
class RemoteEventChannel {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()
  private socket: WebSocket | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastSequence = 0
  private readonly url: string
  private readonly createSocket: (url: string) => WebSocket

  constructor(url: string, createSocket: (url: string) => WebSocket) {
    this.url = url
    this.createSocket = createSocket
  }

  subscribe(event: string, handler: (payload: unknown) => void): Unsubscribe {
    const handlers = this.listeners.get(event) ?? new Set()
    handlers.add(handler)
    this.listeners.set(event, handlers)
    this.connect()
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.listeners.delete(event)
    }
  }

  private connect(): void {
    if (this.socket || this.reconnectTimer !== null) return
    const url = this.lastSequence > 0 ? `${this.url}?since=${this.lastSequence}` : this.url
    const socket = this.createSocket(url)
    this.socket = socket
    socket.onopen = () => { this.reconnectDelay = RECONNECT_MIN_MS }
    socket.onmessage = (message) => this.dispatch(message.data)
    socket.onclose = () => {
      this.socket = null
      if (this.listeners.size === 0) return
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    }
  }

  private dispatch(data: unknown): void {
    if (typeof data !== 'string') return
    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (!message || typeof message !== 'object' || typeof (message as { event?: unknown }).event !== 'string') return
    const { event, payload, seq } = message as { event: string; payload: unknown; seq?: unknown }
    if (typeof seq === 'number' && seq > this.lastSequence) this.lastSequence = seq
    this.listeners.get(event)?.forEach((handler) => handler(payload))
  }
}

/** Backend of a headless Notia server, reached from a browser. */
export function createRemoteTransport(options: RemoteTransportOptions): BackendTransport {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const commands = new Set(options.capabilities.commands)
  const platform = KNOWN_PLATFORMS.find((known) => known === options.capabilities.platform) ?? 'unknown'
  let events: RemoteEventChannel | null = null
  const channel = () => {
    events ??= new RemoteEventChannel(options.eventsUrl ?? defaultEventsUrl(), options.createSocket ?? ((url) => new WebSocket(url)))
    return events
  }

  return {
    kind: 'remote',
    platform: () => platform,
    async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      let response: Response
      try {
        response = await fetchImpl('/api/invoke', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ command, args: args ?? {} }),
        })
      } catch {
        throw new Error('No se pudo contactar al servidor de Notia.')
      }
      const body: unknown = await response.json().catch(() => null)
      if (response.ok && body && typeof body === 'object' && 'result' in body) {
        return (body as { result: T }).result
      }
      if (response.status === 401) {
        options.onSessionExpired()
        throw new Error('La sesión venció. Volvé a iniciar sesión.')
      }
      if (response.status === 400 && body && typeof body === 'object' && 'error' in body) {
        // The backend error travels as is, like the Tauri IPC rejection.
        throw (body as { error: unknown }).error
      }
      throw new Error(errorMessage(body, 'El servidor de Notia no pudo completar la operación.'))
    },
    subscribe<T>(event: string, handler: (payload: T) => void): Promise<Unsubscribe> {
      return Promise.resolve(channel().subscribe(event, (payload) => handler(payload as T)))
    },
    fileUrl: (path: string) => `/api/file?path=${encodeURIComponent(path)}`,
    supports: (command: string) => commands.has(command),
  }
}
