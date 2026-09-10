import { describe, expect, it, vi } from 'vitest'
import {
  buildMinimalTaskOrderUpdates,
  normalizeTaskArrangementUpdates,
  persistTaskOrder,
  reorderList,
  selectChangedTaskArrangementUpdates,
} from './orderEngine'
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

  it('keeps consecutive movements of the same ticket and skips unchanged neighbors', () => {
    const firstState = [
      { ...task('task-mannager/equipo/one.md'), order: 10 },
      { ...task('task-mannager/equipo/two.md'), order: 20 },
      { ...task('task-mannager/equipo/three.md'), order: 30 },
    ]
    const firstMove = normalizeTaskArrangementUpdates([
      { taskPath: firstState[0]!.filePath, order: 20 },
      { taskPath: firstState[1]!.filePath, order: 10 },
      { taskPath: firstState[2]!.filePath, order: 30 },
    ])
    expect(selectChangedTaskArrangementUpdates(firstState, firstMove).map((update) => update.taskPath)).toEqual([
      firstState[0]!.filePath,
      firstState[1]!.filePath,
    ])

    const secondState = firstState.map((currentTask) => {
      const update = firstMove.find((candidate) => candidate.taskPath === currentTask.filePath)
      return update ? { ...currentTask, order: update.order } : currentTask
    })
    const secondMove = normalizeTaskArrangementUpdates([
      { taskPath: firstState[0]!.filePath, order: 10 },
      { taskPath: firstState[1]!.filePath, order: 20 },
      { taskPath: firstState[2]!.filePath, order: 30 },
    ])
    expect(selectChangedTaskArrangementUpdates(secondState, secondMove).map((update) => update.taskPath)).toEqual([
      firstState[0]!.filePath,
      firstState[1]!.filePath,
    ])
  })

  it('persists only the moved ticket when there is numeric space between its neighbors', () => {
    const moved = { ...task('task-mannager/equipo/moved.md'), order: 80 }
    const ordered = [
      { ...task('task-mannager/equipo/one.md'), order: 10 },
      moved,
      { ...task('task-mannager/equipo/two.md'), order: 20 },
      { ...task('task-mannager/equipo/three.md'), order: 30 },
    ]

    expect(buildMinimalTaskOrderUpdates(ordered, 1)).toEqual([
      { taskPath: moved.filePath, order: 15 },
    ])
  })

  it('uses zero as a valid order when moving a ticket before the first item', () => {
    const moved = { ...task('task-mannager/equipo/moved.md'), order: 80 }

    expect(buildMinimalTaskOrderUpdates([
      moved,
      { ...task('task-mannager/equipo/first.md'), order: 10 },
    ], 0)).toEqual([{ taskPath: moved.filePath, order: 0 }])
  })

  it('can calculate consecutive moves of the same ticket without renumbering either column', () => {
    const moved = { ...task('task-mannager/equipo/moved.md'), order: 10 }
    const firstMove = buildMinimalTaskOrderUpdates([
      { ...task('task-mannager/equipo/target-one.md'), order: 10 },
      { ...task('task-mannager/equipo/target-two.md'), order: 20 },
      moved,
    ], 2)
    const secondMove = buildMinimalTaskOrderUpdates([
      { ...task('task-mannager/equipo/other-one.md'), order: 10 },
      { ...moved, order: firstMove[0]!.order },
      { ...task('task-mannager/equipo/other-two.md'), order: 20 },
    ], 1)

    expect(firstMove).toEqual([{ taskPath: moved.filePath, order: 30 }])
    expect(secondMove).toEqual([{ taskPath: moved.filePath, order: 15 }])
  })

  it('rebalances the target column only when adjacent order values cannot be split', () => {
    const ordered = [
      { ...task('task-mannager/equipo/one.md'), order: 10 },
      { ...task('task-mannager/equipo/moved.md'), order: 10 },
      { ...task('task-mannager/equipo/two.md'), order: 10 },
    ]

    expect(buildMinimalTaskOrderUpdates(ordered, 1)).toEqual([
      { taskPath: ordered[0]!.filePath, order: 10 },
      { taskPath: ordered[1]!.filePath, order: 20 },
      { taskPath: ordered[2]!.filePath, order: 30 },
    ])
  })
})
