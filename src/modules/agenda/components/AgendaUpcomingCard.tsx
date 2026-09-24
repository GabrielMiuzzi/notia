import type { AgendaEvent } from '../types/agendaTypes'

interface AgendaUpcomingCardProps {
  events: AgendaEvent[]
  label: string
  onPick: (event: AgendaEvent) => void
}

export function AgendaUpcomingCard({ events, label, onPick }: AgendaUpcomingCardProps) {
  return (
    <section className="agenda-card" aria-labelledby="agenda-upcoming-title">
      <div className="agenda-card__head agenda-card__head--baseline">
        <h2 id="agenda-upcoming-title">Próximos eventos</h2>
        <span className="agenda-card__meta">{label}</span>
      </div>
      {events.length === 0 ? (
        <p className="agenda-empty">No hay eventos próximos. Agendá uno en la vista semanal.</p>
      ) : (
        <ul className="agenda-upcoming">
          {events.map((event) => (
            <li key={event.id}>
              <button type="button" className="agenda-upcoming__item" onClick={() => onPick(event)}>
                <span className="agenda-chip" data-priority={event.priority}>{event.priorityLabel}</span>
                <span className="agenda-upcoming__title">{event.title}</span>
                <span className="agenda-upcoming__when">{event.whenLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
