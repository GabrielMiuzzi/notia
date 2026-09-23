import { describe, it } from 'vitest'
import assert from 'node:assert'
import { extractLinkPath } from './pageLinkSyncEngine.ts'

describe('extractLinkPath', () => {
  it('extracts plain wikilink reference', () => {
    assert.strictEqual(extractLinkPath('[[6-10.md]]'), '6-10.md')
  })

  it('extracts wikilink with alias', () => {
    assert.strictEqual(extractLinkPath('[[title|6-10.md]]'), '6-10.md')
  })

  it('extracts plain path without brackets', () => {
    assert.strictEqual(extractLinkPath('6-10.md'), '6-10.md')
  })

  it('returns null for N/A', () => {
    assert.strictEqual(extractLinkPath('N/A'), null)
  })

  it('returns null for empty string', () => {
    assert.strictEqual(extractLinkPath(''), null)
  })

  it('returns null for whitespace-only string', () => {
    assert.strictEqual(extractLinkPath('   '), null)
  })

  it('returns null for non-string values', () => {
    assert.strictEqual(extractLinkPath(null), null)
    assert.strictEqual(extractLinkPath(42), null)
    assert.strictEqual(extractLinkPath(undefined), null)
  })

  it('returns null for wikilink with empty reference', () => {
    assert.strictEqual(extractLinkPath('[[]]'), null)
  })
})
