import type { NotiaFileNode, NotiaFlatFileEntry, NotiaLibrary } from '../../types/notia'
import { invoke } from '@tauri-apps/api/core'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { join } from '../../utils/files/pathUtils'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'
import { notiaLog, notiaTimer } from '../runtime/notiaLogger'
import { startPerformanceMeasurement } from '../runtime/performanceBaseline'
import {
  createLibraryEntry as createFilesystemEntry,
  getPathBaseName,
  isDirectoryPath,
  pathExists,
  performBackendLibraryEntryOperation,
  performLibraryEntryOperation as performFilesystemEntryOperation,
  pickDirectory,
  readLibraryDirectory as readFilesystemDirectory,
  readLibraryFlatFileList as readFilesystemFlatFileList,
  readLibraryTree as readFilesystemTree,
  readLibraryTreeSignature as readFilesystemTreeSignature,
  searchLibraryFiles as searchFilesystemFiles,
  type BackendLibraryEntryPayload,
  type FilesystemCreateEntryKind,
  type FilesystemEntryOperationMode,
  type FilesystemOperationResult,
} from '../files/filesystemEngine'
import { buildRelativeLibraryPath } from './libraryPathMapping'
import { writeTextFile } from '../files/filesystemEngine'
import { DEFAULT_CONTEXT_TAG } from '../contexts/libraryContexts'
import {
  isPathAffectedByInvalidation,
  type LibraryInventoryInvalidation,
  type LibraryInventoryReadScope,
} from './libraryInventoryContract'
import { advanceLibraryInventoryGeneration } from './libraryInventoryRuntime'
import { getSafTreeDisplayName, isSafTreeUri } from '../../utils/files/safUri'

interface PickedLibrary {
  name: string
  path: string
  androidTreeUri?: string
}

type CreateLibraryEntryResult = FilesystemOperationResult
type LibraryEntryOperationPayload = NotiaLibraryEntryOperationPayload

const ANDROID_SAF_TIMEOUT_MS = 60_000
const LIBRARY_READ_CACHE_TTL_MS = 3_000
const LIBRARY_READ_CACHE_LIMIT = 64

interface LibraryReadOptions {
  androidDirectoryUri?: string
  signal?: AbortSignal
}

interface CachedLibraryRead<T> {
  libraryPath: string
  directoryPath: string
  value: T
  revision: number
  scope: LibraryInventoryReadScope
  expiresAt: number
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const abort = () => finish(() => reject(new DOMException('La lectura fue cancelada.', 'AbortError')))
    const timer = setTimeout(() => finish(() => reject(new Error(message))), ms)
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('La lectura fue cancelada.', 'AbortError'))

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new DOMException('La lectura fue cancelada.', 'AbortError'))
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

const inFlightTreeReadByRequestKey = new Map<string, Promise<NotiaFileNode[]>>()
const inFlightTreeSignatureReadByRequestKey = new Map<string, Promise<string>>()
const inFlightDirectoryReadByRequestKey = new Map<string, Promise<NotiaFileNode[]>>()
const inFlightFlatFileListReadByRequestKey = new Map<string, Promise<NotiaFlatFileEntry[]>>()
const completedTreeReadCache = new Map<string, CachedLibraryRead<NotiaFileNode[]>>()
const completedDirectoryReadCache = new Map<string, CachedLibraryRead<NotiaFileNode[]>>()
const completedTreeSignatureCache = new Map<string, CachedLibraryRead<string>>()
const completedFlatFileListCache = new Map<string, CachedLibraryRead<NotiaFlatFileEntry[]>>()
const invalidationStateByLibraryPath = new Map<string, {
  revision: number
  invalidations: Array<{ revision: number; invalidation: LibraryInventoryInvalidation }>
}>()
const knownLibraryPaths = new Set<string>()
const inFlightReadMetadata = new Map<string, {
  requestKey: string
  libraryPath: string
  directoryPath: string
  scope: LibraryInventoryReadScope
  revision: number
}>()

function readMetadataKey(scope: string, requestKey: string): string {
  return `${scope}:${requestKey}`
}

function countTreeMetrics(nodes: NotiaFileNode[]): { nodeCount: number; metadataBytes: number } {
  let nodeCount = 0
  let metadataBytes = 0
  const visit = (currentNodes: NotiaFileNode[]) => {
    for (const node of currentNodes) {
      nodeCount += 1
      // Aggregate size only: never retain or emit names, paths or content.
      metadataBytes += node.name.length + (node.path?.length ?? 0) + 32
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return { nodeCount, metadataBytes }
}

function countFlatMetrics(files: NotiaFlatFileEntry[]): { entryCount: number; metadataBytes: number } {
  return files.reduce((metrics, file) => ({
    entryCount: metrics.entryCount + 1,
    metadataBytes: metrics.metadataBytes + file.name.length + file.path.length + 24,
  }), { entryCount: 0, metadataBytes: 0 })
}

function getLibraryReadContext(directoryPath: string): { libraryPath: string; revision: number } {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const libraryPath = [...knownLibraryPaths]
    .filter((candidate) => isSameOrNestedPath(candidate, normalizedDirectoryPath))
    .sort((left, right) => right.length - left.length)[0] ?? normalizedDirectoryPath
  knownLibraryPaths.add(libraryPath)
  const state = invalidationStateByLibraryPath.get(libraryPath) ?? { revision: 0, invalidations: [] }
  invalidationStateByLibraryPath.set(libraryPath, state)
  return { libraryPath, revision: state.revision }
}

function throwIfReadCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('La lectura fue cancelada.', 'AbortError')
  }
}

function getCachedRead<T>(
  cache: Map<string, CachedLibraryRead<T>>,
  cacheKey: string,
  scope: LibraryInventoryReadScope,
): T | undefined {
  const cached = cache.get(cacheKey)
  const state = invalidationStateByLibraryPath.get(cached?.libraryPath ?? '')
  const isInvalidated = cached && state
    ? state.invalidations.some((entry) => entry.revision > cached.revision
      && isPathAffectedByInvalidation(cached.directoryPath, entry.invalidation, scope))
    : false
  if (!cached || cached.expiresAt <= Date.now() || isInvalidated) {
    if (cached) cache.delete(cacheKey)
    return undefined
  }
  cache.delete(cacheKey)
  cache.set(cacheKey, cached)
  return cached.value
}

function setCachedRead<T>(
  cache: Map<string, CachedLibraryRead<T>>,
  cacheKey: string,
  libraryPath: string,
  directoryPath: string,
  revision: number,
  scope: LibraryInventoryReadScope,
  value: T,
): void {
  cache.delete(cacheKey)
  cache.set(cacheKey, {
    libraryPath,
    directoryPath,
    value,
    revision,
    scope,
    expiresAt: Date.now() + LIBRARY_READ_CACHE_TTL_MS,
  })
  while (cache.size > LIBRARY_READ_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) break
    cache.delete(oldestKey)
  }
}

function isSameOrNestedPath(basePath: string, candidatePath: string): boolean {
  const normalizedBase = normalizeFilesystemPath(basePath)
  const normalizedCandidate = normalizeFilesystemPath(candidatePath)
  return normalizedBase === normalizedCandidate || normalizedCandidate.startsWith(`${normalizedBase}/`)
}

export function invalidateLibraryRuntimeCache(libraryPath: string, pathHint?: string): void {
  const normalizedLibraryPath = normalizeFilesystemPath(libraryPath)
  knownLibraryPaths.add(normalizedLibraryPath)
  const state = invalidationStateByLibraryPath.get(normalizedLibraryPath) ?? { revision: 0, invalidations: [] }
  const normalizedHint = pathHint?.trim() ? normalizeFilesystemPath(pathHint) : normalizedLibraryPath
  const invalidation: LibraryInventoryInvalidation = pathHint?.trim()
    ? { kind: 'subtree', pathHint: normalizedHint, reason: 'mutation' }
    : { kind: 'generation', reason: 'unknown-path' }
  state.revision += 1
  advanceLibraryInventoryGeneration(normalizedLibraryPath)
  state.invalidations.push({ revision: state.revision, invalidation })
  // Keep a bounded history: entries older than the oldest live cache can no
  // longer be queried, while recent entries remain safe to validate.
  if (state.invalidations.length > LIBRARY_READ_CACHE_LIMIT * 2) {
    state.invalidations.splice(0, state.invalidations.length - LIBRARY_READ_CACHE_LIMIT)
  }
  invalidationStateByLibraryPath.set(normalizedLibraryPath, state)

  const shouldInvalidate = (entry: CachedLibraryRead<unknown>) => (
    entry.libraryPath === normalizedLibraryPath
      && isPathAffectedByInvalidation(entry.directoryPath, invalidation, entry.scope)
  )
  for (const cache of [completedTreeReadCache, completedDirectoryReadCache, completedTreeSignatureCache, completedFlatFileListCache]) {
    for (const [key, entry] of cache) {
      if (shouldInvalidate(entry)) cache.delete(key)
    }
  }
  for (const [key, metadata] of inFlightReadMetadata) {
    if (metadata.libraryPath === normalizedLibraryPath
      && isPathAffectedByInvalidation(metadata.directoryPath, invalidation, metadata.scope)) {
      inFlightTreeReadByRequestKey.delete(metadata.requestKey)
      inFlightDirectoryReadByRequestKey.delete(metadata.requestKey)
      inFlightTreeSignatureReadByRequestKey.delete(metadata.requestKey)
      inFlightFlatFileListReadByRequestKey.delete(metadata.requestKey)
      inFlightReadMetadata.delete(key)
    }
  }
}

function buildLibraryNameFromPath(directoryPath: string): string {
  return getSafTreeDisplayName(directoryPath) ?? getPathBaseName(directoryPath)
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

export async function pickLibraryDirectory(libraryId?: string): Promise<PickedLibrary | null> {
  let selected: { path: string; uri?: string } | null = null
  const runtimeDevice = getRuntimeDevice()
  try {
    const pickerPromise = pickDirectory('Seleccionar libreria', libraryId)
    selected = runtimeDevice === 'Android'
      ? await withTimeout(
        pickerPromise,
        ANDROID_SAF_TIMEOUT_MS,
        'El selector de carpetas tardó demasiado. Intenta nuevamente.',
      )
      : await pickerPromise
  } catch (error) {
    notiaLog('libraryRuntime', 'pick directory failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'error')
    if (error instanceof Error && error.message.trim()) {
      throw new Error(error.message)
    }
    throw new Error('No se pudo abrir el selector de carpetas.')
  }

  if (!selected) {
    return null
  }

  if (runtimeDevice === 'Android') {
    const selectedPath = selected.path.trim()
    const androidTreeUri = selected.uri?.trim()
    if (!isSafTreeUri(androidTreeUri) || selectedPath !== androidTreeUri) {
      throw new Error('El selector Android no devolvio una URI SAF valida.')
    }

    return {
      path: androidTreeUri,
      name: buildLibraryNameFromPath(androidTreeUri),
      androidTreeUri,
    }
  }

  const selectedPath = normalizeFilesystemPath(selected.path)
  const resolvedPath = await resolveLibraryDirectoryFromSelection(selectedPath)
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

    if (runtimeDevice === 'Android' && library.androidTreeUri && isSafTreeUri(library.androidTreeUri)) {
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
  options?: LibraryReadOptions,
): Promise<NotiaFileNode[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const isAndroidRuntime = getRuntimeDevice() === 'Android'
  const requestKey = isAndroidRuntime
    ? `${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
    : normalizedDirectoryPath
  throwIfReadCanceled(options?.signal)
  const readContext = getLibraryReadContext(normalizedDirectoryPath)
  const cachedRead = getCachedRead(completedTreeReadCache, requestKey, 'tree')
  if (cachedRead) return cachedRead

  const inFlightRead = inFlightTreeReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    notiaLog('libraryRuntime', 'readLibraryTree dedup hit')
    return withAbort(inFlightRead, options?.signal)
  }

  const request = (async () => {
    const measurement = startPerformanceMeasurement('filesystem.read_tree', {
      operation: 'read-tree',
      isAndroid: isAndroidRuntime,
    })
    const timer = notiaTimer('libraryRuntime', 'readLibraryTree', {
      isAndroid: isAndroidRuntime,
    })
    try {
      const rawPromise = readFilesystemTree(normalizedDirectoryPath, {
        androidDirectoryUri: options?.androidDirectoryUri,
      })
      const nodes = isAndroidRuntime
        ? await withTimeout(rawPromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura de la carpeta tardó demasiado. Intenta nuevamente.')
        : await rawPromise
      const state = invalidationStateByLibraryPath.get(readContext.libraryPath)
      const isObsolete = state?.invalidations.some((entry) => entry.revision > readContext.revision
        && isPathAffectedByInvalidation(normalizedDirectoryPath, entry.invalidation, 'tree'))
      if (isObsolete) {
        throw new DOMException('La lectura quedó obsoleta.', 'AbortError')
      }
      const metrics = countTreeMetrics(nodes)
      setCachedRead(completedTreeReadCache, requestKey, readContext.libraryPath, normalizedDirectoryPath, readContext.revision, 'tree', nodes)
      timer.success({ nodeCount: metrics.nodeCount })
      measurement.success(metrics)
      return nodes
    } catch (error) {
      timer.error(error)
      measurement.error(error)
      throw error
    }
  })()

  inFlightTreeReadByRequestKey.set(requestKey, request)
  inFlightReadMetadata.set(readMetadataKey('tree', requestKey), {
    requestKey,
    libraryPath: readContext.libraryPath,
    directoryPath: normalizedDirectoryPath,
    scope: 'tree',
    revision: readContext.revision,
  })
  return withAbort(request.finally(() => {
    if (inFlightTreeReadByRequestKey.get(requestKey) === request) {
      inFlightTreeReadByRequestKey.delete(requestKey)
    }
    inFlightReadMetadata.delete(readMetadataKey('tree', requestKey))
  }), options?.signal)
}

export async function registerLibraryBinding(library: NotiaLibrary): Promise<void> {
  await invoke('register_library_binding', {
    payload: {
      libraryId: library.id,
      libraryPath: library.path,
      ...(library.androidTreeUri ? { androidTreeUri: library.androidTreeUri } : {}),
    },
  })
}

export async function revokeLibraryBinding(libraryId: string): Promise<void> {
  await invoke('revoke_library_binding', { libraryId })
}

export async function readLibraryDirectory(
  directoryPath: string,
  options?: LibraryReadOptions,
): Promise<NotiaFileNode[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const isAndroidRuntime = getRuntimeDevice() === 'Android'
  const requestKey = isAndroidRuntime
    ? `dir:${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
    : `dir:${normalizedDirectoryPath}`
  throwIfReadCanceled(options?.signal)
  const readContext = getLibraryReadContext(normalizedDirectoryPath)
  const cachedRead = getCachedRead(completedDirectoryReadCache, requestKey, 'directory')
  if (cachedRead) return cachedRead

  const inFlightRead = inFlightDirectoryReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    notiaLog('libraryRuntime', 'readLibraryDirectory dedup hit')
    return withAbort(inFlightRead, options?.signal)
  }

  const request = (async () => {
    const measurement = startPerformanceMeasurement('filesystem.read_directory', {
      operation: 'read-directory',
      isAndroid: isAndroidRuntime,
    })
    const timer = notiaTimer('libraryRuntime', 'readLibraryDirectory', {
      isAndroid: isAndroidRuntime,
    })
    try {
      const rawPromise = readFilesystemDirectory(normalizedDirectoryPath, {
        androidDirectoryUri: options?.androidDirectoryUri,
      })
      const nodes = isAndroidRuntime
        ? await withTimeout(rawPromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura del directorio tardó demasiado. Intenta nuevamente.')
        : await rawPromise
      const state = invalidationStateByLibraryPath.get(readContext.libraryPath)
      const isObsolete = state?.invalidations.some((entry) => entry.revision > readContext.revision
        && isPathAffectedByInvalidation(normalizedDirectoryPath, entry.invalidation, 'directory'))
      if (isObsolete) {
        throw new DOMException('La lectura quedó obsoleta.', 'AbortError')
      }
      const metrics = countTreeMetrics(nodes)
      setCachedRead(completedDirectoryReadCache, requestKey, readContext.libraryPath, normalizedDirectoryPath, readContext.revision, 'directory', nodes)
      timer.success({ nodeCount: metrics.nodeCount })
      measurement.success(metrics)
      return nodes
    } catch (error) {
      timer.error(error)
      measurement.error(error)
      throw error
    }
  })()

  inFlightDirectoryReadByRequestKey.set(requestKey, request)
  inFlightReadMetadata.set(readMetadataKey('directory', requestKey), {
    requestKey,
    libraryPath: readContext.libraryPath,
    directoryPath: normalizedDirectoryPath,
    scope: 'directory',
    revision: readContext.revision,
  })
  return withAbort(request.finally(() => {
    if (inFlightDirectoryReadByRequestKey.get(requestKey) === request) {
      inFlightDirectoryReadByRequestKey.delete(requestKey)
    }
    inFlightReadMetadata.delete(readMetadataKey('directory', requestKey))
  }), options?.signal)
}

export async function readLibraryTreeSignature(
  directoryPath: string,
  options?: { androidDirectoryUri?: string; signal?: AbortSignal },
): Promise<string> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const isAndroidRuntime = getRuntimeDevice() === 'Android'
  const requestKey = isAndroidRuntime
    ? `${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
    : normalizedDirectoryPath
  throwIfReadCanceled(options?.signal)
  const readContext = getLibraryReadContext(normalizedDirectoryPath)
  const cachedSignature = getCachedRead(completedTreeSignatureCache, requestKey, 'tree')
  if (cachedSignature) return cachedSignature

  const inFlightRead = inFlightTreeSignatureReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    notiaLog('libraryRuntime', 'readLibraryTreeSignature dedup hit')
    return withAbort(inFlightRead, options?.signal)
  }

  const request = (async () => {
    const measurement = startPerformanceMeasurement('filesystem.read_signature', {
      operation: 'read-signature',
      isAndroid: isAndroidRuntime,
    })
    try {
      const signaturePromise = readFilesystemTreeSignature(normalizedDirectoryPath, {
        androidDirectoryUri: options?.androidDirectoryUri,
      })
      const signature = isAndroidRuntime
        ? await withTimeout(signaturePromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura de la firma tardó demasiado.')
        : await signaturePromise
      const state = invalidationStateByLibraryPath.get(readContext.libraryPath)
      const isObsolete = state?.invalidations.some((entry) => entry.revision > readContext.revision
        && isPathAffectedByInvalidation(normalizedDirectoryPath, entry.invalidation, 'tree'))
      if (isObsolete) {
        throw new DOMException('La firma quedó obsoleta.', 'AbortError')
      }
      setCachedRead(completedTreeSignatureCache, requestKey, readContext.libraryPath, normalizedDirectoryPath, readContext.revision, 'tree', signature)
      measurement.success()
      return signature
    } catch (error) {
      measurement.error(error)
      throw error
    }
  })()

  inFlightTreeSignatureReadByRequestKey.set(requestKey, request)
  inFlightReadMetadata.set(readMetadataKey('signature', requestKey), {
    requestKey,
    libraryPath: readContext.libraryPath,
    directoryPath: normalizedDirectoryPath,
    scope: 'tree',
    revision: readContext.revision,
  })
  return withAbort(request.finally(() => {
    if (inFlightTreeSignatureReadByRequestKey.get(requestKey) === request) {
      inFlightTreeSignatureReadByRequestKey.delete(requestKey)
    }
    inFlightReadMetadata.delete(readMetadataKey('signature', requestKey))
  }), options?.signal)
}

export async function createLibraryEntry(
  directoryPath: string,
  name: string,
  kind: 'folder' | 'note' | 'mermaid',
  options?: { androidDirectoryUri?: string },
): Promise<CreateLibraryEntryResult> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const measurement = startPerformanceMeasurement('filesystem.create_entry', {
    operation: 'create-entry',
    isAndroid: getRuntimeDevice() === 'Android',
  })

  try {
    const result = await createFilesystemEntry(normalizedDirectoryPath, name, kind, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })
    if (!result.ok || kind !== 'note') {
      if (result.ok) {
        measurement.success()
      } else {
        measurement.error(result.error ?? 'create-failed')
      }
      return result
    }

    const normalizedFileName = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
    const writeResult = await writeTextFile(
      join(normalizedDirectoryPath, normalizedFileName),
      `---\ncontexto: "${DEFAULT_CONTEXT_TAG}"\n---\n`,
      { androidDirectoryUri: options?.androidDirectoryUri },
    )
    const finalResult = writeResult.ok ? result : writeResult
    if (finalResult.ok) {
      measurement.success()
    } else {
      measurement.error(finalResult.error ?? 'create-failed')
    }
    return finalResult
  } catch (error) {
    measurement.error(error)
    console.error('[notia] create_library_entry failed', error)
    return { ok: false, error: 'Could not create entry.' }
  }
}

export async function performLibraryEntryOperation(
  payload: LibraryEntryOperationPayload,
  options?: { androidDirectoryUri?: string },
): Promise<CreateLibraryEntryResult> {
  const measurement = startPerformanceMeasurement('filesystem.mutate_entry', {
    operation: 'mutate-entry',
  })
  try {
    const result = await performFilesystemEntryOperation(payload, {
      androidDirectoryUri: options?.androidDirectoryUri,
    })
    if (result.ok) {
      measurement.success()
    } else {
      measurement.error(result.error ?? 'mutation-failed')
    }
    return result
  } catch (error) {
    measurement.error(error)
    console.error('[notia] library_entry_operation failed', error)
    return { ok: false, error: 'Could not perform operation.' }
  }
}

/** Explorer entry mutation expressed with the paths the UI shows. */
export type LibraryEntryMutation =
  | { action: 'create'; parentPath: string; name: string; kind: FilesystemCreateEntryKind }
  | { action: 'delete'; targetPath: string }
  | { action: 'rename'; targetPath: string; newName: string }
  | { action: 'paste'; sourcePath: string; targetDirectoryPath: string; mode: FilesystemEntryOperationMode }

/**
 * Sends an entry mutation to the backend by library identity. Visible paths
 * are only translated to logical paths; the backend validates them, resolves
 * the physical location from the registered binding and performs the change
 * (including the initial frontmatter of new notes).
 */
export async function mutateLibraryEntry(
  library: Pick<NotiaLibrary, 'id' | 'path'>,
  mutation: LibraryEntryMutation,
): Promise<CreateLibraryEntryResult> {
  const toLogical = (pathValue: string) => buildRelativeLibraryPath(library.path, pathValue)
  const outside = { ok: false, error: 'La ruta está fuera de la biblioteca activa.' }
  const measurement = startPerformanceMeasurement('filesystem.mutate_entry', {
    operation: `entry-${mutation.action}`,
  })
  let payload: BackendLibraryEntryPayload
  switch (mutation.action) {
    case 'create': {
      const logicalPath = toLogical(mutation.parentPath)
      if (logicalPath === null) return outside
      payload = { libraryId: library.id, action: 'create', logicalPath, name: mutation.name, kind: mutation.kind }
      break
    }
    case 'delete':
    case 'rename': {
      const logicalPath = toLogical(mutation.targetPath)
      if (!logicalPath) return outside
      payload = {
        libraryId: library.id,
        action: mutation.action,
        logicalPath,
        ...(mutation.action === 'rename' ? { name: mutation.newName } : {}),
      }
      break
    }
    case 'paste': {
      const sourceLogicalPath = toLogical(mutation.sourcePath)
      const logicalPath = toLogical(mutation.targetDirectoryPath)
      if (!sourceLogicalPath || logicalPath === null) return outside
      payload = { libraryId: library.id, action: 'paste', logicalPath, sourceLogicalPath, mode: mutation.mode }
      break
    }
  }
  const result = await performBackendLibraryEntryOperation(payload)
  if (result.ok) {
    measurement.success()
  } else {
    measurement.error(result.error ?? 'mutation-failed')
  }
  return result
}

export async function searchLibraryFiles(directoryPath: string, query: string): Promise<string[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return []
  }

  try {
    const measurement = startPerformanceMeasurement('filesystem.search', {
      operation: 'search',
    })
    try {
      const results = await searchFilesystemFiles(normalizedDirectoryPath, normalizedQuery)
      measurement.success({ entryCount: results.length })
      return results
    } catch (error) {
      measurement.error(error)
      throw error
    }
  } catch (error) {
    console.error('[notia] search_library_files failed', error)
    return []
  }
}

/** Read a flat (non-nested) list of ALL files and folders in the library.
 *  On Android this calls the `readFlatFileList` Kotlin plugin which does a
 *  recursive traversal but returns items without nesting. On desktop, it
 *  falls back to flattening the full tree. The result is used by search
 *  index and graph engine which need the complete file list regardless of
 *  the lazy-loaded UI tree state. */
export async function readLibraryFlatFileList(
  directoryPath: string,
  options?: { androidDirectoryUri?: string; signal?: AbortSignal },
): Promise<NotiaFlatFileEntry[]> {
  const normalizedDirectoryPath = normalizeFilesystemPath(directoryPath)
  const requestKey = `flat:${normalizedDirectoryPath}::${options?.androidDirectoryUri ?? ''}`
  throwIfReadCanceled(options?.signal)
  const readContext = getLibraryReadContext(normalizedDirectoryPath)
  const cachedRead = getCachedRead(completedFlatFileListCache, requestKey, 'flat')
  if (cachedRead) return cachedRead

  const inFlightRead = inFlightFlatFileListReadByRequestKey.get(requestKey)
  if (inFlightRead) {
    notiaLog('libraryRuntime', 'readLibraryFlatFileList dedup hit')
    return withAbort(inFlightRead, options?.signal)
  }

  const request = (async () => {
    const measurement = startPerformanceMeasurement('filesystem.read_flat_list', {
      operation: 'read-flat-list',
      isAndroid: getRuntimeDevice() === 'Android',
    })
    const timer = notiaTimer('libraryRuntime', 'readLibraryFlatFileList', {
      isAndroid: getRuntimeDevice() === 'Android',
    })

    try {
      if (getRuntimeDevice() === 'Android') {
        const rawPromise = readFilesystemFlatFileList(normalizedDirectoryPath, {
          androidDirectoryUri: options?.androidDirectoryUri,
        })
        const files = await withTimeout(rawPromise, ANDROID_SAF_TIMEOUT_MS, 'La lectura de la lista de archivos tardó demasiado.', options?.signal)
        const state = invalidationStateByLibraryPath.get(readContext.libraryPath)
        if (state?.invalidations.some((entry) => entry.revision > readContext.revision
          && isPathAffectedByInvalidation(normalizedDirectoryPath, entry.invalidation, 'flat'))) {
          throw new DOMException('El inventario quedó obsoleto.', 'AbortError')
        }
        setCachedRead(completedFlatFileListCache, requestKey, readContext.libraryPath, normalizedDirectoryPath, readContext.revision, 'flat', files)
        timer.success({ fileCount: files.length })
        measurement.success(countFlatMetrics(files))
        return files
      }

      // Desktop fallback: flatten the full tree
      const treeNodes = await readLibraryTree(normalizedDirectoryPath, {
        androidDirectoryUri: options?.androidDirectoryUri,
        signal: options?.signal,
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
      setCachedRead(completedFlatFileListCache, requestKey, readContext.libraryPath, normalizedDirectoryPath, readContext.revision, 'flat', files)
      timer.success({ fileCount: files.length, source: 'desktop-fallback' })
      measurement.success(countFlatMetrics(files))
      return files
    } catch (error) {
      timer.error(error)
      measurement.error(error)
      console.error('[libraryRuntime] readLibraryFlatFileList failed:', error)
      throw error
    }
  })()

  inFlightFlatFileListReadByRequestKey.set(requestKey, request)
  inFlightReadMetadata.set(readMetadataKey('flat', requestKey), {
    requestKey,
    libraryPath: readContext.libraryPath,
    directoryPath: normalizedDirectoryPath,
    scope: 'flat',
    revision: readContext.revision,
  })
  return withAbort(request.finally(() => {
    if (inFlightFlatFileListReadByRequestKey.get(requestKey) === request) {
      inFlightFlatFileListReadByRequestKey.delete(requestKey)
    }
    inFlightReadMetadata.delete(readMetadataKey('flat', requestKey))
  }), options?.signal)
}
