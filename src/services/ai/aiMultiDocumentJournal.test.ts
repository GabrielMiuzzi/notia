import { describe, expect, it } from 'vitest'
import { clearMultiDocumentJournalForTests, getMultiDocumentOperation, recordMultiDocumentOperation } from './aiMultiDocumentJournal'

describe('aiMultiDocumentJournal', () => {
  it('keeps the complete rollback material only in the operation journal', () => {
    clearMultiDocumentJournalForTests()
    recordMultiDocumentOperation({
      operationId: 'op-1', renamedFrom: 'Old.md', renamedTo: 'New.md', summary: 'Renombrar documento',
      files: [{ path: 'Links.md', previousSource: '[[Old]]', nextSource: '[[New]]' }],
    })
    expect(getMultiDocumentOperation('op-1')).toMatchObject({
      kind: 'multi-document', renamedFrom: 'Old.md', files: [{ previousSource: '[[Old]]' }],
    })
  })
})
