import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export const MIN_MARKDOWN_ZOOM = 0.75
export const MAX_MARKDOWN_ZOOM = 2
export const MARKDOWN_WHEEL_ZOOM_STEP = 0.1

export function clampMarkdownZoom(zoom: number): number {
  return Math.min(MAX_MARKDOWN_ZOOM, Math.max(MIN_MARKDOWN_ZOOM, zoom))
}

export function calculatePinchZoom(
  initialZoom: number,
  initialDistance: number,
  currentDistance: number,
): number {
  if (initialDistance <= 0) {
    return clampMarkdownZoom(initialZoom)
  }

  return clampMarkdownZoom(initialZoom * (currentDistance / initialDistance))
}

function getTouchDistance(touches: TouchList): number {
  const first = touches.item(0)
  const second = touches.item(1)
  if (!first || !second) {
    return 0
  }

  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
}

interface PinchState {
  distance: number
  zoom: number
}

export function useMarkdownZoom(
  viewportRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  zoom: number,
  onZoomChange: (zoom: number) => void,
): void {
  const zoomRef = useRef(zoom)
  const onZoomChangeRef = useRef(onZoomChange)

  useEffect(() => {
    zoomRef.current = zoom
    onZoomChangeRef.current = onZoomChange

    const content = contentRef.current
    if (content) {
      content.style.zoom = String(zoom)
      content.style.width = `${100 / zoom}%`
    }
  }, [contentRef, onZoomChange, zoom])

  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) {
      return
    }

    let pinchState: PinchState | null = null

    const applyZoom = (nextZoom: number) => {
      const normalizedZoom = Math.round(clampMarkdownZoom(nextZoom) * 100) / 100
      zoomRef.current = normalizedZoom
      content.style.zoom = String(normalizedZoom)
      content.style.width = `${100 / normalizedZoom}%`
      onZoomChangeRef.current(normalizedZoom)
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) {
        return
      }

      event.preventDefault()
      const direction = event.deltaY < 0 ? 1 : -1
      applyZoom(zoomRef.current + direction * MARKDOWN_WHEEL_ZOOM_STEP)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        pinchState = null
        return
      }

      pinchState = {
        distance: getTouchDistance(event.touches),
        zoom: zoomRef.current,
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (!pinchState || event.touches.length !== 2) {
        return
      }

      event.preventDefault()
      applyZoom(calculatePinchZoom(
        pinchState.zoom,
        pinchState.distance,
        getTouchDistance(event.touches),
      ))
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchState = null
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    viewport.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false })
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true })
    viewport.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
      viewport.removeEventListener('touchend', handleTouchEnd)
      viewport.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [contentRef, viewportRef])
}
