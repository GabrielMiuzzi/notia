import { callBackend } from '../transport'

/** Contrato del clima que arma Rust (`app/src/weather.rs`) con datos de Open-Meteo. */

export type WeatherSky = 'sun' | 'partly' | 'cloud' | 'rain' | 'night'

export interface HomeWeatherNow {
  temp: string
  condition: string
  sky: WeatherSky
  feels: string
  humidity: string
  wind: string
  updated: string
  max: string
  min: string
}

export interface HomeWeatherHour {
  label: string
  sky: WeatherSky
  temp: string
  rain: string
}

export interface HomeWeatherDay {
  day: string
  sky: WeatherSky
  rain: string
  min: string
  max: string
  barLeft: number
  barWidth: number
  title: string
}

export interface HomeWeather {
  place: string
  now: HomeWeatherNow
  next: HomeWeatherDay[]
  hours: HomeWeatherHour[]
  days: HomeWeatherDay[]
}

export interface WeatherPlace {
  label: string
  isDefault: boolean
}

/** Un lugar que devolvió la búsqueda; se reenvía tal cual para elegirlo. */
export interface WeatherPlaceOption {
  location: Record<string, unknown>
  label: string
}

export function getHomeWeather(libraryId: string): Promise<HomeWeather> {
  return callBackend<HomeWeather>('weather_home', { payload: { libraryId } })
}

export function getWeatherPlace(libraryId: string): Promise<WeatherPlace> {
  return callBackend<WeatherPlace>('weather_get_location', { payload: { libraryId } })
}

export function searchWeatherPlaces(query: string): Promise<WeatherPlaceOption[]> {
  return callBackend<WeatherPlaceOption[]>('weather_search_locations', { payload: { query } })
}

export function setWeatherPlace(libraryId: string, option: WeatherPlaceOption): Promise<WeatherPlace> {
  return callBackend<WeatherPlace>('weather_set_location', { payload: { libraryId, location: option.location } })
}
