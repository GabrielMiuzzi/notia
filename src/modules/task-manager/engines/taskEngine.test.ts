import { describe, expect, it } from 'vitest'
import type { TaskItem } from '../types/taskManagerTypes'
import { buildTaskContent, getTasks, resolveTaskParent } from './taskEngine'

describe('taskEngine ordering', () => {
  it('keeps zero as a valid order for a ticket moved before the first item', () => {
    const tasks = getTasks([{
      path: 'task-mannager/default/ticket.md',
      content: [
        '---',
        'tags: [tarea]',
        'tarea: Ticket',
        'tablero: default',
        'equipo: Pendiente',
        'estado: Pendiente',
        'order: 0',
        '---',
        '',
      ].join('\n'),
    }])

    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.order).toBe(0)
  })
})

describe('taskEngine parent resolution', () => {
  const parent: TaskItem = {
    filePath: 'task-mannager/equipo/principal.md',
    fileName: 'principal',
    title: 'Tarea principal',
    detail: '',
    state: 'Pendiente',
    startDate: '',
    endDate: '',
    dynamicEndDate: true,
    board: 'equipo',
    group: 'Pendiente',
    priority: 'Media',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order: 10,
    preview: '',
  }

  it('resolves a top-level parent by title or file name within the same board', () => {
    expect(resolveTaskParent([parent], '[[Tarea principal]]', 'Equipo')).toBe(parent)
    expect(resolveTaskParent([parent], 'principal', 'equipo')).toBe(parent)
  })

  it('does not resolve parents from another board or another subtask', () => {
    const nestedTask = { ...parent, filePath: 'task-mannager/equipo/subTasks/nested.md', fileName: 'nested', parentTaskName: 'principal' }
    expect(resolveTaskParent([parent], 'principal', 'personal')).toBeNull()
    expect(resolveTaskParent([nestedTask], 'nested', 'equipo')).toBeNull()
  })

  it('prefers the unique file name when titles are duplicated', () => {
    const duplicateTitle = { ...parent, filePath: 'task-mannager/equipo/otra.md', fileName: 'otra' }
    expect(resolveTaskParent([parent, duplicateTitle], 'principal', 'equipo')).toBe(parent)
    expect(resolveTaskParent([parent, duplicateTitle], 'Tarea principal', 'equipo')).toBeNull()
  })

  it('round-trips the canonical parent link used by a new subtask', () => {
    const content = buildTaskContent({
      title: 'Seguimiento',
      detail: '',
      state: 'Pendiente',
      endDate: '',
      dynamicEndDate: true,
      board: 'equipo',
      group: 'Pendiente',
      priority: 'Media',
      estimatedHours: 0,
      parentTaskName: parent.fileName,
    }, 10)

    expect(getTasks([
      { path: parent.filePath, content: buildTaskContent({
        title: parent.title,
        detail: '',
        state: parent.state,
        endDate: '',
        dynamicEndDate: true,
        board: parent.board,
        group: parent.group,
        priority: parent.priority,
        estimatedHours: 0,
        parentTaskName: '',
      }, 10) },
      { path: 'task-mannager/equipo/subTasks/seguimiento.md', content },
    ]).find((task) => task.fileName === 'seguimiento')?.parentTaskName).toBe('principal')
  })
})
