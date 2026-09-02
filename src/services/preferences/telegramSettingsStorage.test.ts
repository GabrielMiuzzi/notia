import { describe, expect, it } from 'vitest'
import { mergeTelegramUpdateCheckpoint, normalizeTelegramPendingAgentRequests, normalizeTelegramPreferences, rememberTelegramUpdate } from './telegramSettingsStorage'

describe('normalizeTelegramPreferences', () => {
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
})
