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

interface UseDocumentPersistParams {
  resolveActiveLibraryAndroidDirectoryUri: (pathValue?: string | null) => string | undefined
  bumpLibraryIndexRevision: () => void
  activeLibraryPath: string | undefined
}

export function useDocumentPersist({
  resolveActiveLibraryAndroidDirectoryUri,
  bumpLibraryIndexRevision,
  activeLibraryPath,
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

  return {
    handleInkdocDocumentPersist,
  }
}