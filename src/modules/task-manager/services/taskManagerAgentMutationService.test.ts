import { describe, expect, it } from 'vitest'
import { resolveTaskManagerAgentGroups, shouldUseTaskManagerRustBackend } from './taskManagerAgentMutationService'

describe('resolveTaskManagerAgentGroups', () => {
  it('returns only configured groups from the active board', () => {
    const groups = resolveTaskManagerAgentGroups([
      { name: 'Del Q', color: '#111111', board: 'default' },
      { name: 'Anotadores', color: '#222222', board: 'default' },
      { name: 'Otro tablero', color: '#333333', board: 'producto' },
      { name: 'Legacy default', color: '#444444' },
    ], 'default')

    expect(groups).toEqual(['Anotadores', 'Del Q', 'Legacy default'])
  })

  it('returns no groups without an active board', () => {
    expect(resolveTaskManagerAgentGroups([
      { name: 'Del Q', color: '#111111', board: 'default' },
    ], null)).toEqual([])
  })
})

describe('shouldUseTaskManagerRustBackend', () => {
  it('uses Rust for every identified non-Android runtime, including publication', () => {
    expect(shouldUseTaskManagerRustBackend({ libraryId: 'library-1', libraryUserId: 'user-owner' })).toBe(true)
    expect(shouldUseTaskManagerRustBackend({ libraryId: 'library-1', libraryUserId: 'user-owner', published: true })).toBe(true)
    expect(shouldUseTaskManagerRustBackend({ libraryId: 'library-1', libraryUserId: 'user-owner', android: true })).toBe(false)
  })

  it('falls back explicitly when either local identity is absent', () => {
    expect(shouldUseTaskManagerRustBackend({ libraryUserId: 'user-owner' })).toBe(false)
    expect(shouldUseTaskManagerRustBackend({ libraryId: 'library-1' })).toBe(false)
    expect(shouldUseTaskManagerRustBackend()).toBe(false)
  })

  it('does not trust an arbitrary local user id without backend validation', () => {
    expect(shouldUseTaskManagerRustBackend({ libraryId: 'library-1', libraryUserId: 'user-arbitrary' })).toBe(true)
    // The predicate only selects the authenticated backend path. Rust must
    // validate this ID against the selected library before applying it.
  })
})
