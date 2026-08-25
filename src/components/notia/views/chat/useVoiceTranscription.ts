import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelSpeechSession,
  getSpeechCapabilities,
  listenSpeechPartial,
  listenSpeechSegments,
  listenSpeechState,
  pauseSpeechSession,
  probeSpeechAudioInput,
  probeSherpaRuntime,
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
}

export function useVoiceTranscription({ draft, setDraft }: UseVoiceTranscriptionInput) {
  const [capabilities, setCapabilities] = useState<SpeechCapabilities | null>(null)
  const [audioInput, setAudioInput] = useState<SpeechAudioInputStatus | null>(null)
  const [sherpaRuntime, setSherpaRuntime] = useState<SherpaRuntimeStatus | null>(null)
  const [state, setState] = useState<SpeechSessionState>(INITIAL_STATE)
  const sessionIdRef = useRef<string | null>(null)
  const baseDraftRef = useRef('')

  useEffect(() => {
    let current = true
    void Promise.all([getSpeechCapabilities(), probeSpeechAudioInput(), probeSherpaRuntime()])
      .then(([nextCapabilities, nextAudioInput, nextSherpaRuntime]) => {
        if (!current) return
        setCapabilities(nextCapabilities)
        setAudioInput(nextAudioInput)
        setSherpaRuntime(nextSherpaRuntime)
      })
      .catch(() => {
        if (current) setCapabilities({
          supported: false,
          platform: 'other',
          architecture: 'unknown',
          permission: 'unavailable',
          asrModelInstalled: false,
          diarizationModelInstalled: false,
          unavailableReason: 'not-integrated',
        })
      })
    return () => { current = false }
  }, [])

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    const register = async () => {
      const listeners = await Promise.all([
        listenSpeechState((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          setState(event.state)
          if (event.state.status === 'completed') {
            setDraft(mergeVoiceTextIntoDraft(baseDraftRef.current, formatDiarizedTranscript(event.state.transcript)))
            sessionIdRef.current = null
          } else if (event.state.status === 'error') {
            sessionIdRef.current = null
          }
        }),
        listenSpeechPartial((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          setDraft(mergeVoiceTextIntoDraft(baseDraftRef.current, `${event.confirmedText} ${event.partialText}`))
        }),
        listenSpeechSegments((event) => {
          if (event.sessionId !== sessionIdRef.current) return
          setDraft(mergeVoiceTextIntoDraft(baseDraftRef.current, formatDiarizedTranscript(event.transcript)))
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
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId) void cancelSpeechSession(sessionId).catch(() => undefined)
    }
  }, [setDraft])

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
    if (!capabilities?.supported) {
      setState({
        status: 'error',
        error: {
          code: 'unsupported-platform',
          message: sherpaRuntime?.errorMessage || 'La integracion nativa con sherpa-onnx todavia no esta disponible.',
        },
      })
      return
    }
    if (capabilities.permission === 'denied') {
      setState({
        status: 'error',
        error: {
          code: 'permission-denied',
          message: 'Habilita el permiso de micrófono de Notia en la configuración del sistema.',
        },
      })
      return
    }
    if (capabilities.permission === 'granted' && !audioInput?.available) {
      setState({
        status: 'error',
        error: {
          code: 'microphone-unavailable',
          message: audioInput?.errorMessage || 'No hay un microfono disponible.',
        },
      })
      return
    }
    if (!capabilities.asrModelInstalled || !capabilities.diarizationModelInstalled) {
      setState({ status: 'error', error: { code: 'model-not-installed', message: 'Instala los modelos de voz para usar el dictado offline.' } })
      return
    }
    baseDraftRef.current = draft
    setState({ status: 'preparing' })
    try {
      const result = await startSpeechSession({ language: 'es', diarizationEnabled: true, maxDurationSeconds: 900 })
      sessionIdRef.current = result.sessionId
      setState({ status: 'recording', elapsedMs: 0, hasSpeech: false })
    } catch (error) {
      setState({ status: 'error', error: { code: 'internal', message: error instanceof Error ? error.message : 'No se pudo iniciar el microfono.' } })
    }
  }, [audioInput, capabilities, draft, sherpaRuntime])

  const invokeForCurrentSession = useCallback(async (operation: (sessionId: string) => Promise<void>) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    try {
      await operation(sessionId)
    } catch (error) {
      setState({ status: 'error', error: { code: 'internal', message: error instanceof Error ? error.message : 'Fallo la sesion de voz.' } })
    }
  }, [])

  const cancel = useCallback(async () => {
    const sessionId = sessionIdRef.current
    sessionIdRef.current = null
    if (sessionId) await cancelSpeechSession(sessionId).catch(() => undefined)
    setDraft(baseDraftRef.current)
    setState(INITIAL_STATE)
  }, [setDraft])

  return {
    capabilities,
    audioInput,
    sherpaRuntime,
    state,
    isActive: ACTIVE_STATUSES.has(state.status),
    start,
    pause: () => invokeForCurrentSession(pauseSpeechSession),
    resume: () => invokeForCurrentSession(resumeSpeechSession),
    stop: () => invokeForCurrentSession(stopSpeechSession),
    cancel,
    dismissError: () => setState(INITIAL_STATE),
  }
}
