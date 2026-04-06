const AI_SETTINGS_STORAGE_KEY = 'notia:ai-settings:v1'
const LEGACY_NETRUNNER_SETTINGS_STORAGE_KEY = 'notia:netrunner-settings:v1'
const DEFAULT_OLLAMA_API_URL = 'https://ollama.com'
const LEGACY_NETRUNNER_DEFAULT_URL = 'http://127.0.0.1:8000'
const LEGACY_AI_DEFAULT_URLS = new Set([
  'http://127.0.0.1:9991',
  'http://127.0.0.1:9991/api',
  'http://localhost:9991',
  'http://localhost:9991/api',
])

export interface AiPreferences {
  ollamaUrl: string
  apiKey: string
  selectedModel: string
}

function normalizeApiKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSelectedModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOllamaApiUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_OLLAMA_API_URL
  }

  const raw = value.trim()
  if (!raw || raw === LEGACY_NETRUNNER_DEFAULT_URL || LEGACY_AI_DEFAULT_URLS.has(raw)) {
    return DEFAULT_OLLAMA_API_URL
  }

  try {
    const parsed = new URL(raw)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return DEFAULT_OLLAMA_API_URL
    }

    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''

    const normalized = parsed.toString().replace(/\/+$/, '')
    return LEGACY_AI_DEFAULT_URLS.has(normalized)
      ? DEFAULT_OLLAMA_API_URL
      : normalized
  } catch {
    return DEFAULT_OLLAMA_API_URL
  }
}

function normalizeAiPreferences(value: unknown): AiPreferences {
  if (!value || typeof value !== 'object') {
    return {
      ollamaUrl: DEFAULT_OLLAMA_API_URL,
      apiKey: '',
      selectedModel: '',
    }
  }

  const candidate = value as Partial<AiPreferences> & {
    baseUrl?: unknown
    apiKey?: unknown
    model?: unknown
    selectedModel?: unknown
  }
  return {
    ollamaUrl: normalizeOllamaApiUrl(candidate.ollamaUrl ?? candidate.baseUrl),
    apiKey: normalizeApiKey(candidate.apiKey),
    selectedModel: normalizeSelectedModel(candidate.selectedModel ?? candidate.model),
  }
}

function loadStoredValue(storageKey: string): unknown {
  const rawValue = window.localStorage.getItem(storageKey)
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue)
  } catch {
    return null
  }
}

export function loadAiPreferences(): AiPreferences {
  const storedPreferences = loadStoredValue(AI_SETTINGS_STORAGE_KEY)
  if (storedPreferences) {
    return normalizeAiPreferences(storedPreferences)
  }

  return normalizeAiPreferences(loadStoredValue(LEGACY_NETRUNNER_SETTINGS_STORAGE_KEY))
}

export function saveAiPreferences(value: AiPreferences): void {
  const normalized = normalizeAiPreferences(value)
  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
}

export function normalizeAiSettingsInput(input: AiPreferences): AiPreferences {
  return normalizeAiPreferences(input)
}

export function getDefaultOllamaApiUrl(): string {
  return DEFAULT_OLLAMA_API_URL
}
