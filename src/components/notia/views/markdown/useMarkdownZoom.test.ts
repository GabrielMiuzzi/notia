import { describe, expect, it } from 'vitest'
import {
  calculatePinchZoom,
  clampMarkdownZoom,
  MAX_MARKDOWN_ZOOM,
  MIN_MARKDOWN_ZOOM,
  sheetFitScale,
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

  it('fits a wide sheet at 100 % and lets the zoom apply on top', () => {
    // A phone 400 px wide with 12 px of desk on each side, an A3 sheet 1123 px wide.
    const fit = sheetFitScale(400, 12, 1123)
    expect(fit).toBeCloseTo(376 / 1123)
    // The fit no longer depends on the zoom, so the scale on screen grows with it.
    expect(1.5 * fit).toBeGreaterThan(fit)
    // A sheet that fits keeps its size; nothing shrinks below a tenth.
    expect(sheetFitScale(1600, 40, 1123)).toBe(1)
    expect(sheetFitScale(50, 40, 1123)).toBe(0.1)
    expect(sheetFitScale(0, 40, 1123)).toBe(1)
  })

  it('keeps a valid zoom when the initial touch distance is zero', () => {
    expect(calculatePinchZoom(1.2, 0, 100)).toBe(1.2)
  })
})
