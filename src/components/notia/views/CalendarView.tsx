import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { getArgentinaHolidays, type CalendarHoliday } from '../../../modules/calendar/services/argentinaHolidaysService'

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function CalendarViewComponent() {
  const today = new Date()
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const calendarYear = month.getFullYear()

  const loadHolidays = useCallback(async () => {
    setStatus('loading')
    try {
      setHolidays(await getArgentinaHolidays(calendarYear))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [calendarYear])

  useEffect(() => { void loadHolidays() }, [loadHolidays])

  const days = useMemo(() => {
    const firstDay = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    return [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]
  }, [month])
  const holidaysByDate = useMemo(() => new Map(holidays.map((holiday) => [holiday.date, holiday])), [holidays])
  const formatDate = (day: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const changeMonth = (offset: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))

  return <main className="notia-main calendar-view" aria-labelledby="calendar-title">
    <header className="calendar-view__header">
      <div><span className="calendar-view__eyebrow">Argentina</span><h1 id="calendar-title">Calendario</h1><p>Feriados nacionales y bancarios, siempre a mano.</p></div>
      <button type="button" className="notia-button notia-button--secondary calendar-view__refresh" onClick={() => void loadHolidays()} disabled={status === 'loading'} aria-label="Actualizar feriados"><RefreshCw size={16} className={status === 'loading' ? 'calendar-spin' : ''} /> Actualizar</button>
    </header>
    <section className="calendar-card" aria-label={`Calendario de ${MONTH_NAMES[month.getMonth()]} de ${month.getFullYear()}`}>
      <div className="calendar-card__toolbar"><button type="button" className="notia-button notia-button--icon" onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={18} /></button><h2>{MONTH_NAMES[month.getMonth()]} <span>{month.getFullYear()}</span></h2><button type="button" className="notia-button notia-button--icon" onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={18} /></button></div>
      {status === 'error' ? <p className="calendar-message" role="alert">No se pudieron cargar los feriados. Revisá la conexión e intentá nuevamente.</p> : null}
      <div className="calendar-grid calendar-grid--weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid calendar-grid--days">{days.map((day, index) => {
        if (day === null) return <span key={`empty-${index}`} aria-hidden="true" />
        const holiday = holidaysByDate.get(formatDate(day))
        const isToday = formatDate(day) === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        return <div key={day} className={`calendar-day ${isToday ? 'calendar-day--today' : ''} ${holiday ? `calendar-day--${holiday.kind}` : ''}`} title={holiday?.name}>
          <span>{day}</span>{holiday ? <small>{holiday.kind === 'bank' ? 'Bancario' : 'Feriado'}</small> : null}
        </div>
      })}</div>
      <div className="calendar-legend"><span><i className="calendar-dot calendar-dot--national" />Feriado nacional</span><span><i className="calendar-dot calendar-dot--bank" />Feriado bancario</span></div>
    </section>
    <p className="calendar-source">Datos provistos por ArgentinaDatos.</p>
  </main>
}

export const CalendarView = memo(CalendarViewComponent)
CalendarView.displayName = 'CalendarView'
