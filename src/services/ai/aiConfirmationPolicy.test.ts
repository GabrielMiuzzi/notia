import { describe, expect, it } from 'vitest'
import { requiresReinforcedAiConfirmation } from './aiConfirmationPolicy'

describe('aiConfirmationPolicy', () => {
  const document = { path: 'note.md', expectedRevision: 1, currentRevision: 1 }

  it('requires reinforcement for critical operations regardless of file count', () => {
    expect(requiresReinforcedAiConfirmation({ risk: 'critical', documents: [document] })).toBe(true)
  })

  it('requires reinforcement for high-risk multi-document operations', () => {
    expect(requiresReinforcedAiConfirmation({ risk: 'high', documents: [document, { ...document, path: 'other.md' }] })).toBe(true)
    expect(requiresReinforcedAiConfirmation({ risk: 'high', documents: [document] })).toBe(false)
  })

  it('allows callers to force reinforcement for mutations without a preview', () => {
    expect(requiresReinforcedAiConfirmation(undefined)).toBe(false)
    expect(requiresReinforcedAiConfirmation(undefined, true)).toBe(true)
  })
})
