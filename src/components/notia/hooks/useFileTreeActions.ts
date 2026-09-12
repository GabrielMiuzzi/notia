import { useCallback } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import { setPendingCreation, setRenamingPath, setContextMenu, setDialogState } from '../../../features/documents/documentsSlice'
import { createLibraryEntry, performLibraryEntryOperation } from '../../../services/libraries/libraryRuntime'
import { findTreeNodeByPath } from '../../../utils/tree/findTreeNodeByPath'
import { isSameOrNestedPath, getParentDirectory, joinParentPath } from './useTabManager'
import { join } from '../../../utils/files/pathUtils'
import { writeLibraryFileContent } from '../../../services/libraries/libraryDocumentRuntime'
import { DEFAULT_CONTEXT_TAG } from '../../../services/contexts/libraryContexts'
import { loadTaskManagerSettings } from '../../../modules/task-manager/services/taskManagerStorage'
import { reconcileBoardMarkdownContext } from '../../../modules/task-manager/services/taskManagerService'
import type { NotiaFileNode } from '../../../types/notia'

interface UseFileTreeActionsParams {
  activeLibrary: { path: string; androidTreeUri?: string } | null
  resolveActiveLibraryAndroidDirectoryUri: (pathValue?: string | null) => string | undefined
  notifyLibraryTreeChanged: (pathHint?: string) => void
  persistDirtyTextDocuments: () => Promise<boolean>
  closeTabsByPath: (path: string) => Promise<boolean>
  renameOpenTabPath: (oldPath: string, newPath: string, newName: string) => void
}

export function useFileTreeActions({
  activeLibrary,
  resolveActiveLibraryAndroidDirectoryUri,
  notifyLibraryTreeChanged,
  persistDirtyTextDocuments,
  closeTabsByPath,
  renameOpenTabPath,
}: UseFileTreeActionsParams) {
  const dispatch = useAppDispatch()

  const handleSubmitPendingCreation = useCallback(async (name: string) => {
    const currentPendingCreation = store.getState().documents.pendingCreation
    if (!activeLibrary || !currentPendingCreation) {
      dispatch(setPendingCreation(null))
      return
    }
    const result = await createLibraryEntry(
      currentPendingCreation.parentPath, name, currentPendingCreation.kind,
      { androidDirectoryUri: activeLibrary.androidTreeUri },
    )
    if (!result.ok) {
      dispatch(setDialogState({ type: 'info', title: 'No se pudo crear', message: result.error ?? 'No se pudo crear el elemento.' }))
      return
    }
    if (currentPendingCreation.kind === 'note') {
      const fileName = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
      const notePath = join(currentPendingCreation.parentPath, fileName)
      const noteSource = [
        '---',
        `contexto: "${DEFAULT_CONTEXT_TAG}"`,
        '---',
        '',
      ].join('\n')
      const writeResult = await writeLibraryFileContent(notePath, noteSource, {
        androidDirectoryUri: activeLibrary.androidTreeUri,
      })
      if (!writeResult.ok) {
        dispatch(setDialogState({ type: 'info', title: 'Nota creada parcialmente', message: writeResult.error ?? 'No se pudo guardar el contexto inicial de la nota.' }))
      }
      const boardName = resolveTaskBoardName(currentPendingCreation.parentPath)
      const boardContext = boardName
        ? loadTaskManagerSettings().boards.find((board) => board.name === boardName)?.contexto
        : undefined
      if (boardName && boardContext) {
        await reconcileBoardMarkdownContext(activeLibrary.path, boardName, boardContext)
      }
    }
    dispatch(setPendingCreation(null))
    notifyLibraryTreeChanged(currentPendingCreation.parentPath)
  }, [activeLibrary, dispatch, notifyLibraryTreeChanged])

  const handleCancelPendingCreation = useCallback(() => { dispatch(setPendingCreation(null)) }, [dispatch])

  const handleNodeContextMenu = useCallback((node: NotiaFileNode, position: { x: number; y: number }) => {
    dispatch(setPendingCreation(null))
    dispatch(setContextMenu({ type: 'node', x: position.x, y: position.y, node }))
  }, [dispatch])

  const handleEmptyContextMenu = useCallback((position: { x: number; y: number }) => {
    dispatch(setPendingCreation(null))
    dispatch(setRenamingPath(null))
    dispatch(setContextMenu({ type: 'empty', x: position.x, y: position.y }))
  }, [dispatch])

  const handleRenameSubmit = useCallback(async (path: string, name: string) => {
    if (!(await persistDirtyTextDocuments())) { return }

    const result = await performLibraryEntryOperation({
      action: 'rename', targetPath: path, newName: name,
    }, { androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(path) })
    if (!result.ok) {
      dispatch(setDialogState({ type: 'info', title: 'No se pudo renombrar', message: result.error ?? 'No se pudo renombrar el elemento.' }))
      return
    }
    const openTabs = store.getState().documents.openTabs
    const hasAnyOpenTabInPath = openTabs.some((tab) => isSameOrNestedPath(path, tab.document.path))
    if (hasAnyOpenTabInPath) {
      const hasExactOpenTab = openTabs.some((tab) => tab.document.path === path)
      if (hasExactOpenTab) {
        renameOpenTabPath(path, joinParentPath(getParentDirectory(path), path, name), name)
      } else {
        await closeTabsByPath(path)
      }
    }
    dispatch(setRenamingPath(null))
    notifyLibraryTreeChanged(path)
  }, [closeTabsByPath, dispatch, notifyLibraryTreeChanged, persistDirtyTextDocuments, renameOpenTabPath, resolveActiveLibraryAndroidDirectoryUri])

  const handleMoveNode = useCallback((sourcePath: string, targetDirectoryPath: string) => {
    if (!activeLibrary) { return }
    const normalizedSourcePath = normalizePath(sourcePath)
    const normalizedTargetDirectoryPath = normalizePath(targetDirectoryPath)
    if (!normalizedSourcePath || !normalizedTargetDirectoryPath) { return }
    const sourceNode = findTreeNodeByPath(store.getState().documents.treeNodes, sourcePath)
    if (sourceNode?.type === 'folder' && isSameOrNestedPath(normalizedSourcePath, normalizedTargetDirectoryPath)) { return }
    if (normalizedSourcePath === normalizedTargetDirectoryPath) { return }
    const currentParentPath = normalizePath(getParentDirectory(normalizedSourcePath))
    if (currentParentPath === normalizedTargetDirectoryPath) { return }
    void (async () => {
      if (!(await persistDirtyTextDocuments())) { return }

      const moveResult = await performLibraryEntryOperation({
        action: 'paste', sourcePath: normalizedSourcePath, targetDirectoryPath: normalizedTargetDirectoryPath, mode: 'move',
      }, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(normalizedTargetDirectoryPath)
          ?? resolveActiveLibraryAndroidDirectoryUri(normalizedSourcePath),
      })
      if (!moveResult.ok) {
        dispatch(setDialogState({ type: 'info', title: 'No se pudo mover', message: moveResult.error ?? 'No se pudo mover el elemento.' }))
        return
      }
      const boardName = resolveTaskBoardName(normalizedTargetDirectoryPath)
      const boardContext = boardName
        ? loadTaskManagerSettings().boards.find((board) => board.name === boardName)?.contexto
        : undefined
      if (boardName && boardContext) {
        await reconcileBoardMarkdownContext(activeLibrary.path, boardName, boardContext)
      }
      await closeTabsByPath(normalizedSourcePath)
      notifyLibraryTreeChanged(normalizedTargetDirectoryPath)
    })()
  }, [activeLibrary, closeTabsByPath, dispatch, notifyLibraryTreeChanged, persistDirtyTextDocuments, resolveActiveLibraryAndroidDirectoryUri])

  const handleCancelRename = useCallback(() => { dispatch(setRenamingPath(null)) }, [dispatch])

  return {
    handleSubmitPendingCreation,
    handleCancelPendingCreation,
    handleNodeContextMenu,
    handleEmptyContextMenu,
    handleRenameSubmit,
    handleCancelRename,
    handleMoveNode,
  }
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

function resolveTaskBoardName(pathValue: string): string | undefined {
  const match = normalizePath(pathValue).match(/(?:^|\/)(?:task-mannager|task-manager)\/([^/]+)/i)
  return match?.[1]?.toLowerCase()
}
