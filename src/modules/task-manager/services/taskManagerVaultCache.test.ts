import { describe, expect, it } from 'vitest'
import { resolveTaskManagerVaultCacheKey } from './taskManagerVaultCache'

describe('resolveTaskManagerVaultCacheKey', () => {
  it('separates the same path and Android grant by library identity', () => {
    const first = resolveTaskManagerVaultCacheKey({
      path: 'C:/library',
      androidTreeUri: 'content://tree/library',
      libraryId: 'library-1',
    })
    const second = resolveTaskManagerVaultCacheKey({
      path: 'C:/library',
      androidTreeUri: 'content://tree/library',
      libraryId: 'library-2',
    })

    expect(first).not.toBe(second)
  })

  it('keeps identity-less vault keys deterministic', () => {
    expect(resolveTaskManagerVaultCacheKey({ path: 'published-vault' })).toBe('::published-vault::')
  })
})
