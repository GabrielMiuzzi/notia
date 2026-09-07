import { computeWorkspaceDocumentRevision } from './workspaceAiSnapshotRuntime'
import { markAiOperationHistoryUndone, recordAiOperationHistory } from './aiOperationHistory'
import type { MutationPreview } from '../../types/ai/agentContracts'

export interface AiOperationJournalEntry {
  operationId: string
  kind: 'markdown-edit'
  documentPath: string
  previousSource: string
  nextSource: string
  summary: string
  previousRevision: number
  nextRevision: number
  appliedAt: number
  undoneAt: number | null
}

const journal = new Map<string, AiOperationJournalEntry>()

export interface PendingMarkdownOperation {
  operationId: string
  documentPath: string
  originalSource: string
  nextSource: string
  expectedRevision: number
  preview: MutationPreview
  summary: string
  createdAt: number
}

const pendingOperations = new Map<string, PendingMarkdownOperation>()

export function savePendingMarkdownOperation(operation: PendingMarkdownOperation): void {
  pendingOperations.set(operation.operationId, operation)
}

export function getPendingMarkdownOperation(operationId: string): PendingMarkdownOperation | null {
  return pendingOperations.get(operationId) ?? null
}

export function removePendingMarkdownOperation(operationId: string): void {
  pendingOperations.delete(operationId)
}

export function recordMarkdownOperation(input: {
  operationId: string
  documentPath: string
  previousSource: string
  nextSource: string
  appliedAt?: number
  summary?: string
}): AiOperationJournalEntry {
  const entry: AiOperationJournalEntry = {
    operationId: input.operationId,
    kind: 'markdown-edit',
    documentPath: input.documentPath,
    previousSource: input.previousSource,
    nextSource: input.nextSource,
    summary: input.summary ?? 'Edición de documento',
    previousRevision: computeWorkspaceDocumentRevision(input.documentPath, input.previousSource),
    nextRevision: computeWorkspaceDocumentRevision(input.documentPath, input.nextSource),
    appliedAt: input.appliedAt ?? Date.now(),
    undoneAt: null,
  }
  journal.set(entry.operationId, entry)
  recordAiOperationHistory({
    operationId: entry.operationId,
    documentPath: entry.documentPath,
    summary: entry.summary,
    status: 'applied',
    appliedAt: entry.appliedAt,
    undoneAt: null,
  })
  return entry
}

export function getAiOperation(operationId: string): AiOperationJournalEntry | null {
  return journal.get(operationId) ?? null
}

export function markAiOperationUndone(operationId: string, undoneAt = Date.now()): AiOperationJournalEntry | null {
  const entry = journal.get(operationId)
  if (!entry) return null
  const updated = { ...entry, undoneAt }
  journal.set(operationId, updated)
  markAiOperationHistoryUndone(operationId, undoneAt)
  return updated
}

export function clearAiOperationJournalForTests(): void {
  journal.clear()
  pendingOperations.clear()
}
