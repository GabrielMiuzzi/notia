import { memo } from 'react'
import type { ReactNode } from 'react'
import type { MermaidShapeType } from '../types/mermaidTypes'

interface ShapeOption {
  type: MermaidShapeType
  label: string
  svg: ReactNode
}

const SHAPE_OPTIONS: ShapeOption[] = [
  {
    type: 'rect',
    label: 'Rectángulo',
    svg: (
      <svg width="28" height="28" viewBox="0 0 28 28">
        <rect x="3" y="7" width="22" height="14" rx="3" fill="currentColor" opacity="0.25" />
      </svg>
    ),
  },
  {
    type: 'circle',
    label: 'Círculo',
    svg: (
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="10" fill="currentColor" opacity="0.25" />
      </svg>
    ),
  },
  {
    type: 'diamond',
    label: 'Rombo',
    svg: (
      <svg width="28" height="28" viewBox="0 0 28 28">
        <polygon points="14,3 25,14 14,25 3,14" fill="currentColor" opacity="0.25" />
      </svg>
    ),
  },
  {
    type: 'cylinder',
    label: 'Cilindro',
    svg: (
      <svg width="28" height="28" viewBox="0 0 28 28">
        <ellipse cx="14" cy="7" rx="11" ry="4" fill="currentColor" opacity="0.25" />
        <rect x="3" y="7" width="22" height="14" fill="currentColor" opacity="0.25" />
        <ellipse cx="14" cy="21" rx="11" ry="4" fill="currentColor" opacity="0.25" />
      </svg>
    ),
  },
]

interface MermaidShapePaletteProps {
  selectedShape: MermaidShapeType | null
  onSelectShape: (shape: MermaidShapeType | null) => void
  onDragStartShape: (shape: MermaidShapeType) => void
}

export const MermaidShapePalette = memo(function MermaidShapePalette({
  selectedShape,
  onSelectShape,
  onDragStartShape,
}: MermaidShapePaletteProps) {
  return (
    <div className="mermaid-shape-palette">
      <div className="mermaid-shape-palette-title" style={{ marginBottom: 8 }}>Formas</div>
      {SHAPE_OPTIONS.map((option) => (
        <button
          key={option.type}
          type="button"
          className={`mermaid-shape-item ${selectedShape === option.type ? 'mermaid-shape-item--active' : ''}`}
          draggable
          onClick={() => {
            onSelectShape(selectedShape === option.type ? null : option.type)
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData('shape', option.type)
            onDragStartShape(option.type)
          }}
        >
          <div className="mermaid-shape-preview">{option.svg}</div>
          <span className="mermaid-shape-label">{option.label}</span>
        </button>
      ))}
      {selectedShape && (
        <div style={{ fontSize: 11, color: 'var(--color-icon-muted)', marginTop: 8, textAlign: 'center' }}>
          Hacé clic en el canvas para colocar
        </div>
      )}
    </div>
  )
})
MermaidShapePalette.displayName = 'MermaidShapePalette'
