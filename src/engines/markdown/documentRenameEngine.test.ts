import { describe, expect, it } from 'vitest'
import { buildDocumentRenamePreview, replaceDocumentLinks } from './documentRenameEngine'

describe('documentRenameEngine', () => {
  it('updates exact wiki and markdown link targets while preserving aliases', () => {
    const result = replaceDocumentLinks('[ [no] ] [[Old|ver]] [ver](Old.md) Old.md', 'docs/Old.md', 'docs/New.md')
    expect(result.source).toContain('[[New|ver]]')
    expect(result.source).toContain('[ver](docs/New.md)')
    expect(result.replacements).toBe(2)
  })

  it('returns only documents that actually reference the renamed document', () => {
    const preview = buildDocumentRenamePreview([
      { path: 'a.md', content: '[[Old]]' },
      { path: 'b.md', content: 'sin referencias' },
    ], 'Old.md', 'New.md')
    expect(preview.changes.map((change) => change.path)).toEqual(['a.md'])
    expect(preview.changes[0]?.updated).toBe('[[New]]')
  })
})
