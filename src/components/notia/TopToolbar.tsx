import type { NotiaIconAction } from '../../types/notia'
import { NotiaButton } from '../common/NotiaButton'

interface TopToolbarProps {
  actions: NotiaIconAction[]
}

export function TopToolbar({ actions }: TopToolbarProps) {
  return (
    <div className="notia-toolbar">
      {actions.map(({ id, label, icon: Icon }) => (
        <NotiaButton key={id} className="notia-toolbar-button" title={label}>
          <Icon size={14} />
        </NotiaButton>
      ))}
    </div>
  )
}
