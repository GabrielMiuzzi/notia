import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribeBackend, type Unsubscribe } from '../../../../services/transport'
import { getHomeWeather, type HomeWeather } from '../../../../services/home/weatherService'
import { homeErrorMessage } from '../../../../services/home/homeService'

/** Emitted by Rust when the library's weather place changes. */
const WEATHER_PLACE_CHANGED_EVENT = 'notia:weather-place-changed'
/** Rust keeps each forecast for 15 minutes; asking again sooner is free. */
const REFRESH_MS = 15 * 60 * 1000

/**
 * The weather of the library's place for Home. It is read apart from the
 * dashboard so a slow connection never holds the other cards.
 */
export function useHomeWeather(libraryId: string | null) {
  const [weather, setWeather] = useState<HomeWeather | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const requestRef = useRef(0)

  const reload = useCallback(async () => {
    const request = ++requestRef.current
    if (!libraryId) {
      setWeather(null)
      setError(null)
      return
    }
    setIsLoading(true)
    try {
      const next = await getHomeWeather(libraryId)
      if (request !== requestRef.current) return
      setWeather(next)
      setError(null)
    } catch (reason) {
      if (request !== requestRef.current) return
      setError(homeErrorMessage(reason, 'No se pudo consultar el clima.'))
    } finally {
      if (request === requestRef.current) setIsLoading(false)
    }
  }, [libraryId])

  useEffect(() => {
    setWeather(null)
    void reload()
    const timer = window.setInterval(() => void reload(), REFRESH_MS)
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    let isActive = true
    let unsubscribe: Unsubscribe | null = null
    void subscribeBackend(WEATHER_PLACE_CHANGED_EVENT, () => void reload())
      .then((stop) => { if (isActive) unsubscribe = stop; else stop() })
      .catch(() => undefined)
    return () => {
      isActive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      unsubscribe?.()
    }
  }, [reload])

  return { weather, error, isLoading, reload }
}
