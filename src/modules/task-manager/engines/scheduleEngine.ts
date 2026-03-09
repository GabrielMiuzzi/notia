import { parseTaskDate } from './taskEngine'
import type { TaskItem } from '../types/taskManagerTypes'

const HOUR_MS = 60 * 60 * 1000

export function buildRebalancedEndDates(tasks: TaskItem[]): Array<{ taskPath: string; endDate: string }> {
  if (tasks.length === 0) {
    return []
  }

  const sortedTasks = [...tasks].sort((left, right) => left.order - right.order)
  const firstStartDate = parseTaskDate(sortedTasks[0].startDate) ?? new Date()
  let cursor = firstStartDate.getTime()

  const updates: Array<{ taskPath: string; endDate: string }> = []

  for (const task of sortedTasks) {
    const estimatedHours = Number.isFinite(task.estimatedHours) && task.estimatedHours > 0
      ? task.estimatedHours
      : 0
    const dedicatedHours = Number.isFinite(task.dedicatedHours) && task.dedicatedHours > 0
      ? task.dedicatedHours
      : 0
    const effectiveHours = Math.max(estimatedHours, dedicatedHours)

    cursor += effectiveHours * HOUR_MS
    updates.push({
      taskPath: task.filePath,
      endDate: new Date(cursor).toISOString(),
    })
  }

  return updates
}
