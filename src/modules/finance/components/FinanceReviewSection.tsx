import { useState, type UIEvent } from 'react'
import type { ReviewCard } from '../types/financeScreen'

interface Props {
  cards: ReviewCard[]
  onOpenChat: (prompt: string) => void
}

/**
 * «Para revisar»: each answer goes to the chat composer, and nothing changes
 * until the person sends it and confirms there. On a phone the cards slide
 * sideways, one at a time.
 */
export function FinanceReviewSection({ cards, onOpenChat }: Props) {
  const [visible, setVisible] = useState(0)
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollLeft, clientWidth } = event.currentTarget
    if (clientWidth > 0) setVisible(Math.min(cards.length - 1, Math.round(scrollLeft / clientWidth)))
  }
  return <section className="finance-review" aria-labelledby="finance-review-title">
    <div className="finance-review__head">
      <div className="finance-review__title">
        <span className="finance-dot" aria-hidden="true" />
        <h2 id="finance-review-title">Para revisar · {cards.length}</h2>
      </div>
      <p className="finance-card__sub finance-only-wide">Cada respuesta va al chat; nada cambia hasta que la confirmes ahí.</p>
      {cards.length > 1 && <span className="finance-card__sub finance-only-narrow" aria-live="polite">{visible + 1} de {cards.length}</span>}
    </div>
    <div className="finance-review__cards" onScroll={handleScroll}>
      {cards.map((card) => <FinanceReviewCard key={card.id} card={card} onOpenChat={onOpenChat} />)}
    </div>
  </section>
}

export function FinanceReviewCard({ card, onOpenChat, tone = 'review' }: { card: ReviewCard; onOpenChat: (prompt: string) => void; tone?: 'review' | 'note' }) {
  return <article className={`finance-review-card finance-review-card--${tone}`}>
    {tone === 'review' && <span className="finance-review-card__label finance-only-wide">{card.label}</span>}
    <p className="finance-review-card__text">
      {card.parts.map((part, index) => part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>)}
    </p>
    <div className="finance-review-card__actions">
      {card.actions.map((action) => <button key={action.label} type="button" className={`finance-button ${action.primary ? 'finance-button--outline' : 'finance-button--quiet-outline'} finance-button--small`} onClick={() => onOpenChat(action.prompt)}>{action.label}</button>)}
    </div>
  </article>
}
