import { beforeEach, describe, expect, it } from 'vitest'
import { loadAutoApplyLowRiskPreference, saveAutoApplyLowRiskPreference, shouldAutoApplyLowRiskPreview } from './aiAutoApplyPreference'

describe('aiAutoApplyPreference', () => {
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

  it('stores the low-risk preference independently per library and allows revocation', () => {
    expect(loadAutoApplyLowRiskPreference('library-a')).toBe(false)
    saveAutoApplyLowRiskPreference('library-a', true)
    expect(loadAutoApplyLowRiskPreference('library-a')).toBe(true)
    expect(loadAutoApplyLowRiskPreference('library-b')).toBe(false)
    saveAutoApplyLowRiskPreference('library-a', false)
    expect(loadAutoApplyLowRiskPreference('library-a')).toBe(false)
  })

  it('only accepts an explicit low-risk preview with concrete hunks', () => {
    const preview = { risk: 'low' as const, allowedActions: ['apply-all' as const], hunks: [{ id: 'hunk-1' }] }
    expect(shouldAutoApplyLowRiskPreview(preview, true)).toBe(true)
    expect(shouldAutoApplyLowRiskPreview({ ...preview, risk: 'medium' }, true)).toBe(false)
    expect(shouldAutoApplyLowRiskPreview({ ...preview, hunks: [] }, true)).toBe(false)
    expect(shouldAutoApplyLowRiskPreview(preview, false)).toBe(false)
  })
})
