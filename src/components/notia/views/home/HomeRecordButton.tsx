import { useCallback, useEffect, useMemo } from 'react'
import { shallowEqual } from 'react-redux'
import { Mic, Square } from 'lucide-react'
import { useAppSelector } from '../../../../store/hooks'
import { selectAiSettings } from '../../../../features/preferences/preferencesSelectors'
import { meetingAiSettings } from '../../../../services/meeting/meetingService'
import type { MeetingFilter } from '../../../../services/meeting/meetingTypes'
import { useDeviceVoiceTranscription } from '../chat/useVoiceTranscription'
import { useMeetingSnapshot } from '../meeting/useMeetingSnapshot'
import { useFollowMeetingSession } from '../meeting/useFollowMeetingSession'
import { formatClock } from '../meeting/meetingDisplay'

const MEETING_MAX_DURATION_SECONDS = 12 * 60 * 60
const NO_FILTER: MeetingFilter = { query: '', speakerId: null }
// The meeting keeps its transcript in the backend, as in the Meeting view.
const NO_DRAFT = ''
const ignoreDraft = () => undefined

interface HomeRecordButtonProps {
  /** Shows the Meeting view, where the recording goes on. */
  onOpenMeeting: () => void
}

/**
 * «Grabar» starts a meeting with the Meeting view's defaults (microphone and,
 * where supported, the system audio). The session belongs to the backend:
 * it keeps recording when Home closes and the Meeting view follows it.
 */
export function HomeRecordButton({ onOpenMeeting }: HomeRecordButtonProps) {
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const meetingOptions = useMemo(() => ({ liveAnswers: false, settings: meetingAiSettings(aiPreferences) }), [aiPreferences])
  const voice = useDeviceVoiceTranscription({
    draft: NO_DRAFT,
    setDraft: ignoreDraft,
    maxDurationSeconds: MEETING_MAX_DURATION_SECONDS,
    captureMicrophone: true,
    captureSystemAudio: true,
    expectedSpeakers: null,
    meeting: meetingOptions,
  })
  const { snapshot, refresh: refreshSnapshot } = useMeetingSnapshot(NO_FILTER)
  const status = voice.state.status

  // A meeting that is recording elsewhere is followed here too.
  const liveId = snapshot?.status === 'live' ? snapshot.id : null
  useFollowMeetingSession(voice.attach, liveId, status, refreshSnapshot)

  const isRecording = status === 'recording' || status === 'paused'
  const hasUnsavedMeeting = snapshot?.status === 'completed' && !snapshot.savedNotePath
  const canStart = voice.isModelReady && status !== 'preparing' && !liveId && snapshot?.status !== 'processing' && !hasUnsavedMeeting
  const startVoice = voice.start
  const start = useCallback(() => {
    if (canStart) void startVoice()
  }, [canStart, startVoice])

  useEffect(() => {
    if (isRecording) return undefined
    const startOnShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'r') return
      event.preventDefault()
      start()
    }
    window.addEventListener('keydown', startOnShortcut)
    return () => window.removeEventListener('keydown', startOnShortcut)
  }, [isRecording, start])

  if (isRecording) {
    return (
      <button type="button" className="home-button home-button--tall home-button--recording" onClick={() => void voice.stop()}>
        <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        Detener · <span className="home-mono">{formatClock(voice.state.status === 'recording' || voice.state.status === 'paused' ? voice.state.elapsedMs : 0)}</span>
      </button>
    )
  }
  if (status === 'finalizing' || snapshot?.status === 'processing') {
    return (
      <button type="button" className="home-button home-button--tall" onClick={onOpenMeeting}>
        <Mic size={15} strokeWidth={1.75} aria-hidden="true" />
        Procesando…
      </button>
    )
  }
  // A new recording replaces the meeting; one not saved yet is decided in Meeting.
  if (hasUnsavedMeeting) {
    return (
      <button type="button" className="home-button home-button--tall" onClick={onOpenMeeting}>
        <Mic size={15} strokeWidth={1.75} aria-hidden="true" />
        Reunión sin guardar
      </button>
    )
  }
  const error = status === 'error' ? voice.state.error.message : voice.modelPreparationError
  return (
    <button
      type="button"
      className="home-button home-button--tall"
      title={error ?? 'Grabar reunión (Ctrl+Shift+R)'}
      disabled={!canStart}
      onClick={start}
    >
      <Mic size={15} strokeWidth={1.75} aria-hidden="true" />
      Grabar
    </button>
  )
}
