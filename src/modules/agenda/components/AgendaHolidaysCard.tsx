import { Calendar } from 'lucide-react'
import type { AgendaHolidays } from '../types/agendaTypes'

interface AgendaHolidaysCardProps {
  holidays: AgendaHolidays
  onPickDate: (date: string) => void
}

export function AgendaHolidaysCard({ holidays, onPickDate }: AgendaHolidaysCardProps) {
  const { next, afterLabel, emptyLabel } = holidays
  return (
    <section className="agenda-card" aria-labelledby="agenda-holidays-title">
      <div className="agenda-card__head">
        <h2 id="agenda-holidays-title">Feriados</h2>
      </div>
      {next ? (
        <button type="button" className="agenda-holiday" data-holiday={next.kind} onClick={() => onPickDate(next.date)}>
          <span className="agenda-holiday__countdown">
            <Calendar size={14} aria-hidden="true" />
            {next.countdownLabel}
          </span>
          <span className="agenda-holiday__name">{next.name}</span>
          <span className="agenda-holiday__when">{next.dateLabel} · {next.kindLabel}</span>
        </button>
      ) : (
        <p className="agenda-empty">{emptyLabel}</p>
      )}
      {afterLabel ? (
        <div className="agenda-holiday-after">
          <span className="agenda-holiday-after__title">Después</span>
          <span className="agenda-holiday-after__text">{afterLabel}</span>
        </div>
      ) : null}
    </section>
  )
}
