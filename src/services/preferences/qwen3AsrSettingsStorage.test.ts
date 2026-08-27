import { describe, expect, it } from 'vitest'
import { normalizeQwen3AsrPreferences } from './qwen3AsrSettingsStorage'

describe('normalizeQwen3AsrPreferences', () => {
  it('normalizes the selected model, device and language', () => {
    expect(normalizeQwen3AsrPreferences({
      model: '1.7b',
      device: 'cpu',
      enabled: false,
      language: ' ES ',
    })).toEqual({
      model: '1.7b',
      device: 'cpu',
      enabled: false,
      language: 'es',
    })
  })

  it('falls back to the local CPU defaults for invalid persisted values', () => {
    expect(normalizeQwen3AsrPreferences({
      model: 'invalid',
      device: 'invalid',
      language: '   ',
    } as never)).toEqual({
      model: '0.6b',
      device: 'cpu',
      enabled: true,
      language: 'es',
    })
  })
})
