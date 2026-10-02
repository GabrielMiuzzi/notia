// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { HealthDashboard } from '../types/healthTypes'
import { HealthDashboardView } from './HealthDashboardView'
import fullFixture from './__fixtures__/dashboard.json'
import emptyFixture from './__fixtures__/dashboard-empty.json'

const callBackend = vi.fn()
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
  subscribeBackend: () => Promise.resolve(() => undefined),
}))
// El espacio de un celular: la medición no existe en happy-dom.
vi.mock('../../../hooks/useNarrowContainer', () => ({ useNarrowContainer: () => true }))

// Tableros armados por Rust (`build_dashboard`) con el escenario «Sobrepeso».
const FULL = fullFixture as unknown as HealthDashboard
const EMPTY = emptyFixture as unknown as HealthDashboard
const LIBRARY = { id: 'lib-1', name: 'gaia', path: 'C:/gaia' }

function serve(dashboard: HealthDashboard) {
  callBackend.mockImplementation(() => Promise.resolve(dashboard))
}

const tab = (name: string) => screen.getByRole('tab', { name })

beforeEach(() => {
  callBackend.mockReset()
  serve(FULL)
})

afterEach(() => cleanup())

describe('HealthPhone', () => {
  it('opens on Hoy with the summary cards that lead to their tabs', async () => {
    render(<HealthDashboardView library={LIBRARY} />)
    const calories = await screen.findByRole('button', { name: /Calorías de hoy/ })
    expect(tab('Hoy').getAttribute('aria-selected')).toBe('true')
    expect(within(calories).getByText('840')).toBeTruthy()
    expect(within(calories).getByText('de 1.886 kcal')).toBeTruthy()
    expect(within(calories).getByText('Quedan 1.046 kcal')).toBeTruthy()
    expect(within(calories).getByText('40 / 137 g')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Agua de hoy' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Índice de masa corporal' })).toBeTruthy()
    const weight = screen.getByRole('button', { name: /Ver detalle/ })
    expect(within(weight).getByText('Objetivo 76 kg, faltan 6,4')).toBeTruthy()
    // Un solo peso en el mes: sin línea.
    expect(weight.querySelector('.hl-spark')).toBeNull()
    // El tablero completo no se muestra en Hoy.
    expect(screen.queryByRole('heading', { name: 'Alimentación' })).toBeNull()

    fireEvent.click(calories)
    expect(tab('Comidas').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Alimentación' })).toBeTruthy()
    // «Agregar comida» es solo el botón flotante.
    expect(screen.getAllByRole('button', { name: 'Agregar comida' })).toHaveLength(1)

    fireEvent.click(tab('Hoy'))
    fireEvent.click(screen.getByRole('button', { name: /Ver detalle/ }))
    expect(screen.getByRole('heading', { name: 'Peso objetivo' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Agregar comida' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Registrar medición' })).toBeNull()
  })

  it('adds a meal from the floating button on the day each tab shows', async () => {
    serve({ ...FULL, food: FULL.food && { ...FULL.food, date: '2026-09-27', dayLabel: 'Ayer', nextDate: '2026-09-28' } })
    render(<HealthDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar comida' }))
    let sheet = await screen.findByRole('dialog')
    expect(sheet.classList.contains('hl-sheet')).toBe(true)
    expect(within(sheet).getByRole('heading', { name: 'Agregar comida' })).toBeTruthy()
    fireEvent.change(within(sheet).getByLabelText('Qué comiste'), { target: { value: 'Manzana' } })
    fireEvent.change(within(sheet).getByLabelText('Calorías'), { target: { value: '95' } })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Agregar comida' })) })
    expect(callBackend).toHaveBeenCalledWith('health_apply', expect.objectContaining({
      mutation: expect.objectContaining({ kind: 'saveMeal', input: expect.objectContaining({ date: '2026-09-28', category: 'almuerzo', name: 'Manzana' }) }),
    }))

    // En Comidas va al día que se está viendo.
    fireEvent.click(tab('Comidas'))
    fireEvent.click(screen.getByRole('button', { name: 'Agregar comida' }))
    sheet = await screen.findByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('Qué comiste'), { target: { value: 'Mate' } })
    fireEvent.change(within(sheet).getByLabelText('Calorías'), { target: { value: '10' } })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Agregar comida' })) })
    expect(callBackend).toHaveBeenLastCalledWith('health_apply', expect.objectContaining({
      mutation: expect.objectContaining({ kind: 'saveMeal', input: expect.objectContaining({ date: '2026-09-27', name: 'Mate' }) }),
    }))
  })

  it('records a measurement from Cuerpo and edits the profile from the menu', async () => {
    render(<HealthDashboardView library={LIBRARY} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Cuerpo' }))
    expect(screen.getByRole('heading', { name: 'Composición corporal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar medición' }))
    const scale = await screen.findByRole('dialog')
    expect(within(scale).getByRole('heading', { name: 'Registrar medición de la balanza' })).toBeTruthy()
    fireEvent.click(within(scale).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
    const menu = await screen.findByRole('dialog')
    expect(within(menu).getByRole('heading', { name: 'Opciones' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Registrar medición de la balanza' })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: 'Editar perfil' }))
    const profile = await screen.findByRole('dialog')
    expect(within(profile).getByRole('heading', { name: 'Tu perfil' })).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('draws the month line that Rust sends', async () => {
    serve({ ...FULL, weightTrend: { changeLabel: '-1,2 kg en 30 días', goalLabel: 'Objetivo 76 kg, faltan 6,4', line: 'M0,22.73L100,77.27' } })
    render(<HealthDashboardView library={LIBRARY} />)
    const weight = await screen.findByRole('button', { name: /Ver detalle/ })
    expect(within(weight).getByText(/^-1,2 kg en 30 días/).querySelector('br')).toBeTruthy()
    expect(weight.querySelector('.hl-spark path')?.getAttribute('d')).toBe('M0,22.73L100,77.27')
  })

  it('starts with the profile when there is none', async () => {
    serve(EMPTY)
    render(<HealthDashboardView library={LIBRARY} />)
    expect(await screen.findByText('Empezá por tu perfil')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar comida' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Más opciones' }))
    const menu = await screen.findByRole('dialog')
    expect(within(menu).getByRole('button', { name: 'Configurar perfil' })).toBeTruthy()
    expect(within(menu).queryByRole('button', { name: 'Registrar medición de la balanza' })).toBeNull()
  })
})
