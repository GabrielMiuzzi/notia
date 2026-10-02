/*
 * Drawing of Graph View on the force-graph canvas: the theme palette read
 * from the CSS tokens, nodes with their ring and label, and the halos around
 * the notes of each folder. Only geometry and paint; the graph data comes
 * from the backend.
 */

export interface GraphPalette {
  background: string
  hairline: string
  text: string
  muted: string
  teal: string
  amber: string
}

const FALLBACK_PALETTE: GraphPalette = {
  background: '#0f1420',
  hairline: '#29334a',
  text: '#edf0f5',
  muted: '#8892a6',
  teal: '#4fd1c5',
  amber: '#ffb86b',
}

/** The palette of the theme the element is drawn in. */
export function readGraphPalette(element: Element | null): GraphPalette {
  if (!element) return FALLBACK_PALETTE
  const styles = getComputedStyle(element)
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  return {
    background: token('--color-app-bg', FALLBACK_PALETTE.background),
    hairline: token('--color-border-soft', FALLBACK_PALETTE.hairline),
    text: token('--color-heading-text', FALLBACK_PALETTE.text),
    muted: token('--color-muted-text', FALLBACK_PALETTE.muted),
    teal: token('--color-accent-text', FALLBACK_PALETTE.teal),
    amber: token('--color-amber', FALLBACK_PALETTE.amber),
  }
}

/** `#rgb`, `#rrggbb` or `rgb()` color with an alpha, for the canvas. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
    const value = Number.parseInt(full, 16)
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim())?.[1]?.split(',').slice(0, 3).join(',')
  return rgb ? `rgba(${rgb}, ${alpha})` : color
}

/** Radius of a node in graph units: orphans are small, hubs grow with their links. */
export function nodeRadius(degree: number): number {
  return degree === 0 ? 3.5 : Math.min(12, 4 + Math.sqrt(degree) * 2)
}

/** Radius of a node in the phone boards: a little smaller than on the desktop. */
export function phoneNodeRadius(degree: number): number {
  return degree === 0 ? 3 : Math.min(10, 3.5 + Math.sqrt(degree) * 1.7)
}

/**
 * Sizes of the drawing, from the desktop board or the phone boards of the
 * canvas. Lengths are screen pixels unless they say graph units.
 */
export interface GraphPaintMetrics {
  /** Radius of a node, in graph units. */
  nodeRadius: (degree: number) => number
  /** The touch area of a node is its radius plus this, in graph units... */
  hitPadding: number
  /** ...and never smaller than this radius on screen. */
  minHitRadius: number
  /** Opacity of the notes outside the selection and of the ones the search left out. */
  dimmedOpacity: number
  unmatchedOpacity: number
  /** Outer edge of the selected, matched or hovered ring, and of the gap inside it. */
  selectedRing: number
  matchRing: number
  ringGap: number
  labelFontSize: number
  labelHeight: number
  labelPadX: number
  /** Room between a node and its label. */
  labelGap: number
  labelWeight: number
  labelMaxWidth: number
  labelMaxWidthStrong: number
  linkWidth: number
  activeLinkWidth: number
  activeLinkAlpha: number
  /** Room around the notes of a folder, in graph units. */
  haloPadding: number
  haloFont: string
  haloFontSize: number
  /** Room between a folder's name and its count, and the count's opacity. */
  haloCountGap: number
  haloCountAlpha: number
  /** Room between a halo and its label. */
  haloLabelGap: number
}

export const DESKTOP_GRAPH_PAINT: GraphPaintMetrics = {
  nodeRadius,
  hitPadding: 5,
  minHitRadius: 0,
  dimmedOpacity: 0.3,
  unmatchedOpacity: 0.16,
  selectedRing: 5,
  matchRing: 4.5,
  ringGap: 3,
  labelFontSize: 11.5,
  labelHeight: 18,
  labelPadX: 6,
  labelGap: 5,
  labelWeight: 450,
  labelMaxWidth: 210,
  labelMaxWidthStrong: 360,
  linkWidth: 1.1,
  activeLinkWidth: 1.6,
  activeLinkAlpha: 0.85,
  haloPadding: 30,
  haloFont: "'JetBrains Mono', ui-monospace, monospace",
  haloFontSize: 11,
  // Two monospace spaces: "name  count".
  haloCountGap: 13.2,
  haloCountAlpha: 1,
  haloLabelGap: 6,
}

export const PHONE_GRAPH_PAINT: GraphPaintMetrics = {
  nodeRadius: phoneNodeRadius,
  hitPadding: 7,
  // The phone boards never make a node's touch area smaller than 30 px.
  minHitRadius: 15,
  dimmedOpacity: 0.28,
  unmatchedOpacity: 0.15,
  selectedRing: 4.5,
  matchRing: 4,
  ringGap: 2.5,
  labelFontSize: 10.5,
  labelHeight: 16,
  labelPadX: 5,
  labelGap: 4,
  labelWeight: 400,
  labelMaxWidth: 140,
  labelMaxWidthStrong: 220,
  linkWidth: 1,
  activeLinkWidth: 1.5,
  activeLinkAlpha: 0.9,
  haloPadding: 18,
  haloFont: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
  haloFontSize: 10.5,
  haloCountGap: 6,
  haloCountAlpha: 0.75,
  haloLabelGap: 3,
}

type Point = [number, number]

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index] as Point
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

const HALO_STEPS = 12

export interface HaloGroup {
  name: string
  points: Point[]
}

/** A dashed halo around the notes of each folder with three or more visible notes. */
export function drawFolderHalos(
  context: CanvasRenderingContext2D,
  groups: HaloGroup[],
  palette: GraphPalette,
  globalScale: number,
  metrics: GraphPaintMetrics = DESKTOP_GRAPH_PAINT,
): void {
  context.save()
  for (const group of groups) {
    if (group.points.length < 3) continue
    const padded: Point[] = []
    for (const [x, y] of group.points) {
      for (let step = 0; step < HALO_STEPS; step += 1) {
        const angle = (step * Math.PI * 2) / HALO_STEPS
        padded.push([x + Math.cos(angle) * metrics.haloPadding, y + Math.sin(angle) * metrics.haloPadding])
      }
    }
    const hull = convexHull(padded)
    const [first, ...rest] = hull
    if (!first) continue
    context.beginPath()
    context.moveTo(first[0], first[1])
    rest.forEach(([x, y]) => context.lineTo(x, y))
    context.closePath()
    context.fillStyle = withAlpha(palette.muted, 0.045)
    context.fill()
    context.setLineDash([4 / globalScale, 4 / globalScale])
    context.lineWidth = 1 / globalScale
    context.strokeStyle = withAlpha(palette.muted, 0.22)
    context.stroke()
    context.setLineDash([])
    const top = hull.reduce((best, point) => (point[1] < best[1] ? point : best), first)
    context.font = `400 ${metrics.haloFontSize / globalScale}px ${metrics.haloFont}`
    context.textAlign = 'left'
    context.textBaseline = 'bottom'
    context.fillStyle = palette.muted
    const count = String(group.points.length)
    const gap = metrics.haloCountGap / globalScale
    const nameWidth = context.measureText(group.name).width
    const left = top[0] - (nameWidth + gap + context.measureText(count).width) / 2
    const baseline = top[1] - metrics.haloLabelGap / globalScale
    context.fillText(group.name, left, baseline)
    context.globalAlpha = metrics.haloCountAlpha
    context.fillText(count, left + nameWidth + gap, baseline)
    context.globalAlpha = 1
  }
  context.restore()
}

export interface NodePaint {
  x: number
  y: number
  radius: number
  color: string
  opacity: number
  ring: 'selected' | 'match' | 'hover' | null
  label: string | null
  labelStrong: boolean
  /** Longest label, in screen pixels. */
  labelMaxWidth: number
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (context.measureText(`${text.slice(0, middle)}…`).width <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${text.slice(0, low)}…`
}

/** A node: its dot, the ring of its state and its label under it on a pill. */
export function drawNode(
  context: CanvasRenderingContext2D,
  paint: NodePaint,
  palette: GraphPalette,
  globalScale: number,
  metrics: GraphPaintMetrics = DESKTOP_GRAPH_PAINT,
): void {
  const { x, y, radius } = paint
  context.save()
  context.globalAlpha = paint.opacity
  if (paint.ring) {
    const ringColor = paint.ring === 'selected' ? palette.teal : paint.ring === 'match' ? palette.amber : withAlpha(palette.text, 0.55)
    context.beginPath()
    context.arc(x, y, radius + (paint.ring === 'selected' ? metrics.selectedRing : metrics.matchRing) / globalScale, 0, Math.PI * 2)
    context.fillStyle = ringColor
    context.fill()
    context.beginPath()
    context.arc(x, y, radius + metrics.ringGap / globalScale, 0, Math.PI * 2)
    context.fillStyle = palette.background
    context.fill()
  }
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fillStyle = paint.color
  context.fill()

  if (paint.label) {
    const fontSize = metrics.labelFontSize / globalScale
    context.font = `${paint.labelStrong ? 600 : metrics.labelWeight} ${fontSize}px 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif`
    const text = ellipsize(context, paint.label, paint.labelMaxWidth / globalScale)
    const width = context.measureText(text).width
    const padX = metrics.labelPadX / globalScale
    const height = metrics.labelHeight / globalScale
    const top = y + radius + metrics.labelGap / globalScale
    context.fillStyle = withAlpha(palette.background, 0.82)
    context.beginPath()
    context.roundRect(x - width / 2 - padX, top, width + padX * 2, height, 4 / globalScale)
    context.fill()
    context.fillStyle = paint.labelStrong ? palette.text : withAlpha(palette.text, 0.78)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, x, top + height / 2)
  }
  context.restore()
}
