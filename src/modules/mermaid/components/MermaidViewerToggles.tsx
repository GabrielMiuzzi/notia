import { memo } from 'react'
import { Grid3X3, Pencil, Move } from 'lucide-react'

interface MermaidViewerTogglesProps {
  gridEnabled: boolean
  roughEnabled: boolean
  panZoomEnabled: boolean
  onToggleGrid: () => void
  onToggleRough: () => void
  onTogglePanZoom: () => void
  theme: string
  onThemeChange: (theme: string) => void
}

const THEME_OPTIONS = ['default', 'dark', 'forest', 'base', 'neutral']

export const MermaidViewerToggles = memo(function MermaidViewerToggles({
  gridEnabled,
  roughEnabled,
  panZoomEnabled,
  onToggleGrid,
  onToggleRough,
  onTogglePanZoom,
  theme,
  onThemeChange,
}: MermaidViewerTogglesProps) {
  const buttonStyle = (active: boolean): React.CSSProperties => ({
    height: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--color-accent-text)' : 'var(--color-border-soft)'}`,
    background: active ? 'var(--color-hover-surface)' : 'var(--color-card-bg)',
    color: 'var(--color-app-text)',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    padding: '0 10px',
    fontSize: 12,
    appearance: 'none',
  })

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 10,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
      }}
    >
      <button style={buttonStyle(gridEnabled)} title="Grid de fondo" onClick={onToggleGrid}>
        <Grid3X3 size={13} />
        <span>Grid</span>
      </button>

      <button style={buttonStyle(panZoomEnabled)} title="Pan/Zoom" onClick={onTogglePanZoom}>
        <Move size={13} />
        <span>Pan</span>
      </button>

      <button style={buttonStyle(roughEnabled)} title="Rough mode" onClick={onToggleRough}>
        <Pencil size={13} />
        <span>Rough</span>
      </button>

      <select
        value={theme}
        onChange={(e) => onThemeChange(e.target.value)}
        style={{
          height: 28,
          borderRadius: 6,
          border: '1px solid var(--color-border-soft)',
          background: 'var(--color-card-bg)',
          color: 'var(--color-app-text)',
          fontSize: 12,
          padding: '0 8px',
          cursor: 'pointer',
        }}
      >
        {THEME_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t[0].toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>
    </div>
  )
})
MermaidViewerToggles.displayName = 'MermaidViewerToggles'
