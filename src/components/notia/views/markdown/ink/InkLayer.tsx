import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PenPreferences } from '../../../../../services/preferences/editorPreferences'
import type { InkPoint, InkStroke, InkStrokeDraft, InkTool } from '../../../../../services/markdown/noteInkRuntime'
import { INK_COLOR_TOKENS, inkShape, widthAt } from './inkPaths'

/*
 * The canvas over the note: an SVG as large as the sheet (only the pages, in
 * page mode) where the pen, the highlighter and the eraser work. It only
 * captures the pointer and draws; Rust keeps, smooths and erases the strokes.
 * With the selector it lets every press through to the text.
 */

export type PenBarTool = 'selector' | 'pen' | 'highlighter' | 'eraser'

export interface InkSheet {
  /** Width of the sheet in unscaled CSS pixels. */
  width: number
  /** Height of one page in page mode; `null` on the continuous sheet. */
  pageHeight: number | null
  pageGap: number
}

interface InkLayerProps {
  strokes: InkStroke[]
  tool: PenBarTool
  pen: PenPreferences
  sheet: InkSheet
  /** The editor's scroll container: a finger scrolls it when only the pen draws. */
  scrollContainerRef: RefObject<HTMLElement | null>
  onCommit: (draft: InkStrokeDraft) => void
  onErase: (page: number | null, points: Array<[number, number]>, radius: number, gesture: number) => void
}

const HIGHLIGHTER_OPACITY = 0.35
const ERASER_RADIUS = 10
const ERASE_FLUSH_MS = 60
/** A pen seen this recently makes a touch a resting palm. */
const PALM_AFTER_PEN_MS = 1000
/** Contacts larger than this are a palm, not a finger. */
const PALM_CONTACT_PX = 40
const PEN_ERASER_BUTTON = 32
const PEN_BARREL_BUTTON = 2

interface Gesture {
  pointerId: number
  kind: 'draw' | 'erase' | 'scroll'
  page: number | null
  tool: InkTool
  points: InkPoint[]
  pending: Array<[number, number]>
  lastSent: [number, number] | null
  lastClient: [number, number]
  gesture: number
}

let strokeCounter = 0

function strokeId(): string {
  strokeCounter += 1
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${random}-${strokeCounter}`.slice(0, 64)
}

function StrokePath({ stroke }: { stroke: Pick<InkStroke, 'points' | 'width' | 'color' | 'tool'> }) {
  const shape = inkShape(stroke)
  const color = INK_COLOR_TOKENS[stroke.color]
  const opacity = stroke.tool === 'highlighter' ? HIGHLIGHTER_OPACITY : undefined
  return shape.paint === 'fill'
    ? <path d={shape.d} fill={color} opacity={opacity} />
    : (
      <path
        d={shape.d}
        fill="none"
        stroke={color}
        strokeWidth={widthAt(stroke.width, stroke.points[0]?.[2] ?? 0.5)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    )
}

const StoredStrokes = memo(function StoredStrokes({ strokes, sheet }: { strokes: InkStroke[]; sheet: InkSheet }) {
  const stride = (sheet.pageHeight ?? 0) + sheet.pageGap
  return (
    <>
      {strokes.map((stroke) => (
        <g key={stroke.id} transform={stroke.page !== null && stroke.page !== undefined ? `translate(0 ${stroke.page * stride})` : undefined}>
          <StrokePath stroke={stroke} />
        </g>
      ))}
    </>
  )
})

function InkLayerInner({ strokes, tool, pen, sheet, scrollContainerRef, onCommit, onErase }: InkLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draftRef = useRef<SVGGElement | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const gestureCounterRef = useRef(0)
  const lastPenAtRef = useRef(0)
  const flushTimerRef = useRef<number | null>(null)
  const drawing = tool !== 'selector'
  const stride = (sheet.pageHeight ?? 0) + sheet.pageGap

  useEffect(() => () => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
  }, [])

  /** The pointer in unscaled sheet pixels. */
  const toSheet = (clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scale = rect.width / sheet.width
    if (!scale) return null
    return [(clientX - rect.left) / scale, (clientY - rect.top) / scale]
  }

  /** The page under a point, and the point on that page; `null` between pages. */
  const locate = (x: number, y: number): { page: number | null; x: number; y: number } | null => {
    if (sheet.pageHeight === null) return { page: null, x, y }
    const page = Math.floor(y / stride)
    const local = y - page * stride
    if (page < 0 || local > sheet.pageHeight) return null
    return { page, x, y: local }
  }

  const onPage = (gesture: Gesture, x: number, y: number): [number, number] => {
    const local = gesture.page === null ? y : y - gesture.page * stride
    const bottom = sheet.pageHeight ?? Number.POSITIVE_INFINITY
    return [Math.min(Math.max(x, 0), sheet.width), Math.min(Math.max(local, 0), bottom)]
  }

  const pressureOf = (event: PointerEvent | ReactPointerEvent): number => {
    if (!pen.pressure || event.pointerType !== 'pen') return 0.5
    return event.pressure > 0 ? Math.min(1, event.pressure) : 0.5
  }

  const renderDraft = (gesture: Gesture) => {
    const group = draftRef.current
    if (!group) return
    const offset = gesture.page === null ? 0 : gesture.page * stride
    group.setAttribute('transform', `translate(0 ${offset})`)
    const shape = inkShape({ points: gesture.points, width: widthFor(gesture.tool) })
    const path = group.firstElementChild ?? group.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
    const color = INK_COLOR_TOKENS[pen.color]
    path.setAttribute('d', shape.d)
    path.setAttribute('opacity', gesture.tool === 'highlighter' ? String(HIGHLIGHTER_OPACITY) : '1')
    if (shape.paint === 'fill') {
      path.setAttribute('fill', color)
      path.setAttribute('stroke', 'none')
    } else {
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', String(widthAt(widthFor(gesture.tool), gesture.points[0]?.[2] ?? 0.5)))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
    }
  }

  const clearDraft = () => draftRef.current?.replaceChildren()

  const widthFor = (drawTool: InkTool) => (drawTool === 'highlighter' ? Math.min(48, Math.max(6, pen.thickness * 3)) : pen.thickness)

  const flushErase = () => {
    flushTimerRef.current = null
    const gesture = gestureRef.current
    if (!gesture || gesture.kind !== 'erase' || gesture.pending.length === 0) return
    const points = gesture.lastSent ? [gesture.lastSent, ...gesture.pending] : [...gesture.pending]
    gesture.lastSent = gesture.pending[gesture.pending.length - 1] ?? gesture.lastSent
    gesture.pending = []
    onErase(gesture.page, points, ERASER_RADIUS, gesture.gesture)
  }

  const scheduleErase = () => {
    if (flushTimerRef.current === null) flushTimerRef.current = window.setTimeout(flushErase, ERASE_FLUSH_MS)
  }

  /** What a press does: draw, erase, scroll the note or nothing. */
  const intentOf = (event: ReactPointerEvent): Gesture['kind'] | null => {
    if (event.pointerType === 'pen') {
      lastPenAtRef.current = Date.now()
      if ((event.buttons & PEN_ERASER_BUTTON) !== 0 || event.button === 5) return 'erase'
      if ((event.buttons & PEN_BARREL_BUTTON) !== 0) {
        if (pen.sideButton === 'eraser') return 'erase'
        if (pen.sideButton === 'select') return null
      }
      return tool === 'eraser' ? 'erase' : 'draw'
    }
    if (event.pointerType === 'touch') {
      const palm = pen.palmRejection
        && (Date.now() - lastPenAtRef.current < PALM_AFTER_PEN_MS || (event.width > PALM_CONTACT_PX && event.height > PALM_CONTACT_PX))
      if (palm) return null
      if (pen.penOnly) return 'scroll'
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return null
    return tool === 'eraser' ? 'erase' : 'draw'
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || gestureRef.current) return
    const kind = intentOf(event)
    if (!kind) return
    const point = toSheet(event.clientX, event.clientY)
    const located = point ? locate(point[0], point[1]) : null
    if (kind !== 'scroll' && !located) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureCounterRef.current += 1
    const gesture: Gesture = {
      pointerId: event.pointerId,
      kind,
      page: located?.page ?? null,
      tool: tool === 'highlighter' ? 'highlighter' : 'pen',
      points: [],
      pending: [],
      lastSent: null,
      lastClient: [event.clientX, event.clientY],
      gesture: gestureCounterRef.current,
    }
    gestureRef.current = gesture
    if (kind === 'draw' && located) {
      gesture.points.push([located.x, located.y, pressureOf(event)])
      renderDraft(gesture)
    } else if (kind === 'erase' && located) {
      gesture.pending.push([located.x, located.y])
      scheduleErase()
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'pen') lastPenAtRef.current = Date.now()
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'scroll') {
      const container = scrollContainerRef.current
      container?.scrollBy(gesture.lastClient[0] - event.clientX, gesture.lastClient[1] - event.clientY)
      gesture.lastClient = [event.clientX, event.clientY]
      return
    }
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
    for (const sample of events.length > 0 ? events : [event.nativeEvent]) {
      const point = toSheet(sample.clientX, sample.clientY)
      if (!point) continue
      const [x, y] = onPage(gesture, point[0], point[1])
      if (gesture.kind === 'draw') {
        if (gesture.points.length < 4000) gesture.points.push([x, y, pressureOf(sample)])
      } else {
        gesture.pending.push([x, y])
      }
    }
    if (gesture.kind === 'draw') renderDraft(gesture)
    else scheduleErase()
  }

  const finish = (event: ReactPointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'erase') {
      // What is left of the path goes now.
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
      flushErase()
      gestureRef.current = null
      return
    }
    gestureRef.current = null
    if (gesture.kind !== 'draw') return
    clearDraft()
    if (cancelled || gesture.points.length === 0) return
    onCommit({
      id: strokeId(),
      tool: gesture.tool,
      color: pen.color,
      width: widthFor(gesture.tool),
      page: gesture.page,
      points: gesture.points,
      smoothing: pen.smoothing,
    })
  }

  return (
    <svg
      ref={svgRef}
      className="notia-ink-layer"
      data-tool={tool}
      aria-hidden={!drawing}
      role={drawing ? 'img' : undefined}
      aria-label={drawing ? 'Lienzo para escribir a mano sobre la nota' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
    >
      <StoredStrokes strokes={strokes} sheet={sheet} />
      <g ref={draftRef} />
    </svg>
  )
}

export const InkLayer = memo(InkLayerInner)
