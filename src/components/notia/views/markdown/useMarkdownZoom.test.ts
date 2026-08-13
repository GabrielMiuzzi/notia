import { describe, expect, it } from 'vitest'
import {
  calculatePinchZoom,
  clampMarkdownZoom,
  MAX_MARKDOWN_ZOOM,
  MIN_MARKDOWN_ZOOM,
} from './useMarkdownZoom'

describe('markdown zoom', () => {
  it('clamps zoom to the supported range', () => {
    expect(clampMarkdownZoom(0.2)).toBe(MIN_MARKDOWN_ZOOM)
    expect(clampMarkdownZoom(1.25)).toBe(1.25)
    expect(clampMarkdownZoom(3)).toBe(MAX_MARKDOWN_ZOOM)
  })

  it('calculates pinch zoom from the initial gesture distance', () => {
    expect(calculatePinchZoom(1, 100, 150)).toBe(1.5)
    expect(calculatePinchZoom(1.5, 100, 50)).toBe(MIN_MARKDOWN_ZOOM)
  })

  it('keeps a valid zoom when the initial touch distance is zero', () => {
    expect(calculatePinchZoom(1.2, 0, 100)).toBe(1.2)
  })
})
