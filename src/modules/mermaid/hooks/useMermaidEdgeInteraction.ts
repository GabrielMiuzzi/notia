import { useEffect, useRef, useState, useCallback } from 'react'

/* ── Visual helpers ───────────────────────────────────────── */

const SELECTION_CSS_PROPS: Array<[string, string]> = [
  ['stroke', 'var(--color-accent-text)'],
  ['stroke-width', '3px'],
  ['filter', 'drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent-text) 40%, transparent))'],
]

/** Apply selected styles (class + inline) to every path inside the edge group. */
function applySelectionStyles(edgeGroup: Element) {
  edgeGroup.classList.add('mermaid-edge-selected')
  const paths =
    edgeGroup.tagName.toLowerCase() === 'path'
      ? [edgeGroup]
      : Array.from(edgeGroup.querySelectorAll('path'))
  paths.forEach((p) => {
    SELECTION_CSS_PROPS.forEach(([k, v]) => {
      ;(p as SVGPathElement).style.setProperty(k, v, 'important')
    })
  })
}

/** Remove selection class and inline styles from all paths in the container. */
function clearSelectionStyles(container: HTMLElement | null) {
  if (!container) return
  container.querySelectorAll('.mermaid-edge-selected').forEach((el) => {
    el.classList.remove('mermaid-edge-selected')
    const paths =
      el.tagName.toLowerCase() === 'path'
        ? [el]
        : Array.from(el.querySelectorAll('path'))
    paths.forEach((p) => {
      SELECTION_CSS_PROPS.forEach(([k]) => {
        ;(p as SVGPathElement).style.removeProperty(k)
      })
    })
  })
}

/* ── Edge detection helpers ─────────────────────────────────── */

/** Return true if an element is part of a Mermaid edge (arrow/line/label). */
function isEdgeElement(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  const cls = el.getAttribute('class') || ''
  return (
    cls.includes('edgePath') ||
    cls.includes('flowchart-link') ||
    cls.includes('edgeLabel') ||
    cls.includes('edge-pattern') ||
    cls.includes('edge-thickness') ||
    (tag === 'path' && el.closest('.edgePath, [class*="edge"]') != null) ||
    (tag === 'text' && el.closest('.edgeLabel') != null)
  )
}

/** Walk up from any edge sub-element to the root edge group. */
function getEdgeGroup(target: Element | null): Element | null {
  if (!target) return null
  // Direct hit on edgePath group
  let group = target.closest('.edgePath')
  if (group) return group

  // Hit on path with edge classes
  const cls = target.getAttribute('class') || ''
  if (target.tagName.toLowerCase() === 'path') {
    if (cls.includes('flowchart-link') || cls.includes('edge-pattern') || cls.includes('edge-thickness')) {
      // The path may be directly inside the SVG or inside an edgePath group
      group = target.closest('.edgePath')
      if (group) return group
      // Some Mermaid versions don't wrap in edgePath; return the path itself
      return target
    }
  }

  // Hit on edge label
  const label = target.closest('.edgeLabel')
  if (label) {
    const parent = label.parentElement
    if (parent && parent.classList.contains('edgePath')) return parent
    if (parent) {
      const sibling = parent.querySelector('.edgePath')
      if (sibling) return sibling
    }
    const svg = label.closest('svg')
    if (svg) {
      // Labels often sit next to edgePath groups under the same parent
      const allEdges = svg.querySelectorAll('.edgePath')
      return allEdges[0] || null
    }
  }

  return null
}

/** Extract from-node and to-node IDs from a Mermaid edge SVG group id.
 *  Patterns: L-A-B-0, L-start-end-1, L-n123-n456-0 */
function extractEdgeNodeIds(edgeGroupId: string): { fromId: string; toId: string } | null {
  if (!edgeGroupId.startsWith('L-')) return null
  const rest = edgeGroupId.slice(2)
  const parts = rest.split('-')
  if (parts.length < 3) return null
  const index = parts.pop()
  const toId = parts.pop()
  const fromId = parts.join('-')
  if (!fromId || !toId || !index) return null
  return { fromId, toId }
}

/** Get point data for an edge: SVG-local coords and wrapper-relative click coords. */
function getEdgePointData(
  edgeGroup: Element,
  wrapper: HTMLElement | null,
): { svgX: number; svgY: number; clickX: number; clickY: number; layerX: number; layerY: number } | null {
  let path = edgeGroup.querySelector('path')
  if (edgeGroup.tagName.toLowerCase() === 'path') {
    path = edgeGroup as SVGPathElement
  }
  if (!path) return null

  const svg = edgeGroup.closest('svg') as SVGSVGElement | null
  if (!svg) return null
  const ctm = svg.getScreenCTM()
  if (!ctm) return null

  const wrapperRect = wrapper?.getBoundingClientRect()
  if (!wrapperRect) return null

  const svgPath = path as SVGPathElement
  const len = svgPath.getTotalLength()
  const mid = svgPath.getPointAtLength(len / 2)

  const pt = svg.createSVGPoint()
  pt.x = mid.x
  pt.y = mid.y
  const screenPt = pt.matrixTransform(ctm)

  // Layer coords: local to the transformLayer, using SVG intrinsic scale
  const vb = svg.viewBox?.baseVal
  const cssWidth = svg.clientWidth || wrapper?.clientWidth || 1
  const cssHeight = svg.clientHeight || wrapper?.clientHeight || 1
  const scaleX = cssWidth / (vb?.width || cssWidth)
  const scaleY = cssHeight / (vb?.height || cssHeight)

  return {
    svgX: mid.x,
    svgY: mid.y,
    clickX: screenPt.x - wrapperRect.left,
    clickY: screenPt.y - wrapperRect.top,
    layerX: mid.x * scaleX,
    layerY: mid.y * scaleY,
  }
}

export interface EdgeInfo {
  edgeId: string
  fromNodeId: string
  toNodeId: string
  clickX: number
  clickY: number
  svgX: number
  svgY: number
  layerX: number
  layerY: number
  label?: string
}

export function useMermaidEdgeInteraction(
  svgContainerRef: React.RefObject<HTMLDivElement | null>,
  onEdgeSelect?: (edge: EdgeInfo | null) => void,
) {
  const [selectedEdge, setSelectedEdge] = useState<EdgeInfo | null>(null)
  const selectedEdgeRef = useRef<EdgeInfo | null>(null)
  const selectedEdgeIdRef = useRef<string | null>(null)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    selectedEdgeRef.current = selectedEdge
    selectedEdgeIdRef.current = selectedEdge?.edgeId ?? null
  }, [selectedEdge])

  const deselectAll = useCallback(() => {
    clearSelectionStyles(svgContainerRef.current)
    setSelectedEdge(null)
    onEdgeSelect?.(null)
  }, [svgContainerRef, onEdgeSelect])

  const selectEdge = useCallback(
    (edgeGroup: Element, wrapper: HTMLDivElement | null, _clickX: number, _clickY: number) => {
      const edgeId = edgeGroup.id || 'edge-unknown'
      const ids = extractEdgeNodeIds(edgeId)

      const pt = getEdgePointData(edgeGroup, wrapper)

      // Remove previous selection
      clearSelectionStyles(svgContainerRef.current)

      applySelectionStyles(edgeGroup)

      const edgeInfo: EdgeInfo = {
        edgeId,
        fromNodeId: ids?.fromId || '',
        toNodeId: ids?.toId || '',
        clickX: pt?.clickX ?? _clickX,
        clickY: pt?.clickY ?? _clickY,
        svgX: pt?.svgX ?? _clickX,
        svgY: pt?.svgY ?? _clickY,
        layerX: pt?.layerX ?? _clickX,
        layerY: pt?.layerY ?? _clickY,
      }
      setSelectedEdge(edgeInfo)
      onEdgeSelect?.(edgeInfo)
    },
    [svgContainerRef, onEdgeSelect],
  )

  // ── Pointer interaction ────────────────────────────────────
  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return
    const wrapper = container.closest('.mermaid-canvas-wrapper') as HTMLDivElement | null

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (isEdgeElement(target)) {
        // Prevent pan-zoom from capturing this pointer and dragging the canvas
        e.stopPropagation()
        isDraggingRef.current = false
        return
      }
      isDraggingRef.current = false
    }

    const onPointerMove = (e: PointerEvent) => {
      isDraggingRef.current = true
    }

    const onPointerUp = (e: PointerEvent) => {
      // If we dragged (pan/zoom), ignore as a click
      if (isDraggingRef.current) return

      const target = e.target as Element | null

      // Click inside the edge toolbar must not deselect the edge
      if (target?.closest('.mermaid-edge-toolbar')) return

      // Ignore clicks on nodes/anchors — BUT if target is actually an edge, proceed
      if (target?.closest('.node, .icon-shape, .mermaid-anchor')) {
        if (isEdgeElement(target)) {
          // edge inside node group (e.g., icon-shape) — allow through
        } else {
          if (selectedEdgeRef.current) deselectAll()
          return
        }
      }

      if (!isEdgeElement(target)) {
        // Pointer capture may have redirected target to wrapper; check element at point
        const elAtPoint = document.elementFromPoint(e.clientX, e.clientY)
        if (isEdgeElement(elAtPoint)) {
          const edgeGroup = getEdgeGroup(elAtPoint)
          if (edgeGroup) {
            const rect = wrapper?.getBoundingClientRect()
            const relX = rect ? e.clientX - rect.left : 0
            const relY = rect ? e.clientY - rect.top : 0
            selectEdge(edgeGroup, wrapper, relX, relY)
            e.stopPropagation()
          }
          return
        }
        if (selectedEdgeRef.current) deselectAll()
        return
      }

      const edgeGroup = getEdgeGroup(target)
      if (edgeGroup) {
        const rect = wrapper?.getBoundingClientRect()
        const relX = rect ? e.clientX - rect.left : 0
        const relY = rect ? e.clientY - rect.top : 0
        selectEdge(edgeGroup, wrapper, relX, relY)
        e.stopPropagation()
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedEdgeRef.current) {
        deselectAll()
      }
    }

    // Attach to wrapper so we catch events even during panning
    const el = wrapper || container
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    document.addEventListener('keydown', onKey)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('keydown', onKey)
    }
  }, [svgContainerRef, deselectAll, selectEdge])

  // Re-apply selection after SVG re-render
  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return

    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        const id = selectedEdgeIdRef.current
        if (!id) return
        const edgeGroup = container.querySelector(`#${CSS.escape(id)}`)
        if (edgeGroup) {
          applySelectionStyles(edgeGroup)
          const wrapper = container.closest('.mermaid-canvas-wrapper') as HTMLDivElement | null
          const pt = getEdgePointData(edgeGroup, wrapper)
          if (pt) {
            setSelectedEdge((prev) =>
              prev
                ? {
                    ...prev,
                    clickX: pt.clickX,
                    clickY: pt.clickY,
                    svgX: pt.svgX,
                    svgY: pt.svgY,
                    layerX: pt.layerX,
                    layerY: pt.layerY,
                  }
                : prev,
            )
          }
        }
      })
    })

    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [svgContainerRef])

  return { selectedEdge, deselectAll }
}
