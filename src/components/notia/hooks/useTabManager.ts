import { useCallback } from 'react'
import { useAppDispatch } from '../../../store/hooks'
import { store } from '../../../store/index'
import { selectActiveTabPath } from '../../../features/documents/documentsSelectors'
import {
  setOpenTabs,
  addOpenTab,
  updateTabSource,
  updateTabSaveStatus,
  updateTabSavedSource,
  renameTabPath,
  setActiveTabPath,
  setSpecialTabs,
  setDialogState,
  resetTabs as resetTabsAction,
  GRAPH_WORKSPACE_TAB_PATH,
  CHAT_WORKSPACE_TAB_PATH,
  TASK_MANAGER_WORKSPACE_TAB_PATH,
  COLDPASS_WORKSPACE_TAB_PATH,
} from '../../../features/documents/documentsSlice'
import {
  invalidateLibrarySearchGraphIndex,
} from '../../../services/libraries/librarySearchGraphIndex'
import {
  writeLibraryFileContent,
} from '../../../services/libraries/libraryDocumentRuntime'
import {
  isTextFileDocument,
  type OpenFileDocument,
  type NotiaDocumentSaveStatus,
} from '../../../types/views/fileDocument'

interface OpenDocumentTab {
  document: OpenFileDocument
  saveStatus: NotiaDocumentSaveStatus
  latestSavedSource: string
}

interface WorkspaceTitleTab {
  path: string
  title: string
}

interface OpenWorkspaceSpecialTabs {
  graph: boolean
  chat: boolean
  taskManager: boolean
  coldPass: boolean
}

function getDisplayBaseName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) { return value }

  const stripQueryAndHash = (input: string): string => input.replace(/[?#].*$/, '')
  const decodePath = (input: string): string => {
    try { return decodeURIComponent(input) } catch { return input }
  }

  let normalized = stripQueryAndHash(trimmed).replace(/\\/g, '/')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed)
      normalized = decodePath(`${parsed.hostname}${parsed.pathname}`).replace(/\\/g, '/')
    } catch {
      normalized = decodePath(normalized)
    }
  } else {
    normalized = decodePath(normalized)
  }

  let leaf = normalized.split('/').filter(Boolean).pop() ?? normalized
  if (!leaf) { leaf = trimmed }

  const lastColonIndex = leaf.lastIndexOf(':')
  if (lastColonIndex > 0) { leaf = leaf.slice(lastColonIndex + 1) }

  const lastDotIndex = leaf.lastIndexOf('.')
  if (lastDotIndex > 0) { return leaf.slice(0, lastDotIndex) }
  return leaf
}

function resolveWorkspaceTabTitle(tab: OpenDocumentTab): string {
  return getDisplayBaseName(tab.document.name || tab.document.path)
}

export function buildWorkspaceTitleTabs(
  documentTabs: OpenDocumentTab[],
  specialTabs: OpenWorkspaceSpecialTabs,
): WorkspaceTitleTab[] {
  const tabs: WorkspaceTitleTab[] = documentTabs.map((tab) => ({
    path: tab.document.path,
    title: resolveWorkspaceTabTitle(tab),
  }))

  if (specialTabs.graph) { tabs.push({ path: GRAPH_WORKSPACE_TAB_PATH, title: 'Graph view' }) }
  if (specialTabs.chat) { tabs.push({ path: CHAT_WORKSPACE_TAB_PATH, title: 'Chat' }) }
  if (specialTabs.taskManager) { tabs.push({ path: TASK_MANAGER_WORKSPACE_TAB_PATH, title: 'Task manager' }) }
  if (specialTabs.coldPass) { tabs.push({ path: COLDPASS_WORKSPACE_TAB_PATH, title: 'ColdPass' }) }

  return tabs
}

export function isSameOrNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedCandidate = candidatePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalizedBase === normalizedCandidate) { return true }
  return normalizedCandidate.startsWith(`${normalizedBase}/`)
}

export function getParentDirectory(filePath: string): string {
  const lastForwardSlash = filePath.lastIndexOf('/')
  const lastBackwardSlash = filePath.lastIndexOf('\\')
  const separatorIndex = Math.max(lastForwardSlash, lastBackwardSlash)
  if (separatorIndex < 0) { return filePath }
  if (separatorIndex === 0) { return filePath.slice(0, 1) }
  if (separatorIndex === 2 && /^[a-zA-Z]:[\\/]/.test(filePath)) { return filePath.slice(0, 3) }
  return filePath.slice(0, separatorIndex)
}

export function joinParentPath(parentPath: string, originalPath: string, name: string): string {
  const separator = originalPath.includes('\\') ? '\\' : '/'
  if (parentPath.endsWith('/') || parentPath.endsWith('\\')) {
    return `${parentPath}${name}`
  }
  return `${parentPath}${separator}${name}`
}

interface UseTabManagerParams {
  resolveActiveLibraryAndroidDirectoryUri: (pathValue?: string | null) => string | undefined
  clearPendingTextSaveByPath: (path: string) => void
  bumpLibraryIndexRevision: () => void
  resetColdPassSession: () => void
  activeLibraryPath: string | undefined
}

export function useTabManager({
  resolveActiveLibraryAndroidDirectoryUri,
  clearPendingTextSaveByPath,
  bumpLibraryIndexRevision,
  resetColdPassSession,
  activeLibraryPath,
}: UseTabManagerParams) {
  const dispatch = useAppDispatch()

  const persistTextDocumentSource = useCallback(
    async (targetPath: string, targetSource: string): Promise<boolean> => {
      const currentTab = store.getState().documents.openTabs.find((tab) => tab.document.path === targetPath)
      if (!currentTab || !isTextFileDocument(currentTab.document) || currentTab.document.source !== targetSource) {
        return true
      }
      dispatch(updateTabSaveStatus({ path: targetPath, status: 'saving' }))
      const result = await writeLibraryFileContent(targetPath, targetSource, {
        androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(targetPath),
      })
      const latestTab = store.getState().documents.openTabs.find((tab) => tab.document.path === targetPath)
      if (!latestTab || !isTextFileDocument(latestTab.document) || latestTab.document.source !== targetSource) {
        return true
      }
      if (result.ok) {
        if (activeLibraryPath) {
          invalidateLibrarySearchGraphIndex(activeLibraryPath, targetPath)
        }
        dispatch(updateTabSavedSource({ path: targetPath, source: targetSource }))
        bumpLibraryIndexRevision()
        return true
      }
      dispatch(updateTabSaveStatus({ path: targetPath, status: 'error' }))
      dispatch(setDialogState({
        type: 'info',
        title: 'No se pudo guardar',
        message: result.error ?? 'No se pudo guardar el archivo.',
      }))
      return false
    },
    [activeLibraryPath, bumpLibraryIndexRevision, dispatch, resolveActiveLibraryAndroidDirectoryUri],
  )

  const persistOpenTabBeforeClose = useCallback(
    async (tab: OpenDocumentTab): Promise<boolean> => {
      const tabPath = tab.document.path
      clearPendingTextSaveByPath(tabPath)

      if (isTextFileDocument(tab.document)) {
        if (tab.document.source === tab.latestSavedSource) { return true }
        return persistTextDocumentSource(tabPath, tab.document.source)
      }

      if (tab.document.viewKind === 'inkdoc' && tab.document.source !== tab.latestSavedSource) {
        const result = await writeLibraryFileContent(tabPath, tab.document.source, {
          androidDirectoryUri: resolveActiveLibraryAndroidDirectoryUri(tabPath),
        })
        if (result.ok) {
          if (activeLibraryPath) { invalidateLibrarySearchGraphIndex(activeLibraryPath, tabPath) }
          bumpLibraryIndexRevision()
          return true
        }
        if (!store.getState().documents.dialogState) {
          dispatch(setDialogState({
            type: 'info',
            title: 'No se pudo guardar',
            message: result.error ?? 'No se pudo guardar el archivo Inkdoc.',
          }))
        }
        return false
      }

      return true
    },
    [activeLibraryPath, bumpLibraryIndexRevision, clearPendingTextSaveByPath, dispatch, persistTextDocumentSource, resolveActiveLibraryAndroidDirectoryUri],
  )

  const closeTabByPath = useCallback(async (tabPath: string) => {
    if (
      tabPath === GRAPH_WORKSPACE_TAB_PATH
      || tabPath === CHAT_WORKSPACE_TAB_PATH
      || tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH
      || tabPath === COLDPASS_WORKSPACE_TAB_PATH
    ) {
      const currentSpecialTabs = store.getState().documents.specialTabs
      if (
        (tabPath === GRAPH_WORKSPACE_TAB_PATH && !currentSpecialTabs.graph)
        || (tabPath === CHAT_WORKSPACE_TAB_PATH && !currentSpecialTabs.chat)
        || (tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH && !currentSpecialTabs.taskManager)
        || (tabPath === COLDPASS_WORKSPACE_TAB_PATH && !currentSpecialTabs.coldPass)
      ) { return }

      const currentTabs = buildWorkspaceTitleTabs(store.getState().documents.openTabs, currentSpecialTabs)
      const closingIndex = currentTabs.findIndex((tab) => tab.path === tabPath)
      if (closingIndex < 0) { return }

      const nextSpecialTabs: OpenWorkspaceSpecialTabs = {
        graph: tabPath === GRAPH_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.graph,
        chat: tabPath === CHAT_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.chat,
        taskManager: tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.taskManager,
        coldPass: tabPath === COLDPASS_WORKSPACE_TAB_PATH ? false : currentSpecialTabs.coldPass,
      }
      const remainingTabs = buildWorkspaceTitleTabs(store.getState().documents.openTabs, nextSpecialTabs)
      const currentActiveTabPath = selectActiveTabPath(store.getState())
      let nextActiveTabPath = currentActiveTabPath
      if (currentActiveTabPath === tabPath) {
        if (remainingTabs.length === 0) {
          nextActiveTabPath = null
        } else {
          const fallbackIndex = closingIndex > 0 ? closingIndex - 1 : 0
          const safeFallbackIndex = Math.min(fallbackIndex, remainingTabs.length - 1)
          nextActiveTabPath = remainingTabs[safeFallbackIndex].path
        }
      }
      if (nextActiveTabPath && !remainingTabs.some((tab) => tab.path === nextActiveTabPath)) {
        nextActiveTabPath = remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].path : null
      }
      dispatch(setSpecialTabs(nextSpecialTabs))
      if (tabPath === COLDPASS_WORKSPACE_TAB_PATH) { resetColdPassSession() }
      dispatch(setActiveTabPath(nextActiveTabPath))
      return
    }

    const tabToClose = store.getState().documents.openTabs.find((tab) => tab.document.path === tabPath)
    if (!tabToClose) { return }
    const canClose = await persistOpenTabBeforeClose(tabToClose)
    if (!canClose) { return }

    const currentTabs = store.getState().documents.openTabs
    const closingIndex = currentTabs.findIndex((tab) => tab.document.path === tabPath)
    if (closingIndex < 0) { return }

    const remainingDocumentTabs = currentTabs.filter((tab) => tab.document.path !== tabPath)
    const specialTabs = store.getState().documents.specialTabs
    const workspaceTabsBeforeClose = buildWorkspaceTitleTabs(currentTabs, specialTabs)
    const workspaceTabsAfterClose = buildWorkspaceTitleTabs(remainingDocumentTabs, specialTabs)
    const currentActiveTabPath = selectActiveTabPath(store.getState())
    let nextActiveTabPath = currentActiveTabPath
    if (currentActiveTabPath === tabPath) {
      if (workspaceTabsAfterClose.length === 0) {
        nextActiveTabPath = null
      } else {
        const workspaceClosingIndex = workspaceTabsBeforeClose.findIndex((tab) => tab.path === tabPath)
        const fallbackIndex = workspaceClosingIndex > 0 ? workspaceClosingIndex - 1 : 0
        const safeFallbackIndex = Math.min(fallbackIndex, workspaceTabsAfterClose.length - 1)
        nextActiveTabPath = workspaceTabsAfterClose[safeFallbackIndex].path
      }
    }
    if (nextActiveTabPath && !workspaceTabsAfterClose.some((tab) => tab.path === nextActiveTabPath)) {
      nextActiveTabPath = workspaceTabsAfterClose.length > 0 ? workspaceTabsAfterClose[workspaceTabsAfterClose.length - 1].path : null
    }
    dispatch(setOpenTabs(remainingDocumentTabs))
    dispatch(setActiveTabPath(nextActiveTabPath))
  }, [dispatch, persistOpenTabBeforeClose, resetColdPassSession])

  const handleCloseTab = useCallback((tabPath: string) => { void closeTabByPath(tabPath) }, [closeTabByPath])

  const handleCloseActiveTab = useCallback(() => {
    const currentActiveTabPath = selectActiveTabPath(store.getState())
    if (!currentActiveTabPath) { return }
    void closeTabByPath(currentActiveTabPath)
  }, [closeTabByPath])

  const handleCycleToNextTab = useCallback(() => {
    const currentTabs = buildWorkspaceTitleTabs(store.getState().documents.openTabs, store.getState().documents.specialTabs)
    if (currentTabs.length <= 1) { return }
    const currentActiveTabPath = selectActiveTabPath(store.getState())
    const activeIndex = currentTabs.findIndex((tab) => tab.path === currentActiveTabPath)
    const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % currentTabs.length
    dispatch(setActiveTabPath(currentTabs[nextIndex].path))
  }, [dispatch])

  const closeTabsByPath = useCallback((path: string) => {
    const currentTabs = store.getState().documents.openTabs
    const remainingDocumentTabs = currentTabs.filter((tab) => !isSameOrNestedPath(path, tab.document.path))
    if (remainingDocumentTabs.length === currentTabs.length) { return }
    for (const tab of currentTabs) {
      if (isSameOrNestedPath(path, tab.document.path)) {
        clearPendingTextSaveByPath(tab.document.path)
      }
    }
    const workspaceTabsAfterClose = buildWorkspaceTitleTabs(remainingDocumentTabs, store.getState().documents.specialTabs)
    const currentActiveTabPath = selectActiveTabPath(store.getState())
    const nextActiveTabPath =
      currentActiveTabPath && workspaceTabsAfterClose.some((tab) => tab.path === currentActiveTabPath)
        ? currentActiveTabPath
        : workspaceTabsAfterClose.length > 0
          ? workspaceTabsAfterClose[workspaceTabsAfterClose.length - 1].path
          : null
    dispatch(setOpenTabs(remainingDocumentTabs))
    dispatch(setActiveTabPath(nextActiveTabPath))
  }, [clearPendingTextSaveByPath, dispatch])

  const renameOpenTabPath = useCallback((path: string, nextPath: string, name: string) => {
    clearPendingTextSaveByPath(path)
    dispatch(renameTabPath({ oldPath: path, newPath: nextPath, name }))
    if (selectActiveTabPath(store.getState()) === path) { dispatch(setActiveTabPath(nextPath)) }
  }, [clearPendingTextSaveByPath, dispatch])

  const openDocumentInTab = useCallback((document: OpenFileDocument, latestSavedSource: string) => {
    dispatch(addOpenTab({ document, saveStatus: 'idle', latestSavedSource }))
    dispatch(setActiveTabPath(document.path))
  }, [dispatch])

  const handleActivateTab = useCallback((tabPath: string) => {
    if (
      tabPath === GRAPH_WORKSPACE_TAB_PATH
      || tabPath === CHAT_WORKSPACE_TAB_PATH
      || tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH
      || tabPath === COLDPASS_WORKSPACE_TAB_PATH
    ) {
      const specialTabs = store.getState().documents.specialTabs
      if (
        (tabPath === GRAPH_WORKSPACE_TAB_PATH && !specialTabs.graph)
        || (tabPath === CHAT_WORKSPACE_TAB_PATH && !specialTabs.chat)
        || (tabPath === TASK_MANAGER_WORKSPACE_TAB_PATH && !specialTabs.taskManager)
        || (tabPath === COLDPASS_WORKSPACE_TAB_PATH && !specialTabs.coldPass)
      ) { return }
      dispatch(setActiveTabPath(tabPath))
      return
    }
    if (!store.getState().documents.openTabs.some((tab) => tab.document.path === tabPath)) { return }
    dispatch(setActiveTabPath(tabPath))
  }, [dispatch])

  const handleTextDocumentChange = useCallback((nextSource: string) => {
    const targetPath = selectActiveTabPath(store.getState())
    if (!targetPath) { return }
    dispatch(updateTabSource({ path: targetPath, source: nextSource }))
  }, [dispatch])

  const resetTabs = useCallback(() => {
    dispatch(resetTabsAction())
    resetColdPassSession()
    dispatch(setActiveTabPath(null))
  }, [dispatch, resetColdPassSession])

  return {
    closeTabByPath,
    handleCloseTab,
    handleCloseActiveTab,
    handleCycleToNextTab,
    closeTabsByPath,
    renameOpenTabPath,
    openDocumentInTab,
    handleActivateTab,
    handleTextDocumentChange,
    persistTextDocumentSource,
    resetTabs,
  }
}
