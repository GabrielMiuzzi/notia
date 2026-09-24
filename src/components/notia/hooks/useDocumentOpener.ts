import { useCallback, useRef } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import {
  setActiveTabPath,
  setContextMenu,
  setPendingCreation,
  setRenamingPath,
  setDialogState,
} from '../../../features/documents/documentsSlice'
import { readLibraryDocument } from '../../../services/libraries/libraryDocumentRuntime'
import { resolveFileViewKind, isTextualViewKind } from '../../../services/views/fileViewResolver'
import { getFileExtension } from '../../../utils/files/getFileExtension'
import { backendFileUrl } from '../../../services/transport'
import { startPerformanceMeasurement } from '../../../services/runtime/performanceBaseline'
import { notiaTimer } from '../../../services/runtime/notiaLogger'
import type { OpenFileDocument } from '../../../types/views/fileDocument'

interface UseDocumentOpenerParams {
  openDocumentInTab: (document: OpenFileDocument, latestSavedSource: string, latestSavedRevision?: string) => void
  activeLibrary: { id: string; path: string } | null
}

export function useDocumentOpener({
  openDocumentInTab,
  activeLibrary,
}: UseDocumentOpenerParams) {
  const dispatch = useAppDispatch()
  const openingDocumentPathsRef = useRef<Set<string>>(new Set())

  const handleOpenFile = useCallback(async (filePath: string) => {
    const openTimer = notiaTimer('document', 'useDocumentOpener.handleOpenFile', { filePath })
    const existingTab = store.getState().documents.openTabs.find((tab) => tab.document.path === filePath)
    if (existingTab) { dispatch(setActiveTabPath(filePath)); openTimer.success({ stage: 'existing_tab' }); return }
    if (openingDocumentPathsRef.current.has(filePath)) { dispatch(setActiveTabPath(filePath)); openTimer.success({ stage: 'already_opening' }); return }

    const extension = getFileExtension(filePath)
    const viewKind = resolveFileViewKind(extension)
    dispatch(setContextMenu(null))
    dispatch(setPendingCreation(null))
    dispatch(setRenamingPath(null))

    const openFileMeasurement = startPerformanceMeasurement('document.open', { extension, filePath, viewKind })

    if (isTextualViewKind(viewKind)) {
      openingDocumentPathsRef.current.add(filePath)
      try {
        const result = activeLibrary
          ? await readLibraryDocument(activeLibrary.id, filePath, { markdownDefaults: extension === 'md' })
          : { ok: false, content: '', error: 'No hay una biblioteca abierta.' }
        if (!result.ok) {
          openFileMeasurement.error(new Error(result.error ?? 'Could not read file.'))
          dispatch(setDialogState({
            type: 'info',
            title: 'No se pudo abrir el archivo',
            message: result.error ?? 'No se pudo leer el contenido del archivo.',
          }))
          return
        }
        const name = filePath.split('/').pop() ?? filePath
        const nextDocument: OpenFileDocument = {
          path: filePath,
          name,
          extension,
          viewKind,
          source: result.content,
          ...(result.lockedContext ? { lockedContext: result.lockedContext } : {}),
        }
        openDocumentInTab(nextDocument, result.content, result.revision)
        openFileMeasurement.success({ sourceLength: result.content.length })
        openTimer.success({ stage: 'textual_loaded', sourceLength: result.content.length })
        return
      } finally {
        openingDocumentPathsRef.current.delete(filePath)
      }
    }

    const name = filePath.split('/').pop() ?? filePath
    openDocumentInTab({ path: filePath, name, extension, viewKind, imageUrl: backendFileUrl(filePath) }, '')
    openFileMeasurement.success()
    openTimer.success({ stage: 'binary_loaded' })
  }, [activeLibrary, dispatch, openDocumentInTab])

  const handleOpenFileFromView = useCallback(
    (filePath: string) => { void handleOpenFile(filePath) },
    [handleOpenFile],
  )

  return {
    handleOpenFile,
    handleOpenFileFromView,
  }
}
