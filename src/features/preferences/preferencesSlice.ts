import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { loadThemePreference, saveThemePreference, type NotiaTheme } from '../../services/preferences/themeStorage'
import { loadAiPreferences, saveAiPreferences, type AiPreferences } from '../../services/preferences/aiSettingsStorage'
import { loadInkMathPreferences, saveInkMathPreferences, type InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import { loadExplorerRefreshIntervalMs, saveExplorerRefreshIntervalMs } from '../../services/preferences/explorerPanelStorage'
import type { PreferencesState } from './preferencesTypes'
import { DEFAULT_TELEGRAM_PREFERENCES, type TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'

const initialState: PreferencesState = {
  theme: loadThemePreference(),
  aiSettings: loadAiPreferences(),
  inkMathPreferences: loadInkMathPreferences(),
  explorerRefreshIntervalMs: loadExplorerRefreshIntervalMs(),
  telegramSettings: DEFAULT_TELEGRAM_PREFERENCES,
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
    setInkMathPreferences(state, action: PayloadAction<InkMathPreferences>) {
      state.inkMathPreferences = action.payload
      saveInkMathPreferences(action.payload)
    },
    setExplorerRefreshIntervalMs(state, action: PayloadAction<number>) {
      state.explorerRefreshIntervalMs = action.payload
      saveExplorerRefreshIntervalMs(action.payload)
    },
    setTelegramSettings(state, action: PayloadAction<TelegramPreferences>) {
      state.telegramSettings = action.payload
    },
  },
})

export const {
  setTheme,
  toggleTheme,
  setAiSettings,
  setInkMathPreferences,
  setExplorerRefreshIntervalMs,
  setTelegramSettings,
} = preferencesSlice.actions

export default preferencesSlice.reducer
