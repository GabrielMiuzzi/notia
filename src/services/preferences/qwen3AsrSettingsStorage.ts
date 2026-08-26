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

export function loadQwen3AsrPreferences(): Qwen3AsrPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return normalizeQwen3AsrPreferences(raw ? JSON.parse(raw) as Partial<Qwen3AsrPreferences> : null)
  } catch {
    return DEFAULT_QWEN3_ASR_PREFERENCES
  }
}

export function saveQwen3AsrPreferences(value: Qwen3AsrPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeQwen3AsrPreferences(value)))
}
