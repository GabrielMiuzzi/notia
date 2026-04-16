export interface UiState {
  activeView: 'documents' | 'graph' | 'chat' | 'task-manager' | 'coldpass'
  isSidebarOpen: boolean
  isRightChatPanelOpen: boolean
  isRightPanelChatMounted: boolean
  isSearchMenuOpen: boolean
  activeHeaderAction: string
  isSettingsOpen: boolean
  isLibraryManagerOpen: boolean
  activeModal: string | null
}