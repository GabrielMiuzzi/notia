const EXPLORER_REFRESH_INTERVAL_STORAGE_KEY = 'notia:explorer-refresh-interval-ms'
const DEFAULT_EXPLORER_REFRESH_INTERVAL_MS = 1000
const MIN_EXPLORER_REFRESH_INTERVAL_MS = 1000
const MAX_EXPLORER_REFRESH_INTERVAL_MS = 30000

function normalizeRefreshIntervalMs(value: unknown): number {
  const numericValue = Number(value)
  if (!Number.isInteger(numericValue)) {
    return DEFAULT_EXPLORER_REFRESH_INTERVAL_MS
  }

  return Math.min(
    MAX_EXPLORER_REFRESH_INTERVAL_MS,
    Math.max(MIN_EXPLORER_REFRESH_INTERVAL_MS, numericValue),
  )
}

export function loadExplorerRefreshIntervalMs(): number {
  const storedValue = localStorage.getItem(EXPLORER_REFRESH_INTERVAL_STORAGE_KEY)
  return normalizeRefreshIntervalMs(storedValue)
}

export function saveExplorerRefreshIntervalMs(value: number): void {
  const normalizedValue = normalizeRefreshIntervalMs(value)
  localStorage.setItem(EXPLORER_REFRESH_INTERVAL_STORAGE_KEY, String(normalizedValue))
}

