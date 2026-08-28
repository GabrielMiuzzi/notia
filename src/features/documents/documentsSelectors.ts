import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from '../../store/index'
import type { OpenDocumentTab } from './documentsTypes'
import { GRAPH_WORKSPACE_TAB_PATH, CHAT_WORKSPACE_TAB_PATH, TASK_MANAGER_WORKSPACE_TAB_PATH, COLDPASS_WORKSPACE_TAB_PATH, MEETING_WORKSPACE_TAB_PATH, FINANCE_WORKSPACE_TAB_PATH } from './documentsSlice'

export const selectOpenTabs = (state: RootState) => state.documents.openTabs
export const selectActiveTabPath = (state: RootState) => state.documents.activeTabPath
export const selectSpecialTabs = (state: RootState) => state.documents.specialTabs
export const selectTreeNodes = (state: RootState) => state.documents.treeNodes
export const selectSearchQuery = (state: RootState) => state.documents.searchQuery
export const selectSearchMatchedPaths = (state: RootState) => state.documents.searchMatchedPaths
export const selectIsSearchLoading = (state: RootState) => state.documents.isSearchLoading
export const selectPendingCreation = (state: RootState) => state.documents.pendingCreation
export const selectRenamingPath = (state: RootState) => state.documents.renamingPath
export const selectClipboardEntry = (state: RootState) => state.documents.clipboardEntry
export const selectContextMenu = (state: RootState) => state.documents.contextMenu
export const selectDialogState = (state: RootState) => state.documents.dialogState
export const selectLoadingFolderIds = (state: RootState) => state.documents.loadingFolderIds
export const selectFlatFileList = (state: RootState) => state.documents.flatFileList

export const selectActiveTab = createSelector(
  [(state: RootState) => state.documents.openTabs, (state: RootState) => state.documents.activeTabPath],
  (openTabs, activeTabPath): OpenDocumentTab | null => {
    return openTabs.find((tab) => tab.document.path === activeTabPath) ?? null
  },
)

export const selectActiveDocument = createSelector(
  [selectActiveTab],
  (tab) => tab?.document ?? null,
)

export const selectSaveStatus = createSelector(
  [selectActiveTab],
  (tab) => tab?.saveStatus ?? 'idle' as const,
)

export const selectActiveWorkspaceView = (state: RootState): 'documents' | 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'meeting' | 'finance' => {
  const path = state.documents.activeTabPath
  if (path === GRAPH_WORKSPACE_TAB_PATH) return 'graph'
  if (path === CHAT_WORKSPACE_TAB_PATH) return 'chat'
  if (path === TASK_MANAGER_WORKSPACE_TAB_PATH) return 'task-manager'
  if (path === COLDPASS_WORKSPACE_TAB_PATH) return 'coldpass'
  if (path === MEETING_WORKSPACE_TAB_PATH) return 'meeting'
  if (path === FINANCE_WORKSPACE_TAB_PATH) return 'finance'
  return 'documents'
}

export const selectNormalizedSearchQuery = (state: RootState) => state.documents.searchQuery.trim()

export const selectIsSearchActive = (state: RootState) => selectNormalizedSearchQuery(state).length > 0

export const selectSearchMatchedPathSet = createSelector(
  [(state: RootState) => state.documents.searchMatchedPaths],
  (paths) => new Set(paths),
)

export const selectSearchMatchedCount = (state: RootState) => state.documents.searchMatchedPaths.length

function areTitleBarTabsEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b
  if (a.length !== b.length) return false
  return a.every((item, i) => {
    const bItem = b[i]
    return (
      item !== null && bItem !== null
      && typeof item === 'object' && typeof bItem === 'object'
      && 'path' in item && 'path' in bItem
      && 'title' in item && 'title' in bItem
      && item.path === bItem.path
      && item.title === bItem.title
    )
  })
}

export const selectTitleBarTabs = createSelector(
  [(state: RootState) => state.documents.openTabs, (state: RootState) => state.documents.specialTabs],
  (openTabs, specialTabs) => {
    const tabs = openTabs.map((tab: { document: { path: string; name: string } }) => ({
      path: tab.document.path,
      title: tab.document.name.includes('.')
        ? tab.document.name.slice(0, tab.document.name.lastIndexOf('.'))
        : tab.document.name,
    }))

    if (specialTabs.graph) tabs.push({ path: GRAPH_WORKSPACE_TAB_PATH, title: 'Graph view' })
    if (specialTabs.chat) tabs.push({ path: CHAT_WORKSPACE_TAB_PATH, title: 'Chat' })
    if (specialTabs.taskManager) tabs.push({ path: TASK_MANAGER_WORKSPACE_TAB_PATH, title: 'Task manager' })
    if (specialTabs.coldPass) tabs.push({ path: COLDPASS_WORKSPACE_TAB_PATH, title: 'ColdPass' })
    if (specialTabs.meeting) tabs.push({ path: MEETING_WORKSPACE_TAB_PATH, title: 'Meeting' })
    if (specialTabs.finance) tabs.push({ path: FINANCE_WORKSPACE_TAB_PATH, title: 'Finanzas' })

    return tabs
  },
  { memoizeOptions: { resultEqualityCheck: areTitleBarTabsEqual } },
)
