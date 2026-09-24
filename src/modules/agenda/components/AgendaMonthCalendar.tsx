import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgendaMonth } from '../types/agendaTypes'

interface AgendaMonthCalendarProps {
  month: AgendaMonth
  onPickDate: (date: string) => void
  onShowMonth: (month: string) => void
  onToday: () => void
}

export function AgendaMonthCalendar({ month, onPickDate, onShowMonth, onToday }: AgendaMonthCalendarProps) {
  return (
    <section className="agenda-card" aria-labelledby="agenda-month-title">
      <div className="agenda-card__head">
        <h2 id="agenda-month-title" aria-live="polite">{month.label}</h2>
        <div className="agenda-card__actions">
          <button type="button" className="agenda-pill" onClick={onToday}>Hoy</button>
          <button type="button" className="agenda-round" aria-label="Mes anterior" onClick={() => onShowMonth(month.prevMonth)}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="agenda-round" aria-label="Mes siguiente" onClick={() => onShowMonth(month.nextMonth)}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="agenda-month">
        {month.weekdays.map((weekday) => <div key={weekday} className="agenda-month__weekday" aria-hidden="true">{weekday}</div>)}
        {month.cells.map((cell) => (
          <button
            key={cell.date}
            type="button"
            className="agenda-month__day"
            data-outside={!cell.inMonth}
            data-today={cell.isToday}
            data-selected={cell.isSelected}
            aria-label={cell.ariaLabel}
            aria-pressed={cell.isSelected}
            aria-current={cell.isToday ? 'date' : undefined}
            onClick={() => onPickDate(cell.date)}
          >
            <span>{cell.day}</span>
            <span className="agenda-month__dot" data-visible={cell.hasEvents} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  )
}
