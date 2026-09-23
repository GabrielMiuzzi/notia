import { invoke } from '@tauri-apps/api/core'
import type { NotiaFlatFileEntry } from '../../types/notia'

export interface LibraryInventoryEntry {
  path: string
  type: 'folder' | 'file'
  name: string
  parentPath?: string
  sizeBytes?: number
  modifiedAt?: number
  revision: number
  generation: number
}

export interface LibraryInventoryContext {
  libraryPath: string
  androidDirectoryUri?: string
  generation: number
}

export interface LibraryInventoryResult {
  ok: boolean
  entries: LibraryInventoryEntry[]
  upserted: number
  generation: number
  error?: string
}

const inventoryGenerationByLibraryPath = new Map<string, number>()

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

export function getLibraryInventoryGeneration(libraryPath: string): number {
  return inventoryGenerationByLibraryPath.get(normalizePath(libraryPath)) ?? 0
}

export function advanceLibraryInventoryGeneration(libraryPath: string): number {
  const normalizedPath = normalizePath(libraryPath)
  const nextGeneration = getLibraryInventoryGeneration(normalizedPath) + 1
  inventoryGenerationByLibraryPath.set(normalizedPath, nextGeneration)
  return nextGeneration
}

interface ReindexLibraryResult {
  ok: boolean
  indexed: number
  generation: number
  error?: string | null
}

const inFlightReindexByLibraryId = new Map<string, Promise<ReindexLibraryResult>>()

function abortError(): DOMException {
  return new DOMException('La reindexación fue cancelada.', 'AbortError')
}

/**
 * Asks the backend to rebuild the inventory of a registered library. Rust
 * walks the library, stores logical paths and publishes the snapshot
 * atomically; concurrent requests for the same library share one run. The
 * signal only stops waiting: a started snapshot still completes.
 */
export function reindexLibrary(libraryId: string, signal?: AbortSignal): Promise<ReindexLibraryResult> {
  if (signal?.aborted) return Promise.reject(abortError())
  let request = inFlightReindexByLibraryId.get(libraryId)
  if (!request) {
    request = invoke<ReindexLibraryResult>('backend_reindex_library', { payload: { libraryId } })
      .finally(() => inFlightReindexByLibraryId.delete(libraryId))
    inFlightReindexByLibraryId.set(libraryId, request)
  }
  if (!signal) return request
  const pending = request
  return new Promise<ReindexLibraryResult>((resolve, reject) => {
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function queryLibraryInventory(
  context: LibraryInventoryContext,
  options: { parentPath?: string; query?: string; offset?: number; limit?: number } = {},
): Promise<LibraryInventoryResult> {
  return invoke<LibraryInventoryResult>('query_library_inventory', {
    payload: {
      ...context,
      parentPath: options.parentPath,
      query: options.query,
      offset: options.offset ?? 0,
      limit: options.limit ?? 200,
    },
  })
}

export async function loadLibraryInventoryFileEntries(
  context: LibraryInventoryContext,
  signal?: AbortSignal,
  options: { query?: string; parentPath?: string } = {},
): Promise<NotiaFlatFileEntry[]> {
  const pageSize = 500
  const entries: NotiaFlatFileEntry[] = []
  for (let offset = 0; ; offset += pageSize) {
    if (signal?.aborted) {
      throw new DOMException('La carga del inventario fue cancelada.', 'AbortError')
    }
    const result = await queryLibraryInventory(context, {
      offset,
      limit: pageSize,
      query: options.query,
      parentPath: options.parentPath,
    })
    if (!result.ok) {
      throw new Error(result.error ?? 'No se pudo consultar el inventario de la librería.')
    }
    entries.push(...result.entries.map((entry) => ({
      path: entry.path,
      type: entry.type,
      name: entry.name,
    })))
    if (result.entries.length < pageSize) break
  }
  return entries
}
