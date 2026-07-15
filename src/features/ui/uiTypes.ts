export interface UiState {
  activeView: 'documents' | 'graph' | 'chat' | 'task-manager' | 'coldpass'
  isSidebarOpen: boolean
  isRightChatPanelOpen: boolean
  isRightPanelChatMounted: boolean
  isSearchMenuOpen: boolean
  activeHeaderAction: string
  isSettingsOpen: boolean
  settingsActiveSection: 'General' | 'Panel desplegable' | 'InkDocs' | 'IA' | null
  isLibraryManagerOpen: boolean
  activeModal: string | null
}