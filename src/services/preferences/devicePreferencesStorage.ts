import { callBackend } from '../transport'
import type { EditorPagePreferences, EditorPageSetup, PenPreferences } from './editorPreferences'
import { clearLegacySpeechRecognitionPreferences, loadSpeechRecognitionPreferences, type SpeechRecognitionPreferences } from './speechRecognitionSettingsStorage'
import { clearLegacyQwen3TtsPreferences, loadQwen3TtsPreferences, type Qwen3TtsPreferences } from './qwen3TtsSettingsStorage'
import {
  clearLegacyTaskManagerPublicationPreferences,
  loadTaskManagerPublicationPreferences,
  type TaskManagerPublicationPreferences,
} from './taskManagerPublicationSettingsStorage'

/** Preferences of this device, stored and normalized by the backend (`device_preferences.rs`). */
export interface DevicePreferences {
  taskManagerPublication: TaskManagerPublicationPreferences
  speechRecognition: SpeechRecognitionPreferences
  qwen3Tts: Qwen3TtsPreferences
  editorPage: EditorPagePreferences
  pen: PenPreferences
  /** Derived by the backend from `editorPage`; sending it back has no effect. */
  editorPageSetup: EditorPageSetup
}

type SavedSections = Omit<DevicePreferences, 'editorPageSetup'>

/** Saves the sections sent; the others keep their stored value. */
export function saveDevicePreferences(preferences: Partial<SavedSections>): Promise<DevicePreferences> {
  return callBackend<DevicePreferences>('backend_save_device_preferences', { preferences })
}

/** Loads the preferences, moving the copy older versions kept in the WebView once. */
export async function loadDevicePreferences(): Promise<DevicePreferences> {
  const stored = await callBackend<{ initialized: boolean; preferences: DevicePreferences }>('backend_device_preferences')
  if (stored.initialized) return stored.preferences
  // The backend normalizes the stored copies (and fills the missing ones).
  const migrated = await callBackend<DevicePreferences>('backend_save_device_preferences', {
    preferences: {
      taskManagerPublication: loadTaskManagerPublicationPreferences() ?? undefined,
      speechRecognition: loadSpeechRecognitionPreferences() ?? undefined,
      qwen3Tts: loadQwen3TtsPreferences() ?? undefined,
    },
  })
  clearLegacyTaskManagerPublicationPreferences()
  clearLegacySpeechRecognitionPreferences()
  clearLegacyQwen3TtsPreferences()
  return migrated
}
