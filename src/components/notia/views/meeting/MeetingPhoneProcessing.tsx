import { useState } from 'react'
import { Check } from 'lucide-react'
import type { MeetingProcessingPanelProps } from './MeetingProcessingPanel'
import { describeMeetingProcessing, formatClock } from './meetingDisplay'

/*
 * Processing stage of Meeting in the space of a phone (canvas «Notia ·
 * Meeting», board M3 «Separando hablantes»): the progress centered, the
 * actions at the bottom.
 */
export function MeetingPhoneProcessing({
  progress,
  stage,
  lines,
  sourceFile,
  isSkipping,
  onSkip,
  onCancelFile,
}: MeetingProcessingPanelProps) {
  const [showText, setShowText] = useState(false)
  const { transcribingFile, steps, title, percent } = describeMeetingProcessing({ progress, stage, sourceFile, isSkipping })

  return (
    <div className="notia-meeting-phone-stage">
      <section className="notia-meeting-phone-processing" aria-labelledby="meeting-phone-processing-title">
        <div className="notia-meeting-phone-processing-center">
          <span className="notia-meeting-spinner notia-meeting-phone-spinner" aria-hidden="true" />
          <div className="notia-meeting-phone-processing-title">
            <h2 id="meeting-phone-processing-title">{title}</h2>
            <p>Podés seguir usando Notia; la reunión queda lista en esta pestaña.</p>
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
          <ol className="notia-meeting-phone-steps">
            {steps.map((step) => (
              <li key={step.stage} data-state={step.state}>
                <span aria-hidden="true">{step.state === 'done' ? <Check size={18} strokeWidth={2.4} /> : <i />}</span>
                {step.label}
              </li>
            ))}
          </ol>
          {showText ? (
            <div className="notia-meeting-raw-text">
              {lines.length === 0 ? <p className="notia-meeting-empty-text">{transcribingFile ? 'Todavía no hay texto.' : 'No se reconoció texto.'}</p> : lines.map((line) => (
                <p key={line.id}><time>{formatClock(line.startMs)}</time>{line.text}</p>
              ))}
            </div>
          ) : null}
        </div>
      </section>
      <div className="notia-meeting-phone-foot notia-meeting-phone-processing-actions">
        <button type="button" className="notia-meeting-phone-secondary" aria-expanded={showText} onClick={() => setShowText((value) => !value)}>
          {showText ? 'Ocultar texto' : transcribingFile ? 'Ver lo transcripto' : 'Ver texto sin separar'}
        </button>
        {transcribingFile && onCancelFile ? (
          <button type="button" className="notia-meeting-phone-ghost" onClick={onCancelFile}>Cancelar transcripción</button>
        ) : (
          <button type="button" className="notia-meeting-phone-ghost" onClick={onSkip} disabled={isSkipping}>Cancelar separación</button>
        )}
      </div>
    </div>
  )
}
