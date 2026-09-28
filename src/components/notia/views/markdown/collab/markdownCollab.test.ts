import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import type { Crepe } from '@milkdown/crepe'
import type { CollabMessage, CollabPeers } from '../../../../../services/collab/collabRuntime'

const runtime = vi.hoisted(() => ({
  joinCollab: vi.fn(),
  sendCollabUpdate: vi.fn(),
  sendCollabAwareness: vi.fn(),
  leaveCollab: vi.fn(),
  subscribeCollab: vi.fn(),
}))

vi.mock('../../../../../services/collab/collabRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../services/collab/collabRuntime')>()),
  ...runtime,
}))

const { bytesToBase64, base64ToBytes } = await import('../../../../../services/collab/collabRuntime')
const { startMarkdownCollab } = await import('./markdownCollab')

/** An editor whose collab service records what the session asks of it. */
function fakeEditor(markdown: string) {
  const service = {
    doc: null as Doc | null,
    template: null as string | null,
    connected: false,
    bindDoc(doc: Doc) { this.doc = doc; return this },
    setAwareness() { return this },
    applyTemplate(template: string) {
      this.template = template
      this.doc?.getText('template').insert(0, template)
      return this
    },
    connect() { this.connected = true; return this },
    disconnect() { this.connected = false; return this },
  }
  const view = { state: { tr: { setMeta: () => ({}) } }, dispatch: vi.fn() }
  const ctx = { get: (slice: { name?: string }) => (slice.name === 'collabServiceCtx' ? service : view) }
  const crepe = {
    getMarkdown: () => markdown,
    editor: { action: (run: (context: typeof ctx) => unknown) => run(ctx) },
  } as unknown as Crepe
  return { crepe, service }
}

let handlers: { update: (message: CollabMessage) => void; awareness: (message: CollabMessage) => void; peers: (peers: CollabPeers) => void }

describe('startMarkdownCollab', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.values(runtime).forEach((mock) => mock.mockReset())
    runtime.sendCollabUpdate.mockResolvedValue(undefined)
    runtime.sendCollabAwareness.mockResolvedValue(undefined)
    runtime.leaveCollab.mockResolvedValue(undefined)
    runtime.subscribeCollab.mockImplementation(async (next: typeof handlers) => {
      handlers = next
      return () => {}
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills a new room with the note and sends the changes in batches', async () => {
    runtime.joinCollab.mockResolvedValue({ room: 'r', peerId: 'a', color: '#4FD1C5', initializer: true, saver: true, updates: [], peers: [] })
    const { crepe, service } = fakeEditor('# Idea')
    const onSaverChange = vi.fn()
    const session = await startMarkdownCollab({ crepe, libraryId: 'lib', path: 'C:/n.md', deviceName: 'NOTEBOOK', onSaverChange, onLost: vi.fn() })

    expect(runtime.joinCollab).toHaveBeenCalledWith('lib', 'C:/n.md', 'NOTEBOOK')
    expect(service.template).toBe('# Idea')
    expect(service.connected).toBe(true)
    expect(onSaverChange).toHaveBeenCalledWith(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(runtime.sendCollabUpdate).toHaveBeenCalledTimes(1)
    const [room, peer, update] = runtime.sendCollabUpdate.mock.calls[0] as [string, string, string]
    expect([room, peer]).toEqual(['r', 'a'])
    const copy = new Doc()
    applyUpdate(copy, base64ToBytes(update))
    expect(copy.getText('template').toString()).toBe('# Idea')

    session.destroy()
    expect(runtime.leaveCollab).toHaveBeenCalledWith('r', 'a')
  })

  it('joins an existing room from its changes and follows who saves', async () => {
    const existing = new Doc()
    existing.getText('template').insert(0, 'hola')
    runtime.joinCollab.mockResolvedValue({
      room: 'r', peerId: 'b', color: '#6C8EFF', initializer: false, saver: false,
      updates: [bytesToBase64(encodeStateAsUpdate(existing))], peers: [],
    })
    const { crepe, service } = fakeEditor('texto local')
    const onSaverChange = vi.fn()
    const session = await startMarkdownCollab({ crepe, libraryId: 'lib', path: 'C:/n.md', deviceName: 'Android', onSaverChange, onLost: vi.fn() })

    expect(service.template).toBeNull()
    expect(service.doc?.getText('template').toString()).toBe('hola')

    // A change of another editor arrives and is not sent back.
    existing.getText('template').insert(4, ' mundo')
    handlers.update({ room: 'r', from: 'a', update: bytesToBase64(encodeStateAsUpdate(existing)) })
    expect(service.doc?.getText('template').toString()).toBe('hola mundo')
    await vi.advanceTimersByTimeAsync(200)
    expect(runtime.sendCollabUpdate).not.toHaveBeenCalled()

    handlers.peers({ room: 'r', peers: [], saver: 'b' })
    expect(onSaverChange).toHaveBeenLastCalledWith(true)
    session.destroy()
  })
})
