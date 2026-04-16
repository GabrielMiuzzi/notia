import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { loadThemePreference, saveThemePreference, type NotiaTheme } from '../../services/preferences/themeStorage'
import { loadAiPreferences, saveAiPreferences, type AiPreferences } from '../../services/preferences/aiSettingsStorage'
import { loadInkdocPreferences, saveInkdocPreferences, type InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import { loadExplorerRefreshIntervalMs, saveExplorerRefreshIntervalMs } from '../../services/preferences/explorerPanelStorage'
import type { PreferencesState } from './preferencesTypes'

const initialState: PreferencesState = {
  theme: loadThemePreference(),
  aiSettings: loadAiPreferences(),
  inkdocPreferences: loadInkdocPreferences(),
  explorerRefreshIntervalMs: loadExplorerRefreshIntervalMs(),
}

const preferencesSlice = createSlice({
  name: 'preferences',
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<NotiaTheme>) {
      state.theme = action.payload
      saveThemePreference(action.payload)
    },
    toggleTheme(state) {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      state.theme = next
      saveThemePreference(next)
    },
    setAiSettings(state, action: PayloadAction<AiPreferences>) {
      state.aiSettings = action.payload
      saveAiPreferences(action.payload)
    },
    setInkdocPreferences(state, action: PayloadAction<InkdocPreferences>) {
      state.inkdocPreferences = action.payload
      saveInkdocPreferences(action.payload)
    },
    setExplorerRefreshIntervalMs(state, action: PayloadAction<number>) {
      state.explorerRefreshIntervalMs = action.payload
      saveExplorerRefreshIntervalMs(action.payload)
    },
  },
})

export const {
  setTheme,
  toggleTheme,
  setAiSettings,
  setInkdocPreferences,
  setExplorerRefreshIntervalMs,
} = preferencesSlice.actions

export default preferencesSlice.reducer