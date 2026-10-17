// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TaskListView, type TaskListViewProps } from './TaskListView'
import { TaskKanbanView } from '../board/TaskKanbanView'
import type { TaskBoardExecuteResult, TaskBoardIntent } from '../../services/taskManagerService'
import type { Board, Group, TaskItem } from '../../types/taskManagerTypes'

const BOARD: Board = {
  name: 'default',
  color: '#6C8EFF',
  activityHoursPerDay: 9,
  plan: {
    dayStartMinutes: 540,
    dayEndMinutes: 1080,
    workDays: [true, true, true, true, true, false, false],
    sprintWeeks: 2,
    sprintStartWeekday: 0,
    divisionsPerYear: 4,
    divisionPrefix: 'Q',
    yearStartMonth: 1,
  },
  members: [{ name: 'Gabriel Miuzzi', color: '#4FD1C5', initials: 'GM', isOwner: true, isMe: true, taskCount: 1, role: 'Vos · Propietario' }],
  projects: [{ name: 'Remesas', color: '#A78BFA', taskCount: 1 }],
  counts: { active: 3, inProgress: 1, pending: 2 },
  nextMemberColor: '#A78BFA',
  nextProjectColor: '#D9B44A',
}

function group(name: string, taskCount: number, color = '#4FD1C5'): Group {
  return { name, color, board: 'default', kind: 'custom', taskCount }
}

function task(name: string, groupName: string, order: number, overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: `id-${name}`,
    filePath: `tm/default/${name}.md`,
    path: `tm/default/${name}.md`,
    fileName: name,
    title: name,
    detail: '',
    state: 'Pendiente',
    startDate: '',
    endDate: '',
    dynamicEndDate: false,
    board: 'default',
    group: groupName,
    priority: 'Alta',
    dedicatedHours: 6,
    estimatedHours: 16,
    deviationHours: 0,
    parentTaskName: '',
    order,
    preview: 'Reconstruir el endpoint',
    ...overrides,
  }
}

const path = (name: string) => `tm/default/${name}.md`
const GROUPS = [group('Sprint', 2), group('Revisión', 1, '#A78BFA'), group('Atrasado', 0, '#F28CB1')]
const TASKS = [
  task('A', 'Sprint', 1, { subtaskDone: 0, subtaskTotal: 1 }),
  task('B', 'Sprint', 2, { state: 'En progreso', startedAtUnixMs: Date.now() }),
  task('C', 'Revisión', 1, { state: 'Bloqueada', blockNote: 'Esperando a Federico' }),
  task('A1', 'Sprint', 1, { parentTaskName: 'A' }),
]

function renderList(props: Partial<TaskListViewProps> = {}) {
  const onIntent = vi.fn<(intent: TaskBoardIntent) => Promise<TaskBoardExecuteResult>>(async () => ({ changed: true }))
  const handlers = {
    onToggleCollapsed: vi.fn(),
    onCreateTask: vi.fn(),
    onOpenTask: vi.fn(),
    onEditSource: vi.fn(),
    onComment: vi.fn(),
    onOpenPeoplePanel: vi.fn(),
  }
  const view = render(
    <TaskListView
      board={BOARD}
      groups={GROUPS}
      tasks={TASKS}
      allTasks={TASKS}
      searchActive={false}
      showDescriptions
      collapsed={{}}
      flashTaskId={null}
      canEdit
      onIntent={onIntent}
      {...handlers}
      {...props}
    />,
  )
  const section = (name: string) => screen.getByRole('region', { name })
  const row = (name: string) => view.container.querySelector<HTMLElement>(`.tm-lrow[data-task-path="${path(name)}"]`)!
  return { onIntent, view, section, row, ...handlers }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TaskListView groups', () => {
  it('renders one group per column with its rows, count and «Agregar»', () => {
    const { section, onCreateTask } = renderList()
    const sprint = section('Sprint')
    expect(within(sprint).getByRole('heading', { name: 'Sprint' })).toBeTruthy()
    expect(within(sprint).getByRole('button', { name: 'Plegar Sprint' }).getAttribute('aria-expanded')).toBe('true')
    expect(sprint.querySelectorAll('.tm-lrow')).toHaveLength(2)
    fireEvent.click(within(sprint).getByRole('button', { name: 'Agregar tarea en Sprint' }))
    expect(onCreateTask).toHaveBeenCalledWith('Sprint')
  })

  it('starts empty groups collapsed and keeps its own collapsed state apart from the board', () => {
    const { section, onToggleCollapsed } = renderList({ collapsed: { Sprint: true } })
    expect(section('Sprint').querySelector('.tm-lrow')).toBeNull()
    expect(within(section('Atrasado')).getByRole('button', { name: 'Expandir Atrasado' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(within(section('Sprint')).getByRole('button', { name: 'Expandir Sprint' }))
    expect(onToggleCollapsed).toHaveBeenCalledWith('Sprint', false)
    fireEvent.click(within(section('Revisión')).getByRole('button', { name: 'Plegar Revisión' }))
    expect(onToggleCollapsed).toHaveBeenCalledWith('Revisión', true)
    cleanup()

    // The board gets its own collapsed map: the same data shows Sprint open there.
    render(
      <TaskKanbanView
        board={BOARD}
        groups={GROUPS}
        tasks={TASKS}
        allTasks={TASKS}
        searchActive={false}
        showDescriptions
        collapsed={{}}
        onToggleCollapsed={vi.fn()}
        flashTaskId={null}
        canEdit
        onCreateTask={vi.fn()}
        onCreateGroup={vi.fn()}
        onEditGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onIntent={vi.fn(async () => ({ changed: true }))}
        onOpenTask={vi.fn()}
        onEditSource={vi.fn()}
        onComment={vi.fn()}
        onOpenPeoplePanel={vi.fn()}
      />,
    )
    expect(within(screen.getByRole('region', { name: 'Sprint' })).getAllByRole('article')).toHaveLength(2)
  })

  it('shows the empty states', () => {
    const { section } = renderList({ collapsed: { Atrasado: false } })
    expect(within(section('Atrasado')).getByText('Soltá una tarea acá')).toBeTruthy()
    cleanup()
    const filtered = renderList({ tasks: [TASKS[0]], searchActive: true })
    expect(within(filtered.section('Revisión')).getByText('Sin coincidencias')).toBeTruthy()
  })
})

describe('TaskListView rows', () => {
  it('shows status, time, priority and the block note', () => {
    const { row } = renderList()
    expect(within(row('A')).getByText('Pendiente')).toBeTruthy()
    expect(within(row('B')).getByText(/^En progreso/)).toBeTruthy()
    expect(within(row('C')).getByText('Bloqueada')).toBeTruthy()
    expect(within(row('C')).getByText('Esperando a Federico')).toBeTruthy()
    expect(within(row('A')).getByText('Reconstruir el endpoint')).toBeTruthy()
    expect(within(row('A')).getByRole('button', { name: 'Tiempo: 6 h dedicadas de 16 h estimadas. Editar' }).textContent).toContain('6 / 16 h')
    expect(within(row('A')).getByRole('button', { name: 'Prioridad Alta. Cambiar' })).toBeTruthy()
  })

  it('runs the same actions as the card', async () => {
    vi.useFakeTimers()
    const { onIntent, row } = renderList()
    fireEvent.click(within(row('A')).getByRole('button', { name: 'Iniciar' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'start-task', taskPath: path('A') })
    fireEvent.click(within(row('B')).getByRole('button', { name: 'Pausar' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'pause-task', taskPath: path('B') })
    fireEvent.click(within(row('B')).getByRole('button', { name: 'Finalizar' }))
    expect(row('B').classList.contains('is-leaving')).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'finish-task', taskPath: path('B') })
  })

  it('moves a row with the menu and opens the shared popovers', () => {
    const { onIntent, row } = renderList()
    fireEvent.click(within(row('A')).getByRole('button', { name: 'Opciones de la tarea' }))
    const menu = screen.getByRole('menu', { name: 'Opciones de A' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Mover a/ }))
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Revisión/ }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'move-task', taskPath: path('A'), group: 'Revisión' })

    fireEvent.click(within(row('A')).getByRole('button', { name: 'Proyecto: Agregar proyecto. Cambiar' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Elegir proyecto' })).getByRole('button', { name: 'Remesas' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-project', taskPath: path('A'), project: 'Remesas' })
  })

  it('nests the subtasks under the row', () => {
    const { onIntent, row, view } = renderList()
    fireEvent.click(within(row('A')).getByRole('button', { name: 'Subtareas: 0 de 1 completas' }))
    expect(view.container.querySelector('.tm-subs--list')?.textContent).toContain('Subtareas de A')
    expect(view.container.querySelector('.tm-subrow-guide')).toBeTruthy()
    const input = screen.getByRole('textbox', { name: 'Agregar subtarea a A' })
    fireEvent.change(input, { target: { value: 'Nueva' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'add-subtask', taskPath: path('A'), title: 'Nueva' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'A1' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'toggle-subtask', taskPath: path('A1') })
  })

  it('drags a row to another group, opening it if it was folded', () => {
    const { onIntent, onToggleCollapsed, row, section } = renderList()
    fireEvent.dragStart(row('A'))
    fireEvent.dragOver(section('Atrasado'))
    expect(section('Atrasado').classList.contains('is-drop')).toBe(true)
    fireEvent.drop(section('Atrasado'))
    expect(onToggleCollapsed).toHaveBeenCalledWith('Atrasado', false)
    expect(onIntent).toHaveBeenCalledWith({ kind: 'place-task', taskPath: path('A'), orderedPaths: [path('A')], group: 'Atrasado', parentTaskName: '' })
  })

  it('drags a row inside its group', () => {
    const { onIntent, row, section } = renderList()
    fireEvent.dragStart(row('A'))
    fireEvent.drop(section('Sprint'))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'place-task', taskPath: path('A'), orderedPaths: [path('B'), path('A')], group: 'Sprint', parentTaskName: '' })
  })
})
