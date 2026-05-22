import { memo } from 'react'
import { ZoomIn, ZoomOut, RotateCcw, Maximize, Minimize, Expand } from 'lucide-react'

interface MermaidPanZoomToolbarProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
  onFullscreen: () => void
  isFullscreen: boolean
}

export const MermaidPanZoomToolbar = memo(function MermaidPanZoomToolbar({
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onFullscreen,
  isFullscreen,
}: MermaidPanZoomToolbarProps) {
  const buttonStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: '1px solid var(--color-border-soft)',
    background: 'var(--color-card-bg)',
    color: 'var(--color-app-text)',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    padding: 0,
    appearance: 'none',
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-border-soft)',
        borderRadius: 8,
        padding: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <button style={buttonStyle} title="Acercar" onClick={onZoomIn}><ZoomIn size={14} /></button>
      <button style={buttonStyle} title="Alejar" onClick={onZoomOut}><ZoomOut size={14} /></button>
      <button style={buttonStyle} title="Ajustar al canvas" onClick={onFit}><Expand size={14} /></button>
      <button style={buttonStyle} title="Restablecer vista" onClick={onReset}><RotateCcw size={14} /></button>
      <button style={buttonStyle} title="Pantalla completa" onClick={onFullscreen}>
        {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
      </button>
    </div>
  )
})
MermaidPanZoomToolbar.displayName = 'MermaidPanZoomToolbar'
