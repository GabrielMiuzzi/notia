import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgendaHolidayKind, AgendaMonth } from '../types/agendaTypes'

interface AgendaMonthCalendarProps {
  month: AgendaMonth
  onPickDate: (date: string) => void
  onShowMonth: (month: string) => void
  onToday: () => void
}

/** Muestras fijas de la leyenda: un día de ejemplo de cada tipo de feriado. */
const HOLIDAY_LEGEND: Array<{ kind: AgendaHolidayKind; day: number; sample: string; label: string; detail: string }> = [
  { kind: 'fixed', day: 25, sample: 'Día de la Revolución de Mayo', label: 'Inamovible', detail: 'Siempre en su fecha' },
  { kind: 'move', day: 12, sample: 'Día del Respeto a la Diversidad Cultural', label: 'Trasladable', detail: 'Se puede mover a un lunes o viernes' },
  { kind: 'bridge', day: 7, sample: 'Día no laborable con fines turísticos', label: 'Puente turístico', detail: 'Arma fines de semana largos' },
  { kind: 'nonwork', day: 6, sample: 'Día del Bancario', label: 'No laborable', detail: 'Optativo según el empleador o solo bancario' },
]

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
            data-holiday={cell.holidayKind ?? undefined}
            title={cell.holidayTitle || undefined}
            aria-label={cell.ariaLabel}
            aria-pressed={cell.isSelected}
            aria-current={cell.isToday ? 'date' : undefined}
            onClick={() => onPickDate(cell.date)}
          >
            <span>{cell.day}</span>
            {cell.holidayName ? <span className="agenda-month__holiday">{cell.holidayName}</span> : null}
            <span className="agenda-month__dot" data-visible={cell.hasEvents} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="agenda-legend" aria-label="Referencias del calendario" role="group">
        <div className="agenda-legend__row">
          <span className="agenda-legend__title">Feriados</span>
          <ul className="agenda-legend__items agenda-legend__items--holidays">
            {HOLIDAY_LEGEND.map((item) => (
              <li key={item.kind} className="agenda-legend__item">
                <span className="agenda-month__day agenda-legend__sample agenda-legend__sample--wide" data-holiday={item.kind} aria-hidden="true">
                  <span>{item.day}</span>
                  <span className="agenda-month__holiday">{item.sample}</span>
                  <span className="agenda-month__dot" />
                </span>
                <span className="agenda-legend__text">
                  <span className="agenda-legend__label">{item.label}</span>
                  <span className="agenda-legend__detail">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="agenda-legend__row">
          <span className="agenda-legend__title">Días</span>
          <ul className="agenda-legend__items">
            <li className="agenda-legend__item">
              <span className="agenda-month__day agenda-legend__sample" data-today="true" aria-hidden="true"><span>27</span><span className="agenda-month__dot" /></span>
              <span className="agenda-legend__label agenda-legend__label--plain">Hoy</span>
            </li>
            <li className="agenda-legend__item">
              <span className="agenda-month__day agenda-legend__sample" data-selected="true" aria-hidden="true"><span>15</span><span className="agenda-month__dot" /></span>
              <span className="agenda-legend__label agenda-legend__label--plain">Seleccionado</span>
            </li>
            <li className="agenda-legend__item">
              <span className="agenda-month__day agenda-legend__sample agenda-legend__sample--outlined" aria-hidden="true"><span>18</span><span className="agenda-month__dot" data-visible="true" /></span>
              <span className="agenda-legend__label agenda-legend__label--plain">Con tareas</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}
