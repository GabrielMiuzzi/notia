export type NotiaLogLevel = 'info' | 'warn' | 'error' | 'perf'
export const TELEGRAM_AI_DIAGNOSTIC_MODULE = 'telegram-ai'

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
  const logLine = `${tag} ${message}${dataSuffix}`

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
