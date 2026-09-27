import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

interface HomeCardShellProps {
  id: string
  title: string
  icon: ReactNode
  /** Next to the title: «· 17 completadas». */
  note?: string
  /** Right side of the head. */
  action?: ReactNode
  /** Why the card's module could not be read; it replaces the content. */
  error?: string
  className: string
  children?: ReactNode
}

/** A card of Home: icon and title, an action on the right and its content. */
export function HomeCardShell({ id, title, icon, note, action, error, className, children }: HomeCardShellProps) {
  return (
    <section className={`home-card ${className}`} aria-labelledby={id}>
      <div className="home-card__head">
        <h2 className="home-card__title" id={id}>
          <span className="home-card__icon" aria-hidden="true">{icon}</span>
          {title}
          {note ? <span className="home-card__sub">· {note}</span> : null}
        </h2>
        {action}
      </div>
      {error ? <p className="home-card__error" role="alert">{error}</p> : children}
    </section>
  )
}

/** «Abrir calendario ›»: goes to the module the card sums up. */
export function HomeMoreButton({ label, ariaLabel, onClick }: { label: string; ariaLabel?: string; onClick: () => void }) {
  return (
    <button type="button" className="home-more" aria-label={ariaLabel} onClick={onClick}>
      {label}
      <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}
