import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTaskManagerPublicationMutationCommand,
  TaskManagerPublicationClient,
  TaskManagerPublicationMutationError,
} from './taskManagerPublicationClient'
import type { TaskManagerSettings } from '../types/taskManagerTypes'

class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static latest: FakeWebSocket | undefined
  readonly sent: string[] = []
  readyState = 0
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  constructor() {
    FakeWebSocket.latest = this
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(value: string): void {
    this.sent.push(value)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', {})
  }

  receive(value: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(value) })
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

class BroadcastWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static readonly instances = new Set<BroadcastWebSocket>()
  static revision = 0
  static sequence = 0
  readonly sent: string[] = []
  readyState = 0
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  constructor() {
    BroadcastWebSocket.instances.add(this)
    queueMicrotask(() => {
      this.readyState = BroadcastWebSocket.OPEN
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(value: string): void {
    this.sent.push(value)
    const message = JSON.parse(value) as Record<string, unknown>
    if (message.type === 'hello') {
      queueMicrotask(() => this.receive({
        type: 'welcome',
        protocolVersion: 1,
        publicationEpoch: 'epoch-1',
        revision: BroadcastWebSocket.revision,
        sequence: BroadcastWebSocket.sequence,
        replay: [],
      }))
      return
    }
    if (message.type !== 'mutate') return

    const operationId = message.operationId
    if (message.baseRevision !== BroadcastWebSocket.revision) {
      this.receive({
        type: 'ack',
        protocolVersion: 1,
        operationId,
        ok: false,
        retryable: false,
        error: 'CONFLICT',
        conflict: {
          kind: 'revision',
          expectedRevision: message.baseRevision,
          currentRevision: BroadcastWebSocket.revision,
        },
        revision: BroadcastWebSocket.revision,
        sequence: BroadcastWebSocket.sequence,
      })
      return
    }

    BroadcastWebSocket.revision += 1
    BroadcastWebSocket.sequence += 1
    const changed = {
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: BroadcastWebSocket.revision,
      sequence: BroadcastWebSocket.sequence,
      messageId: `event-${BroadcastWebSocket.sequence}`,
      changedPaths: ['published-vault/task-mannager/equipo/demo.md'],
    }
    for (const instance of BroadcastWebSocket.instances) instance.receive(changed)
    this.receive({
      type: 'ack',
      protocolVersion: 1,
      operationId,
      ok: true,
      result: { ok: true },
      revision: BroadcastWebSocket.revision,
      sequence: BroadcastWebSocket.sequence,
    })
  }

  close(): void {
    BroadcastWebSocket.instances.delete(this)
    this.readyState = BroadcastWebSocket.CLOSED
    this.emit('close', {})
  }

  private receive(value: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(value) })
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const settings = {} as TaskManagerSettings

afterEach(() => {
  FakeWebSocket.latest = undefined
  BroadcastWebSocket.instances.clear()
  BroadcastWebSocket.revision = 0
  BroadcastWebSocket.sequence = 0
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TaskManagerPublicationClient', () => {
  it('opens with a cursor and resolves a mutation only from its acknowledgement', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    const hello = JSON.parse(FakeWebSocket.latest?.sent[0] ?? '{}') as Record<string, unknown>
    expect(hello).toMatchObject({
      type: 'hello',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      lastSequence: 4,
    })

    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })
    const mutation = client.invokeMutation('write_library_file', { payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' } })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const request = JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}') as Record<string, unknown>
    expect(request).toMatchObject({ type: 'mutate', command: 'write_library_file' })

    FakeWebSocket.latest?.receive({ type: 'ack', protocolVersion: 1, operationId: request.operationId, ok: true, result: { ok: true }, sequence: 5, revision: 5 })
    await expect(mutation).resolves.toEqual({ ok: true })
    client.close()
  })

  it('rejects an unconfirmed mutation after bounded retries instead of hanging forever', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    await vi.runAllTicks()
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })

    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    const rejection = expect(mutation).rejects.toMatchObject({
      outcome: 'unknown',
      retryable: false,
    })
    await vi.runAllTicks()

    await vi.advanceTimersByTimeAsync(15_250)
    await vi.advanceTimersByTimeAsync(15_250)
    await vi.advanceTimersByTimeAsync(15_250)

    await rejection
    client.close()
  })

  it('notifies the originating client when the acknowledgement arrives before the hub event', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const changes: Array<{ revision: number; operationId?: string }> = []
    client.subscribe((change) => {
      if (change.type === 'changed' && change.revision !== undefined) {
        changes.push({ revision: change.revision, operationId: change.operationId })
      }
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })
    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const request = JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}') as Record<string, unknown>

    FakeWebSocket.latest?.receive({
      type: 'ack',
      protocolVersion: 1,
      messageId: 'ack-1',
      operationId: request.operationId,
      ok: true,
      changed: true,
      changedPaths: ['published-vault/task-mannager/equipo/a.md'],
      sequence: 1,
      revision: 1,
      result: { ok: true },
    })
    await expect(mutation).resolves.toEqual({ ok: true })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 1,
      sequence: 1,
      messageId: 'event-1',
    })

    expect(changes).toEqual([{ revision: 1, operationId: request.operationId }])
    client.close()
  })

  it('keeps shared settings from an acknowledgement when it wins the event race', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const changes: Array<{ settings?: unknown }> = []
    client.subscribe((change) => changes.push(change))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })

    const mutation = client.invokeMutation('update_task_manager_publication_settings', {
      settings: { boards: [], groups: [] },
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const request = JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}') as Record<string, unknown>
    const nextSettings = { boards: [{ name: 'producto', color: '#123456' }], groups: [] }
    FakeWebSocket.latest?.receive({
      type: 'ack',
      protocolVersion: 1,
      messageId: 'ack-settings-1',
      operationId: request.operationId,
      ok: true,
      changed: true,
      sequence: 1,
      revision: 1,
      result: { ok: true, settings: nextSettings },
    })

    await expect(mutation).resolves.toMatchObject({ settings: nextSettings })
    expect(changes.at(-1)).toMatchObject({ type: 'changed', settings: nextSettings })
    client.close()
  })

  it('accepts only the publication mutation commands', () => {
    expect(isTaskManagerPublicationMutationCommand('write_library_file')).toBe(true)
    expect(isTaskManagerPublicationMutationCommand('append_task_comment')).toBe(true)
    expect(isTaskManagerPublicationMutationCommand('read_library_file')).toBe(false)
    expect(isTaskManagerPublicationMutationCommand('begin_task_manager_publication_batch')).toBe(true)
    expect(isTaskManagerPublicationMutationCommand('end_task_manager_publication_batch')).toBe(true)
    expect(isTaskManagerPublicationMutationCommand('update_task_manager_publication_settings')).toBe(true)
  })

  it('rejects new mutations after the publication client is closed', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    client.close()

    await expect(client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })).rejects.toThrow('ya no acepta mutaciones')
  })

  it('sends one pending mutation at a time using the confirmed revision', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })

    const first = client.invokeMutation('write_library_file', { payload: { filePath: 'published-vault/a.md', content: 'uno' } })
    const second = client.invokeMutation('write_library_file', { payload: { filePath: 'published-vault/b.md', content: 'dos' } })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    const socket = FakeWebSocket.latest
    const firstRequest = JSON.parse(socket?.sent[1] ?? '{}') as Record<string, unknown>
    expect(socket?.sent).toHaveLength(2)
    socket?.receive({ type: 'ack', protocolVersion: 1, operationId: firstRequest.operationId, ok: true, result: { ok: true }, sequence: 5, revision: 5 })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    const secondRequest = JSON.parse(socket?.sent[2] ?? '{}') as Record<string, unknown>
    expect(secondRequest).toMatchObject({ type: 'mutate', baseRevision: 5 })
    socket?.receive({ type: 'ack', protocolVersion: 1, operationId: secondRequest.operationId, ok: true, result: { ok: true }, sequence: 6, revision: 6 })
    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })
    client.close()
  })

  it('preserves structured conflict details from an acknowledgement', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 8,
      sequence: 8,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 8, sequence: 8, replay: [] })

    const mutation = client.invokeMutation('update_task_manager_publication_settings', { settings })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const request = JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}') as Record<string, unknown>
    FakeWebSocket.latest?.receive({
      type: 'ack',
      protocolVersion: 1,
      operationId: request.operationId,
      ok: false,
      retryable: false,
      error: 'CONFLICT: los settings cambiaron desde la ultima lectura.',
      conflict: { kind: 'revision', expectedRevision: 8, currentRevision: 9 },
      revision: 9,
      sequence: 9,
    })

    await expect(mutation).rejects.toBeInstanceOf(TaskManagerPublicationMutationError)
    await expect(mutation).rejects.toMatchObject({
      operationId: request.operationId,
      retryable: false,
      conflict: { kind: 'revision', expectedRevision: 8, currentRevision: 9 },
    })
    expect(client.getStatus()).toBe('conflict')
    client.close()
  })

  it('exposes an unknown outcome without treating it as a successful mutation', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })

    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const request = JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}') as Record<string, unknown>
    FakeWebSocket.latest?.receive({
      type: 'ack',
      protocolVersion: 1,
      operationId: request.operationId,
      ok: false,
      outcome: 'unknown',
      retryable: true,
      error: 'El host está ocupado.',
    })

    await expect(mutation).rejects.toMatchObject({
      operationId: request.operationId,
      outcome: 'unknown',
      retryable: true,
    })
    client.close()
  })

  it('marks an in-flight mutation as unknown when the client closes', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })

    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    client.close()

    await expect(mutation).rejects.toMatchObject({
      name: 'TaskManagerPublicationMutationError',
      outcome: 'unknown',
      retryable: false,
    })
  })

  it('cancels before send without writing and reports unknown after send', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const beforeSendController = new AbortController()
    const beforeSend = client.invokeMutation(
      'write_library_file',
      { payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'no-escribe' } },
      undefined,
      { signal: beforeSendController.signal },
    )
    beforeSendController.abort()
    await expect(beforeSend).rejects.toMatchObject({ outcome: 'failed', retryable: false })
    expect(FakeWebSocket.latest?.sent.map((value) => JSON.parse(value) as { type?: string }).some((value) => value.type === 'mutate')).toBe(false)

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })
    const afterSendController = new AbortController()
    const afterSend = client.invokeMutation(
      'write_library_file',
      { payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'resultado-incierto' } },
      undefined,
      { signal: afterSendController.signal },
    )
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    expect(FakeWebSocket.latest?.sent).toHaveLength(2)
    afterSendController.abort()
    await expect(afterSend).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
    expect(JSON.parse(FakeWebSocket.latest?.sent[2] ?? '{}')).toMatchObject({
      type: 'cancel',
      operationId: JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}').operationId,
    })
    client.close()
  })

  it('pauses in background and bootstraps again before reconnecting', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const visibilityListeners = new Set<() => void>()
    const publicationDocument = {
      hidden: false,
      visibilityState: 'visible' as 'visible' | 'hidden',
      addEventListener: (_type: string, listener: () => void) => visibilityListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => visibilityListeners.delete(listener),
      emitVisibilityChange: () => visibilityListeners.forEach((listener) => listener()),
    }
    vi.stubGlobal('document', publicationDocument)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicationEpoch: 'epoch-1', revision: 6, sequence: 6, settings }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })

    publicationDocument.hidden = true
    publicationDocument.visibilityState = 'hidden'
    publicationDocument.emitVisibilityChange()
    expect(client.getStatus()).toBe('paused')
    expect(FakeWebSocket.latest?.readyState).toBe(FakeWebSocket.CLOSED)

    publicationDocument.hidden = false
    publicationDocument.visibilityState = 'visible'
    publicationDocument.emitVisibilityChange()
    expect(client.getStatus()).toBe('syncing')
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    expect(fetchMock).toHaveBeenCalledWith('/task-manager/bootstrap', { cache: 'no-store' })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 6, sequence: 6, replay: [] })
    expect(client.getStatus()).toBe('connected')
    client.close()
    expect(visibilityListeners.size).toBe(0)
  })

  it('ignores duplicated change sequences', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    const changes: string[] = []
    client.subscribe((change) => changes.push(change.messageId ?? ''))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({
      type: 'welcome',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      replay: [],
    })
    const changed = {
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 5,
      sequence: 5,
      messageId: 'event-5',
    }
    FakeWebSocket.latest?.receive(changed)
    FakeWebSocket.latest?.receive(changed)

    expect(changes).toEqual(['event-5'])
    client.close()
  })

  it('discards late events and starts a new cursor at a new publication epoch', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    const changes: string[] = []
    client.subscribe((change) => changes.push(change.messageId ?? ''))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 5,
      sequence: 5,
      messageId: 'event-5',
    })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      messageId: 'late-event-4',
    })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-2',
      revision: 1,
      sequence: 1,
      messageId: 'event-epoch-2',
    })

    expect(changes).toEqual(['event-5', 'event-epoch-2'])
    client.close()
  })

  it('ignores an old-epoch change that arrives after the new epoch is active', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    const changes: string[] = []
    client.subscribe((change) => changes.push(change.messageId ?? ''))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({
      type: 'welcome',
      protocolVersion: 1,
      publicationEpoch: 'epoch-2',
      revision: 1,
      sequence: 1,
      replay: [],
    })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 5,
      sequence: 5,
      messageId: 'late-old-epoch',
    })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-2',
      revision: 2,
      sequence: 2,
      messageId: 'current-epoch',
    })

    expect(changes).toEqual(['current-epoch'])
    client.close()
  })

  it('requests a bootstrap and ignores stale frames after a sequence gap', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicationEpoch: 'epoch-1', revision: 5, sequence: 5, settings }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const changes: string[] = []
    client.subscribe((change) => changes.push(change.messageId ?? change.type))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const socket = FakeWebSocket.latest
    socket?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })
    socket?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 5,
      sequence: 5,
      messageId: 'event-5',
    })
    socket?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      messageId: 'late-event-4',
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(fetchMock).toHaveBeenCalledWith('/task-manager/bootstrap', { cache: 'no-store' })
    expect(changes).toEqual(['resync-required', 'changed'])
    client.close()
  })

  it('ignores frames with invalid counters or oversized protocol identifiers', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const changes: unknown[] = []
    client.subscribe((change) => changes.push(change))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    FakeWebSocket.latest?.receive({
      type: 'welcome',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: -1,
      sequence: 0,
      replay: [],
    })
    expect(client.getStatus()).toBe('connecting')

    FakeWebSocket.latest?.receive({
      type: 'welcome',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      replay: [],
    })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 1.5,
      sequence: 1,
      messageId: 'event-1',
    })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 1,
      sequence: 1,
      messageId: 'x'.repeat(129),
    })

    expect(changes).toHaveLength(0)
    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const request = JSON.parse(FakeWebSocket.latest?.sent[1] ?? '{}') as Record<string, unknown>
    expect(request.baseRevision).toBe(0)
    FakeWebSocket.latest?.receive({
      type: 'ack',
      protocolVersion: 1,
      operationId: request.operationId,
      ok: true,
      result: { ok: true },
      revision: 1,
      sequence: 1,
    })
    await expect(mutation).resolves.toEqual({ ok: true })
    client.close()
  })

  it('keeps changed paths restricted to the published alias', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const changes: Array<{ changedPaths?: string[] }> = []
    client.subscribe((change) => changes.push(change))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })
    FakeWebSocket.latest?.receive({
      type: 'changed',
      protocolVersion: 1,
      publicationEpoch: 'epoch-1',
      revision: 1,
      sequence: 1,
      messageId: 'event-1',
      changedPaths: [
        'published-vault/task-mannager/equipo/demo.md',
        'C:/Users/private/secret.md',
      ],
    })

    expect(changes[0]?.changedPaths).toEqual(['published-vault/task-mannager/equipo/demo.md'])
    client.close()
  })

  it('exposes connection status transitions for the published shell', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    const statuses: string[] = []
    client.subscribeStatus((status) => statuses.push(status))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })
    expect(statuses).toEqual(['connecting', 'connected'])

    client.close()
    expect(statuses.at(-1)).toBe('closed')
  })

  it('turns a rejected reconnect handshake into a terminal state', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const statuses: string[] = []
    client.subscribeStatus((status) => statuses.push(status))
    FakeWebSocket.latest?.receive({
      type: 'error',
      protocolVersion: 1,
      messageId: 'error-1',
      error: 'La sesión ya no está autorizada.',
    })

    expect(client.getStatus()).toBe('revoked')
    expect(statuses.at(-1)).toBe('revoked')
  })

  it('keeps websocket capacity refusal recoverable instead of terminal', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    FakeWebSocket.latest?.receive({
      type: 'error',
      protocolVersion: 1,
      messageId: 'capacity-1',
      error: 'La publicación alcanzó su capacidad máxima de conexiones WebSocket.',
    })

    expect(client.getStatus()).toBe('offline')
    client.close()
  })

  it('leaves a stalled handshake and schedules a bounded reconnect', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    await vi.advanceTimersByTimeAsync(10_000)

    expect(client.getStatus()).toBe('offline')
    expect(FakeWebSocket.latest?.readyState).toBe(FakeWebSocket.CLOSED)
    client.close()
  })

  it('reconnects after a socket loss and retries the same operation id', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 4,
      sequence: 4,
      settings,
    })
    await vi.runAllTicks()
    const firstSocket = FakeWebSocket.latest
    firstSocket?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })
    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    await vi.runAllTicks()
    const firstRequest = JSON.parse(firstSocket?.sent[1] ?? '{}') as Record<string, unknown>
    firstSocket?.close()

    await vi.advanceTimersByTimeAsync(250)
    await vi.runAllTicks()
    const secondSocket = FakeWebSocket.latest
    expect(secondSocket).not.toBe(firstSocket)
    secondSocket?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 4, sequence: 4, replay: [] })
    await vi.runAllTicks()
    const retryRequest = JSON.parse(secondSocket?.sent[1] ?? '{}') as Record<string, unknown>
    expect(retryRequest.operationId).toBe(firstRequest.operationId)
    expect(retryRequest.baseRevision).toBe(4)
    secondSocket?.receive({ type: 'ack', protocolVersion: 1, operationId: retryRequest.operationId, ok: true, result: { ok: true }, sequence: 5, revision: 5 })

    await expect(mutation).resolves.toEqual({ ok: true })
    client.close()
  })

  it('retries an in-flight mutation with the same operation id after resync', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicationEpoch: 'epoch-1', revision: 1, sequence: 1, settings }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const socket = FakeWebSocket.latest
    socket?.receive({ type: 'welcome', protocolVersion: 1, publicationEpoch: 'epoch-1', revision: 0, sequence: 0, replay: [] })

    const mutation = client.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/a.md', content: 'nuevo' },
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    const firstRequest = JSON.parse(socket?.sent[1] ?? '{}') as Record<string, unknown>

    socket?.receive({
      type: 'resync-required',
      protocolVersion: 1,
      messageId: 'resync-1',
      publicationEpoch: 'epoch-1',
      sequence: 1,
      revision: 1,
      reason: 'history-window',
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    const retryRequest = JSON.parse(socket?.sent[2] ?? '{}') as Record<string, unknown>
    expect(fetchMock).toHaveBeenCalledWith('/task-manager/bootstrap', { cache: 'no-store' })
    expect(retryRequest.operationId).toBe(firstRequest.operationId)
    expect(retryRequest.baseRevision).toBe(1)
    socket?.receive({
      type: 'ack',
      protocolVersion: 1,
      operationId: retryRequest.operationId,
      ok: true,
      result: { ok: true },
      sequence: 2,
      revision: 2,
    })

    await expect(mutation).resolves.toEqual({ ok: true })
    client.close()
  })

  it('converges three simultaneous clients through the bidirectional protocol', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', host: 'localhost:52471' },
      setTimeout,
      clearTimeout,
    })
    vi.stubGlobal('WebSocket', BroadcastWebSocket)

    const clients = Array.from({ length: 3 }, () => new TaskManagerPublicationClient('/task-manager', {
      publicationEpoch: 'epoch-1',
      revision: 0,
      sequence: 0,
      settings,
    }))
    const changes = clients.map(() => [] as Array<{ revision?: number; sequence?: number }>)
    clients.forEach((client, index) => client.subscribe((change) => changes[index]?.push(change)))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    const first = clients[0]?.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/demo.md', content: 'uno' },
    })
    await expect(first).resolves.toEqual({ ok: true })

    const second = clients[1]?.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/demo.md', content: 'dos' },
    })
    await expect(second).resolves.toEqual({ ok: true })

    const third = clients[0]?.invokeMutation('write_library_file', {
      payload: { filePath: 'published-vault/task-mannager/equipo/demo.md', content: 'tres' },
    })
    await expect(third).resolves.toEqual({ ok: true })

    expect(changes.every((clientChanges) => clientChanges.map((change) => change.revision))).toEqual(true)
    expect(changes.map((clientChanges) => clientChanges.map((change) => change.revision))).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ])
    expect(changes.map((clientChanges) => clientChanges.map((change) => change.sequence))).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ])
    clients.forEach((client) => client.close())
  })
})
