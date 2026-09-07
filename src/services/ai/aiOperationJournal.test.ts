import { beforeEach, describe, expect, it } from 'vitest'
import { clearAiOperationJournalForTests, getAiOperation, markAiOperationUndone, recordMarkdownOperation } from './aiOperationJournal'

describe('aiOperationJournal', () => {
  beforeEach(() => clearAiOperationJournalForTests())

  it('records an in-memory reversible markdown operation', () => {
    const entry = recordMarkdownOperation({
      operationId: 'op-1',
      documentPath: 'docs/guide.md',
      previousSource: 'antes',
      nextSource: 'después',
    })

    expect(getAiOperation('op-1')).toEqual(entry)
    expect(entry.previousRevision).not.toBe(entry.nextRevision)
    expect(markAiOperationUndone('op-1')).toMatchObject({ operationId: 'op-1', undoneAt: expect.any(Number) })
  })

  it('does not invent an operation for an unknown id', () => {
    expect(getAiOperation('missing')).toBeNull()
    expect(markAiOperationUndone('missing')).toBeNull()
  })
})
