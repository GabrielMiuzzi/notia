import { useState } from 'react'
import { Check } from 'lucide-react'
import { formatClock } from './meetingDisplay'
import type { SpeechFinalizingStage } from '../../../../services/speech/speechTypes'
import type { MeetingLine, MeetingSourceFile } from '../../../../services/meeting/meetingTypes'

const STAGES: SpeechFinalizingStage[] = ['transcribing', 'detecting-speakers', 'assigning-turns']
const LATER_STEP_LABELS: Record<Exclude<SpeechFinalizingStage, 'transcribing'>, string> = {
  'detecting-speakers': 'Detectando voces',
  'assigning-turns': 'Asignando intervenciones',
}

interface MeetingProcessingPanelProps {
  durationMs: number
  progress: number | undefined
  stage: SpeechFinalizingStage | undefined
  lines: MeetingLine[]
  /** The file being transcribed; `undefined` for a recording. */
  sourceFile?: MeetingSourceFile
  isSkipping: boolean
  onSkip: () => void
  /** Stops a file's transcription and drops its meeting. */
  onCancelFile?: () => void
}

export function MeetingProcessingPanel({
  durationMs,
  progress,
  stage,
  lines,
  sourceFile,
  isSkipping,
  onSkip,
  onCancelFile,
}: MeetingProcessingPanelProps) {
  const [showText, setShowText] = useState(false)
  const currentStage = stage ?? 'transcribing'
  const current = STAGES.indexOf(currentStage)
  const percent = Math.round((progress ?? 0) * 100)
  // A file is transcribed here; a recording was already transcribed live.
  const transcribingFile = Boolean(sourceFile) && currentStage === 'transcribing'
  const steps = STAGES.map((step) => ({
    stage: step,
    label: step !== 'transcribing' ? LATER_STEP_LABELS[step]
      : !sourceFile ? 'Transcripción completa'
        : transcribingFile ? 'Transcribiendo el archivo' : 'Archivo transcripto',
  }))
  const title = transcribingFile ? 'Transcribiendo el archivo…'
    : isSkipping ? 'Terminando sin separar hablantes…' : 'Separando hablantes…'

  return (
    <section className="notia-meeting-card notia-meeting-processing" aria-labelledby="meeting-processing-title">
      <header className="notia-meeting-card-header">
        <h2>Transcripción</h2>
        {sourceFile
          ? <span className="notia-meeting-mono notia-meeting-processing-file" title={sourceFile.name}>{sourceFile.name}</span>
          : <span className="notia-meeting-mono">{formatClock(durationMs)} grabados</span>}
      </header>
      <div className="notia-meeting-processing-body">
        <div className="notia-meeting-processing-status">
          <span className="notia-meeting-spinner" aria-hidden="true" />
          <div>
            <strong id="meeting-processing-title">{title}</strong>
            <p>Podés seguir usando Notia; la reunión queda lista en esta pestaña.</p>
          </div>
        </div>
        <div className="notia-meeting-progress">
          <div
            className="notia-meeting-progress-track"
            role="progressbar"
            aria-label={transcribingFile ? 'Progreso de la transcripción del archivo' : 'Progreso de la separación de hablantes'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress === undefined ? undefined : percent}
          >
            <div style={{ width: `${progress === undefined ? 4 : Math.max(4, percent)}%` }} />
          </div>
          <span className="notia-meeting-mono">{progress === undefined ? '—' : `${percent}%`}</span>
        </div>
        <ol className="notia-meeting-processing-steps">
          {steps.map((step, index) => (
            <li key={step.stage} data-state={index < current ? 'done' : index === current ? 'current' : 'pending'}>
              <span aria-hidden="true">{index < current ? <Check size={16} /> : <i />}</span>
              {step.label}
            </li>
          ))}
        </ol>
        <div className="notia-meeting-processing-actions">
          <button type="button" className="notia-meeting-secondary-button" aria-expanded={showText} onClick={() => setShowText((value) => !value)}>
            {showText ? 'Ocultar texto' : transcribingFile ? 'Ver lo transcripto' : 'Ver texto sin separar'}
          </button>
          {transcribingFile && onCancelFile ? (
            <button type="button" className="notia-meeting-ghost-button" onClick={onCancelFile}>
              Cancelar transcripción
            </button>
          ) : (
            <button type="button" className="notia-meeting-ghost-button" onClick={onSkip} disabled={isSkipping}>
              Cancelar separación
            </button>
          )}
        </div>
        {showText ? (
          <div className="notia-meeting-raw-text">
            {lines.length === 0 ? <p className="notia-meeting-empty-text">{transcribingFile ? 'Todavía no hay texto.' : 'No se reconoció texto.'}</p> : lines.map((line) => (
              <p key={line.id}><time>{formatClock(line.startMs)}</time>{line.text}</p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
