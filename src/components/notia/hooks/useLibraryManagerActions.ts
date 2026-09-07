import { useCallback } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import { setSelectedLibraryId, addLibrary, updateLibraryAndroidTreeUri, removeLibraryById } from '../../../features/library/librarySlice'
import { setLibraryManagerOpen } from '../../../features/ui/uiSlice'
import { useConfirmationEngine } from '../../../context/confirmation/useConfirmationEngine'
import type { NotiaLibrary } from '../../../types/notia'

interface UseLibraryManagerActionsParams {
  closeTabsByPath: (path: string) => Promise<boolean>
  persistDirtyTextDocuments: () => Promise<boolean>
}

export function useLibraryManagerActions({
  closeTabsByPath,
  persistDirtyTextDocuments,
}: UseLibraryManagerActionsParams) {
  const dispatch = useAppDispatch()
  const { confirm } = useConfirmationEngine()

  const handleLibraryAdded = useCallback(async (library: NotiaLibrary) => {
    if (!(await persistDirtyTextDocuments())) { return }

    const existingLibrary = store.getState().library.libraries.find((item) => {
      // On Android, the path may be a display name shared by multiple folders,
      // so we also compare androidTreeUri when available.
      if (item.path === library.path) {
        if (item.androidTreeUri && library.androidTreeUri) {
          return item.androidTreeUri === library.androidTreeUri
        }
        return true
      }
      return false
    })
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
  }, [dispatch, persistDirtyTextDocuments])

  const handleLibraryRemoved = useCallback(async (library: NotiaLibrary) => {
    const shouldRemove = await confirm({
      title: 'Quitar libreria',
      message: `Quitar "${library.name}" de Notia? Esta accion no borra la carpeta en disco.`,
      confirmLabel: 'Quitar', cancelLabel: 'Cancelar', tone: 'danger',
    })
    if (!shouldRemove) { return }
    if (!(await closeTabsByPath(library.path))) { return }
    dispatch(removeLibraryById(library.id))
  }, [closeTabsByPath, confirm, dispatch])

  return {
    handleLibraryAdded,
    handleLibraryRemoved,
  }
}
