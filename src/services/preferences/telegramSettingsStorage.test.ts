import { describe, expect, it } from 'vitest'
import { normalizeTelegramPreferences } from './telegramSettingsStorage'

describe('normalizeTelegramPreferences', () => {
  it('rejects malformed peers and offsets', () => {
    expect(normalizeTelegramPreferences({ enabled: true, botToken: ' token ', authorizedPeer: { chatId: '1' }, updateOffset: -1 })).toEqual({
      enabled: true, botToken: 'token', authorizedPeer: null, pendingPeer: null, updateOffset: 0,
    })
  })

  it('preserves a valid paired identity', () => {
    expect(normalizeTelegramPreferences({
      enabled: true, botToken: '123:abc', updateOffset: 42,
      authorizedPeer: { chatId: 10, userId: 20, displayName: 'Ada', username: 'ada' },
    }).authorizedPeer).toEqual({ chatId: 10, userId: 20, displayName: 'Ada', username: 'ada' })
  })
})
