import { memo } from 'react'
import { NotiaSubmenuPanel } from '../../../components/notia/NotiaSubmenuPanel'
import type { MermaidEdgeType } from '../types/mermaidTypes'

const EDGE_TYPES: { type: MermaidEdgeType; name: string }[] = [
  { type: 'arrow', name: 'Flecha' },
  { type: 'open', name: 'Abierta' },
  { type: 'dotted', name: 'Punteada' },
  { type: 'dottedArrow', name: 'Punteada con flecha' },
  { type: 'thick', name: 'Gruesa' },
  { type: 'thickArrow', name: 'Gruesa con flecha' },
  { type: 'circle', name: 'Círculo' },
  { type: 'cross', name: 'Cruz' },
  { type: 'invisible', name: 'Invisible' },
]

interface MermaidEdgeTypeMenuProps {
  visible: boolean
  anchorRect: DOMRect
  onSelect: (type: MermaidEdgeType) => void
}

function MiniEdgeSvg({ type }: { type: MermaidEdgeType }) {
  const strokeWidth = type.startsWith('thick') ? 3 : 1.5
  const strokeDasharray = type.startsWith('dotted')
    ? '3,2'
    : type === 'invisible'
      ? '2,4'
      : undefined
  const opacity = type === 'invisible' ? 0.35 : 1
  const isArrow = type === 'arrow' || type === 'dottedArrow' || type === 'thickArrow'

  return (
    <svg width="32" height="16" viewBox="0 0 32 16" style={{ opacity, flexShrink: 0 }}>
      <line
        x1="2"
        y1="8"
        x2={isArrow ? '24' : '30'}
        y2="8"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="round"
      />
      {isArrow && (
        <polygon points="22,4 30,8 22,12" fill="currentColor" />
      )}
      {type === 'circle' && (
        <circle cx="28" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
      )}
      {type === 'cross' && (
        <>
          <line x1="25" y1="5" x2="31" y2="11" stroke="currentColor" strokeWidth={1.5} />
          <line x1="31" y1="5" x2="25" y2="11" stroke="currentColor" strokeWidth={1.5} />
        </>
      )}
    </svg>
  )
}

export const MermaidEdgeTypeMenu = memo(function MermaidEdgeTypeMenu({
  visible,
  anchorRect,
  onSelect,
}: MermaidEdgeTypeMenuProps) {
  if (!visible) return null

  const pos = {
    x: anchorRect.left + anchorRect.width / 2,
    y: anchorRect.bottom + 4,
  }

  return (
    <NotiaSubmenuPanel
      className="mermaid-edge-type-menu"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translateX(-50%)',
        zIndex: 60,
        minWidth: 170,
      }}
    >
      {EDGE_TYPES.map((item) => (
        <button
          key={item.type}
          className="mermaid-edge-type-item"
          onClick={() => onSelect(item.type)}
          type="button"
        >
          <span className="mermaid-edge-type-preview">
            <MiniEdgeSvg type={item.type} />
          </span>
          <span className="mermaid-edge-type-name">{item.name}</span>
        </button>
      ))}
    </NotiaSubmenuPanel>
  )
})
MermaidEdgeTypeMenu.displayName = 'MermaidEdgeTypeMenu'
