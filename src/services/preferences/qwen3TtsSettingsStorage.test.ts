import { describe, expect, it } from 'vitest'
import { normalizeQwen3TtsPreferences } from './qwen3TtsSettingsStorage'

describe('normalizeQwen3TtsPreferences', () => {
  it('normalizes voice settings and clamps conversation controls', () => {
    expect(normalizeQwen3TtsPreferences({
      enabled: true,
      voice: 'RYAN',
      language: 'ES',
      speed: 3,
      pauseDetectionMs: 100,
      greeting: ' Hola ',
    })).toMatchObject({
      enabled: true,
      voice: 'ryan',
      language: 'es',
      speed: 1.8,
      pauseDetectionMs: 600,
      greeting: 'Hola',
    })
  })
})
