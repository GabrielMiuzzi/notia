import { describe, it } from 'vitest'
import assert from 'node:assert'
import {
  getFrontmatterValue,
  hasFrontmatterKey,
  leadingFrontmatterBlock,
  parseFrontmatterDocument,
  serializeFrontmatterDocument,
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

describe('frontmatter round trip', () => {
  it('keeps strings that look like other types as strings after a body edit', () => {
    const source = [
      '---',
      'revision: "7954508202859205"',
      'codigo: "007"',
      'activo: "true"',
      'vacio: "null"',
      `cita: '"hola"'`,
      'estado: "Pendiente"',
      'orden: 3',
      'hecho: false',
      '---',
      '',
      'Cuerpo',
    ].join('\n')
    const parsed = parseFrontmatterDocument(source)
    const again = parseFrontmatterDocument(serializeFrontmatterDocument({ ...parsed, body: 'Cuerpo editado' }))
    assert.deepStrictEqual(again.frontmatter, parsed.frontmatter)
    assert.deepStrictEqual(parsed.frontmatter.slice(0, 5).map((entry) => entry.value), ['7954508202859205', '007', 'true', 'null', '"hola"'])
  })
})

describe('leadingFrontmatterBlock', () => {
  const sources = [
    '---\ntitle: Nota\npageMode: true\n---\n\nCuerpo\n---\nmás',
    '---\r\ntitle: Nota\r\n  ---  \r\nCuerpo',
    '---\ntitle: sin cierre\nCuerpo',
    '---\n---',
    '---\n',
    'Cuerpo\n---\ntitle: no\n---',
    '',
  ]

  it('reads the same properties as the whole note', () => {
    for (const source of sources) {
      assert.deepStrictEqual(parseFrontmatterDocument(leadingFrontmatterBlock(source)).frontmatter, parseFrontmatterDocument(source).frontmatter)
    }
  })

  it('stays the same while only the body changes', () => {
    const block = leadingFrontmatterBlock('---\ntitle: Nota\n---\n\nCuerpo')
    assert.strictEqual(block, '---\ntitle: Nota\n---\n')
    assert.strictEqual(leadingFrontmatterBlock('---\ntitle: Nota\n---\n\nCuerpo editado'), block)
    assert.strictEqual(leadingFrontmatterBlock('Sin propiedades'), '')
  })
})
