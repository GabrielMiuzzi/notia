import type { AgendaHolidayKind } from '../../types/agendaTypes'

const ITEMS: Array<{ kind: AgendaHolidayKind; label: string }> = [
  { kind: 'fixed', label: 'Inamovible' },
  { kind: 'move', label: 'Trasladable' },
  { kind: 'bridge', label: 'Puente' },
  { kind: 'nonwork', label: 'No laborable' },
]

/** Celular: la leyenda corta de los tipos de feriado del mes. */
export function AgendaPhoneLegend() {
  return (
    <ul className="agenda-phone-legend" aria-label="Tipos de feriado">
      {ITEMS.map((item) => (
        <li key={item.kind} className="agenda-phone-legend__item">
          <span className="agenda-phone-legend__swatch" data-holiday={item.kind} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
