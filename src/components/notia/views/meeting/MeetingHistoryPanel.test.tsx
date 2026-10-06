// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { callBackend } from '../../../../services/transport'
import { MeetingHistoryPanel, MeetingPhoneHistory } from './MeetingHistoryPanel'
import { useMeetingHistory } from './useMeetingHistory'
import type { MeetingHistoryItem } from '../../../../services/meeting/meetingTypes'

vi.mock('../../../../services/transport', () => ({
  callBackend: vi.fn(),
  subscribeBackend: vi.fn(async () => () => undefined),
}))

const backend = vi.mocked(callBackend)

const items: MeetingHistoryItem[] = [
  {
    id: 'm1',
    title: 'Entrevista RR.HH. · Compras',
    group: 'HOY',
    timeLabel: '10:15',
    durationMs: 1_112_000,
    speakerCount: 2,
    pendingTasks: 2,
    context: { label: 'Laboral', color: '#6C8EFF' },
  },
  { id: 'm2', title: 'Daily del equipo', timeLabel: '09:30', durationMs: 845_000, speakerCount: 1, pendingTasks: 0 },
]

function Desktop({ libraryId }: { libraryId: string | null }) {
  const history = useMeetingHistory(libraryId, true)
  return <MeetingHistoryPanel history={history} hasLibrary={Boolean(libraryId)} />
}

describe('MeetingHistoryPanel', () => {
  beforeEach(() => {
    backend.mockReset()
    backend.mockImplementation(async (command: string) => (command === 'meeting_history' ? items : undefined))
  })
  afterEach(cleanup)

  it('lists the saved meetings with their group, length, speakers, context and pending tasks', async () => {
    render(<Desktop libraryId="l1" />)
    const first = await screen.findByRole('button', { name: /Entrevista RR\.HH\./ })
    expect(screen.getByText('HOY')).toBeTruthy()
    expect(first.textContent).toContain('10:15')
    expect(first.textContent).toContain('18:32')
    expect(first.textContent).toContain('2 hablantes')
    expect(first.textContent).toContain('Laboral')
    expect(first.textContent).toContain('2 tareas pendientes')
    const second = screen.getByRole('button', { name: /Daily del equipo/ })
    expect(second.textContent).toContain('1 hablante')
    expect(second.textContent).not.toContain('pendiente')
    expect(screen.getByRole('complementary', { name: 'Reuniones anteriores' }).textContent).toContain('2')
    expect(backend).toHaveBeenCalledWith('meeting_history', { payload: { libraryId: 'l1', query: '' } })
  })

  it('searches after a pause and opens a meeting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<Desktop libraryId="l1" />)
      await screen.findByRole('button', { name: /Daily del equipo/ })
      backend.mockImplementation(async (command: string) => (command === 'meeting_history' ? [] : undefined))
      fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar reuniones' }), { target: { value: 'presupuesto' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(300) })
      expect(await screen.findByText('Ninguna reunión coincide con la búsqueda.')).toBeTruthy()
      expect(backend).toHaveBeenCalledWith('meeting_history', { payload: { libraryId: 'l1', query: 'presupuesto' } })
    } finally {
      vi.useRealTimers()
    }
    backend.mockImplementation(async (command: string) => (command === 'meeting_history' ? items : undefined))
    cleanup()
    render(<Desktop libraryId="l1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Daily del equipo/ }))
    await waitFor(() => expect(backend).toHaveBeenCalledWith('meeting_open_saved', { payload: { libraryId: 'l1', meetingId: 'm2' } }))
  })

  it('asks for a library and tells what will appear when there is none yet', async () => {
    render(<Desktop libraryId={null} />)
    expect(screen.getByText('Abrí una biblioteca para ver sus reuniones.')).toBeTruthy()
    expect(backend).not.toHaveBeenCalled()
    cleanup()
    backend.mockImplementation(async () => [])
    render(<Desktop libraryId="l1" />)
    expect(await screen.findByText('Las reuniones que guardes como nota aparecen acá.')).toBeTruthy()
  })

  it('on a phone it is a screen with a button back to a new meeting', async () => {
    const onNewMeeting = vi.fn()
    function Phone() {
      const history = useMeetingHistory('l1', true)
      return <MeetingPhoneHistory history={history} hasLibrary onNewMeeting={onNewMeeting} />
    }
    render(<Phone />)
    expect(screen.getByRole('heading', { name: 'Reuniones' })).toBeTruthy()
    await screen.findByRole('button', { name: /Entrevista RR\.HH\./ })
    fireEvent.click(screen.getByRole('button', { name: 'Nueva reunión' }))
    expect(onNewMeeting).toHaveBeenCalled()
  })
})
