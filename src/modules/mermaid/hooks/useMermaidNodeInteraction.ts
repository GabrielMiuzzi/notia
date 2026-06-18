import { useEffect, useRef, useState } from 'react'
import { extractMermaidNodeId } from '../engines/mermaidEngine'

export type AnchorSide = 'top' | 'right' | 'bottom' | 'left'

interface ConnectionState {
  fromNodeId: string
  fromSide: AnchorSide
  fromX: number // SVG local coords (node group space)
  fromY: number
  toX: number
  toY: number
}

const ANCHOR_RADIUS = 5
const ANCHOR_GAP = 6
const LEAVE_DELAY_MS = 300

/* ── Node lookup helpers (Mermaid v11 uses .node for shapes, .icon-shape for icons) ── */

function findNodeElement(target: Element | null): Element | null {
  if (!target) return null
  const anchor = target.closest('.mermaid-anchor')
  if (anchor) {
    return (anchor as Element).closest('.node, .icon-shape')
  }
  return target.closest('.node, .icon-shape')
}

function getNodeElements(container: Element): Element[] {
  return Array.from(container.querySelectorAll('.node, .icon-shape'))
}

/* ── Label editor helpers ─────────────────────────────────── */

function getNodeLabelText(nodeEl: Element): string {
  // Mermaid v11 puts the label in .nodeLabel or foreignObject span
  const labelEl =
    nodeEl.querySelector('.nodeLabel') ||
    nodeEl.querySelector('.label') ||
    nodeEl.querySelector('foreignObject span')
  if (labelEl) return (labelEl.textContent || '').trim()
  // Fallback: first text node inside
  const text = nodeEl.querySelector('text')
  if (text) return (text.textContent || '').trim()
  return ''
}

/** Create an inline input absolutely positioned over the node */
function createInlineLabelEditor(
  wrapper: HTMLDivElement,
  nodeEl: Element,
  initialText: string,
  onCommit: (value: string) => void,
  onCancel: () => void,
) {
  const rect = nodeEl.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()

  const input = document.createElement('input')
  input.type = 'text'
  input.value = initialText
  input.style.position = 'absolute'
  input.style.left = `${rect.left - wrapperRect.left + rect.width * 0.05}px`
  input.style.top = `${rect.top - wrapperRect.top + rect.height * 0.25}px`
  input.style.width = `${rect.width * 0.9}px`
  input.style.height = `${rect.height * 0.5}px`
  input.style.fontSize = '14px'
  input.style.textAlign = 'center'
  input.style.background = 'transparent'
  input.style.color = 'var(--color-app-text, #fff)'
  input.style.border = 'none'
  input.style.borderRadius = '0'
  input.style.outline = 'none'
  input.style.padding = '0 4px'
  input.style.zIndex = '1000'
  input.style.boxSizing = 'border-box'
  input.style.caretColor = 'var(--color-accent-text, #7c3aed)'
  input.style.textShadow = '0 0 2px var(--color-app-bg, #000)'

  wrapper.appendChild(input)
  input.focus()
  input.select()

  // Ocultar el label original del SVG mientras se edita
  const originalLabels = Array.from(
    nodeEl.querySelectorAll('.nodeLabel, .label, foreignObject, text'),
  ) as HTMLElement[]
  originalLabels.forEach((el) => {
    el.style.visibility = 'hidden'
  })

  const cleanup = () => {
    if (input.parentElement) input.remove()
    document.removeEventListener('keydown', onKey)
    originalLabels.forEach((el) => {
      el.style.visibility = ''
    })
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      cleanup()
      onCommit(input.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cleanup()
      onCancel()
    }
  }

  const onBlur = () => {
    cleanup()
    onCommit(input.value)
  }

  input.addEventListener('blur', onBlur, { once: true })
  document.addEventListener('keydown', onKey)
}

/* ── SVG coordinate helpers ───────────────────────────────── */

function getSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: clientX, y: clientY }
  return pt.matrixTransform(ctm.inverse())
}

/** Convert a local point from one element's coordinate space to another's */
function convertPoint(
  svg: SVGSVGElement,
  x: number,
  y: number,
  fromEl: SVGGraphicsElement,
  toEl: SVGGraphicsElement,
) {
  const pt = svg.createSVGPoint()
  pt.x = x
  pt.y = y
  const fromCTM = fromEl.getScreenCTM()
  const toCTM = toEl.getScreenCTM()
  if (!fromCTM || !toCTM) return { x, y }
  const viewport = pt.matrixTransform(fromCTM)
  return viewport.matrixTransform(toCTM.inverse())
}

/** Get the "main" shape of a node, prioritising container elements over labels/icon internals */
function getMainShape(nodeEl: Element): SVGGraphicsElement | null {
  const candidates = Array.from(
    nodeEl.querySelectorAll('rect, circle, ellipse, polygon, path'),
  ) as SVGGraphicsElement[]

  let best: SVGGraphicsElement | null = null
  let bestScore = -Infinity

  for (const s of candidates) {
    // Skip our own injected anchors — they must never be treated as the main shape
    if (s.classList.contains('mermaid-anchor')) continue

    const parent = s.parentElement
    const isLabel =
      s.classList.contains('label') ||
      parent?.classList.contains('label') ||
      parent?.classList.contains('label-container') ||
      parent?.classList.contains('nodeLabel') ||
      parent?.closest('.label') ||
      parent?.closest('.nodeLabel') ||
      parent?.closest('foreignObject')

    const bbox = s.getBBox()
    const area = bbox.width * bbox.height
    let score = area

    // Direct children of the .node group are very likely the container shape
    if (s.parentElement === nodeEl) {
      score += 20000
    }

    // Container shapes usually have a fill and a stroke
    const fill = s.getAttribute('fill') || ''
    const stroke = s.getAttribute('stroke') || ''
    const strokeWidth = parseFloat(s.getAttribute('stroke-width') || '0')

    if (fill && fill !== 'none') {
      score += 5000
    }
    if (stroke && stroke !== 'none' && strokeWidth > 0) {
      score += 2000
    }

    // Prefer primitive container shapes over generic paths
    const tag = s.tagName.toLowerCase()
    if (['rect', 'circle', 'ellipse', 'polygon'].includes(tag)) {
      score += 1000
    }

    if (isLabel) {
      score -= 100000
    }

    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

/** Compute anchor positions in the coordinate space of the .node group.
 *  Falls back to the node's own bounding box if no main shape is found. */
function computeAnchorsInNodeSpace(nodeEl: Element): Array<{
  side: AnchorSide
  cx: number
  cy: number
}> {
  const svg = nodeEl.closest('svg') as SVGSVGElement | null
  if (!svg) return []

  const shape = getMainShape(nodeEl)
  const nodeGroup = nodeEl as SVGGraphicsElement

  // Use the shape's bbox if available; otherwise fall back to the node group's bbox
  let bbox: DOMRect
  let sourceEl: SVGGraphicsElement
  if (shape) {
    bbox = shape.getBBox()
    sourceEl = shape
  } else {
    bbox = nodeGroup.getBBox()
    sourceEl = nodeGroup
  }

  const g = ANCHOR_GAP

  // Convert each corner / midpoint from source-local to node-local
  const toNode = (x: number, y: number) => convertPoint(svg, x, y, sourceEl, nodeGroup)

  const topMid = toNode(bbox.x + bbox.width / 2, bbox.y)
  const rightMid = toNode(bbox.x + bbox.width, bbox.y + bbox.height / 2)
  const bottomMid = toNode(bbox.x + bbox.width / 2, bbox.y + bbox.height)
  const leftMid = toNode(bbox.x, bbox.y + bbox.height / 2)

  // Push each anchor outward by ANCHOR_GAP in the correct direction
  return [
    { side: 'top',    cx: topMid.x,    cy: topMid.y - g },
    { side: 'right',  cx: rightMid.x + g, cy: rightMid.y },
    { side: 'bottom', cx: bottomMid.x,   cy: bottomMid.y + g },
    { side: 'left',   cx: leftMid.x - g, cy: leftMid.y },
  ]
}

/* ── DOM helpers ───────────────────────────────────────────── */

function removeAnchors(nodeEl: Element) {
  nodeEl.querySelectorAll('.mermaid-anchor').forEach((el) => el.remove())
}

function injectAnchors(nodeEl: Element) {
  const positions = computeAnchorsInNodeSpace(nodeEl)
  if (positions.length === 0) return
  removeAnchors(nodeEl)

  const nodeId = extractMermaidNodeId(nodeEl.id)
  positions.forEach((p) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', String(p.cx))
    circle.setAttribute('cy', String(p.cy))
    circle.setAttribute('r', String(ANCHOR_RADIUS))
    circle.setAttribute('class', 'mermaid-anchor')
    circle.setAttribute('data-side', p.side)
    circle.setAttribute('data-node-id', nodeId)
    nodeEl.appendChild(circle)
  })
}

function getOrCreateConnectionLayer(svg: SVGSVGElement): SVGGElement {
  let layer = svg.querySelector('.mermaid-connection-layer') as SVGGElement | null
  if (!layer) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    layer.setAttribute('class', 'mermaid-connection-layer')
    layer.setAttribute('pointer-events', 'none')
    svg.appendChild(layer)
  }
  return layer
}

function updateConnectionLine(
  svg: SVGSVGElement,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  const layer = getOrCreateConnectionLayer(svg)
  let line = layer.querySelector('.mermaid-connection-line') as SVGLineElement | null
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('class', 'mermaid-connection-line')
    layer.appendChild(line)
  }
  line.setAttribute('x1', String(fromX))
  line.setAttribute('y1', String(fromY))
  line.setAttribute('x2', String(toX))
  line.setAttribute('y2', String(toY))
}

function clearConnectionLine(svg: SVGSVGElement) {
  const layer = svg.querySelector('.mermaid-connection-layer')
  if (layer) layer.remove()
}

function applyNodeHoverClass(svgEl: SVGSVGElement, nodeId: string | null) {
  // Clean any existing hover highlight from all nodes
  svgEl.querySelectorAll('.mermaid-node-hover-shape').forEach((el) =>
    el.classList.remove('mermaid-node-hover-shape'),
  )
  if (!nodeId) return
  const nodeEl = svgEl.querySelector(`#${CSS.escape(nodeId)}`)
  if (!nodeEl) return
  const shape = getMainShape(nodeEl)
  if (shape) {
    shape.classList.add('mermaid-node-hover-shape')
  } else {
    // Fallback: highlight the entire node wrapper if no shape is found
    nodeEl.classList.add('mermaid-node-hover-shape')
  }
}

/* ── Hook ─────────────────────────────────────────────────── */

export interface UseMermaidNodeInteractionReturn {
  hoveredNodeId: string | null
  isConnecting: boolean
}

export function useMermaidNodeInteraction(
  svgContainerRef: React.RefObject<HTMLDivElement | null>,
  onConnect?: (fromNodeId: string, toNodeId: string) => void,
  onNodeLabelEdit?: (nodeId: string, newLabel: string) => void,
  enabled = true,
): UseMermaidNodeInteractionReturn {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const isConnectingRef = useRef(false)
  const connectionRef = useRef<ConnectionState | null>(null)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredNodeIdRef = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const capturedAnchorRef = useRef<SVGElement | null>(null)
  const editingRef = useRef(false)

  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId
  }, [hoveredNodeId])

  // Inyectar/quitar anchors cuando cambia el nodo hovereado
  useEffect(() => {
    if (!enabled) return
    const container = svgContainerRef.current
    if (!container) return
    const svgEl = container.querySelector('svg') as SVGSVGElement | null
    svgRef.current = svgEl
    wrapperRef.current = container.closest('.mermaid-canvas-wrapper') as HTMLDivElement | null
    if (!svgEl) return

    getNodeElements(svgEl).forEach((node) => removeAnchors(node))

    if (hoveredNodeId) {
      const nodeEl = svgEl.querySelector(`#${CSS.escape(hoveredNodeId)}`)
      if (nodeEl) {
        injectAnchors(nodeEl)
        applyNodeHoverClass(svgEl, hoveredNodeId)
      }
    } else {
      applyNodeHoverClass(svgEl, null)
    }
  }, [svgContainerRef, hoveredNodeId, enabled])

  // Re-inyectar anchors cuando el SVG cambia (nuevo render)
  useEffect(() => {
    if (!enabled) return
    const container = svgContainerRef.current
    if (!container) return

    const svgEl = container.querySelector('svg') as SVGSVGElement | null
    if (!svgEl) return

    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        const currentSvg = container.querySelector('svg') as SVGSVGElement | null
        svgRef.current = currentSvg
        wrapperRef.current = container.closest('.mermaid-canvas-wrapper') as HTMLDivElement | null
        if (!currentSvg || !hoveredNodeIdRef.current) return
        const nodeEl = currentSvg.querySelector(`#${CSS.escape(hoveredNodeIdRef.current)}`)
        if (nodeEl) {
          injectAnchors(nodeEl)
          applyNodeHoverClass(currentSvg, hoveredNodeIdRef.current)
        }
      })
    })
    // Observar solo el SVG directo, no todo el subtree del host
    observer.observe(svgEl, { childList: true, subtree: false })
    return () => observer.disconnect()
  }, [svgContainerRef, enabled])

  // Línea temporal sigue al cursor
  useEffect(() => {
    if (!enabled) return
    const onMove = (e: PointerEvent) => {
      if (!isConnectingRef.current || !connectionRef.current) return
      const svg = svgRef.current
      if (!svg) return
      const local = getSvgPoint(svg, e.clientX, e.clientY)
      const conn = connectionRef.current
      updateConnectionLine(svg, conn.fromX, conn.fromY, local.x, local.y)
    }
    document.addEventListener('pointermove', onMove)
    return () => document.removeEventListener('pointermove', onMove)
  }, [enabled])

  // Cancelar conexión con Escape
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isConnectingRef.current) return
      isConnectingRef.current = false
      connectionRef.current = null
      const svg = svgRef.current
      if (svg) clearConnectionLine(svg)
      const wrapper = wrapperRef.current
      if (wrapper) wrapper.classList.remove('is-connecting')
      setHoveredNodeId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])

  // Delegación pointermove en el wrapper: detectar hover
  useEffect(() => {
    if (!enabled) return
    const container = svgContainerRef.current
    if (!container) return

    const onPointerMove = (e: PointerEvent) => {
      if (isConnectingRef.current) return

      const nodeEl = findNodeElement(e.target as Element | null)
      if (nodeEl instanceof Element && nodeEl.id) {
        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current)
          leaveTimerRef.current = null
        }
        if (nodeEl.id !== hoveredNodeIdRef.current) {
          setHoveredNodeId(nodeEl.id)
        }
      } else {
        if (hoveredNodeIdRef.current && !leaveTimerRef.current) {
          leaveTimerRef.current = setTimeout(() => {
            setHoveredNodeId(null)
            leaveTimerRef.current = null
          }, LEAVE_DELAY_MS)
        }
      }
    }

    container.addEventListener('pointermove', onPointerMove, true)
    return () => container.removeEventListener('pointermove', onPointerMove, true)
  }, [svgContainerRef, enabled])

  // Delegación pointerdown / pointerup: drag-to-connect + doble-click label edit
  useEffect(() => {
    if (!enabled) return
    const container = svgContainerRef.current
    if (!container) return

    const onPointerDown = (e: PointerEvent) => {
      if (editingRef.current) return
      const target = e.target as Element | null
      if (!target) return

      // ── Click en anchor → iniciar conexión drag ──
      const anchorEl = target.closest('.mermaid-anchor')
      if (anchorEl instanceof SVGElement) {
        e.stopPropagation()
        e.preventDefault()

        if (leaveTimerRef.current) {
          clearTimeout(leaveTimerRef.current)
          leaveTimerRef.current = null
        }

        const nodeId = anchorEl.getAttribute('data-node-id')
        const side = anchorEl.getAttribute('data-side') as AnchorSide
        if (!nodeId || !side) return

        const svg = svgRef.current
        if (!svg) return

        const cx = parseFloat(anchorEl.getAttribute('cx') || '0')
        const cy = parseFloat(anchorEl.getAttribute('cy') || '0')

        // Convert anchor position from node-local to SVG-root space
        const nodeEl = anchorEl.closest('.node, .icon-shape') as SVGGraphicsElement | null
        const fromSvgSpace = nodeEl
          ? convertPoint(svg, cx, cy, nodeEl, svg)
          : { x: cx, y: cy }

        try {
          anchorEl.setPointerCapture(e.pointerId)
          capturedAnchorRef.current = anchorEl
        } catch (_) {}

        // Cursor feedback
        const wrapper = wrapperRef.current
        if (wrapper) wrapper.classList.add('is-connecting')

        isConnectingRef.current = true
        connectionRef.current = {
          fromNodeId: nodeId,
          fromSide: side,
          fromX: fromSvgSpace.x,
          fromY: fromSvgSpace.y,
          toX: fromSvgSpace.x,
          toY: fromSvgSpace.y,
        }
        updateConnectionLine(svg, fromSvgSpace.x, fromSvgSpace.y, fromSvgSpace.x, fromSvgSpace.y)
        return
      }

      // ── Click en nodo (no anchor) → evitar que el canvas haga pan ──
      const nodeEl = target.closest('.node, .icon-shape')
      if (nodeEl instanceof Element) {
        e.stopPropagation()
        return
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!isConnectingRef.current) return

      // Use elementFromPoint because pointer may be captured on the anchor,
      // so e.target is always the source anchor, not the drop target.
      const target = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      if (!target) {
        // Soltar en el vacío → cancelar
        isConnectingRef.current = false
        connectionRef.current = null
        const svg = svgRef.current
        if (svg) clearConnectionLine(svg)
        const wrapper = wrapperRef.current
        if (wrapper) wrapper.classList.remove('is-connecting')
        try {
          capturedAnchorRef.current?.releasePointerCapture(e.pointerId)
        } catch (_) {}
        capturedAnchorRef.current = null
        return
      }

      const nodeEl = target.closest('.node, .icon-shape')
      if (nodeEl instanceof Element) {
        const toId = extractMermaidNodeId(nodeEl.id)
        const fromId = connectionRef.current?.fromNodeId
        if (toId && fromId && toId !== fromId) {
          e.stopPropagation()
          e.preventDefault()
          onConnect?.(fromId, toId)
        }
      }

      isConnectingRef.current = false
      connectionRef.current = null
      const svg = svgRef.current
      if (svg) clearConnectionLine(svg)

      try {
        capturedAnchorRef.current?.releasePointerCapture(e.pointerId)
      } catch (_) {}
      capturedAnchorRef.current = null

      const wrapper = wrapperRef.current
      if (wrapper) wrapper.classList.remove('is-connecting')
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (!isConnectingRef.current) return
      isConnectingRef.current = false
      connectionRef.current = null
      const svg = svgRef.current
      if (svg) clearConnectionLine(svg)
      try {
        capturedAnchorRef.current?.releasePointerCapture(e.pointerId)
      } catch (_) {}
      capturedAnchorRef.current = null
      const wrapper = wrapperRef.current
      if (wrapper) wrapper.classList.remove('is-connecting')
    }

    // ── Doble click en nodo → editar label ──
    const onDblClick = (e: MouseEvent) => {
      if (!onNodeLabelEdit) return
      const target = e.target as Element | null
      const nodeEl = target?.closest('.node, .icon-shape')
      if (!(nodeEl instanceof Element) || !nodeEl.id) return
      if (editingRef.current) return

      const nodeId = extractMermaidNodeId(nodeEl.id)
      if (!nodeId) return

      const wrapper = wrapperRef.current
      if (!wrapper) return

      editingRef.current = true
      const initialText = getNodeLabelText(nodeEl)

      createInlineLabelEditor(
        wrapper,
        nodeEl,
        initialText,
        (value) => {
          editingRef.current = false
          if (value !== initialText) {
            onNodeLabelEdit(nodeId, value)
          }
        },
        () => {
          editingRef.current = false
        },
      )
    }

    container.addEventListener('pointerdown', onPointerDown, true)
    container.addEventListener('pointerup', onPointerUp, true)
    container.addEventListener('pointercancel', onPointerCancel, true)
    container.addEventListener('dblclick', onDblClick, true)

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, true)
      container.removeEventListener('pointerup', onPointerUp, true)
      container.removeEventListener('pointercancel', onPointerCancel, true)
      container.removeEventListener('dblclick', onDblClick, true)
    }
  }, [svgContainerRef, onConnect, onNodeLabelEdit, enabled])

  return {
    hoveredNodeId,
    isConnecting: isConnectingRef.current,
  }
}
