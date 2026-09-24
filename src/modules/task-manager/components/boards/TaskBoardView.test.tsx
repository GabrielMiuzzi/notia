// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { TaskBoardView } from './TaskBoardView'
import type { Group, TaskItem } from '../../types/taskManagerTypes'

const GROUPS: Group[] = ['Backlog', 'Sprint', 'Hecho'].map((name) => ({ name, color: '#6c8eff', board: 'Trabajo' }))
const CARD_HEIGHT = 100

function task(name: string, order: number, overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    filePath: `task-mannager/Trabajo/${name}.md`,
    path: `task-mannager/Trabajo/${name}.md`,
    fileName: name,
    title: name,
    detail: '',
    state: 'En progreso',
    startDate: '',
    endDate: '',
    dynamicEndDate: false,
    board: 'Trabajo',
    group: 'Backlog',
    priority: '',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order,
    preview: '',
    ...overrides,
  }
}

type Placement = { taskPath: string; orderedPaths: string[]; group: string; parentTaskName: string }

function renderBoard(tasks: TaskItem[] = [], onPlaceTask = vi.fn<(placement: Placement) => Promise<void>>(async () => {})) {
  const onReorderGroups = vi.fn(async () => {})
  const noop = vi.fn(async () => {})
  const view = render(
    <TaskBoardView
      boardName="Trabajo"
      tasks={tasks}
      groups={GROUPS}
      onCreateTask={vi.fn()}
      onEditTask={vi.fn()}
      onChangeTaskState={noop}
      onChangeTaskPriority={noop}
      onChangeTaskDedicatedHours={noop}
      onToggleSubtaskDone={noop}
      onAddTaskComment={noop}
      onLoadTaskSource={vi.fn(async () => '')}
      onSaveTaskSource={noop}
      onCreateGroup={vi.fn()}
      onEditGroup={vi.fn()}
      onOpenPomodoroTask={vi.fn()}
      onReorderGroups={onReorderGroups}
      onPlaceTask={onPlaceTask}
    />,
  )
  const group = (name: string) => view.container.querySelector<HTMLElement>(`.tareas-group[data-group="${name}"]`)!
  const header = (name: string) => group(name).querySelector<HTMLElement>('.tareas-group-header')!
  const card = (name: string) => view.container.querySelector<HTMLElement>(`.tareas-task-drag-wrap[data-task-path="task-mannager/Trabajo/${name}.md"]`)!
  const cardOrder = (groupName: string) => Array
    .from(group(groupName).querySelectorAll<HTMLElement>('.tareas-card-list > .tareas-task-drag-wrap'))
    .map((node) => node.dataset.taskPath?.replace('task-mannager/Trabajo/', '').replace('.md', ''))
  const board = view.container.querySelector<HTMLElement>('.tareas-board')!
  return { onReorderGroups, onPlaceTask, group, header, card, cardOrder, board }
}

/** happy-dom drops `clientY` from drag event init, so it is set on the event. */
function dragAt(type: 'dragOver' | 'drop', element: HTMLElement, clientY: number) {
  const event = createEvent[type](element)
  Object.defineProperty(event, 'clientY', { value: clientY })
  fireEvent(element, event)
}

/** Lays out the cards of each list one below the other, CARD_HEIGHT px each. */
function stackCards() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const siblings = Array.from(this.parentElement?.children ?? []).filter((node) => node.classList.contains('tareas-task-drag-wrap'))
    const top = Math.max(0, siblings.indexOf(this)) * CARD_HEIGHT
    return { top, bottom: top + CARD_HEIGHT, height: CARD_HEIGHT, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
}

describe('TaskBoardView group reordering', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('drops a dragged group anywhere over another group and takes its place', () => {
    const { onReorderGroups, group, header } = renderBoard()

    fireEvent.dragStart(header('Backlog'))
    fireEvent.dragOver(group('Sprint').querySelector('.tareas-card-list')!)
    expect(group('Sprint').classList.contains('is-drop-target')).toBe(true)
    fireEvent.drop(group('Sprint').querySelector('.tareas-card-list')!)

    expect(onReorderGroups).toHaveBeenCalledWith('Trabajo', ['Sprint', 'Backlog', 'Hecho'])
  })

  it('moves a group before an earlier one when dropped on its header', () => {
    const { onReorderGroups, header } = renderBoard()

    fireEvent.dragStart(header('Hecho'))
    fireEvent.dragOver(header('Backlog'))
    fireEvent.drop(header('Backlog'))

    expect(onReorderGroups).toHaveBeenCalledWith('Trabajo', ['Hecho', 'Backlog', 'Sprint'])
  })

  it('reorders groups with a long press and a finger drag', () => {
    vi.useFakeTimers()
    const { onReorderGroups, group, header, board } = renderBoard()
    board.setPointerCapture = vi.fn()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(group('Hecho'))

    fireEvent.pointerDown(header('Backlog'), { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.pointerMove(board, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 10 })
    expect(group('Hecho').classList.contains('is-drop-target')).toBe(true)
    fireEvent.pointerUp(board, { pointerId: 1, pointerType: 'touch', clientX: 600, clientY: 10 })

    expect(onReorderGroups).toHaveBeenCalledWith('Trabajo', ['Sprint', 'Hecho', 'Backlog'])
  })

  it('does not reorder when a touch moves before the long press', () => {
    vi.useFakeTimers()
    const { onReorderGroups, header, board } = renderBoard()
    board.setPointerCapture = vi.fn()

    fireEvent.pointerDown(header('Backlog'), { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(board, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 80 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.pointerUp(board, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 80 })

    expect(onReorderGroups).not.toHaveBeenCalled()
  })
})

describe('TaskBoardView task moves', () => {
  const backlog = () => [task('A', 1), task('B', 2), task('C', 3), task('D', 4)]
  const paths = (...names: string[]) => names.map((name) => `task-mannager/Trabajo/${name}.md`)

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('moves a task down to the gap it is dropped on', () => {
    stackCards()
    const { onPlaceTask, group, card } = renderBoard(backlog())

    fireEvent.dragStart(card('A'))
    // Past the middle of C (250): between C and D.
    dragAt('dragOver', card('C'), 260)
    dragAt('drop', card('C'), 260)

    expect(onPlaceTask).toHaveBeenCalledWith({
      taskPath: paths('A')[0],
      orderedPaths: paths('B', 'C', 'A', 'D'),
      group: 'Backlog',
      parentTaskName: '',
    })
    expect(group('Backlog').querySelectorAll('.tareas-task-drop-slot')).toHaveLength(0)
  })

  it('drops where the slot is shown, even when released over the gap between cards', () => {
    stackCards()
    const { onPlaceTask, group, card } = renderBoard(backlog())

    fireEvent.dragStart(card('D'))
    dragAt('dragOver', card('A'), 40)
    expect(group('Backlog').querySelectorAll('.tareas-task-drop-slot')).toHaveLength(1)
    dragAt('drop', group('Backlog').querySelector('.tareas-card-list')!, 9999)

    expect(onPlaceTask).toHaveBeenCalledWith(expect.objectContaining({ orderedPaths: paths('D', 'A', 'B', 'C') }))
  })

  it('does nothing when a task is dropped where it already is', () => {
    stackCards()
    const { onPlaceTask, group, card } = renderBoard(backlog())

    fireEvent.dragStart(card('B'))
    dragAt('dragOver', card('B'), 140)
    expect(group('Backlog').querySelectorAll('.tareas-task-drop-slot')).toHaveLength(0)
    dragAt('drop', card('B'), 140)

    expect(onPlaceTask).not.toHaveBeenCalled()
  })

  it('moves a task into another group, ignoring hidden finished tasks', () => {
    stackCards()
    const tasks = [...backlog(), task('Done', 5, { group: 'Sprint', state: 'Finalizada' }), task('S1', 6, { group: 'Sprint' })]
    const { onPlaceTask, card } = renderBoard(tasks)

    fireEvent.dragStart(card('A'))
    dragAt('dragOver', card('S1'), 10)
    dragAt('drop', card('S1'), 10)

    expect(onPlaceTask).toHaveBeenCalledWith({
      taskPath: paths('A')[0],
      orderedPaths: paths('A', 'S1'),
      group: 'Sprint',
      parentTaskName: '',
    })
  })

  it('shows the moved task in place until the backend answers', async () => {
    stackCards()
    let finish = () => {}
    const onPlaceTask = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve
    }))
    const { card, cardOrder } = renderBoard(backlog(), onPlaceTask)

    fireEvent.dragStart(card('A'))
    dragAt('dragOver', card('D'), 390)
    dragAt('drop', card('D'), 390)
    expect(cardOrder('Backlog')).toEqual(['B', 'C', 'D', 'A'])

    // The reload is not simulated, so the board falls back to the props.
    await act(async () => {
      finish()
    })
    expect(cardOrder('Backlog')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('moves a task with a long press and a finger drag', () => {
    vi.useFakeTimers()
    stackCards()
    const { onPlaceTask, group, card, board } = renderBoard(backlog())
    board.setPointerCapture = vi.fn()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(group('Backlog'))

    fireEvent.pointerDown(card('A'), { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.pointerMove(board, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 360 })
    fireEvent.pointerUp(board, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 360 })

    expect(onPlaceTask).toHaveBeenCalledWith(expect.objectContaining({ orderedPaths: paths('B', 'C', 'D', 'A') }))
  })

  it('moves a subtask down before the row it is dropped on', () => {
    const tasks = [
      task('Madre', 1),
      task('S1', 1, { parentTaskName: 'Madre' }),
      task('S2', 2, { parentTaskName: 'Madre' }),
      task('S3', 3, { parentTaskName: 'Madre' }),
    ]
    const { onPlaceTask, card } = renderBoard(tasks)
    fireEvent.click(card('Madre').querySelector('.tareas-card-subtasks-toggle')!)
    const rows = card('Madre').querySelectorAll<HTMLElement>('.tareas-card-subtask-row')

    fireEvent.dragStart(rows[0])
    fireEvent.dragOver(rows[2])
    fireEvent.drop(rows[2])

    expect(onPlaceTask).toHaveBeenCalledWith({
      taskPath: paths('S1')[0],
      orderedPaths: paths('S2', 'S1', 'S3'),
      group: 'Backlog',
      parentTaskName: 'Madre',
    })
  })
})
