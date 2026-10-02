// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { HomeWeather } from '../../../../services/home/weatherService'
import { HomeWeatherChip } from './HomeWeatherChip'
import { HomeWeatherCard } from './HomeWeatherCard'

const day = (name: string, sky: 'sun' | 'rain', rain: string) => ({
  day: name, sky, rain, min: '11°', max: '21°', barLeft: 10, barWidth: 60, title: `${name}: título`,
})

const weather: HomeWeather = {
  place: 'Buenos Aires',
  now: { temp: '18°', condition: 'Parcialmente nublado', sky: 'partly', feels: '17°', humidity: '64 %', wind: '15 km/h SE', updated: '10:30', max: '21°', min: '11°' },
  next: [day('Dom', 'rain', '70 %'), day('Lun', 'sun', '')],
  hours: [{ label: 'Ahora', sky: 'partly', temp: '18°', rain: '—' }, { label: '13:00', sky: 'rain', temp: '20°', rain: '40 %' }],
  days: [day('Hoy', 'sun', '10 %'), day('Dom', 'rain', '70 %'), day('Lun', 'sun', '')],
}

describe('HomeWeatherChip', () => {
  afterEach(cleanup)

  it('opens the forecast and closes it with Escape', () => {
    render(<HomeWeatherChip weather={weather} error={null} isLoading={false} onRetry={() => {}} />)
    const chip = screen.getByRole('button', { name: /18°/ })
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(chip)
    const dialog = screen.getByRole('dialog', { name: 'Clima en Buenos Aires' })
    expect(dialog.textContent).toContain('Sensación 17° · Humedad 64 % · Viento 15 km/h SE')
    expect(dialog.textContent).toContain('Buenos Aires · actualizado a las 10:30')
    expect(screen.getByText('Próximos 3 días')).toBeTruthy()
    expect(screen.getByLabelText('lluvia 40 %')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(chip)
  })

  it('offers a retry when the weather could not be read', () => {
    const onRetry = vi.fn()
    render(<HomeWeatherChip weather={null} error="Sin conexión" isLoading={false} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /Clima no disponible/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('HomeWeatherCard (phone)', () => {
  afterEach(cleanup)

  it('shows the next days and opens the forecast in a sheet over the view', () => {
    render(<HomeWeatherCard weather={weather} error={null} isLoading={false} onRetry={() => {}} />)
    const card = screen.getByRole('button', { name: /18°/ })
    expect(card.textContent).toContain('↑ 21° · ↓ 11° · Buenos Aires')
    expect(card.textContent).toContain('Dom')
    fireEvent.click(card)
    const sheet = screen.getByRole('dialog', { name: 'Clima en Buenos Aires' })
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(sheet.textContent).toContain('Sensación 17° · Humedad 64 % · Viento 15 km/h SE')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cerrar pronóstico')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(card)
  })

  it('closes the sheet from the backdrop', () => {
    render(<HomeWeatherCard weather={weather} error={null} isLoading={false} onRetry={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /18°/ }))
    fireEvent.click(document.querySelector('.home-sheet-scrim') as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers a retry when the weather could not be read', () => {
    const onRetry = vi.fn()
    render(<HomeWeatherCard weather={null} error="Sin conexión" isLoading={false} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /Clima no disponible/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
