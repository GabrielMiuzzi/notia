import { useCallback } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import { selectActiveTabPath } from '../../../features/documents/documentsSelectors'
import {
  updateTabSource,
  updateTabSaveStatus,
  updateTabSavedSource,
} from '../../../features/documents/documentsSlice'
import {
  writeLibraryFileContent,
} from '../../../services/libraries/libraryDocumentRuntime'
import {
  invalidateLibrarySearchGraphIndex,
} from '../../../services/libraries/librarySearchGraphIndex'
import type { DrawioDocumentController } from '../../../modules/drawio/types'

interface UseDocumentPersistParams {
  resolveActiveLibraryAndroidDirectoryUri: (pathValue?: string | null) => string | undefined
  bumpLibraryIndexRevision: () => void
  activeLibraryPath: string | undefined
  drawioControllersRef: React.RefObject<Map<string, DrawioDocumentController>>
}

export function useDocumentPersist({
  resolveActiveLibraryAndroidDirectoryUri,
  bumpLibraryIndexRevision,
  activeLibraryPath,
  drawioControllersRef,
}: UseDocumentPersistParams) {
  const dispatch = useAppDispatch()

  const handleInkdocDocumentPersist = useCallback(
    async (nextSource: string): Promise<void> => {
      const targetPath = selectActiveTabPath(store.getState())
      if (!targetPath) { return }
      dispatch(updateTabSource({ path: targetPath, source: nextSource }))
      const result = await writeLibraryFileContent(targetPath, nextSource, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
      })
      if (!result.ok) { throw new Error(result.error ?? 'No se pudo guardar el archivo Inkdoc.') }
      if (activeLibraryPath) { invalidateLibrarySearchGraphIndex(activeLibraryPath, targetPath) }
      dispatch(updateTabSavedSource({ path: targetPath, source: nextSource }))
      dispatch(updateTabSaveStatus({ path: targetPath, status: 'idle' }))
      bumpLibraryIndexRevision()
    },
    [activeLibraryPath, bumpLibraryIndexRevision, dispatch, resolveActiveLibraryAndroidDirectoryUri],
  )

  const handleDrawioDocumentPersist = useCallback(
    async (targetPath: string, nextSource: string): Promise<void> => {
      dispatch(updateTabSource({ path: targetPath, source: nextSource }))
      const result = await writeLibraryFileContent(targetPath, nextSource, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
      })
      if (!result.ok) {
        dispatch(updateTabSaveStatus({ path: targetPath, status: 'error' }))
        throw new Error(result.error ?? 'No se pudo guardar el archivo draw.io.')
      }
      if (activeLibraryPath) { invalidateLibrarySearchGraphIndex(activeLibraryPath, targetPath) }
      dispatch(updateTabSavedSource({ path: targetPath, source: nextSource }))
      dispatch(updateTabSaveStatus({ path: targetPath, status: 'idle' }))
      bumpLibraryIndexRevision()
    },
    [activeLibraryPath, bumpLibraryIndexRevision, dispatch, resolveActiveLibraryAndroidDirectoryUri],
  )

  const handleDrawioControllerReady = useCallback(
    (filePath: string, controller: DrawioDocumentController | null) => {
      if (controller) { drawioControllersRef.current.set(filePath, controller) }
      else { drawioControllersRef.current.delete(filePath) }
    },
    [drawioControllersRef],
  )

  return {
    handleInkdocDocumentPersist,
    handleDrawioDocumentPersist,
    handleDrawioControllerReady,
  }
}