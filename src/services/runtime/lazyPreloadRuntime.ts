import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

type LazyComponentFactory = () => Promise<unknown>

const preloadedModules = new Set<string>()

function whenIdle(callback: () => void, delayMs = 2000): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const runCallback = () => {
    try {
      callback()
    } catch (error) {
      console.warn('[lazyPreloadRuntime] Preload callback failed:', error)
    }
  }

  let idleId: number | null = null
  let delayId: number | null = null
  let isCancelled = false
  const scheduleIdle = () => {
    if (isCancelled) {
      return
    }

    if (typeof requestIdleCallback === 'function') {
      idleId = requestIdleCallback((deadline) => {
        idleId = null
        if (isCancelled) {
          return
        }
        // A timeout callback can have no idle budget left. Let the browser
        // paint and try again instead of parsing a large editor chunk in the
        // same frame as user interaction.
        if (deadline.timeRemaining() <= 0) {
          delayId = window.setTimeout(() => {
            delayId = null
            scheduleIdle()
          }, 100)
          return
        }
        runCallback()
      }, { timeout: delayMs })
      return
    }

    runCallback()
  }
  delayId = window.setTimeout(() => {
    delayId = null
    scheduleIdle()
  }, Math.max(0, delayMs))

  const cancel = () => {
    isCancelled = true
    if (delayId !== null) {
      window.clearTimeout(delayId)
      delayId = null
    }
    if (idleId !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(idleId)
      idleId = null
    }
    window.removeEventListener('beforeunload', cancel)
  }
  window.addEventListener('beforeunload', cancel, { once: true })
  return cancel
}

/**
 * Preload a lazy component factory after the main thread becomes idle.
 * On Android the preload is skipped by default to save memory and data.
 */
export function preloadLazyComponent(
  moduleKey: string,
  factory: LazyComponentFactory,
  options?: { forceOnAndroid?: boolean; delayMs?: number },
): () => void {
  if (preloadedModules.has(moduleKey)) {
    return () => {}
  }

  const isAndroid = getRuntimeDevice() === 'Android'
  if (isAndroid && !options?.forceOnAndroid) {
    return () => {}
  }

  return whenIdle(() => {
    if (preloadedModules.has(moduleKey)) {
      return
    }

    preloadedModules.add(moduleKey)
    void factory().catch((error) => {
      console.warn(`[lazyPreloadRuntime] Failed to preload ${moduleKey}:`, error)
    })
  }, options?.delayMs)
}

/**
 * Preload multiple lazy component factories in sequence after idle.
 * Useful to warm up the most common editors without blocking the UI.
 */
export function preloadLazyComponentSequence(
  entries: Array<{ key: string; factory: LazyComponentFactory }>,
  options?: { forceOnAndroid?: boolean; delayMs?: number; gapMs?: number },
): () => void {
  const isAndroid = getRuntimeDevice() === 'Android'
  if (isAndroid && !options?.forceOnAndroid) {
    return () => {}
  }

  const timerIds: number[] = []
  const cancelIdle = whenIdle(() => {
    const pending = entries.filter((entry) => !preloadedModules.has(entry.key))
    if (pending.length === 0) {
      return
    }

    const gapMs = options?.gapMs ?? 300
    pending.forEach((entry, index) => {
      timerIds.push(window.setTimeout(() => {
        if (preloadedModules.has(entry.key)) {
          return
        }

        preloadedModules.add(entry.key)
        void entry.factory().catch((error) => {
          console.warn(`[lazyPreloadRuntime] Failed to preload ${entry.key}:`, error)
        })
      }, index * gapMs))
    })
  }, options?.delayMs)

  return () => {
    cancelIdle()
    timerIds.forEach((timerId) => window.clearTimeout(timerId))
    timerIds.length = 0
  }
}

export function isLazyComponentPreloaded(moduleKey: string): boolean {
  return preloadedModules.has(moduleKey)
}
