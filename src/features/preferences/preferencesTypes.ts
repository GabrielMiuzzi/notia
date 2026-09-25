import type { AiPreferences } from '../../services/preferences/aiSettingsStorage'
import type { InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import type { TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'
import type { Qwen3TtsPreferences } from '../../services/preferences/qwen3TtsSettingsStorage'
import type { SpeechRecognitionPreferences } from '../../services/preferences/speechRecognitionSettingsStorage'
import type { TaskManagerPublicationPreferences } from '../../services/preferences/taskManagerPublicationSettingsStorage'
import type { EditorPagePreferences, EditorPageSetup, PenPreferences } from '../../services/preferences/editorPreferences'

export interface PreferencesState {
  theme: 'dark' | 'light'
  aiSettings: AiPreferences
  inkMathPreferences: InkMathPreferences
  explorerRefreshIntervalMs: number
  telegramSettings: TelegramPreferences
  qwen3TtsSettings: Qwen3TtsPreferences
  speechRecognitionSettings: SpeechRecognitionPreferences
  taskManagerPublicationPreferences: TaskManagerPublicationPreferences
  /** Page mode and page setup; `null` until the backend answers. */
  editorPage: EditorPagePreferences | null
  /** What the backend derives from `editorPage` to draw the pages. */
  editorPageSetup: EditorPageSetup | null
  pen: PenPreferences | null
  /** Why the last editor preference change could not be saved. */
  editorPreferencesError: string | null
  /** Device preferences arrive from the backend after start. */
  devicePreferencesLoaded: boolean
}
