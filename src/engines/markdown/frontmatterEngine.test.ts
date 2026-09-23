import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  getFrontmatterValue,
  hasFrontmatterKey,
  setFrontmatterValue,
  removeFrontmatterValue,
  validatePageLinkValue,
} from './frontmatterEngine.ts'

describe('frontmatterEngine helpers', () => {
  it('getFrontmatterValue returns value for existing key', () => {
    const entries = [{ key: 'title', value: 'Hello' }]
    assert.strictEqual(getFrontmatterValue(entries, 'title'), 'Hello')
  })

  it('getFrontmatterValue returns undefined for missing key', () => {
    const entries = [{ key: 'title', value: 'Hello' }]
    assert.strictEqual(getFrontmatterValue(entries, 'missing'), undefined)
  })

  it('hasFrontmatterKey returns true for existing key', () => {
    const entries = [{ key: 'tags', value: ['a', 'b'] }]
    assert.strictEqual(hasFrontmatterKey(entries, 'tags'), true)
  })

  it('hasFrontmatterKey returns false for missing key', () => {
    const entries = [{ key: 'tags', value: ['a', 'b'] }]
    assert.strictEqual(hasFrontmatterKey(entries, 'missing'), false)
  })

  it('setFrontmatterValue replaces existing key', () => {
    const entries = [{ key: 'title', value: 'Old' }]
    const result = setFrontmatterValue(entries, 'title', 'New')
    assert.deepStrictEqual(result, [{ key: 'title', value: 'New' }])
  })

  it('setFrontmatterValue adds new key', () => {
    const entries = [{ key: 'title', value: 'Hello' }]
    const result = setFrontmatterValue(entries, 'author', 'Me')
    assert.deepStrictEqual(result, [
      { key: 'title', value: 'Hello' },
      { key: 'author', value: 'Me' },
    ])
  })

  it('removeFrontmatterValue removes key', () => {
    const entries = [
      { key: 'title', value: 'Hello' },
      { key: 'author', value: 'Me' },
    ]
    const result = removeFrontmatterValue(entries, 'title')
    assert.deepStrictEqual(result, [{ key: 'author', value: 'Me' }])
  })

  it('validatePageLinkValue accepts non-empty string', () => {
    assert.strictEqual(validatePageLinkValue('hello.md'), true)
  })

  it('validatePageLinkValue rejects empty string', () => {
    assert.strictEqual(validatePageLinkValue(''), false)
  })

  it('validatePageLinkValue rejects array', () => {
    assert.strictEqual(validatePageLinkValue(['a', 'b']), false)
  })

  it('validatePageLinkValue rejects number', () => {
    assert.strictEqual(validatePageLinkValue(42), false)
  })
})
