import {
  DEFAULT_INKMATH_SETTINGS,
  clampOcrDebounceMs,
} from '../../modules/inkmath/settings'

const INKMATH_SETTINGS_STORAGE_KEY = 'notia:inkmath-settings:v1'

export interface InkMathPreferences {
  debounceMs: number
}

export const DEFAULT_INKMATH_PREFERENCES: InkMathPreferences = {
  debounceMs: clampOcrDebounceMs(DEFAULT_INKMATH_SETTINGS.ocrDebounceMs),
}

function normalizeInkMathPreferences(value: unknown): InkMathPreferences {
  if (!value || typeof value !== 'object') {
    return DEFAULT_INKMATH_PREFERENCES
  }

  const candidate = value as Partial<InkMathPreferences> & { inkmathDebounceMs?: unknown }
  return {
    debounceMs: clampOcrDebounceMs(Number(candidate.debounceMs ?? candidate.inkmathDebounceMs ?? DEFAULT_INKMATH_PREFERENCES.debounceMs)),
  }
}

export function loadInkMathPreferences(): InkMathPreferences {
  const rawValue = window.localStorage.getItem(INKMATH_SETTINGS_STORAGE_KEY)
  if (!rawValue) {
    return DEFAULT_INKMATH_PREFERENCES
  }

  try {
    return normalizeInkMathPreferences(JSON.parse(rawValue))
  } catch {
    return DEFAULT_INKMATH_PREFERENCES
  }
}

export function saveInkMathPreferences(value: InkMathPreferences): void {
  window.localStorage.setItem(INKMATH_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeInkMathPreferences(value)))
}
