import { describe, expect, it } from 'vitest'
import { updateDocumentWikilink } from './documentWikilinkEngine'

describe('documentWikilinkEngine', () => {
  it('adds an idempotent wikilink', () => {
    const added = updateDocumentWikilink('# Nota\n', 'docs/Objetivo.md', 'add', 'ver objetivo')
    expect(added.changed).toBe(true)
    expect(added.source).toContain('[[Objetivo|ver objetivo]]')
    expect(updateDocumentWikilink(added.source, 'docs/Objetivo.md', 'add').changed).toBe(false)
  })

  it('removes only the requested exact target', () => {
    const result = updateDocumentWikilink('[[Objetivo]]\n[[Otro]]\n', 'Objetivo.md', 'remove')
    expect(result.linksChanged).toBe(1)
    expect(result.source).not.toContain('[[Objetivo]]')
    expect(result.source).toContain('[[Otro]]')
  })
})
