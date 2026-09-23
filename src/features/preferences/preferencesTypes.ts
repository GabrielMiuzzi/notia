import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import type { TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'
import type { Qwen3TtsPreferences } from '../../services/preferences/qwen3TtsSettingsStorage'
import type { Qwen3AsrPreferences } from '../../services/preferences/qwen3AsrSettingsStorage'
import type { TaskManagerPublicationPreferences } from '../../services/preferences/taskManagerPublicationSettingsStorage'

export interface PreferencesState {
  theme: 'dark' | 'light'
  aiSettings: AiPreferences
  inkMathPreferences: InkMathPreferences
  explorerRefreshIntervalMs: number
  telegramSettings: TelegramPreferences
  qwen3TtsSettings: Qwen3TtsPreferences
  qwen3AsrSettings: Qwen3AsrPreferences
  taskManagerPublicationPreferences: TaskManagerPublicationPreferences
  /** Device preferences arrive from the backend after start. */
  devicePreferencesLoaded: boolean
}
