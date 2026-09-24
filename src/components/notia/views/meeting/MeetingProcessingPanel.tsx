import { useState } from 'react'
import { Check } from 'lucide-react'
import { formatClock } from './meetingDisplay'
import type { SpeechFinalizingStage } from '../../../../services/speech/speechTypes'
import type { MeetingLine } from '../../../../services/meeting/meetingTypes'

const STEPS: Array<{ stage: SpeechFinalizingStage; label: string }> = [
  { stage: 'transcribing', label: 'Transcripción completa' },
  { stage: 'detecting-speakers', label: 'Detectando voces' },
  { stage: 'assigning-turns', label: 'Asignando intervenciones' },
]

interface MeetingProcessingPanelProps {
  durationMs: number
  progress: number | undefined
  stage: SpeechFinalizingStage | undefined
  lines: MeetingLine[]
  isSkipping: boolean
  onSkip: () => void
}

export function MeetingProcessingPanel({ durationMs, progress, stage, lines, isSkipping, onSkip }: MeetingProcessingPanelProps) {
  const [showText, setShowText] = useState(false)
  const current = STEPS.findIndex((step) => step.stage === (stage ?? 'transcribing'))
  const percent = Math.round((progress ?? 0) * 100)

  return (
    <section className="notia-meeting-card notia-meeting-processing" aria-labelledby="meeting-processing-title">
      <header className="notia-meeting-card-header">
        <h2>Transcripción</h2>
        <span className="notia-meeting-mono">{formatClock(durationMs)} grabados</span>
      </header>
      <div className="notia-meeting-processing-body">
        <div className="notia-meeting-processing-status">
          <span className="notia-meeting-spinner" aria-hidden="true" />
          <div>
            <strong id="meeting-processing-title">{isSkipping ? 'Terminando sin separar hablantes…' : 'Separando hablantes…'}</strong>
            <p>Podés seguir usando Notia; la reunión queda lista en esta pestaña.</p>
          </div>
        </div>
        <div className="notia-meeting-progress">
          <div
            className="notia-meeting-progress-track"
            role="progressbar"
            aria-label="Progreso de la separación de hablantes"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress === undefined ? undefined : percent}
          >
            <div style={{ width: `${progress === undefined ? 4 : Math.max(4, percent)}%` }} />
          </div>
          <span className="notia-meeting-mono">{progress === undefined ? '—' : `${percent}%`}</span>
        </div>
        <ol className="notia-meeting-processing-steps">
          {STEPS.map((step, index) => (
            <li key={step.stage} data-state={index < current ? 'done' : index === current ? 'current' : 'pending'}>
              <span aria-hidden="true">{index < current ? <Check size={16} /> : <i />}</span>
              {step.label}
            </li>
          ))}
        </ol>
        <div className="notia-meeting-processing-actions">
          <button type="button" className="notia-meeting-secondary-button" aria-expanded={showText} onClick={() => setShowText((value) => !value)}>
            {showText ? 'Ocultar texto' : 'Ver texto sin separar'}
          </button>
          <button type="button" className="notia-meeting-ghost-button" onClick={onSkip} disabled={isSkipping}>
            Cancelar separación
          </button>
        </div>
        {showText ? (
          <div className="notia-meeting-raw-text">
            {lines.length === 0 ? <p className="notia-meeting-empty-text">No se reconoció texto.</p> : lines.map((line) => (
              <p key={line.id}><time>{formatClock(line.startMs)}</time>{line.text}</p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
