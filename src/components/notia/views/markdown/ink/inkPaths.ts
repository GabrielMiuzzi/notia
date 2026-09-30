import type { PenColor } from '../../../../../services/preferences/editorPreferences'
import type { InkPoint, InkStroke } from '../../../../../services/markdown/noteInkRuntime'

/*
 * How a stroke is drawn: an SVG path over the sheet. A stroke drawn with the
 * same pressure all along is a line with round ends; one whose pressure
 * changes is filled as an outline that widens with it.
 */

/** The theme token each pen color is painted with. */
export const INK_COLOR_TOKENS: Record<PenColor, string> = {
  ink: 'var(--color-body-text)',
  teal: 'var(--color-accent-text)',
  blue: 'var(--color-periwinkle)',
  red: 'var(--color-coral)',
  orange: 'var(--color-amber)',
  yellow: 'var(--color-gold)',
}

export interface InkShape {
  d: string
  /** `stroke`: a line of the stroke's width; `fill`: an outline to fill. */
  paint: 'stroke' | 'fill'
}

const round = (value: number) => Math.round(value * 10) / 10

/** Width at a point: the stroke's width at pressure 0.5, from 35% to 165%. */
export function widthAt(width: number, pressure: number): number {
  return width * (0.35 + 1.3 * pressure)
}

function linePath(points: InkPoint[]): string {
  const [first, ...rest] = points
  if (!first) return ''
  if (rest.length === 0) return `M${round(first[0])} ${round(first[1])}l0.01 0`
  // Through the midpoints, with the points as control points: a smooth line.
  let d = `M${round(first[0])} ${round(first[1])}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index] as InkPoint
    const next = points[index + 1] as InkPoint
    d += `Q${round(point[0])} ${round(point[1])} ${round((point[0] + next[0]) / 2)} ${round((point[1] + next[1]) / 2)}`
  }
  const last = points[points.length - 1] as InkPoint
  return `${d}L${round(last[0])} ${round(last[1])}`
}

function outlinePath(points: InkPoint[], width: number): string {
  const left: Array<[number, number]> = []
  const right: Array<[number, number]> = []
  const radii: number[] = []
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)] as InkPoint
    const next = points[Math.min(points.length - 1, index + 1)] as InkPoint
    let dx = next[0] - previous[0]
    let dy = next[1] - previous[1]
    const length = Math.hypot(dx, dy) || 1
    dx /= length
    dy /= length
    const radius = widthAt(width, point[2]) / 2
    radii.push(radius)
    left.push([point[0] - dy * radius, point[1] + dx * radius])
    right.push([point[0] + dy * radius, point[1] - dx * radius])
  })
  const at = ([x, y]: [number, number]) => `${round(x)} ${round(y)}`
  const endRadius = round(radii[radii.length - 1] ?? 0)
  const startRadius = round(radii[0] ?? 0)
  return [
    `M${at(left[0] as [number, number])}`,
    ...left.slice(1).map((point) => `L${at(point)}`),
    `A${endRadius} ${endRadius} 0 0 1 ${at(right[right.length - 1] as [number, number])}`,
    ...right.slice(0, -1).reverse().map((point) => `L${at(point)}`),
    `A${startRadius} ${startRadius} 0 0 1 ${at(left[0] as [number, number])}`,
    'Z',
  ].join('')
}

export function inkShape(stroke: Pick<InkStroke, 'points' | 'width'>): InkShape {
  const { points } = stroke
  const pressures = new Set(points.map((point) => point[2]))
  if (points.length < 2 || pressures.size <= 1) return { d: linePath(points), paint: 'stroke' }
  return { d: outlinePath(points, stroke.width), paint: 'fill' }
}

/** Lowest point any stroke reaches, so the continuous sheet is at least that long. */
export function inkBottom(strokes: InkStroke[]): number {
  return strokes.reduce((bottom, stroke) => Math.max(bottom, ...stroke.points.map((point) => point[1] + stroke.width)), 0)
}
