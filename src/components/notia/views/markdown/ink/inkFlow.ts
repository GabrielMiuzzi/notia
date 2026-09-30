import type { InkPoint, InkStroke } from '../../../../../services/markdown/noteInkRuntime'
import type { FlowBreak } from '../paginationPlugin'

/*
 * Strokes are kept in the note's flow: the text as it is laid out out of
 * page mode. The sheet is as wide in both modes, so the text wraps the same;
 * page mode only adds blank space where a page ends. These functions move a
 * height between the flow and the pages, so the same stroke sits on the same
 * text in both modes.
 */

/** Where a height of the flow falls on the pages: below every break before it. */
export function flowToPage(y: number, breaks: FlowBreak[]): number {
  let shift = 0
  for (const pageBreak of breaks) {
    if (pageBreak.flowTop > y) break
    shift += pageBreak.height
  }
  return y + shift
}

/** The height of the flow under a point of the pages; a point in a blank goes to the blank's start. */
export function pageToFlow(y: number, breaks: FlowBreak[]): number {
  let shift = 0
  for (const pageBreak of breaks) {
    const top = pageBreak.flowTop + shift
    if (y < top) break
    if (y < top + pageBreak.height) return pageBreak.flowTop
    shift += pageBreak.height
  }
  return y - shift
}

export interface PageGeometryPixels {
  pageHeight: number
  pageGap: number
  margin: number
  numberBand: number
}

/**
 * Page breaks as if every page were full, for strokes drawn on pages before
 * they were kept in the flow when the note is not in page mode: the real
 * breaks are only known with the pages laid out.
 */
export function estimatedBreaks(pageCount: number, page: PageGeometryPixels): FlowBreak[] {
  const text = page.pageHeight - 2 * page.margin - page.numberBand
  const blank = page.pageHeight + page.pageGap - text
  return Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => ({
    flowTop: page.margin + (index + 1) * text,
    height: blank,
  }))
}

function mapPoints(points: InkPoint[], map: (y: number) => number): InkPoint[] {
  return points.map(([x, y, pressure]) => [x, map(y), pressure])
}

/** A stroke drawn on a page before strokes were kept in the flow. */
export function isPageStroke(stroke: InkStroke): boolean {
  return stroke.page !== null && stroke.page !== undefined
}

/** A stroke in the flow: the ones drawn on a page are moved into it. */
export function strokeInFlow(stroke: InkStroke, breaks: FlowBreak[], stride: number): InkStroke {
  if (!isPageStroke(stroke)) return stroke
  const top = (stroke.page ?? 0) * stride
  return { ...stroke, page: null, points: mapPoints(stroke.points, (y) => pageToFlow(top + y, breaks)) }
}

/** A stroke of the flow as the pages show it. */
export function strokeOnPages(stroke: InkStroke, breaks: FlowBreak[]): InkStroke {
  return { ...stroke, points: mapPoints(stroke.points, (y) => flowToPage(y, breaks)) }
}
