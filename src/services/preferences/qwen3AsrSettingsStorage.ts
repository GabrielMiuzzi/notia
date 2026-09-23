export type Qwen3AsrModel = '0.6b' | '1.7b'
export type Qwen3AsrDevice = 'cpu' | 'gpu'

export interface Qwen3AsrPreferences {
  model: Qwen3AsrModel
  device: Qwen3AsrDevice
  enabled: boolean
  language: string
}

const STORAGE_KEY = 'notia:qwen3-asr:v1'

export const DEFAULT_QWEN3_ASR_PREFERENCES: Qwen3AsrPreferences = {
  model: '0.6b',
  device: 'cpu',
  enabled: true,
  language: 'es',
}

export function normalizeQwen3AsrPreferences(value: Partial<Qwen3AsrPreferences> | null | undefined): Qwen3AsrPreferences {
  return {
    model: value?.model === '1.7b' ? '1.7b' : '0.6b',
    device: value?.device === 'gpu' ? 'gpu' : 'cpu',
    enabled: value?.enabled !== false,
    language: value?.language?.trim().toLowerCase() || 'es',
  }
}

/** Copy kept by older versions in the WebView; read once to migrate it. */
export function loadQwen3AsrPreferences(): Qwen3AsrPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeQwen3AsrPreferences(raw ? JSON.parse(raw) as Partial<Qwen3AsrPreferences> : null)
  } catch {
    return DEFAULT_QWEN3_ASR_PREFERENCES
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
