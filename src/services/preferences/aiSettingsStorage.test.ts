import { describe, expect, it } from 'vitest'

import { normalizeAiSettingsInput } from './aiSettingsStorage'

describe('normalizeAiSettingsInput', () => {
  it('applies safe defaults to legacy preferences without thinking settings', () => {
    expect(normalizeAiSettingsInput({ selectedModel: 'qwen3' })).toMatchObject({
      selectedModel: 'qwen3',
      thinkingEnabled: true,
      thinkingLevel: 'medium',
    })
  })

  it('preserves a disabled thinking mode and a supported level', () => {
    expect(normalizeAiSettingsInput({
      thinkingEnabled: false,
      thinkingLevel: 'high',
    })).toMatchObject({
      thinkingEnabled: false,
      thinkingLevel: 'high',
    })
  })

  it('normalizes an unsupported thinking level to medium', () => {
    expect(normalizeAiSettingsInput({
      thinkingLevel: 'unsupported' as never,
    }).thinkingLevel).toBe('medium')
  })
})
