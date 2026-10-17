import { describe, expect, it } from 'vitest'
import type { TaskItem } from '../types/taskManagerTypes'
import { filterTasks, hasTaskFilters, NO_TASK_FILTERS, taskFilterOptions } from './taskFilters'

function task(fileName: string, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    filePath: `task-mannager/equipo/${fileName}.md`,
    path: `task-mannager/equipo/${fileName}.md`,
    fileName,
    title: fileName,
    detail: '',
    state: 'Pendiente',
    startDate: '',
    endDate: '',
    dynamicEndDate: true,
    board: 'Equipo',
    group: 'Sprint',
    priority: 'Media',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order: 1,
    preview: '',
    ...extra,
  }
}

const TASKS = [
  task('Pagos', { project: 'Remesas', assignees: ['Ana'], priority: 'Alta', preview: 'Integrar el proveedor' }),
  task('Sandbox', { parentTaskName: 'Pagos', assignees: ['Luis'] }),
  task('Contratos', { project: 'Corresponsalías', state: 'En progreso', assignees: ['Ana', 'Eva'] }),
  task('Informe', { parentTaskName: 'Contratos', project: 'Remesas' }),
]

const names = (tasks: TaskItem[]) => tasks.map((item) => item.fileName)

describe('task filters', () => {
  it('keep everything without filters', () => {
    expect(hasTaskFilters(NO_TASK_FILTERS)).toBe(false)
    expect(filterTasks(TASKS, NO_TASK_FILTERS)).toBe(TASKS)
  })

  it('find words of the title, the detail, the project and the people, without accents', () => {
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, query: 'proveedor' }))).toEqual(['Pagos', 'Sandbox'])
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, query: 'corresponsalias' }))).toEqual(['Contratos', 'Informe'])
  })

  it('filter by state, priority, project and person', () => {
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, state: 'En progreso' }))).toEqual(['Contratos', 'Informe'])
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, priority: 'Alta' }))).toEqual(['Pagos', 'Sandbox'])
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, person: 'eva' }))).toEqual(['Contratos', 'Informe'])
  })

  it('keep the parent of a subtask that matches', () => {
    // «Informe» is of Remesas and its parent is not: the parent stays to hold it.
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, project: 'Remesas' }))).toEqual(['Pagos', 'Sandbox', 'Contratos', 'Informe'])
    expect(names(filterTasks(TASKS, { ...NO_TASK_FILTERS, person: 'Luis' }))).toEqual(['Pagos', 'Sandbox'])
  })

  it('offer each project and person once, in order', () => {
    expect(taskFilterOptions([...TASKS, task('Otro', { project: ' remesas ', assignees: ['ana'] })])).toEqual({
      projects: ['Corresponsalías', 'Remesas'],
      people: ['Ana', 'Eva', 'Luis'],
    })
  })
})
