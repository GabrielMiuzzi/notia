// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { NotiaLibrary } from '../../../types/notia'
import type { GymQuery, GymView } from '../types/gymTypes'
import { GymDashboardView } from './GymDashboardView'

const service = vi.hoisted(() => ({
  getGymView: vi.fn(),
  applyGymMutation: vi.fn(),
  getBody: vi.fn(),
  subscribeToGym: vi.fn(),
  applyCatalogMutation: vi.fn(),
  getEquipmentImages: vi.fn(),
}))
vi.mock('../services/gymService', () => ({
  ...service,
  asGymError: (reason: unknown) => ({ code: 'storage', message: String(reason) }),
  readMedia: vi.fn(),
}))
// El espacio de un celular: la medición no existe en happy-dom.
vi.mock('../hooks/usePhoneLayout', () => ({ usePhoneLayout: () => true }))
vi.mock('../../../context/confirmation/useConfirmationEngine', () => ({ useConfirmationEngine: () => ({ confirm: vi.fn() }) }))

const library = { id: 'library-1' } as NotiaLibrary
const routineRow = (id: string, name: string) => ({ id, name, focus: 'Pecho', count: '3 ejercicios', days: 'Lun', color: 'azul', selected: false })

function view(query: GymQuery): GymView {
  const routine = query.routineId
    ? {
        id: query.routineId, name: 'Rutina lunes', focus: '', focusLabel: 'Sin enfoque', days: [true, false, false, false, false, false, false],
        trainLabel: 'Entrenar', items: [], stats: { exercises: 0, sets: 0, volume: '0' }, summary: { rest: '0 s', muscles: {}, primary: '', secondary: '' },
      }
    : null
  return {
    screen: query.screen, sex: 'masculino', sexFromProfile: true, routines: [routineRow('r1', 'Rutina lunes'), routineRow('r2', 'Rutina jueves')],
    routineId: query.routineId, equipmentOwned: 0, equipmentTotal: 0, exerciseTotal: 10, session: null, groups: [],
    panel: null, routine: query.screen === 'rutinas' || query.screen === 'editar' ? routine : null,
    library: query.screen === 'editar' ? { rows: [], hiddenNote: '' } : null, training: null, equipment: null, nowMs: 0,
  } as unknown as GymView
}

describe('GymDashboardView en un celular', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('navega con las secciones de abajo, la lista de rutinas y la hoja de ejercicios', async () => {
    service.getGymView.mockImplementation((_library: NotiaLibrary, query: GymQuery) => Promise.resolve(view(query)))
    service.getBody.mockResolvedValue(null)
    service.subscribeToGym.mockResolvedValue(() => undefined)
    service.applyGymMutation.mockImplementation((_library: NotiaLibrary, _mutation: unknown, query: GymQuery) =>
      Promise.resolve({ view: view({ ...query, routineId: 'r3' }), routineId: 'r3' }))
    render(<GymDashboardView library={library} />)
    await act(async () => undefined)

    const tabs = screen.getByRole('navigation', { name: 'Secciones de entrenamiento' })
    expect(within(tabs).getByRole('button', { name: /Panel/ }).getAttribute('aria-current')).toBe('page')

    // Rutinas abre la lista; una tarjeta abre esa rutina, con «Rutinas» para volver.
    await act(async () => { fireEvent.click(within(tabs).getByRole('button', { name: /Rutinas/ })) })
    expect(screen.getByRole('heading', { name: 'Rutinas' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rutina jueves/ })) })
    expect(service.getGymView).toHaveBeenLastCalledWith(library, expect.objectContaining({ screen: 'rutinas', routineId: 'r2' }))
    // «Rutinas» para volver a la lista, además de la sección de abajo.
    expect(screen.getAllByRole('button', { name: 'Rutinas' })).toHaveLength(2)
    expect(tabs.isConnected).toBe(true)

    // Editar deja abajo «Agregar ejercicio», que abre la lista como hoja; Listo la cierra.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Editar/ })) })
    expect(screen.queryByRole('navigation', { name: 'Secciones de entrenamiento' })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Agregar ejercicio/ })) })
    expect(screen.getByRole('dialog', { name: 'Agregar ejercicio' })).toBeTruthy()
    const sheet = screen.getByRole('dialog', { name: 'Agregar ejercicio' })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Listo' })) })
    expect(screen.queryByRole('dialog', { name: 'Agregar ejercicio' })).toBeNull()
  })

  it('una rutina nueva se abre para editarla', async () => {
    service.getGymView.mockImplementation((_library: NotiaLibrary, query: GymQuery) => Promise.resolve(view(query)))
    service.getBody.mockResolvedValue(null)
    service.subscribeToGym.mockResolvedValue(() => undefined)
    service.applyGymMutation.mockImplementation((_library: NotiaLibrary, _mutation: unknown, query: GymQuery) =>
      Promise.resolve({ view: view({ ...query, routineId: 'r3' }), routineId: 'r3' }))
    render(<GymDashboardView library={library} />)
    await act(async () => undefined)
    const tabs = screen.getByRole('navigation', { name: 'Secciones de entrenamiento' })
    await act(async () => { fireEvent.click(within(tabs).getByRole('button', { name: /Rutinas/ })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Nueva/ })) })

    expect(service.applyGymMutation).toHaveBeenCalledWith(library, { type: 'create-routine' }, expect.anything(), expect.any(String))
    expect(service.getGymView).toHaveBeenLastCalledWith(library, expect.objectContaining({ screen: 'editar', routineId: 'r3' }))
  })
})
