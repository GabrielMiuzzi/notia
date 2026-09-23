import { invoke } from '@tauri-apps/api/core'
import { normalizeFilesystemPath } from '../../utils/files/normalizeFilesystemPath'
import { getLibraryConfigDir } from './libraryConfig'
import type { FilesystemOperationResult } from '../files/filesystemEngine'
import {
  readLibraryFileContent,
  writeLibraryFileContent,
  type LibraryDocumentOptions,
} from './libraryDocumentRuntime'
import { startPerformanceMeasurement } from '../runtime/performanceBaseline'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../../types/notia'

const LINK_CACHE_FILENAME = 'linkCache.md'
const LINK_CACHE_LOGICAL_PATH = `.notia/${LINK_CACHE_FILENAME}`

export function buildLibraryLinkCachePath(libraryPath: string): string {
  return `${normalizeFilesystemPath(getLibraryConfigDir(libraryPath))}/${LINK_CACHE_FILENAME}`
}

export function isLinkCachePath(filePath: string, libraryPath?: string): boolean {
  const normalizedPath = normalizeFilesystemPath(filePath)
  const normalizedFileName = normalizedPath.split('/').pop() ?? ''
  if (normalizedFileName !== LINK_CACHE_FILENAME) {
    return false
  }
  if (libraryPath) {
    const expectedPath = buildLibraryLinkCachePath(libraryPath)
    return normalizedPath === expectedPath
  }
  return true
}

export interface WriteLibraryLinkCacheOptions extends Pick<LibraryDocumentOptions, 'androidDirectoryUri' | 'libraryId'> {
  expectedRevision?: string
}

export type ReadLibraryLinkCacheOptions = Pick<LibraryDocumentOptions, 'androidDirectoryUri' | 'libraryId'>

function getLibraryLinkCacheDocumentOptions(
  options?: WriteLibraryLinkCacheOptions | ReadLibraryLinkCacheOptions,
): LibraryDocumentOptions | undefined {
  if (typeof options?.libraryId !== 'string' || !options.libraryId.trim()) {
    return undefined
  }

  return {
    libraryId: options.libraryId,
    logicalPath: LINK_CACHE_LOGICAL_PATH,
  }
}

const MISSING_LIBRARY_IDENTITY = 'No se pudo resolver la biblioteca del cache de enlaces.'

/**
 * Writes `.notia/linkCache.md` through the backend by library identity. The
 * backend creates the file (and `.notia/`) when missing, on desktop and SAF.
 */
export async function writeLibraryLinkCache(
  libraryPath: string,
  mermaidCode: string,
  options?: WriteLibraryLinkCacheOptions,
): Promise<FilesystemOperationResult> {
  const documentOptions = getLibraryLinkCacheDocumentOptions(options)
  if (!documentOptions) {
    return { ok: false, error: MISSING_LIBRARY_IDENTITY }
  }
  return writeLibraryFileContent(buildLibraryLinkCachePath(libraryPath), mermaidCode, {
    ...documentOptions,
    ...(options?.expectedRevision !== undefined
      ? { expectedRevision: options.expectedRevision }
      : { createIfMissing: true }),
  })
}

export async function readLibraryLinkCache(
  libraryPath: string,
  options?: ReadLibraryLinkCacheOptions,
): Promise<string | null> {
  const documentOptions = getLibraryLinkCacheDocumentOptions(options)
  if (!documentOptions) {
    return null
  }
  const result = await readLibraryFileContent(buildLibraryLinkCachePath(libraryPath), documentOptions)
  return result.ok ? result.content : null
}

export interface RebuildLibraryLinkCacheParams {
  libraryPath: string
  libraryId?: string
  treeNodes: NotiaFileNode[]
  flatFileList?: NotiaFlatFileEntry[]
  androidDirectoryUri?: string
  signal?: AbortSignal
}

/**
 * Rebuild the link cache Mermaid diagram by re-computing the graph model
 * from the current tree and sources, then writing linkCache.md.
 */
export async function rebuildLibraryLinkCache(
  params: RebuildLibraryLinkCacheParams,
): Promise<FilesystemOperationResult> {
  if (params.signal?.aborted) {
    return { ok: false, error: 'La regeneración del cache fue cancelada.' }
  }
  if (!params.libraryId) {
    return { ok: false, error: MISSING_LIBRARY_IDENTITY }
  }
  const measurement = startPerformanceMeasurement('link_cache.rebuild', { operation: 'rebuild-link-cache' })
  try {
    // The backend builds the graph from the inventory and writes the file.
    await invoke('backend_rebuild_link_cache', { payload: { libraryId: params.libraryId } })
    measurement.success()
    return { ok: true }
  } catch (error) {
    measurement.error(error instanceof Error ? error : new Error('link-cache-write-failed'))
    const message = error instanceof Error
      ? error.message
      : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Error al regenerar linkCache.'
    return { ok: false, error: message }
  }
}
