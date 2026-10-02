import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PenPreferences } from '../../../../../services/preferences/editorPreferences'
import type { InkPoint, InkStroke, InkStrokeDraft, InkTool } from '../../../../../services/markdown/noteInkRuntime'
import type { FlowBreak } from '../paginationPlugin'
import { createStrokesOnPages, estimatedBreaks, isPageStroke, pageToFlow, strokeInFlow } from './inkFlow'
import { INK_COLOR_TOKENS, inkShape, widthAt } from './inkPaths'

/*
 * The canvas over the note: an SVG as large as the sheet (only the pages, in
 * page mode) where the pen, the highlighter and the eraser work. It only
 * captures the pointer and draws; Rust keeps, smooths and erases the strokes.
 * With the selector it lets every press through to the text. Strokes are in
 * the note's flow: in page mode they are drawn below the page breaks, and
 * what is drawn on a page goes back into the flow (`inkFlow`), so both modes
 * show the same strokes on the same text. The lasso (or the pen's side
 * button set to «Selección») circles strokes; Rust says which it took, and
 * dragging them moves them.
 */

export type PenBarTool = 'selector' | 'lasso' | 'pen' | 'highlighter' | 'eraser'

export interface InkSheet {
  /** Width of the sheet in unscaled CSS pixels. */
  width: number
  /** Page mode: the note is on pages and only the pages take strokes. */
  paged: boolean
  /** The page, in both modes: strokes drawn on a page before they were kept in the flow use it. */
  pageHeight: number
  pageGap: number
  margin: number
  numberBand: number
}

interface InkLayerProps {
  strokes: InkStroke[]
  tool: PenBarTool
  pen: PenPreferences
  sheet: InkSheet
  /** The page breaks in the note's flow, in page mode. */
  breaks: FlowBreak[]
  /** The editor's scroll container: a finger scrolls it when only the pen draws. */
  scrollContainerRef: RefObject<HTMLElement | null>
  onCommit: (draft: InkStrokeDraft) => void
  onErase: (page: number | null, points: Array<[number, number]>, radius: number, gesture: number) => void
  /** The strokes a lasso (closed path in the note's flow) takes. */
  onLassoSelect: (lasso: Array<[number, number]>) => Promise<string[]>
  /** Moves strokes by a distance in the note's flow. */
  onMove: (ids: string[], dx: number, dy: number) => void
  onRemove: (ids: string[]) => void
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
/** Room around the selected strokes that still grabs them. */
const SELECTION_PADDING = 8

interface Gesture {
  pointerId: number
  kind: 'draw' | 'erase' | 'scroll' | 'lasso' | 'move'
  page: number | null
  tool: InkTool
  points: InkPoint[]
  pending: Array<[number, number]>
  lastSent: [number, number] | null
  lastClient: [number, number]
  gesture: number
  /** Lasso and move: where the press started, in sheet pixels (pages included). */
  origin: [number, number]
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The box around some strokes as they are shown, with room to grab them. */
function boxOf(strokes: InkStroke[], stride: number): Box | null {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const stroke of strokes) {
    const offset = stroke.page !== null && stroke.page !== undefined ? stroke.page * stride : 0
    const half = stroke.width / 2 + SELECTION_PADDING
    for (const [x, y] of stroke.points) {
      left = Math.min(left, x - half)
      top = Math.min(top, offset + y - half)
      right = Math.max(right, x + half)
      bottom = Math.max(bottom, offset + y + half)
    }
  }
  return left === Infinity ? null : { left, top, right, bottom }
}

let strokeCounter = 0

function strokeId(): string {
  strokeCounter += 1
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${random}-${strokeCounter}`.slice(0, 64)
}

/** Drawn again only when its stroke changes: a page break moving below it leaves it as it is. */
const StrokePath = memo(function StrokePath({ stroke }: { stroke: Pick<InkStroke, 'points' | 'width' | 'color' | 'tool'> }) {
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
})

/** A stroke still on its page is drawn on that page; the others are already placed. */
const StoredStrokes = memo(function StoredStrokes({ strokes, stride }: { strokes: InkStroke[]; stride: number }) {
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

function InkLayerInner({ strokes, tool, pen, sheet, breaks, scrollContainerRef, onCommit, onErase, onLassoSelect, onMove, onRemove }: InkLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draftRef = useRef<SVGGElement | null>(null)
  const selectionRef = useRef<SVGGElement | null>(null)
  const selectionToolsRef = useRef<HTMLDivElement | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const gestureRef = useRef<Gesture | null>(null)
  const gestureCounterRef = useRef(0)
  const lastPenAtRef = useRef(0)
  const flushTimerRef = useRef<number | null>(null)
  const drawing = tool !== 'selector'
  const stride = sheet.pageHeight + sheet.pageGap
  // Keeps each stroke's object while the breaks above it stay the same.
  const [placeOnPages] = useState(createStrokesOnPages)

  // What each mode shows. Pages: flow strokes below the breaks, strokes still
  // on a page where they were drawn. Continuous sheet: flow strokes as they
  // are, strokes still on a page with the breaks of full pages (their real
  // place is known once the pages are laid out and they move into the flow).
  const shown = useMemo(() => {
    if (sheet.paged) return strokes.map((stroke) => (isPageStroke(stroke) ? stroke : placeOnPages(stroke, breaks)))
    const lastPage = strokes.reduce((last, stroke) => Math.max(last, stroke.page ?? -1), -1)
    if (lastPage < 0) return strokes
    const estimated = estimatedBreaks(lastPage + 1, sheet)
    return strokes.map((stroke) => strokeInFlow(stroke, estimated, stride))
  }, [breaks, placeOnPages, sheet, stride, strokes])

  const selected = useMemo(() => {
    const ids = new Set(selectedIds)
    return shown.filter((stroke) => ids.has(stroke.id))
  }, [selectedIds, shown])
  const selectionBox = useMemo(() => boxOf(selected, stride), [selected, stride])
  const selectedSet = useMemo(() => new Set(selected.map((stroke) => stroke.id)), [selected])

  // Another tool leaves the selection behind.
  useEffect(() => {
    if (tool !== 'lasso') setSelectedIds([])
  }, [tool])

  // A move shows as a shift until Rust returns the strokes in their new place.
  useLayoutEffect(() => {
    selectionRef.current?.removeAttribute('transform')
    if (selectionToolsRef.current) selectionToolsRef.current.style.transform = ''
  }, [shown])

  // Delete or Backspace takes out the selected strokes.
  useEffect(() => {
    if (selected.length === 0) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      onRemove(selected.map((stroke) => stroke.id))
      setSelectedIds([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRemove, selected])

  /** A height of the sheet (pages included), in the note's flow. */
  const sheetToFlow = (y: number): number => (sheet.paged ? pageToFlow(y, breaks) : y)

  const insideSelection = (point: [number, number] | null): boolean => (
    Boolean(point && selectionBox && point[0] >= selectionBox.left && point[0] <= selectionBox.right
      && point[1] >= selectionBox.top && point[1] <= selectionBox.bottom)
  )

  const renderLasso = (gesture: Gesture) => {
    const group = draftRef.current
    if (!group) return
    group.removeAttribute('transform')
    const path = group.firstElementChild ?? group.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
    path.setAttribute('d', `M${gesture.points.map(([x, y]) => `${Math.round(x)} ${Math.round(y)}`).join('L')}Z`)
    path.setAttribute('class', 'notia-ink-lasso')
    path.removeAttribute('stroke-width')
  }

  const shiftSelection = (dx: number, dy: number) => {
    selectionRef.current?.setAttribute('transform', `translate(${dx} ${dy})`)
    if (selectionToolsRef.current) selectionToolsRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }

  /** A point of a page, in the note's flow. */
  const toFlow = (page: number | null, y: number): number => (page === null ? y : pageToFlow(page * stride + y, breaks))

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
    if (!sheet.paged) return { page: null, x, y }
    const page = Math.floor(y / stride)
    const local = y - page * stride
    if (page < 0 || local > sheet.pageHeight) return null
    return { page, x, y: local }
  }

  const onPage = (gesture: Gesture, x: number, y: number): [number, number] => {
    const local = gesture.page === null ? y : y - gesture.page * stride
    const bottom = sheet.paged ? sheet.pageHeight : Number.POSITIVE_INFINITY
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
    onErase(null, points.map(([x, y]) => [x, toFlow(gesture.page, y)]), ERASER_RADIUS, gesture.gesture)
  }

  const scheduleErase = () => {
    if (flushTimerRef.current === null) flushTimerRef.current = window.setTimeout(flushErase, ERASE_FLUSH_MS)
  }

  const toolIntent = (event: ReactPointerEvent): Gesture['kind'] => {
    if (tool === 'lasso') return insideSelection(toSheet(event.clientX, event.clientY)) ? 'move' : 'lasso'
    return tool === 'eraser' ? 'erase' : 'draw'
  }

  /** What a press does: draw, erase, scroll the note or nothing. */
  const intentOf = (event: ReactPointerEvent): Gesture['kind'] | null => {
    if (event.pointerType === 'pen') {
      lastPenAtRef.current = Date.now()
      if ((event.buttons & PEN_ERASER_BUTTON) !== 0 || event.button === 5) return 'erase'
      if ((event.buttons & PEN_BARREL_BUTTON) !== 0) {
        if (pen.sideButton === 'eraser') return 'erase'
        if (pen.sideButton === 'select') return insideSelection(toSheet(event.clientX, event.clientY)) ? 'move' : 'lasso'
      }
      return toolIntent(event)
    }
    if (event.pointerType === 'touch') {
      const palm = pen.palmRejection
        && (Date.now() - lastPenAtRef.current < PALM_AFTER_PEN_MS || (event.width > PALM_CONTACT_PX && event.height > PALM_CONTACT_PX))
      if (palm) return null
      if (pen.penOnly) return 'scroll'
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return null
    return toolIntent(event)
  }


  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || gestureRef.current) return
    const kind = intentOf(event)
    if (!kind) return
    const point = toSheet(event.clientX, event.clientY)
    const located = point ? locate(point[0], point[1]) : null
    const free = kind === 'scroll' || kind === 'lasso' || kind === 'move'
    if (!free && !located) return
    if (kind === 'lasso') setSelectedIds([])
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
      origin: point ?? [0, 0],
    }
    gestureRef.current = gesture
    if (kind === 'lasso' && point) {
      gesture.points.push([point[0], point[1], 0.5])
      renderLasso(gesture)
    }
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
    if (gesture.kind === 'move') {
      const point = toSheet(event.clientX, event.clientY)
      if (point) shiftSelection(point[0] - gesture.origin[0], point[1] - gesture.origin[1])
      return
    }
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
    if (gesture.kind === 'lasso') {
      for (const sample of events.length > 0 ? events : [event.nativeEvent]) {
        const point = toSheet(sample.clientX, sample.clientY)
        if (point && gesture.points.length < 4000) gesture.points.push([point[0], point[1], 0.5])
      }
      renderLasso(gesture)
      return
    }
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
    if (gesture.kind === 'move') {
      const point = toSheet(event.clientX, event.clientY)
      if (cancelled || !point) {
        shiftSelection(0, 0)
        return
      }
      const dx = point[0] - gesture.origin[0]
      const dy = sheetToFlow(point[1]) - sheetToFlow(gesture.origin[1])
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        shiftSelection(0, 0)
        return
      }
      onMove([...selectedSet], Math.round(dx * 10) / 10, Math.round(dy * 10) / 10)
      return
    }
    if (gesture.kind === 'lasso') {
      clearDraft()
      if (cancelled || gesture.points.length < 3) return
      void onLassoSelect(gesture.points.map(([x, y]) => [x, sheetToFlow(y)])).then(setSelectedIds)
      return
    }
    if (gesture.kind !== 'draw') return
    clearDraft()
    if (cancelled || gesture.points.length === 0) return
    onCommit({
      id: strokeId(),
      tool: gesture.tool,
      color: pen.color,
      width: widthFor(gesture.tool),
      page: null,
      points: gesture.points.map(([x, y, pressure]) => [x, toFlow(gesture.page, y), pressure]),
      smoothing: pen.smoothing,
    })
  }

  const unselected = selected.length === 0 ? shown : shown.filter((stroke) => !selectedSet.has(stroke.id))
  return (
    <>
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
        <StoredStrokes strokes={unselected} stride={stride} />
        {selectionBox ? (
          <g ref={selectionRef} className="notia-ink-selection">
            <rect
              className="notia-ink-selection-box"
              x={selectionBox.left}
              y={selectionBox.top}
              width={selectionBox.right - selectionBox.left}
              height={selectionBox.bottom - selectionBox.top}
              rx={6}
            />
            <StoredStrokes strokes={selected} stride={stride} />
          </g>
        ) : null}
        <g ref={draftRef} />
      </svg>
      {selectionBox ? (
        <div
          ref={selectionToolsRef}
          className="notia-ink-selection-tools"
          style={{ left: selectionBox.right, top: selectionBox.top }}
        >
          <span>{selected.length === 1 ? '1 trazo' : `${selected.length} trazos`}</span>
          <button
            type="button"
            onClick={() => {
              onRemove(selected.map((stroke) => stroke.id))
              setSelectedIds([])
            }}
          >
            Borrar
          </button>
        </div>
      ) : null}
    </>
  )
}

export const InkLayer = memo(InkLayerInner)
