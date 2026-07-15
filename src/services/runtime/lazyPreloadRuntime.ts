import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

type LazyComponentFactory = () => Promise<unknown>

const preloadedModules = new Set<string>()

function whenIdle(callback: () => void, delayMs = 2000): void {
  if (typeof window === 'undefined') {
    return
  }

  const runCallback = () => {
    try {
      callback()
    } catch (error) {
      console.warn('[lazyPreloadRuntime] Preload callback failed:', error)
    }
  }

  if (typeof requestIdleCallback === 'function') {
    const idleId = requestIdleCallback(runCallback, { timeout: delayMs })
    window.addEventListener('beforeunload', () => cancelIdleCallback(idleId), { once: true })
    return
  }

  const timeoutId = window.setTimeout(runCallback, delayMs)
  window.addEventListener('beforeunload', () => window.clearTimeout(timeoutId), { once: true })
}

/**
 * Preload a lazy component factory after the main thread becomes idle.
 * On Android the preload is skipped by default to save memory and data.
 */
export function preloadLazyComponent(
  moduleKey: string,
  factory: LazyComponentFactory,
  options?: { forceOnAndroid?: boolean; delayMs?: number },
): void {
  if (preloadedModules.has(moduleKey)) {
    return
  }

  const isAndroid = getRuntimeDevice() === 'Android'
  if (isAndroid && !options?.forceOnAndroid) {
    return
  }

  whenIdle(() => {
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
): void {
  const isAndroid = getRuntimeDevice() === 'Android'
  if (isAndroid && !options?.forceOnAndroid) {
    return
  }

  whenIdle(() => {
    const pending = entries.filter((entry) => !preloadedModules.has(entry.key))
    if (pending.length === 0) {
      return
    }

    const gapMs = options?.gapMs ?? 300
    pending.forEach((entry, index) => {
      window.setTimeout(() => {
        if (preloadedModules.has(entry.key)) {
          return
        }

        preloadedModules.add(entry.key)
        void entry.factory().catch((error) => {
          console.warn(`[lazyPreloadRuntime] Failed to preload ${entry.key}:`, error)
        })
      }, index * gapMs)
    })
  }, options?.delayMs)
}

export function isLazyComponentPreloaded(moduleKey: string): boolean {
  return preloadedModules.has(moduleKey)
}
