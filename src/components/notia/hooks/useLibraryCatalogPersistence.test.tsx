// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, renderHook } from '@testing-library/react'
import libraryReducer, { addLibrary, setSelectedLibraryId } from '../../../features/library/librarySlice'
import { loadLibraryCatalog, saveLibraryCatalog } from '../../../services/libraries/libraryStorage'
import { useLibraryCatalogPersistence } from './useLibraryCatalogPersistence'

vi.mock('../../../services/libraries/libraryStorage', () => ({
  loadLibraryCatalog: vi.fn(),
  saveLibraryCatalog: vi.fn(async (snapshot: unknown) => snapshot),
}))

const gaia = { id: 'gaia', name: 'gaia', path: 'C:/notia/gaia' }

function renderPersistence() {
  const store = configureStore({ reducer: { library: libraryReducer } })
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  renderHook(() => useLibraryCatalogPersistence(), { wrapper })
  return store
}

describe('useLibraryCatalogPersistence', () => {
  afterEach(() => {
    cleanup()
    vi.mocked(saveLibraryCatalog).mockClear()
  })

  it('stores later changes of a loaded catalog', async () => {
    vi.mocked(loadLibraryCatalog).mockResolvedValue({ libraries: [gaia], selectedLibraryId: 'gaia' })
    const store = renderPersistence()
    await act(async () => undefined)
    expect(saveLibraryCatalog).not.toHaveBeenCalled()

    await act(async () => { store.dispatch(setSelectedLibraryId(null)) })
    expect(saveLibraryCatalog).toHaveBeenCalledWith({ libraries: [gaia], selectedLibraryId: null })
  })

  // On a client the catalog is the host's: an empty one stored after a
  // failed load emptied the host.
  it('never stores the empty list shown after a failed load', async () => {
    vi.mocked(loadLibraryCatalog).mockRejectedValue(new Error('sin host'))
    const store = renderPersistence()
    await act(async () => undefined)
    expect(store.getState().library.catalogLoaded).toBe(true)

    await act(async () => { store.dispatch(addLibrary(gaia)) })
    expect(saveLibraryCatalog).not.toHaveBeenCalled()
  })
})
