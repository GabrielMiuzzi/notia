import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/*
 * Dragging a task between columns (or groups of the list) and inside one.
 * A mouse uses the browser's own drag; a finger or a pen drags after a long
 * press. Columns carry `data-drop-group`, draggable cards `data-drag-path`.
 * The view decides what a drop sends; this only tracks the gesture.
 */

const TOUCH_DRAG_DELAY_MS = 350
const TOUCH_DRAG_CANCEL_DISTANCE_PX = 10
/** A pointer this close to an edge of what scrolls the view scrolls it. */
const AUTOSCROLL_EDGE_PX = 72
const AUTOSCROLL_MAX_STEP_PX = 18

export interface DropTarget {
  column: string
  /** Index among the other shown tasks of the column. */
  index: number
}

export interface TaskDragOptions {
  rootRef: RefObject<HTMLElement | null>
  /** What scrolls the view sideways (board row, list box). */
  scrollRef: RefObject<HTMLElement | null>
  canDrag: (path: string) => boolean
  labelOf: (path: string) => string
  onDrop: (path: string, target: DropTarget) => void
  /** A drag that had started ended (dropped or not). */
  onGestureEnd: () => void
}

interface TouchDragState {
  pointerId: number
  path: string
  originX: number
  originY: number
  timerId: number | null
  active: boolean
}

export interface TaskDrag {
  draggingPath: string | null
  target: DropTarget | null
  touchDragging: boolean
  ghostLabel: string | null
  attachGhost: (node: HTMLDivElement | null) => void
  onCardDragStart: (event: ReactDragEvent<HTMLElement>, path: string) => void
  onCardDragEnd: () => void
  columnHandlers: {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => void
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => void
    onDrop: (event: ReactDragEvent<HTMLElement>) => void
  }
  rootHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  }
}

function verticalScroller(element: HTMLElement | null): HTMLElement {
  let current = element?.parentElement ?? null
  while (current) {
    const overflow = window.getComputedStyle(current).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function edgeStep(position: number, start: number, end: number): number {
  const towardStart = position - start
  const towardEnd = end - position
  if (towardStart < AUTOSCROLL_EDGE_PX) {
    return -Math.ceil(((AUTOSCROLL_EDGE_PX - Math.max(towardStart, 0)) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX)
  }
  if (towardEnd < AUTOSCROLL_EDGE_PX) {
    return Math.ceil(((AUTOSCROLL_EDGE_PX - Math.max(towardEnd, 0)) / AUTOSCROLL_EDGE_PX) * AUTOSCROLL_MAX_STEP_PX)
  }
  return 0
}

/** Controls keep their tap; the title button may be long-pressed to drag. */
const NO_DRAG_SELECTOR = 'button:not([data-drag-ok]), input, textarea, select, a, [contenteditable="true"], [role="dialog"], [role="menu"]'

export function useTaskDrag(options: TaskDragOptions): TaskDrag {
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const draggingPathRef = useRef<string | null>(null)
  const [target, setTargetState] = useState<DropTarget | null>(null)
  const targetRef = useRef<DropTarget | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)
  const [ghostLabel, setGhostLabel] = useState<string | null>(null)
  const touchRef = useRef<TouchDragState | null>(null)
  const nativeRef = useRef(false)
  const scrollRef = useRef<{ frame: number | null; x: number; y: number }>({ frame: null, x: 0, y: 0 })
  const retargetRef = useRef<(x: number, y: number) => void>(() => {})
  const ghostNodeRef = useRef<HTMLDivElement | null>(null)
  const ghostPositionRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })

  const setTarget = useCallback((next: DropTarget | null) => {
    const current = targetRef.current
    if (current?.column === next?.column && current?.index === next?.index) return
    targetRef.current = next
    setTargetState(next)
  }, [])

  const stopAutoScroll = useCallback(() => {
    const scroll = scrollRef.current
    if (scroll.frame !== null) {
      window.cancelAnimationFrame(scroll.frame)
      scroll.frame = null
    }
  }, [])

  const clear = useCallback(() => {
    const touch = touchRef.current
    if (touch?.timerId != null) window.clearTimeout(touch.timerId)
    if (touch?.active || draggingPathRef.current) optionsRef.current.onGestureEnd()
    touchRef.current = null
    draggingPathRef.current = null
    stopAutoScroll()
    setDraggingPath(null)
    setTouchDragging(false)
    setGhostLabel(null)
    setTarget(null)
  }, [setTarget, stopAutoScroll])

  const resolveTarget = useCallback((columnNode: HTMLElement, clientY: number): DropTarget | null => {
    const column = columnNode.dataset.dropGroup
    if (column === undefined) return null
    let index = 0
    for (const node of columnNode.querySelectorAll<HTMLElement>('[data-drag-path]')) {
      if (node.dataset.dragPath === draggingPathRef.current) continue
      const bounds = node.getBoundingClientRect()
      if (clientY < bounds.top + bounds.height / 2) break
      index += 1
    }
    return { column, index }
  }, [])

  const resolvePoint = useCallback((clientX: number, clientY: number) => {
    const column = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-drop-group]')
    return column ? resolveTarget(column, clientY) : null
  }, [resolveTarget])

  useEffect(() => {
    retargetRef.current = (x, y) => {
      if (!touchRef.current?.active) return
      const next = resolvePoint(x, y)
      if (next) setTarget(next)
    }
  }, [resolvePoint, setTarget])

  /** Near an edge the view scrolls under the pointer, sideways and down. */
  const autoScrollStep = useCallback(function scrollFrame() {
    const scroll = scrollRef.current
    scroll.frame = null
    const touching = Boolean(touchRef.current?.active)
    if (!touching && !nativeRef.current) return
    let moved = false
    const sideways = optionsRef.current.scrollRef.current
    if (sideways) {
      const bounds = sideways.getBoundingClientRect()
      const step = edgeStep(scroll.x, Math.max(bounds.left, 0), Math.min(bounds.right, window.innerWidth))
      if (step) {
        const before = sideways.scrollLeft
        sideways.scrollLeft = before + step
        moved = moved || sideways.scrollLeft !== before
      }
    }
    const vertical = verticalScroller(optionsRef.current.rootRef.current)
    const bounds = vertical === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : vertical.getBoundingClientRect()
    const step = edgeStep(scroll.y, Math.max(bounds.top, 0), Math.min(bounds.bottom, window.innerHeight))
    if (step) {
      const before = vertical.scrollTop
      vertical.scrollTop = before + step
      moved = moved || vertical.scrollTop !== before
    }
    if (!moved) return
    if (touching) retargetRef.current(scroll.x, scroll.y)
    scroll.frame = window.requestAnimationFrame(scrollFrame)
  }, [])

  const queueAutoScroll = useCallback((x: number, y: number) => {
    const scroll = scrollRef.current
    scroll.x = x
    scroll.y = y
    if (scroll.frame === null) scroll.frame = window.requestAnimationFrame(autoScrollStep)
  }, [autoScrollStep])

  // A mouse drag scrolls the view near its edges; the browser's own is slow.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (nativeRef.current) queueAutoScroll(event.clientX, event.clientY)
    }
    const onDragEnd = () => {
      nativeRef.current = false
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragend', onDragEnd)
    document.addEventListener('drop', onDragEnd)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragend', onDragEnd)
      document.removeEventListener('drop', onDragEnd)
    }
  }, [queueAutoScroll])

  // While a long press drags, the finger must not scroll the page: React
  // touch listeners are passive, so this one is registered by hand.
  useEffect(() => {
    const root = options.rootRef.current
    if (!root) return
    const block = (event: TouchEvent) => {
      if (touchRef.current?.active && event.cancelable) event.preventDefault()
    }
    root.addEventListener('touchmove', block, { passive: false })
    return () => root.removeEventListener('touchmove', block)
  }, [options.rootRef])

  useEffect(() => () => {
    const touch = touchRef.current
    if (touch?.timerId != null) window.clearTimeout(touch.timerId)
    const scroll = scrollRef.current
    if (scroll.frame !== null) window.cancelAnimationFrame(scroll.frame)
  }, [])

  const placeGhost = useCallback((x: number, y: number) => {
    const position = ghostPositionRef.current
    position.x = x
    position.y = y
    const node = ghostNodeRef.current
    if (node) node.style.transform = `translate(${Math.round(x - position.offsetX)}px, ${Math.round(y - position.offsetY)}px)`
  }, [])

  /** Measures where a fixed node really sits (an ancestor may hold it) and places it. */
  const attachGhost = useCallback((node: HTMLDivElement | null) => {
    ghostNodeRef.current = node
    if (!node) return
    node.style.transform = 'none'
    const bounds = node.getBoundingClientRect()
    const position = ghostPositionRef.current
    position.offsetX = bounds.left
    position.offsetY = bounds.top
    placeGhost(position.x, position.y)
  }, [placeGhost])

  const onCardDragStart = useCallback((event: ReactDragEvent<HTMLElement>, path: string) => {
    if (!optionsRef.current.canDrag(path)) {
      event.preventDefault()
      return
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', path)
    }
    draggingPathRef.current = path
    nativeRef.current = true
    setDraggingPath(path)
  }, [])

  const onCardDragEnd = useCallback(() => {
    nativeRef.current = false
    clear()
  }, [clear])

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!draggingPathRef.current || touchRef.current) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setTarget(resolveTarget(event.currentTarget, event.clientY))
  }, [resolveTarget, setTarget])

  const onDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    if (targetRef.current?.column === event.currentTarget.dataset.dropGroup) setTarget(null)
  }, [setTarget])

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const path = draggingPathRef.current
    if (!path || touchRef.current) return
    event.preventDefault()
    const shown = targetRef.current
    const next = shown && shown.column === event.currentTarget.dataset.dropGroup
      ? shown
      : resolveTarget(event.currentTarget, event.clientY)
    nativeRef.current = false
    clear()
    if (next) optionsRef.current.onDrop(path, next)
  }, [clear, resolveTarget])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') return
    const element = event.target
    if (!(element instanceof Element) || element.closest(NO_DRAG_SELECTOR)) return
    const card = element.closest<HTMLElement>('[data-drag-path]')
    const path = card?.dataset.dragPath
    if (!path || !optionsRef.current.canDrag(path)) return
    const root = event.currentTarget
    const pointerId = event.pointerId
    const origin = { x: event.clientX, y: event.clientY }
    const touch: TouchDragState = { pointerId, path, originX: origin.x, originY: origin.y, timerId: null, active: false }
    touch.timerId = window.setTimeout(() => {
      touch.active = true
      touch.timerId = null
      try {
        root.setPointerCapture(pointerId)
      } catch {
        // The finger already left: the drag ends with it.
      }
      draggingPathRef.current = path
      ghostPositionRef.current.x = origin.x
      ghostPositionRef.current.y = origin.y
      setDraggingPath(path)
      setTouchDragging(true)
      setGhostLabel(optionsRef.current.labelOf(path) || 'Tarea')
      retargetRef.current(origin.x, origin.y)
    }, TOUCH_DRAG_DELAY_MS)
    touchRef.current = touch
  }, [])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const touch = touchRef.current
    if (!touch || touch.pointerId !== event.pointerId) return
    if (!touch.active) {
      if (Math.hypot(event.clientX - touch.originX, event.clientY - touch.originY) > TOUCH_DRAG_CANCEL_DISTANCE_PX) clear()
      return
    }
    event.preventDefault()
    placeGhost(event.clientX, event.clientY)
    retargetRef.current(event.clientX, event.clientY)
    queueAutoScroll(event.clientX, event.clientY)
  }, [clear, placeGhost, queueAutoScroll])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const touch = touchRef.current
    if (!touch || touch.pointerId !== event.pointerId) return
    const { active, path } = touch
    const next = active ? targetRef.current ?? resolvePoint(event.clientX, event.clientY) : null
    clear()
    if (active && next) optionsRef.current.onDrop(path, next)
  }, [clear, resolvePoint])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (touchRef.current?.pointerId === event.pointerId) clear()
  }, [clear])

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (touchRef.current) event.preventDefault()
  }, [])

  const columnHandlers = useMemo(() => ({ onDragOver, onDragLeave, onDrop }), [onDragLeave, onDragOver, onDrop])
  const rootHandlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu }),
    [onContextMenu, onPointerCancel, onPointerDown, onPointerMove, onPointerUp],
  )

  return {
    draggingPath,
    target,
    touchDragging,
    ghostLabel,
    attachGhost,
    onCardDragStart,
    onCardDragEnd,
    columnHandlers,
    rootHandlers,
  }
}
