// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { callBackend } from '../../../../services/transport'
import { MeetingAiNotesPanel, MeetingMarkComposer } from './MeetingAiNotesPanel'
import { MeetingRecordingPanel } from './MeetingRecordingPanel'
import { useMeetingAiContext } from './useMeetingAiContext'
import type { MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

vi.mock('../../../../services/transport', () => ({
  callBackend: vi.fn(async () => null),
  subscribeBackend: vi.fn(async () => () => undefined),
  backendKind: () => 'local',
  backendSupports: () => true,
}))

const backend = vi.mocked(callBackend)

const snapshot: MeetingSnapshot = {
  id: 'meet-1',
  status: 'live',
  title: 'Reunión',
  dateLabel: '2 de octubre',
  durationMs: 768_000,
  sources: { microphone: true, system: false },
  lines: [{ id: 'l1', startMs: 700_000, endMs: 705_000, text: 'Sentí que ya había aprendido.', question: false }],
  speakers: [],
  turns: [],
  totalTurns: 0,
  notes: '',
  marks: [{ id: 'mark-1', atMs: 700_000, label: 'Motivo de renuncia: repreguntar al final.' }],
  answers: [],
  liveAnswers: true,
  aiNotes: {
    enabled: true,
    running: false,
    nextPassAt: Date.now() + 42_000,
    objective: 'Conocer la formación de la candidata.',
    decisions: ['Repasar primero formación y experiencia.'],
    openQuestions: ['Qué busca aprender.', 'Cómo resolvía los atrasos.'],
    topics: [
      { title: 'Motivo de renuncia', atMs: 700_000, items: ['Ya aprendió lo que podía.'], current: true },
      { title: 'Presentación', atMs: 0, items: ['Etapa final de la selección.'], current: false },
    ],
    tasks: [
      { id: 'note-task-1', text: 'Pedirle un ejemplo concreto de un atraso.', owner: 'Hablante 1', ownerInitials: 'H1', due: '', sent: false },
      { id: 'note-task-2', text: 'Enviar la propuesta.', owner: '', ownerInitials: '', due: 'viernes', sent: true },
    ],
  },
  insights: { keyPoints: [], tasks: [], corrected: false },
  suggestedQuestions: [],
  contextText: '',
}

const actions = () => ({
  libraryId: 'lib-1',
  onToggleAiNotes: vi.fn(),
  onCallNotesAgent: vi.fn(),
  onAddOwnNote: vi.fn(async () => true),
  onRemoveMark: vi.fn(),
  onError: vi.fn(),
})

describe('Meeting AI notes', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the notes by kind, the countdown to the next pass and calls the agent', () => {
    const notesActions = actions()
    const onShowMoment = vi.fn()
    render(<MeetingAiNotesPanel snapshot={snapshot} actions={notesActions} canAddNote onShowMoment={onShowMoment} />)
    expect(screen.getByText('Conocer la formación de la candidata.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Preguntas abiertas' })).toBeTruthy()
    expect(screen.getByText(/Próxima actualización en/).textContent).toMatch(/0:4\d/)
    const jumps = screen.getByRole('navigation', { name: 'Secciones de las notas' })
    expect(within(jumps).getByRole('button', { name: /Preguntas/ }).textContent).toBe('Preguntas 2')
    const topics = screen.getByRole('region', { name: 'Notas de la reunión' })
    expect(within(topics).getAllByText(/Motivo de renuncia|Presentación/).map((node) => node.textContent)).toEqual(['Motivo de renuncia', 'Presentación'])
    expect(within(topics).getByText('En curso')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /11:40 · Motivo de renuncia/ }))
    expect(onShowMoment).toHaveBeenCalledWith(700_000)
    fireEvent.click(screen.getByRole('button', { name: 'Quitar la marca 11:40' }))
    expect(notesActions.onRemoveMark).toHaveBeenCalledWith('mark-1')
    fireEvent.click(screen.getByRole('button', { name: /Llamar agente/ }))
    expect(notesActions.onCallNotesAgent).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('switch', { name: 'Notas IA' }))
    expect(notesActions.onToggleAiNotes).toHaveBeenCalledWith(false)
  })

  it('says the agent is taking notes and does not call it twice', () => {
    const notesActions = actions()
    render(
      <MeetingAiNotesPanel
        snapshot={{ ...snapshot, aiNotes: { ...snapshot.aiNotes, running: true, error: 'sin conexión' } }}
        actions={notesActions}
        canAddNote
        onShowMoment={vi.fn()}
      />,
    )
    expect(screen.getByText('El agente está tomando notas…')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Llamando…/ }))
    expect(notesActions.onCallNotesAgent).not.toHaveBeenCalled()
  })

  it('adds the person’s own note and turned off explains what it does', async () => {
    const notesActions = actions()
    render(
      <MeetingAiNotesPanel
        snapshot={{ ...snapshot, aiNotes: { ...snapshot.aiNotes, enabled: false } }}
        actions={notesActions}
        canAddNote
        onShowMoment={vi.fn()}
      />,
    )
    expect(screen.getByText(/Activá Notas IA y Munin arma el resumen/)).toBeTruthy()
    const input = screen.getByLabelText('Agregar una nota propia') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Preguntar por el sueldo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar nota' }))
    await waitFor(() => expect(input.value).toBe(''))
    expect(notesActions.onAddOwnNote).toHaveBeenCalledWith('Preguntar por el sueldo')
  })

  it('sends a task to the only board, or lets the person choose among several', async () => {
    backend.mockImplementation(async (command: string) => {
      if (command === 'meeting_task_boards') return ['Trabajo'] as never
      if (command === 'meeting_send_tasks') return { created: 1 } as never
      return null as never
    })
    render(<MeetingAiNotesPanel snapshot={snapshot} actions={actions()} canAddNote onShowMoment={vi.fn()} />)
    expect(screen.getByText('H1')).toBeTruthy()
    expect(screen.getByText('Sin fecha')).toBeTruthy()
    expect(screen.getByText('En Task Manager')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Al Task Manager' }))
    await waitFor(() => expect(backend).toHaveBeenCalledWith('meeting_send_tasks', {
      payload: { meetingId: 'meet-1', libraryId: 'lib-1', board: 'Trabajo', taskIds: ['note-task-1'] },
    }))
    cleanup()

    backend.mockImplementation(async (command: string) => (command === 'meeting_task_boards' ? ['Trabajo', 'Casa'] as never : { created: 1 } as never))
    render(<MeetingAiNotesPanel snapshot={snapshot} actions={actions()} canAddNote onShowMoment={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Al Task Manager' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Casa' }))
    await waitFor(() => expect(backend).toHaveBeenCalledWith('meeting_send_tasks', {
      payload: { meetingId: 'meet-1', libraryId: 'lib-1', board: 'Casa', taskIds: ['note-task-1'] },
    }))
  })

  it('switches the desktop assistant between Notas IA and the live answers', () => {
    render(
      <MeetingRecordingPanel
        snapshot={snapshot}
        partialText=""
        levels={{ microphone: [], system: [] }}
        onToggleLiveAnswers={vi.fn()}
        onRegenerateAnswer={vi.fn()}
        onPinAnswer={vi.fn()}
        notesActions={actions()}
        canAddNote
      />,
    )
    const notesTab = screen.getByRole('tab', { name: /Notas IA/ })
    expect(notesTab.getAttribute('aria-selected')).toBe('true')
    expect(notesTab.textContent).toBe('Notas IA2')
    expect(screen.getByRole('tab', { name: /Respuestas en vivo/ }).textContent).toContain('activas')
    fireEvent.keyDown(notesTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tabpanel').textContent).toContain('Cuando alguien haga una pregunta')
  })

  it('writes a mark of the minute it was opened, saved with Enter and closed with Esc', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(<MeetingMarkComposer atMs={768_000} onSave={onSave} onCancel={onCancel} />)
    expect(screen.getByRole('dialog', { name: 'Nueva marca' }).textContent).toContain('12:48')
    const field = screen.getByLabelText('¿Qué querés recordar?')
    fireEvent.change(field, { target: { value: 'Buena respuesta' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('Buena respuesta')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('loads the folders and contexts and starts from the whole library without the sensitive ones', async () => {
    backend.mockImplementation(async () => ({
      folders: [{ path: 'Facultad', noteCount: 24 }],
      contexts: [
        { tag: '#Personal', label: 'Personal', color: '#6FCF97', locked: false, selectedByDefault: true },
        { tag: '#Confidencial', label: 'Confidencial', color: '#FF6B6B', locked: true, selectedByDefault: false },
        { tag: 'sin-contexto', label: 'Sin contexto', locked: false, selectedByDefault: true },
      ],
    }) as never)
    const { result } = renderHook(() => useMeetingAiContext({ id: 'lib-1', name: 'gaia' }))
    await waitFor(() => expect(result.current.state.options).not.toBeNull())
    expect(backend).toHaveBeenCalledWith('meeting_ai_context_options', { payload: { libraryId: 'lib-1' } })
    expect(result.current.aiContext).toEqual({ libraryId: 'lib-1', folder: null, contexts: ['#Personal', 'sin-contexto'] })
    act(() => result.current.state.toggleContext('#Confidencial'))
    expect(result.current.aiContext?.contexts).toEqual(['#Personal', 'sin-contexto', '#Confidencial'])
    act(() => result.current.state.setWholeLibrary(false))
    expect(result.current.aiContext).toEqual({ libraryId: 'lib-1', folder: 'Facultad', contexts: null })
  })
})
