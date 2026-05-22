import { useCallback, useRef } from 'react'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 12
const WHEEL_FACTOR = 1.1

interface PanZoomState {
  x: number
  y: number
  zoom: number
}

interface PanZoomCallbacks {
  onZoomChange?: (zoom: number) => void
  onPanChange?: (x: number, y: number) => void
}

export function useMermaidPanZoom(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  transformLayerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  callbacks?: PanZoomCallbacks,
) {
  const viewStateRef = useRef<PanZoomState>({ x: 0, y: 0, zoom: 1 })
  const panState = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    hasMoved: false,
  })
  const pinchState = useRef({
    activePointers: new Map<number, { x: number; y: number }>(),
    isPinching: false,
    initialDistance: 0,
    initialZoom: 1,
  })

  const applyTransform = useCallback(() => {
    const layer = transformLayerRef.current
    if (!layer) return
    const { x, y, zoom } = viewStateRef.current
    layer.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
  }, [transformLayerRef])

  const setPanningCursor = useCallback((active: boolean) => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (active) {
      wrapper.classList.add('is-panning')
    } else {
      wrapper.classList.remove('is-panning')
    }
  }, [wrapperRef])

  const clamp = useCallback((value: number, min: number, max: number) => {
    return Math.min(Math.max(value, min), max)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return

    try {
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    } catch (_) {
      // ignore
    }

    const ps = pinchState.current
    ps.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const pan = panState.current
    pan.startX = e.clientX
    pan.startY = e.clientY
    pan.lastX = e.clientX
    pan.lastY = e.clientY
    pan.hasMoved = false

    if (ps.activePointers.size === 2) {
      const pointers = Array.from(ps.activePointers.values())
      const dx = pointers[0].x - pointers[1].x
      const dy = pointers[0].y - pointers[1].y
      ps.initialDistance = Math.hypot(dx, dy)
      ps.initialZoom = viewStateRef.current.zoom
      ps.isPinching = true
      pan.isPanning = false
    } else {
      pan.isPanning = true
      setPanningCursor(true)
    }
  }, [enabled, setPanningCursor])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    const ps = pinchState.current

    if (ps.activePointers.has(e.pointerId)) {
      ps.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    if (ps.isPinching && ps.activePointers.size === 2) {
      const pointers = Array.from(ps.activePointers.values())
      const dx = pointers[0].x - pointers[1].x
      const dy = pointers[0].y - pointers[1].y
      const newDistance = Math.hypot(dx, dy)
      if (ps.initialDistance > 0) {
        const scale = newDistance / ps.initialDistance
        const newZoom = clamp(ps.initialZoom * scale, MIN_ZOOM, MAX_ZOOM)
        viewStateRef.current.zoom = newZoom
        applyTransform()
        callbacks?.onZoomChange?.(newZoom)
      }
      return
    }

    const pan = panState.current
    if (pan.isPanning) {
      const dx = e.clientX - pan.lastX
      const dy = e.clientY - pan.lastY
      viewStateRef.current.x += dx
      viewStateRef.current.y += dy
      applyTransform()
      callbacks?.onPanChange?.(viewStateRef.current.x, viewStateRef.current.y)
      pan.lastX = e.clientX
      pan.lastY = e.clientY
    }

    const moveDx = e.clientX - pan.startX
    const moveDy = e.clientY - pan.startY
    if (Math.hypot(moveDx, moveDy) > 5) {
      pan.hasMoved = true
    }
  }, [enabled, clamp, applyTransform, callbacks])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try {
      ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    } catch (_) {
      // ignore
    }

    const ps = pinchState.current
    ps.activePointers.delete(e.pointerId)

    if (ps.isPinching && ps.activePointers.size < 2) {
      ps.isPinching = false
    }

    const pan = panState.current
    if (pan.isPanning) {
      setPanningCursor(false)
    }
    pan.isPanning = false
    pan.hasMoved = false
  }, [setPanningCursor])

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    handlePointerUp(e)
  }, [handlePointerUp])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!enabled) return
    e.preventDefault()
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const { x, y, zoom } = viewStateRef.current

    const worldX = (mouseX - x) / zoom
    const worldY = (mouseY - y) / zoom

    const factor = e.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR
    const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM)

    const newX = mouseX - worldX * newZoom
    const newY = mouseY - worldY * newZoom

    viewStateRef.current = { x: newX, y: newY, zoom: newZoom }
    applyTransform()
    callbacks?.onZoomChange?.(newZoom)
    callbacks?.onPanChange?.(newX, newY)
  }, [enabled, clamp, applyTransform, wrapperRef, callbacks])

  const zoomIn = useCallback(() => {
    const current = viewStateRef.current
    const newZoom = clamp(current.zoom * 1.25, MIN_ZOOM, MAX_ZOOM)
    viewStateRef.current.zoom = newZoom
    applyTransform()
    callbacks?.onZoomChange?.(newZoom)
  }, [clamp, applyTransform, callbacks])

  const zoomOut = useCallback(() => {
    const current = viewStateRef.current
    const newZoom = clamp(current.zoom / 1.25, MIN_ZOOM, MAX_ZOOM)
    viewStateRef.current.zoom = newZoom
    applyTransform()
    callbacks?.onZoomChange?.(newZoom)
  }, [clamp, applyTransform, callbacks])

  const resetView = useCallback(() => {
    viewStateRef.current = { x: 0, y: 0, zoom: 1 }
    applyTransform()
    callbacks?.onZoomChange?.(1)
    callbacks?.onPanChange?.(0, 0)
  }, [applyTransform, callbacks])

  const fitView = useCallback(() => {
    const wrapper = wrapperRef.current
    const layer = transformLayerRef.current
    if (!wrapper || !layer) {
      resetView()
      return
    }

    const svg = layer.querySelector('svg')
    if (!svg) {
      resetView()
      return
    }

    const vb = svg.viewBox?.baseVal
    const svgWidth = vb ? vb.width : svg.clientWidth || wrapper.clientWidth
    const svgHeight = vb ? vb.height : svg.clientHeight || wrapper.clientHeight

    const wrapperRect = wrapper.getBoundingClientRect()
    const scaleX = wrapperRect.width / (svgWidth || wrapperRect.width)
    const scaleY = wrapperRect.height / (svgHeight || wrapperRect.height)
    const zoom = Math.min(scaleX, scaleY, 1) * 0.9

    viewStateRef.current = { x: 0, y: 0, zoom }
    applyTransform()
    callbacks?.onZoomChange?.(zoom)
    callbacks?.onPanChange?.(0, 0)
  }, [wrapperRef, transformLayerRef, applyTransform, callbacks, resetView])

  const restoreView = useCallback((x: number, y: number, zoom: number) => {
    viewStateRef.current = { x, y, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }
    applyTransform()
    callbacks?.onZoomChange?.(viewStateRef.current.zoom)
    callbacks?.onPanChange?.(x, y)
  }, [clamp, applyTransform, callbacks])

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleWheel,
    zoomIn,
    zoomOut,
    resetView,
    fitView,
    restoreView,
  }
}
