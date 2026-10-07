// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { callBackend } from '../../../../services/transport'
import { MeetingCompletedPanel } from './MeetingCompletedPanel'
import { MeetingPhoneCompleted } from './MeetingPhoneCompleted'
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
  status: 'completed',
  title: 'Reunión',
  dateLabel: '2 de octubre',
  durationMs: 1_112_000,
  sources: { microphone: true, system: false },
  lines: [],
  speakers: [
    { id: 's1', name: 'Hablante 1', initials: 'H1', talkMs: 678_000, sharePercent: 61, colorIndex: 0, turnCount: 14, longestTurnMs: 102_000, averageTurnMs: 48_000 },
    { id: 's2', name: 'Hablante 2', initials: 'H2', talkMs: 434_000, sharePercent: 39, colorIndex: 1, turnCount: 12, longestTurnMs: 71_000, averageTurnMs: 36_000 },
  ],
  talkTimeline: [
    { speakerId: 's1', startMs: 0, endMs: 24_000 },
    { speakerId: 's2', startMs: 24_000, endMs: 31_000 },
    { speakerId: 's1', startMs: 31_000, endMs: 160_000 },
  ],
  turns: [
    { id: 't1', speakerId: 's1', startMs: 0, endMs: 24_000, text: 'Bien, buenas.' },
    { id: 't2', speakerId: 's2', startMs: 24_000, endMs: 31_000, text: 'Llegué bien.' },
    { id: 't3', speakerId: 's1', startMs: 31_000, endMs: 160_000, text: '¿Cómo se llamaba el puesto?' },
  ],
  totalTurns: 3,
  notes: '',
  marks: [],
  answers: [],
  liveAnswers: false,
  aiNotes: {
    enabled: true,
    running: false,
    objective: 'Conocer a la candidata.',
    decisions: ['Repasar la formación primero.'],
    openQuestions: [],
    topics: [{ title: 'Puesto anterior', atMs: 31_000, items: ['Coordinaba con obra.'], current: false }],
    tasks: [],
  },
  insights: { keyPoints: [], tasks: [], corrected: false },
  review: { cleaned: false, named: 0 },
  suggestedQuestions: [],
  contextText: '[00:00] Hablante 1: Bien, buenas.',
}

const noNotes = { ...snapshot.aiNotes, enabled: false, objective: '', decisions: [], topics: [] }

afterEach(() => {
  cleanup()
  backend.mockClear()
})

describe('Finished meeting', () => {
  it('shows the talk time of each speaker with the timeline', () => {
    render(<MeetingCompletedPanel snapshot={snapshot} filter={{ query: '', speakerId: null }} onFilterChange={vi.fn()} aiPreferences={{} as never} library={null} />)
    const talk = screen.getByRole('region', { name: 'Tiempo de habla' })
    expect(within(talk).getByText('18:32 en total · 2 hablantes')).toBeTruthy()
    expect(within(talk).getByText('14 intervenciones')).toBeTruthy()
    expect(within(talk).getByText('11:18')).toBeTruthy()
    expect(within(talk).getByText('1:42')).toBeTruthy()
    expect(within(talk).getByText('0:48')).toBeTruthy()
    expect(within(talk).getByRole('img', { name: 'Línea de tiempo de quién habló en cada momento' }).children).toHaveLength(3)
    expect(within(talk).getByRole('button', { name: /Unir hablantes/ })).toBeTruthy()
  })

  it('shows the notes first, regenerates them and has the AI in the other tab', async () => {
    render(<MeetingCompletedPanel snapshot={snapshot} filter={{ query: '', speakerId: null }} onFilterChange={vi.fn()} aiPreferences={{} as never} library={null} />)
    expect(screen.getByRole('tab', { name: 'Notas de la reunión' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Conocer a la candidata.')).toBeTruthy()
    expect(screen.getByText('Repasar la formación primero.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar' }))
    await waitFor(() => expect(backend).toHaveBeenCalledWith('meeting_call_notes_agent', expect.objectContaining({
      payload: expect.objectContaining({ meetingId: 'meet-1' }),
    })))
    fireEvent.click(screen.getByRole('tab', { name: 'Preguntar a la IA' }))
    expect(screen.getByRole('heading', { name: 'Pasar por IA' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Preguntale a la reunión' })).toBeTruthy()
  })

  it('jumps from a topic to its minute of the transcript, clearing the search', () => {
    const onFilterChange = vi.fn()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { rerender } = render(
      <MeetingCompletedPanel snapshot={snapshot} filter={{ query: 'viaje', speakerId: null }} onFilterChange={onFilterChange} aiPreferences={{} as never} library={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Puesto anterior, ir al minuto 00:31' }))
    expect(onFilterChange).toHaveBeenCalledWith({ query: '', speakerId: null })
    rerender(<MeetingCompletedPanel snapshot={snapshot} filter={{ query: '', speakerId: null }} onFilterChange={onFilterChange} aiPreferences={{} as never} library={null} />)
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(document.getElementById('meeting-turn-t3')?.getAttribute('data-highlight')).toBe('true')
  })

  it('has a notes tab on the phone with its own tools', () => {
    render(
      <MeetingPhoneCompleted
        snapshot={{ ...snapshot, aiNotes: noNotes }}
        filter={{ query: '', speakerId: null }}
        onFilterChange={vi.fn()}
        aiPreferences={{} as never}
        library={null}
        searchOpen={false}
        onCloseSearch={vi.fn()}
        isBusy={false}
        isSaving={false}
        onNewRecording={vi.fn()}
        onSaveNote={vi.fn()}
        onOpenNote={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Transcripción', 'Notas', 'IA'])
    fireEvent.click(screen.getByRole('tab', { name: 'Notas' }))
    expect(screen.getByText(/Todavía no hay notas de esta reunión/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar notas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Regenerar' })).toBeTruthy()
    // The note is saved from the notes tab too.
    expect(screen.getByRole('button', { name: /Guardar como nota/ })).toBeTruthy()
  })
})
