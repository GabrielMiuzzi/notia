import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface UseVirtualListOptions {
  itemCount: number
  itemSize: number
  overscan?: number
}

interface VirtualItem {
  index: number
  start: number
  size: number
}

type ScrollAlignment = 'start' | 'end' | 'center' | 'nearest'

export function useVirtualList({
  itemCount,
  itemSize,
  overscan = 6,
}: UseVirtualListOptions) {
  const containerElementRef = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null)

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerElementRef.current = node
    setContainerElement(node)
  }, [])

  useEffect(() => {
    const container = containerElement
    if (!container) {
      setViewportHeight(0)
      setScrollTop(0)
      return
    }

    const syncViewport = () => {
      setViewportHeight(container.clientHeight)
      setScrollTop(container.scrollTop)
    }

    const handleScroll = () => {
      setScrollTop(container.scrollTop)
    }

    syncViewport()
    container.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        syncViewport()
      })
      : null
    resizeObserver?.observe(container)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
    }
  }, [containerElement])

  const totalSize = itemCount * itemSize

  const virtualItems = useMemo<VirtualItem[]>(() => {
    if (itemCount <= 0) {
      return []
    }

    const effectiveViewportHeight = Math.max(viewportHeight, itemSize)
    const startIndex = Math.max(0, Math.floor(scrollTop / itemSize) - overscan)
    const endIndex = Math.min(
      itemCount,
      Math.ceil((scrollTop + effectiveViewportHeight) / itemSize) + overscan,
    )

    const items: VirtualItem[] = []
    for (let index = startIndex; index < endIndex; index += 1) {
      items.push({
        index,
        start: index * itemSize,
        size: itemSize,
      })
    }

    return items
  }, [itemCount, itemSize, overscan, scrollTop, viewportHeight])

  const scrollToIndex = useCallback((index: number, alignment: ScrollAlignment = 'nearest') => {
    const container = containerElementRef.current
    if (!container || index < 0 || index >= itemCount) {
      return
    }

    const itemTop = index * itemSize
    const itemBottom = itemTop + itemSize
    const currentTop = container.scrollTop
    const currentBottom = currentTop + container.clientHeight

    if (alignment === 'nearest' && itemTop >= currentTop && itemBottom <= currentBottom) {
      return
    }

    let nextScrollTop = itemTop
    if (alignment === 'end') {
      nextScrollTop = itemBottom - container.clientHeight
    } else if (alignment === 'center') {
      nextScrollTop = itemTop - ((container.clientHeight - itemSize) / 2)
    } else if (alignment === 'nearest') {
      nextScrollTop = itemTop < currentTop
        ? itemTop
        : itemBottom - container.clientHeight
    }

    container.scrollTop = Math.max(0, nextScrollTop)
    setScrollTop(container.scrollTop)
  }, [itemCount, itemSize])

  return {
    containerRef,
    scrollToIndex,
    totalSize,
    virtualItems,
  }
}
