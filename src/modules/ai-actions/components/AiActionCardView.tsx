import { Clock, RotateCcw } from 'lucide-react'
import type { ActionCard } from '../types/aiActionsTypes'
import { KIND_VISUALS } from './aiActionsKinds'
import { StatusBadge } from './aiActionsVisuals'

interface AiActionCardViewProps {
  card: ActionCard
  busy: boolean
  onOpen: (card: ActionCard) => void
  onToggle: (card: ActionCard) => void
  onRetry: (card: ActionCard) => void
}

/**
 * Tarjeta de una acción. El nombre es el botón que abre la edición y cubre la
 * tarjeta entera; el switch y «Reintentar» quedan por encima.
 */
export function AiActionCardView({ card, busy, onOpen, onToggle, onRetry }: AiActionCardViewProps) {
  const KindIcon = KIND_VISUALS[card.kind].icon
  const recurring = card.kind === 'recurring'
  return (
    <article className="aia-card" data-tone={card.status.tone} data-enabled={card.enabled}>
      <div className="aia-card__head">
        <h3 className="aia-card__title">
          <button type="button" className="aia-card__open" onClick={() => onOpen(card)}>{card.name}</button>
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={card.enabled}
          aria-label={`${card.enabled ? 'Pausar' : 'Activar'}: ${card.name}`}
          className="aia-switch"
          disabled={busy}
          onClick={() => onToggle(card)}
        >
          <span className="aia-switch__track"><span className="aia-switch__knob" /></span>
        </button>
      </div>
      <div className="aia-card__prompt">
        <span className="aia-card__prompt-label">PROMPT</span>
        <p>{card.prompt}</p>
      </div>
      <div className="aia-card__meta" data-accent={recurring ? KIND_VISUALS.recurring.accent : undefined}>
        <KindIcon size={14} strokeWidth={1.9} aria-hidden="true" />
        <span>{card.when}</span>
      </div>
      {recurring && (
        <div className="aia-card__meta aia-card__meta--split">
          <span className="aia-card__next"><Clock size={14} strokeWidth={1.9} aria-hidden="true" />Próxima: {card.nextLabel}</span>
          <span>{card.runsLabel}</span>
        </div>
      )}
      <div className="aia-card__foot">
        <StatusBadge status={card.status} />
        {card.retryRunId && (
          <button type="button" className="aia-button aia-button--small" disabled={busy} onClick={() => onRetry(card)}>
            <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
            Reintentar
          </button>
        )}
      </div>
    </article>
  )
}
