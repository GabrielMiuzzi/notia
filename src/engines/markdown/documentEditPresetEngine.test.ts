import { describe, expect, it } from 'vitest'
import { documentEditPresetInstruction, isDocumentEditPreset } from './documentEditPresetEngine'

describe('documentEditPresetEngine', () => {
  it('accepts only the bounded preset catalog', () => {
    expect(isDocumentEditPreset('clarity')).toBe(true)
    expect(isDocumentEditPreset('summary')).toBe(true)
    expect(isDocumentEditPreset('extract-risks')).toBe(true)
    expect(documentEditPresetInstruction('mermaid')).toContain('Mermaid')
    expect(isDocumentEditPreset('unknown')).toBe(false)
    expect(documentEditPresetInstruction('grammar')).toContain('gramática')
  })
})
