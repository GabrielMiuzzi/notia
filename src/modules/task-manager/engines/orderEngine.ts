import { ORDER_STEP } from '../constants/taskManagerConstants'
import type { TaskItem } from '../types/taskManagerTypes'

export interface TaskArrangementUpdate {
  taskPath: string
  order: number
  group?: string
  parentTaskName?: string
}

function normalizedTaskPath(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase()
}

export function normalizeTaskArrangementUpdates(updates: TaskArrangementUpdate[]): TaskArrangementUpdate[] {
  return Array.from(new Map(updates
    .map((update) => ({
      taskPath: update.taskPath.trim(),
      order: Number.isFinite(update.order) ? update.order : 999999,
      group: typeof update.group === 'string' ? update.group : undefined,
      parentTaskName: typeof update.parentTaskName === 'string' ? update.parentTaskName.trim() : undefined,
    }))
    .filter((update) => update.taskPath.length > 0)
    .map((update) => [normalizedTaskPath(update.taskPath), update] as const)).values())
}

export function selectChangedTaskArrangementUpdates(
  tasks: TaskItem[],
  updates: TaskArrangementUpdate[],
): TaskArrangementUpdate[] {
  const tasksByPath = new Map(tasks.map((task) => [normalizedTaskPath(task.filePath), task]))
  return updates.filter((update) => {
    const task = tasksByPath.get(normalizedTaskPath(update.taskPath))
    return !task
      || task.order !== update.order
      || (update.group !== undefined && task.group !== update.group)
      || (update.parentTaskName !== undefined && task.parentTaskName !== update.parentTaskName)
  })
}

export function buildMinimalTaskOrderUpdates(
  orderedTasks: Array<Pick<TaskItem, 'filePath' | 'order'>>,
  movedIndex: number,
): Array<Pick<TaskArrangementUpdate, 'taskPath' | 'order'>> {
  const movedTask = orderedTasks[movedIndex]
  if (!movedTask) return []

  const previousOrder = orderedTasks[movedIndex - 1]?.order
  const nextOrder = orderedTasks[movedIndex + 1]?.order
  let order: number
  if (previousOrder === undefined && nextOrder === undefined) {
    order = ORDER_STEP
  } else if (previousOrder === undefined && Number.isFinite(nextOrder)) {
    order = (nextOrder as number) - ORDER_STEP
  } else if (nextOrder === undefined && Number.isFinite(previousOrder)) {
    order = (previousOrder as number) + ORDER_STEP
  } else if (
    Number.isFinite(previousOrder)
    && Number.isFinite(nextOrder)
    && (previousOrder as number) < (nextOrder as number)
  ) {
    order = ((previousOrder as number) + (nextOrder as number)) / 2
    if (order === previousOrder || order === nextOrder) {
      return orderedTasks.map((task, index) => ({
        taskPath: task.filePath,
        order: (index + 1) * ORDER_STEP,
      }))
    }
  } else {
    return orderedTasks.map((task, index) => ({
      taskPath: task.filePath,
      order: (index + 1) * ORDER_STEP,
    }))
  }

  return [{ taskPath: movedTask.filePath, order }]
}

export function reorderList<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= items.length
    || toIndex >= items.length
    || fromIndex === toIndex
  ) {
    return items
  }

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(fromIndex, 1)
  nextItems.splice(toIndex, 0, movedItem)
  return nextItems
}

export async function persistTaskOrder(
  tasks: TaskItem[],
  updater: (task: TaskItem, order: number) => Promise<void>,
): Promise<void> {
  for (const [index, task] of tasks.entries()) {
    await updater(task, (index + 1) * ORDER_STEP)
  }
}
