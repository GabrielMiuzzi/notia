// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TaskKanbanView, type TaskKanbanViewProps } from '../board/TaskKanbanView'
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
  members: [
    { name: 'Gabriel Miuzzi', color: '#4FD1C5', initials: 'GM', isOwner: true, isMe: true, taskCount: 1, role: 'Vos · Propietario' },
    { name: 'José Pérez', color: '#6C8EFF', initials: 'JP', isOwner: false, isMe: false, taskCount: 0, role: 'Miembro' },
  ],
  projects: [{ name: 'Remesas', color: '#A78BFA', taskCount: 1 }],
  counts: { active: 1, inProgress: 0, pending: 1 },
  nextMemberColor: '#A78BFA',
  nextProjectColor: '#D9B44A',
}

const GROUPS: Group[] = [
  { name: 'Sprint', color: '#4FD1C5', board: 'default', kind: 'current-sprint', taskCount: 1 },
  { name: 'Hecho', color: '#A78BFA', board: 'default', kind: 'review', taskCount: 2 },
]

function task(name: string, overrides: Partial<TaskItem> = {}): TaskItem {
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
    group: 'Sprint',
    priority: 'Media',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order: 0,
    preview: '',
    ...overrides,
  }
}

const PATH = 'tm/default/Tarea.md'

function renderCard(overrides: Partial<TaskItem> = {}, extra: TaskItem[] = [], props: Partial<TaskKanbanViewProps> = {}) {
  const main = task('Tarea', overrides)
  const all = [main, ...extra]
  const onIntent = vi.fn<(intent: TaskBoardIntent) => Promise<TaskBoardExecuteResult>>(async () => ({ changed: true }))
  const handlers = {
    onOpenTask: vi.fn(),
    onEditSource: vi.fn(),
    onComment: vi.fn(),
    onOpenPeoplePanel: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onCreateTask: vi.fn(),
  }
  const view = render(
    <TaskKanbanView
      board={BOARD}
      groups={GROUPS}
      tasks={all}
      allTasks={all}
      searchActive={false}
      showDescriptions
      collapsed={{ Hecho: false }}
      flashTaskId={null}
      canEdit
      onCreateGroup={vi.fn()}
      onEditGroup={vi.fn()}
      onDeleteGroup={vi.fn()}
      onIntent={onIntent}
      {...handlers}
      {...props}
    />,
  )
  const card = () => screen.getByRole('article', { name: main.title })
  return { onIntent, card, view, ...handlers }
}

function openMenu(card: HTMLElement) {
  fireEvent.click(within(card).getByRole('button', { name: 'Opciones de la tarea' }))
  return screen.getByRole('menu', { name: /^Opciones de / })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TaskCard actions', () => {
  it('starts a pending task and pauses a running one', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(card()).getByRole('button', { name: 'Iniciar' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'start-task', taskPath: PATH })
    cleanup()

    const running = renderCard({ state: 'En progreso', startedAtUnixMs: Date.now() - 65_000 })
    expect(within(running.card()).getByText(/En progreso · 1:0\d/)).toBeTruthy()
    fireEvent.click(within(running.card()).getByRole('button', { name: 'Pausar' }))
    expect(running.onIntent).toHaveBeenLastCalledWith({ kind: 'pause-task', taskPath: PATH })
  })

  it('finishes after the leaving animation', async () => {
    vi.useFakeTimers()
    const { onIntent, card } = renderCard({ state: 'En progreso', startedAtUnixMs: Date.now() })
    fireEvent.click(within(card()).getByRole('button', { name: 'Finalizar' }))
    expect(card().classList.contains('is-leaving')).toBe(true)
    expect(onIntent).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'finish-task', taskPath: PATH })
  })

  it('brings the card back when finishing fails', async () => {
    vi.useFakeTimers()
    const { onIntent, card } = renderCard({ state: 'En progreso', startedAtUnixMs: Date.now() })
    onIntent.mockRejectedValueOnce(new Error('No se pudo'))
    fireEvent.click(within(card()).getByRole('button', { name: 'Finalizar' }))
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    await act(async () => {})
    expect(card().classList.contains('is-leaving')).toBe(false)
  })

  it('opens the ticket, the comment and nothing for a blocked task', () => {
    const { card, onComment } = renderCard({ state: 'Bloqueada', blockNote: 'Esperando a Federico' })
    expect(within(card()).queryByRole('button', { name: 'Iniciar' })).toBeNull()
    expect(within(card()).queryByRole('button', { name: 'Finalizar' })).toBeNull()
    expect(within(card()).getByText('Bloqueada')).toBeTruthy()
    expect(within(card()).getByText('Esperando a Federico')).toBeTruthy()
    fireEvent.click(within(card()).getByRole('button', { name: 'Agregar comentario' }))
    expect(onComment).toHaveBeenCalledTimes(1)
  })

  it('shows the Markdown excerpt as plain text', () => {
    const { card } = renderCard({ preview: '## Origen\n**Reunión** del [lunes](https://x.test) con `API`' })
    expect(within(card()).getByText('Origen Reunión del lunes con API')).toBeTruthy()
  })
})

describe('TaskCard priority', () => {
  it('sets the priority with the keys 1 to 5, «Atrasado» first', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(card()).getByRole('button', { name: 'Prioridad Media. Cambiar' }))
    const picker = screen.getByRole('menu', { name: 'Prioridad de Tarea' })
    expect(within(picker).getAllByRole('menuitemradio').map((item) => item.textContent?.match(/^(Atrasado|Urgente|Alta|Media|Baja)/)?.[0]))
      .toEqual(['Atrasado', 'Urgente', 'Alta', 'Media', 'Baja'])
    fireEvent.keyDown(picker, { key: '1' })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'change-priority', taskPath: PATH, priority: 'Atrasado' })
    expect(screen.queryByRole('menu', { name: 'Prioridad de Tarea' })).toBeNull()

    fireEvent.click(within(card()).getByRole('button', { name: 'Prioridad Media. Cambiar' }))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Prioridad de Tarea' }), { key: '2' })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'change-priority', taskPath: PATH, priority: 'Urgente' })

    fireEvent.click(within(card()).getByRole('button', { name: 'Prioridad Media. Cambiar' }))
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Prioridad de Tarea' }), { key: '5' })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'change-priority', taskPath: PATH, priority: 'Baja' })
  })

  it('closes with Escape and returns the focus to the chip', () => {
    const { card } = renderCard()
    const chip = within(card()).getByRole('button', { name: 'Prioridad Media. Cambiar' })
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Prioridad de Tarea' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(chip)
  })
})

describe('TaskCard project', () => {
  it('creates a project that does not exist', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(card()).getByRole('button', { name: 'Proyecto: Agregar proyecto. Cambiar' }))
    const dialog = screen.getByRole('dialog', { name: 'Elegir proyecto' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Buscar o crear proyecto' }), { target: { value: 'Conciliación' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear proyecto “Conciliación”' }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'set-task-project', taskPath: PATH, project: 'Conciliación' })
    expect(screen.queryByRole('dialog', { name: 'Elegir proyecto' })).toBeNull()
  })

  it('offers no create row for an existing name and picks the first match with Enter', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(card()).getByRole('button', { name: 'Proyecto: Agregar proyecto. Cambiar' }))
    const dialog = screen.getByRole('dialog', { name: 'Elegir proyecto' })
    const input = within(dialog).getByRole('textbox', { name: 'Buscar o crear proyecto' })
    fireEvent.change(input, { target: { value: 'remesas' } })
    expect(within(dialog).queryByRole('button', { name: /Crear proyecto/ })).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'set-task-project', taskPath: PATH, project: 'Remesas' })
  })

  it('takes the project out with «Sin proyecto» and opens the board panel', () => {
    const { onIntent, card, onOpenPeoplePanel } = renderCard({ project: 'Remesas', projectColor: '#A78BFA' })
    fireEvent.click(within(card()).getByRole('button', { name: 'Proyecto: Remesas. Cambiar' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Elegir proyecto' })).getByRole('button', { name: 'Sin proyecto' }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'set-task-project', taskPath: PATH, project: '' })

    fireEvent.click(within(card()).getByRole('button', { name: 'Proyecto: Remesas. Cambiar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Administrar proyectos del tablero' }))
    expect(onOpenPeoplePanel).toHaveBeenCalledWith('projects')
  })
})

describe('TaskCard people', () => {
  it('assigns several people, each tap sending the whole list', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(card()).getByRole('button', { name: 'Asignar personas' }))
    const dialog = screen.getByRole('dialog', { name: 'Asignar personas' })
    expect(within(dialog).getByText('vos')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /José Pérez/ }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-people', taskPath: PATH, people: ['José Pérez'] })
    fireEvent.click(within(dialog).getByRole('button', { name: /Gabriel Miuzzi/ }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-people', taskPath: PATH, people: ['Gabriel Miuzzi', 'José Pérez'] })
    expect(within(dialog).getByRole('button', { name: /José Pérez/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(dialog).getByRole('button', { name: /José Pérez/ }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-people', taskPath: PATH, people: ['Gabriel Miuzzi'] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Listo' }))
    expect(screen.queryByRole('dialog', { name: 'Asignar personas' })).toBeNull()
  })

  it('shows the assigned people with the first name of a single one', () => {
    const { card } = renderCard({ people: [{ name: 'José Pérez', initials: 'JP', color: '#6C8EFF', isMe: false }] })
    const trigger = within(card()).getByRole('button', { name: 'Asignadas: José Pérez. Cambiar' })
    expect(within(trigger).getByText('José')).toBeTruthy()
  })
})

describe('TaskCard time', () => {
  it('steps the estimate by 0.5 h, the dedicated time by 0.25 h and offers quick estimates', () => {
    const { onIntent, card } = renderCard({ estimatedHours: 2, dedicatedHours: 1 })
    const trigger = within(card()).getByRole('button', { name: 'Tiempo: 1 h dedicadas de 2 h estimadas. Editar' })
    expect(within(trigger).getByText('50')).toBeTruthy()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Tiempo de la tarea' })
    expect(within(dialog).getByText('50% del estimado')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sumar a Estimado' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-time', taskPath: PATH, estimatedHours: 2.5 })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sumar a Estimado' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-time', taskPath: PATH, estimatedHours: 3 })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restar a Dedicado' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-time', taskPath: PATH, dedicatedHours: 0.75 })
    fireEvent.click(within(dialog).getByRole('button', { name: '8 h' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'set-task-time', taskPath: PATH, estimatedHours: 8 })
  })

  it('shows an over-budget task in coral and a dashed ring without estimate', () => {
    const { card } = renderCard({ estimatedHours: 8, dedicatedHours: 9 })
    fireEvent.click(within(card()).getByRole('button', { name: /Tiempo: 9 h dedicadas de 8 h/ }))
    expect(within(screen.getByRole('dialog', { name: 'Tiempo de la tarea' })).getByText('+1 h excedido')).toBeTruthy()
    cleanup()

    const none = renderCard()
    const ring = within(none.card()).getByRole('button', { name: 'Sin estimación (0 h dedicadas). Estimar' })
    expect(within(ring).getByText('–')).toBeTruthy()
    expect(ring.querySelector('.tm-ring-track.is-dashed')).toBeTruthy()
  })

  it('tells a running task that time adds up by itself', () => {
    const { card } = renderCard({ state: 'En progreso', startedAtUnixMs: Date.now(), estimatedHours: 4 })
    fireEvent.click(within(card()).getByRole('button', { name: /^Tiempo:/ }))
    expect(screen.getByText('En progreso: el tiempo se suma solo.')).toBeTruthy()
  })
})

describe('TaskCard menu', () => {
  it('moves the task with the «Mover a» submenu; Escape goes back', () => {
    const { onIntent, card } = renderCard({}, [task('Otra', { group: 'Hecho' })])
    const menu = openMenu(card())
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Mover a/ }))
    expect(within(menu).getByRole('menuitemradio', { name: /Sprint/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('menuitemradio', { name: /Hecho/ }).textContent).toContain('2')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(within(menu).getByRole('menuitem', { name: /Renombrar/ })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Mover a/ }))
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Hecho/ }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'move-task', taskPath: PATH, group: 'Hecho' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('lists the state actions of each state', () => {
    const pending = renderCard()
    let menu = openMenu(pending.card())
    expect(within(menu).getByRole('menuitem', { name: 'Iniciar' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Finalizar' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitem', { name: 'Motivo del bloqueo' })).toBeNull()
    cleanup()

    const blocked = renderCard({ state: 'Bloqueada' })
    menu = openMenu(blocked.card())
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Desbloquear' }))
    expect(blocked.onIntent).toHaveBeenCalledWith({ kind: 'unblock-task', taskPath: PATH })
  })

  it('saves the block note', () => {
    const { onIntent, card } = renderCard({ state: 'Bloqueada', blockNote: 'Viejo' })
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: 'Motivo del bloqueo' }))
    const dialog = screen.getByRole('dialog', { name: 'Motivo del bloqueo' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Esperando la librería' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'set-block-note', taskPath: PATH, note: 'Esperando la librería' })
  })

  it('duplicates, edits the note and comments', () => {
    const { onIntent, card, onEditSource, onComment } = renderCard()
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: 'Duplicar' }))
    expect(onIntent).toHaveBeenCalledWith({ kind: 'duplicate-task', taskPath: PATH })
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: 'Editar nota' }))
    expect(onEditSource).toHaveBeenCalledTimes(1)
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: 'Agregar comentario' }))
    expect(onComment).toHaveBeenCalledTimes(1)
  })

  it('cancels and deletes after the leaving animation', async () => {
    vi.useFakeTimers()
    const { onIntent, card } = renderCard()
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: /Desestimar/ }))
    expect(onIntent).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'cancel-task', taskPath: PATH })
    cleanup()

    const other = renderCard()
    fireEvent.click(within(openMenu(other.card())).getByRole('menuitem', { name: 'Eliminar' }))
    await act(async () => {
      vi.advanceTimersByTime(320)
    })
    expect(other.onIntent).toHaveBeenCalledWith({ kind: 'delete-task', taskPath: PATH })
  })

  it('opens the priority picker and the card popovers from the menu', () => {
    const { card } = renderCard()
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: /Prioridad/ }))
    expect(screen.getByRole('menu', { name: 'Prioridad de Tarea' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Prioridad de Tarea' }), { key: 'Escape' })
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: /Estimar tiempo/ }))
    expect(screen.getByRole('dialog', { name: 'Tiempo de la tarea' })).toBeTruthy()
  })
})

describe('TaskCard rename and open', () => {
  it('opens the ticket editor with a double click on the detail', () => {
    const { onEditSource, card } = renderCard({ preview: 'Detalle del ticket con comentarios' })
    fireEvent.doubleClick(within(card()).getByText('Detalle del ticket con comentarios'))
    expect(onEditSource).toHaveBeenCalledTimes(1)
  })

  it('opens the ticket editor with a double click and shows the whole title on hover', () => {
    vi.useFakeTimers()
    const { onIntent, onOpenTask, onEditSource, card } = renderCard()
    const title = within(card()).getByRole('button', { name: 'Tarea' })
    expect(title.getAttribute('title')).toBe('Tarea')
    fireEvent.click(title, { detail: 1 })
    fireEvent.click(title, { detail: 2 })
    fireEvent.doubleClick(title)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onOpenTask).not.toHaveBeenCalled()
    expect(onEditSource).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'Nuevo título' })).toBeNull()
    expect(onIntent).not.toHaveBeenCalled()
  })

  it('renames from the menu and saves with Enter', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: /Renombrar/ }))
    const input = screen.getByRole('textbox', { name: 'Nuevo título' })
    fireEvent.change(input, { target: { value: '  Tarea renombrada ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onIntent).toHaveBeenCalledWith({ kind: 'rename-task', taskPath: PATH, title: 'Tarea renombrada' })
  })

  it('renames from the menu and cancels with Escape', () => {
    const { onIntent, card } = renderCard()
    fireEvent.click(within(openMenu(card())).getByRole('menuitem', { name: /Renombrar/ }))
    const input = screen.getByRole('textbox', { name: 'Nuevo título' })
    fireEvent.change(input, { target: { value: 'Otro' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Nuevo título' })).toBeNull()
    expect(onIntent).not.toHaveBeenCalled()
  })

  it('opens the ticket after a single mouse click, at once with a key', () => {
    vi.useFakeTimers()
    const { onOpenTask, card } = renderCard()
    const title = within(card()).getByRole('button', { name: 'Tarea' })
    fireEvent.click(title, { detail: 1 })
    expect(onOpenTask).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(220)
    })
    expect(onOpenTask).toHaveBeenCalledTimes(1)
    fireEvent.click(title, { detail: 0 })
    expect(onOpenTask).toHaveBeenCalledTimes(2)
  })
})

describe('TaskCard subtasks', () => {
  const subtasks = [
    task('Sub uno', { parentTaskName: 'Tarea', state: 'Finalizada', order: 1 }),
    task('Sub dos', { parentTaskName: 'Tarea', order: 2 }),
  ]

  it('toggles, opens, deletes and adds subtasks', () => {
    const { onIntent, onOpenTask, card } = renderCard({ subtaskDone: 1, subtaskTotal: 2 }, subtasks)
    const toggle = within(card()).getByRole('button', { name: 'Subtareas: 1 de 2 completas' })
    expect(toggle.textContent).toContain('1/2')
    fireEvent.click(toggle)
    expect(card().getAttribute('draggable')).toBe('false')
    const second = within(card()).getByRole('checkbox', { name: 'Sub dos' })
    expect(within(card()).getByRole('checkbox', { name: 'Sub uno' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(second)
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'toggle-subtask', taskPath: 'tm/default/Sub dos.md' })
    fireEvent.click(within(card()).getByRole('button', { name: 'Sub dos' }))
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'tm/default/Sub dos.md' }))
    fireEvent.click(within(card()).getByRole('button', { name: 'Eliminar subtarea Sub uno' }))
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'delete-task', taskPath: 'tm/default/Sub uno.md' })
    const input = within(card()).getByRole('textbox', { name: 'Agregar subtarea' })
    fireEvent.change(input, { target: { value: 'Sub tres' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'add-subtask', taskPath: PATH, title: 'Sub tres' })
  })

  it('keeps subtasks out of the columns', () => {
    renderCard({ subtaskDone: 1, subtaskTotal: 2 }, subtasks)
    expect(screen.queryByRole('article', { name: 'Sub dos' })).toBeNull()
  })
})

describe('TaskCard on touch', () => {
  it('renders the kebab and the subtasks button without a hover', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList)
    const { card, view } = renderCard()
    expect(view.container.querySelector('.tm-kanban')?.classList.contains('tm-coarse')).toBe(true)
    expect(within(card()).getByRole('button', { name: 'Opciones de la tarea' })).toBeTruthy()
    expect(within(card()).getByRole('button', { name: 'Agregar subtareas' })).toBeTruthy()
    expect(card().getAttribute('draggable')).toBe('false')
  })

  it('opens the ticket at once with a tap', () => {
    const { onOpenTask, card } = renderCard()
    const title = within(card()).getByRole('button', { name: 'Tarea' })
    fireEvent.pointerDown(title, { pointerType: 'touch' })
    fireEvent.click(title, { detail: 1 })
    expect(onOpenTask).toHaveBeenCalledTimes(1)
  })
})

describe('TaskCard highlight', () => {
  it('flashes the card the shell points at', () => {
    const { card } = renderCard({}, [], { flashTaskId: 'id-Tarea' })
    expect(card().classList.contains('is-flash')).toBe(true)
  })
})
