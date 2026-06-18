import { useCallback, useEffect, useRef, useState } from 'react'

const LOCAL_STORAGE_PREFIX = 'notia:mermaid:inline-height'
const MIN_HEIGHT_PX = 120

/** Extrae viewBox del string SVG y calcula alto proporcional al ancho del contenedor. */
function computeNaturalHeight(svgString: string, containerWidth: number): number {
  if (!svgString || containerWidth <= 0) {
    return MIN_HEIGHT_PX
  }

  const viewBoxMatch = svgString.match(/viewBox=['"]\s*([\d.\s+-]+)\s*['"]/)
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/\s+/)
    if (parts.length >= 4) {
      const vbWidth = parseFloat(parts[2] ?? '0')
      const vbHeight = parseFloat(parts[3] ?? '0')
      if (vbWidth > 0 && vbHeight > 0) {
        return Math.max(MIN_HEIGHT_PX, (containerWidth / vbWidth) * vbHeight)
      }
    }
  }

  const widthAttrMatch = svgString.match(/<svg[^>]*\swidth=['"]([\d.]+)/)
  const heightAttrMatch = svgString.match(/<svg[^>]*\sheight=['"]([\d.]+)/)
  if (widthAttrMatch && heightAttrMatch) {
    const svgW = parseFloat(widthAttrMatch[1])
    const svgH = parseFloat(heightAttrMatch[1])
    if (svgW > 0 && svgH > 0) {
      return Math.max(MIN_HEIGHT_PX, (containerWidth / svgW) * svgH)
    }
  }

  return MIN_HEIGHT_PX
}

function buildStorageKey(storageKey: string): string {
  return `${LOCAL_STORAGE_PREFIX}:${storageKey}`
}

function readPersistedHeight(storageKey: string): number | null {
  try {
    const raw = localStorage.getItem(buildStorageKey(storageKey))
    if (!raw) return null
    const value = parseInt(raw, 10)
    if (Number.isFinite(value) && value >= MIN_HEIGHT_PX) {
      return value
    }
  } catch {
    // Silently ignore localStorage errors
  }
  return null
}

function writePersistedHeight(storageKey: string, height: number): void {
  try {
    localStorage.setItem(buildStorageKey(storageKey), String(Math.round(height)))
  } catch {
    // Silently ignore localStorage errors
  }
}

export function useMermaidInlineResize(storageKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const persisted = readPersistedHeight(storageKey)
  const [height, setHeight] = useState<number | null>(persisted)

  const isResizingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)

  const applyNaturalHeight = useCallback(
    (naturalHeight: number) => {
      setHeight((current) => {
        if (current !== null) {
          return current
        }
        return Math.max(MIN_HEIGHT_PX, naturalHeight)
      })
    },
    [],
  )

  const beginResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return

    isResizingRef.current = true
    startYRef.current = event.clientY
    startHeightRef.current = container.offsetHeight

    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return

    const delta = event.clientY - startYRef.current
    const nextHeight = Math.max(MIN_HEIGHT_PX, startHeightRef.current + delta)
    setHeight(nextHeight)

    const container = containerRef.current
    if (container) {
      container.style.height = `${nextHeight}px`
    }
  }, [])

  const endResize = useCallback((_event: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) return
    isResizingRef.current = false

    const container = containerRef.current
    if (container) {
      const finalHeight = container.offsetHeight
      setHeight(finalHeight)
      writePersistedHeight(storageKey, finalHeight)
    }
  }, [storageKey])

  // Apply imperative height when state changes from external sources (natural height calculation)
  useEffect(() => {
    const container = containerRef.current
    if (!container || height == null) return
    container.style.height = `${height}px`
  }, [height])

  return {
    containerRef,
    height,
    beginResize,
    handlePointerMove,
    endResize,
    applyNaturalHeight,
  }
}

export { computeNaturalHeight }
