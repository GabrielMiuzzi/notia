import { describe, expect, it, vi } from 'vitest'
import { persistTaskOrder, reorderList } from './orderEngine'
import type { TaskItem } from '../types/taskManagerTypes'

function task(filePath: string): TaskItem {
  return {
    filePath,
    fileName: filePath.split('/').pop() ?? filePath,
    title: filePath,
    detail: '',
    state: 'Pendiente',
    startDate: '',
    endDate: '',
    dynamicEndDate: false,
    board: 'default',
    group: '',
    priority: '',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order: 0,
    preview: '',
  }
}

describe('orderEngine', () => {
  it('applies a reorder without mutating the source collection', () => {
    const source = ['one', 'two', 'three']

    expect(reorderList(source, 0, 2)).toEqual(['two', 'three', 'one'])
    expect(source).toEqual(['one', 'two', 'three'])
  })

  it('persists a stable, one-based order for every item', async () => {
    const updates: Array<[string, number]> = []
    const tasks = [
      task('task-mannager/equipo/one.md'),
      task('task-mannager/equipo/two.md'),
      task('task-mannager/equipo/three.md'),
    ]

    await persistTaskOrder(tasks, async (task, order) => {
      updates.push([task.filePath, order])
    })

    expect(updates).toEqual([
      ['task-mannager/equipo/one.md', 10],
      ['task-mannager/equipo/two.md', 20],
      ['task-mannager/equipo/three.md', 30],
    ])
  })

  it('does not call the persistence adapter for a no-op reorder', async () => {
    const updater = vi.fn()

    await persistTaskOrder([], updater)

    expect(updater).not.toHaveBeenCalled()
  })

  it('ignores indexes outside the collection instead of inserting an undefined item', () => {
    const source = ['one', 'two']

    expect(reorderList(source, -1, 0)).toBe(source)
    expect(reorderList(source, 0, 2)).toBe(source)
    expect(reorderList(source, 2, 0)).toBe(source)
  })
})
