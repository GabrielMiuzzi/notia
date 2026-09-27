import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { HomeWeather, WeatherSky } from '../../../../services/home/weatherService'

/** Trazos del canvas para cada cielo; el color sale de `data-sky`. */
const SKY_PATHS: Record<WeatherSky, string> = {
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  partly: 'M12 2v2 M4.9 4.9l1.4 1.4 M20 12h2 M17.7 6.3l1.4-1.4 M15.9 13.4A4 4 0 0 0 8.1 11 M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
  rain: 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2 M16 14v6 M8 14v6 M12 16v6',
  night: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
}

function SkyIcon({ sky, size, strokeWidth = 1.75 }: { sky: WeatherSky; size: number; strokeWidth?: number }) {
  return (
    <svg className="home-wx-icon" data-sky={sky} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={SKY_PATHS[sky]} />
    </svg>
  )
}

interface HomeWeatherChipProps {
  weather: HomeWeather | null
  error: string | null
  isLoading: boolean
  onRetry: () => void
}

/** Chip del clima junto al saludo; al tocarlo abre el pronóstico por horas y de la semana. */
export function HomeWeatherChip({ weather, error, isLoading, onRetry }: HomeWeatherChipProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      chipRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!weather) {
    if (error) {
      return (
        <button type="button" className="home-wx-chip home-wx-chip--quiet" title={error} onClick={onRetry} disabled={isLoading}>
          Clima no disponible · Reintentar
        </button>
      )
    }
    return <span className="home-wx-chip home-wx-chip--quiet" role="status">Consultando el clima…</span>
  }

  const { now } = weather
  return (
    <div className="home-wx" ref={rootRef}>
      <button
        ref={chipRef}
        type="button"
        className="home-wx-chip"
        aria-expanded={open}
        aria-controls={popoverId}
        title="Clima y pronóstico"
        onClick={() => setOpen((current) => !current)}
      >
        <SkyIcon sky={now.sky} size={18} />
        <span className="home-wx-temp">{now.temp}</span>
        <span className="home-wx-cond">{now.condition}</span>
        <span className="home-wx-range home-mono">↑ {now.max} · ↓ {now.min}</span>
        {weather.next.length > 0 ? <span className="home-wx-sep" aria-hidden="true" /> : null}
        {weather.next.map((day) => (
          <span key={day.day} className="home-wx-mini" title={day.title}>
            <span className="home-wx-mini-day">{day.day}</span>
            <SkyIcon sky={day.sky} size={15} />
            <span className="home-mono home-wx-mini-temps">{day.max}<span className="home-wx-muted">/{day.min}</span></span>
          </span>
        ))}
        <ChevronDown size={12} strokeWidth={2} className="home-wx-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="home-wx-pop" id={popoverId} role="dialog" aria-label={`Clima en ${weather.place}`}>
          <div className="home-wx-pop__head">
            <div className="home-wx-pop__now">
              <SkyIcon sky={now.sky} size={40} strokeWidth={1.5} />
              <div className="home-wx-pop__now-text">
                <span className="home-wx-pop__temp">{now.temp}</span>
                <span className="home-wx-pop__cond">{now.condition}</span>
              </div>
            </div>
            <button type="button" className="home-wx-close" aria-label="Cerrar pronóstico" onClick={() => { setOpen(false); chipRef.current?.focus() }}>
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <p className="home-wx-sub">Sensación {now.feels} · Humedad {now.humidity} · Viento {now.wind}</p>
          <p className="home-wx-sub home-wx-sub--tight">{weather.place} · actualizado a las {now.updated}</p>
          <ul className="home-wx-hours" aria-label="Próximas horas">
            {weather.hours.map((hour) => (
              <li key={hour.label} className="home-wx-hour">
                <span className="home-wx-sub">{hour.label}</span>
                <SkyIcon sky={hour.sky} size={18} />
                <b className="home-mono">{hour.temp}</b>
                <span className="home-wx-rain" aria-label={hour.rain === '—' ? 'sin lluvia' : `lluvia ${hour.rain}`}>{hour.rain}</span>
              </li>
            ))}
          </ul>
          <p className="home-wx-label">Próximos {weather.days.length} días</p>
          <ul className="home-wx-days">
            {weather.days.map((day) => (
              <li key={day.day} className="home-wx-day" aria-label={day.title}>
                <span className="home-wx-day__name" aria-hidden="true">{day.day}</span>
                <SkyIcon sky={day.sky} size={18} />
                <span className="home-wx-rain home-wx-day__rain" aria-hidden="true">{day.rain}</span>
                <span className="home-mono home-wx-sub home-wx-day__min" aria-hidden="true">{day.min}</span>
                <span className="home-wx-track" aria-hidden="true">
                  <span className="home-wx-fill" style={{ left: `${day.barLeft}%`, width: `${day.barWidth}%` }} />
                </span>
                <span className="home-mono home-wx-day__max" aria-hidden="true">{day.max}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
