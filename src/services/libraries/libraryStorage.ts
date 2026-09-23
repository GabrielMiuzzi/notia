import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getSafTreeDisplayName, isSafTreeUri } from '../../utils/files/safUri'

/** Keys of the catalog kept by older versions in WebView storage. */
const LEGACY_LIBRARIES_STORAGE_KEY = 'notia:libraries'
const LEGACY_ACTIVE_LIBRARY_STORAGE_KEY = 'notia:active-library-id'

export interface LibraryCatalogSnapshot {
  libraries: NotiaLibrary[]
  selectedLibraryId: string | null
}

interface BackendLibraryCatalog extends LibraryCatalogSnapshot {
  initialized: boolean
}

function isValidLibrary(value: unknown): value is NotiaLibrary {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as NotiaLibrary
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.path === 'string' &&
    (typeof candidate.androidTreeUri === 'undefined' || isSafTreeUri(candidate.androidTreeUri))
  )
}

/** Display form of a stored library (SAF trees are named after their folder). */
function toDisplayLibrary(library: NotiaLibrary): NotiaLibrary {
  const androidTreeUri = isSafTreeUri(library.androidTreeUri) ? library.androidTreeUri.trim() : undefined
  return {
    ...library,
    name: getSafTreeDisplayName(androidTreeUri) ?? library.name,
    path: normalizeFilesystemPath(library.path),
    androidTreeUri,
  }
}

function readLegacyCatalog(): LibraryCatalogSnapshot {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_LIBRARIES_STORAGE_KEY) ?? '[]')
    const libraries = Array.isArray(parsed) ? parsed.filter(isValidLibrary) : []
    return { libraries, selectedLibraryId: localStorage.getItem(LEGACY_ACTIVE_LIBRARY_STORAGE_KEY) }
  } catch {
    return { libraries: [], selectedLibraryId: null }
  }
}

function clearLegacyCatalog(): void {
  try {
    localStorage.removeItem(LEGACY_LIBRARIES_STORAGE_KEY)
    localStorage.removeItem(LEGACY_ACTIVE_LIBRARY_STORAGE_KEY)
  } catch {
    // WebView storage may be unavailable; the backend catalog is authoritative.
  }
}

function toSnapshot(catalog: LibraryCatalogSnapshot): LibraryCatalogSnapshot {
  return {
    libraries: catalog.libraries.map(toDisplayLibrary),
    selectedLibraryId: catalog.selectedLibraryId ?? null,
  }
}

/** Stores the catalog in the backend and returns what it kept. */
export async function saveLibraryCatalog(snapshot: LibraryCatalogSnapshot): Promise<LibraryCatalogSnapshot> {
  const saved = await invoke<BackendLibraryCatalog>('backend_save_library_catalog', {
    catalog: {
      libraries: snapshot.libraries.map(({ id, name, path, androidTreeUri }) => ({
        id,
        name,
        path,
        ...(androidTreeUri ? { androidTreeUri } : {}),
      })),
      selectedLibraryId: snapshot.selectedLibraryId,
    },
  })
  return toSnapshot(saved)
}

/**
 * Loads the library catalog from the backend. The first time, the catalog
 * kept by older versions in WebView storage is migrated and then removed.
 */
export async function loadLibraryCatalog(): Promise<LibraryCatalogSnapshot> {
  const catalog = await invoke<BackendLibraryCatalog>('backend_library_catalog')
  if (catalog.initialized) {
    return toSnapshot(catalog)
  }
  const migrated = await saveLibraryCatalog(readLegacyCatalog())
  clearLegacyCatalog()
  return migrated
}
