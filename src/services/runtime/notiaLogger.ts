export type NotiaLogLevel = 'info' | 'warn' | 'error' | 'perf'
export const TELEGRAM_AI_DIAGNOSTIC_MODULE = 'telegram-ai'

const SENSITIVE_KEY_PATTERN = /(?:api.?key|access.?token|auth(?:orization)?|password|passwd|secret|cookie|private.?key|prompt|content|rawsource|base64|query)/i
const SECRET_PATTERN = /(?:api.?key|access.?token|password|passwd|secret|cookie|authorization)\s*[:=]\s*[^\s,;}]+|bearer\s+[a-z0-9._~+/=-]{8,}|\b(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{12,}|akia[a-z0-9]{12,})\b|-----begin\s+(?:rsa|openssh|ec|private)\s+key-----/gi
const JWT_PATTERN = /\bey[a-z0-9_-]{10,}\.[a-z0-9._-]{3,}\.[a-z0-9._-]{3,}\b/gi
const PRIVATE_PATH_PATTERN = /(?:[a-z]:[\\/]|\\\\|\/(?:users|home|private|appdata|documents)(?:\/|$))[^\s,;)}\]]+/gi
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi

export function redactDiagnosticText(value: string): string {
  return value
    .replace(SECRET_PATTERN, '[secret-redacted]')
    .replace(JWT_PATTERN, '[token-redacted]')
    .replace(PRIVATE_PATH_PATTERN, '[private-path-redacted]')
    .replace(EMAIL_PATTERN, '[email-redacted]')
    .slice(0, 1_000)
}

function sanitizeDiagnosticValue(value: unknown, key: string, depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]'
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (depth >= 3) return '[nested-data-redacted]'
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeDiagnosticValue(item, key, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([childKey, childValue]) => [
      childKey,
      sanitizeDiagnosticValue(childValue, childKey, depth + 1),
    ]))
  }
  return '[value-redacted]'
}

export function redactDiagnosticData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    sanitizeDiagnosticValue(value, key),
  ]))
}

function formatLogTag(module: string, level: NotiaLogLevel): string {
  return level === 'perf' ? `[notia:perf:${module}]` : `[notia:${module}]`
}

function serializeData(data: Record<string, unknown> | undefined): string {
  if (!data) {
    return ''
  }

  try {
    const entries = Object.entries(redactDiagnosticData(data))
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const sanitized = value
        return `${key}=${typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized)}`
      })
    return entries.length > 0 ? ` ${entries.join(' ')}` : ''
  } catch {
    return ''
  }
}

/**
 * Logs actionable errors plus the narrowly-scoped Telegram AI diagnostic trace.
 * Normal activity and performance measurements stay silent.
 */
export function notiaLog(
  module: string,
  message: string,
  data?: Record<string, unknown>,
  level: NotiaLogLevel = 'info',
): void {
  const isTelegramAiDiagnostic = module === TELEGRAM_AI_DIAGNOSTIC_MODULE && level === 'info'
  if (level !== 'error' && !isTelegramAiDiagnostic) {
    return
  }

  const tag = formatLogTag(module, level)
  const dataSuffix = serializeData(data)
  const safeMessage = redactDiagnosticText(message)
  const logLine = `${tag} ${safeMessage}${dataSuffix}`

  if (level === 'error') {
    console.error(logLine)
  } else {
    console.info(logLine)
  }

  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        void invoke('notia_log', {
          payload: {
            level,
            module,
            message: safeMessage,
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
    notiaLog(module, `${label} duration_ms=${durationMs}`, combinedMeta, error === undefined ? 'perf' : 'error')
  }

  return {
    success: (nextMeta) => finish('success', nextMeta),
    error: (error, nextMeta) => finish('error', nextMeta, error),
  }
}
