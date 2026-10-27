// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { store } from '../../../store/index'
import { PublicSpacesSection } from './PublicSpacesSection'

const callBackend = vi.fn()
vi.mock('../../../services/transport', () => ({
  callBackend: (...args: unknown[]) => callBackend(...args),
}))

const EMPTY = { available: true, suggestedPort: 52490, spaces: [] }

function renderSection() {
  return render(
    <Provider store={store}>
      <PublicSpacesSection libraryId="lib" />
    </Provider>,
  )
}

describe('PublicSpacesSection', () => {
  afterEach(() => {
    cleanup()
    callBackend.mockReset()
  })

  it('adds a space with a #Publico folder and saves it', async () => {
    callBackend.mockImplementation(async (command: string, args?: { payload: { spaces: unknown[]; items?: unknown[] } }) => {
      if (command === 'public_spaces_view') return EMPTY
      // Rust leaves out what the space already publishes.
      if (command === 'public_space_candidates') {
        return args?.payload.items?.length ? [] : [
          { path: 'Cursos/programacion', kind: 'folder', name: 'programacion' },
          { path: 'Cursos/programacion/backend', kind: 'folder', name: 'backend' },
        ]
      }
      if (command === 'public_spaces_save') {
        return {
          available: true,
          suggestedPort: 52491,
          spaces: (args?.payload.spaces as Array<Record<string, unknown>>).map((space) => ({
            ...space,
            items: (space.items as Array<Record<string, unknown>>).map((item) => ({ ...item, name: 'programacion', public: true })),
            listening: true,
            url: 'http://192.168.0.20:52490/',
            pageCount: 144,
          })),
        }
      }
      return null
    })
    renderSection()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Agregar espacio público/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Agregar carpeta o nota/ })) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /programacion Cursos\/programacion Carpeta/ })) })
    expect(callBackend).toHaveBeenLastCalledWith('public_space_candidates', { payload: { libraryId: 'lib', items: [{ path: 'Cursos/programacion', kind: 'folder' }] } })
    expect(screen.queryByRole('button', { name: /backend Cursos\/programacion\/backend/ })).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' })) })

    const saved = callBackend.mock.calls.find(([command]) => command === 'public_spaces_save')?.[1] as { payload: { spaces: Array<Record<string, unknown>> } }
    expect(saved.payload.spaces).toEqual([expect.objectContaining({ libraryId: 'lib', port: 52490, enabled: true, items: [{ path: 'Cursos/programacion', kind: 'folder' }] })])
    expect(screen.getByText('Publicado · 144 páginas')).toBeTruthy()
    expect(screen.getByText('http://192.168.0.20:52490/')).toBeTruthy()
    expect(screen.getByText('Guardado. 1 espacio publicado.')).toBeTruthy()
  })

  it('shows why the backend refused the spaces', async () => {
    callBackend.mockImplementation(async (command: string) => {
      if (command === 'public_spaces_view') return EMPTY
      if (command === 'public_spaces_save') throw new Error('El puerto 52471 ya lo usa el tablero publicado.')
      return []
    })
    renderSection()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Agregar espacio público/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' })) })
    expect(within(screen.getByRole('alert')).getByText('El puerto 52471 ya lo usa el tablero publicado.')).toBeTruthy()
  })
})
