import type { NotiaIconAction } from '../../types/notia'
import { NotiaButton } from '../common/NotiaButton'

interface IconRailProps {
  actions: NotiaIconAction[]
  className?: string
  activeActionId?: string | null
  onActionClick?: (actionId: string) => void
}

export function IconRail({ actions, className, activeActionId, onActionClick }: IconRailProps) {
  return (
    <div className={`notia-icon-rail ${className ?? ''}`.trim()}>
      {actions.map(({ id, icon: Icon, label, active }) => (
        <NotiaButton
          key={id}
          aria-label={label}
          title={label}
          size="icon"
          variant={active || activeActionId === id ? 'primary' : 'secondary'}
          className={`notia-icon-button notia-icon-button--${id} ${
            active || activeActionId === id ? 'notia-icon-button--active' : ''
          }`}
          onClick={() => onActionClick?.(id)}
        >
          <Icon size={16} strokeWidth={2} />
        </NotiaButton>
      ))}
    </div>
  )
}
