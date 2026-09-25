import { describe, expect, it, vi } from 'vitest'
import { createRemoteTransport, type RemoteCapabilities } from './remoteTransport'
import { fetchRemoteCapabilities, loginRemote } from './remoteSession'

const capabilities: RemoteCapabilities = {
  protocolVersion: 1,
  platform: 'windows',
  commands: ['backend_library_catalog', 'speech_remote_audio'],
  localOnlyCommands: ['start_speech_session'],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

class FakeSocket {
  static created: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((message: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.created.push(this)
  }
}

describe('remoteTransport', () => {
  it('runs commands through /api/invoke and keeps the backend error as the rejection', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { result: { libraries: [] } }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: 'invalidInput', message: 'Mes inválido.' } }))
    const transport = createRemoteTransport({ capabilities, onSessionExpired: vi.fn(), fetchImpl, eventsUrl: 'wss://h/api/events' })
    await expect(transport.call('backend_library_catalog')).resolves.toEqual({ libraries: [] })
    expect(fetchImpl).toHaveBeenCalledWith('/api/invoke', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ command: 'backend_library_catalog', args: {} }),
    }))
    await expect(transport.call('finance_overview', { payload: { month: '2026-13' } }))
      .rejects.toEqual({ code: 'invalidInput', message: 'Mes inválido.' })
  })

  it('reports an expired session and refused commands as errors', async () => {
    const onSessionExpired = vi.fn()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Iniciá sesión para continuar.' }))
      .mockResolvedValueOnce(jsonResponse(403, { error: 'Esta operación solo está disponible en el equipo que ejecuta Notia.' }))
    const transport = createRemoteTransport({ capabilities, onSessionExpired, fetchImpl, eventsUrl: 'wss://h/api/events' })
    await expect(transport.call('backend_library_catalog')).rejects.toThrow('La sesión venció')
    expect(onSessionExpired).toHaveBeenCalledOnce()
    await expect(transport.call('start_speech_session')).rejects.toThrow('solo está disponible en el equipo')
  })

  it('delivers server events to the subscribers of each event over one socket', async () => {
    FakeSocket.created = []
    const transport = createRemoteTransport({
      capabilities,
      onSessionExpired: vi.fn(),
      fetchImpl: vi.fn(),
      eventsUrl: 'wss://h/api/events',
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    })
    const titles = vi.fn()
    const trees = vi.fn()
    const stopTitles = await transport.subscribe('notia:chat-title', titles)
    await transport.subscribe('notia-library-tree-changed', trees)
    expect(FakeSocket.created).toHaveLength(1)
    const socket = FakeSocket.created[0]
    socket.onmessage?.({ data: JSON.stringify({ event: 'notia:chat-title', payload: { title: 'Plan' } }) })
    socket.onmessage?.({ data: 'no-json' })
    expect(titles).toHaveBeenCalledWith({ title: 'Plan' })
    expect(trees).not.toHaveBeenCalled()
    stopTitles()
    socket.onmessage?.({ data: JSON.stringify({ event: 'notia:chat-title', payload: { title: 'Otro' } }) })
    expect(titles).toHaveBeenCalledOnce()
  })

  it('asks for the missed events when it reconnects', async () => {
    vi.useFakeTimers()
    FakeSocket.created = []
    const transport = createRemoteTransport({
      capabilities,
      onSessionExpired: vi.fn(),
      fetchImpl: vi.fn(),
      eventsUrl: 'wss://h/api/events',
      createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    })
    const handler = vi.fn()
    await transport.subscribe('task-manager-changed', handler)
    const first = FakeSocket.created[0]
    expect(first.url).toBe('wss://h/api/events')
    first.onmessage?.({ data: JSON.stringify({ seq: 7, event: 'task-manager-changed', payload: {} }) })
    first.onclose?.()
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.created[1].url).toBe('wss://h/api/events?since=7')
    vi.useRealTimers()
  })

  it('serves library files through the server and knows which commands it offers', () => {
    const transport = createRemoteTransport({ capabilities, onSessionExpired: vi.fn(), fetchImpl: vi.fn(), eventsUrl: 'wss://h' })
    expect(transport.kind).toBe('remote')
    expect(transport.fileUrl('C:/Notas/foto 1.png')).toBe('/api/file?path=C%3A%2FNotas%2Ffoto%201.png')
    expect(transport.supports('speech_remote_audio')).toBe(true)
    expect(transport.supports('start_speech_session')).toBe(false)
  })
})

describe('remoteSession', () => {
  it('parses the capabilities and rejects invalid answers', async () => {
    await expect(fetchRemoteCapabilities(vi.fn().mockResolvedValue(jsonResponse(200, capabilities)))).resolves.toEqual(capabilities)
    await expect(fetchRemoteCapabilities(vi.fn().mockResolvedValue(jsonResponse(200, { commands: 'x' })))).rejects.toThrow()
  })

  it('surfaces the message of a refused login', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Contraseña incorrecta.' }))
    await expect(loginRemote('mala', fetchImpl)).rejects.toThrow('Contraseña incorrecta.')
    await expect(loginRemote('buena', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })))).resolves.toBeUndefined()
  })
})
