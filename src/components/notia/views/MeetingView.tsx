import { memo, useState } from 'react'
import { CircleStop, Mic, MonitorSpeaker, Pause, Play, RotateCcw, Users } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { useVoiceTranscription } from './chat/useVoiceTranscription'

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function MeetingViewComponent() {
  const [transcript, setTranscript] = useState('')
  const voice = useVoiceTranscription({ draft: transcript, setDraft: setTranscript, captureSystemAudio: true })
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
              : voice.state.status === 'preparing' ? 'Preparando modelos…'
                : voice.state.status === 'finalizing' ? 'Separando hablantes…'
                  : voice.state.status === 'completed' ? 'Transcripción finalizada'
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

      {voice.state.status === 'error' ? (
        <div className="notia-meeting-error" role="alert">
          <span>{voice.state.error.message}</span>
          <NotiaButton variant="ghost" onClick={voice.dismissError}>Cerrar</NotiaButton>
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
          <NotiaButton variant="primary" onClick={() => void voice.start()} disabled={isBusy}><Mic size={18} /> Iniciar grabación</NotiaButton>
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
