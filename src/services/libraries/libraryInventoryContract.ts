export type LibraryInventoryInvalidation =
  | {
    kind: 'subtree'
    pathHint: string
    reason: 'mutation' | 'external-change' | 'refresh'
  }
  | {
    kind: 'generation'
    reason: 'unknown-path' | 'library-switch' | 'recovery'
  }

export interface LibraryInventoryGeneration {
  libraryId: string
  value: number
}

export interface LibraryInventoryRequestContext {
  libraryId: string
  generation: number
  signal: AbortSignal
  timeoutMs: number
}

export type LibraryInventoryReadScope = 'tree' | 'directory' | 'flat'

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isPathAffectedByInvalidation(
  readPath: string,
  invalidation: LibraryInventoryInvalidation,
  scope: LibraryInventoryReadScope,
): boolean {
  if (invalidation.kind === 'generation') {
    return true
  }

  const normalizedReadPath = normalizePath(readPath)
  const normalizedHint = normalizePath(invalidation.pathHint)
  if (!normalizedReadPath || !normalizedHint) {
    return true
  }

  const readContainsHint = normalizedHint === normalizedReadPath
    || normalizedHint.startsWith(`${normalizedReadPath}/`)
  const hintContainsRead = normalizedReadPath.startsWith(`${normalizedHint}/`)

  // A flat inventory and a tree include all descendants. A directory read
  // only depends on the directory itself and on mutations below it; the
  // ancestor case is still relevant because rename/delete can replace it.
  if (scope === 'flat' || scope === 'tree') {
    return readContainsHint || hintContainsRead
  }

  return readContainsHint || hintContainsRead
}

export function createInitialLibraryInventoryGeneration(libraryId: string): LibraryInventoryGeneration {
  return { libraryId, value: 0 }
}

export function advanceLibraryInventoryGeneration(
  current: LibraryInventoryGeneration,
  invalidation: LibraryInventoryInvalidation,
): LibraryInventoryGeneration {
  // The value is a monotonic session generation. Subtree invalidations are
  // still represented here so callers that do not keep a path index can
  // safely discard their whole projection.
  void invalidation
  return {
    libraryId: current.libraryId,
    value: current.value + 1,
  }
}

export function isCurrentLibraryInventoryGeneration(
  expected: LibraryInventoryGeneration,
  current: LibraryInventoryGeneration,
): boolean {
  return expected.libraryId === current.libraryId && expected.value === current.value
}

export function isLibraryInventoryRequestCurrent(
  request: Pick<LibraryInventoryRequestContext, 'libraryId' | 'generation' | 'signal'>,
  current: LibraryInventoryGeneration,
): boolean {
  return !request.signal.aborted
    && request.libraryId === current.libraryId
    && request.generation === current.value
}
