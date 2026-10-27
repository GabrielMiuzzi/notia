import { Files, ListChecks, Waypoints } from 'lucide-react'
import type { ReactNode } from 'react'

export type PublishedView = 'tasks' | 'graph'

interface PublishedRailProps {
  activeView: PublishedView
  isExplorerOpen: boolean
  onToggleExplorer: () => void
  onSelectView: (view: PublishedView) => void
}

const ICON_SIZE = 18
const ICON_STROKE = 1.85

function RailButton({ label, isActive, pressed, onClick, children }: { label: string; isActive?: boolean; pressed?: boolean; onClick: () => void; children: ReactNode }) {
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

/** The left rail of the published page: the explorer, the board and the graph. */
export function PublishedRail({ activeView, isExplorerOpen, onToggleExplorer, onSelectView }: PublishedRailProps) {
  return (
    <nav className="notia-rail pub-rail" aria-label="Módulos">
      <RailButton label="Explorador" isActive={isExplorerOpen} pressed={isExplorerOpen} onClick={onToggleExplorer}>
        <Files size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </RailButton>
      <RailButton label="Tareas" isActive={activeView === 'tasks'} onClick={() => onSelectView('tasks')}>
        <ListChecks size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </RailButton>
      <RailButton label="Grafo" isActive={activeView === 'graph'} onClick={() => onSelectView('graph')}>
        <Waypoints size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </RailButton>
    </nav>
  )
}
