import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
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

export async function startDesktopLibraryTreeWatch(directoryPath: string): Promise<boolean> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  if (!normalizedDirectoryPath.trim()) {
    return false
  }

  try {
    const result = await invoke<FilesystemOperationResult>('start_library_tree_watch', {
      payload: { directoryPath: normalizedDirectoryPath },
    })
    return Boolean(result.ok)
  } catch {
    return false
  }
}

export async function stopDesktopLibraryTreeWatch(): Promise<void> {
  try {
    await invoke<FilesystemOperationResult>('stop_library_tree_watch')
  } catch {
    // Best-effort cleanup only.
  }
}

export async function subscribeToDesktopLibraryTreeWatchBridge(): Promise<UnlistenFn> {
  return listen<DesktopLibraryTreeChangedPayload>(DESKTOP_LIBRARY_TREE_CHANGED_EVENT, (event) => {
    const watchedPath = normalizeOptionalPath(event.payload?.watchedPath)
    const changedPathHint = normalizeOptionalPath(event.payload?.changedPathHint)
    dispatchLibraryTreeChanged({
      pathHint: changedPathHint ?? watchedPath,
    })
  })
}
