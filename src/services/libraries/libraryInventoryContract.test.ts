import { describe, expect, it } from 'vitest'
import {
  advanceLibraryInventoryGeneration,
  createInitialLibraryInventoryGeneration,
  isPathAffectedByInvalidation,
  isCurrentLibraryInventoryGeneration,
  isLibraryInventoryRequestCurrent,
} from './libraryInventoryContract'

describe('library inventory generation contract', () => {
  it('advances generations without changing the library owner', () => {
    const initial = createInitialLibraryInventoryGeneration('library-a')
    const next = advanceLibraryInventoryGeneration(initial, {
      kind: 'subtree',
      pathHint: 'folder',
      reason: 'mutation',
    })

    expect(next).toEqual({ libraryId: 'library-a', value: 1 })
    expect(isCurrentLibraryInventoryGeneration(initial, next)).toBe(false)
    expect(isCurrentLibraryInventoryGeneration(next, next)).toBe(true)
  })

  it('rejects requests from another library, generation or canceled signal', () => {
    const controller = new AbortController()
    const current = { libraryId: 'library-a', value: 2 }

    expect(isLibraryInventoryRequestCurrent({
      libraryId: 'library-a',
      generation: 2,
      signal: controller.signal,
    }, current)).toBe(true)
    expect(isLibraryInventoryRequestCurrent({
      libraryId: 'library-b',
      generation: 2,
      signal: controller.signal,
    }, current)).toBe(false)

    controller.abort()
    expect(isLibraryInventoryRequestCurrent({
      libraryId: 'library-a',
      generation: 2,
      signal: controller.signal,
    }, current)).toBe(false)
  })

  it('identifies only intersecting paths for scoped reads', () => {
    const mutation = { kind: 'subtree' as const, pathHint: '/library/notes', reason: 'mutation' as const }

    expect(isPathAffectedByInvalidation('/library', mutation, 'tree')).toBe(true)
    expect(isPathAffectedByInvalidation('/library/notes/today', mutation, 'directory')).toBe(true)
    expect(isPathAffectedByInvalidation('/library/assets', mutation, 'directory')).toBe(false)
    expect(isPathAffectedByInvalidation('/library/notes-old', mutation, 'flat')).toBe(false)
    expect(isPathAffectedByInvalidation('/library/assets', {
      kind: 'generation',
      reason: 'recovery',
    }, 'directory')).toBe(true)
  })
})
