import { useCallback, useEffect, useRef, useState } from 'react'
import type { Board } from '../../types/taskManagerTypes'
import { ShellIcon } from './shellIcons'
import { useDismiss } from './useDismiss'

interface TaskManagerHeaderProps {
  /** Library name and its readable path; null without a library. */
  library: { name: string; path: string } | null
  board: Board | null
  /** Create, edit and delete boards (never on a published board). */
  canManageBoards: boolean
  canCreateTask: boolean
  onOpenPeople: (tab: 'people' | 'projects') => void
  onRefresh: () => void
  onEditBoard: () => void
  onNewBoard: () => void
  onDeleteBoard: () => void
  onNewTask: () => void
}

/** «Tareas», the library and the board's people, projects and menu. */
export function TaskManagerHeader({
  library,
  board,
  canManageBoards,
  canCreateTask,
  onOpenPeople,
  onRefresh,
  onEditBoard,
  onNewBoard,
  onDeleteBoard,
  onNewTask,
}: TaskManagerHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuRef, menuOpen, closeMenu, triggerRef)

  // The first item takes the focus when the menu opens.
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [menuOpen])

  const members = board?.members ?? []
  const shown = members.slice(0, 4)
  const extra = members.length - shown.length
  const choose = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }

  return (
    <header className="tm-header">
      <div className="tm-header-title">
        <h1>Tareas</h1>
        <p className="tm-breadcrumb">
          <ShellIcon name="folder" size={14} strokeWidth={1.8} />
          {library ? (
            <>
              <strong>{library.name}</strong>
              <span aria-hidden="true">·</span>
              <span className="tm-breadcrumb-path" title={library.path}>{library.path}</span>
            </>
          ) : 'Abrí una biblioteca para usar Task Manager'}
        </p>
      </div>
      <div className="tm-header-actions">
        {board ? (
          <>
            <button
              type="button"
              className="tm-control tm-people-button"
              aria-label={`Personas del tablero: ${members.length}. Administrar`}
              title="Personas del tablero"
              onClick={() => onOpenPeople('people')}
            >
              <span className="tm-avatar-stack" aria-hidden="true">
                {shown.map((member) => (
                  <span key={member.name} className="tm-avatar" style={{ ['--tm-person' as string]: member.color }}>
                    {member.initials}
                  </span>
                ))}
                {extra > 0 ? <span className="tm-avatar tm-avatar--more">+{extra}</span> : null}
              </span>
              <ShellIcon name="personPlus" size={15} />
            </button>
            <button type="button" className="tm-control tm-projects-button" onClick={() => onOpenPeople('projects')}>
              <ShellIcon name="folder" size={15} strokeWidth={1.9} />
              Proyectos
              <span className="tm-pill">{board.projects.length}</span>
            </button>
            <span className="tm-header-divider" aria-hidden="true" />
          </>
        ) : null}
        <button type="button" className="tm-control tm-icon-control" aria-label="Refrescar" title="Refrescar" onClick={onRefresh}>
          <ShellIcon name="refresh" size={16} />
        </button>
        {board ? (
          <div className="tm-board-menu-wrap">
            <button
              ref={triggerRef}
              type="button"
              className={`tm-control tm-board-menu-button${menuOpen ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <ShellIcon name="board" size={15} />
              Tablero
              <span className="tm-chevron" aria-hidden="true"><ShellIcon name="chevronDown" size={14} /></span>
            </button>
            {menuOpen ? (
              <div ref={menuRef} className="tm-menu tm-board-menu" role="menu" aria-label="Opciones del tablero">
                {canManageBoards ? (
                  <button type="button" role="menuitem" className="tm-menu-item tm-menu-item--lead" onClick={choose(onEditBoard)}>
                    <span className="tm-menu-icon tm-teal"><ShellIcon name="pencil" size={16} /></span>
                    <span className="tm-menu-text">
                      <strong>Editar tablero</strong>
                      <small>Jornada, contexto, sprints y divisiones</small>
                    </span>
                  </button>
                ) : null}
                <button type="button" role="menuitem" className="tm-menu-item" onClick={choose(() => onOpenPeople('people'))}>
                  <span className="tm-menu-icon"><ShellIcon name="personPlus" size={16} /></span>
                  Personas y proyectos
                </button>
                {canManageBoards ? (
                  <>
                    <button type="button" role="menuitem" className="tm-menu-item" onClick={choose(onNewBoard)}>
                      <span className="tm-menu-icon"><ShellIcon name="plus" size={16} /></span>
                      Nuevo tablero
                    </button>
                    <div className="tm-menu-separator" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="tm-menu-item tm-menu-item--danger"
                      disabled={board.name === 'default'}
                      title={board.name === 'default' ? 'El tablero principal no se puede eliminar.' : undefined}
                      onClick={choose(onDeleteBoard)}
                    >
                      <span className="tm-menu-icon"><ShellIcon name="trash" size={16} /></span>
                      Eliminar tablero
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <button type="button" className="tm-primary" disabled={!canCreateTask} onClick={onNewTask}>
          <ShellIcon name="plus" size={15} strokeWidth={2.4} />
          Nueva tarea
          <kbd>N</kbd>
        </button>
      </div>
    </header>
  )
}
