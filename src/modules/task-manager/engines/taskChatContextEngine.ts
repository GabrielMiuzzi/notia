import { TASKS_ROOT_FOLDER } from '../constants/taskManagerConstants'
import { isTaskInCancelledFolder, isTaskInFinishedFolder, isTaskMarkdownFile } from './taskEngine'

const FINISHED_PANEL_ID = '__finished__'
const CANCELLED_PANEL_ID = '__cancelled__'
const POMODORO_PANEL_ID = '__pomodoro__'

export function resolveTaskManagerPanelChatPaths(
  activePanelId: string,
  documentPaths: string[],
): string[] {
  return documentPaths
    .filter((pathValue) => isTaskMarkdownFile(pathValue))
    .filter((pathValue) => {
      if (activePanelId === FINISHED_PANEL_ID) {
        return isTaskInFinishedFolder(pathValue)
      }

      if (activePanelId === CANCELLED_PANEL_ID) {
        return isTaskInCancelledFolder(pathValue)
      }

      if (activePanelId === POMODORO_PANEL_ID) {
        return false
      }

      return pathValue.startsWith(`${TASKS_ROOT_FOLDER}/${activePanelId}/`)
        && !isTaskInFinishedFolder(pathValue)
        && !isTaskInCancelledFolder(pathValue)
    })
}
