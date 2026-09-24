import { Fragment, memo, type ReactNode } from 'react'
import { CircleHelp, Files, Settings } from 'lucide-react'
import type { NotiaIconAction } from '../../types/notia'

interface IconRailProps {
  groups: NotiaIconAction[][]
  activeActionId: string | null
  isExplorerOpen: boolean
  onActionClick: (actionId: string) => void
  onToggleExplorer: () => void
  onOpenSettings: () => void
}

interface RailButtonProps {
  label: string
  isActive?: boolean
  pressed?: boolean
  onClick?: () => void
  children: ReactNode
}

const RAIL_ICON_SIZE = 18
const RAIL_ICON_STROKE = 1.75

function RailButton({ label, isActive = false, pressed, onClick, children }: RailButtonProps) {
  return (
    <button
      type="button"
      className={`notia-rail-button${isActive ? ' notia-rail-button--active' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-current={pressed === undefined && isActive ? 'page' : undefined}
      data-tip={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function IconRailComponent({
  groups,
  activeActionId,
  isExplorerOpen,
  onActionClick,
  onToggleExplorer,
  onOpenSettings,
}: IconRailProps) {
  return (
    <nav className="notia-rail" aria-label="Menú principal" data-notia-prevent-menu-close>
      <RailButton label="Explorador" isActive={isExplorerOpen} pressed={isExplorerOpen} onClick={onToggleExplorer}>
        <Files size={RAIL_ICON_SIZE} strokeWidth={RAIL_ICON_STROKE} />
      </RailButton>
      {groups.map((group) => (
        <Fragment key={group[0]?.id}>
          <div className="notia-rail-separator" role="separator" />
          {group.map(({ id, icon: Icon, label }) => (
            <RailButton key={id} label={label} isActive={activeActionId === id} onClick={() => onActionClick(id)}>
              <Icon size={RAIL_ICON_SIZE} strokeWidth={RAIL_ICON_STROKE} />
            </RailButton>
          ))}
        </Fragment>
      ))}
      <div className="notia-rail-spacer" />
      <RailButton label="Ayuda">
        <CircleHelp size={RAIL_ICON_SIZE} strokeWidth={RAIL_ICON_STROKE} />
      </RailButton>
      <RailButton label="Configuración" onClick={onOpenSettings}>
        <Settings size={RAIL_ICON_SIZE} strokeWidth={RAIL_ICON_STROKE} />
      </RailButton>
    </nav>
  )
}

export const IconRail = memo(IconRailComponent)
IconRail.displayName = 'IconRail'
