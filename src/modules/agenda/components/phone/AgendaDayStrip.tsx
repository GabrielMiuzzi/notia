import type { AgendaWeekDay } from '../../types/agendaTypes'

interface AgendaDayStripProps {
  days: AgendaWeekDay[]
  onPickDate: (date: string) => void
}

/** Celular: la tira de días de la semana elige qué día muestra la línea de tiempo. */
export function AgendaDayStrip({ days, onPickDate }: AgendaDayStripProps) {
  return (
    <div className="agenda-strip" role="group" aria-label="Días de la semana">
      {days.map((day) => (
        <button
          key={day.date}
          type="button"
          className="agenda-strip__day"
          data-selected={day.isSelected}
          data-today={day.isToday}
          data-holiday={day.holidayKind ?? undefined}
          aria-label={day.ariaLabel}
          aria-pressed={day.isSelected}
          aria-current={day.isToday ? 'date' : undefined}
          onClick={() => onPickDate(day.date)}
        >
          <span className="agenda-strip__name" aria-hidden="true">{day.initials}</span>
          <span className="agenda-strip__num" aria-hidden="true">{day.day}</span>
          <span className="agenda-month__dot" data-visible={day.hasEvents} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
