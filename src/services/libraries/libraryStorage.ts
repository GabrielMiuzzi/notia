import type { NotiaLibrary } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'

const LIBRARIES_STORAGE_KEY = 'notia:libraries'
const ACTIVE_LIBRARY_STORAGE_KEY = 'notia:active-library-id'

function isValidLibrary(value: unknown): value is NotiaLibrary {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as NotiaLibrary
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    (typeof candidate.androidTreeUri === 'undefined' || typeof candidate.androidTreeUri === 'string')
  )
}

export function loadLibraries(): NotiaLibrary[] {
  const raw = localStorage.getItem(LIBRARIES_STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isValidLibrary).map((library) => ({
      ...library,
      path: normalizeFilesystemPath(library.path),
      androidTreeUri: typeof library.androidTreeUri === 'string' && library.androidTreeUri.trim()
        ? library.androidTreeUri
        : undefined,
    }))
  } catch {
    return []
  }
}

export function saveLibraries(libraries: NotiaLibrary[]) {
  localStorage.setItem(LIBRARIES_STORAGE_KEY, JSON.stringify(libraries))
}

export function loadActiveLibraryId(): string | null {
  return localStorage.getItem(ACTIVE_LIBRARY_STORAGE_KEY)
}

export function saveActiveLibraryId(libraryId: string | null) {
  if (libraryId) {
    localStorage.setItem(ACTIVE_LIBRARY_STORAGE_KEY, libraryId)
    return
  }
  localStorage.removeItem(ACTIVE_LIBRARY_STORAGE_KEY)
}
