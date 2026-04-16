import { useCallback } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import { setSelectedLibraryId, addLibrary, updateLibraryAndroidTreeUri, removeLibraryById } from '../../../features/library/librarySlice'
import { setLibraryManagerOpen } from '../../../features/ui/uiSlice'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import type { NotiaLibrary } from '../../../types/notia'

interface UseLibraryManagerActionsParams {
  closeTabsByPath: (path: string) => void
}

export function useLibraryManagerActions({
  closeTabsByPath,
}: UseLibraryManagerActionsParams) {
  const dispatch = useAppDispatch()
  const { confirm } = useConfirmationEngine()

  const handleLibraryAdded = useCallback((library: NotiaLibrary) => {
    const existingLibrary = store.getState().library.libraries.find((item) => item.path === library.path)
    if (existingLibrary) {
      if (!existingLibrary.androidTreeUri && library.androidTreeUri) {
        dispatch(updateLibraryAndroidTreeUri({ libraryId: existingLibrary.id, androidTreeUri: library.androidTreeUri }))
      }
      dispatch(setSelectedLibraryId(existingLibrary.id))
      dispatch(setLibraryManagerOpen(false))
      return
    }
    dispatch(addLibrary(library))
    dispatch(setSelectedLibraryId(library.id))
    dispatch(setLibraryManagerOpen(false))
  }, [dispatch])

  const handleLibraryRemoved = useCallback(async (library: NotiaLibrary) => {
    const shouldRemove = await confirm({
      title: 'Quitar libreria',
      message: `Quitar "${library.name}" de Notia? Esta accion no borra la carpeta en disco.`,
      confirmLabel: 'Quitar', cancelLabel: 'Cancelar', tone: 'danger',
    })
    if (!shouldRemove) { return }
    closeTabsByPath(library.path)
    dispatch(removeLibraryById(library.id))
  }, [closeTabsByPath, confirm, dispatch])

  return {
    handleLibraryAdded,
    handleLibraryRemoved,
  }
}