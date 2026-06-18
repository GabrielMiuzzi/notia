import { rebuildLibraryLinkCache, type RebuildLibraryLinkCacheParams } from './libraryLinkCacheRuntime'
import { notiaLog } from '../runtime/notiaLogger'

const REBUILD_DEBOUNCE_MS = 1500

let scheduledTimeout: ReturnType<typeof setTimeout> | null = null
let latestParams: RebuildLibraryLinkCacheParams | null = null

/**
 * Schedule a background rebuild of the library link cache.
 * Multiple calls within the debounce window are collapsed into a single rebuild
 * using the most recently provided parameters.
 */
export function scheduleLibraryLinkCacheRebuild(params: RebuildLibraryLinkCacheParams): void {
  latestParams = params

  if (scheduledTimeout !== null) {
    window.clearTimeout(scheduledTimeout)
  }

  scheduledTimeout = window.setTimeout(() => {
    scheduledTimeout = null
    const paramsToRun = latestParams
    latestParams = null
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

export function cancelScheduledLibraryLinkCacheRebuild(): void {
  if (scheduledTimeout !== null) {
    window.clearTimeout(scheduledTimeout)
    scheduledTimeout = null
    latestParams = null
  }
}
