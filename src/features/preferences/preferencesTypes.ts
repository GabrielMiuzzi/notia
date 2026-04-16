import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type { InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'

export interface PreferencesState {
  theme: 'dark' | 'light'
  aiSettings: AiPreferences
  inkdocPreferences: InkdocPreferences
  explorerRefreshIntervalMs: number
}