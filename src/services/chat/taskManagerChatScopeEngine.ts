const ARCHIVED_TASK_FOLDER_NAMES = new Set(['finished', 'cancelled', 'completadas'])

export interface TaskManagerChatScopeRequest {
  board: string | null
  includeArchived: boolean
}

export function normalizeTaskManagerChatBoard(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase('es')
}

export function isArchivedTaskManagerChatPath(pathValue: string): boolean {
  const segments = pathValue.replace(/\\/g, '/').split('/').map((segment) => segment.toLocaleLowerCase('es'))
  return segments.some((segment) => ARCHIVED_TASK_FOLDER_NAMES.has(segment))
}

export function taskManagerChatBoardFromPath(pathValue: string): string | null {
  const segments = pathValue.replace(/\\/g, '/').split('/').filter(Boolean)
  const rootIndex = segments.findIndex((segment) => segment.toLocaleLowerCase('es') === 'task-mannager' || segment.toLocaleLowerCase('es') === 'task-manager')
  if (rootIndex < 0) return null
  const board = segments[rootIndex + 1]
  if (!board || ARCHIVED_TASK_FOLDER_NAMES.has(board.toLocaleLowerCase('es'))) return null
  return normalizeTaskManagerChatBoard(board)
}

export function isExplicitArchivedTaskManagerRequest(values: readonly string[]): boolean {
  const normalized = values
    .map((value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es'))
    .join(' ')
  return /\b(finalizad|completad|cancelad|archivad|finished|cancelled)\w*\b/.test(normalized)
}

export function resolveTaskManagerChatScope(
  activeBoard: string | null,
  requestedBoard: string | null,
  includeArchived: boolean,
): TaskManagerChatScopeRequest {
  const normalizedRequestedBoard = requestedBoard ? normalizeTaskManagerChatBoard(requestedBoard) : ''
  const normalizedActiveBoard = activeBoard ? normalizeTaskManagerChatBoard(activeBoard) : ''
  return {
    board: normalizedRequestedBoard || normalizedActiveBoard || null,
    includeArchived,
  }
}
