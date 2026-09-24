export interface Qwen3TtsPreferences {
  model: '0.6b' | '1.7b'
  device: 'cpu'
  enabled: boolean
  voice: string
  language: string
  speed: number
  pauseDetectionMs: number
  greeting: string
}

const STORAGE_KEY = 'notia:qwen3-tts:v1'
const LEGACY_STORAGE_KEY = 'notia:supertonic:v1'
export const QWEN3_TTS_VOICES = ['vivian', 'serena', 'uncle_fu', 'dylan', 'eric', 'ryan', 'aiden', 'ono_anna', 'sohee'] as const
export const DEFAULT_QWEN3_TTS_PREFERENCES: Qwen3TtsPreferences = {
  model: '0.6b', device: 'cpu',
  enabled: true, voice: 'serena', language: 'es', speed: 1,
  pauseDetectionMs: 1_200, greeting: 'Hola, ¿en qué puedo ayudarte?',
}

/** Copy kept by older versions in the WebView, as stored; the backend normalizes it once. */
export function loadQwen3TtsPreferences(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? JSON.parse(raw) as unknown : null
  } catch { return null }
}


/** Removes the WebView copy after the backend holds the preferences. */
export function clearLegacyQwen3TtsPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // A stale copy is ignored once the backend is initialized.
  }
}
