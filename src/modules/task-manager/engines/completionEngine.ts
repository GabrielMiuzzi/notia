import {
  CANCELLED_SUBTASKS_FOLDER,
  CANCELLED_TASKS_FOLDER,
  DEFAULT_BOARD_NAME,
  FINISHED_SUBTASKS_FOLDER,
  FINISHED_TASKS_FOLDER,
} from '../constants/taskManagerConstants'
import { getBoardFolder, getBoardSubtasksFolder } from './taskEngine'
import type { TaskItem } from '../types/taskManagerTypes'

export function resolveTaskMoveTarget(task: TaskItem, nextState: string): string {
  const isSubtask = Boolean(task.parentTaskName)

  if (nextState === 'Finalizada') {
    return isSubtask ? FINISHED_SUBTASKS_FOLDER : FINISHED_TASKS_FOLDER
  }

  if (nextState === 'Cancelada') {
    return isSubtask ? CANCELLED_SUBTASKS_FOLDER : CANCELLED_TASKS_FOLDER
  }

  const board = task.board || DEFAULT_BOARD_NAME
  return isSubtask ? getBoardSubtasksFolder(board) : getBoardFolder(board)
}

export function resolveUniquePath(desiredPath: string, existingPaths: Set<string>): string {
  if (!existingPaths.has(desiredPath)) {
    return desiredPath
  }

  const dotIndex = desiredPath.lastIndexOf('.')
  const base = dotIndex > 0 ? desiredPath.slice(0, dotIndex) : desiredPath
  const ext = dotIndex > 0 ? desiredPath.slice(dotIndex) : ''

  let index = 1
  while (true) {
    const nextCandidate = `${base}-${index}${ext}`
    if (!existingPaths.has(nextCandidate)) {
      return nextCandidate
    }
    index += 1
  }
}
