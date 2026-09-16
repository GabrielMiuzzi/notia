import { describe, expect, it } from 'vitest'
import { buildGraphContextLegend } from './graphLegendEngine'

describe('graph context legend', () => {
  it('includes configured contexts even when no node uses them', () => {
    expect(buildGraphContextLegend(
      [
        { tag: '#Laboral', color: '#2563EB' },
        { tag: '#Personal', color: '#16A34A' },
      ],
      [{ contextTag: '#Personal', contextColor: '#16A34A' }],
    )).toEqual([
      ['#Laboral', '#2563EB'],
      ['#Personal', '#16A34A'],
    ])
  })

  it('keeps a node context as a fallback when the catalog is not hydrated yet', () => {
    expect(buildGraphContextLegend([], [{ contextTag: '#Laboral', contextColor: '#2563EB' }])).toEqual([
      ['#Laboral', '#2563EB'],
    ])
  })
})
