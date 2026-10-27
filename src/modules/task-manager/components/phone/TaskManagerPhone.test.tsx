// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TaskManagerPhone, type TaskManagerPhoneProps } from './TaskManagerPhone'
import type { TaskBoardExecuteResult, TaskBoardIntent } from '../../services/taskManagerService'
import type { Board, Group, TaskItem } from '../../types/taskManagerTypes'

vi.mock('../../services/taskManagerService', async (original) => ({
  ...(await original<typeof import('../../services/taskManagerService')>()),
  readTaskDetail: vi.fn(async () => ({
    description: 'Reconstruir el endpoint.',
    comments: [{ commentId: 'c1', author: 'Gabriel', initials: 'GA', color: '#4FD1C5', when: 'ayer 18:20', text: 'Sigo con el endpoint.' }],
  })),
}))

const BOARD: Board = {
  name: 'default',
  color: '#6C8EFF',
  activityHoursPerDay: 9,
  plan: { dayStartMinutes: 540, dayEndMinutes: 1080, workDays: [true, true, true, true, true, false, false], sprintWeeks: 2, sprintStartWeekday: 0, divisionsPerYear: 4, divisionPrefix: 'Q', yearStartMonth: 1 },
  members: [{ name: 'Gabriel', color: '#4FD1C5', initials: 'GA', isOwner: true, isMe: true, taskCount: 1, role: 'Vos · Propietario' }],
  projects: [{ name: 'Remesas', color: '#4FD1C5', taskCount: 1 }],
  counts: { active: 3, inProgress: 1, pending: 2 },
  nextMemberColor: '#A78BFA',
  nextProjectColor: '#D9B44A',
}

const GROUPS: Group[] = [
  { name: 'Anotadores', color: '#64748B', board: 'default', kind: 'custom', taskCount: 1 },
  { name: 'Sprint actual', color: '#4FD1C5', board: 'default', kind: 'current-sprint', taskCount: 2 },
]

function task(name: string, group: string, order: number, overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: `id-${name}`, filePath: `tm/${name}.md`, path: `tm/${name}.md`, fileName: name, title: name, detail: '', state: 'Pendiente',
    startDate: '', endDate: '', dynamicEndDate: false, board: 'default', group, priority: 'Media', dedicatedHours: 0, estimatedHours: 0,
    deviationHours: 0, parentTaskName: '', order, preview: '', ...overrides,
  }
}

const TASKS = [
  task('Nota', 'Anotadores', 1),
  task('Acceso', 'Sprint actual', 1, { priority: 'Urgente', assignees: ['Gabriel'], people: [{ name: 'Gabriel', initials: 'GA', color: '#4FD1C5', isMe: true }] }),
  task('Banks', 'Sprint actual', 2, { state: 'En progreso', startedAtUnixMs: Date.now() - 60_000, estimatedHours: 8, dedicatedHours: 2, project: 'Remesas' }),
]

function renderPhone(overrides: Partial<TaskManagerPhoneProps> = {}) {
  const onIntent = vi.fn(async (intent: TaskBoardIntent): Promise<TaskBoardExecuteResult> => {
    void intent
    return { changed: true }
  })
  const props: TaskManagerPhoneProps = {
    boards: [BOARD], board: BOARD, groups: GROUPS, tasks: TASKS, allTasks: TASKS, query: '', onQueryChange: vi.fn(), resultCount: null,
    viewMode: 'board', onViewModeChange: vi.fn(), flashTaskId: null, archive: { finished: [], cancelled: [] }, finishedCount: 4,
    pomodoroRunning: false, pomodoro: <p>Panel del Pomodoro</p>, management: { view: null, loading: false, error: null },
    managementRequest: { divisionOffset: 0, rangeMode: 'auto', groupBy: 'task' }, onManagementRequestChange: vi.fn(),
    context: { libraryId: 'lib', libraryUserId: 'user-owner' }, generation: 1, canManageBoards: true, onSelectBoard: vi.fn(),
    onEditBoard: vi.fn(), onNewBoard: vi.fn(), onCreateTask: vi.fn(), onUndo: vi.fn(), onRestore: vi.fn(), onDeleteArchived: vi.fn(),
    onIntent, onOpenTask: vi.fn(), onEditSource: vi.fn(), onComment: vi.fn(), onOpenPeoplePanel: vi.fn(),
    ...overrides,
  }
  render(<TaskManagerPhone {...props} />)
  return { ...props, onIntent }
}

describe('TaskManagerPhone', () => {
  afterEach(cleanup)

  it('opens on the current sprint and changes column with the chips and the arrows', () => {
    renderPhone()
    expect(screen.getByRole('heading', { name: 'Sprint actual' })).toBeTruthy()
    expect(screen.getByText('2 / 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Columna anterior' }))
    expect(screen.getByRole('heading', { name: 'Anotadores' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Sprint actual/ }))
    expect(screen.getByRole('heading', { name: 'Sprint actual' })).toBeTruthy()
  })

  it('starts a task and changes its priority from the sheet', async () => {
    const { onIntent } = renderPhone()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Iniciar' })) })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'start-task', taskPath: 'tm/Acceso.md' })
    fireEvent.click(screen.getByRole('button', { name: 'Prioridad Urgente. Cambiar' }))
    const sheet = screen.getByRole('dialog', { name: 'Prioridad' })
    await act(async () => { fireEvent.click(within(sheet).getByRole('radio', { name: /Alta/ })) })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'change-priority', taskPath: 'tm/Acceso.md', priority: 'Alta' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves a task to another column from its options', async () => {
    const { onIntent } = renderPhone()
    fireEvent.click(screen.getByRole('button', { name: 'Opciones de Acceso' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Opciones de la tarea' })).getByRole('button', { name: /Mover a/ }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Mover a' })).getByRole('radio', { name: /Anotadores/ })) })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'move-task', taskPath: 'tm/Acceso.md', group: 'Anotadores' })
  })

  it('opens the detail with its comments and saves the estimate', async () => {
    const { onIntent } = renderPhone()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Banks' })) })
    expect(await screen.findByText('Sigo con el endpoint.')).toBeTruthy()
    expect(screen.getByText('Reconstruir el endpoint.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '16 h' })) })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'set-task-time', taskPath: 'tm/Banks.md', estimatedHours: 16 })
    // The detail hides the sections; «Volver» brings them back.
    expect(screen.queryByRole('navigation', { name: 'Secciones' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Sprint actual/ }))
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeTruthy()
  })

  it('offers «Ajustes» only to who can edit the board', () => {
    const { onEditBoard } = renderPhone()
    const nav = screen.getByRole('navigation', { name: 'Secciones' })
    fireEvent.click(within(nav).getByRole('button', { name: /Ajustes/ }))
    expect(onEditBoard).toHaveBeenCalled()
    cleanup()
    renderPhone({ canManageBoards: false })
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).queryByRole('button', { name: /Ajustes/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar tablero' })).toBeNull()
  })

  it('filters the list with the quick filters', () => {
    renderPhone({ viewMode: 'list' })
    expect(screen.getByRole('button', { name: 'Banks' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Mías/ }))
    expect(screen.queryByRole('button', { name: 'Banks' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Acceso' })).toBeTruthy()
  })
})
