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
  if (!open) {
    return null
  }

  return (
    <div
      className="notia-tree-context-menu"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
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
