/** Parakeet is the only recognition model: it runs on CPU and detects the language; the language selects the text normalization. */
export interface SpeechRecognitionPreferences {
  enabled: boolean
  language: string
}

/** Key under which older versions kept these preferences in the WebView. */
const LEGACY_STORAGE_KEY = 'notia:qwen3-asr:v1'

export const DEFAULT_SPEECH_RECOGNITION_PREFERENCES: SpeechRecognitionPreferences = {
  enabled: true,
  language: 'es',
}

/** Copy kept by older versions in the WebView, as stored; the backend normalizes it once. */
export function loadSpeechRecognitionPreferences(): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? JSON.parse(raw) as unknown : null
  } catch {
    return null
  }
}


/** Removes the WebView copy after the backend holds the preferences. */
export function clearLegacySpeechRecognitionPreferences(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // A stale copy is ignored once the backend is initialized.
  }
}
