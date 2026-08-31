import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { notiaLog } from './notiaLogger'

const PERFORMANCE_BASELINE_STORAGE_KEY = 'notia.perfBaseline.enabled'
const PERFORMANCE_BASELINE_MAX_ENTRIES = 400

export type NotiaPerformanceMeasurementStatus = 'success' | 'error' | 'canceled'

export interface NotiaPerformanceMeasurementEntry {
  id: number
  name: string
  device: string
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  status: NotiaPerformanceMeasurementStatus
  meta?: Record<string, unknown>
  errorMessage?: string
}

export interface NotiaPerformanceMeasurementController {
  success: (meta?: Record<string, unknown>) => void
  error: (error: unknown, meta?: Record<string, unknown>) => void
  cancel: (meta?: Record<string, unknown>) => void
}

interface NotiaPerformanceBaselineApi {
  getEntries: () => NotiaPerformanceMeasurementEntry[]
  clearEntries: () => void
  setEnabled: (enabled: boolean) => void
  isEnabled: () => boolean
}

declare global {
  interface Window {
    __NOTIA_PERF_BASELINE__?: NotiaPerformanceMeasurementEntry[]
    __NOTIA_PERF_BASELINE_API__?: NotiaPerformanceBaselineApi
  }
}

let nextMeasurementId = 1

function canUsePerformanceApi(): boolean {
  return typeof window !== 'undefined' && typeof performance !== 'undefined'
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100
}

function readBooleanStorageValue(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const storedValue = window.localStorage.getItem(key)
    if (storedValue === '1' || storedValue === 'true') {
      return true
    }
    if (storedValue === '0' || storedValue === 'false') {
      return false
    }
  } catch {
    return fallback
  }

  return fallback
}

function writeBooleanStorageValue(key: string, enabled: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, enabled ? '1' : '0')
  } catch {
    // Ignore storage failures in private browsing / restricted contexts.
  }
}

export function isPerformanceBaselineEnabled(): boolean {
  return readBooleanStorageValue(PERFORMANCE_BASELINE_STORAGE_KEY, true)
}

function getStoredEntries(): NotiaPerformanceMeasurementEntry[] {
  if (typeof window === 'undefined') {
    return []
  }

  if (!Array.isArray(window.__NOTIA_PERF_BASELINE__)) {
    window.__NOTIA_PERF_BASELINE__ = []
  }

  return window.__NOTIA_PERF_BASELINE__
}

function buildConsoleSummary(entry: NotiaPerformanceMeasurementEntry): string {
  const roundedDuration = entry.durationMs.toFixed(2)
  return `[notia:perf] ${entry.name} ${entry.status} ${roundedDuration}ms`
}

function normalizeErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  return undefined
}

function normalizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined
  }

  const entries = Object.entries(meta).filter(([, value]) => value !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function recordEntry(entry: NotiaPerformanceMeasurementEntry): void {
  if (!isPerformanceBaselineEnabled()) {
    return
  }

  const entries = getStoredEntries()
  entries.push(entry)

  if (entries.length > PERFORMANCE_BASELINE_MAX_ENTRIES) {
    entries.splice(0, entries.length - PERFORMANCE_BASELINE_MAX_ENTRIES)
  }

  if (entry.status === 'error') {
    console.error(buildConsoleSummary(entry), entry)
  }

  if (entry.status === 'error') {
    const data: Record<string, unknown> = {
      durationMs: entry.durationMs,
      status: entry.status,
      device: entry.device,
    }
    if (entry.meta) {
      Object.assign(data, entry.meta)
    }
    if (entry.errorMessage) {
      data.errorMessage = entry.errorMessage
    }
    notiaLog('perf', entry.name, data, 'error')
  }
}

function ensurePerformanceBaselineApi(): void {
  if (typeof window === 'undefined' || window.__NOTIA_PERF_BASELINE_API__) {
    return
  }

  window.__NOTIA_PERF_BASELINE_API__ = {
    getEntries: () => [...getStoredEntries()],
    clearEntries: () => {
      getStoredEntries().splice(0)
    },
    setEnabled: (enabled: boolean) => {
      writeBooleanStorageValue(PERFORMANCE_BASELINE_STORAGE_KEY, enabled)
    },
    isEnabled: () => isPerformanceBaselineEnabled(),
  }
}

function resolveRuntimeDeviceSafe(): string {
  try {
    return getRuntimeDevice()
  } catch {
    return 'Unknown'
  }
}

export function startPerformanceMeasurement(
  name: string,
  meta?: Record<string, unknown>,
): NotiaPerformanceMeasurementController {
  if (!canUsePerformanceApi()) {
    return {
      success: () => {},
      error: () => {},
      cancel: () => {},
    }
  }

  ensurePerformanceBaselineApi()

  const measurementId = nextMeasurementId
  nextMeasurementId += 1

  const startedAt = performance.now()
  let finished = false

  const finish = (
    status: NotiaPerformanceMeasurementStatus,
    nextMeta?: Record<string, unknown>,
    error?: unknown,
  ) => {
    if (finished) {
      return
    }

    finished = true
    const endedAt = performance.now()
    const startedAtMs = performance.timeOrigin + startedAt
    const endedAtMs = performance.timeOrigin + endedAt

    recordEntry({
      id: measurementId,
      name,
      device: resolveRuntimeDeviceSafe(),
      startedAtMs: roundMilliseconds(startedAtMs),
      endedAtMs: roundMilliseconds(endedAtMs),
      durationMs: roundMilliseconds(endedAt - startedAt),
      status,
      meta: normalizeMeta({
        ...meta,
        ...nextMeta,
      }),
      errorMessage: normalizeErrorMessage(error),
    })
  }

  return {
    success: (nextMeta) => finish('success', nextMeta),
    error: (error, nextMeta) => finish('error', nextMeta, error),
    cancel: (nextMeta) => finish('canceled', nextMeta),
  }
}

export async function measurePerformanceAsync<T>(
  name: string,
  task: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const measurement = startPerformanceMeasurement(name, meta)

  try {
    const result = await task()
    measurement.success()
    return result
  } catch (error) {
    measurement.error(error)
    throw error
  }
}

export function measurePerformanceSync<T>(
  name: string,
  task: () => T,
  meta?: Record<string, unknown>,
): T {
  const measurement = startPerformanceMeasurement(name, meta)

  try {
    const result = task()
    measurement.success()
    return result
  } catch (error) {
    measurement.error(error)
    throw error
  }
}

ensurePerformanceBaselineApi()
