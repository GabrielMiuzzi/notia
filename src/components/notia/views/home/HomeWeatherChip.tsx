import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { HomeWeather } from '../../../../services/home/weatherService'
import { HomeWeatherForecast, SkyIcon } from './HomeWeatherForecast'

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
          <HomeWeatherForecast weather={weather} onClose={() => { setOpen(false); chipRef.current?.focus() }} />
        </div>
      ) : null}
    </div>
  )
}
