import { describe, expect, it } from 'vitest'
import { extractMarkdownMath, getExportableMarkdownBody } from './markdownExportEngine'

describe('extractMarkdownMath', () => {
  it('extracts Math code blocks and inline formulas without exposing raw LaTeX', () => {
    const result = extractMarkdownMath([
      '# Fórmulas',
      '',
      'La energía es $E = mc^2$.',
      '',
      '```latex',
      '\\frac{x + 1}{2}',
      '```',
    ].join('\n'))

    expect(result.tokens).toEqual([
      { latex: '\\frac{x + 1}{2}', display: true },
      { latex: 'E = mc^2', display: false },
    ])
    expect(result.source).toContain('data-notia-math-token')
    expect(result.source).not.toContain('```latex')
  })

  it('leaves escaped dollar signs as ordinary text', () => {
    const result = extractMarkdownMath('Precio: \\$20')

    expect(result.tokens).toEqual([])
  })
})

describe('getExportableMarkdownBody', () => {
  it('removes properties from the initial frontmatter', () => {
    const source = [
      '---',
      'title: Documento privado',
      'tags:',
      '  - interno',
      '---',
      '# Contenido exportable',
      '',
      'Texto visible.',
    ].join('\n')

    expect(getExportableMarkdownBody(source)).toBe('# Contenido exportable\n\nTexto visible.')
  })

  it('preserves horizontal separators inside the document body', () => {
    const source = '# Primera parte\n\n---\n\nSegunda parte'

    expect(getExportableMarkdownBody(source)).toBe(source)
  })
})
