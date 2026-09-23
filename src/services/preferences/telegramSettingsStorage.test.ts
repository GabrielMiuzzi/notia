import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeTelegramPreferences } from './telegramSettingsStorage'

// The update checkpoint and the durable queue moved to the backend worker
// (`telegram_worker.rs`).

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
})
