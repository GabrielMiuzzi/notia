import { invoke } from '@tauri-apps/api/core'
import type { NotiaFileNode, NotiaFlatFileEntry } from '../../types/notia'

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

const INVENTORY_BATCH_SIZE = 500
const inventoryGenerationByLibraryPath = new Map<string, number>()
const inFlightInventorySyncByKey = new Map<string, Promise<LibraryInventoryResult>>()

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

function resolveParentPath(pathValue: string): string | undefined {
  const normalized = normalizePath(pathValue)
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : undefined
}

function toInventoryEntry(file: NotiaFlatFileEntry, generation: number): LibraryInventoryEntry {
  const path = normalizePath(file.path)
  return {
    path,
    type: file.type,
    name: file.name,
    parentPath: resolveParentPath(path),
    revision: 0,
    generation,
  }
}

function* inventoryEntriesFromTree(
  nodes: NotiaFileNode[],
  generation: number,
): Generator<LibraryInventoryEntry> {
  const pending = [...nodes].reverse()
  while (pending.length > 0) {
    const node = pending.pop()!
    const path = normalizePath(node.path ?? node.name)
    yield {
      path,
      type: node.type,
      name: node.name,
      parentPath: resolveParentPath(path),
      revision: 0,
      generation,
    }
    if (node.children?.length) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index])
      }
    }
  }
}

export async function upsertLibraryInventoryBatch(
  context: LibraryInventoryContext,
  entries: LibraryInventoryEntry[],
): Promise<LibraryInventoryResult> {
  return invoke<LibraryInventoryResult>('upsert_library_inventory_batch', {
    payload: { ...context, entries },
  })
}

async function beginLibraryInventorySnapshot(
  context: LibraryInventoryContext,
): Promise<LibraryInventoryResult> {
  return invoke<LibraryInventoryResult>('begin_library_inventory_snapshot', {
    payload: context,
  })
}

async function commitLibraryInventorySnapshot(
  context: LibraryInventoryContext,
): Promise<LibraryInventoryResult> {
  return invoke<LibraryInventoryResult>('commit_library_inventory_snapshot', {
    payload: context,
  })
}

function assertInventoryGenerationIsCurrent(context: LibraryInventoryContext): void {
  if (getLibraryInventoryGeneration(context.libraryPath) > context.generation) {
    throw new DOMException('La sincronización del inventario quedó obsoleta.', 'AbortError')
  }
}

function withInventorySyncAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('La sincronización del inventario fue cancelada.', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new DOMException('La sincronización del inventario fue cancelada.', 'AbortError'))
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function performLibraryInventorySync(
  context: LibraryInventoryContext,
  entries: Iterable<LibraryInventoryEntry>,
  signal?: AbortSignal,
): Promise<LibraryInventoryResult> {
  if (signal?.aborted) {
    throw new DOMException('La sincronización del inventario fue cancelada.', 'AbortError')
  }
  assertInventoryGenerationIsCurrent(context)
  const started = await beginLibraryInventorySnapshot(context)
  if (!started.ok) return started
  let upserted = 0
  let batch: LibraryInventoryEntry[] = []
  for (const entry of entries) {
    if (signal?.aborted) {
      throw new DOMException('La sincronización del inventario fue cancelada.', 'AbortError')
    }
    assertInventoryGenerationIsCurrent(context)
    batch.push(entry)
    if (batch.length < INVENTORY_BATCH_SIZE) continue
    const result = await upsertLibraryInventoryBatch(context, batch)
    if (!result.ok) return { ...result, upserted }
    upserted += result.upserted
    batch = []
  }
  if (batch.length > 0) {
    const result = await upsertLibraryInventoryBatch(context, batch)
    if (!result.ok) return { ...result, upserted }
    upserted += result.upserted
  }
  if (signal?.aborted) {
    throw new DOMException('La sincronización del inventario fue cancelada.', 'AbortError')
  }
  assertInventoryGenerationIsCurrent(context)
  const committed = await commitLibraryInventorySnapshot(context)
  return committed.ok ? { ...committed, upserted } : committed
}

export function syncLibraryInventoryFromFlatFiles(
  context: LibraryInventoryContext,
  files: NotiaFlatFileEntry[],
  signal?: AbortSignal,
): Promise<LibraryInventoryResult> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('La sincronización del inventario fue cancelada.', 'AbortError'))
  }
  const key = `${normalizePath(context.libraryPath)}::${context.androidDirectoryUri ?? ''}::${context.generation}`
  const existing = inFlightInventorySyncByKey.get(key)
  if (existing) {
    return withInventorySyncAbort(existing, signal)
  }

  const request = performLibraryInventorySync(
    context,
    (function* () {
      for (const file of files) yield toInventoryEntry(file, context.generation)
    })(),
    signal,
  )
  inFlightInventorySyncByKey.set(key, request)
  const settledRequest = request.finally(() => {
    if (inFlightInventorySyncByKey.get(key) === request) {
      inFlightInventorySyncByKey.delete(key)
    }
  })
  return withInventorySyncAbort(settledRequest, signal)
}

export function syncLibraryInventoryFromTree(
  context: LibraryInventoryContext,
  nodes: NotiaFileNode[],
  signal?: AbortSignal,
): Promise<LibraryInventoryResult> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('La sincronización del inventario fue cancelada.', 'AbortError'))
  }
  const key = `${normalizePath(context.libraryPath)}::${context.androidDirectoryUri ?? ''}::${context.generation}`
  const existing = inFlightInventorySyncByKey.get(key)
  if (existing) return withInventorySyncAbort(existing, signal)

  const request = performLibraryInventorySync(context, inventoryEntriesFromTree(nodes, context.generation), signal)
  inFlightInventorySyncByKey.set(key, request)
  const settledRequest = request.finally(() => {
    if (inFlightInventorySyncByKey.get(key) === request) {
      inFlightInventorySyncByKey.delete(key)
    }
  })
  return withInventorySyncAbort(settledRequest, signal)
}

export async function deleteLibraryInventorySubtree(
  context: LibraryInventoryContext,
  pathHint: string,
): Promise<LibraryInventoryResult> {
  return invoke<LibraryInventoryResult>('delete_library_inventory_subtree', {
    payload: { ...context, pathHint: normalizePath(pathHint) },
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
