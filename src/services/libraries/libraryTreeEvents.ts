import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'

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

export function dispatchLibraryTreeChanged(detail: LibraryTreeChangedDetail): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent<LibraryTreeChangedDetail>(LIBRARY_TREE_CHANGED_EVENT, {
    detail: {
      vaultPath: normalizeOptionalPath(detail.vaultPath),
      pathHint: normalizeOptionalPath(detail.pathHint),
    },
  }))
}
