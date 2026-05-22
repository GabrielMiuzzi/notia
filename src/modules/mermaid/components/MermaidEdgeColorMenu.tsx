import { memo, useState, useRef, useCallback } from 'react'
import { NotiaSubmenuPanel } from '../../../components/notia/NotiaSubmenuPanel'

const PRESET_COLORS = [
  '#ff0000', '#ff4500', '#ffa500', '#ffd700',
  '#32cd32', '#008000', '#00ced1', '#1e90ff',
  '#4169e1', '#0000ff', '#8a2be2', '#ff1493',
  '#ff69b4', '#ff6347', '#808080', '#000000',
]

interface MermaidEdgeColorMenuProps {
  visible: boolean
  anchorRect: DOMRect
  onSelect: (color: string) => void
}

export const MermaidEdgeColorMenu = memo(function MermaidEdgeColorMenu({
  visible,
  anchorRect,
  onSelect,
}: MermaidEdgeColorMenuProps) {
  const [inputHex, setInputHex] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleCustom = useCallback(() => {
    const hex = inputHex.trim()
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onSelect(hex.toLowerCase())
      setInputHex('')
    }
  }, [inputHex, onSelect])

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleCustom()
      }
    },
    [handleCustom],
  )

  if (!visible) return null

  const pos = {
    x: anchorRect.left + anchorRect.width / 2,
    y: anchorRect.bottom + 4,
  }

  return (
    <NotiaSubmenuPanel
      className="mermaid-edge-color-menu"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translateX(-50%)',
        zIndex: 60,
        width: 200,
      }}
    >
      <div className="mermaid-edge-color-grid">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className="mermaid-edge-color-swatch"
            style={{ backgroundColor: color }}
            onClick={() => onSelect(color)}
            type="button"
            aria-label={`Color ${color}`}
          />
        ))}
      </div>
      <div className="mermaid-edge-color-custom">
        <input
          ref={inputRef}
          type="text"
          value={inputHex}
          onChange={(e) => setInputHex(e.target.value)}
          onKeyDown={handleKey}
          placeholder="#RRGGBB"
          className="mermaid-edge-color-input"
          maxLength={7}
        />
        <button
          className="mermaid-edge-color-btn"
          onClick={handleCustom}
          type="button"
        >
          OK
        </button>
      </div>
    </NotiaSubmenuPanel>
  )
})
MermaidEdgeColorMenu.displayName = 'MermaidEdgeColorMenu'
