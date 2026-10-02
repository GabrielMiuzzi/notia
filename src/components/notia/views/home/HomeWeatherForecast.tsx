import type { Ref } from 'react'
import { X } from 'lucide-react'
import type { HomeWeather, WeatherSky } from '../../../../services/home/weatherService'

/** Trazos del canvas para cada cielo; el color sale de `data-sky`. */
const SKY_PATHS: Record<WeatherSky, string> = {
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  partly: 'M12 2v2 M4.9 4.9l1.4 1.4 M20 12h2 M17.7 6.3l1.4-1.4 M15.9 13.4A4 4 0 0 0 8.1 11 M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
  rain: 'M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2 M16 14v6 M8 14v6 M12 16v6',
  night: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
}

export function SkyIcon({ sky, size, strokeWidth = 1.75 }: { sky: WeatherSky; size: number; strokeWidth?: number }) {
  return (
    <svg className="home-wx-icon" data-sky={sky} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={SKY_PATHS[sky]} />
    </svg>
  )
}

interface HomeWeatherForecastProps {
  weather: HomeWeather
  /** The phone's bottom sheet draws the icons a bit larger. */
  phone?: boolean
  closeRef?: Ref<HTMLButtonElement>
  onClose: () => void
}

/**
 * The forecast of the weather chip (popover) and of the phone's weather card
 * (bottom sheet): now, the next hours and the next days.
 */
export function HomeWeatherForecast({ weather, phone = false, closeRef, onClose }: HomeWeatherForecastProps) {
  const { now } = weather
  const iconSize = phone ? 20 : 18
  return (
    <>
      <div className="home-wx-pop__head">
        <div className="home-wx-pop__now">
          <SkyIcon sky={now.sky} size={phone ? 44 : 40} strokeWidth={1.5} />
          <div className="home-wx-pop__now-text">
            <span className="home-wx-pop__temp">{now.temp}</span>
            <span className="home-wx-pop__cond">{now.condition}</span>
          </div>
        </div>
        <button ref={closeRef} type="button" className="home-wx-close" aria-label="Cerrar pronóstico" onClick={onClose}>
          <X size={phone ? 16 : 14} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <p className="home-wx-sub">Sensación {now.feels} · Humedad {now.humidity} · Viento {now.wind}</p>
      <p className="home-wx-sub home-wx-sub--tight">{weather.place} · actualizado a las {now.updated}</p>
      <ul className="home-wx-hours" aria-label="Próximas horas">
        {weather.hours.map((hour) => (
          <li key={hour.label} className="home-wx-hour">
            <span className="home-wx-sub">{hour.label}</span>
            <SkyIcon sky={hour.sky} size={iconSize} />
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
            <SkyIcon sky={day.sky} size={iconSize} />
            <span className="home-wx-rain home-wx-day__rain" aria-hidden="true">{day.rain}</span>
            <span className="home-mono home-wx-sub home-wx-day__min" aria-hidden="true">{day.min}</span>
            <span className="home-wx-track" aria-hidden="true">
              <span className="home-wx-fill" style={{ left: `${day.barLeft}%`, width: `${day.barWidth}%` }} />
            </span>
            <span className="home-mono home-wx-day__max" aria-hidden="true">{day.max}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
