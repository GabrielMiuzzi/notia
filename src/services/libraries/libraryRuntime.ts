import type { NotiaFileNode, NotiaFlatFileEntry, NotiaLibrary } from '../../types/notia'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { notiaLog, notiaTimer } from '../runtime/notiaLogger'
import {
  createLibraryEntry as createFilesystemEntry,
  getPathBaseName,
  isDirectoryPath,
  pathExists,
  performLibraryEntryOperation as performFilesystemEntryOperation,
  pickDirectory,
  readLibraryDirectory as readFilesystemDirectory,
  readLibraryFlatFileList as readFilesystemFlatFileList,
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

const ANDROID_SAF_TIMEOUT_MS = 60_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

const inFlightTreeReadByRequestKey = new Map<string, Promise<NotiaFileNode[]>>()
const inFlightTreeSignatureReadByRequestKey = new Map<string, Promise<string>>()
const inFlightDirectoryReadByRequestKey = new Map<string, Promise<NotiaFileNode[]>>()

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
    console.error('[libraryRuntime] pick directory failed:', error)
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
    notiaLog('libraryRuntime', 'readLibraryTree dedup hit', {
      path: normalizedDirectoryPath,
      requestKey,
    })
    return inFlightRead
  }

  const request = (async () => {
    const timer = notiaTimer('libraryRuntime', 'readLibraryTree', {
      path: normalizedDirectoryPath,
      isAndroid: isAndroidRuntime,
    })
    const rawPromise = readFilesystemTree(normalizedDirectoryPath, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })
    const nodes = isAndroidRuntime
      ? await withTimeout(rawPromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura de la carpeta tardó demasiado. Intenta nuevamente.')
      : await rawPromise
    timer.success({ nodeCount: nodes.length })
    return nodes
  })()

  inFlightTreeReadByRequestKey.set(requestKey, request)
  return request.finally(() => {
    if (inFlightTreeReadByRequestKey.get(requestKey) === request) {
      inFlightTreeReadByRequestKey.delete(requestKey)
    }
  })
}

export async function readLibraryDirectory(
  directoryPath: string,
  options?: { androidDirectoryUri?: string },
): Promise<NotiaFileNode[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const isAndroidRuntime = getRuntimeDevice() === 'Android'
  const requestKey = isAndroidRuntime
    ? `dir:${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
    : `dir:${normalizedDirectoryPath}`

  const inFlightRead = inFlightDirectoryReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    notiaLog('libraryRuntime', 'readLibraryDirectory dedup hit', {
      path: normalizedDirectoryPath,
      requestKey,
    })
    return inFlightRead
  }

  const request = (async () => {
    const timer = notiaTimer('libraryRuntime', 'readLibraryDirectory', {
      path: normalizedDirectoryPath,
      isAndroid: isAndroidRuntime,
    })
    const rawPromise = readFilesystemDirectory(normalizedDirectoryPath, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })
    const nodes = isAndroidRuntime
      ? await withTimeout(rawPromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura del directorio tardó demasiado. Intenta nuevamente.')
      : await rawPromise
    timer.success({ nodeCount: nodes.length })
    return nodes
  })()

  inFlightDirectoryReadByRequestKey.set(requestKey, request)
  return request.finally(() => {
    if (inFlightDirectoryReadByRequestKey.get(requestKey) === request) {
      inFlightDirectoryReadByRequestKey.delete(requestKey)
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
    notiaLog('libraryRuntime', 'readLibraryTreeSignature dedup hit', {
      path: normalizedDirectoryPath,
      requestKey,
    })
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
  options?: { androidDirectoryUri?: string },
): Promise<CreateLibraryEntryResult> {
  try {
    return await performFilesystemEntryOperation(payload, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })
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

const inFlightFlatFileListReadByRequestKey = new Map<string, Promise<NotiaFlatFileEntry[]>>()

/** Read a flat (non-nested) list of ALL files and folders in the library.
 *  On Android this calls the `readFlatFileList` Kotlin plugin which does a
 *  recursive traversal but returns items without nesting. On desktop, it
 *  falls back to flattening the full tree. The result is used by search
 *  index and graph engine which need the complete file list regardless of
 *  the lazy-loaded UI tree state. */
export async function readLibraryFlatFileList(
  directoryPath: string,
  options?: { androidDirectoryUri?: string },
): Promise<NotiaFlatFileEntry[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const requestKey = `flat:${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`

  const inFlightRead = inFlightFlatFileListReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    notiaLog('libraryRuntime', 'readLibraryFlatFileList dedup hit', {
      path: normalizedDirectoryPath,
      requestKey,
    })
    return inFlightRead
  }

  const request = (async () => {
    const timer = notiaTimer('libraryRuntime', 'readLibraryFlatFileList', {
      path: normalizedDirectoryPath,
      isAndroid: getRuntimeDevice() === 'Android',
    })

    try {
      if (getRuntimeDevice() === 'Android') {
        const rawPromise = readFilesystemFlatFileList(normalizedDirectoryPath, {
          androidDirectoryUri: options?.androidDirectoryUri,
        })
        const files = await withTimeout(rawPromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura de la lista de archivos tardó demasiado. Intenta nuevamente.')
          .catch((error: unknown) => {
            console.error('[libraryRuntime] readLibraryFlatFileList failed:', error)
            return [] as NotiaFlatFileEntry[]
          })
        timer.success({ fileCount: files.length })
        return files
      }

      // Desktop fallback: flatten the full tree
      const treeNodes = await readFilesystemTree(normalizedDirectoryPath, {
        androidDirectoryUri: options?.androidDirectoryUri,
      })
      const files: NotiaFlatFileEntry[] = []
      const flatten = (nodes: NotiaFileNode[]) => {
        for (const node of nodes) {
          files.push({
            path: node.path ?? node.name,
            type: node.type,
            name: node.name,
          })
          if (node.children && node.children.length > 0) {
            flatten(node.children)
          }
        }
      }
      flatten(treeNodes)
      timer.success({ fileCount: files.length, source: 'desktop-fallback' })
      return files
    } catch (error) {
      timer.error(error)
      console.error('[libraryRuntime] readLibraryFlatFileList failed:', error)
      return [] as NotiaFlatFileEntry[]
    }
  })()

  inFlightFlatFileListReadByRequestKey.set(requestKey, request)
  return request.finally(() => {
    if (inFlightFlatFileListReadByRequestKey.get(requestKey) === request) {
      inFlightFlatFileListReadByRequestKey.delete(requestKey)
    }
  })
}
