import { callBackend, subscribeBackend, type Unsubscribe } from '../transport'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { dispatchLibraryTreeChanged } from './libraryTreeEvents'

interface FilesystemOperationResult {
  ok: boolean
  error?: string
}

interface DesktopLibraryTreeChangedPayload {
  watchedPath?: string
  changedPathHint?: string
}

const DESKTOP_LIBRARY_TREE_CHANGED_EVENT = 'notia-library-tree-changed'

function normalizeOptionalPath(pathValue: string | undefined): string | undefined {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return undefined
  }

  return normalizeFilesystemPath(pathValue)
}

export async function stopDesktopLibraryTreeWatch(): Promise<void> {
  try {
    await callBackend<FilesystemOperationResult>('stop_library_tree_watch')
  } catch {
    // Best-effort cleanup only.
  }
}

export async function subscribeToDesktopLibraryTreeWatchBridge(): Promise<Unsubscribe> {
  return subscribeBackend<DesktopLibraryTreeChangedPayload>(DESKTOP_LIBRARY_TREE_CHANGED_EVENT, (payload) => {
    const watchedPath = normalizeOptionalPath(payload?.watchedPath)
    const changedPathHint = normalizeOptionalPath(payload?.changedPathHint)
    dispatchLibraryTreeChanged({
      pathHint: changedPathHint ?? watchedPath,
    })
  })
}
