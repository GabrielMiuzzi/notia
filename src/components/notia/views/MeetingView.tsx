import { memo, useCallback, useEffect, useState } from 'react'
import { CircleStop, Mic, MonitorSpeaker, Pause, Play, RotateCcw, Sparkles, Users } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { useVoiceTranscription } from './chat/useVoiceTranscription'
import { useAppSelector } from '../../../store/hooks'
import { selectAiSettings } from '../../../features/preferences/preferencesSelectors'
import { improveMeetingTranscript } from '../../../services/ai/aiRuntime'
import { extractSpeakerNames, replaceSpeakerName } from '../../../services/speech/speechTranscript'
import { clearMeetingTranscriptContext, setMeetingTranscriptContext } from '../../../services/meeting/meetingTranscriptContext'

const MEETING_MAX_DURATION_SECONDS = 12 * 60 * 60

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function MeetingViewComponent() {
  const [transcript, setTranscript] = useState('')
  const [speakerNames, setSpeakerNames] = useState<Array<{ applied: string; draft: string }>>([])
  const [isImproving, setIsImproving] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiPreferences = useAppSelector(selectAiSettings)
  useEffect(() => {
    setMeetingTranscriptContext(transcript)
  }, [transcript])
  useEffect(() => clearMeetingTranscriptContext, [])
  const handleCompleted = useCallback((text: string) => {
    setSpeakerNames(extractSpeakerNames(text).map((name) => ({ applied: name, draft: name })))
    setAiError(null)
  }, [])
  const voice = useVoiceTranscription({
    draft: transcript,
    setDraft: setTranscript,
    maxDurationSeconds: MEETING_MAX_DURATION_SECONDS,
    captureSystemAudio: true,
    onCompleted: handleCompleted,
  })
  const elapsedMs = voice.state.status === 'recording' || voice.state.status === 'paused'
    ? voice.state.elapsedMs
    : 0
  const isBusy = voice.state.status === 'preparing' || voice.state.status === 'finalizing'
  const capturesSystemAudio = voice.capabilities?.platform === 'windows'
  const partialStart = voice.visiblePartialText
    ? transcript.lastIndexOf(voice.visiblePartialText)
    : -1
  const confirmedTranscript = partialStart >= 0 ? transcript.slice(0, partialStart) : transcript
  const provisionalTranscript = partialStart >= 0 ? transcript.slice(partialStart) : ''
  const renameSpeaker = (index: number, nextName: string) => {
    const speaker = speakerNames[index]
    if (!speaker) return
    const normalizedName = nextName.trim()
    setSpeakerNames((current) => current.map((entry, currentIndex) => currentIndex === index
      ? { applied: normalizedName || entry.applied, draft: nextName }
      : entry))
    if (!normalizedName) return
    setTranscript((current) => replaceSpeakerName(current, speaker.applied, normalizedName))
  }
  const improveTranscript = async () => {
    setIsImproving(true)
    setAiError(null)
    try {
      setTranscript(await improveMeetingTranscript(aiPreferences, transcript))
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'No se pudo mejorar la transcripción con IA.')
    } finally {
      setIsImproving(false)
    }
  }

  return (
    <main className="notia-main notia-meeting-view">
      <section className="notia-meeting-header">
        <div>
          <span className="notia-meeting-eyebrow"><Users size={15} /> Transcripción local</span>
          <h1>Meeting</h1>
          <p>Transcribí la conversación en tiempo real. Al finalizar, Notia agrupa las intervenciones por hablante.</p>
        </div>
        <div className={`notia-meeting-status notia-meeting-status--${voice.state.status}`} role="status" aria-live="polite">
          <span aria-hidden="true" />
          {voice.state.status === 'recording' ? `Grabando · ${formatElapsed(elapsedMs)}`
            : voice.state.status === 'paused' ? `En pausa · ${formatElapsed(elapsedMs)}`
              : voice.state.status === 'preparing' ? 'Iniciando captura de audio…'
                : voice.state.status === 'finalizing' ? 'Separando hablantes…'
                  : voice.state.status === 'completed' ? 'Transcripción finalizada'
                    : voice.modelPreparationError ? 'No se pudo preparar el modelo de voz'
                      : !voice.isModelReady ? 'Preparando voz al iniciar Notia…'
                      : 'Lista para grabar'}
        </div>
      </section>

      <section className="notia-meeting-source" aria-label="Fuentes de audio">
        <div><Mic size={18} /><span><strong>Micrófono</strong><small>{voice.audioInput?.deviceLabel ?? 'Dispositivo predeterminado'}</small></span></div>
        <div><MonitorSpeaker size={18} /><span><strong>Audio de la computadora</strong><small>{capturesSystemAudio ? 'Salida predeterminada de Windows · captura nativa' : 'Disponible en Windows'}</small></span></div>
        <p>{capturesSystemAudio
          ? 'Notia mezcla ambas fuentes internamente. No requiere dispositivos virtuales ni cambiar la entrada de Windows.'
          : 'La captura del audio interno de otras aplicaciones no está disponible en esta plataforma.'}</p>
      </section>

      <section className="notia-meeting-transcript">
        <label htmlFor="meeting-transcript">Transcripción</label>
        {voice.state.status === 'completed' && speakerNames.length > 0 ? (
          <div className="notia-meeting-speaker-names" aria-label="Nombres de los hablantes">
            {speakerNames.map((speaker, index) => (
              <label key={index}>
                <span>Hablante {index + 1}</span>
                <input
                  type="text"
                  value={speaker.draft}
                  aria-label={`Nombre para Hablante ${index + 1}`}
                  onChange={(event) => renameSpeaker(index, event.target.value)}
                />
              </label>
            ))}
          </div>
        ) : null}
        {voice.isActive || provisionalTranscript ? (
          <div
            id="meeting-transcript"
            className="notia-meeting-live-transcript"
            role="textbox"
            aria-label="Transcripción en tiempo real"
            aria-readonly="true"
            aria-live="polite"
          >
            {confirmedTranscript}
            {provisionalTranscript ? (
              <mark className="notia-meeting-provisional-text">{provisionalTranscript}</mark>
            ) : null}
            {!transcript ? <span className="notia-meeting-transcript-placeholder">La transcripción aparecerá acá mientras hablan…</span> : null}
          </div>
        ) : (
          <textarea
            id="meeting-transcript"
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="La transcripción aparecerá acá mientras hablan…"
            spellCheck
          />
        )}
      </section>

      {voice.state.status === 'completed' && transcript.trim() ? (
        <div className="notia-meeting-ai-actions">
          <NotiaButton variant="secondary" onClick={() => void improveTranscript()} disabled={isImproving}>
            <Sparkles size={18} /> {isImproving ? 'Mejorando transcripción…' : 'Pasar por IA'}
          </NotiaButton>
          {aiError ? <span role="alert">{aiError}</span> : null}
        </div>
      ) : null}

      {voice.state.status === 'error' ? (
        <div className="notia-meeting-error" role="alert">
          <span>{voice.state.error.message}</span>
          <NotiaButton variant="ghost" onClick={voice.dismissError}>Cerrar</NotiaButton>
        </div>
      ) : null}

      {voice.modelPreparationError && voice.state.status !== 'error' ? (
        <div className="notia-meeting-error" role="alert">
          <span>{voice.modelPreparationError}</span>
        </div>
      ) : null}

      <div className="notia-meeting-controls" aria-label="Controles de grabación">
        {voice.state.status === 'recording' ? (
          <NotiaButton variant="secondary" onClick={() => void voice.pause()}><Pause size={18} /> Pausar</NotiaButton>
        ) : voice.state.status === 'paused' ? (
          <NotiaButton variant="secondary" onClick={() => void voice.resume()}><Play size={18} /> Reanudar</NotiaButton>
        ) : null}
        {voice.isActive ? (
          <NotiaButton variant="primary" onClick={() => void voice.stop()} disabled={isBusy}><CircleStop size={18} /> Finalizar</NotiaButton>
        ) : (
          <NotiaButton variant="primary" onClick={() => void voice.start()} disabled={isBusy || !voice.isModelReady}><Mic size={18} /> Iniciar grabación</NotiaButton>
        )}
        {voice.isActive ? (
          <NotiaButton variant="ghost" onClick={() => void voice.cancel()}><RotateCcw size={18} /> Cancelar</NotiaButton>
        ) : null}
      </div>
    </main>
  )
}

export const MeetingView = memo(MeetingViewComponent)
MeetingView.displayName = 'MeetingView'
