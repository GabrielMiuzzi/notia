import { beforeEach, describe, expect, it } from 'vitest'

import { getSessionAiApiKey, loadAiPreferences, resolveAiPreferencesForTransport, saveAiPreferences } from './aiSettingsStorage'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  })
})

// The backend normalizes the preferences (`backend-core::library_config`,
// `backend-core::ai_settings`); this storage only caches them on the device.
describe('aiSettingsStorage', () => {
  it('starts from the defaults when nothing is stored', () => {
    expect(loadAiPreferences()).toMatchObject({ thinkingEnabled: true, thinkingLevel: 'medium', apiKey: '' })
  })

  it('keeps the provider key out of localStorage while exposing it only to transport resolution', () => {
    saveAiPreferences({
      ollamaUrl: 'https://ollama.com',
      apiKey: 'fixture-credential',
      selectedModel: 'qwen3',
      thinkingEnabled: true,
      thinkingLevel: 'medium',
    })

    expect(values.get('notia:ai-settings:v1')).not.toContain('fixture-credential')
    expect(getSessionAiApiKey()).toBe('fixture-credential')
    expect(resolveAiPreferencesForTransport({
      ollamaUrl: 'https://ollama.com',
      apiKey: '',
      selectedModel: 'qwen3',
      thinkingEnabled: true,
      thinkingLevel: 'medium',
    }).apiKey).toBe('fixture-credential')

    saveAiPreferences({
      ollamaUrl: 'https://ollama.com',
      apiKey: '',
      selectedModel: 'qwen3',
      thinkingEnabled: true,
      thinkingLevel: 'medium',
    })
  })

  it('does not hydrate legacy persisted credentials back into application state', () => {
    values.set('notia:ai-settings:v1', JSON.stringify({
      ollamaUrl: 'https://ollama.com',
      apiKey: 'legacy-credential',
      selectedModel: 'qwen3',
    }))

    expect(loadAiPreferences().apiKey).toBe('')
    expect(values.get('notia:ai-settings:v1')).not.toContain('legacy-credential')
  })
})
