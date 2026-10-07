import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MermaidRenderResult } from '../types/mermaidTypes'
import { useMermaidPanZoom } from '../hooks/useMermaidPanZoom'
import { MermaidPanZoomToolbar } from './MermaidPanZoomToolbar'
import { MermaidExportMenu } from './MermaidExportMenu'

/**
 * A rendered Mermaid diagram that can be panned, zoomed, shown full screen
 * and exported. Markdown notes show their `mermaid` blocks with it; `.mmd`
 * files open in the editor (`editor/MermaidEditorView`).
 */

interface MermaidCanvasProps {
  result: MermaidRenderResult | null
  isLoading: boolean
  error: string | null
  gridEnabled: boolean
  panZoomEnabled: boolean
  theme: string
  roughEnabled?: boolean
  initialZoom?: number
  initialPanX?: number
  initialPanY?: number
}

function MermaidCanvasComponent({
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
}: MermaidCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const transformLayerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)

  const panZoomCallbacks = useMemo(() => ({}), [])
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
  } = useMermaidPanZoom(wrapperRef, transformLayerRef, panZoomEnabled, panZoomCallbacks)

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
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Inject the SVG when the result changes
  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return
    container.innerHTML = ''
    if (!result?.svg) return
    container.innerHTML = result.svg
    const svgEl = container.querySelector('svg')
    if (!svgEl) return
    svgEl.setAttribute('width', '100%')
    svgEl.setAttribute('height', '100%')
    svgEl.style.display = 'block'

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

    try {
      result.bindFunctions?.(container)
    } catch {
      // ignore
    }
  }, [result, roughEnabled])

  const isDark = theme === 'dark'
  const gridBackground = gridEnabled
    ? isDark
      ? 'radial-gradient(circle, #46464646 1px, transparent 1px) 0 0 / 20px 20px'
      : 'radial-gradient(circle, #e4e4e48c 1px, transparent 1px) 0 0 / 20px 20px'
    : 'none'

  return (
    <div
      ref={wrapperRef}
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
          color: 'var(--color-coral)',
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
        style={{ transformOrigin: '0 0', width: '100%', height: '100%', position: 'relative' }}
      >
        <div ref={svgContainerRef} style={{ width: '100%', height: '100%' }} />
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
}

export const MermaidCanvas = memo(MermaidCanvasComponent)
MermaidCanvas.displayName = 'MermaidCanvas'
