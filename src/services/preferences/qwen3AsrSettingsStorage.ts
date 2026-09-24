/** Parakeet runs on CPU and detects the language; the device and language apply to Qwen3-ASR. */
export type Qwen3AsrModel = 'parakeet-v3' | '0.6b' | '1.7b'
export type Qwen3AsrDevice = 'cpu' | 'gpu'

export interface Qwen3AsrPreferences {
  model: Qwen3AsrModel
  device: Qwen3AsrDevice
  enabled: boolean
  language: string
}

const STORAGE_KEY = 'notia:qwen3-asr:v1'

export const DEFAULT_QWEN3_ASR_PREFERENCES: Qwen3AsrPreferences = {
  model: 'parakeet-v3',
  device: 'cpu',
  enabled: true,
  language: 'es',
}

/** Copy kept by older versions in the WebView, as stored; the backend normalizes it once. */
export function loadQwen3AsrPreferences(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as unknown : null
  } catch {
    return null
  }
}


/** Removes the WebView copy after the backend holds the preferences. */
export function clearLegacyQwen3AsrPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A stale copy is ignored once the backend is initialized.
  }
}
