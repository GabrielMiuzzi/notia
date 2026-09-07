import { describe, expect, it } from 'vitest'
import {
  getMarkdownDocumentOutline,
  readMarkdownDocumentRange,
} from './activeDocumentContextEngine'

const source = [
  '# Proyecto',
  '',
  'Contexto inicial.',
  '',
  '## Objetivo',
  '',
  'Definir el alcance.',
  '',
  '## Implementacion',
  '',
  'Paso uno.',
  'Paso dos.',
  '',
  '# Anexo',
  '',
  'Notas finales.',
].join('\n')

describe('activeDocumentContextEngine', () => {
  it('builds a bounded outline with section end lines', () => {
    expect(getMarkdownDocumentOutline(source)).toMatchObject({
      totalLines: 16,
      totalCharacters: source.length,
      truncated: false,
      headings: [
        { id: 'heading-1', level: 1, text: 'Proyecto', line: 1, endLine: 13 },
        { id: 'heading-2', level: 2, text: 'Objetivo', line: 5, endLine: 8 },
        { id: 'heading-3', level: 2, text: 'Implementacion', line: 9, endLine: 13 },
        { id: 'heading-4', level: 1, text: 'Anexo', line: 14, endLine: 16 },
      ],
    })
  })

  it('reads one heading section without returning the whole document', () => {
    const result = readMarkdownDocumentRange(source, { target: 'heading', reference: 'Implementacion' })

    expect(result).toEqual({
      ok: true,
      range: {
        target: 'heading',
        startLine: 9,
        endLine: 13,
        text: '## Implementacion\n\nPaso uno.\nPaso dos.',
        truncated: false,
        matchedReference: 'Implementacion',
      },
    })
  })

  it('returns explicit alternatives instead of choosing an ambiguous heading', () => {
    const repeatedSource = '# Plan\n\n## Paso\nA\n\n## Paso\nB'
    const result = readMarkdownDocumentRange(repeatedSource, { target: 'heading', reference: 'Paso' })

    expect(result).toEqual({
      ok: false,
      error: 'target-ambiguous',
      candidates: [
        { label: 'Paso', startLine: 3, endLine: 5 },
        { label: 'Paso', startLine: 6, endLine: 7 },
      ],
    })
  })

  it('reads a bounded window near the current selection', () => {
    const result = readMarkdownDocumentRange(source, {
      target: 'near-cursor',
      contextLines: 1,
    }, {
      documentPath: 'C:/Notas/proyecto.md',
      from: 0,
      to: 3,
      selectedText: 'Paso dos.',
      blocks: [],
    })

    expect(result).toMatchObject({
      ok: true,
      range: {
        target: 'near-cursor',
        startLine: 11,
        endLine: 13,
        text: 'Paso uno.\nPaso dos.',
        truncated: false,
      },
    })
  })

  it('validates explicit line ranges', () => {
    expect(readMarkdownDocumentRange(source, { target: 'lines', fromLine: 4, toLine: 7 })).toMatchObject({
      ok: true,
      range: { startLine: 4, endLine: 7, text: '## Objetivo\n\nDefinir el alcance.' },
    })
    expect(readMarkdownDocumentRange(source, { target: 'lines', fromLine: 0, toLine: 2 })).toEqual({
      ok: false,
      error: 'invalid-range',
    })
  })
})
