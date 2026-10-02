import type { AgendaSelectedDay } from '../../types/agendaTypes'

/** Celular: el día elegido debajo del mes, con sus feriados. */
export function AgendaPhoneSelectedDay({ day }: { day: AgendaSelectedDay }) {
  return (
    <div className="agenda-day-box" aria-live="polite">
      <p className="agenda-day-box__title">{day.label}</p>
      {day.holidays.length === 0 ? (
        <p className="agenda-day-box__empty">Sin feriados este día.</p>
      ) : (
        <ul className="agenda-day-box__list">
          {day.holidays.map((holiday) => (
            <li key={`${holiday.kind}-${holiday.name}`} className="agenda-day-box__item">
              <span className="agenda-day-box__chip" data-holiday={holiday.kind}>{holiday.kindLabel}</span>
              <span className="agenda-day-box__name">{holiday.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
