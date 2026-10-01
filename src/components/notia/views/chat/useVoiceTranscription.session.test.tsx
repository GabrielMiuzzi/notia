// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { SpeechSessionEvent, SpeechSessionState } from '../../../../services/speech/speechTypes'

const speech = vi.hoisted(() => ({
  stateListener: null as ((event: SpeechSessionEvent) => void) | null,
  cancelSpeechSession: vi.fn(async () => undefined),
  getSpeechSessionState: vi.fn<(sessionId: string) => Promise<SpeechSessionState>>(),
}))

vi.mock('../../../../services/transport', () => ({ backendKind: () => 'local' }))
vi.mock('../../../../features/preferences/preferencesSelectors', () => ({
  selectSpeechRecognitionSettings: () => ({ enabled: true, language: 'es' }),
}))
vi.mock('../../../../store/hooks', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) => selector({ preferences: { devicePreferencesLoaded: false } }),
}))
vi.mock('../../../../services/speech/speechService', () => ({
  cancelSpeechSession: speech.cancelSpeechSession,
  consumeSpeechTurn: vi.fn(),
  getSpeechCapabilities: vi.fn(() => new Promise(() => undefined)),
  getSpeechSessionState: speech.getSpeechSessionState,
  listenSpeechPartial: vi.fn(async () => () => undefined),
  listenSpeechSegments: vi.fn(async () => () => undefined),
  listenSpeechState: vi.fn(async (callback: (event: SpeechSessionEvent) => void) => {
    speech.stateListener = callback
    return () => { speech.stateListener = null }
  }),
  pauseSpeechSession: vi.fn(),
  prepareSpeechModel: vi.fn(),
  probeSherpaRuntime: vi.fn(() => new Promise(() => undefined)),
  probeSpeechAudioInput: vi.fn(() => new Promise(() => undefined)),
  resumeSpeechSession: vi.fn(),
  startSpeechSession: vi.fn(),
  stopSpeechSession: vi.fn(),
}))

const { useVoiceTranscription } = await import('./useVoiceTranscription')

const MEETING = { liveAnswers: false, settings: null }
const renderVoice = (meeting: typeof MEETING | null) => renderHook(() => useVoiceTranscription({
  draft: '',
  setDraft: noDraft,
  meeting,
}))
const noDraft = () => undefined

describe('voice sessions that outlive their view', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    speech.stateListener = null
  })

  it('keeps a Meeting session when the view closes and follows it again', async () => {
    speech.getSpeechSessionState.mockResolvedValue({ status: 'paused', elapsedMs: 65_000 })
    const view = renderVoice(MEETING)

    await act(() => view.result.current.attach('meeting-1'))

    expect(speech.getSpeechSessionState).toHaveBeenCalledWith('meeting-1')
    expect(view.result.current.state).toEqual({ status: 'paused', elapsedMs: 65_000 })
    view.unmount()
    expect(speech.cancelSpeechSession).not.toHaveBeenCalled()
  })

  it('still cancels a dictation session when its view closes', async () => {
    speech.getSpeechSessionState.mockResolvedValue({ status: 'recording', elapsedMs: 0, hasSpeech: false })
    const view = renderVoice(null)

    await act(() => view.result.current.attach('dictation-1'))
    view.unmount()

    expect(speech.cancelSpeechSession).toHaveBeenCalledWith('dictation-1')
  })

  it('prefers an event that arrives while attaching over the older answer', async () => {
    let answer: (state: SpeechSessionState) => void = () => undefined
    speech.getSpeechSessionState.mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const view = renderVoice(MEETING)
    await waitFor(() => expect(speech.stateListener).not.toBeNull())

    let attaching: Promise<boolean> = Promise.resolve(false)
    act(() => { attaching = view.result.current.attach('meeting-1') })
    act(() => speech.stateListener?.({ sessionId: 'meeting-1', state: { status: 'finalizing', progress: 0.5 } }))
    await act(async () => {
      answer({ status: 'recording', elapsedMs: 1_000, hasSpeech: true })
      await attaching
    })

    expect(view.result.current.state).toEqual({ status: 'finalizing', progress: 0.5 })
  })

  it('lets go of a session that already ended', async () => {
    speech.getSpeechSessionState.mockRejectedValue(new Error('La grabación ya terminó.'))
    const view = renderVoice(MEETING)
    await waitFor(() => expect(speech.stateListener).not.toBeNull())

    let followed = true
    await act(async () => { followed = await view.result.current.attach('meeting-1') })
    act(() => speech.stateListener?.({ sessionId: 'meeting-1', state: { status: 'recording', elapsedMs: 0, hasSpeech: true } }))

    expect(followed).toBe(false)
    expect(view.result.current.state).toEqual({ status: 'idle' })
  })

  it('reads the state again of the session it still follows after a dismissed error', async () => {
    speech.getSpeechSessionState.mockResolvedValue({ status: 'recording', elapsedMs: 3_300_000, hasSpeech: true })
    const view = renderVoice(MEETING)
    await act(() => view.result.current.attach('meeting-1'))
    act(() => view.result.current.dismissError())
    expect(view.result.current.state).toEqual({ status: 'idle' })

    speech.getSpeechSessionState.mockResolvedValue({ status: 'recording', elapsedMs: 3_320_000, hasSpeech: true })
    let followed = false
    await act(async () => { followed = await view.result.current.attach('meeting-1') })

    expect(followed).toBe(true)
    expect(view.result.current.state).toEqual({ status: 'recording', elapsedMs: 3_320_000, hasSpeech: true })
  })

  it('does not follow a second session over the one it follows', async () => {
    speech.getSpeechSessionState.mockResolvedValue({ status: 'recording', elapsedMs: 0, hasSpeech: true })
    const view = renderVoice(MEETING)
    await act(() => view.result.current.attach('meeting-1'))

    let followed = true
    await act(async () => { followed = await view.result.current.attach('meeting-2') })

    expect(followed).toBe(false)
    expect(speech.getSpeechSessionState).toHaveBeenCalledTimes(1)
  })
})
