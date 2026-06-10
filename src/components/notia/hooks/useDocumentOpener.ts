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
import {
  readLibraryFileContent,
  readMarkdownWithDefaults,
} from '../../../services/libraries/libraryDocumentRuntime'
import { resolveFileViewKind, isTextualViewKind } from '../../../services/views/fileViewResolver'
import { getFileExtension } from '../../../utils/files/getFileExtension'
import { toFileUrl } from '../../../utils/files/toFileUrl'
import { startPerformanceMeasurement } from '../../../services/runtime/performanceBaseline'
import type { OpenFileDocument } from '../../../types/views/fileDocument'

interface UseDocumentOpenerParams {
  openDocumentInTab: (document: OpenFileDocument, latestSavedSource: string) => void
  resolveActiveLibraryAndroidDirectoryUri: (pathValue?: string | null) => string | undefined
}

export function useDocumentOpener({
  openDocumentInTab,
  resolveActiveLibraryAndroidDirectoryUri,
}: UseDocumentOpenerParams) {
  const dispatch = useAppDispatch()
  const openingDocumentPathsRef = useRef<Set<string>>(new Set())

  const handleOpenFile = useCallback(async (filePath: string) => {
    const existingTab = store.getState().documents.openTabs.find((tab) => tab.document.path === filePath)
    if (existingTab) { dispatch(setActiveTabPath(filePath)); return }
    if (openingDocumentPathsRef.current.has(filePath)) { dispatch(setActiveTabPath(filePath)); return }

    const extension = getFileExtension(filePath)
    const viewKind = resolveFileViewKind(extension)
    dispatch(setContextMenu(null))
    dispatch(setPendingCreation(null))
    dispatch(setRenamingPath(null))

    const openFileMeasurement = startPerformanceMeasurement('document.open', { extension, filePath, viewKind })

    if (isTextualViewKind(viewKind) || viewKind === 'inkdoc') {
      openingDocumentPathsRef.current.add(filePath)
      try {
        const isMarkdown = extension === 'md'
        const readFn = isMarkdown ? readMarkdownWithDefaults : readLibraryFileContent
        const result = await readFn(filePath, {
          androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(filePath),
        })
        if (!result.ok) {
          openFileMeasurement.error(new Error(result.error ?? 'Could not read file.'))
          dispatch(setDialogState({
            type: 'info',
            title: 'No se pudo abrir el archivo',
            message: result.error ?? 'No se pudo leer el contenido del archivo.',
          }))
          return
        }
        const name = filePath.split(/[\\/]/).pop() ?? filePath
        const nextDocument: OpenFileDocument = { path: filePath, name, extension, viewKind, source: result.content }
        openDocumentInTab(nextDocument, result.content)
        openFileMeasurement.success({ sourceLength: result.content.length })
        return
      } finally {
        openingDocumentPathsRef.current.delete(filePath)
      }
    }

    const name = filePath.split(/[\\/]/).pop() ?? filePath
    openDocumentInTab({ path: filePath, name, extension, viewKind, imageUrl: toFileUrl(filePath) }, '')
    openFileMeasurement.success()
  }, [dispatch, openDocumentInTab, resolveActiveLibraryAndroidDirectoryUri])

  const handleOpenFileFromView = useCallback((filePath: string) => { void handleOpenFile(filePath) }, [handleOpenFile])

  return {
    handleOpenFile,
    handleOpenFileFromView,
  }
}