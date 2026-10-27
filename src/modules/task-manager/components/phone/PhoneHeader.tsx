import type { ReactNode } from 'react'
import type { TaskBoardViewMode } from '../../services/taskManagerStorage'
import { PhoneIcon, type PhoneIconName } from './phoneIcons'

interface PhoneHeaderProps {
  boardName: string
  boardColor: string
  /** Active tasks of the board, next to its name; none hides it. */
  boardCount: number | null
  onOpenBoards: () => void
  /** «Buscar»: none hides the button (Management). */
  search?: {
    open: boolean
    query: string
    resultLabel: string | null
    onToggle: () => void
    onChange: (query: string) => void
  }
  /** «Editar tablero»: none when the board cannot be edited here. */
  onEditBoard?: () => void
  viewMode: TaskBoardViewMode
  onViewModeChange: (mode: TaskBoardViewMode) => void
  /** Column chips or quick filters under the views. */
  children?: ReactNode
}

const VIEWS: Array<{ mode: TaskBoardViewMode; label: string; icon: PhoneIconName }> = [
  { mode: 'board', label: 'Tablero', icon: 'board' },
  { mode: 'list', label: 'Lista', icon: 'list' },
  { mode: 'management', label: 'Management', icon: 'management' },
]

/** Board, search and settings; the three views; then what the view adds. */
export function PhoneHeader({
  boardName,
  boardColor,
  boardCount,
  onOpenBoards,
  search,
  onEditBoard,
  viewMode,
  onViewModeChange,
  children,
}: PhoneHeaderProps) {
  return (
    <header className="tmp-header">
      <div className="tmp-header-row">
        <button type="button" className="tmp-board-pick" aria-label={`Tablero ${boardName}. Cambiar`} onClick={onOpenBoards}>
          <span className="tmp-board-dot" style={{ background: boardColor }} />
          <span className="tmp-board-name">{boardName}</span>
          {boardCount !== null ? <span className="tmp-board-count">{boardCount}</span> : null}
          <PhoneIcon name="chevronDown" size={16} strokeWidth={2.2} className="tmp-board-chevron" />
        </button>
        {search ? (
          <button
            type="button"
            className={`tmp-icon-btn tmp-header-btn${search.open ? ' is-on' : ''}`}
            aria-label="Buscar"
            aria-pressed={search.open}
            onClick={search.onToggle}
          >
            <PhoneIcon name="search" size={19} />
          </button>
        ) : null}
        {onEditBoard ? (
          <button type="button" className="tmp-icon-btn tmp-header-btn tmp-header-btn--end" aria-label="Editar tablero" onClick={onEditBoard}>
            <PhoneIcon name="gear" size={19} />
          </button>
        ) : null}
      </div>
      {search?.open ? (
        <label className="tmp-search tmp-pop">
          <PhoneIcon name="search" size={16} />
          <input
            // The field opens because the person asked for it.
            autoFocus
            type="search"
            aria-label="Buscar tareas"
            placeholder={`Buscar en ${boardName}`}
            value={search.query}
            onChange={(event) => search.onChange(event.target.value)}
          />
          {search.resultLabel ? <span className="tmp-search-count" role="status">{search.resultLabel}</span> : null}
        </label>
      ) : null}
      <div className="tmp-segment" role="group" aria-label="Vista">
        {VIEWS.map((view) => {
          const current = view.mode === viewMode
          return (
            <button
              key={view.mode}
              type="button"
              className={`tmp-segment-btn${current ? ' is-on' : ''}`}
              aria-pressed={current}
              onClick={() => onViewModeChange(view.mode)}
            >
              <PhoneIcon name={view.icon} size={14} strokeWidth={view.mode === 'management' ? 2.2 : 2} />
              {view.label}
            </button>
          )
        })}
      </div>
      {children}
    </header>
  )
}
