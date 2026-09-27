import { useState } from 'react'
import { Calendar } from 'lucide-react'
import type { HomeAgenda, HomeCard } from '../../../../services/home/homeTypes'
import { HomeCardShell, HomeMoreButton } from './HomeCardShell'
import { countLabel } from './homeDisplay'

interface HomeAgendaCardProps {
  card: HomeCard<HomeAgenda>
  onOpenAgenda: () => void
}

/** The next seven days of the Agenda; a day shows only its events. */
export function HomeAgendaCard({ card, onOpenAgenda }: HomeAgendaCardProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const agenda = card.data
  const selectedDay = agenda?.days.find((day) => day.date === selectedDate) ?? null
  const events = agenda?.events.filter((event) => !selectedDay || event.date === selectedDay.date) ?? []

  return (
    <HomeCardShell
      id="home-agenda-title"
      title="Agenda"
      icon={<Calendar size={15} strokeWidth={1.75} />}
      className="home-card--agenda"
      error={card.error}
      action={<HomeMoreButton label="Abrir calendario" onClick={onOpenAgenda} />}
    >
      {agenda ? (
        <>
          <div className="home-days">
            {agenda.days.map((day) => {
              const isSelected = day.date === selectedDate
              return (
                <button
                  key={day.date}
                  type="button"
                  className={`home-day${day.isToday ? ' home-day--today' : ''}${isSelected ? ' home-day--selected' : ''}`}
                  aria-pressed={isSelected}
                  aria-label={`${day.label}${day.isToday ? ', hoy' : ''}${day.hasEvents ? ', con eventos' : ''}`}
                  onClick={() => setSelectedDate(isSelected ? null : day.date)}
                >
                  <span className="home-day__name">{day.weekday}</span>
                  <span className="home-day__number">{day.day}</span>
                  <span className={day.hasEvents ? 'home-day__dot' : 'home-day__no-dot'} />
                </button>
              )
            })}
          </div>
          <div className="home-divider" />
          <div className="home-list-head">
            <span className="home-label">{selectedDay ? `Eventos del ${selectedDay.label}` : 'Próximos 7 días'}</span>
            <span className="home-card__sub">{countLabel(events.length, 'evento', 'eventos')}</span>
          </div>
          <div className="home-scroll home-rows home-rows--agenda">
            {events.length === 0 ? (
              <p className="home-empty">{selectedDay ? 'Día libre.' : 'Semana libre.'} Agendá algo desde el calendario.</p>
            ) : null}
            {events.map((event) => (
              <button key={event.id} type="button" className="home-row" onClick={onOpenAgenda}>
                <span className="home-event-time">
                  <b>{event.time}</b>
                  <span>{event.dayLabel}</span>
                </span>
                <span className="home-row__text">
                  <span className="home-row__title">{event.title}</span>
                  <span className="home-row__meta">{event.range}</span>
                </span>
                <span className="home-chip" data-chip={event.priority}><i aria-hidden="true" />{event.priorityLabel}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </HomeCardShell>
  )
}
