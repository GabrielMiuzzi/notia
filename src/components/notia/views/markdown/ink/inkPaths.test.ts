import { describe, expect, it } from 'vitest'
import type { InkStroke } from '../../../../../services/markdown/noteInkRuntime'
import { INK_COLOR_TOKENS, inkBottom, inkShape, widthAt } from './inkPaths'

function stroke(points: InkStroke['points'], width = 4): InkStroke {
  return { id: 'a', tool: 'pen', color: 'teal', width, points }
}

describe('inkPaths', () => {
  it('draws an even stroke as a line through the midpoints', () => {
    const shape = inkShape(stroke([[0, 0, 0.5], [10, 0, 0.5], [20, 10, 0.5]]))
    expect(shape.paint).toBe('stroke')
    expect(shape.d).toBe('M0 0Q10 0 15 5L20 10')
  })

  it('fills a stroke whose pressure changes, wider where it pressed more', () => {
    const shape = inkShape(stroke([[0, 0, 0.2], [10, 0, 0.9]]))
    expect(shape.paint).toBe('fill')
    expect(shape.d.startsWith('M')).toBe(true)
    expect(shape.d.endsWith('Z')).toBe(true)
    expect(widthAt(4, 0.9)).toBeGreaterThan(widthAt(4, 0.2))
    expect(widthAt(4, 0.5)).toBe(4)
  })

  it('draws a single tap as a dot', () => {
    expect(inkShape(stroke([[5, 5, 0.5]])).d).toBe('M5 5l0.01 0')
  })

  it('paints every pen color with a theme token', () => {
    expect(Object.values(INK_COLOR_TOKENS).every((token) => token.startsWith('var(--color-'))).toBe(true)
  })

  it('knows how far down the strokes reach', () => {
    expect(inkBottom([])).toBe(0)
    expect(inkBottom([stroke([[0, 100, 0.5], [0, 300, 0.5]], 6)])).toBe(306)
  })
})
