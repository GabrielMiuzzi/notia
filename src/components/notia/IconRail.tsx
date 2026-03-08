import type { NotiaIconAction } from '../../types/notia'

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
        <button
          key={id}
          type="button"
          aria-label={label}
          title={label}
          className={`notia-icon-button notia-icon-button--${id} ${
            active || activeActionId === id ? 'notia-icon-button--active' : ''
          }`}
          onClick={() => onActionClick?.(id)}
        >
          <Icon size={16} strokeWidth={2} />
        </button>
      ))}
    </div>
  )
}
