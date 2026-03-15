import { useLayoutEffect, useRef, useState } from 'react'
import { NotiaButton } from '../common/NotiaButton'

interface ContextMenuPosition {
  x: number
  y: number
}

interface ContextMenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
}

interface FileTreeContextMenuProps {
  open: boolean
  position: ContextMenuPosition
  items: ContextMenuItem[]
  onAction: (id: string) => void
}

export function FileTreeContextMenu({ open, position, items, onAction }: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [resolvedPosition, setResolvedPosition] = useState<ContextMenuPosition>(position)

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const menu = menuRef.current
    if (!menu) {
      setResolvedPosition(position)
      return
    }

    const margin = 8
    const menuRect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const nextX = Math.min(
      Math.max(position.x, margin),
      Math.max(margin, viewportWidth - menuRect.width - margin),
    )

    const opensUpward = position.y + menuRect.height > viewportHeight - margin
    const nextY = opensUpward
      ? Math.max(margin, position.y - menuRect.height)
      : Math.min(position.y, Math.max(margin, viewportHeight - menuRect.height - margin))

    setResolvedPosition((current) => {
      if (current.x === nextX && current.y === nextY) {
        return current
      }
      return { x: nextX, y: nextY }
    })
  }, [items, open, position])

  if (!open) {
    return null
  }

  return (
    <div
      ref={menuRef}
      className="notia-tree-context-menu"
      style={{ left: `${resolvedPosition.x}px`, top: `${resolvedPosition.y}px` }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <NotiaButton
          key={item.id}
          className={`notia-tree-context-item ${item.danger ? 'notia-tree-context-item--danger' : ''}`}
          variant={item.danger ? 'danger' : 'secondary'}
          disabled={item.disabled}
          onClick={() => onAction(item.id)}
        >
          {item.label}
        </NotiaButton>
      ))}
    </div>
  )
}
