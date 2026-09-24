import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import type { TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'
import type { Qwen3TtsPreferences } from '../../services/preferences/qwen3TtsSettingsStorage'
import type { SpeechRecognitionPreferences } from '../../services/preferences/speechRecognitionSettingsStorage'
import type { TaskManagerPublicationPreferences } from '../../services/preferences/taskManagerPublicationSettingsStorage'

export interface PreferencesState {
  theme: 'dark' | 'light'
  aiSettings: AiPreferences
  inkMathPreferences: InkMathPreferences
  explorerRefreshIntervalMs: number
  telegramSettings: TelegramPreferences
  qwen3TtsSettings: Qwen3TtsPreferences
  speechRecognitionSettings: SpeechRecognitionPreferences
  taskManagerPublicationPreferences: TaskManagerPublicationPreferences
  /** Device preferences arrive from the backend after start. */
  devicePreferencesLoaded: boolean
}
