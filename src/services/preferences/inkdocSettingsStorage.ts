import {
  DEFAULT_INKMATH_SETTINGS,
  clampOcrDebounceMs,
  normalizeServiceUrl,
} from '../../modules/inkdoc/settings'

const INKDOC_SETTINGS_STORAGE_KEY = 'notia:inkdoc-settings:v1'

export interface InkdocPreferences {
  inkmathServiceUrl: string
  inkmathDebounceMs: number
}

export const DEFAULT_INKDOC_PREFERENCES: InkdocPreferences = {
  inkmathServiceUrl: normalizeServiceUrl(DEFAULT_INKMATH_SETTINGS.serviceUrl),
  inkmathDebounceMs: clampOcrDebounceMs(DEFAULT_INKMATH_SETTINGS.ocrDebounceMs),
}

function normalizeInkdocPreferences(value: unknown): InkdocPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_INKDOC_PREFERENCES
  }

  const candidate = value as Partial<InkdocPreferences>
  return {
    inkmathServiceUrl: normalizeServiceUrl(candidate.inkmathServiceUrl ?? DEFAULT_INKDOC_PREFERENCES.inkmathServiceUrl),
    inkmathDebounceMs: clampOcrDebounceMs(candidate.inkmathDebounceMs ?? DEFAULT_INKDOC_PREFERENCES.inkmathDebounceMs),
  }
}

export function loadInkdocPreferences(): InkdocPreferences {
  const rawValue = window.localStorage.getItem(INKDOC_SETTINGS_STORAGE_KEY)
  if (!rawValue) {
    return DEFAULT_INKDOC_PREFERENCES
  }

  try {
    return normalizeInkdocPreferences(JSON.parse(rawValue))
  } catch {
    return DEFAULT_INKDOC_PREFERENCES
  }
}

export function saveInkdocPreferences(value: InkdocPreferences): void {
  const normalized = normalizeInkdocPreferences(value)
  window.localStorage.setItem(INKDOC_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
}
