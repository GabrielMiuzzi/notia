import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../../../store/hooks'
import { hydrateLibraryCatalog, setLibraryError } from '../../../features/library/librarySlice'
import { loadLibraryCatalog, saveLibraryCatalog } from '../../../services/libraries/libraryStorage'

/**
 * Loads the library catalog from the backend on start and stores every later
 * change of the list or the selection, in order.
 */
export function useLibraryCatalogPersistence(): void {
  const dispatch = useAppDispatch()
  const libraries = useAppSelector((state) => state.library.libraries)
  const selectedLibraryId = useAppSelector((state) => state.library.selectedLibraryId)
  const catalogLoaded = useAppSelector((state) => state.library.catalogLoaded)
  const hydratedSnapshotRef = useRef<unknown>(null)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    void loadLibraryCatalog()
      .then((catalog) => {
        if (cancelled) return
        hydratedSnapshotRef.current = catalog
        dispatch(hydrateLibraryCatalog(catalog))
      })
      .catch(() => {
        if (cancelled) return
        dispatch(hydrateLibraryCatalog({ libraries: [], selectedLibraryId: null }))
        dispatch(setLibraryError('No se pudo cargar el catálogo de bibliotecas.'))
      })
    return () => {
      cancelled = true
    }
  }, [dispatch])

  useEffect(() => {
    if (!catalogLoaded) return
    if (hydratedSnapshotRef.current) {
      // The first render after hydration only reflects what was loaded.
      hydratedSnapshotRef.current = null
      return
    }
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveLibraryCatalog({ libraries, selectedLibraryId }))
      .catch(() => dispatch(setLibraryError('No se pudo guardar el catálogo de bibliotecas.')))
  }, [catalogLoaded, dispatch, libraries, selectedLibraryId])
}
