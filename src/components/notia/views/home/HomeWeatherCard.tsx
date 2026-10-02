import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { HomeWeather } from '../../../../services/home/weatherService'
import { HomeWeatherForecast, SkyIcon } from './HomeWeatherForecast'

interface HomeWeatherCardProps {
  weather: HomeWeather | null
  error: string | null
  isLoading: boolean
  onRetry: () => void
}

/**
 * Phone: the weather as a card under the greeting, with the next three days;
 * a tap opens the forecast in a bottom sheet over the view. The sheet is
 * positioned against the view (`.home-view--phone`), not the scrolled list.
 */
export function HomeWeatherCard({ weather, error, isLoading, onRetry }: HomeWeatherCardProps) {
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const sheetId = useId()

  const close = useCallback(() => {
    setOpen(false)
    cardRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    // The sheet is modal and its only control is «Cerrar»: Tab stays on it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!weather) {
    if (error) {
      return (
        <button type="button" className="home-mwx home-mwx--quiet" title={error} onClick={onRetry} disabled={isLoading}>
          Clima no disponible · Reintentar
        </button>
      )
    }
    return <div className="home-mwx home-mwx--quiet" role="status">Consultando el clima…</div>
  }

  const { now } = weather
  return (
    <>
      <button
        ref={cardRef}
        type="button"
        className="home-mwx"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="home-mwx__now">
          <SkyIcon sky={now.sky} size={34} strokeWidth={1.5} />
          <span className="home-mwx__temp">{now.temp}</span>
          <span className="home-mwx__text">
            <span className="home-mwx__cond">{now.condition}</span>
            <span className="home-wx-range home-mono">↑ {now.max} · ↓ {now.min} · {weather.place}</span>
          </span>
          <ChevronRight size={13} strokeWidth={2} className="home-wx-chevron" aria-hidden="true" />
        </span>
        {weather.next.length > 0 ? (
          <span className="home-mwx__next">
            {weather.next.map((day) => (
              <span key={day.day} className="home-mwx__day" title={day.title}>
                <span className="home-wx-mini-day">{day.day}</span>
                <SkyIcon sky={day.sky} size={16} />
                <span className="home-mono home-mwx__temps">{day.max}<span className="home-wx-muted">/{day.min}</span></span>
              </span>
            ))}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button type="button" className="home-sheet-scrim" aria-label="Cerrar pronóstico" tabIndex={-1} onClick={close} />
          <div className="home-wx-sheet" id={sheetId} role="dialog" aria-modal="true" aria-label={`Clima en ${weather.place}`}>
            <div className="home-wx-sheet__grab" aria-hidden="true" />
            <HomeWeatherForecast weather={weather} phone closeRef={closeRef} onClose={close} />
          </div>
        </>
      ) : null}
    </>
  )
}
