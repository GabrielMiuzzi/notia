const NETRUNNER_SETTINGS_STORAGE_KEY = 'notia:netrunner-settings:v1'
const DEFAULT_NETRUNNER_BASE_URL = 'http://127.0.0.1:8000'
const DEFAULT_NETRUNNER_REPO_PATH = '/home/gabriel/Desktop/repos/netrunner'

export interface NetrunnerPreferences {
  baseUrl: string
  repoPath: string
}

function normalizeNetrunnerBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_NETRUNNER_BASE_URL
  }

  const raw = value.trim()
  if (!raw) {
    return DEFAULT_NETRUNNER_BASE_URL
  }

  try {
    const parsed = new URL(raw)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return DEFAULT_NETRUNNER_BASE_URL
    }

    const normalized = `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, '')
    return normalized || DEFAULT_NETRUNNER_BASE_URL
  } catch {
    return DEFAULT_NETRUNNER_BASE_URL
  }
}

function normalizeNetrunnerRepoPath(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_NETRUNNER_REPO_PATH
  }

  const normalized = value.trim()
  return normalized || DEFAULT_NETRUNNER_REPO_PATH
}

function normalizeNetrunnerPreferences(value: unknown): NetrunnerPreferences {
  if (!value || typeof value !== 'object') {
    return {
      baseUrl: DEFAULT_NETRUNNER_BASE_URL,
      repoPath: DEFAULT_NETRUNNER_REPO_PATH,
    }
  }

  const candidate = value as Partial<NetrunnerPreferences>
  return {
    baseUrl: normalizeNetrunnerBaseUrl(candidate.baseUrl),
    repoPath: normalizeNetrunnerRepoPath(candidate.repoPath),
  }
}

export function loadNetrunnerPreferences(): NetrunnerPreferences {
  const rawValue = window.localStorage.getItem(NETRUNNER_SETTINGS_STORAGE_KEY)
  if (!rawValue) {
    return normalizeNetrunnerPreferences(null)
  }

  try {
    return normalizeNetrunnerPreferences(JSON.parse(rawValue))
  } catch {
    return normalizeNetrunnerPreferences(null)
  }
}

export function saveNetrunnerPreferences(value: NetrunnerPreferences): void {
  const normalized = normalizeNetrunnerPreferences(value)
  window.localStorage.setItem(NETRUNNER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
}

export function normalizeNetrunnerSettingsInput(input: NetrunnerPreferences): NetrunnerPreferences {
  return normalizeNetrunnerPreferences(input)
}
