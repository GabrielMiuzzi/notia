import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

export type NotiaLogLevel = 'info' | 'warn' | 'error' | 'perf'

const LOGCAT_STORAGE_KEY = 'notia.logcat.enabled'

function isLogcatEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const storedValue = window.localStorage.getItem(LOGCAT_STORAGE_KEY)
    if (storedValue === '0' || storedValue === 'false') {
      return false
    }
    if (storedValue === '1' || storedValue === 'true') {
      return true
    }
  } catch {
    return false
  }

  // Default: enabled on Android, disabled on desktop
  return getRuntimeDevice() === 'Android'
}

let logcatEnabledCache: boolean | null = null

function resolveLogcatEnabled(): boolean {
  if (logcatEnabledCache === null) {
    logcatEnabledCache = isLogcatEnabled()
  }
  return logcatEnabledCache
}

export function setLogcatEnabled(enabled: boolean): void {
  logcatEnabledCache = enabled
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(LOGCAT_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // Ignore storage failures.
  }
}

function formatLogTag(module: string, level: NotiaLogLevel): string {
  return level === 'perf' ? `[notia:perf:${module}]` : `[notia:${module}]`
}

function serializeData(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return ''
  }

  try {
    const entries = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    return entries.length > 0 ? ` ${entries.join(' ')}` : ''
  } catch {
    return ''
  }
}

/**
 * Log a message to the Notia logging system.
 * On Android, this also sends the log to logcat via the `notia_log` Tauri command
 * so it appears under the `notia` tag alongside Rust logs.
 */
export function notiaLog(
  module: string,
  message: string,
  data?: Record<string, unknown>,
  level: NotiaLogLevel = 'info',
): void {
  if (!resolveLogcatEnabled() && level !== 'error') {
    return
  }

  const tag = formatLogTag(module, level)
  const dataSuffix = serializeData(data)
  const logLine = `${tag} ${message}${dataSuffix}`

  switch (level) {
    case 'error':
      console.error(logLine)
      break
    case 'warn':
      console.warn(logLine)
      break
    case 'perf':
    case 'info':
    default:
      console.info(logLine)
      break
  }

  // Also send to Rust backend on Android for clean logcat tag
  if (getRuntimeDevice() === 'Android') {
    try {
      // Dynamic import to avoid bundling issues
      import('@tauri-apps/api/core').then(({ invoke }) => {
        void invoke('notia_log', {
          payload: {
            level,
            module,
            message,
            data: dataSuffix || undefined,
          },
        }).catch(() => {
          // Silently ignore if the command is not available
        })
      }).catch(() => {
        // Dynamic import failed; ignore
      })
    } catch {
      // Ignore all errors
    }
  }
}

/**
 * Start a performance timer. Returns a controller that logs the duration
 * when `success()` or `error()` is called, or when the controller is garbage collected.
 */
export interface NotiaTimerController {
  success: (meta?: Record<string, unknown>) => void
  error: (error?: unknown, meta?: Record<string, unknown>) => void
}

export function notiaTimer(
  module: string,
  label: string,
  meta?: Record<string, unknown>,
): NotiaTimerController {
  if (!resolveLogcatEnabled()) {
    return {
      success: () => {},
      error: () => {},
    }
  }

  const startedAt = performance.now()
  let finished = false

  const finish = (status: string, nextMeta?: Record<string, unknown>, error?: unknown) => {
    if (finished) {
      return
    }
    finished = true
    const endedAt = performance.now()
    const durationMs = (endedAt - startedAt).toFixed(2)
    const combinedMeta: Record<string, unknown> = { ...meta, ...nextMeta, status }
    if (error !== undefined) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      combinedMeta.errorMessage = errorMessage
    }
    notiaLog(module, `${label} duration_ms=${durationMs}`, combinedMeta, 'perf')
  }

  return {
    success: (nextMeta) => finish('success', nextMeta),
    error: (error, nextMeta) => finish('error', nextMeta, error),
  }
}