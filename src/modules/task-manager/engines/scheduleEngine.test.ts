import { describe, expect, it, vi } from 'vitest'
import { buildRebalancedEndDates } from './scheduleEngine'
import type { TaskItem } from '../types/taskManagerTypes'

function task(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    filePath: 'task-mannager/default/tarea.md',
    fileName: 'tarea.md',
    title: 'Tarea',
    detail: '',
    state: 'Pendiente',
    startDate: '',
    endDate: '2026-09-09T12:00:00.000Z',
    dynamicEndDate: true,
    board: 'default',
    group: '',
    priority: 'Media',
    dedicatedHours: 0,
    estimatedHours: 2,
    deviationHours: 0,
    parentTaskName: '',
    order: 10,
    preview: '',
    ...overrides,
  }
}

describe('buildRebalancedEndDates', () => {
  it('keeps a dynamic schedule stable when the first task has a persisted end date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T10:00:00.000Z'))
    const tasks = [task()]

    const first = buildRebalancedEndDates(tasks)
    vi.setSystemTime(new Date('2026-09-09T11:00:00.000Z'))
    const second = buildRebalancedEndDates(tasks)

    expect(first).toEqual(second)
    expect(first[0]?.endDate).toBe('2026-09-09T12:00:00.000Z')
    vi.useRealTimers()
  })
})
