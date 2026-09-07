import { describe, expect, it } from 'vitest'
import { validateDocumentEdit, validateMarkdownDocument } from './markdownValidationEngine'

describe('markdownValidationEngine', () => {
  it('accepts valid Markdown with fenced code and frontmatter', () => {
    expect(validateMarkdownDocument('---\ntags: [a]\n---\n\n# Título\n\n```ts\nconst x = 1\n```').ok).toBe(true)
  })

  it('detects broken structural delimiters', () => {
    const result = validateMarkdownDocument('```ts\nconst x = [1\n$$ fórmula')
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['unclosed-fence', 'unbalanced-formula', 'unbalanced-link']))
  })

  it('preserves frontmatter when validating an edit', () => {
    const result = validateDocumentEdit('---\ntags: [a]\n---\n\nTexto', '---\ntags: [b]\n---\n\nTexto nuevo')
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'frontmatter-changed')).toBe(true)
  })

  it('detects semantic heading jumps and malformed tables', () => {
    const result = validateMarkdownDocument([
      '# Documento',
      '### Salto invalido',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 |',
    ].join('\n'))

    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['heading-level-jump', 'malformed-table']))
  })

  it('detects an unclosed inline link without rejecting a valid table', () => {
    const result = validateMarkdownDocument('[enlace](https://example.com\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')

    expect(result.issues.some((issue) => issue.code === 'malformed-link')).toBe(true)
    expect(result.issues.some((issue) => issue.code === 'malformed-table')).toBe(false)
  })
})
