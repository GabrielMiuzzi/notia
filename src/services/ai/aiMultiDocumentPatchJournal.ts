import { markAiOperationHistoryUndone, recordAiOperationHistory } from './aiOperationHistory'
import { computeWorkspaceDocumentRevision } from './workspaceAiSnapshotRuntime'

export interface MultiDocumentPatchFile {
  path: string
  previousSource: string
  nextSource: string
}

export interface MultiDocumentPatchJournalEntry {
  operationId: string
  kind: 'multi-document-patch'
  files: readonly MultiDocumentPatchFile[]
  summary: string
  appliedAt: number
  undoneAt: number | null
}

const journal = new Map<string, MultiDocumentPatchJournalEntry>()

export function recordMultiDocumentPatchOperation(input: Omit<MultiDocumentPatchJournalEntry, 'kind' | 'undoneAt' | 'appliedAt'> & { appliedAt?: number }): MultiDocumentPatchJournalEntry {
  const appliedAt = input.appliedAt ?? Date.now()
  const entry: MultiDocumentPatchJournalEntry = {
    ...input,
    kind: 'multi-document-patch',
    appliedAt,
    undoneAt: null,
  }
  journal.set(entry.operationId, entry)
  recordAiOperationHistory({
    operationId: entry.operationId,
    documentPath: entry.files[0]?.path ?? '',
    summary: entry.summary,
    status: 'applied',
    appliedAt,
    undoneAt: null,
  })
  return entry
}

export function getMultiDocumentPatchOperation(operationId: string): MultiDocumentPatchJournalEntry | null {
  return journal.get(operationId) ?? null
}

export function markMultiDocumentPatchOperationUndone(operationId: string, undoneAt = Date.now()): MultiDocumentPatchJournalEntry | null {
  const entry = journal.get(operationId)
  if (!entry) return null
  const updated = { ...entry, undoneAt }
  journal.set(operationId, updated)
  markAiOperationHistoryUndone(operationId, undoneAt)
  return updated
}

export function hasMultiDocumentPatchConflict(
  files: readonly MultiDocumentPatchFile[],
  currentSources: ReadonlyMap<string, string>,
): { path: string; expectedRevision: number; actualRevision: number } | null {
  for (const file of files) {
    const currentSource = currentSources.get(file.path)
    if (currentSource === undefined) {
      return {
        path: file.path,
        expectedRevision: computeWorkspaceDocumentRevision(file.path, file.nextSource),
        actualRevision: -1,
      }
    }
    const expectedRevision = computeWorkspaceDocumentRevision(file.path, file.nextSource)
    const actualRevision = computeWorkspaceDocumentRevision(file.path, currentSource)
    if (expectedRevision !== actualRevision) return { path: file.path, expectedRevision, actualRevision }
  }
  return null
}

export function clearMultiDocumentPatchJournalForTests(): void {
  journal.clear()
}
