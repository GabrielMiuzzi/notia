import { callBackend } from '../transport'
import type { NotiaLibrary } from '../../types/notia'

/*
 * The backend records every undoable change the agent applies and marks
 * the undone ones (`agent_history.rs`); the interface lists them and asks
 * for a diff. Nothing is kept in the WebView.
 */

export type AiOperationHistoryStatus = 'applied' | 'undone'

export interface AiOperationHistoryEntry {
  operationId: string
  documentPath: string
  summary: string
  status: AiOperationHistoryStatus
  appliedAt: number
  undoneAt: number | null
  hasDiff: boolean
}

export interface AiOperationDiff {
  operationId: string
  summary: string
  files: { path: string; previousSource: string; nextSource: string }[]
}

interface BackendHistoryEntry extends Omit<AiOperationHistoryEntry, 'documentPath'> {
  /** Path of the document as the explorer shows it. */
  path: string
}

export async function listAiOperationHistory(library: NotiaLibrary): Promise<AiOperationHistoryEntry[]> {
  const entries = await callBackend<BackendHistoryEntry[]>('backend_agent_history', { payload: { libraryId: library.id } })
  return entries.map(({ path, ...entry }) => ({ ...entry, documentPath: path }))
}

export async function loadAiOperationDiff(library: NotiaLibrary, operationId: string): Promise<AiOperationDiff | null> {
  const diff = await callBackend<{ operationId: string; summary: string; path: string; previousSource: string; nextSource: string } | null>(
    'backend_agent_history_diff',
    { payload: { libraryId: library.id, operationId } },
  )
  return diff
    ? {
        operationId: diff.operationId,
        summary: diff.summary,
        files: [{ path: diff.path, previousSource: diff.previousSource, nextSource: diff.nextSource }],
      }
    : null
}
