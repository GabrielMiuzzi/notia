import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSelector } from '../../../../store/hooks'
import { selectQwen3AsrSettings } from '../../../../features/preferences/preferencesSelectors'
import {
  cancelSpeechSession,
  consumeSpeechTurn,
  getSpeechCapabilities,
  listenSpeechPartial,
  listenSpeechSegments,
  listenSpeechState,
  pauseSpeechSession,
  probeSpeechAudioInput,
  probeSherpaRuntime,
  prepareSpeechModel,
  resumeSpeechSession,
  startSpeechSession,
  stopSpeechSession,
} from '../../../../services/speech/speechService'
import { formatDiarizedTranscript, mergeVoiceTextIntoDraft } from '../../../../services/speech/speechTranscript'
import type {
  SpeechAudioInputStatus,
  SpeechCapabilities,
  SpeechSessionState,
  SherpaRuntimeStatus,
} from '../../../../services/speech/speechTypes'

const INITIAL_STATE: SpeechSessionState = { status: 'idle' }
const ACTIVE_STATUSES = new Set<SpeechSessionState['status']>(['preparing', 'recording', 'paused', 'finalizing'])

interface UseVoiceTranscriptionInput {
  draft: string
  setDraft: (value: string) => void
  pauseDetectionMs?: number | null
  continuousSession?: boolean
  onCompleted?: (text: string) => void
  captureSystemAudio?: boolean
}

export function hasNewRecognizedSpeech(previous: string, next: string): boolean {
  return Boolean(next.trim()) && next.trim() !== previous
}

export function stabilizePartialTranscript(previous: string, next: string): string {
  const normalizedPrevious = previous.trim()
  const normalizedNext = next.trim()
  if (!normalizedNext) return normalizedPrevious
  if (!normalizedPrevious || normalizedNext.startsWith(normalizedPrevious)) return normalizedNext
  const previousWords = normalizedPrevious.split(/\s+/).length
  const nextWords = normalizedNext.split(/\s+/).length
  return nextWords > previousWords ? normalizedNext : normalizedPrevious
}

export function useVoiceTranscription({ draft, setDraft, pauseDetectionMs = null, continuousSession = false, onCompleted, captureSystemAudio = false }: UseVoiceTranscriptionInput) {
  const qwen3Asr = useAppSelector(selectQwen3AsrSettings)
  const [capabilities, setCapabilities] = useState<SpeechCapabilities | null>(null)
  const [audioInput, setAudioInput] = useState<SpeechAudioInputStatus | null>(null)
  const [sherpaRuntime, setSherpaRuntime] = useState<SherpaRuntimeStatus | null>(null)
  const [state, setState] = useState<SpeechSessionState>(INITIAL_STATE)
  const [visiblePartialText, setVisiblePartialText] = useState('')
  const [isModelReady, setIsModelReady] = useState(false)
  const [modelPreparationError, setModelPreparationError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const consumingTurnRef = useRef<string | null>(null)
  const baseDraftRef = useRef('')
  const silenceTimerRef = useRef<number | null>(null)
  const lastObservedSpeechRef = useRef('')
  const confirmedTextRef = useRef('')
  const visiblePartialTextRef = useRef('')
  const onCompletedRef = useRef(onCompleted)
  const environmentErrorRef = useRef<string | null>(null)

  useEffect(() => {
    onCompletedRef.current = onCompleted
  }, [onCompleted])

  useEffect(() => {
    setIsModelReady(false)
    setModelPreparationError(null)
  }, [qwen3Asr])

  useEffect(() => {
    let current = true
    void Promise.allSettled([
      getSpeechCapabilities(),
      probeSpeechAudioInput(),
      probeSherpaRuntime(),
    ]).then(([capabilitiesResult, audioResult, sherpaResult]) => {
      if (!current) return
      if (capabilitiesResult.status === 'fulfilled') setCapabilities(capabilitiesResult.value)
      else environmentErrorRef.current = capabilitiesResult.reason instanceof Error
        ? capabilitiesResult.reason.message
        : 'No se pudo comprobar las capacidades de voz.'
      if (audioResult.status === 'fulfilled') setAudioInput(audioResult.value)
      else if (!environmentErrorRef.current) environmentErrorRef.current = audioResult.reason instanceof Error
        ? audioResult.reason.message
        : 'No se pudo comprobar el micrófono.'
      if (sherpaResult.status === 'fulfilled') setSherpaRuntime(sherpaResult.value)
    })
    return () => { current = false }
  }, [])

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    const completeDetectedTurn = (sessionId: string) => {
      if (!continuousSession) {
        void stopSpeechSession(sessionId).catch(() => undefined)
        return
      }
      // Partial-text and diarization events can observe the same silence. Only
      // one consume request may be in flight for a session; a second request
      // would race and report a misleading generic speech error.
      if (consumingTurnRef.current === sessionId) return
      consumingTurnRef.current = sessionId
      void consumeSpeechTurn(sessionId).then((text) => {
        if (sessionId !== sessionIdRef.current) return
        baseDraftRef.current = ''
        lastObservedSpeechRef.current = ''
        setDraft('')
        // Keep UI callbacks outside the consume promise: an exception in the
        // chat/TTS flow must not turn a successfully recognized turn into a
        // misleading "No se pudo completar" speech error.
        queueMicrotask(() => onCompletedRef.current?.(text))
      }).catch((error) => {
        if (sessionId === sessionIdRef.current) {
          setState({ status: 'error', error: { code: 'internal', message: error instanceof Error ? error.message : 'No se pudo completar el turno hablado.' } })
          consumingTurnRef.current = null
        }
      })
    }
    const register = async () => {
      const listeners = await Promise.all([
        listenSpeechState((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          setState(event.state)
          if (event.state.status === 'completed') {
            const transcript = formatDiarizedTranscript(event.state.transcript)
            setDraft(mergeVoiceTextIntoDraft(baseDraftRef.current, transcript))
            sessionIdRef.current = null
            consumingTurnRef.current = null
            setVisiblePartialText('')
            queueMicrotask(() => onCompletedRef.current?.(transcript))
          } else if (event.state.status === 'error') {
            sessionIdRef.current = null
            setVisiblePartialText('')
          }
        }),
        listenSpeechPartial((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          if (event.confirmedText !== confirmedTextRef.current) {
            confirmedTextRef.current = event.confirmedText
            visiblePartialTextRef.current = ''
          }
          visiblePartialTextRef.current = stabilizePartialTranscript(
            visiblePartialTextRef.current,
            event.partialText,
          )
          setVisiblePartialText(visiblePartialTextRef.current)
          const observedSpeech = `${confirmedTextRef.current} ${visiblePartialTextRef.current}`.trim()
          if (!observedSpeech) return
          setDraft(mergeVoiceTextIntoDraft(baseDraftRef.current, observedSpeech))
          // In conversation mode only arm the silence timer after sherpa has
          // confirmed an endpoint. A partial hypothesis is not yet available
          // to consume_speech_turn and would otherwise produce a misleading
          // generic turn error for short questions.
          if (pauseDetectionMs && confirmedTextRef.current.trim() && hasNewRecognizedSpeech(lastObservedSpeechRef.current, observedSpeech)) {
            lastObservedSpeechRef.current = observedSpeech
            if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null
              completeDetectedTurn(event.sessionId)
            }, pauseDetectionMs)
          }
        }),
        listenSpeechSegments((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          const observedSpeech = formatDiarizedTranscript(event.transcript).trim()
          setDraft(mergeVoiceTextIntoDraft(baseDraftRef.current, observedSpeech))
          if (pauseDetectionMs && hasNewRecognizedSpeech(lastObservedSpeechRef.current, observedSpeech)) {
            lastObservedSpeechRef.current = observedSpeech
            if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = window.setTimeout(() => {
              silenceTimerRef.current = null
              completeDetectedTurn(event.sessionId)
            }, pauseDetectionMs)
          }
        }),
      ])
      if (disposed) listeners.forEach((unlisten) => unlisten())
      else unlisteners.push(...listeners)
    }
    void register().catch(() => {
      if (!disposed) setState({ status: 'error', error: { code: 'internal', message: 'No se pudieron escuchar los eventos de voz.' } })
    })
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
      if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current)
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      consumingTurnRef.current = null
      if (sessionId) void cancelSpeechSession(sessionId).catch(() => undefined)
    }
  }, [continuousSession, pauseDetectionMs, setDraft])

  useEffect(() => {
    if (state.status !== 'recording') return
    const timer = window.setInterval(() => {
      setState((current) => current.status === 'recording'
        ? { ...current, elapsedMs: current.elapsedMs + 1_000 }
        : current)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [state.status])

  const start = useCallback(async () => {
    if (!qwen3Asr.enabled) {
      setState({
        status: 'error',
        error: {
          code: 'internal',
          message: 'Activa Qwen3-ASR en Configuraciones → Voz.',
        },
      })
      return false
    }
    setState({ status: 'preparing' })
    try {
      await prepareSpeechModel(qwen3Asr)
      setIsModelReady(true)
      setModelPreparationError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo preparar Qwen3-ASR.'
      setIsModelReady(false)
      setModelPreparationError(message)
      setState({ status: 'error', error: { code: 'internal', message } })
      return false
    }
    let currentCapabilities = capabilities
    let currentAudioInput = audioInput
    if (!currentCapabilities || !currentAudioInput) {
      setState({ status: 'preparing' })
      try {
        const [capabilitiesResult, audioResult] = await Promise.allSettled([
          getSpeechCapabilities(),
          probeSpeechAudioInput(),
        ])
        if (capabilitiesResult.status === 'rejected') {
          throw capabilitiesResult.reason
        }
        currentCapabilities = capabilitiesResult.value
        setCapabilities(currentCapabilities)
        if (audioResult.status === 'fulfilled') {
          currentAudioInput = audioResult.value
          setAudioInput(currentAudioInput)
        }
      } catch (error) {
        setState({
          status: 'error',
          error: {
            code: 'internal',
            message: error instanceof Error ? error.message : environmentErrorRef.current || (typeof error === 'string' ? error : 'No se pudo comprobar el runtime de voz.'),
          },
        })
        return false
      }
    }
    if (!currentCapabilities.supported && currentCapabilities.platform !== 'windows' && currentCapabilities.platform !== 'android') {
      setState({
        status: 'error',
        error: {
          code: 'unsupported-platform',
          message: environmentErrorRef.current || 'Qwen3-ASR no está disponible en esta plataforma.',
        },
      })
      return false
    }
    if (currentCapabilities.permission === 'denied') {
      setState({
        status: 'error',
        error: {
          code: 'permission-denied',
          message: 'Habilita el permiso de micrófono de Notia en la configuración del sistema.',
        },
      })
      return false
    }
    if (!currentAudioInput) {
      setState({
        status: 'error',
        error: { code: 'microphone-unavailable', message: 'No se pudo comprobar el micrófono.' },
      })
      return false
    }
    if (currentCapabilities.permission === 'granted' && !currentAudioInput.available) {
      setState({
        status: 'error',
        error: {
          code: 'microphone-unavailable',
          message: currentAudioInput.errorMessage || 'No hay un micrófono disponible.',
        },
      })
      return false
    }
    baseDraftRef.current = draft
    lastObservedSpeechRef.current = ''
    confirmedTextRef.current = ''
    visiblePartialTextRef.current = ''
    setVisiblePartialText('')
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    setState({ status: 'preparing' })
    try {
      const result = await startSpeechSession({
        language: qwen3Asr.language,
        model: qwen3Asr.model,
        device: qwen3Asr.device,
        diarizationEnabled: !continuousSession,
        maxDurationSeconds: 900,
        captureSystemAudio,
      })
      sessionIdRef.current = result.sessionId
      setState({ status: 'recording', elapsedMs: 0, hasSpeech: false })
      return true
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
              ? error.message
              : 'No se pudo iniciar el micrófono.')
      setState({ status: 'error', error: { code: 'internal', message } })
      return false
    }
  }, [audioInput, capabilities, captureSystemAudio, continuousSession, draft, qwen3Asr])

  const invokeForCurrentSession = useCallback(async (operation: (sessionId: string) => Promise<void>) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      await operation(sessionId)
    } catch (error) {
      setState({ status: 'error', error: { code: 'internal', message: error instanceof Error ? error.message : 'Fallo la sesion de voz.' } })
    }
  }, [])

  const resume = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return false
    try {
      await resumeSpeechSession(sessionId)
      if (consumingTurnRef.current === sessionId) consumingTurnRef.current = null
      return true
    } catch (error) {
      setState({ status: 'error', error: { code: 'internal', message: error instanceof Error ? error.message : 'No se pudo reanudar el micrófono.' } })
      throw error
    }
  }, [])

  const cancel = useCallback(async () => {
    const sessionId = sessionIdRef.current
    sessionIdRef.current = null
    lastObservedSpeechRef.current = ''
    confirmedTextRef.current = ''
    visiblePartialTextRef.current = ''
    setVisiblePartialText('')
    if (sessionId) await cancelSpeechSession(sessionId).catch(() => undefined)
    setDraft(baseDraftRef.current)
    setState(INITIAL_STATE)
  }, [setDraft])

  return {
    capabilities,
    audioInput,
    sherpaRuntime,
    state,
    visiblePartialText,
    isModelReady,
    modelPreparationError,
    isActive: ACTIVE_STATUSES.has(state.status),
    start,
    pause: () => invokeForCurrentSession(pauseSpeechSession),
    resume,
    stop: () => invokeForCurrentSession(stopSpeechSession),
    cancel,
    dismissError: () => setState(INITIAL_STATE),
  }
}
