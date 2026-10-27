import { useState } from 'react'
import { ArrowLeft, CheckCircle2, CircleDot, CircleX, Play, Square, Trash2, Zap } from 'lucide-react'
import { ChatMarkdownMessage } from '../../../components/notia/views/chat/ChatMarkdownMessage'
import type { AiTaskAnswer, AiTaskDetail, AiTaskStepView } from '../types/aiTasksTypes'
import { AiTaskApprovalCard } from './AiTaskApprovalCard'
import { AiTaskWorkflowGraph } from './AiTaskWorkflowGraph'

interface AiTaskDetailPanelProps {
  task: AiTaskDetail
  busy: boolean
  onBack: () => void
  onAnswer: (approvalId: string, answer: AiTaskAnswer) => void
  onCancel: () => void
  onResume: () => void
  onDelete: () => void
}

function StepIcon({ step }: { step: AiTaskStepView }) {
  if (step.status === 'done') return <CheckCircle2 size={16} aria-hidden="true" />
  if (step.status === 'failed') return <CircleX size={16} aria-hidden="true" />
  return <CircleDot size={16} aria-hidden="true" />
}

function StepItem({ step }: { step: AiTaskStepView }) {
  const [open, setOpen] = useState(step.status === 'running' || step.status === 'failed')
  return (
    <li className="ait-step" data-status={step.status}>
      <button type="button" className="ait-step__head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <StepIcon step={step} />
        <span className="ait-step__number">{step.number}</span>
        <span className="ait-step__title">{step.title}</span>
        <span className="ait-chip" data-status={step.status}>{step.statusLabel}</span>
      </button>
      {open ? (
        <div className="ait-step__body">
          <p className="ait-step__meta">{step.roundLabel}{step.timeLabel ? ` · ${step.timeLabel}` : ''}</p>
          {step.detail ? <p className="ait-step__detail">{step.detail}</p> : null}
          {step.report ? <div className="ait-step__report"><ChatMarkdownMessage source={step.report} /></div> : null}
        </div>
      ) : null}
    </li>
  )
}

export function AiTaskDetailPanel({ task, busy, onBack, onAnswer, onCancel, onResume, onDelete }: AiTaskDetailPanelProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const pending = task.pending

  return (
    <article className="ait-detail" aria-labelledby="ait-detail-title">
      <header className="ait-detail__header">
        <button type="button" className="ait-icon-button ait-detail__back" aria-label="Volver a la lista" onClick={onBack}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <div className="ait-detail__heading">
          <h2 id="ait-detail-title">{task.title}</h2>
          <p className="ait-detail__meta">
            <span className="ait-chip" data-status={task.status}>{task.statusLabel}</span>
            <span>{task.phaseLabel}</span>
            <span>· {task.originLabel} · {task.createdLabel}</span>
            {task.approveAll ? <span className="ait-badge"><Zap size={12} aria-hidden="true" /> Aprobar todo</span> : null}
          </p>
        </div>
        <div className="ait-detail__actions">
          {task.canResume ? (
            <button type="button" className="ait-button ait-button--primary" disabled={busy} onClick={onResume}>
              <Play size={14} aria-hidden="true" /> Reanudar
            </button>
          ) : null}
          {task.canCancel ? (
            <button type="button" className="ait-button" disabled={busy} onClick={onCancel}>
              <Square size={14} aria-hidden="true" /> Cancelar
            </button>
          ) : null}
          {confirmingDelete ? (
            <>
              <button type="button" className="ait-button ait-button--danger" disabled={busy} onClick={onDelete}>Sí, borrar</button>
              <button type="button" className="ait-button" disabled={busy} onClick={() => setConfirmingDelete(false)}>No</button>
            </>
          ) : (
            <button type="button" className="ait-icon-button" aria-label="Borrar la tarea" title="Borrar la tarea" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {pending ? <AiTaskApprovalCard key={pending.id} approval={pending} busy={busy} onAnswer={(answer) => onAnswer(pending.id, answer)} /> : null}

      {task.error ? <p className="ait-error" role="alert">{task.error}</p> : null}

      {task.result ? (
        <section className="ait-section ait-result" aria-labelledby="ait-result-title">
          <h3 id="ait-result-title">Resultado</h3>
          <ChatMarkdownMessage source={task.result} />
        </section>
      ) : null}

      <section className="ait-section" aria-labelledby="ait-flow-title">
        <h3 id="ait-flow-title">Flujo</h3>
        <AiTaskWorkflowGraph code={task.workflow} />
      </section>

      <section className="ait-section" aria-labelledby="ait-goal-title">
        <h3 id="ait-goal-title">Objetivo</h3>
        <p className="ait-goal">{task.goal}</p>
      </section>

      <section className="ait-section" aria-labelledby="ait-steps-title">
        <h3 id="ait-steps-title">Paso a paso <span className="ait-count">{task.doneSteps} / {task.totalSteps}</span></h3>
        {task.steps.length === 0 ? <p className="ait-empty-line">El Planificador todavía está armando el plan.</p> : (
          <ol className="ait-steps">
            {task.steps.map((step) => <StepItem key={step.id} step={step} />)}
          </ol>
        )}
      </section>

      {task.reviews.length > 0 ? (
        <section className="ait-section" aria-labelledby="ait-reviews-title">
          <h3 id="ait-reviews-title">Revisiones</h3>
          <ol className="ait-reviews">
            {task.reviews.map((review) => (
              <li key={review.number} className="ait-review" data-approved={review.approved}>
                <p className="ait-review__head">
                  <span className="ait-chip" data-status={review.approved ? 'done' : 'failed'}>{review.verdictLabel}</span>
                  <span>Revisión {review.number} · {review.timeLabel}</span>
                </p>
                {review.feedback ? <ChatMarkdownMessage source={review.feedback} /> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p className="ait-expires">{task.expiresLabel}</p>
    </article>
  )
}
