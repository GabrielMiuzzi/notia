import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { UiState } from './uiTypes'

const initialState: UiState = {
  activeView: 'documents',
  isSidebarOpen: true,
  isRightChatPanelOpen: false,
  isRightPanelChatMounted: false,
  isSearchMenuOpen: false,
  activeHeaderAction: '',
  isSettingsOpen: false,
  isLibraryManagerOpen: false,
  activeModal: null,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveView(state, action: PayloadAction<UiState['activeView']>) {
      state.activeView = action.payload
    },
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.isSidebarOpen = action.payload
    },
    toggleSidebar(state) {
      state.isSidebarOpen = !state.isSidebarOpen
      if (!state.isSidebarOpen) {
        state.isSearchMenuOpen = false
        state.activeHeaderAction = ''
      }
    },
    setRightChatPanelOpen(state, action: PayloadAction<boolean>) {
      state.isRightChatPanelOpen = action.payload
    },
    toggleRightChatPanel(state) {
      state.isRightChatPanelOpen = !state.isRightChatPanelOpen
    },
    setRightPanelChatMounted(state, action: PayloadAction<boolean>) {
      state.isRightPanelChatMounted = action.payload
    },
    setSearchMenuOpen(state, action: PayloadAction<boolean>) {
      state.isSearchMenuOpen = action.payload
      state.activeHeaderAction = action.payload ? 'search' : ''
    },
    setActiveHeaderAction(state, action: PayloadAction<string>) {
      state.activeHeaderAction = action.payload
    },
    setSettingsOpen(state, action: PayloadAction<boolean>) {
      state.isSettingsOpen = action.payload
    },
    setLibraryManagerOpen(state, action: PayloadAction<boolean>) {
      state.isLibraryManagerOpen = action.payload
    },
    closeSearchMenu(state) {
      state.isSearchMenuOpen = false
      if (state.activeHeaderAction === 'search') {
        state.activeHeaderAction = ''
      }
    },
    resetUiForLibrarySwitch(state) {
      state.isSearchMenuOpen = false
      state.activeHeaderAction = ''
    },
  },
})

export const {
  setActiveView,
  setSidebarOpen,
  toggleSidebar,
  setRightChatPanelOpen,
  toggleRightChatPanel,
  setRightPanelChatMounted,
  setSearchMenuOpen,
  setActiveHeaderAction,
  setSettingsOpen,
  setLibraryManagerOpen,
  closeSearchMenu,
  resetUiForLibrarySwitch,
} = uiSlice.actions

export default uiSlice.reducer