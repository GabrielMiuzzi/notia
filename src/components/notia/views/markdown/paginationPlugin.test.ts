import { describe, expect, it } from 'vitest'
import { layoutPages, type MeasuredBlock, type PaginationGeometry } from './paginationPlugin'

/** Sheets of 1000px, 32px apart, with 100px margins and the number band. */
const GEOMETRY: PaginationGeometry = { pageHeight: 1000, pageGap: 32, margin: 100, numberBand: 18, zoom: 1 }

function stack(heights: number[], start = 100): MeasuredBlock[] {
  let top = start
  return heights.map((height, index) => {
    const block = { pos: index * 10, top, height }
    top += height
    return block
  })
}

describe('layoutPages', () => {
  it('keeps a note that fits on one sheet', () => {
    expect(layoutPages(stack([300, 300, 150]), GEOMETRY)).toEqual({ breaks: [], pageCount: 1 })
  })

  it('moves the block that does not fit to the top of the next sheet', () => {
    // The third block would end at 1000, past the text area (882).
    const { breaks, pageCount } = layoutPages(stack([300, 300, 300, 100]), GEOMETRY)
    expect(breaks).toEqual([{ pos: 20, height: 1132 - 700 }])
    expect(pageCount).toBe(2)
  })

  it('leaves a block taller than a sheet where it starts and continues after it', () => {
    const { breaks, pageCount } = layoutPages(stack([2000, 100]), GEOMETRY)
    // The tall block starts the page, so it is not moved; it ends in the top
    // margin of the third sheet, and the next block starts below that margin.
    expect(breaks).toEqual([{ pos: 10, height: 2164 - 2100 }])
    expect(pageCount).toBe(3)
  })

  it('takes a heading to the next page with the block it introduces', () => {
    const blocks = stack([300, 300, 150, 200])
    blocks[2] = { ...blocks[2]!, keepWithNext: true }
    // The heading (700–850) fits, but its paragraph (850–1050) does not.
    const { breaks, pageCount } = layoutPages(blocks, GEOMETRY)
    expect(breaks).toEqual([{ pos: 20, height: 1132 - 700 }])
    expect(pageCount).toBe(2)
  })

  it('takes a run of headings together', () => {
    const blocks = stack([300, 250, 60, 60, 200])
    blocks[2] = { ...blocks[2]!, keepWithNext: true }
    blocks[3] = { ...blocks[3]!, keepWithNext: true }
    // Both headings (650–770) fit, but the paragraph after them does not.
    expect(layoutPages(blocks, GEOMETRY).breaks).toEqual([{ pos: 20, height: 1132 - 650 }])
  })

  it('has one page for an empty note', () => {
    expect(layoutPages([], GEOMETRY)).toEqual({ breaks: [], pageCount: 1 })
  })

  it('uses the whole text area when the page has no number', () => {
    // They end at 890: past 882 with the number, within 900 without it.
    const blocks = stack([300, 300, 190])
    expect(layoutPages(blocks, GEOMETRY).breaks).toHaveLength(1)
    expect(layoutPages(blocks, { ...GEOMETRY, numberBand: 0 }).breaks).toEqual([])
  })
})
