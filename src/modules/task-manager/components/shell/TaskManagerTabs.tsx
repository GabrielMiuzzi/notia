import { useEffect, useRef, useState } from 'react'
import type { Board } from '../../types/taskManagerTypes'
import { ShellIcon, type ShellIconName } from './shellIcons'

export const FINISHED_TAB_ID = '__finished__'
export const CANCELLED_TAB_ID = '__cancelled__'
export const POMODORO_TAB_ID = '__pomodoro__'

interface TaskManagerTabsProps {
  boards: Board[]
  activeTab: string
  finishedCount: number
  cancelledCount: number
  canManageBoards: boolean
  onSelect: (tab: string) => void
  onNewBoard: () => void
  onEditBoard: (board: Board) => void
}

/** A counter that pulses when its value changes. */
function CountPill({ value, active }: { value: number; active: boolean }) {
  const previous = useRef(value)
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value
      setBump((current) => current + 1)
    }
  }, [value])
  return (
    <span key={bump} className={`tm-pill tm-tab-count${active ? ' is-active' : ''}${bump ? ' tm-bump' : ''}`}>
      {value}
    </span>
  )
}

function Tab({ id, label, icon, count, activeTab, onSelect }: {
  id: string
  label: string
  icon?: ShellIconName
  count?: number
  activeTab: string
  onSelect: (tab: string) => void
}) {
  const active = activeTab === id
  return (
    <button
      type="button"
      className={`tm-tab${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(id)}
    >
      {icon ? <ShellIcon name={icon} size={15} /> : null}
      {label}
      {count !== undefined ? <CountPill value={count} active={active} /> : null}
    </button>
  )
}

/** Boards on the left; Completadas, Canceladas and Pomodoro on the right. */
export function TaskManagerTabs({
  boards,
  activeTab,
  finishedCount,
  cancelledCount,
  canManageBoards,
  onSelect,
  onNewBoard,
  onEditBoard,
}: TaskManagerTabsProps) {
  return (
    <nav className="tm-tabs" aria-label="Vistas de tareas">
      <div className="tm-tabs-group">
        {boards.map((board) => {
          const active = board.name === activeTab
          return (
            <span key={board.name} className="tm-tab-wrap">
              <Tab
                id={board.name}
                label={board.name}
                count={active ? board.counts.active : undefined}
                activeTab={activeTab}
                onSelect={onSelect}
              />
              {active && canManageBoards ? (
                <button
                  type="button"
                  className="tm-tab-gear"
                  aria-label={`Editar tablero ${board.name}`}
                  title="Editar tablero"
                  onClick={() => onEditBoard(board)}
                >
                  <ShellIcon name="gear" size={14} />
                </button>
              ) : null}
            </span>
          )
        })}
        {canManageBoards ? (
          <button type="button" className="tm-tab-add" aria-label="Nuevo tablero" title="Nuevo tablero" onClick={onNewBoard}>
            <ShellIcon name="plus" size={15} />
          </button>
        ) : null}
      </div>
      <div className="tm-tabs-group">
        <Tab id={FINISHED_TAB_ID} label="Completadas" icon="circleCheck" count={finishedCount} activeTab={activeTab} onSelect={onSelect} />
        <Tab id={CANCELLED_TAB_ID} label="Canceladas" icon="circleSlash" count={cancelledCount} activeTab={activeTab} onSelect={onSelect} />
        <span className="tm-tabs-divider" aria-hidden="true" />
        <Tab id={POMODORO_TAB_ID} label="Pomodoro" icon="stopwatch" activeTab={activeTab} onSelect={onSelect} />
      </div>
    </nav>
  )
}
