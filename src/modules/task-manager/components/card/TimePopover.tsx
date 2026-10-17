import { useEffect, useState, type RefObject } from 'react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { readNow, useNow } from './cardHooks'
import { Icon } from './icons'
import { Popover } from './Popover'
import { formatHours, isRunning, liveDedicatedHours, stepHours, summarizeTime } from './taskDisplay'
import { useTaskActions } from './taskInteractions'

interface TimePopoverProps {
  task: TaskItem
  anchorRef: RefObject<HTMLElement | null>
  side: 'left' | 'right'
  offset: number
}

const QUICK_ESTIMATES = [1, 2, 4, 8, 16]
const HOUR_MS = 3_600_000

/** A value sent and not yet back from the backend; dedicated time keeps running from `atMs`. */
interface Draft {
  value: number
  atMs: number
}

/** «Tiempo de la tarea»: estimate in steps of 0.5 h, dedicated in steps of 0.25 h. */
export function TimePopover({ task, anchorRef, side, offset }: TimePopoverProps) {
  const actions = useTaskActions()
  const running = isRunning(task)
  const now = useNow(running)
  const [estimateDraft, setEstimateDraft] = useState<number | null>(null)
  const [dedicatedDraft, setDedicatedDraft] = useState<Draft | null>(null)

  // A new board from the backend replaces what was sent.
  useEffect(() => {
    setEstimateDraft(null)
  }, [task.estimatedHours])
  useEffect(() => {
    setDedicatedDraft(null)
  }, [task.dedicatedHours, task.startedAtUnixMs])

  const estimate = estimateDraft ?? (task.estimatedHours > 0 ? task.estimatedHours : 0)
  const spent = dedicatedDraft
    ? dedicatedDraft.value + (running ? Math.max(0, now - dedicatedDraft.atMs) / HOUR_MS : 0)
    : liveDedicatedHours(task, now)
  const summary = summarizeTime(spent, estimate)

  const sendEstimate = (hours: number) => {
    setEstimateDraft(hours)
    void actions.send({ kind: 'set-task-time', taskPath: task.filePath, estimatedHours: hours }, task.filePath)
  }

  const stepDedicated = (delta: number) => {
    const at = readNow()
    const base = dedicatedDraft
      ? dedicatedDraft.value + (running ? Math.max(0, at - dedicatedDraft.atMs) / HOUR_MS : 0)
      : liveDedicatedHours(task, at)
    const hours = stepHours(base, delta)
    setDedicatedDraft({ value: hours, atMs: at })
    void actions.send({ kind: 'set-task-time', taskPath: task.filePath, dedicatedHours: hours }, task.filePath)
  }

  const steps = [
    {
      label: 'Estimado',
      value: summary.hasEstimate ? formatHours(estimate) : '—',
      dec: () => sendEstimate(stepHours(estimate, -0.5)),
      inc: () => sendEstimate(stepHours(estimate, 0.5)),
    },
    {
      label: 'Dedicado',
      value: formatHours(spent),
      dec: () => stepDedicated(-0.25),
      inc: () => stepDedicated(0.25),
    },
  ]

  return (
    <Popover
      ariaLabel="Tiempo de la tarea"
      anchorRef={anchorRef}
      side={side}
      offset={offset}
      width={264}
      onClose={actions.closePop}
      className="tm-time-pop"
    >
      <div className="tm-time-head">
        <span className="tm-caps">Tiempo</span>
        <span className={`tm-time-state${summary.over ? ' is-over' : ''}`}>{summary.longLabel}</span>
      </div>
      <div className="tm-time-big">
        <span className="tm-time-spent">{summary.spentLabel}</span>
        <span className="tm-time-of">de {summary.estimateLabel}</span>
      </div>
      <div className="tm-bar tm-bar--time">
        <div className={`tm-bar-fill${summary.over ? ' is-over' : ''}`} style={{ width: `${summary.barPercent.toFixed(1)}%` }} />
      </div>
      {steps.map((step, index) => (
        <div key={step.label} className="tm-time-step">
          <span className="tm-time-step-label">{step.label}</span>
          <button
            type="button"
            className="tm-icon-btn tm-icon-btn--bordered tm-step-btn"
            aria-label={`Restar a ${step.label}`}
            onClick={step.dec}
            data-autofocus={index === 0 ? true : undefined}
          >
            <Icon name="minus" size={12} strokeWidth={2.6} />
          </button>
          <span className="tm-time-step-value">{step.value}</span>
          <button type="button" className="tm-icon-btn tm-icon-btn--bordered tm-step-btn" aria-label={`Sumar a ${step.label}`} onClick={step.inc}>
            <Icon name="plus" size={12} strokeWidth={2.6} />
          </button>
        </div>
      ))}
      <div className="tm-time-quick">
        <span className="tm-time-quick-label">Estimar</span>
        {QUICK_ESTIMATES.map((hours) => (
          <button
            key={hours}
            type="button"
            className={`tm-qchip${estimate === hours ? ' is-on' : ''}`}
            aria-pressed={estimate === hours}
            onClick={() => sendEstimate(hours)}
          >
            {hours} h
          </button>
        ))}
      </div>
      {running ? (
        <span className="tm-time-running">
          <span className="tm-dot-pulse" />
          En progreso: el tiempo se suma solo.
        </span>
      ) : null}
    </Popover>
  )
}
