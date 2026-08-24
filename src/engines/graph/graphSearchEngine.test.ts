import { describe, expect, it } from 'vitest'
import { buildGraphSearchResults } from './graphSearchEngine'
import type { LibraryGraphModel } from '../../types/graph/libraryGraph'

const graphModel: LibraryGraphModel = {
  nodes: [
    { id: 'one', path: '/vault/Plan.md', label: 'Plan anual', degree: 2 },
    { id: 'two', path: '/vault/Notas.md', label: 'Notas', degree: 1 },
    { id: 'three', path: '/vault/Dibujo.inkdoc', label: 'Dibujo', degree: 0 },
  ],
  edges: [],
}

describe('buildGraphSearchResults', () => {
  it('matches file titles without case or accent sensitivity', () => {
    const results = buildGraphSearchResults(graphModel, {}, 'ANUAL')

    expect(results.map((result) => result.path)).toEqual(['/vault/Plan.md'])
  })

  it('matches file content and returns a nearby preview', () => {
    const results = buildGraphSearchResults(
      graphModel,
      { '/vault/Notas.md': 'Introducción al proyecto secreto y sus objetivos.' },
      'proyecto secreto',
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ path: '/vault/Notas.md' })
    expect(results[0]?.preview).toContain('proyecto secreto')
  })

  it('extracts searchable text from InkDoc blocks', () => {
    const results = buildGraphSearchResults(
      graphModel,
      {
        '/vault/Dibujo.inkdoc': JSON.stringify({
          pages: [{ textBlocks: [{ html: '<p>Idea dibujada</p>' }] }],
        }),
      },
      'idea dibujada',
    )

    expect(results.map((result) => result.path)).toEqual(['/vault/Dibujo.inkdoc'])
  })
})
