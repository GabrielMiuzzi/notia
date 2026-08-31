import { describe, expect, it } from 'vitest'
import { mergeTelegramUpdateCheckpoint, normalizeTelegramPreferences, rememberTelegramUpdate } from './telegramSettingsStorage'

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
})
