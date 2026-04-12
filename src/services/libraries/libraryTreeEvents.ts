import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

export const LIBRARY_TREE_CHANGED_EVENT = 'notia:library-tree-changed'

export interface LibraryTreeChangedDetail {
  vaultPath?: string
  pathHint?: string
}

function normalizeOptionalPath(pathValue: string | undefined): string | undefined {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return undefined
  }

  return normalizeFilesystemPath(pathValue)
}

let pendingDispatchTimerId: number | null = null
const pendingTreeChangeDetails: Array<{ vaultPath?: string; pathHint?: string }> = []

function resolveSharedPath(paths: string[]): string | undefined {
  if (paths.length === 0) {
    return undefined
  }

  const [firstPath, ...restPaths] = paths.map((pathValue) => normalizeFilesystemPath(pathValue))
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
    return paths[0]
  }

  if (/^[a-zA-Z]:$/.test(sharedSegments[0] ?? '')) {
    return `${sharedSegments[0]}/${sharedSegments.slice(1).join('/')}`.replace(/\/+$/, '')
  }

  return `/${sharedSegments.join('/')}`.replace(/\/+$/, '')
}

function emitLibraryTreeChanged(detail: LibraryTreeChangedDetail): void {
  window.dispatchEvent(new CustomEvent<LibraryTreeChangedDetail>(LIBRARY_TREE_CHANGED_EVENT, {
    detail: {
      vaultPath: normalizeOptionalPath(detail.vaultPath),
      pathHint: normalizeOptionalPath(detail.pathHint),
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
  const groups = new Map<string, Array<{ vaultPath?: string; pathHint?: string }>>()

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
    })
  }
}

export function dispatchLibraryTreeChanged(detail: LibraryTreeChangedDetail): void {
  if (typeof window === 'undefined') {
    return
  }

  if (getRuntimeDevice() !== 'Android') {
    emitLibraryTreeChanged(detail)
    return
  }

  pendingTreeChangeDetails.push(detail)
  if (pendingDispatchTimerId !== null) {
    return
  }

  pendingDispatchTimerId = window.setTimeout(() => {
    flushPendingLibraryTreeChangedEvents()
  }, 160)
}
