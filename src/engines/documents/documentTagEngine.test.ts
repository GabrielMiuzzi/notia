import { describe, expect, it } from 'vitest'
import { getFrontmatterValue, parseFrontmatterDocument } from '../markdown/frontmatterEngine'
import { updateDocumentTags } from './documentTagEngine'

describe('documentTagEngine', () => {
  it('adds and deduplicates tags without changing the body', () => {
    const result = updateDocumentTags('---\ntags: ["IA", "notas"]\n---\n\nContenido', ['#ia', 'producto'], 'add')
    expect(result.tags).toEqual(['IA', 'notas', 'producto'])
    expect(parseFrontmatterDocument(result.source).body).toBe('Contenido')
  })

  it('removes selected tags and supports replacement', () => {
    const removed = updateDocumentTags('---\ntags: ["uno", "dos"]\n---\n\nTexto', ['DOS'], 'remove')
    expect(getFrontmatterValue(parseFrontmatterDocument(removed.source).frontmatter, 'tags')).toEqual(['uno'])
    const replaced = updateDocumentTags(removed.source, ['nuevo'], 'replace')
    expect(replaced.tags).toEqual(['nuevo'])
  })
})
