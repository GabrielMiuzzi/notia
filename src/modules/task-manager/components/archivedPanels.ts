export const FINISHED_TAB_ID = '__finished__'
export const CANCELLED_TAB_ID = '__cancelled__'

interface PanelTask {
  path: string
}

/**
 * The finished and cancelled tickets as the backend grouped them. Its panel
 * paths are the paths the explorer shows, so they match `task.path`, never
 * the logical `task.filePath`.
 */
export function archivedPanels<T extends PanelTask>(tasks: readonly T[], panelPaths: Record<string, string[]>) {
  const finishedPaths = new Set(panelPaths[FINISHED_TAB_ID] ?? [])
  const cancelledPaths = new Set(panelPaths[CANCELLED_TAB_ID] ?? [])
  return {
    finished: tasks.filter((task) => finishedPaths.has(task.path)),
    cancelled: tasks.filter((task) => cancelledPaths.has(task.path)),
    isArchived: (task: PanelTask) => finishedPaths.has(task.path) || cancelledPaths.has(task.path),
  }
}
