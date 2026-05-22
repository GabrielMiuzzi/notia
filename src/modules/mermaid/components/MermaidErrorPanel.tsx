import { memo } from 'react'

interface MermaidErrorPanelProps {
  error: string | null
}

export const MermaidErrorPanel = memo(function MermaidErrorPanel({ error }: MermaidErrorPanelProps) {
  if (!error) return null

  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'rgba(255, 85, 85, 0.08)',
        borderTop: '1px solid rgba(255, 85, 85, 0.25)',
        color: '#ff5555',
        fontSize: 12,
        fontFamily: '"JetBrains Mono", monospace',
        lineHeight: 1.5,
        maxHeight: 120,
        overflow: 'auto',
        flexShrink: 0,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Error de sintaxis</div>
      <div>{error}</div>
    </div>
  )
})
MermaidErrorPanel.displayName = 'MermaidErrorPanel'
