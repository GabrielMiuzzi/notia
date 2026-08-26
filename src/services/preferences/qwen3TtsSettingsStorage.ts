export interface Qwen3TtsPreferences {
  model: '0.6b' | '1.7b'
  device: 'cpu' | 'gpu'
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

export function normalizeQwen3TtsPreferences(value: Partial<Qwen3TtsPreferences> | null | undefined): Qwen3TtsPreferences {
  const speed = Number(value?.speed)
  const pauseDetectionMs = Number(value?.pauseDetectionMs)
  return {
    model: value?.model === '1.7b' ? '1.7b' : '0.6b',
    device: value?.device === 'gpu' ? 'gpu' : 'cpu',
    enabled: value?.enabled === true,
    voice: QWEN3_TTS_VOICES.includes(value?.voice?.trim().toLowerCase() as typeof QWEN3_TTS_VOICES[number])
      ? value?.voice?.trim().toLowerCase() as typeof QWEN3_TTS_VOICES[number]
      : DEFAULT_QWEN3_TTS_PREFERENCES.voice,
    language: value?.language?.trim().toLowerCase() || 'es',
    speed: Number.isFinite(speed) ? Math.min(1.8, Math.max(0.7, speed)) : 1,
    pauseDetectionMs: Number.isFinite(pauseDetectionMs) ? Math.min(4_000, Math.max(600, Math.round(pauseDetectionMs))) : 1_200,
    greeting: value?.greeting?.trim() || DEFAULT_QWEN3_TTS_PREFERENCES.greeting,
  }
}

export function loadQwen3TtsPreferences(): Qwen3TtsPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    return normalizeQwen3TtsPreferences(raw ? JSON.parse(raw) as Partial<Qwen3TtsPreferences> : null)
  } catch { return DEFAULT_QWEN3_TTS_PREFERENCES }
}

export function saveQwen3TtsPreferences(value: Qwen3TtsPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeQwen3TtsPreferences(value)))
}
