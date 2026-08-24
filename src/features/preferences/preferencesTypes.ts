import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type { InkdocPreferences } from '../../services/preferences/inkdocSettingsStorage'
import type { TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'

export interface PreferencesState {
  theme: 'dark' | 'light'
  aiSettings: AiPreferences
  inkdocPreferences: InkdocPreferences
  explorerRefreshIntervalMs: number
  telegramSettings: TelegramPreferences
}
