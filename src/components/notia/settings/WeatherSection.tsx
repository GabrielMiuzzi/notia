import { useEffect, useState, type FormEvent } from 'react'
import { MapPin, Search } from 'lucide-react'
import { NotiaButton } from '../../common/NotiaButton'
import { SettingsBadge, SettingsCard, SettingsFooter, SettingsRow, type SettingsTone } from './SettingsControls'
import {
  getWeatherPlace,
  searchWeatherPlaces,
  setWeatherPlace,
  type WeatherPlace,
  type WeatherPlaceOption,
} from '../../../services/home/weatherService'

interface Status {
  tone: SettingsTone
  message: string
}

const IDLE: Status = { tone: 'idle', message: '' }

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

/**
 * «Clima»: el lugar del pronóstico del Inicio y del asistente. La búsqueda y
 * la validación son de Rust (Open-Meteo); acá solo se elige un resultado.
 */
export function WeatherSection({ libraryId }: { libraryId: string | null }) {
  const [place, setPlace] = useState<WeatherPlace | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WeatherPlaceOption[] | null>(null)
  const [busy, setBusy] = useState<'search' | 'save' | null>(null)
  const [status, setStatus] = useState<Status>(IDLE)

  useEffect(() => {
    setPlace(null)
    setResults(null)
    setStatus(IDLE)
    if (!libraryId) return
    let isActive = true
    getWeatherPlace(libraryId)
      .then((next) => { if (isActive) setPlace(next) })
      .catch((error: unknown) => { if (isActive) setStatus({ tone: 'error', message: messageOf(error, 'No se pudo leer el lugar del clima.') }) })
    return () => { isActive = false }
  }, [libraryId])

  const search = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy('search')
    setStatus({ tone: 'loading', message: 'Buscando…' })
    try {
      const found = await searchWeatherPlaces(query)
      setResults(found)
      setStatus(found.length ? IDLE : { tone: 'idle', message: 'No se encontraron lugares con ese nombre.' })
    } catch (error) {
      setStatus({ tone: 'error', message: messageOf(error, 'No se pudo buscar el lugar.') })
    } finally {
      setBusy(null)
    }
  }

  const choose = async (option: WeatherPlaceOption) => {
    if (!libraryId || busy) return
    setBusy('save')
    try {
      setPlace(await setWeatherPlace(libraryId, option))
      setResults(null)
      setQuery('')
      setStatus({ tone: 'success', message: `El clima ahora es de ${option.label}.` })
    } catch (error) {
      setStatus({ tone: 'error', message: messageOf(error, 'No se pudo guardar el lugar.') })
    } finally {
      setBusy(null)
    }
  }

  if (!libraryId) {
    return <SettingsCard><div className="notia-settings-empty">Abrí una biblioteca para elegir el lugar del clima.</div></SettingsCard>
  }

  return (
    <SettingsCard>
      <SettingsRow
        label="Lugar del pronóstico"
        description="El Inicio muestra su clima y el asistente lo usa cuando no nombrás otro lugar. Datos de Open-Meteo."
        badge={place?.isDefault ? <SettingsBadge>Predeterminado</SettingsBadge> : null}
        emphasis
      >
        <span className="notia-settings-plain notia-settings-plain--strong">{place?.label ?? '…'}</span>
      </SettingsRow>
      <form onSubmit={(event) => { void search(event) }}>
        <SettingsRow label="Buscar otro lugar" htmlFor="notia-settings-weather-query" description="Ciudad, con provincia o país si hay varias con el mismo nombre.">
          <div className="notia-settings-weather-search">
            <input
              id="notia-settings-weather-query"
              className="notia-settings-field notia-settings-field--wide"
              type="search"
              value={query}
              autoComplete="off"
              placeholder="Córdoba, Mar del Plata…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <NotiaButton type="submit" disabled={busy !== null || query.trim().length < 2}>
              <Search size={14} aria-hidden="true" />Buscar
            </NotiaButton>
          </div>
        </SettingsRow>
      </form>
      {results && results.length > 0 ? (
        <ul className="notia-settings-weather-results" aria-label="Lugares encontrados">
          {results.map((option) => (
            <li key={option.label}>
              <button type="button" className="notia-settings-weather-result" disabled={busy !== null} onClick={() => { void choose(option) }}>
                <MapPin size={15} aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {status.message ? <SettingsFooter tone={status.tone} message={status.message} /> : null}
    </SettingsCard>
  )
}
