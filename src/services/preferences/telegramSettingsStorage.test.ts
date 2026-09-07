import { beforeEach, describe, expect, it } from 'vitest'
import { loadTelegramPendingAgentRequests, mergeTelegramUpdateCheckpoint, normalizeTelegramPendingAgentRequests, normalizeTelegramPreferences, rememberTelegramUpdate, saveTelegramPendingAgentRequests } from './telegramSettingsStorage'

describe('normalizeTelegramPreferences', () => {
  const values = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }

  beforeEach(() => {
    values.clear()
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } })
  })

  it('rejects malformed peers and offsets', () => {
    expect(normalizeTelegramPreferences({ enabled: true, botToken: ' token ', authorizedPeer: { chatId: '1' }, updateOffset: -1 })).toEqual({
      enabled: true, botToken: 'token', authorizedPeer: null, pendingPeer: null, updateOffset: 0, processedUpdateIds: [],
    })
  })

  it('preserves a valid paired identity', () => {
    expect(normalizeTelegramPreferences({
      enabled: true, botToken: '123:abc', updateOffset: 42,
      authorizedPeer: { chatId: 10, userId: 20, displayName: 'Ada', username: 'ada' },
    }).authorizedPeer).toEqual({ chatId: 10, userId: 20, displayName: 'Ada', username: 'ada' })
  })

  it('remembers updates without duplicating ids', () => {
    const preferences = normalizeTelegramPreferences({ processedUpdateIds: [4] })
    expect(rememberTelegramUpdate(rememberTelegramUpdate(preferences, 5), 5).processedUpdateIds).toEqual([4, 5])
  })

  it('merges a durable checkpoint without moving the offset backwards', () => {
    const preferences = normalizeTelegramPreferences({ updateOffset: 40, processedUpdateIds: [4, 5] })

    expect(mergeTelegramUpdateCheckpoint(preferences, {
      updateOffset: 43,
      processedUpdateIds: [5, 6],
    })).toMatchObject({ updateOffset: 43, processedUpdateIds: [4, 5, 6] })
    expect(mergeTelegramUpdateCheckpoint(preferences, {
      updateOffset: 20,
      processedUpdateIds: [],
    }).updateOffset).toBe(40)
  })

  it('keeps only valid bounded Telegram agent requests for durable recovery', () => {
    const requests = normalizeTelegramPendingAgentRequests([
      { text: 'Recibo', actorUserId: 20, scope: 'finance', attachment: { kind: 'pdf', value: { fileId: 'pdf-1', fileName: 'sueldo.pdf', mimeType: 'application/pdf' } } },
      { text: 'Foto', actorUserId: 20, scope: 'finance', attachment: { kind: 'photo', value: { fileId: 'photo-1', width: 1200, height: 1600 } } },
      { text: 'Inválido', actorUserId: '20', scope: 'finance', attachment: null },
    ])

    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.attachment?.value.fileId)).toEqual(['pdf-1', 'photo-1'])
  })

  it('normalizes progress recovery metadata without accepting unsafe values', () => {
    const requests = normalizeTelegramPendingAgentRequests([
      {
        text: 'Continuar', actorUserId: 20, scope: 'library', requestId: 'request-1',
        progressMessageId: 42, progressMessageRetryCount: 99, status: 'active', attachment: null,
      },
      {
        text: 'Ignorar', actorUserId: 20, scope: 'library', requestId: 'not valid',
        progressMessageId: -1, progressMessageRetryCount: -3, status: 'unknown', attachment: null,
      },
    ])

    expect(requests).toEqual([
      {
        text: 'Continuar', actorUserId: 20, scope: 'library', attachment: null,
        requestId: 'request-1', progressMessageId: 42, progressMessageRetryCount: 3, status: 'active',
      },
      {
        text: 'Ignorar', actorUserId: 20, scope: 'library', attachment: null,
        progressMessageRetryCount: 0, status: 'queued',
      },
    ])
  })

  it('turns an active persisted request into an explicit interrupted request on reload', () => {
    expect(saveTelegramPendingAgentRequests('scope-1', [{
      text: 'Continuar', actorUserId: 20, scope: 'library', attachment: null,
      requestId: 'request-1', status: 'active',
    }])).toBe(true)
    expect(loadTelegramPendingAgentRequests('scope-1')).toMatchObject([
      { requestId: 'request-1', status: 'interrupted', text: '' },
    ])
  })

  it('never persists the original Telegram prompt for durable recovery', () => {
    saveTelegramPendingAgentRequests('scope-private', [{
      text: 'Mi sueldo es 123456 y vivo en una direccion privada.',
      actorUserId: 20,
      scope: 'finance',
      attachment: null,
      requestId: 'request-private',
      status: 'interrupted',
    }])

    const stored = values.get('notia:telegram-pending-agent-requests:v1:scope-private') ?? ''
    expect(stored).not.toContain('Mi sueldo')
    expect(stored).not.toContain('123456')
    expect(loadTelegramPendingAgentRequests('scope-private')[0]?.text).toBe('')
  })

  it('persists only bounded plan ids and statuses for Telegram recovery', () => {
    const requests = normalizeTelegramPendingAgentRequests([{
      text: 'Continuar', actorUserId: 20, scope: 'library', attachment: null,
      plan: {
        steps: [
          { id: 'read', status: 'completed' },
          { id: 'apply', status: 'pending' },
          { id: 'C:/private/cliente.md', status: 'pending' },
        ],
      },
    }])

    expect(requests[0]?.plan).toEqual({
      steps: [
        { id: 'read', status: 'completed' },
        { id: 'apply', status: 'pending' },
      ],
    })
  })
})
