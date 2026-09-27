// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeAgenda, HomeFocus, HomeNotes, HomeRecent } from '../../../../services/home/homeTypes'
import { HomeAgendaCard } from './HomeAgendaCard'
import { HomeNotesCard } from './HomeNotesCard'
import { HomePomodoro } from './HomePomodoro'
import { HomeRecentCard } from './HomeRecentCard'

const callBackend = vi.hoisted(() => vi.fn())
vi.mock('../../../../services/transport', () => ({ callBackend, subscribeBackend: vi.fn(async () => () => undefined) }))

const library = { id: 'lib-1', name: 'gaia', path: 'C:/gaia' } as NotiaLibrary

const agenda: HomeAgenda = {
  days: [
    { date: '2026-09-26', weekday: 'Sáb', day: 26, label: 'sábado 26', isToday: true, hasEvents: false },
    { date: '2026-09-28', weekday: 'Lun', day: 28, label: 'lunes 28', isToday: false, hasEvents: true },
    { date: '2026-09-30', weekday: 'Mié', day: 30, label: 'miércoles 30', isToday: false, hasEvents: true },
  ],
  events: [
    { id: 'e1', date: '2026-09-28', dayLabel: 'Lun 28', time: '09:00', range: '09:00 – 09:45', title: 'Reunión de equipo', priority: 'medium', priorityLabel: 'Media' },
    { id: 'e2', date: '2026-09-30', dayLabel: 'Mié 30', time: '14:00', range: '14:00 – 15:15', title: 'Revisión de proyecto', priority: 'high', priorityLabel: 'Alta' },
  ],
}

const idleTimer = {
  phase: 'work',
  runState: 'idle',
  remainingSeconds: 1500,
  endTimestamp: null,
  completedWorkCycles: 0,
  selectedTaskPath: null,
  isDeviationActive: false,
  deviationStartedAt: null,
  deviationBaseRemainingSeconds: 0,
  phaseDeviationSeconds: 0,
  durations: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15 },
}

describe('Home cards', () => {
  beforeEach(() => {
    callBackend.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the next seven days and only the events of a chosen day', () => {
    render(<HomeAgendaCard card={{ data: agenda }} onOpenAgenda={vi.fn()} />)
    expect(screen.getByText('Próximos 7 días')).toBeTruthy()
    expect(screen.getByText('2 eventos')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'miércoles 30, con eventos' }))
    expect(screen.getByText('Eventos del miércoles 30')).toBeTruthy()
    expect(screen.queryByText('Reunión de equipo')).toBeNull()
    expect(screen.getByText('Revisión de proyecto')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'sábado 26, hoy' }))
    expect(screen.getByText('Día libre. Agendá algo desde el calendario.')).toBeTruthy()
  })

  it('shows why a card could not be read instead of its content', () => {
    render(<HomeAgendaCard card={{ error: 'La Agenda no se pudo abrir.' }} onOpenAgenda={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('La Agenda no se pudo abrir.')
    expect(screen.queryByText('Próximos 7 días')).toBeNull()
  })

  it('sends notes to the Agenda and reads the dashboard again', async () => {
    const notes: HomeNotes = { items: [{ id: 'n1', text: 'Responder mails', done: false }], pending: 1 }
    const onChanged = vi.fn(async () => undefined)
    callBackend.mockResolvedValue({})
    render(<HomeNotesCard card={{ data: notes }} library={library} onChanged={onChanged} />)
    expect(screen.getByText('1 pendiente')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Anotá algo para hoy…'), { target: { value: '  Preparar la reunión  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(callBackend).toHaveBeenCalledWith('agenda_apply_mutation', expect.objectContaining({
      payload: expect.objectContaining({ mutation: { type: 'addNote', text: 'Preparar la reunión' } }),
    }))
    expect((screen.getByPlaceholderText('Anotá algo para hoy…') as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByLabelText('Responder mails'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2))
    expect(callBackend).toHaveBeenLastCalledWith('agenda_apply_mutation', expect.objectContaining({
      payload: expect.objectContaining({ mutation: { type: 'setNoteDone', id: 'n1', done: true } }),
    }))
  })

  it('keeps the draft and shows the error when the Agenda rejects a note', async () => {
    const onChanged = vi.fn(async () => undefined)
    callBackend.mockRejectedValue({ message: 'La nota está vacía.' })
    render(<HomeNotesCard card={{ data: { items: [], pending: 0 } }} library={library} onChanged={onChanged} />)
    fireEvent.change(screen.getByPlaceholderText('Anotá algo para hoy…'), { target: { value: 'Algo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('La nota está vacía.')
    expect((screen.getByPlaceholderText('Anotá algo para hoy…') as HTMLInputElement).value).toBe('Algo')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('starts the Pomodoro on the focus ticket when the timer has none chosen', async () => {
    const focus: HomeFocus = { filePath: 'task-manager/Performance.md', title: 'Performance', selected: false }
    callBackend.mockImplementation(async (_command: string, args: { payload: { action: { kind: string } } }) => {
      const kind = args.payload.action.kind
      const runState = kind === 'start' ? 'running' : 'idle'
      return { state: { ...idleTimer, runState, endTimestamp: kind === 'start' ? Date.now() + 1_500_000 : null }, changed: false }
    })
    render(<HomePomodoro library={library} focus={focus} />)
    expect(await screen.findByText('Foco: Performance')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Iniciar' })) })
    await screen.findByRole('button', { name: 'Pausar' })
    const actions = callBackend.mock.calls.map((call) => (call[1] as { payload: { action: unknown } }).payload.action)
    expect(actions).toEqual([
      { kind: 'read' },
      { kind: 'select-task', taskPath: 'task-manager/Performance.md' },
      { kind: 'start' },
    ])
  })

  it('opens each recent item the way it was left', () => {
    const recent: HomeRecent = {
      items: [
        { kind: 'chat', title: 'Pendientes con PE', meta: 'Chat · agente Task Manager', when: 'Hoy', path: 'C:/gaia/chat/pe.md', agentFile: 'task-manager.md' },
        { kind: 'meeting', title: 'Transcripción de las 18:32', meta: 'Meeting · lista para pasar por IA', when: 'Ayer' },
      ],
      folders: [{ name: 'Facultad', path: 'C:/gaia/Facultad' }],
    }
    const onOpenItem = vi.fn()
    const onOpenFolder = vi.fn()
    render(<HomeRecentCard recent={recent} onOpenHistory={vi.fn()} onOpenItem={onOpenItem} onOpenFolder={onOpenFolder} />)
    fireEvent.click(screen.getByText('Pendientes con PE'))
    expect(onOpenItem).toHaveBeenCalledWith(recent.items[0])
    fireEvent.click(screen.getByRole('button', { name: 'Facultad' }))
    expect(onOpenFolder).toHaveBeenCalledWith(recent.folders[0])
  })
})
