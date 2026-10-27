import { useState } from 'react'
import { CircleHelp, ShieldCheck } from 'lucide-react'
import type { AiTaskAnswer, AiTaskApprovalView } from '../types/aiTasksTypes'

interface AiTaskApprovalCardProps {
  approval: AiTaskApprovalView
  busy: boolean
  onAnswer: (answer: AiTaskAnswer) => void
}

/**
 * Lo que la tarea espera de la persona: un cambio o un plan para confirmar
 * (con las mismas cuatro opciones que en el chat y Telegram) o una pregunta.
 * Rust valida la respuesta y arma la decisión.
 */
export function AiTaskApprovalCard({ approval, busy, onAnswer }: AiTaskApprovalCardProps) {
  const [proposing, setProposing] = useState(false)
  const [text, setText] = useState('')
  const question = approval.kind === 'clarification'
  const Icon = question ? CircleHelp : ShieldCheck

  return (
    <section className="ait-approval" aria-labelledby={`ait-approval-${approval.id}`}>
      <div className="ait-approval__head">
        <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
        <h3 id={`ait-approval-${approval.id}`}>{approval.heading}</h3>
      </div>
      <p className="ait-approval__title">{approval.title}</p>
      {approval.detail ? <pre className="ait-approval__detail">{approval.detail}</pre> : null}

      {question ? (
        <>
          {approval.options.length > 0 ? (
            <div className="ait-approval__options" role="group" aria-label="Opciones">
              {approval.options.map((option, index) => (
                <button key={option} type="button" className="ait-button" disabled={busy} onClick={() => onAnswer({ choice: 'answer', optionIndex: index })}>
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          <label className="ait-approval__field">
            <span>Tu respuesta</span>
            <textarea value={text} rows={3} onChange={(event) => setText(event.target.value)} disabled={busy} />
          </label>
          <div className="ait-approval__actions">
            <button type="button" className="ait-button ait-button--primary" disabled={busy || !text.trim()} onClick={() => onAnswer({ choice: 'answer', text })}>
              Responder
            </button>
          </div>
        </>
      ) : proposing ? (
        <>
          <label className="ait-approval__field">
            <span>¿Qué querés que haga en su lugar?</span>
            <textarea value={text} rows={3} onChange={(event) => setText(event.target.value)} disabled={busy} autoFocus />
          </label>
          <div className="ait-approval__actions">
            <button type="button" className="ait-button ait-button--primary" disabled={busy || !text.trim()} onClick={() => onAnswer({ choice: 'propose', text })}>
              Enviar propuesta
            </button>
            <button type="button" className="ait-button" disabled={busy} onClick={() => setProposing(false)}>
              Volver
            </button>
          </div>
        </>
      ) : (
        <div className="ait-approval__actions">
          <button type="button" className="ait-button ait-button--primary" disabled={busy} onClick={() => onAnswer({ choice: 'confirm' })}>
            Confirmar
          </button>
          <button type="button" className="ait-button" disabled={busy} onClick={() => onAnswer({ choice: 'confirm-all' })}>
            Confirmar todos
          </button>
          <button type="button" className="ait-button" disabled={busy} onClick={() => setProposing(true)}>
            Proponer otra cosa
          </button>
          <button type="button" className="ait-button ait-button--danger" disabled={busy} onClick={() => onAnswer({ choice: 'cancel' })}>
            Cancelar
          </button>
        </div>
      )}
    </section>
  )
}
