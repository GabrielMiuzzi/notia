import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { loadThemePreference, saveThemePreference, type NotiaTheme } from '../../services/preferences/themeStorage'
import { loadAiPreferences, type AiPreferences } from '../../services/preferences/aiSettingsStorage'
import { loadInkMathPreferences, saveInkMathPreferences, type InkMathPreferences } from '../../services/preferences/inkMathSettingsStorage'
import { loadExplorerRefreshIntervalMs, saveExplorerRefreshIntervalMs } from '../../services/preferences/explorerPanelStorage'
import type { PreferencesState } from './preferencesTypes'
import { DEFAULT_TELEGRAM_PREFERENCES, type TelegramPreferences } from '../../services/preferences/telegramSettingsStorage'
import { DEFAULT_QWEN3_TTS_PREFERENCES, type Qwen3TtsPreferences } from '../../services/preferences/qwen3TtsSettingsStorage'
import { DEFAULT_SPEECH_RECOGNITION_PREFERENCES, type SpeechRecognitionPreferences } from '../../services/preferences/speechRecognitionSettingsStorage'
import { DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES, type TaskManagerPublicationPreferences } from '../../services/preferences/taskManagerPublicationSettingsStorage'
import type { DevicePreferences } from '../../services/preferences/devicePreferencesStorage'
import type { EditorPagePreferences, PenPreferences } from '../../services/preferences/editorPreferences'

const initialState: PreferencesState = {
  theme: loadThemePreference(),
  aiSettings: loadAiPreferences(),
  inkMathPreferences: loadInkMathPreferences(),
  explorerRefreshIntervalMs: loadExplorerRefreshIntervalMs(),
  telegramSettings: DEFAULT_TELEGRAM_PREFERENCES,
  qwen3TtsSettings: DEFAULT_QWEN3_TTS_PREFERENCES,
  speechRecognitionSettings: DEFAULT_SPEECH_RECOGNITION_PREFERENCES,
  taskManagerPublicationPreferences: DEFAULT_TASK_MANAGER_PUBLICATION_PREFERENCES,
  editorPage: null,
  editorPageSetup: null,
  pen: null,
  editorPreferencesError: null,
  devicePreferencesLoaded: false,
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
      // Keep provider credentials out of Redux. The boundary callback updates
      // credential storage before dispatching this redacted action.
      state.aiSettings = { ...action.payload, apiKey: '' }
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
    setQwen3TtsSettings(state, action: PayloadAction<Qwen3TtsPreferences>) {
      state.qwen3TtsSettings = action.payload
    },
    setSpeechRecognitionSettings(state, action: PayloadAction<SpeechRecognitionPreferences>) {
      state.speechRecognitionSettings = action.payload
    },
    setTaskManagerPublicationPreferences(state, action: PayloadAction<TaskManagerPublicationPreferences>) {
      state.taskManagerPublicationPreferences = action.payload
    },
    hydrateDevicePreferences(state, action: PayloadAction<DevicePreferences>) {
      state.taskManagerPublicationPreferences = action.payload.taskManagerPublication
      state.speechRecognitionSettings = action.payload.speechRecognition
      state.qwen3TtsSettings = action.payload.qwen3Tts
      state.editorPage = action.payload.editorPage
      state.editorPageSetup = action.payload.editorPageSetup
      state.pen = action.payload.pen
      state.devicePreferencesLoaded = true
    },
    /** The editor sections as the backend saved them. */
    hydrateEditorPreferences(state, action: PayloadAction<DevicePreferences>) {
      state.editorPage = action.payload.editorPage
      state.editorPageSetup = action.payload.editorPageSetup
      state.pen = action.payload.pen
      state.editorPreferencesError = null
    },
    /** Shows a change right away, before the backend confirms it. */
    setEditorPagePreferences(state, action: PayloadAction<EditorPagePreferences>) {
      state.editorPage = action.payload
    },
    setPenPreferences(state, action: PayloadAction<PenPreferences>) {
      state.pen = action.payload
    },
    setEditorPreferencesError(state, action: PayloadAction<string | null>) {
      state.editorPreferencesError = action.payload
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
  setQwen3TtsSettings,
  setSpeechRecognitionSettings,
  setTaskManagerPublicationPreferences,
  hydrateDevicePreferences,
  hydrateEditorPreferences,
  setEditorPagePreferences,
  setPenPreferences,
  setEditorPreferencesError,
} = preferencesSlice.actions

export default preferencesSlice.reducer
