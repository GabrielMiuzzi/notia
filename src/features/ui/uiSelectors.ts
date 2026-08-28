import type { RootState } from '../../store/index'
import { CHAT_WORKSPACE_TAB_PATH, COLDPASS_WORKSPACE_TAB_PATH, GRAPH_WORKSPACE_TAB_PATH, MEETING_WORKSPACE_TAB_PATH, TASK_MANAGER_WORKSPACE_TAB_PATH, FINANCE_WORKSPACE_TAB_PATH } from '../documents/documentsSlice'

export const selectActiveView = (state: RootState) => state.ui.activeView
export const selectIsSidebarOpen = (state: RootState) => state.ui.isSidebarOpen
export const selectIsRightChatPanelOpen = (state: RootState) => state.ui.isRightChatPanelOpen
export const selectIsRightPanelChatMounted = (state: RootState) => state.ui.isRightPanelChatMounted
export const selectIsSearchMenuOpen = (state: RootState) => state.ui.isSearchMenuOpen
export const selectActiveHeaderAction = (state: RootState) => state.ui.activeHeaderAction
export const selectIsSettingsOpen = (state: RootState) => state.ui.isSettingsOpen
export const selectSettingsActiveSection = (state: RootState) => state.ui.settingsActiveSection
export const selectIsLibraryManagerOpen = (state: RootState) => state.ui.isLibraryManagerOpen
export const selectActiveModal = (state: RootState) => state.ui.activeModal

export const selectActiveRailActionId = (state: RootState): string | null => {
  const path = state.documents.activeTabPath
  if (path === GRAPH_WORKSPACE_TAB_PATH) return 'graph-view'
  if (path === CHAT_WORKSPACE_TAB_PATH) return 'chat'
  if (path === TASK_MANAGER_WORKSPACE_TAB_PATH) return 'task-manager'
  if (path === COLDPASS_WORKSPACE_TAB_PATH) return 'coldpass'
  if (path === MEETING_WORKSPACE_TAB_PATH) return 'meeting'
  if (path === FINANCE_WORKSPACE_TAB_PATH) return 'finance'
  return null
}

export const selectIsHeavyWorkspaceView = (state: RootState): boolean => {
  const view = state.ui.activeView
  return view === 'graph' || view === 'chat' || view === 'task-manager'
}
