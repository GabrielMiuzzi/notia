import { describe, expect, it } from 'vitest'
import type { InkStroke } from '../../../../../services/markdown/noteInkRuntime'
import { createStrokesOnPages, estimatedBreaks, flowToPage, pageToFlow, strokeInFlow, strokeOnPages } from './inkFlow'

// Two breaks: a 150px blank where the flow reaches 1000, and another at 2000.
const breaks = [{ flowTop: 1000, height: 150 }, { flowTop: 2000, height: 120 }]

function stroke(points: InkStroke['points'], page: number | null = null): InkStroke {
  return { id: 's', tool: 'pen', color: 'teal', width: 4, page, points }
}

describe('inkFlow', () => {
  it('moves a flow height below the page breaks before it', () => {
    expect(flowToPage(500, breaks)).toBe(500)
    expect(flowToPage(1000, breaks)).toBe(1150)
    expect(flowToPage(1500, breaks)).toBe(1650)
    expect(flowToPage(2500, breaks)).toBe(2770)
    expect(flowToPage(500, [])).toBe(500)
  })

  it('goes back from the pages to the flow, and a blank to where it starts', () => {
    for (const y of [0, 500, 999, 1000, 1500, 2000, 2500]) expect(pageToFlow(flowToPage(y, breaks), breaks)).toBe(y)
    expect(pageToFlow(1100, breaks)).toBe(1000)
    expect(pageToFlow(2200, breaks)).toBe(2000)
  })

  it('moves a stroke drawn on a page into the flow, and back onto the pages', () => {
    const stride = 1200
    const onSecondPage = stroke([[10, 100, 0.5], [20, 200, 0.5]], 1)
    const inFlow = strokeInFlow(onSecondPage, breaks, stride)
    expect(inFlow.page).toBeNull()
    expect(inFlow.points.map((point) => point[1])).toEqual([1150, 1250])
    expect(strokeOnPages(inFlow, breaks).points.map((point) => point[1])).toEqual([1300, 1400])
    // A stroke already in the flow stays as it is.
    const flowStroke = stroke([[1, 2, 0.5]])
    expect(strokeInFlow(flowStroke, breaks, stride)).toBe(flowStroke)
  })

  it('estimates the breaks of full pages', () => {
    expect(estimatedBreaks(3, { pageHeight: 1000, pageGap: 32, margin: 100, numberBand: 18 })).toEqual([
      { flowTop: 882, height: 250 },
      { flowTop: 1664, height: 250 },
    ])
    expect(estimatedBreaks(1, { pageHeight: 1000, pageGap: 32, margin: 100, numberBand: 18 })).toEqual([])
  })
})

describe('createStrokesOnPages', () => {
  it('keeps the same stroke while the breaks above it stay, and places it as strokeOnPages', () => {
    const place = createStrokesOnPages()
    const high = stroke([[10, 500, 0.5]])
    const low = stroke([[10, 2500, 0.5]])
    const first = [place(high, breaks), place(low, breaks)]
    expect(first.map((shown) => shown.points)).toEqual([strokeOnPages(high, breaks).points, strokeOnPages(low, breaks).points])

    // A new line moves the second break: the stroke above it keeps its object.
    const moved = [breaks[0]!, { flowTop: 2030, height: 90 }]
    expect(place(high, moved)).toBe(first[0])
    const lowAgain = place(low, moved)
    expect(lowAgain).not.toBe(first[1])
    expect(lowAgain.points).toEqual(strokeOnPages(low, moved).points)
    // The same breaks again, in new objects: nothing moves.
    expect(place(low, moved.map((pageBreak) => ({ ...pageBreak })))).toBe(lowAgain)
  })
})
