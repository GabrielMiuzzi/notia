import type { RootState } from '../../store/index'

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
  const view = state.ui.activeView
  if (view === 'graph') return 'graph-view'
  if (view === 'chat') return 'chat'
  if (view === 'task-manager') return 'task-manager'
  if (view === 'coldpass') return 'coldpass'
  return null
}

export const selectIsHeavyWorkspaceView = (state: RootState): boolean => {
  const view = state.ui.activeView
  return view === 'graph' || view === 'chat' || view === 'task-manager'
}