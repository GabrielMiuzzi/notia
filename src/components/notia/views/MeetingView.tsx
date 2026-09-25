import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallowEqual } from 'react-redux'
import { Check, ChevronDown, CircleStop, Download, FileText, Flag, Lock, Mic, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useVoiceTranscription } from './chat/useVoiceTranscription'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { selectAiSettings, selectSpeechRecognitionSettings } from '../../../features/preferences/preferencesSelectors'
import { setSpeechRecognitionSettings } from '../../../features/preferences/preferencesSlice'
import { selectActiveLibrary } from '../../../features/library/librarySelectors'
import { useNotiaAction } from '../../../context/notiaActions/useNotiaAction'
import { clearMeetingTranscriptContext, setMeetingTranscriptContext } from '../../../services/meeting/meetingTranscriptContext'
import {
  addMeetingMark,
  discardMeeting,
  exportMeeting,
  meetingAiSettings,
  pinMeetingAnswer,
  regenerateMeetingAnswer,
  removeMeetingMark,
  saveMeetingNote,
  setMeetingLiveAnswers,
  setMeetingNotes,
} from '../../../services/meeting/meetingService'
import { skipSpeechDiarization, startAudioMonitor, stopAudioMonitor } from '../../../services/speech/speechService'
import { loadLibraryFolderOptions } from '../../../services/chat/chatAttachmentRuntime'
import type { MeetingExportFormat, MeetingFilter } from '../../../services/meeting/meetingTypes'
import { DEFAULT_MEETING_FOLDER, MeetingReadyPanel, type MeetingSource } from './meeting/MeetingReadyPanel'
import { MeetingRecordingPanel } from './meeting/MeetingRecordingPanel'
import { MeetingProcessingPanel } from './meeting/MeetingProcessingPanel'
import { MeetingCompletedPanel } from './meeting/MeetingCompletedPanel'
import { useMeetingSnapshot } from './meeting/useMeetingSnapshot'
import { useSpeechLevels } from './meeting/useSpeechLevels'
import { formatClock } from './meeting/meetingDisplay'

const MEETING_MAX_DURATION_SECONDS = 12 * 60 * 60
const LEVEL_HISTORY = 90
const NO_FILTER: MeetingFilter = { query: '', speakerId: null }

type MeetingStage = 'ready' | 'recording' | 'processing' | 'completed'

// The meeting keeps its transcript in the backend; the voice hook's draft,
// which would copy the whole text on every preview, is not used.
const NO_DRAFT = ''
const ignoreDraft = () => undefined

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

function MeetingViewComponent() {
  const dispatch = useAppDispatch()
  const aiPreferences = useAppSelector(selectAiSettings, shallowEqual)
  const speechRecognition = useAppSelector(selectSpeechRecognitionSettings)
  const library = useAppSelector(selectActiveLibrary)
  const openFile = useNotiaAction('openFile')
  const announceTreeChange = useNotiaAction('chatWorkspaceTreeChanged')

  const [sources, setSources] = useState<Record<MeetingSource, boolean>>({ microphone: true, system: true })
  const [expectedSpeakers, setExpectedSpeakers] = useState<number | null>(null)
  const [folder, setFolder] = useState(DEFAULT_MEETING_FOLDER)
  const [folderOptions, setFolderOptions] = useState<string[]>([])
  // Off until the person turns them on: they send the transcript to the AI provider.
  const [liveAnswers, setLiveAnswers] = useState(false)
  const [monitorId, setMonitorId] = useState<string | null>(null)
  const [filter, setFilter] = useState<MeetingFilter>(NO_FILTER)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'save' | 'export' | 'new' | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)
  const monitorRef = useRef<string | null>(null)

  const meetingOptions = useMemo(
    () => ({ liveAnswers, settings: meetingAiSettings(aiPreferences) }),
    [aiPreferences, liveAnswers],
  )
  const voice = useVoiceTranscription({
    draft: NO_DRAFT,
    setDraft: ignoreDraft,
    maxDurationSeconds: MEETING_MAX_DURATION_SECONDS,
    captureMicrophone: sources.microphone,
    captureSystemAudio: sources.system,
    expectedSpeakers,
    meeting: meetingOptions,
  })
  const systemAudioSupported = voice.capabilities?.systemAudioSupported ?? false
  const effectiveSources = useMemo(
    () => ({ microphone: sources.microphone, system: sources.system && systemAudioSupported }),
    [sources, systemAudioSupported],
  )
  const { snapshot, error: snapshotError } = useMeetingSnapshot(filter)

  const status = voice.state.status
  // A meeting that kept recording while the view was closed shows as
  // recording while the hook attaches to its session again.
  const liveElsewhere = snapshot?.status === 'live' && status === 'idle'
  const stage: MeetingStage = status === 'recording' || status === 'paused' || liveElsewhere ? 'recording'
    : status === 'finalizing' || snapshot?.status === 'processing' ? 'processing'
      : snapshot?.status === 'completed' ? 'completed'
        : 'ready'

  const attachVoice = voice.attach
  const attachedIdRef = useRef<string | null>(null)
  const runningId = snapshot && (snapshot.status === 'live' || snapshot.status === 'processing') ? snapshot.id : null
  useEffect(() => {
    if (!runningId || status !== 'idle' || attachedIdRef.current === runningId) return
    attachedIdRef.current = runningId
    void attachVoice(runningId)
  }, [attachVoice, runningId, status])
  const levels = useSpeechLevels(stage === 'recording' ? snapshot?.id ?? null : monitorId, LEVEL_HISTORY)

  const contextMeetingId = snapshot?.id ?? null
  const hasTranscript = Boolean(snapshot && (snapshot.lines.length > 0 || snapshot.totalTurns > 0 || snapshot.notes.trim()))
  useEffect(() => {
    setMeetingTranscriptContext(contextMeetingId, hasTranscript)
  }, [contextMeetingId, hasTranscript])
  useEffect(() => clearMeetingTranscriptContext, [])

  useEffect(() => {
    if (stage !== 'processing') setIsSkipping(false)
    setExportMenuOpen(false)
  }, [stage])

  // A speaker merged into another no longer exists to filter by.
  const filteredSpeakerGone = Boolean(filter.speakerId && snapshot && !snapshot.speakers.some((speaker) => speaker.id === filter.speakerId))
  useEffect(() => {
    if (filteredSpeakerGone) setFilter((current) => ({ ...current, speakerId: null }))
  }, [filteredSpeakerGone])

  useEffect(() => {
    let current = true
    setFolderOptions([])
    if (!library) return
    void loadLibraryFolderOptions(library).then((options) => {
      if (current) setFolderOptions(options.map((option) => option.relativePath).filter(Boolean))
    }).catch(() => undefined)
    return () => { current = false }
  }, [library])

  const stopMonitor = useCallback(() => {
    const id = monitorRef.current
    monitorRef.current = null
    setMonitorId(null)
    if (id) void stopAudioMonitor(id).catch(() => undefined)
  }, [])
  useEffect(() => stopMonitor, [stopMonitor])

  const toggleMonitor = async () => {
    if (monitorRef.current) {
      stopMonitor()
      return
    }
    setActionError(null)
    try {
      const id = await startAudioMonitor(effectiveSources)
      monitorRef.current = id
      setMonitorId(id)
    } catch (error) {
      setActionError(errorText(error, 'No se pudo probar el audio.'))
    }
  }

  const toggleSource = (source: MeetingSource) => {
    stopMonitor()
    setSources((current) => ({ ...current, [source]: !current[source] }))
  }

  const canStart = voice.isModelReady && (effectiveSources.microphone || effectiveSources.system)
  const startVoice = voice.start
  const start = useCallback(async () => {
    stopMonitor()
    setActionError(null)
    setNotice(null)
    setFilter(NO_FILTER)
    await startVoice()
  }, [startVoice, stopMonitor])

  useEffect(() => {
    if (stage !== 'ready' || !canStart || status === 'preparing') return
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'r') return
      event.preventDefault()
      void start()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [canStart, stage, start, status])

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(errorText(error, fallback))
    }
  }

  const meetingId = snapshot?.id ?? null
  const markMoment = () => meetingId && void run(() => addMeetingMark(meetingId), 'No se pudo marcar el momento.')
  const toggleLiveAnswers = (enabled: boolean) => {
    setLiveAnswers(enabled)
    if (meetingId) void run(() => setMeetingLiveAnswers(meetingId, enabled, aiPreferences), 'No se pudieron cambiar las respuestas en vivo.')
  }
  const saveNotes = useCallback((notes: string) => {
    if (meetingId) void setMeetingNotes(meetingId, notes).catch(() => undefined)
  }, [meetingId])

  const skipSeparation = () => {
    if (!meetingId) return
    setIsSkipping(true)
    void skipSpeechDiarization(meetingId).catch((error) => {
      setIsSkipping(false)
      setActionError(errorText(error, 'No se pudo cancelar la separación.'))
    })
  }

  const saveNote = async () => {
    if (!meetingId || !library) return
    setBusyAction('save')
    setActionError(null)
    try {
      const saved = await saveMeetingNote(meetingId, library.id, folder)
      announceTreeChange(saved.path)
      setNotice('La reunión quedó guardada como nota.')
    } catch (error) {
      setActionError(errorText(error, 'No se pudo guardar la nota.'))
    } finally {
      setBusyAction(null)
    }
  }

  const exportAs = async (format: MeetingExportFormat) => {
    setExportMenuOpen(false)
    if (!meetingId || !library) return
    setBusyAction('export')
    setActionError(null)
    try {
      const exported = await exportMeeting(meetingId, library.id, folder, format)
      announceTreeChange(exported.path)
      setNotice(`Se exportó la reunión (${format === 'pdf' ? 'PDF' : 'Word'}) junto a su nota.`)
    } catch (error) {
      setActionError(errorText(error, 'No se pudo exportar la reunión.'))
    } finally {
      setBusyAction(null)
    }
  }

  const newRecording = async () => {
    if (!meetingId) return
    setBusyAction('new')
    setNotice(null)
    await run(() => discardMeeting(meetingId), 'No se pudo empezar una nueva grabación.')
    setFilter(NO_FILTER)
    setBusyAction(null)
    voice.dismissError()
  }

  const elapsedMs = voice.state.status === 'recording' || voice.state.status === 'paused' ? voice.state.elapsedMs : 0
  const speakerCount = snapshot?.speakers.length ?? 0
  const readyLabel = status === 'preparing' ? 'Iniciando captura de audio…'
    : voice.modelPreparationError ? 'No se pudo preparar el modelo de voz'
      : !voice.isModelReady ? 'Preparando voz al iniciar Notia…'
        : 'Lista para grabar'
  const errorMessage = voice.state.status === 'error' ? voice.state.error.message
    : voice.modelPreparationError ?? actionError ?? snapshotError

  return (
    <main className="notia-main notia-meeting-view" data-stage={stage}>
      {stage === 'ready' ? (
        <header className="notia-meeting-intro">
          <div>
            <span className="notia-meeting-eyebrow"><Lock size={14} aria-hidden="true" /> Transcripción local</span>
            <h1>Meeting</h1>
            <p>Nombrá la reunión y elegí las fuentes. Al finalizar, Notia separa las intervenciones por hablante.</p>
          </div>
          <span className="notia-meeting-pill" role="status" aria-live="polite">
            <span className="notia-meeting-pill-dot" aria-hidden="true" />{readyLabel}
          </span>
        </header>
      ) : (
        <header className="notia-meeting-bar">
          <div className="notia-meeting-bar-title">
            <h1>Meeting</h1>
            {stage === 'recording' ? (
              <span className="notia-meeting-pill notia-meeting-pill--recording" role="status">
                <span className="notia-meeting-pill-dot" aria-hidden="true" />
                {status === 'paused' ? 'En pausa' : 'Grabando'}
                <span className="notia-meeting-mono">{formatClock(elapsedMs)}</span>
              </span>
            ) : stage === 'processing' ? (
              <span className="notia-meeting-pill" role="status"><span className="notia-meeting-pill-dot" aria-hidden="true" />Separando hablantes</span>
            ) : (
              <span className="notia-meeting-pill notia-meeting-pill--done" role="status">
                <Check size={13} aria-hidden="true" />Finalizada
                <span className="notia-meeting-pill-detail">
                  · {formatClock(snapshot?.durationMs ?? 0)}{speakerCount > 0 ? ` · ${speakerCount} ${speakerCount === 1 ? 'hablante' : 'hablantes'}` : ''}
                </span>
              </span>
            )}
          </div>
          {stage === 'recording' ? (
            <div className="notia-meeting-actions">
              <button type="button" className="notia-meeting-secondary-button" onClick={markMoment} disabled={!meetingId || status !== 'recording'}>
                <Flag size={14} aria-hidden="true" /> Marcar momento
              </button>
              {status === 'paused' ? (
                <button type="button" className="notia-meeting-secondary-button" onClick={() => void voice.resume()}>
                  <Play size={14} aria-hidden="true" /> Reanudar
                </button>
              ) : (
                <button type="button" className="notia-meeting-secondary-button" onClick={() => void voice.pause()}>
                  <Pause size={14} aria-hidden="true" /> Pausar
                </button>
              )}
              <button type="button" className="notia-meeting-primary-button" onClick={() => void voice.stop()}>
                <CircleStop size={14} aria-hidden="true" /> Finalizar
              </button>
              <button type="button" className="notia-meeting-ghost-button" onClick={() => void voice.cancel()}>
                <RotateCcw size={14} aria-hidden="true" /> Cancelar
              </button>
            </div>
          ) : stage === 'completed' ? (
            <div className="notia-meeting-actions">
              <button type="button" className="notia-meeting-secondary-button" onClick={() => void newRecording()} disabled={busyAction !== null}>
                <Mic size={14} aria-hidden="true" /> Nueva grabación
              </button>
              <div className="notia-meeting-menu">
                <button
                  type="button"
                  className="notia-meeting-secondary-button"
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  onClick={() => setExportMenuOpen((open) => !open)}
                  disabled={!library || busyAction !== null}
                >
                  <Download size={14} aria-hidden="true" /> {busyAction === 'export' ? 'Exportando…' : 'Exportar'}
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {exportMenuOpen ? (
                  <div className="notia-meeting-menu-list" role="menu">
                    <button type="button" role="menuitem" onClick={() => void exportAs('pdf')}>PDF</button>
                    <button type="button" role="menuitem" onClick={() => void exportAs('docx')}>Word (.docx)</button>
                  </div>
                ) : null}
              </div>
              {snapshot?.savedNotePath ? (
                <button type="button" className="notia-meeting-secondary-button" onClick={() => void openFile(snapshot.savedNotePath ?? '')}>
                  <FileText size={14} aria-hidden="true" /> Abrir nota
                </button>
              ) : null}
              <button
                type="button"
                className="notia-meeting-primary-button"
                onClick={() => void saveNote()}
                disabled={!library || busyAction !== null}
                title={library ? undefined : 'Abrí una biblioteca para guardar la reunión'}
              >
                <FileText size={14} aria-hidden="true" />
                {busyAction === 'save' ? 'Guardando…' : snapshot?.savedNotePath ? 'Actualizar nota' : 'Guardar como nota'}
              </button>
            </div>
          ) : null}
        </header>
      )}

      {errorMessage ? (
        <div className="notia-meeting-banner notia-meeting-banner--error" role="alert">
          <span>{errorMessage}</span>
          {status === 'error' || actionError ? (
            <button
              type="button"
              className="notia-meeting-icon-button"
              aria-label="Cerrar aviso"
              onClick={() => {
                setActionError(null)
                if (status === 'error') voice.dismissError()
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div className="notia-meeting-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="notia-meeting-icon-button" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {stage === 'ready' ? (
        <MeetingReadyPanel
          canStart={canStart}
          isStarting={status === 'preparing'}
          onStart={() => void start()}
          microphoneLabel={voice.audioInput?.deviceLabel ?? 'Micrófono predeterminado'}
          systemAudioSupported={systemAudioSupported}
          sources={effectiveSources}
          onToggleSource={toggleSource}
          isChecking={monitorId !== null}
          onToggleCheck={() => void toggleMonitor()}
          levels={levels}
          language={speechRecognition.language}
          onLanguageChange={(language) => dispatch(setSpeechRecognitionSettings({ ...speechRecognition, language }))}
          expectedSpeakers={expectedSpeakers}
          onExpectedSpeakersChange={setExpectedSpeakers}
          folder={folder}
          folderOptions={folderOptions}
          libraryName={library?.name ?? null}
          onFolderChange={setFolder}
        />
      ) : stage === 'recording' ? (
        <MeetingRecordingPanel
          snapshot={snapshot}
          partialText={voice.visiblePartialText}
          levels={levels}
          onToggleLiveAnswers={toggleLiveAnswers}
          onRegenerateAnswer={(answerId, shorter) => meetingId && void run(
            () => regenerateMeetingAnswer(meetingId, answerId, shorter, aiPreferences),
            'No se pudo generar la respuesta.',
          )}
          onPinAnswer={(answerId, pinned) => meetingId && void run(
            () => pinMeetingAnswer(meetingId, answerId, pinned),
            'No se pudo fijar la respuesta.',
          )}
          onSaveNotes={saveNotes}
          onRemoveMark={(markId) => meetingId && void run(() => removeMeetingMark(meetingId, markId), 'No se pudo quitar el momento.')}
        />
      ) : stage === 'processing' ? (
        <MeetingProcessingPanel
          durationMs={snapshot?.durationMs ?? 0}
          progress={voice.state.status === 'finalizing' ? voice.state.progress : undefined}
          stage={voice.state.status === 'finalizing' ? voice.state.stage : undefined}
          lines={snapshot?.lines ?? []}
          isSkipping={isSkipping}
          onSkip={skipSeparation}
        />
      ) : snapshot ? (
        <MeetingCompletedPanel
          snapshot={snapshot}
          filter={filter}
          onFilterChange={setFilter}
          aiPreferences={aiPreferences}
          library={library}
        />
      ) : null}
    </main>
  )
}

export const MeetingView = memo(MeetingViewComponent)
MeetingView.displayName = 'MeetingView'
