import { ORDER_STEP } from '../constants/taskManagerConstants'
import type { TaskItem } from '../types/taskManagerTypes'

export function reorderList<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
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
