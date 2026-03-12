import { parseTaskDate } from './taskEngine'
import type { TaskItem } from '../types/taskManagerTypes'

const HOUR_MS = 60 * 60 * 1000
const DAY_HOURS = 24
const DEFAULT_ACTIVITY_HOURS_PER_DAY = 24

interface BuildRebalancedEndDatesOptions {
  activityHoursPerDay?: number
  startAt?: Date
}

export function buildRebalancedEndDates(
  tasks: TaskItem[],
  options: BuildRebalancedEndDatesOptions = {},
): Array<{ taskPath: string; endDate: string }> {
  if (tasks.length === 0) {
    return []
  }

  const sortedTasks = [...tasks].sort((left, right) => left.order - right.order)
  const firstStartDate = options.startAt ?? parseTaskDate(sortedTasks[0].startDate) ?? new Date()
  const activityHoursPerDay = normalizeActivityHoursPerDay(options.activityHoursPerDay)
  const calendarHourScale = DAY_HOURS / activityHoursPerDay
  let cursor = firstStartDate.getTime()

  const updates: Array<{ taskPath: string; endDate: string }> = []

  for (const task of sortedTasks) {
    const estimatedHours = Number.isFinite(task.estimatedHours) && task.estimatedHours > 0
      ? task.estimatedHours
      : 0
    const expandedCalendarHours = estimatedHours * calendarHourScale
    cursor += expandedCalendarHours * HOUR_MS

    if (!task.dynamicEndDate) {
      continue
    }

    updates.push({
      taskPath: task.filePath,
      endDate: estimatedHours > 0 ? new Date(cursor).toISOString() : '',
    })
  }

  return updates
}

function normalizeActivityHoursPerDay(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ACTIVITY_HOURS_PER_DAY
  }

  if (value <= 0) {
    return DEFAULT_ACTIVITY_HOURS_PER_DAY
  }

  return Math.min(24, Math.max(1, value))
}
