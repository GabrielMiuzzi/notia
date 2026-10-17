// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PomodoroPanel } from './PomodoroPanel'
import type { PomodoroPanelProps } from './PomodoroPanel'
import type { PomodoroAction, PomodoroPreset, PomodoroToday } from '../../services/taskManagerService'
import type { Board, PomodoroState, TaskItem } from '../../types/taskManagerTypes'

const PLAN: Board['plan'] = {
  dayStartMinutes: 540,
  dayEndMinutes: 1080,
  workDays: [true, true, true, true, true, false, false],
  sprintWeeks: 2,
  sprintStartWeekday: 0,
  divisionsPerYear: 4,
  divisionPrefix: 'Q',
  yearStartMonth: 1,
}

function board(name: string, inProgress: number, pending: number): Board {
  return {
    name,
    color: '#4fd1c5',
    activityHoursPerDay: 8,
    plan: PLAN,
    members: [],
    projects: [],
    counts: { active: inProgress + pending, inProgress, pending },
    nextMemberColor: '#6c8eff',
    nextProjectColor: '#6c8eff',
  }
}

function task(title: string, overrides: Partial<TaskItem> = {}): TaskItem {
  const filePath = `task-mannager/${overrides.board ?? 'default'}/${title}.md`
  return {
    filePath,
    path: filePath,
    fileName: title,
    title,
    detail: '',
    state: 'En progreso',
    startDate: '',
    endDate: '',
    dynamicEndDate: false,
    board: 'default',
    group: 'Sprint Actual',
    priority: 'Alta',
    dedicatedHours: 0,
    estimatedHours: 0,
    deviationHours: 0,
    parentTaskName: '',
    order: 0,
    preview: '',
    ...overrides,
  }
}

function pomodoro(overrides: Partial<PomodoroState> = {}): PomodoroState {
  return {
    phase: 'work',
    runState: 'idle',
    remainingSeconds: 25 * 60,
    endTimestamp: null,
    completedWorkCycles: 0,
    selectedTaskPath: null,
    isDeviationActive: false,
    deviationStartedAt: null,
    deviationBaseRemainingSeconds: 0,
    phaseDeviationSeconds: 0,
    durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cycles: 4 },
    ...overrides,
  }
}

const PRESETS: PomodoroPreset[] = [
  {
    name: 'standard',
    label: 'Estándar · 25/5',
    description: 'Para tareas moderadas, programación y estudio: mantener un ritmo constante sin quemarse.',
    durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, cycles: 4 },
    active: true,
  },
  {
    name: 'sprint',
    label: 'Sprint · 50/10',
    description: 'Trabajo profundo con bloques largos.',
    durations: { workMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, cycles: 4 },
    active: false,
  },
]

const TODAY: PomodoroToday = {
  count: 5,
  focusMinutes: 125,
  byHour: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : hour === 10 ? 3 : hour === 11 ? 1 : 0)),
  currentHour: 11,
}

const BOARDS = [board('default', 2, 1), board('facultad', 0, 0)]
const TASKS = [
  task('Reconstrucción de API'),
  task('Conciliación con Rapipago', { group: 'En Revisión', priority: 'Media' }),
  task('Software extraccion', { state: 'Pendiente', group: 'A Refinar', priority: 'Urgente' }),
  task('Bloqueada', { state: 'Bloqueada' }),
]

function renderPanel(props: Partial<PomodoroPanelProps> = {}) {
  const onAction = vi.fn<(action: PomodoroAction) => Promise<void>>(async () => {})
  const onNotify = vi.fn()
  const view = render(
    <PomodoroPanel
      state={pomodoro()}
      presets={PRESETS}
      today={TODAY}
      boards={BOARDS}
      tasks={TASKS}
      onAction={onAction}
      onNotify={onNotify}
      {...props}
    />,
  )
  return { ...view, onAction, onNotify }
}

const linkedCard = () => screen.getByRole('region', { name: 'Tarea vinculada' })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('PomodoroPanel', () => {
  it('shows the timer as the backend reports it', () => {
    const { container } = renderPanel({ state: pomodoro({ completedWorkCycles: 5 }) })
    const timer = screen.getByRole('region', { name: 'Temporizador' })
    expect(within(timer).getByText('25:00')).toBeDefined()
    expect(within(timer).getByText('Preparado')).toBeDefined()
    expect(within(timer).getByText('1 / 4')).toBeDefined()
    expect(container.querySelectorAll('.tm-pomodoro-cycle-dot').length).toBe(4)
    expect(container.querySelectorAll('.tm-pomodoro-cycle-dot.is-done').length).toBe(1)
    expect(screen.getByRole('button', { name: 'Trabajo', pressed: true })).toBeDefined()
  })

  it('maps the play button to start, pause and resume', () => {
    const idle = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }))
    expect(idle.onAction).toHaveBeenLastCalledWith({ kind: 'start' })
    cleanup()

    const running = renderPanel({ state: pomodoro({ runState: 'running', endTimestamp: Date.now() + 60_000 }) })
    expect(screen.getByText('En foco')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(running.onAction).toHaveBeenLastCalledWith({ kind: 'pause' })
    cleanup()

    const paused = renderPanel({ state: pomodoro({ runState: 'paused', remainingSeconds: 240, phase: 'short-break' }) })
    expect(screen.getByText('En pausa')).toBeDefined()
    expect(screen.getByText('04:00')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }))
    expect(paused.onAction).toHaveBeenLastCalledWith({ kind: 'resume' })
  })

  it('sends reset, skip and select-phase', () => {
    const { onAction } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }))
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'reset' })
    fireEvent.click(screen.getByRole('button', { name: 'Saltar al siguiente' }))
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'skip' })
    fireEvent.click(screen.getByRole('button', { name: 'Descanso largo' }))
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'select-phase', phase: 'long-break' })
  })

  it('starts with Space and resets with R, but not while typing or with modifiers', () => {
    const { onAction } = renderPanel()
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'start' })
    fireEvent.keyDown(document.body, { key: 'r', code: 'KeyR' })
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'reset' })
    expect(onAction).toHaveBeenCalledTimes(2)

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: ' ', code: 'Space' })
    fireEvent.keyDown(input, { key: 'r', code: 'KeyR' })
    fireEvent.keyDown(document.body, { key: 'r', code: 'KeyR', ctrlKey: true })
    expect(onAction).toHaveBeenCalledTimes(2)
    input.remove()
  })

  it('pauses with Space while running', () => {
    const { onAction } = renderPanel({ state: pomodoro({ runState: 'running', endTimestamp: Date.now() + 60_000 }) })
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'pause' })
  })

  it('asks the backend to close the phase when the countdown reaches zero', () => {
    vi.useFakeTimers()
    const endTimestamp = Date.now() + 2_000
    const { onAction } = renderPanel({ state: pomodoro({ runState: 'running', endTimestamp }) })
    expect(onAction).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(onAction).toHaveBeenCalledWith({ kind: 'tick' })
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(onAction.mock.calls.filter(([action]) => action.kind === 'tick').length).toBe(1)
  })

  it('lists the tasks of the board grouped by state and links one', () => {
    const { onAction } = renderPanel()
    const card = linkedCard()
    expect(within(card).getByText('Ninguna tarea vinculada')).toBeDefined()
    expect(within(card).getByText('En progreso')).toBeDefined()
    expect(within(card).getByText('Pendientes')).toBeDefined()
    expect(within(card).queryByText('Bloqueada')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: /Software extraccion/ }))
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'select-task', taskPath: 'task-mannager/default/Software extraccion.md' })
  })

  it('shows the linked task and unlinks it', () => {
    const { onAction } = renderPanel({ state: pomodoro({ selectedTaskPath: 'task-mannager/default/Software extraccion.md' }) })
    const card = linkedCard()
    expect(within(card).getByText('El foco de esta sesión se registra en esta tarea.')).toBeDefined()
    expect(within(card).getByText(/default · A Refinar/)).toBeDefined()
    expect(within(card).getByRole('button', { name: /Software extraccion.*Vinculada/, pressed: true })).toBeDefined()
    fireEvent.click(within(card).getByRole('button', { name: 'Desvincular' }))
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'select-task', taskPath: null })
  })

  it('switches the board from «Operar sobre» and keeps the linked task', () => {
    renderPanel({ state: pomodoro({ selectedTaskPath: 'task-mannager/default/Reconstrucción de API.md' }) })
    const card = linkedCard()
    fireEvent.click(within(card).getByRole('button', { name: 'Tablero: default. Cambiar' }))
    const dialog = screen.getByRole('dialog', { name: 'Elegir tablero' })
    expect(within(dialog).getByText('2 en progreso · 1 pendientes')).toBeDefined()
    expect(within(dialog).getByText('Sin tareas activas')).toBeDefined()
    expect(within(dialog).getByRole('radio', { name: /default/ }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(within(dialog).getByRole('radio', { name: /facultad/ }))
    expect(screen.queryByRole('dialog', { name: 'Elegir tablero' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Tablero: facultad. Cambiar' })).toBeDefined()
    expect(within(card).getByText('Sin tareas activas en «facultad»')).toBeDefined()
    expect(within(card).getByText('Reconstrucción de API')).toBeDefined()
    expect(within(card).getByText(/default · Sprint Actual/)).toBeDefined()
  })

  it('closes the board menu with Escape', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Tablero: default. Cambiar' }))
    const dialog = screen.getByRole('dialog', { name: 'Elegir tablero' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Elegir tablero' })).toBeNull()
  })

  it('applies a preset from the menu', () => {
    const { onAction } = renderPanel()
    const durations = screen.getByRole('region', { name: 'Duraciones' })
    expect(within(durations).getByText(PRESETS[0].description)).toBeDefined()
    fireEvent.click(within(durations).getByRole('button', { name: /Estándar · 25\/5/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Sprint · 50\/10/ }))
    expect(onAction).toHaveBeenLastCalledWith({ kind: 'set-durations', durations: PRESETS[1].durations })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('labels custom durations as Personalizado', () => {
    renderPanel({ presets: PRESETS.map((preset) => ({ ...preset, active: false })) })
    expect(screen.getByRole('button', { name: /Personalizado/ })).toBeDefined()
  })

  it('changes durations with the steppers inside their limits', () => {
    const { onAction } = renderPanel({
      state: pomodoro({ durations: { workMinutes: 90, shortBreakMinutes: 5, longBreakMinutes: 15, cycles: 2 } }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Restar Trabajo' }))
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'set-durations',
      durations: { workMinutes: 85, shortBreakMinutes: 5, longBreakMinutes: 15, cycles: 2 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sumar Descanso corto' }))
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'set-durations',
      durations: { workMinutes: 90, shortBreakMinutes: 6, longBreakMinutes: 15, cycles: 2 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sumar Descanso largo' }))
    expect(onAction).toHaveBeenLastCalledWith({
      kind: 'set-durations',
      durations: { workMinutes: 90, shortBreakMinutes: 5, longBreakMinutes: 20, cycles: 2 },
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sumar Trabajo' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restar Ciclos' }).disabled).toBe(true)
    expect(screen.getByText('por serie')).toBeDefined()
  })

  it('paints the day heatmap from the backend counts', () => {
    const { container } = renderPanel()
    const log = screen.getByRole('region', { name: 'Registros del día' })
    expect(within(log).getByText('5')).toBeDefined()
    expect(within(log).getByText('125')).toBeDefined()
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.tm-pomodoro-heat-cell'))
    expect(cells.length).toBe(24)
    expect(cells[9].dataset.level).toBe('1')
    expect(cells[10].dataset.level).toBe('2')
    expect(cells[0].dataset.level).toBe('0')
    expect(cells[11].className).toContain('is-now')
    expect(within(log).getByRole('listitem', { name: '10:00 · 3 pomodoros' })).toBeDefined()
    expect(within(log).getByText('09')).toBeDefined()
    expect(within(log).queryByText(/Todavía no registraste/)).toBeNull()
  })

  it('shows the empty note without pomodoros and the published note without a log', () => {
    renderPanel({ today: { count: 0, focusMinutes: 0, byHour: Array.from({ length: 24 }, () => 0), currentHour: 8 } })
    expect(screen.getByText(/Todavía no registraste pomodoros hoy/)).toBeDefined()
    cleanup()

    const { container } = renderPanel({ today: null })
    expect(screen.getByText('Los registros del día no se muestran en el tablero publicado.')).toBeDefined()
    expect(container.querySelectorAll('.tm-pomodoro-heat-cell').length).toBe(0)
  })

  it('reports a failed action through onNotify', async () => {
    const onAction = vi.fn(async () => { throw new Error('Sin conexión con el host.') })
    const { onNotify } = renderPanel({ onAction })
    fireEvent.click(screen.getByRole('button', { name: 'Saltar al siguiente' }))
    await act(async () => {})
    expect(onNotify).toHaveBeenCalledWith('Sin conexión con el host.')
  })
})
