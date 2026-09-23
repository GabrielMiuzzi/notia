import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { joinLibraryPath } from '../libraries/libraryPathMapping'

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
  logicalPath: string
}

export async function listAiOperationHistory(library: NotiaLibrary): Promise<AiOperationHistoryEntry[]> {
  const entries = await invoke<BackendHistoryEntry[]>('backend_agent_history', { payload: { libraryId: library.id } })
  return entries.map(({ logicalPath, ...entry }) => ({ ...entry, documentPath: joinLibraryPath(library.path, logicalPath) }))
}

export async function loadAiOperationDiff(library: NotiaLibrary, operationId: string): Promise<AiOperationDiff | null> {
  const diff = await invoke<{ operationId: string; summary: string; logicalPath: string; previousSource: string; nextSource: string } | null>(
    'backend_agent_history_diff',
    { payload: { libraryId: library.id, operationId } },
  )
  return diff
    ? {
        operationId: diff.operationId,
        summary: diff.summary,
        files: [{ path: joinLibraryPath(library.path, diff.logicalPath), previousSource: diff.previousSource, nextSource: diff.nextSource }],
      }
    : null
}
