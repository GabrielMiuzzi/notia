export interface UiState {
  activeView: 'documents' | 'graph' | 'chat' | 'task-manager' | 'coldpass' | 'meeting' | 'finance'
  isSidebarOpen: boolean
  isRightChatPanelOpen: boolean
  isRightPanelChatMounted: boolean
  isSearchMenuOpen: boolean
  activeHeaderAction: string
  isSettingsOpen: boolean
  settingsActiveSection: 'General' | 'Panel desplegable' | 'InkMath' | 'IA' | 'Voz' | 'Telegram' | 'Finanzas' | null
  isLibraryManagerOpen: boolean
  activeModal: string | null
}
