import { markAiOperationHistoryUndone, recordAiOperationHistory } from './aiOperationHistory'

export interface MultiDocumentJournalFile {
  path: string
  previousSource: string
  nextSource: string
}

export interface MultiDocumentJournalEntry {
  operationId: string
  kind: 'multi-document'
  renamedFrom: string
  renamedTo: string
  files: readonly MultiDocumentJournalFile[]
  summary: string
  appliedAt: number
  undoneAt: number | null
}

const journal = new Map<string, MultiDocumentJournalEntry>()

export function recordMultiDocumentOperation(input: Omit<MultiDocumentJournalEntry, 'kind' | 'undoneAt' | 'appliedAt'> & { appliedAt?: number }): MultiDocumentJournalEntry {
  const entry: MultiDocumentJournalEntry = {
    ...input,
    kind: 'multi-document',
    appliedAt: input.appliedAt ?? Date.now(),
    undoneAt: null,
  }
  journal.set(entry.operationId, entry)
  recordAiOperationHistory({
    operationId: entry.operationId,
    documentPath: entry.renamedTo,
    summary: entry.summary,
    status: 'applied',
    appliedAt: entry.appliedAt,
    undoneAt: null,
  })
  return entry
}

export function getMultiDocumentOperation(operationId: string): MultiDocumentJournalEntry | null {
  return journal.get(operationId) ?? null
}

export function markMultiDocumentOperationUndone(operationId: string, undoneAt = Date.now()): MultiDocumentJournalEntry | null {
  const entry = journal.get(operationId)
  if (!entry) return null
  const updated = { ...entry, undoneAt }
  journal.set(operationId, updated)
  markAiOperationHistoryUndone(operationId, undoneAt)
  return updated
}

export function clearMultiDocumentJournalForTests(): void {
  journal.clear()
}
