import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMultiDocumentPatchJournalForTests,
  getMultiDocumentPatchOperation,
  hasMultiDocumentPatchConflict,
  recordMultiDocumentPatchOperation,
} from './aiMultiDocumentPatchJournal'

describe('aiMultiDocumentPatchJournal', () => {
  beforeEach(() => clearMultiDocumentPatchJournalForTests())

  it('records a bounded rollback journal without storing prompt context', () => {
    const entry = recordMultiDocumentPatchOperation({
      operationId: 'multi-1',
      summary: 'Actualizar dos documentos',
      files: [{ path: 'a.md', previousSource: 'antes', nextSource: 'despues' }],
    })
    expect(getMultiDocumentPatchOperation('multi-1')).toEqual(entry)
    expect(entry.files[0]).toEqual({ path: 'a.md', previousSource: 'antes', nextSource: 'despues' })
  })

  it('detects a concurrent change before undo', () => {
    const files = [{ path: 'a.md', previousSource: 'antes', nextSource: 'despues' }]
    expect(hasMultiDocumentPatchConflict(files, new Map([['a.md', 'despues']]))).toBeNull()
    expect(hasMultiDocumentPatchConflict(files, new Map([['a.md', 'otra edicion']]))).toMatchObject({ path: 'a.md' })
    expect(hasMultiDocumentPatchConflict(files, new Map())).toMatchObject({ path: 'a.md', actualRevision: -1 })
  })
})
