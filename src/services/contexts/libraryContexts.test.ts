import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIBRARY_CONTEXTS,
  normalizeContextTag,
  normalizeLibraryContexts,
  resolveContextColor,
} from './libraryContexts'

describe('library context helpers', () => {
  it('normalizes tags with a leading hash', () => {
    expect(normalizeContextTag('Personal')).toBe('#Personal')
    expect(normalizeContextTag('#Personal')).toBe('#Personal')
    expect(normalizeContextTag('')).toBeNull()
  })

  it('provides the three default contexts and removes duplicate tags', () => {
    expect(DEFAULT_LIBRARY_CONTEXTS.map((context) => context.tag)).toEqual(['#Laboral', '#Personal', '#Academico'])
    expect(normalizeLibraryContexts([{ tag: '#Personal', color: '#00ff00' }, { tag: 'personal', color: '#ff0000' }])).toEqual([
      { tag: '#Personal', color: '#00FF00' },
    ])
  })

  it('resolves graph colors case-insensitively', () => {
    expect(resolveContextColor(DEFAULT_LIBRARY_CONTEXTS, '#laboral')).toBe('#2563EB')
  })
})
