import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Grid3x3, Maximize2, Minus, PenLine, Plus, X } from 'lucide-react'
import { useMermaidRender } from '../hooks/useMermaidRender'
import { useMermaidPanZoom } from '../hooks/useMermaidPanZoom'
import { linkEndAt, messageIndexBelow, selectionAt, selectionElements } from './diagramSvg'
import { PathIcon } from './editorParts'
import { THEMES } from './diagramMeta'
import type { DiagramKind, DiagramSelection, MermaidModel } from './mermaidEditorTypes'

/*
 * The canvas: the diagram Mermaid draws, panned and zoomed, with the
 * selection drawn over it, the tool bar, the floating menu of the
 * selection, and the view controls.
 */

export interface StageTool {
  id: string
  label: string
  shortcut?: string
  icon: string
  /** Runs at once (adds an element); without it the tool links two elements. */
  run?: () => void
}

export interface LinkState {
  from: string
  extra?: Record<string, unknown>
}

interface MermaidStageProps {
  code: string
  kind: DiagramKind | null
  model: MermaidModel | null
  selection: DiagramSelection | null
  onSelect: (selection: DiagramSelection | null) => void
  tools: StageTool[]
  link: LinkState | null
  onLinkStart: (from: string) => void
  onLinkEnd: (to: string, before?: number) => void
  onLinkCancel: () => void
  /** The floating menu of the selection. */
  contextMenu: ReactNode
  engineTheme: string
  theme: string
  onThemeChange: (theme: string) => void
  grid: boolean
  onGridChange: (grid: boolean) => void
  handDrawn: boolean
  onHandDrawnChange: (handDrawn: boolean) => void
  /** State and class diagrams show their direction here. */
  direction?: { value: string; options: Array<{ id: string; name: string }>; onChange: (value: string) => void }
  onRenderError: (error: string | null) => void
  /** The name of where a link starts. */
  linkLabel: string
  empty: ReactNode
}

const TAP_DISTANCE = 6

export function MermaidStage(props: MermaidStageProps) {
  const { code, kind, model, selection, onSelect, tools, link, onLinkStart, onLinkEnd, onLinkCancel, contextMenu, engineTheme, theme, onThemeChange, grid, onGridChange, handDrawn, onHandDrawnChange, direction, onRenderError, linkLabel, empty } = props
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const downRef = useRef<{ target: Element; x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [viewVersion, setViewVersion] = useState(0)
  const [injected, setInjected] = useState(0)
  const [tool, setTool] = useState('select')
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number; place: 'above' | 'below' | 'center' } | null>(null)

  const config = useMemo(() => JSON.stringify({ securityLevel: 'loose', look: handDrawn ? 'handDrawn' : 'classic' }), [handDrawn])
  const { result, error } = useMermaidRender({ code, config, theme: engineTheme })
  useEffect(() => onRenderError(error), [error, onRenderError])

  const callbacks = useMemo(() => ({
    onZoomChange: (next: number) => {
      setZoom(next)
      setViewVersion((value) => value + 1)
    },
    onPanChange: () => setViewVersion((value) => value + 1),
  }), [])
  const panZoom = useMermaidPanZoom(viewportRef, layerRef, true, callbacks)

  // Native, non-passive wheel listener (React marks onWheel passive).
  const wheelRef = useRef(panZoom.handleWheel)
  wheelRef.current = panZoom.handleWheel
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      wheelRef.current(event as unknown as React.WheelEvent<HTMLDivElement>)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  // The drawing; a failed render keeps the last good one.
  useEffect(() => {
    const container = svgRef.current
    if (!container || !result?.svg) {
      if (container && !code.trim()) container.innerHTML = ''
      return
    }
    container.innerHTML = result.svg
    // Its own size, centered; a diagram larger than the canvas shrinks to fit.
    const svg = container.querySelector('svg')
    if (svg) {
      const box = svg.viewBox?.baseVal
      if (box?.width && box.height) {
        svg.setAttribute('width', String(box.width))
        svg.setAttribute('height', String(box.height))
      }
      svg.style.maxWidth = '100%'
      svg.style.maxHeight = '100%'
    }
    try {
      result.bindFunctions?.(container)
    } catch {
      // ignore
    }
    setInjected((value) => value + 1)
  }, [code, result])

  // The selection and the start of a link, marked on the drawing.
  useLayoutEffect(() => {
    const container = svgRef.current
    if (!container || !kind) return
    container.querySelectorAll('.mmd-selected, .mmd-link-source').forEach((element) => element.classList.remove('mmd-selected', 'mmd-link-source'))
    const selected = selection ? selectionElements(container, kind, selection) : []
    selected.forEach((element) => element.classList.add('mmd-selected'))
    if (link) {
      const sourceKind: DiagramSelection['kind'] = kind === 'flowchart' ? 'node' : kind === 'sequence' ? 'participant' : kind === 'state' ? 'state' : kind === 'class' ? 'class' : 'entity'
      selectionElements(container, kind, { kind: sourceKind, key: link.from }).forEach((element) => element.classList.add('mmd-link-source'))
    }
    // The floating menu goes over a link, above (or below) a box.
    const stage = stageRef.current
    if (!stage || selected.length === 0 || link) {
      setMenuPosition(null)
      return
    }
    const stageRect = stage.getBoundingClientRect()
    const rects = selected.map((element) => element.getBoundingClientRect()).filter((rect) => rect.width > 0 || rect.height > 0)
    if (rects.length === 0) {
      setMenuPosition(null)
      return
    }
    const left = Math.min(...rects.map((rect) => rect.left))
    const right = Math.max(...rects.map((rect) => rect.right))
    const top = Math.min(...rects.map((rect) => rect.top)) - stageRect.top
    const bottom = Math.max(...rects.map((rect) => rect.bottom)) - stageRect.top
    const x = Math.min(Math.max((left + right) / 2 - stageRect.left, 180), stageRect.width - 180)
    // Links get their menu over them; boxes above (or below, near the tool bar).
    const linkish = selection ? ['edge', 'message', 'transition', 'relation'].includes(selection.kind) : false
    if (linkish) setMenuPosition({ x, y: Math.min(Math.max((top + bottom) / 2, 90), stageRect.height - 90), place: 'center' })
    else if (top - 12 < 110) setMenuPosition({ x, y: Math.min(bottom + 12, stageRect.height - 120), place: 'below' })
    else setMenuPosition({ x, y: top - 12, place: 'above' })
  }, [injected, kind, link, selection, viewVersion])

  const tap = useCallback((target: Element, clientY: number) => {
    const container = svgRef.current
    if (!container || !kind || !model) return
    if (link) {
      const end = linkEndAt(container, target, kind, model)
      if (end) onLinkEnd(end, kind === 'sequence' ? messageIndexBelow(container, clientY) : undefined)
      return
    }
    const activeTool = tools.find((candidate) => candidate.id === tool)
    if (activeTool && !activeTool.run && tool !== 'select' && tool !== 'pan') {
      const from = linkEndAt(container, target, kind, model)
      if (from && from !== '[*]') onLinkStart(from)
      return
    }
    onSelect(selectionAt(container, target, kind, model))
  }, [kind, link, model, onLinkEnd, onLinkStart, onSelect, tool, tools])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    downRef.current = { target: event.target as Element, x: event.clientX, y: event.clientY }
    panZoom.handlePointerDown(event)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const down = downRef.current
    downRef.current = null
    panZoom.handlePointerUp(event)
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_DISTANCE && tool !== 'pan') tap(down.target, event.clientY)
  }

  const pickTool = (candidate: StageTool) => {
    if (candidate.run) {
      candidate.run()
      setTool('select')
      return
    }
    setTool(candidate.id)
    if (candidate.id !== 'select' && candidate.id !== 'pan' && selection && ['node', 'participant', 'state', 'class', 'entity'].includes(selection.kind)) {
      onLinkStart(selection.key)
    }
  }

  useEffect(() => {
    if (!link && tool !== 'select' && tool !== 'pan' && !tools.find((candidate) => candidate.id === tool)) setTool('select')
  }, [link, tool, tools])

  const linking = Boolean(link) || (tool !== 'select' && tool !== 'pan')

  return (
    <main
      ref={stageRef}
      className="mmd-stage"
      data-grid={grid ? 'true' : 'false'}
      data-tool={tool}
      data-linking={linking ? 'true' : 'false'}
      aria-label="Lienzo del diagrama"
    >
      <div
        ref={viewportRef}
        className="mmd-stage-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={panZoom.handlePointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={panZoom.handlePointerCancel}
      >
        <div ref={layerRef} className="mmd-stage-layer">
          <div ref={svgRef} className="mmd-stage-svg" />
        </div>
      </div>
      {!code.trim() ? <div className="mmd-stage-empty">{empty}</div> : null}
      {error && code.trim() ? <div className="mmd-stage-error" role="alert">{error}</div> : null}

      {tools.length ? (
        <div className="mmd-floating-bar mmd-tools" role="toolbar" aria-label="Herramientas">
          {tools.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="mmd-icon-button"
              aria-pressed={candidate.run ? undefined : tool === candidate.id}
              aria-label={candidate.label}
              title={candidate.shortcut ? `${candidate.label} (${candidate.shortcut})` : candidate.label}
              onClick={() => pickTool(candidate)}
            >
              <PathIcon d={candidate.icon} size={17} />
            </button>
          ))}
        </div>
      ) : null}

      {link ? (
        <div className="mmd-floating-bar mmd-linking-banner" role="status">
          <span>Enlazando desde <strong>{linkLabel}</strong> · tocá el destino</span>
          <button type="button" className="mmd-ghost-button" style={{ minHeight: 30 }} onClick={() => { onLinkCancel(); setTool('select') }}>
            <X size={13} aria-hidden="true" />Cancelar
          </button>
        </div>
      ) : null}

      {menuPosition && contextMenu ? (
        <div className="mmd-context-menu" role="toolbar" aria-label="Opciones de la selección" data-place={menuPosition.place} style={{ left: menuPosition.x, top: menuPosition.y }} onPointerDown={(event) => event.stopPropagation()}>
          {contextMenu}
        </div>
      ) : null}

      <div className="mmd-floating-bar mmd-view-controls">
        <button type="button" className="mmd-toggle" aria-pressed={grid} onClick={() => onGridChange(!grid)}><Grid3x3 size={15} aria-hidden="true" />Grilla</button>
        {kind === 'flowchart' || kind === 'state' ? (
          <button type="button" className="mmd-toggle" aria-pressed={handDrawn} onClick={() => onHandDrawnChange(!handDrawn)}><PenLine size={15} aria-hidden="true" />A mano</button>
        ) : null}
        <span className="mmd-bar-divider" />
        {direction ? (
          <label>
            <span>Dirección</span>
            <select className="mmd-select" value={direction.value} onChange={(event) => direction.onChange(event.target.value)}>
              {direction.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        ) : (
          <label>
            <span>Tema</span>
            <select className="mmd-select" value={theme} onChange={(event) => onThemeChange(event.target.value)}>
              {THEMES.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="mmd-floating-bar mmd-zoom-controls">
        <button type="button" className="mmd-icon-button" style={{ width: 30, height: 30 }} aria-label="Alejar" onClick={panZoom.zoomOut}><Minus size={15} aria-hidden="true" /></button>
        <button type="button" className="mmd-zoom-label" aria-label="Restablecer zoom" onClick={panZoom.resetView}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="mmd-icon-button" style={{ width: 30, height: 30 }} aria-label="Acercar" onClick={panZoom.zoomIn}><Plus size={15} aria-hidden="true" /></button>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" style={{ width: 30, height: 30 }} aria-label="Ajustar a la pantalla" title="Ajustar" onClick={panZoom.resetView}><Maximize2 size={15} aria-hidden="true" /></button>
      </div>
      <span className="mmd-sr" aria-live="polite">{tool !== 'select' ? `Herramienta: ${tools.find((candidate) => candidate.id === tool)?.label ?? ''}` : ''}</span>
    </main>
  )
}
