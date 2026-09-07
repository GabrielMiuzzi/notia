import { rebuildLibraryLinkCache, type RebuildLibraryLinkCacheParams } from './libraryLinkCacheRuntime'
import { notiaLog } from '../runtime/notiaLogger'

const REBUILD_DEBOUNCE_MS = 1500

let scheduledTimeout: number | null = null
let latestParams: RebuildLibraryLinkCacheParams | null = null
let visibilityListenerAttached = false

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function detachVisibilityListener(): void {
  if (!visibilityListenerAttached || typeof document === 'undefined') return
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  visibilityListenerAttached = false
}

function scheduleVisibleRebuild(): void {
  if (scheduledTimeout !== null || latestParams === null) return
  scheduledTimeout = window.setTimeout(() => {
    scheduledTimeout = null
    if (!isDocumentVisible()) {
      attachVisibilityListener()
      return
    }

    const paramsToRun = latestParams
    latestParams = null
    detachVisibilityListener()
    if (!paramsToRun) return

    void rebuildLibraryLinkCache(paramsToRun).then((result) => {
      if (!result.ok) {
        notiaLog('libraries', 'linkCache rebuild failed', { error: result.error }, 'warn')
      } else {
        notiaLog('libraries', 'linkCache rebuilt', { libraryPath: paramsToRun.libraryPath }, 'info')
      }
    })
  }, REBUILD_DEBOUNCE_MS)
}

function handleVisibilityChange(): void {
  if (isDocumentVisible()) scheduleVisibleRebuild()
}

function attachVisibilityListener(): void {
  if (visibilityListenerAttached || typeof document === 'undefined') return
  document.addEventListener('visibilitychange', handleVisibilityChange)
  visibilityListenerAttached = true
}

/**
 * Schedule a background rebuild of the library link cache.
 * Multiple calls within the debounce window are collapsed into a single rebuild
 * using the most recently provided parameters.
 */
export function scheduleLibraryLinkCacheRebuild(params: RebuildLibraryLinkCacheParams): void {
  latestParams = params

  if (scheduledTimeout !== null) {
    window.clearTimeout(scheduledTimeout)
    scheduledTimeout = null
  }

  if (!isDocumentVisible()) {
    attachVisibilityListener()
    return
  }

  scheduleVisibleRebuild()
}

export function cancelScheduledLibraryLinkCacheRebuild(): void {
  if (scheduledTimeout !== null) {
    window.clearTimeout(scheduledTimeout)
    scheduledTimeout = null
  }
  latestParams = null
  detachVisibilityListener()
}
