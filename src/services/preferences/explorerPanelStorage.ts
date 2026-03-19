import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import type { NotiaLibrary } from '../../types/notia'

const EXPLORER_REFRESH_INTERVAL_STORAGE_KEY = 'notia:explorer-refresh-interval-ms'
const EXPLORER_FOLDER_STATE_STORAGE_KEY = 'notia:explorer-folder-state'

interface ExplorerRefreshPolicy {
  defaultMs: number
  minMs: number
  maxMs: number
  allowDisabled: boolean
}

const DESKTOP_EXPLORER_REFRESH_POLICY: ExplorerRefreshPolicy = {
  defaultMs: 2000,
  minMs: 1000,
  maxMs: 30000,
  allowDisabled: false,
}

const ANDROID_EXPLORER_REFRESH_POLICY: ExplorerRefreshPolicy = {
  // On Android, full tree scans are expensive. Keep automatic polling optional.
  defaultMs: 0,
  minMs: 5000,
  maxMs: 60000,
  allowDisabled: true,
}

function resolveExplorerRefreshPolicy(): ExplorerRefreshPolicy {
  return getRuntimeDevice() === 'Android'
    ? ANDROID_EXPLORER_REFRESH_POLICY
    : DESKTOP_EXPLORER_REFRESH_POLICY
}

function normalizeRefreshIntervalMs(value: unknown): number {
  const policy = resolveExplorerRefreshPolicy()
  if (value === null || typeof value === 'undefined') {
    return policy.defaultMs
  }

  if (typeof value === 'string' && value.trim().length === 0) {
    return policy.defaultMs
  }

  const numericValue = Number(value)
  if (!Number.isInteger(numericValue)) {
    return policy.defaultMs
  }

  if (policy.allowDisabled && numericValue <= 0) {
    return 0
  }

  return Math.min(
    policy.maxMs,
    Math.max(policy.minMs, numericValue),
  )
}

interface ExplorerRefreshIntervalBounds {
  minSeconds: number
  maxSeconds: number
  allowDisabled: boolean
}

export function getExplorerRefreshIntervalBounds(): ExplorerRefreshIntervalBounds {
  const policy = resolveExplorerRefreshPolicy()

  return {
    minSeconds: Math.max(1, Math.ceil(policy.minMs / 1000)),
    maxSeconds: Math.max(1, Math.floor(policy.maxMs / 1000)),
    allowDisabled: policy.allowDisabled,
  }
}

export function loadExplorerRefreshIntervalMs(): number {
  const storedValue = localStorage.getItem(EXPLORER_REFRESH_INTERVAL_STORAGE_KEY)
  return normalizeRefreshIntervalMs(storedValue)
}

export function saveExplorerRefreshIntervalMs(value: number): void {
  const normalizedValue = normalizeRefreshIntervalMs(value)
  localStorage.setItem(EXPLORER_REFRESH_INTERVAL_STORAGE_KEY, String(normalizedValue))
}

type ExplorerFolderExpandedStateRecord = Record<string, Record<string, boolean>>

type ExplorerFolderStateLibraryRef = Pick<NotiaLibrary, 'id' | 'path' | 'androidTreeUri'>

function resolveExplorerFolderStateStorageKey(library: ExplorerFolderStateLibraryRef | null): string | null {
  if (!library) {
    return null
  }

  const androidTreeUri = library.androidTreeUri?.trim()
  if (androidTreeUri) {
    return `uri:${androidTreeUri}`
  }

  const normalizedPath = library.path.trim()
  if (normalizedPath) {
    return `path:${normalizedPath}`
  }

  const libraryId = library.id.trim()
  return libraryId ? `id:${libraryId}` : null
}

function readExplorerFolderExpandedStateRecord(): ExplorerFolderExpandedStateRecord {
  const raw = localStorage.getItem(EXPLORER_FOLDER_STATE_STORAGE_KEY)
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const normalizedRecord: ExplorerFolderExpandedStateRecord = {}
    for (const [libraryId, stateByPath] of Object.entries(parsed)) {
      if (!stateByPath || typeof stateByPath !== 'object' || Array.isArray(stateByPath)) {
        continue
      }

      const normalizedStateByPath: Record<string, boolean> = {}
      for (const [path, expanded] of Object.entries(stateByPath)) {
        if (typeof path !== 'string' || typeof expanded !== 'boolean') {
          continue
        }
        normalizedStateByPath[path] = expanded
      }

      normalizedRecord[libraryId] = normalizedStateByPath
    }

    return normalizedRecord
  } catch {
    return {}
  }
}

export function loadExplorerFolderExpandedState(
  library: ExplorerFolderStateLibraryRef | null,
): Map<string, boolean> {
  if (!library) {
    return new Map<string, boolean>()
  }

  const record = readExplorerFolderExpandedStateRecord()
  const storageKey = resolveExplorerFolderStateStorageKey(library)
  const legacyStateById = library.id ? record[library.id] : undefined
  const stateByPath = (storageKey ? record[storageKey] : undefined) ?? legacyStateById
  if (!stateByPath) {
    return new Map<string, boolean>()
  }

  return new Map<string, boolean>(Object.entries(stateByPath))
}

export function saveExplorerFolderExpandedState(
  library: ExplorerFolderStateLibraryRef | null,
  stateByPath: ReadonlyMap<string, boolean>,
): void {
  if (!library) {
    return
  }

  const storageKey = resolveExplorerFolderStateStorageKey(library)
  if (!storageKey) {
    return
  }

  const record = readExplorerFolderExpandedStateRecord()
  record[storageKey] = Object.fromEntries(stateByPath)

  const legacyLibraryId = library.id.trim()
  if (legacyLibraryId && legacyLibraryId !== storageKey) {
    delete record[legacyLibraryId]
  }

  localStorage.setItem(EXPLORER_FOLDER_STATE_STORAGE_KEY, JSON.stringify(record))
}
