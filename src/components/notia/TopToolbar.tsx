import type { NotiaIconAction } from '../../types/notia'

interface TopToolbarProps {
  actions: NotiaIconAction[]
}

export function TopToolbar({ actions }: TopToolbarProps) {
  return (
    <div className="notia-toolbar">
      {actions.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className="notia-toolbar-button" title={label}>
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
