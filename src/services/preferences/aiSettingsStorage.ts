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

// The credential is intentionally session-only in the WebView. Durable
// preferences may be portable/backed up, so they must never become a secret
// store. Native adapters receive this value only when a request is sent.
let sessionApiKey = ''

export type AiProgressMode = 'minimal' | 'standard' | 'detailed' | 'off'

export interface AiPreferences {
  ollamaUrl: string
  apiKey: string
  selectedModel: string
  thinkingEnabled: boolean
  thinkingLevel: AiThinkingLevel
  progressMode?: AiProgressMode
  showPlan?: boolean
  showReasoningSummary?: boolean
  editProgressMessage?: boolean
}

export interface NormalizedAiPreferences extends AiPreferences {
  progressMode: AiProgressMode
  showPlan: boolean
  showReasoningSummary: boolean
  editProgressMessage: boolean
}

export type AiThinkingLevel = 'low' | 'medium' | 'high'

function normalizeApiKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSelectedModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeThinkingLevel(value: unknown): AiThinkingLevel {
  return value === 'low' || value === 'high' ? value : 'medium'
}

function normalizeProgressMode(value: unknown): AiProgressMode {
  return value === 'minimal' || value === 'detailed' || value === 'off' ? value : 'standard'
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

function normalizeAiPreferences(value: unknown): NormalizedAiPreferences {
  if (!value || typeof value !== 'object') {
    return {
      ollamaUrl: DEFAULT_OLLAMA_API_URL,
      apiKey: '',
      selectedModel: '',
      thinkingEnabled: true,
      thinkingLevel: 'medium',
      progressMode: 'standard',
      showPlan: true,
      showReasoningSummary: true,
      editProgressMessage: true,
    }
  }

  const candidate = value as Partial<AiPreferences> & {
    baseUrl?: unknown
    apiKey?: unknown
    model?: unknown
    selectedModel?: unknown
    thinkingEnabled?: unknown
    thinkingLevel?: unknown
  }
  return {
    ollamaUrl: normalizeOllamaApiUrl(candidate.ollamaUrl ?? candidate.baseUrl),
    apiKey: normalizeApiKey(candidate.apiKey),
    selectedModel: normalizeSelectedModel(candidate.selectedModel ?? candidate.model),
    thinkingEnabled: candidate.thinkingEnabled !== false,
    thinkingLevel: normalizeThinkingLevel(candidate.thinkingLevel),
    progressMode: normalizeProgressMode(candidate.progressMode),
    showPlan: candidate.showPlan !== false,
    showReasoningSummary: candidate.showReasoningSummary !== false,
    editProgressMessage: candidate.editProgressMessage !== false,
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

function redactPersistedApiKey(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...(value as Record<string, unknown>), apiKey: '' }
}

function migrateRedactedPreferences(storageKey: string, value: unknown): unknown {
  const redacted = redactPersistedApiKey(value)
  try {
    if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
      window.localStorage.setItem(storageKey, JSON.stringify(redacted))
    }
  } catch {
    // The runtime can still use the redacted in-memory value if storage is unavailable.
  }
  return redacted
}

export function loadAiPreferences(): NormalizedAiPreferences {
  const storedPreferences = loadStoredValue(AI_SETTINGS_STORAGE_KEY)
  if (storedPreferences) {
    return normalizeAiPreferences(migrateRedactedPreferences(AI_SETTINGS_STORAGE_KEY, storedPreferences))
  }

  const legacyPreferences = loadStoredValue(LEGACY_NETRUNNER_SETTINGS_STORAGE_KEY)
  const redactedLegacyPreferences = migrateRedactedPreferences(LEGACY_NETRUNNER_SETTINGS_STORAGE_KEY, legacyPreferences)
  return normalizeAiPreferences(redactedLegacyPreferences)
}

export function saveAiPreferences(value: AiPreferences): void {
  const normalized = normalizeAiPreferences(value)
  sessionApiKey = normalized.apiKey
  window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify({
    ...normalized,
    apiKey: '',
  }))
}

export function normalizeAiSettingsInput(input: Partial<AiPreferences>): NormalizedAiPreferences {
  return normalizeAiPreferences(input)
}

export function getSessionAiApiKey(): string {
  return sessionApiKey
}

/** Adds the session credential only at the native transport boundary. */
export function resolveAiPreferencesForTransport(value: AiPreferences): NormalizedAiPreferences {
  const normalized = normalizeAiPreferences(value)
  return normalized.apiKey ? normalized : { ...normalized, apiKey: sessionApiKey }
}

export function getDefaultOllamaApiUrl(): string {
  return DEFAULT_OLLAMA_API_URL
}
