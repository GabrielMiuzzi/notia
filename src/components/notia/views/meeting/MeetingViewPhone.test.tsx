// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'

const narrow = vi.hoisted(() => ({ value: true }))
const backend = vi.hoisted(() => ({ snapshot: null as unknown }))

vi.mock('../../../../hooks/useNarrowContainer', () => ({ useNarrowContainer: () => narrow.value }))
vi.mock('../../../../services/transport', () => ({
  callBackend: vi.fn(async (command: string) => {
    if (command === 'get_speech_capabilities') {
      return {
        supported: true,
        platform: 'android',
        architecture: 'arm64',
        permission: 'granted',
        asrModelInstalled: true,
        diarizationModelInstalled: true,
        unavailableReason: null,
        systemAudioSupported: false,
      }
    }
    if (command === 'probe_speech_audio_input') return { supported: true, available: true, deviceLabel: null, sampleRate: 48_000, channels: 1, errorMessage: null }
    if (command === 'meeting_snapshot') return backend.snapshot
    if (command === 'speech_session_state') return { status: 'recording', elapsedMs: 768_000, hasSpeech: true }
    return null
  }),
  subscribeBackend: vi.fn(async () => () => undefined),
  backendKind: () => 'local',
  backendSupports: () => true,
}))

const { store } = await import('../../../../store')
const { NotiaActionsProvider } = await import('../../../../context/notiaActions/NotiaActionsContext')
const { MeetingView } = await import('../MeetingView')

const noop = () => undefined
const actions = new Proxy({}, { get: () => noop }) as never

function renderView() {
  return render(
    <Provider store={store}>
      <NotiaActionsProvider actions={actions}>
        <MeetingView />
      </NotiaActionsProvider>
    </Provider>,
  )
}

describe('Meeting view on a phone', () => {
  afterEach(() => {
    cleanup()
    narrow.value = true
    backend.snapshot = null
  })

  it('follows the phone boards when its own width is narrow', async () => {
    const { container } = renderView()
    expect(container.querySelector('.notia-meeting-view--phone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Iniciar grabación' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Subir archivo/ })).toBeTruthy()
    // Android records the microphone only; there is no computer audio to offer.
    await waitFor(() => expect(screen.getByRole('switch', { name: /micrófono/i })).toBeTruthy())
    expect(screen.queryByRole('switch', { name: /audio de la computadora/i })).toBeNull()
    expect(screen.queryByText('Ctrl')).toBeNull()
  })

  it('keeps the desktop layout when there is room', () => {
    narrow.value = false
    const { container } = renderView()
    expect(container.querySelector('.notia-meeting-view--phone')).toBeNull()
    expect(screen.getByRole('tab', { name: /Grabar en vivo/ })).toBeTruthy()
  })

  it('shows a recording that started elsewhere with the phone controls', async () => {
    backend.snapshot = {
      id: 'meet-1',
      status: 'live',
      title: 'Reunión',
      dateLabel: '2 de octubre',
      durationMs: 768_000,
      sources: { microphone: true, system: false },
      lines: [],
      speakers: [],
      turns: [],
      totalTurns: 0,
      notes: '',
      marks: [],
      answers: [],
      liveAnswers: false,
      insights: { keyPoints: [], tasks: [], corrected: false },
      suggestedQuestions: [],
      contextText: '',
    }
    renderView()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finalizar' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Más opciones' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Respuestas en vivo' }).getAttribute('aria-checked')).toBe('false')
  })
})
