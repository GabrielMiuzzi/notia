import { describe, expect, it } from 'vitest'
import { parseFrontmatterDocument, getFrontmatterValue } from '../markdown/frontmatterEngine'
import { updateBidirectionalDocumentRelation } from './bidirectionalDocumentRelationEngine'

describe('bidirectionalDocumentRelationEngine', () => {
  it('adds a deduplicated relation to both documents', () => {
    const result = updateBidirectionalDocumentRelation({
      ticketSource: '---\nrelatedDocuments: []\n---\n\nTicket',
      documentSource: '---\ntags: ["spec"]\n---\n\nNota',
      ticketPath: 'task-mannager/Trabajo.md',
      documentPath: 'docs/Especificacion.md',
      action: 'add',
    })
    expect(result.changed).toBe(true)
    expect(getFrontmatterValue(parseFrontmatterDocument(result.ticketSource).frontmatter, 'relatedDocuments')).toEqual(['[[docs/Especificacion.md]]'])
    expect(getFrontmatterValue(parseFrontmatterDocument(result.documentSource).frontmatter, 'relatedTasks')).toEqual(['[[task-mannager/Trabajo.md]]'])
  })

  it('removes only the selected relation and preserves other links', () => {
    const result = updateBidirectionalDocumentRelation({
      ticketSource: '---\nrelatedDocuments: ["[[docs/Uno.md]]", "[[docs/Dos.md]]"]\n---\n\nTicket',
      documentSource: '---\nrelatedTasks: ["[[task-mannager/Trabajo.md]]", "[[task-mannager/Otro.md]]"]\n---\n\nNota',
      ticketPath: 'task-mannager/Trabajo.md',
      documentPath: 'docs/Uno.md',
      action: 'remove',
    })
    expect(result.changed).toBe(true)
    expect(getFrontmatterValue(parseFrontmatterDocument(result.ticketSource).frontmatter, 'relatedDocuments')).toEqual(['[[docs/Dos.md]]'])
    expect(getFrontmatterValue(parseFrontmatterDocument(result.documentSource).frontmatter, 'relatedTasks')).toEqual(['[[task-mannager/Otro.md]]'])
  })
})
