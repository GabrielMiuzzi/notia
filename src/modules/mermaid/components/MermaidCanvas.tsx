import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MermaidRenderResult, MermaidEdgeType } from '../types/mermaidTypes'
import { useMermaidPanZoom } from '../hooks/useMermaidPanZoom'
import { useMermaidNodeInteraction } from '../hooks/useMermaidNodeInteraction'
import { useMermaidEdgeInteraction, type EdgeInfo } from '../hooks/useMermaidEdgeInteraction'
import { MermaidPanZoomToolbar } from './MermaidPanZoomToolbar'
import { MermaidExportMenu } from './MermaidExportMenu'
import { MermaidEdgeToolbar } from './MermaidEdgeToolbar'

interface MermaidCanvasProps {
  result: MermaidRenderResult | null
  isLoading: boolean
  error: string | null
  gridEnabled: boolean
  panZoomEnabled: boolean
  theme: string
  onZoomChange?: (zoom: number) => void
  onPanChange?: (x: number, y: number) => void
  onConnect?: (fromNodeId: string, toNodeId: string) => void
  onNodeLabelEdit?: (nodeId: string, newLabel: string) => void
  onEdgeSelect?: (edge: EdgeInfo | null) => void
}

interface MermaidCanvasExtendedProps extends MermaidCanvasProps {
  roughEnabled?: boolean
  initialZoom?: number
  initialPanX?: number
  initialPanY?: number
  onConnect?: (fromNodeId: string, toNodeId: string) => void
  onNodeLabelEdit?: (nodeId: string, newLabel: string) => void
  onEdgeSelect?: (edge: EdgeInfo | null) => void
  onEdgeTypeChange?: (fromNodeId: string, toNodeId: string, type: MermaidEdgeType) => void
  onEdgeColorChange?: (fromNodeId: string, toNodeId: string, color: string) => void
  onEdgeLabelChange?: (fromNodeId: string, toNodeId: string, label: string) => void
  canvasRef?: React.RefObject<HTMLDivElement | null>
  readOnly?: boolean
  onSvgInjected?: (container: HTMLDivElement) => void
}

export const MermaidCanvas = memo(function MermaidCanvas({
  result,
  isLoading,
  error,
  gridEnabled,
  panZoomEnabled,
  theme,
  roughEnabled,
  initialPanX,
  initialPanY,
  initialZoom,
  onZoomChange,
  onPanChange,
  onConnect,
  onNodeLabelEdit,
  onEdgeSelect,
  onEdgeTypeChange,
  onEdgeColorChange,
    onEdgeLabelChange,
    canvasRef,
    readOnly,
    onSvgInjected,
  }: MermaidCanvasExtendedProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const transformLayerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)

  const setWrapperRef = useCallback(
    (node: HTMLDivElement | null) => {
      ;(wrapperRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (canvasRef) {
        ;(canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [canvasRef],
  )

  const interactionEnabled = readOnly !== true

  useMermaidNodeInteraction(svgContainerRef, onConnect, onNodeLabelEdit, interactionEnabled)
  const { selectedEdge } = useMermaidEdgeInteraction(svgContainerRef, onEdgeSelect, interactionEnabled)

  const {
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
  } = useMermaidPanZoom(wrapperRef, transformLayerRef, panZoomEnabled, {
    onZoomChange,
    onPanChange,
  })

  const handleWheelRef = useRef(handleWheel)
  useEffect(() => {
    handleWheelRef.current = handleWheel
  }, [handleWheel])

  // Native non-passive wheel listener (React 19 marks onWheel passive by default)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return

    const onWheelNative = (e: WheelEvent) => {
      if (!panZoomEnabled) return
      e.preventDefault()
      handleWheelRef.current?.(e as unknown as React.WheelEvent<HTMLDivElement>)
    }

    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheelNative)
    }
  }, [panZoomEnabled])

  const hasRestoredRef = useRef(false)

  // Restore persisted view state once on mount
  useEffect(() => {
    if (!hasRestoredRef.current && transformLayerRef.current) {
      hasRestoredRef.current = true
      restoreView(initialPanX ?? 0, initialPanY ?? 0, initialZoom ?? 1)
    }
  }, [restoreView, initialPanX, initialPanY, initialZoom])

  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleFullscreen = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    if (!document.fullscreenElement) {
      void wrapper.requestFullscreen()
    } else {
      void document.exitFullscreen()
    }
  }, [])

  // Sync fullscreen state
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handler)
    return () => {
      document.removeEventListener('fullscreenchange', handler)
    }
  }, [])

  // Cleanup on unmount: release SVG nodes and any bound listeners
  useEffect(() => {
    return () => {
      const container = svgContainerRef.current
      if (container) {
        container.innerHTML = ''
      }
    }
  }, [])

  // Inject SVG when result changes
  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return
    if (!result?.svg) {
      container.innerHTML = ''
      return
    }

    // Guardar referencia al SVG anterior para limpiar listeners explícitamente si es necesario
    const previousSvg = container.querySelector('svg')
    if (previousSvg) {
      // innerHTML reemplaza nodos, pero forzamos limpieza de referencias a listeners de Mermaid
      previousSvg.remove()
    }
    container.innerHTML = ''

    // Inyección directa — evita DOMParser + XMLSerializer (mucho más rápido)
    container.innerHTML = result.svg
    const svgEl = container.querySelector('svg')
    if (!svgEl) return

    svgEl.setAttribute('width', '100%')
    svgEl.setAttribute('height', '100%')
    svgEl.style.display = 'block'

    // Inject rough filter if enabled
    if (roughEnabled) {
      let defs = svgEl.querySelector('defs')
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
        svgEl.prepend(defs)
      }
      if (!defs.querySelector('#notia-rough-filter')) {
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
        filter.setAttribute('id', 'notia-rough-filter')
        filter.setAttribute('x', '-20%')
        filter.setAttribute('y', '-20%')
        filter.setAttribute('width', '140%')
        filter.setAttribute('height', '140%')
        filter.innerHTML = `
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
        `
        defs.appendChild(filter)
      }
      svgEl.setAttribute('filter', 'url(#notia-rough-filter)')
    } else {
      svgEl.removeAttribute('filter')
    }

    if (result.bindFunctions) {
      try {
        result.bindFunctions(container)
      } catch {
        // ignore
      }
    }

    if (onSvgInjected) {
      onSvgInjected(container)
    }
  }, [result, roughEnabled, onSvgInjected])

  const isDark = theme === 'dark'
  const gridBackground = gridEnabled
    ? isDark
      ? 'radial-gradient(circle, #46464646 1px, transparent 1px) 0 0 / 20px 20px'
      : 'radial-gradient(circle, #e4e4e48c 1px, transparent 1px) 0 0 / 20px 20px'
    : 'none'

  return (
    <div
      ref={setWrapperRef}
      className="mermaid-canvas-wrapper"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        cursor: panZoomEnabled ? 'grab' : 'default',
        background: gridBackground,
      }}
    >
      {isLoading && !error && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-icon-muted)',
          fontSize: 13,
          pointerEvents: 'none',
          zIndex: 2,
        }}>
          Renderizando...
        </div>
      )}
      {error && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ff5555',
          fontSize: 13,
          padding: 16,
          textAlign: 'center',
          pointerEvents: 'none',
          zIndex: 2,
        }}>
          {error}
        </div>
      )}
      <div
        ref={transformLayerRef}
        style={{ transformOrigin: '0 0', width: '100%', height: '100%', willChange: 'transform', position: 'relative' }}
      >
        <div ref={svgContainerRef} style={{ width: '100%', height: '100%' }} />
        {!error && interactionEnabled && selectedEdge && (
          <MermaidEdgeToolbar
            visible={!!selectedEdge}
            x={selectedEdge.layerX ?? 0}
            y={selectedEdge.layerY ?? 0}
            onTypeChange={(type) => onEdgeTypeChange?.(selectedEdge.fromNodeId, selectedEdge.toNodeId, type)}
            onColorChange={(color) => onEdgeColorChange?.(selectedEdge.fromNodeId, selectedEdge.toNodeId, color)}
            onLabelChange={(label) => onEdgeLabelChange?.(selectedEdge.fromNodeId, selectedEdge.toNodeId, label)}
          />
        )}
      </div>

      {!error && (
        <>
          <MermaidPanZoomToolbar
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={resetView}
            onFit={fitView}
            onFullscreen={handleFullscreen}
            isFullscreen={isFullscreen}
          />
          <MermaidExportMenu result={result} theme={theme} />
        </>
      )}
    </div>
  )
})
MermaidCanvas.displayName = 'MermaidCanvas'
