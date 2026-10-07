import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { notiaLog } from '../runtime/notiaLogger'

export const LIBRARY_TREE_CHANGED_EVENT = 'notia:library-tree-changed'

export interface LibraryTreeChangedDetail {
  vaultPath?: string
  pathHint?: string
  source?: 'external' | 'internal'
}

function normalizeOptionalPath(pathValue: string | undefined): string | undefined {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return undefined
  }

  return normalizeFilesystemPath(pathValue)
}

const TREE_EVENT_BATCH_MS = 160
const MAX_PENDING_TREE_EVENTS = 50

let pendingDispatchTimerId: number | null = null
const pendingTreeChangeDetails: LibraryTreeChangedDetail[] = []
let lastFlushTimestamp = 0

/** `//?/` (a Windows verbatim root, as the desktop catalog keeps it), `//`, `/` or nothing (`C:/…`). */
function pathPrefix(pathValue: string): string {
  return /^(\/\/\?\/|\/\/|\/)?/.exec(pathValue)?.[0] ?? ''
}

/**
 * The folder every hint of a batch is under, written as the hints write it.
 * A prefix that changed would make the hint miss its library and the tree
 * would not refresh. SAF URIs are opaque: they are only kept when they are
 * all the same; otherwise the batch carries no hint (the active library
 * refreshes).
 */
export function resolveSharedPath(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined
  }

  const normalized = paths.map((pathValue) => normalizeFilesystemPath(pathValue))
  if (normalized.some((pathValue) => /^[a-z][a-z0-9+.-]*:\/\//i.test(pathValue))) {
    return normalized.every((pathValue) => pathValue === normalized[0]) ? normalized[0] : undefined
  }
  const prefix = pathPrefix(normalized[0])
  if (normalized.some((pathValue) => pathPrefix(pathValue) !== prefix)) {
    return undefined
  }

  const [firstPath, ...restPaths] = normalized.map((pathValue) => pathValue.slice(prefix.length))
  let sharedSegments = firstPath.split('/').filter(Boolean)

  for (const currentPath of restPaths) {
    const currentSegments = currentPath.split('/').filter(Boolean)
    let sharedLength = 0
    while (
      sharedLength < sharedSegments.length
      && sharedLength < currentSegments.length
      && sharedSegments[sharedLength] === currentSegments[sharedLength]
    ) {
      sharedLength += 1
    }
    sharedSegments = sharedSegments.slice(0, sharedLength)
    if (sharedSegments.length === 0) {
      break
    }
  }

  if (sharedSegments.length === 0) {
    return normalized.length === 1 ? normalized[0] : undefined
  }

  if (/^[a-zA-Z]:$/.test(sharedSegments[0] ?? '') && sharedSegments.length === 1) {
    return `${prefix}${sharedSegments[0]}/`
  }

  return `${prefix}${sharedSegments.join('/')}`
}

function emitLibraryTreeChanged(detail: LibraryTreeChangedDetail): void {
  window.dispatchEvent(new CustomEvent<LibraryTreeChangedDetail>(LIBRARY_TREE_CHANGED_EVENT, {
    detail: {
      vaultPath: normalizeOptionalPath(detail.vaultPath),
      pathHint: normalizeOptionalPath(detail.pathHint),
      source: detail.source,
    },
  }))
}

function flushPendingLibraryTreeChangedEvents(): void {
  if (pendingDispatchTimerId !== null) {
    window.clearTimeout(pendingDispatchTimerId)
    pendingDispatchTimerId = null
  }

  if (pendingTreeChangeDetails.length === 0) {
    return
  }

  const queuedDetails = pendingTreeChangeDetails.splice(0, pendingTreeChangeDetails.length)
  lastFlushTimestamp = performance.now()
  notiaLog('treeEvents', 'flushing events', {
    eventCount: queuedDetails.length,
  })
  const groups = new Map<string, LibraryTreeChangedDetail[]>()

  for (const detail of queuedDetails) {
    const normalizedVaultPath = normalizeOptionalPath(detail.vaultPath)
    const groupKey = normalizedVaultPath ?? '__no_vault__'
    const existingGroup = groups.get(groupKey)
    if (existingGroup) {
      existingGroup.push(detail)
    } else {
      groups.set(groupKey, [detail])
    }
  }

  for (const [groupKey, details] of groups.entries()) {
    const pathHints = details
      .map((detail) => normalizeOptionalPath(detail.pathHint))
      .filter((pathValue): pathValue is string => Boolean(pathValue))

    emitLibraryTreeChanged({
      vaultPath: groupKey === '__no_vault__' ? undefined : groupKey,
      pathHint: pathHints.length > 0 ? resolveSharedPath(pathHints) : undefined,
      source: details.every((detail) => detail.source === 'internal') ? 'internal' : 'external',
    })
  }
}

export function dispatchLibraryTreeChanged(detail: LibraryTreeChangedDetail): void {
  if (typeof window === 'undefined') {
    return
  }

  const isDesktop = getRuntimeDevice() !== 'Android'
  pendingTreeChangeDetails.push(detail)
  notiaLog('treeEvents', isDesktop ? 'event enqueued (desktop)' : 'event enqueued', {
    queueSize: pendingTreeChangeDetails.length,
    hasPathHint: Boolean(detail.pathHint?.trim()),
  })
  if (pendingTreeChangeDetails.length > MAX_PENDING_TREE_EVENTS) {
    flushPendingLibraryTreeChangedEvents()
    return
  }
  const timeSinceLastFlush = performance.now() - lastFlushTimestamp
  if (pendingDispatchTimerId !== null && timeSinceLastFlush < TREE_EVENT_BATCH_MS) {
    return
  }

  pendingDispatchTimerId = window.setTimeout(() => {
    flushPendingLibraryTreeChangedEvents()
  }, TREE_EVENT_BATCH_MS)
}
