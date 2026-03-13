import type { NotiaFileNode, NotiaLibrary } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import {
  createLibraryEntry as createFilesystemEntry,
  getPathBaseName,
  isDirectoryPath,
  pathExists,
  performLibraryEntryOperation as performFilesystemEntryOperation,
  pickDirectory,
  readLibraryTree as readFilesystemTree,
  readLibraryTreeSignature as readFilesystemTreeSignature,
  searchLibraryFiles as searchFilesystemFiles,
  type FilesystemOperationResult,
} from '../files/filesystemEngine'

interface PickedLibrary {
  name: string
  path: string
  androidTreeUri?: string
}

type CreateLibraryEntryResult = FilesystemOperationResult
type LibraryEntryOperationPayload = NotiaLibraryEntryOperationPayload

const inFlightTreeReadByRequestKey = new Map<string, Promise<NotiaFileNode[]>>()
const inFlightTreeSignatureReadByRequestKey = new Map<string, Promise<string>>()

function buildLibraryNameFromPath(directoryPath: string): string {
  return getPathBaseName(directoryPath)
}

function resolveParentDirectoryPath(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (separatorIndex <= 0) {
    return normalized
  }
  return normalized.slice(0, separatorIndex)
}

async function resolveLibraryDirectoryFromSelection(selectedPath: string): Promise<string | null> {
  const normalizedPath = normalizeFilesystemPath(selectedPath)
  if (await isDirectoryPath(normalizedPath)) {
    return normalizedPath
  }

  const parentDirectoryPath = resolveParentDirectoryPath(normalizedPath)
  if (!parentDirectoryPath || parentDirectoryPath === normalizedPath) {
    return null
  }

  return (await isDirectoryPath(parentDirectoryPath)) ? parentDirectoryPath : null
}

export async function pickLibraryDirectory(): Promise<PickedLibrary | null> {
  let selected: { path: string; uri?: string } | null = null
  try {
    selected = await pickDirectory('Seleccionar libreria')
  } catch (error) {
    console.error('[notia] pick directory failed', error)
    if (error instanceof Error && error.message.trim()) {
      throw new Error(error.message)
    }
    throw new Error('No se pudo abrir el selector de carpetas.')
  }

  if (!selected) {
    return null
  }

  const selectedPath = normalizeFilesystemPath(selected.path)
  const resolvedPath = getRuntimeDevice() === 'Android'
    ? selectedPath
    : await resolveLibraryDirectoryFromSelection(selectedPath)
  if (!resolvedPath) {
    throw new Error('No se pudo resolver una carpeta valida desde la seleccion.')
  }

  return {
    path: resolvedPath,
    name: buildLibraryNameFromPath(resolvedPath),
    androidTreeUri: selected.uri,
  }
}

export async function filterExistingLibraries(libraries: NotiaLibrary[]): Promise<NotiaLibrary[]> {
  if (libraries.length === 0) {
    return []
  }

  const runtimeDevice = getRuntimeDevice()
  const checks = await Promise.all(libraries.map(async (library) => {
    const normalizedPath = normalizeFilesystemPath(library.path)
    if (!normalizedPath.trim()) {
      return false
    }

    if (runtimeDevice === 'Android' && library.androidTreeUri) {
      // Android SAF paths may not be directly resolvable through regular path checks.
      return true
    }

    const exists = await pathExists(normalizedPath)
    if (!exists) {
      return false
    }

    return isDirectoryPath(normalizedPath)
  }))

  return libraries.filter((_, index) => checks[index])
}

export async function readLibraryTree(
  directoryPath: string,
  options?: { androidDirectoryUri?: string },
): Promise<NotiaFileNode[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const isAndroidRuntime = getRuntimeDevice() === 'Android'
  const requestKey = isAndroidRuntime
    ? `${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
    : normalizedDirectoryPath

  const inFlightRead = inFlightTreeReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    return inFlightRead
  }

  const request = (async () => {
    const nodes = await readFilesystemTree(normalizedDirectoryPath, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })

    if (!isAndroidRuntime && nodes.length === 0) {
      console.warn('[notia] read_library_tree returned an empty tree', {
        directoryPath: normalizedDirectoryPath,
      })
    }

    return nodes
  })()

  inFlightTreeReadByRequestKey.set(requestKey, request)
  return request.finally(() => {
    if (inFlightTreeReadByRequestKey.get(requestKey) === request) {
      inFlightTreeReadByRequestKey.delete(requestKey)
    }
  })
}

export async function readLibraryTreeSignature(
  directoryPath: string,
  options?: { androidDirectoryUri?: string },
): Promise<string> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const isAndroidRuntime = getRuntimeDevice() === 'Android'
  const requestKey = isAndroidRuntime
    ? `${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
    : normalizedDirectoryPath

  const inFlightRead = inFlightTreeSignatureReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    return inFlightRead
  }

  const request = readFilesystemTreeSignature(normalizedDirectoryPath, {
    androidDirectoryUri: options?.androidDirectoryUri,
  })

  inFlightTreeSignatureReadByRequestKey.set(requestKey, request)
  return request.finally(() => {
    if (inFlightTreeSignatureReadByRequestKey.get(requestKey) === request) {
      inFlightTreeSignatureReadByRequestKey.delete(requestKey)
    }
  })
}

export async function createLibraryEntry(
  directoryPath: string,
  name: string,
  kind: 'folder' | 'note' | 'inkdoc',
  options?: { androidDirectoryUri?: string },
): Promise<CreateLibraryEntryResult> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)

  try {
    return await createFilesystemEntry(normalizedDirectoryPath, name, kind, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })
  } catch (error) {
    console.error('[notia] create_library_entry failed', error)
    return { ok: false, error: 'Could not create entry.' }
  }
}

export async function performLibraryEntryOperation(
  payload: LibraryEntryOperationPayload,
): Promise<CreateLibraryEntryResult> {
  try {
    return await performFilesystemEntryOperation(payload)
  } catch (error) {
    console.error('[notia] library_entry_operation failed', error)
    return { ok: false, error: 'Could not perform operation.' }
  }
}

export async function searchLibraryFiles(directoryPath: string, query: string): Promise<string[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  try {
    return await searchFilesystemFiles(normalizedDirectoryPath, normalizedQuery)
  } catch (error) {
    console.error('[notia] search_library_files failed', error)
    return []
  }
}
