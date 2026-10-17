// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { TaskKanbanView, type TaskKanbanViewProps } from './TaskKanbanView'
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
  members: [],
  projects: [],
  counts: { active: 4, inProgress: 0, pending: 4 },
  nextMemberColor: '#A78BFA',
  nextProjectColor: '#D9B44A',
}

function group(name: string, taskCount: number, overrides: Partial<Group> = {}): Group {
  return { name, color: '#4FD1C5', board: 'default', kind: 'custom', taskCount, ...overrides }
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
    priority: 'Media',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order,
    preview: '',
    ...overrides,
  }
}

const path = (name: string) => `tm/default/${name}.md`

const GROUPS = [
  group('Sprint', 3, { kind: 'current-sprint', hint: 'Sprint 21 · 12 oct – 25 oct' }),
  group('Revisión', 1, { kind: 'review', color: '#A78BFA' }),
  group('Atrasado', 0, { kind: 'overdue', color: '#F28CB1' }),
]
const TASKS = [task('A', 'Sprint', 1), task('B', 'Sprint', 2), task('C', 'Sprint', 3), task('D', 'Revisión', 1)]

function renderBoard(props: Partial<TaskKanbanViewProps> = {}) {
  const onIntent = vi.fn<(intent: TaskBoardIntent) => Promise<TaskBoardExecuteResult>>(async () => ({ changed: true }))
  const handlers = {
    onToggleCollapsed: vi.fn(),
    onCreateTask: vi.fn(),
    onCreateGroup: vi.fn(),
    onEditGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onOpenTask: vi.fn(),
    onEditSource: vi.fn(),
    onComment: vi.fn(),
    onOpenPeoplePanel: vi.fn(),
  }
  const view = render(
    <TaskKanbanView
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
  const column = (name: string) => screen.getByRole('region', { name })
  const cardOrder = (name: string) => within(column(name)).queryAllByRole('article').map((node) => node.getAttribute('aria-label'))
  return { onIntent, view, column, cardOrder, ...handlers }
}

/** happy-dom drops `clientY` from drag event init, so it is set on the event. */
function dragAt(type: 'dragOver' | 'drop', element: HTMLElement, clientY: number) {
  const event = createEvent[type](element)
  Object.defineProperty(event, 'clientY', { value: clientY })
  fireEvent(element, event)
}

/** Lays out the cards of each column one below the other, 100 px each. */
function stackCards() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const siblings = Array.from(this.parentElement?.children ?? []).filter((node) => node.hasAttribute('data-drag-path'))
    const index = siblings.indexOf(this)
    const top = Math.max(0, index) * 100
    const height = index >= 0 ? 100 : 0
    return { top, bottom: top + height, height, left: 0, right: 200, width: index >= 0 ? 200 : 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TaskKanbanView columns', () => {
  it('renders the columns in order with their counts, hint and buttons', () => {
    const { column, cardOrder } = renderBoard()
    const sprint = column('Sprint')
    expect(within(sprint).getByRole('heading', { name: 'Sprint' }).getAttribute('title')).toBe('Sprint 21 · 12 oct – 25 oct')
    expect(within(sprint).getByText('3')).toBeTruthy()
    expect(cardOrder('Sprint')).toEqual(['A', 'B', 'C'])
    expect(within(sprint).getByRole('button', { name: 'Agregar tarea en Sprint' })).toBeTruthy()
    expect(within(sprint).getByRole('button', { name: 'Plegar Sprint' })).toBeTruthy()
    expect(within(sprint).getByRole('button', { name: 'Opciones de Sprint' })).toBeTruthy()
  })

  it('starts empty columns collapsed and expands them', () => {
    const { onToggleCollapsed } = renderBoard()
    const collapsed = screen.getByRole('region', { name: 'Atrasado, plegada' })
    fireEvent.click(within(collapsed).getByRole('button', { name: 'Expandir Atrasado' }))
    expect(onToggleCollapsed).toHaveBeenCalledWith('Atrasado', false)
  })

  it('follows the collapsed state the shell keeps', () => {
    const { onToggleCollapsed, column } = renderBoard({ collapsed: { Sprint: true, Atrasado: false } })
    expect(screen.getByRole('region', { name: 'Sprint, plegada' })).toBeTruthy()
    fireEvent.click(within(column('Revisión')).getByRole('button', { name: 'Plegar Revisión' }))
    expect(onToggleCollapsed).toHaveBeenCalledWith('Revisión', true)
    expect(within(column('Atrasado')).getByText('Soltá una tarea acá')).toBeTruthy()
  })

  it('says «Sin coincidencias» when the search empties a column', () => {
    const { column } = renderBoard({ tasks: [TASKS[0]], searchActive: true, collapsed: { Atrasado: false } })
    expect(within(column('Revisión')).getByText('Sin coincidencias')).toBeTruthy()
    expect(within(column('Atrasado')).getByText('Sin coincidencias')).toBeTruthy()
  })

  it('creates a task from the header and from the footer', () => {
    const { onCreateTask, column } = renderBoard()
    fireEvent.click(within(column('Sprint')).getByRole('button', { name: 'Agregar tarea en Sprint' }))
    fireEvent.click(within(column('Revisión')).getByRole('button', { name: 'Agregar tarea' }))
    expect(onCreateTask).toHaveBeenNthCalledWith(1, 'Sprint')
    expect(onCreateTask).toHaveBeenNthCalledWith(2, 'Revisión')
  })

  it('shows «Sin grupo» first only when a task has no column', () => {
    const { cardOrder } = renderBoard({ tasks: [...TASKS, task('Suelta', 'Vieja', 1)], allTasks: [...TASKS, task('Suelta', 'Vieja', 1)] })
    const regions = screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))
    expect(regions[0]).toBe('Sin grupo')
    expect(cardOrder('Sin grupo')).toEqual(['Suelta'])
    expect(within(screen.getByRole('region', { name: 'Sin grupo' })).queryByRole('button', { name: 'Opciones de Sin grupo' })).toBeNull()
    cleanup()
    renderBoard()
    expect(screen.queryByRole('region', { name: 'Sin grupo' })).toBeNull()
  })
})

describe('TaskKanbanView column menu', () => {
  it('edits, moves and deletes a column', () => {
    const { onEditGroup, onDeleteGroup, onIntent, column } = renderBoard()
    const open = () => {
      fireEvent.click(within(column('Sprint')).getByRole('button', { name: 'Opciones de Sprint' }))
      return screen.getByRole('menu', { name: 'Opciones de Sprint' })
    }
    let menu = open()
    expect((within(menu).getByRole('menuitem', { name: 'Mover a la izquierda' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mover a la derecha' }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'move-group', board: 'default', name: 'Sprint', direction: 'right' })
    menu = open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Editar columna' }))
    expect(onEditGroup).toHaveBeenCalledWith(GROUPS[0])
    menu = open()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Eliminar columna' }))
    expect(onDeleteGroup).toHaveBeenCalledWith(GROUPS[0])
  })

  it('offers «Nueva columna» and the options only to who can edit', () => {
    const { onCreateGroup } = renderBoard()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva columna' }))
    expect(onCreateGroup).toHaveBeenCalledTimes(1)
    cleanup()
    renderBoard({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Nueva columna' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Opciones de Sprint' })).toBeNull()
  })
})

describe('TaskKanbanView drag and drop', () => {
  it('drops a card at the end of another column', () => {
    const { onIntent, column } = renderBoard()
    fireEvent.dragStart(within(column('Sprint')).getByRole('article', { name: 'A' }))
    fireEvent.dragOver(column('Revisión'))
    expect(column('Revisión').classList.contains('is-drop')).toBe(true)
    fireEvent.drop(column('Revisión'))
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'place-task',
      taskPath: path('A'),
      orderedPaths: [path('D'), path('A')],
      group: 'Revisión',
      parentTaskName: '',
    })
  })

  it('reorders inside a column and shows the card there until the backend answers', async () => {
    stackCards()
    let answer: (value: TaskBoardExecuteResult) => void = () => {}
    const { onIntent, column, cardOrder } = renderBoard()
    onIntent.mockImplementationOnce(() => new Promise((resolve) => {
      answer = resolve
    }))
    fireEvent.dragStart(within(column('Sprint')).getByRole('article', { name: 'C' }))
    dragAt('dragOver', column('Sprint'), 10)
    expect(column('Sprint').querySelector('.tm-drop-slot')).toBeTruthy()
    dragAt('drop', column('Sprint'), 10)
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'place-task',
      taskPath: path('C'),
      orderedPaths: [path('C'), path('A'), path('B')],
      group: 'Sprint',
      parentTaskName: '',
    })
    expect(cardOrder('Sprint')).toEqual(['C', 'A', 'B'])
    await act(async () => {
      answer({ changed: true })
    })
    expect(cardOrder('Sprint')).toEqual(['A', 'B', 'C'])
  })

  it('keeps hidden tasks in place when the search filters the column', () => {
    const { onIntent, column } = renderBoard({ tasks: [TASKS[0], TASKS[2], TASKS[3]], searchActive: true })
    fireEvent.dragStart(within(column('Revisión')).getByRole('article', { name: 'D' }))
    fireEvent.drop(column('Sprint'))
    expect(onIntent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'place-task',
      orderedPaths: [path('A'), path('B'), path('C'), path('D')],
    }))
  })

  it('expands a collapsed column a card is dropped on', () => {
    const { onIntent, onToggleCollapsed } = renderBoard()
    fireEvent.dragStart(screen.getByRole('article', { name: 'B' }))
    const collapsed = screen.getByRole('region', { name: 'Atrasado, plegada' })
    fireEvent.dragOver(collapsed)
    fireEvent.drop(collapsed)
    expect(onToggleCollapsed).toHaveBeenCalledWith('Atrasado', false)
    expect(onIntent).toHaveBeenCalledWith({ kind: 'place-task', taskPath: path('B'), orderedPaths: [path('B')], group: 'Atrasado', parentTaskName: '' })
  })

  it('does not drag a card with an open popover or subtasks', () => {
    const { onIntent, column } = renderBoard()
    const card = within(column('Sprint')).getByRole('article', { name: 'A' })
    fireEvent.click(within(card).getByRole('button', { name: 'Agregar subtareas' }))
    expect(card.getAttribute('draggable')).toBe('false')
    fireEvent.dragStart(card)
    fireEvent.drop(column('Revisión'))
    expect(onIntent).not.toHaveBeenCalled()
  })

  it('drags with a long press of a finger', () => {
    vi.useFakeTimers()
    const { onIntent, view, column } = renderBoard()
    const root = view.container.querySelector<HTMLElement>('.tm-kanban')!
    root.setPointerCapture = vi.fn()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(column('Revisión'))
    const card = within(column('Sprint')).getByRole('article', { name: 'B' })
    fireEvent.pointerDown(card, { pointerId: 3, pointerType: 'touch', clientX: 20, clientY: 20 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(view.container.querySelector('.tm-drag-ghost')?.textContent).toBe('B')
    fireEvent.pointerMove(root, { pointerId: 3, pointerType: 'touch', clientX: 400, clientY: 20 })
    fireEvent.pointerUp(root, { pointerId: 3, pointerType: 'touch', clientX: 400, clientY: 20 })
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'place-task',
      taskPath: path('B'),
      orderedPaths: [path('D'), path('B')],
      group: 'Revisión',
      parentTaskName: '',
    })
  })

  it('does not drag when the finger moves before the long press', () => {
    vi.useFakeTimers()
    const { onIntent, view, column } = renderBoard()
    const root = view.container.querySelector<HTMLElement>('.tm-kanban')!
    const card = within(column('Sprint')).getByRole('article', { name: 'B' })
    fireEvent.pointerDown(card, { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 20 })
    fireEvent.pointerMove(root, { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 60 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.pointerUp(root, { pointerId: 4, pointerType: 'touch', clientX: 20, clientY: 60 })
    expect(onIntent).not.toHaveBeenCalled()
  })
})
