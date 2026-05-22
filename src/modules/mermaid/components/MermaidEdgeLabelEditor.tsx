import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { NotiaSubmenuPanel } from '../../../components/notia/NotiaSubmenuPanel'

interface MermaidEdgeLabelEditorProps {
  visible: boolean
  anchorRect: DOMRect
  label: string
  onConfirm: (label: string) => void
  onCancel: () => void
}

export const MermaidEdgeLabelEditor = memo(function MermaidEdgeLabelEditor({
  visible,
  anchorRect,
  label,
  onConfirm,
  onCancel,
}: MermaidEdgeLabelEditorProps) {
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(label)
  }, [label])

  useEffect(() => {
    if (visible) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [visible])

  const handleConfirm = useCallback(() => {
    onConfirm(value.trim())
  }, [value, onConfirm])

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [handleConfirm, onCancel],
  )

  if (!visible) return null

  const pos = {
    x: anchorRect.left + anchorRect.width / 2,
    y: anchorRect.bottom + 4,
  }

  return (
    <NotiaSubmenuPanel
      className="mermaid-edge-label-editor"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        transform: 'translateX(-50%)',
        zIndex: 60,
        width: 220,
        display: 'flex',
        gap: 6,
        padding: '6px 8px',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Texto de la línea"
        className="mermaid-edge-label-input"
        maxLength={80}
      />
      <button
        className="mermaid-edge-label-btn"
        onClick={handleConfirm}
        type="button"
      >
        OK
      </button>
      <button
        className="mermaid-edge-label-btn"
        onClick={onCancel}
        type="button"
      >
        ×
      </button>
    </NotiaSubmenuPanel>
  )
})
MermaidEdgeLabelEditor.displayName = 'MermaidEdgeLabelEditor'
