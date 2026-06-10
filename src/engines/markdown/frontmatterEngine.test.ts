import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getFrontmatterValue,
  hasFrontmatterKey,
  setFrontmatterValue,
  removeFrontmatterValue,
  ensureMarkdownDefaults,
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

  it('ensureMarkdownDefaults injects missing properties', () => {
    const source = '# Hello\n\nWorld'
    const fileStats = { createdAt: 1234567890 }
    const result = ensureMarkdownDefaults(source, fileStats)
    assert.strictEqual(result.mutated, true)
    assert.ok(result.source.includes('createdAt: 1234567890'))
    assert.ok(result.source.includes('nextPage: N/A'))
    assert.ok(result.source.includes('previousPage: N/A'))
    assert.ok(result.source.includes('# Hello'))
  })

  it('ensureMarkdownDefaults does not mutate when all keys present', () => {
    const source = `---\ncreatedAt: 1234567890\nnextPage: N/A\npreviousPage: N/A\n---\n\n# Hello`
    const result = ensureMarkdownDefaults(source, { createdAt: 999 })
    assert.strictEqual(result.mutated, false)
    assert.strictEqual(result.source, source)
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
