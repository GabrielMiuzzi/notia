import { Clock, Flame } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import type { RecipeCard } from '../types/recipesTypes'
import { RecipeVisual } from './RecipeVisual'

interface RecipeCardViewProps {
  library: NotiaLibrary
  card: RecipeCard
  onOpen: (id: string) => void
}

export function RecipeCardView({ library, card, onOpen }: RecipeCardViewProps) {
  return (
    <button type="button" className="rcp-card" data-meal={card.meal} onClick={() => onOpen(card.id)}>
      <span className="rcp-card__thumb">
        <RecipeVisual library={library} id={card.id} name={card.name} photoKey={card.photoKey} hasPhoto={card.hasPhoto} />
      </span>
      <span className="rcp-card__body">
        <span className="rcp-chip"><span className="rcp-dot" aria-hidden="true" />{card.mealLabel}</span>
        <span className="rcp-card__name">{card.name}</span>
        <span className="rcp-meta">
          <span><Flame size={15} strokeWidth={1.8} aria-hidden="true" />{card.kcalLabel}</span>
          {card.minutesLabel && <span><Clock size={15} strokeWidth={1.8} aria-hidden="true" />{card.minutesLabel}</span>}
        </span>
        <span className="rcp-macro-bar" aria-hidden="true">
          {card.macros.map((share) => <i key={share.key} data-macro={share.key} style={{ width: `${share.percent}%` }} />)}
        </span>
        <span className="rcp-macro-legend">
          {card.macros.map((share) => (
            <span key={share.key}><b data-macro={share.key}>{share.initial}</b> {share.gramsLabel}</span>
          ))}
        </span>
      </span>
    </button>
  )
}
