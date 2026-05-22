import { memo, useState, useEffect, useRef } from 'react'
import { NotiaSubmenuPanel } from '../../../components/notia/NotiaSubmenuPanel'
import { MermaidShapePreview } from './MermaidShapePreview'
import { buildShapePreview } from '../hooks/useMermaidDragGhost'

type ShapeCategory = 'basicas' | 'procesos' | 'tecnicas'

interface MermaidShapeDef {
  name: string
  alias: string
}

/**
 * Solo formas 100% nativas de Mermaid flowchart (v11.3.0+).
 * Documentación: https://mermaid.js.org/syntax/flowchart.html#node-shapes
 * Cualquier forma no documentada ha sido eliminada.
 */
const SHAPES: Record<ShapeCategory, MermaidShapeDef[]> = {
  basicas: [
    { name: 'Texto',            alias: 'text' },
    { name: 'Rectángulo',       alias: 'rect' },
    { name: 'Redondeado',       alias: 'rounded' },
    { name: 'Stadium',          alias: 'stadium' },
    { name: 'Círculo',          alias: 'circle' },
    { name: 'Doble círculo',    alias: 'double-circle' },
    { name: 'Pequeño círculo',  alias: 'small-circle' },
    { name: 'Diamante',         alias: 'diamond' },
    { name: 'Hexágono',         alias: 'hexagon' },
    { name: 'Triángulo',        alias: 'triangle' },
    { name: 'Cilindro',         alias: 'cylinder' },
    { name: 'Paralelogramo',    alias: 'parallelogram' },
    { name: 'Paralelogramo alt',alias: 'parallelogram-alt' },
    { name: 'Trapezoide',       alias: 'trapezoid' },
    { name: 'Trapezoide inv',   alias: 'inv-trapezoid' },
    { name: 'Bandera',          alias: 'flag' },
    { name: 'Nube',             alias: 'cloud' },
    { name: 'Odd',              alias: 'odd' },
    { name: 'Bang',             alias: 'bang' },
  ],
  procesos: [
    { name: 'Subrutina',        alias: 'subroutine' },
    { name: 'Base de datos',    alias: 'database' },
    { name: 'Fork/Join',        alias: 'fork' },
    { name: 'Collate',          alias: 'collate' },
    { name: 'Divided process',  alias: 'divided-process' },
    { name: 'Delay',            alias: 'delay' },
    { name: 'Lean right',       alias: 'lean-right' },
    { name: 'Lean left',        alias: 'lean-left' },
    { name: 'Multi process',    alias: 'mult-process' },
    { name: 'Lined rectangle',  alias: 'lin-rect' },
    { name: 'Documentos',       alias: 'docs' },
    { name: 'Crossed circle',   alias: 'cross-circ' },
    { name: 'Card',             alias: 'notch-rect' },
    { name: 'Brace left',       alias: 'brace-l' },
    { name: 'Brace right',      alias: 'brace-r' },
    { name: 'Braces',           alias: 'braces' },
    { name: 'Curved trapezoid', alias: 'curved-trap' },
  ],
  tecnicas: [
    { name: 'Horizontal cylinder', alias: 'h-cylinder' },
    { name: 'Datastore',          alias: 'datastore' },
    { name: 'DAS',                alias: 'das' },
    { name: 'Disk',               alias: 'disk' },
    { name: 'Lightning bolt',     alias: 'lightning-bolt' },
    { name: 'Bow tie rectangle',  alias: 'bow-rect' },
    { name: 'Documento',          alias: 'doc' },
    { name: 'Lined document',     alias: 'lin-doc' },
    { name: 'Tagged document',    alias: 'tag-doc' },
    { name: 'Tagged rectangle',   alias: 'tag-rect' },
    { name: 'Manual input',       alias: 'manual-input' },
    { name: 'Manual file',        alias: 'manual-file' },
    { name: 'Internal storage',   alias: 'internal-storage' },
    { name: 'Loop limit',         alias: 'loop-limit' },
    { name: 'Junction',           alias: 'junction' },
    { name: 'Stored data',        alias: 'stored-data' },
    { name: 'Framed circle',      alias: 'framed-circle' },
    { name: 'Framed rectangle',   alias: 'framed-rectangle' },
  ],
}

interface MermaidShapesMenuProps {
  panelRef: React.RefObject<HTMLDivElement | null>
  triggerRef: React.RefObject<HTMLButtonElement | null>
  onShapeSelect: (alias: string) => void
  onShapeDragStart?: (alias: string, previewHtml: string, e: PointerEvent) => void
}

const DRAG_THRESHOLD_PX = 5

export const MermaidShapesMenu = memo(function MermaidShapesMenu({
  panelRef,
  triggerRef,
  onShapeSelect,
  onShapeDragStart,
}: MermaidShapesMenuProps) {
  const [activeTab, setActiveTab] = useState<ShapeCategory>('basicas')
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const onShapeSelectRef = useRef(onShapeSelect)
  onShapeSelectRef.current = onShapeSelect
  const onShapeDragStartRef = useRef(onShapeDragStart)
  onShapeDragStartRef.current = onShapeDragStart

  const dragRef = useRef<{
    alias: string
    previewHtml: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)

  useEffect(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const panelWidth = 260
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - panelWidth / 2),
      window.innerWidth - panelWidth - 12,
    )
    setPosition({
      top: rect.bottom + 8,
      left,
    })
  }, [triggerRef])

  // Global drag detection: pointermove crosses threshold → real drag
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const state = dragRef.current
      if (!state || state.active) return
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        state.active = true
        onShapeDragStartRef.current?.(state.alias, state.previewHtml, e)
      }
    }

    const onPointerUp = () => {
      const state = dragRef.current
      if (!state) return
      if (!state.active) {
        // It was a click, not a drag
        onShapeSelectRef.current(state.alias)
      }
      dragRef.current = null
    }

    const onPointerCancel = () => {
      dragRef.current = null
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])

  return (
    <NotiaSubmenuPanel
      ref={panelRef}
      className="mermaid-shapes-menu"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 260,
        maxHeight: 400,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 50,
      }}
    >
      {/* Tabs */}
      <div className="mermaid-shapes-menu-tabs">
        {(['basicas', 'procesos', 'tecnicas'] as ShapeCategory[]).map((cat) => (
          <button
            key={cat}
            className={`mermaid-shapes-menu-tab${activeTab === cat ? ' is-active' : ''}`}
            onClick={() => setActiveTab(cat)}
          >
            {cat === 'basicas' ? 'Básicas' : cat === 'procesos' ? 'Procesos' : 'Técnicas'}
          </button>
        ))}
      </div>

      {/* Grid de formas */}
      <div className="mermaid-shapes-menu-grid">
        {SHAPES[activeTab].map((shape) => (
          <div
            key={shape.alias}
            className="mermaid-shapes-menu-item"
            title={shape.name}
            onPointerDown={(e) => {
              e.preventDefault()
              dragRef.current = {
                alias: shape.alias,
                previewHtml: buildShapePreview(shape.alias),
                startX: e.clientX,
                startY: e.clientY,
                active: false,
              }
            }}
          >
            <MermaidShapePreview alias={shape.alias} size={44} />
          </div>
        ))}
      </div>
    </NotiaSubmenuPanel>
  )
})
MermaidShapesMenu.displayName = 'MermaidShapesMenu'
