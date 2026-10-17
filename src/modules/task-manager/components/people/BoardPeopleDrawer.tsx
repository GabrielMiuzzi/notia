import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskBoardPeople.css'
import type { TaskPaletteColor } from '../../types/taskBoardTypes'
import type { Board } from '../../types/taskManagerTypes'

export interface BoardPeopleDrawerProps {
  open: boolean
  board: Board | null
  palette: TaskPaletteColor[]
  initialTab: 'people' | 'projects'
  onClose: () => void
  onAddMember: (name: string) => Promise<void>
  onRemoveMember: (name: string) => Promise<void>
  onAddProject: (name: string, color: string) => Promise<void>
  onRemoveProject: (name: string) => Promise<void>
}

type DrawerTab = BoardPeopleDrawerProps['initialTab']

const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'people', label: 'Personas' },
  { id: 'projects', label: 'Proyectos' },
]

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
const TRASH_PATH = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'
const FOLDER_PATH = 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z'

/**
 * Comparison key for the duplicate warning only (Rust decides): case and
 * accents do not count.
 */
function nameKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function sameColor(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function Icon({ path, size = 14, strokeWidth = 2 }: { path: string; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

export function BoardPeopleDrawer(props: BoardPeopleDrawerProps) {
  if (!props.open || !props.board) return null
  return <BoardPeopleDrawerBody {...props} board={props.board} />
}

function BoardPeopleDrawerBody({
  board,
  palette,
  initialTab,
  onClose,
  onAddMember,
  onRemoveMember,
  onAddProject,
  onRemoveProject,
}: BoardPeopleDrawerProps & { board: Board }) {
  const ids = useId()
  const [tab, setTab] = useState<DrawerTab>(initialTab)
  const [seenInitialTab, setSeenInitialTab] = useState(initialTab)
  if (seenInitialTab !== initialTab) {
    setSeenInitialTab(initialTab)
    setTab(initialTab)
  }

  const [memberName, setMemberName] = useState('')
  const [memberPending, setMemberPending] = useState(false)
  const [removingMember, setRemovingMember] = useState<string | null>(null)
  const [peopleError, setPeopleError] = useState<string | null>(null)

  const [projectName, setProjectName] = useState('')
  const [projectColor, setProjectColor] = useState(board.nextProjectColor)
  const [seenNextColor, setSeenNextColor] = useState(board.nextProjectColor)
  if (seenNextColor !== board.nextProjectColor) {
    setSeenNextColor(board.nextProjectColor)
    setProjectColor(board.nextProjectColor)
  }
  const [projectPending, setProjectPending] = useState(false)
  const [removingProject, setRemovingProject] = useState<string | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)

  const asideRef = useRef<HTMLElement | null>(null)
  const memberInputRef = useRef<HTMLInputElement | null>(null)
  const projectInputRef = useRef<HTMLInputElement | null>(null)
  const overlayPressRef = useRef(false)

  // Focus goes into the panel when it opens and back where it was when it closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const input = initialTab === 'projects' ? projectInputRef.current : memberInputRef.current
    ;(input ?? asideRef.current)?.focus({ preventScroll: true })
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
    // Only when the panel opens; switching tabs keeps the focus where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const memberTrimmed = memberName.trim()
  const memberDuplicate = memberTrimmed !== '' && board.members.some((member) => nameKey(member.name) === nameKey(memberTrimmed))
  const canAddMember = memberTrimmed !== '' && !memberDuplicate && !memberPending

  const projectTrimmed = projectName.trim()
  const projectDuplicate = projectTrimmed !== '' && board.projects.some((project) => nameKey(project.name) === nameKey(projectTrimmed))
  const canAddProject = projectTrimmed !== '' && !projectDuplicate && !projectPending && projectColor !== ''

  const addMember = async () => {
    if (!canAddMember) return
    setMemberPending(true)
    setPeopleError(null)
    try {
      await onAddMember(memberTrimmed)
      setMemberName('')
    } catch (error) {
      setPeopleError(errorMessage(error, 'No se pudo agregar a la persona.'))
    } finally {
      setMemberPending(false)
    }
  }

  const removeMember = async (name: string) => {
    setRemovingMember(name)
    setPeopleError(null)
    try {
      await onRemoveMember(name)
    } catch (error) {
      setPeopleError(errorMessage(error, 'No se pudo quitar a la persona.'))
    } finally {
      setRemovingMember(null)
    }
  }

  const addProject = async () => {
    if (!canAddProject) return
    setProjectPending(true)
    setProjectError(null)
    try {
      await onAddProject(projectTrimmed, projectColor)
      setProjectName('')
    } catch (error) {
      setProjectError(errorMessage(error, 'No se pudo agregar el proyecto.'))
    } finally {
      setProjectPending(false)
    }
  }

  const removeProject = async (name: string) => {
    setRemovingProject(name)
    setProjectError(null)
    try {
      await onRemoveProject(name)
    } catch (error) {
      setProjectError(errorMessage(error, 'No se pudo eliminar el proyecto.'))
    } finally {
      setRemovingProject(null)
    }
  }

  const handleEnter = (action: () => Promise<void>) => (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void action()
  }

  const handlePanelKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !asideRef.current) return
    const focusable = Array.from(asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === asideRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleTabKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = TABS.findIndex((item) => item.id === tab)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? TABS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length
    setTab(TABS[next].id)
    document.getElementById(`${ids}-tab-${TABS[next].id}`)?.focus()
  }

  const handleColorKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || palette.length === 0) return
    event.preventDefault()
    const index = Math.max(0, palette.findIndex((item) => sameColor(item.color, projectColor)))
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    const next = (index + step + palette.length) % palette.length
    setProjectColor(palette[next].color)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  const counts: Record<DrawerTab, number> = { people: board.members.length, projects: board.projects.length }
  const anyColorChecked = palette.some((item) => sameColor(item.color, projectColor))

  return (
    <>
      <div
        aria-hidden="true"
        className="tbp-overlay"
        onPointerDown={(event) => { overlayPressRef.current = event.target === event.currentTarget }}
        onClick={(event) => {
          // A click that did not start on the overlay (Android's phantom click
          // after the tap that opened the panel) does not close it.
          if (overlayPressRef.current && event.target === event.currentTarget) onClose()
          overlayPressRef.current = false
        }}
      />
      <aside
        ref={asideRef}
        className="tbp-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Personas y proyectos del tablero"
        tabIndex={-1}
        onKeyDown={handlePanelKeys}
      >
        <div className="tbp-header">
          <div className="tbp-heading">
            <span className="tbp-eyebrow">Tablero</span>
            <h2 className="tbp-title">{board.name}</h2>
          </div>
          <button type="button" className="tbp-icon-button" aria-label="Cerrar panel" onClick={onClose}>
            <Icon path="M6 6l12 12M18 6L6 18" strokeWidth={2.2} />
          </button>
        </div>

        <div role="tablist" aria-label="Secciones" className="tbp-tabs" onKeyDown={handleTabKeys}>
          {TABS.map((item) => {
            const selected = tab === item.id
            return (
              <button
                key={item.id}
                id={`${ids}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${ids}-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                className={`tbp-tab${selected ? ' is-selected' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <span className="tbp-count">{counts[item.id]}</span>
              </button>
            )
          })}
        </div>

        <div
          id={`${ids}-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`${ids}-tab-${tab}`}
          className="tbp-body"
        >
          {tab === 'people' ? (
            <>
              <div className="tbp-add">
                <label htmlFor={`${ids}-member`} className="tbp-label">Agregar persona</label>
                <div className="tbp-add-row">
                  <input
                    ref={memberInputRef}
                    id={`${ids}-member`}
                    className="tbp-input"
                    placeholder="Nombre y apellido"
                    value={memberName}
                    onChange={(event) => { setMemberName(event.target.value); setPeopleError(null) }}
                    onKeyDown={handleEnter(addMember)}
                    aria-invalid={memberDuplicate}
                  />
                  <button
                    type="button"
                    className="tbp-add-button"
                    disabled={!canAddMember}
                    aria-busy={memberPending}
                    onClick={() => void addMember()}
                  >
                    <Icon path="M12 5v14M5 12h14" strokeWidth={2.4} />
                    Agregar
                  </button>
                </div>
                {memberDuplicate ? <span className="tbp-warning tbp-pop" role="status">Esa persona ya está en el tablero.</span> : null}
                {peopleError ? <span className="tbp-error" role="alert">{peopleError}</span> : null}
                <span className="tbp-hint">Solo las personas del tablero aparecen al asignar una tarea.</span>
              </div>
              <ul className="tbp-list" aria-label="Personas del tablero">
                {board.members.map((member) => (
                  <li key={member.name} className="tbp-row">
                    <span
                      className="tbp-avatar tbp-pop"
                      style={{ color: member.color, background: `color-mix(in srgb, ${member.color} 18%, transparent)` } as CSSProperties}
                      aria-hidden="true"
                    >
                      {member.initials}
                    </span>
                    <span className="tbp-row-text">
                      <span className="tbp-row-name">{member.name}</span>
                      <span className="tbp-row-sub">
                        {member.taskCount === 1 ? '1 tarea asignada' : `${member.taskCount} tareas asignadas`}
                      </span>
                    </span>
                    <span className={`tbp-role${member.isOwner ? ' is-owner' : ''}`}>{member.role}</span>
                    {member.isOwner ? (
                      <span className="tbp-row-spacer" aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        className="tbp-delete tbp-reveal"
                        aria-label={`Quitar a ${member.name} del tablero`}
                        disabled={removingMember !== null}
                        aria-busy={removingMember === member.name}
                        onClick={() => void removeMember(member.name)}
                      >
                        <Icon path={TRASH_PATH} size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="tbp-add tbp-add--projects">
                <label htmlFor={`${ids}-project`} className="tbp-label">Agregar proyecto</label>
                <div className="tbp-add-row">
                  <input
                    ref={projectInputRef}
                    id={`${ids}-project`}
                    className="tbp-input"
                    placeholder="Nombre del proyecto"
                    value={projectName}
                    onChange={(event) => { setProjectName(event.target.value); setProjectError(null) }}
                    onKeyDown={handleEnter(addProject)}
                    aria-invalid={projectDuplicate}
                  />
                  <button
                    type="button"
                    className="tbp-add-button"
                    disabled={!canAddProject}
                    aria-busy={projectPending}
                    onClick={() => void addProject()}
                  >
                    <Icon path="M12 5v14M5 12h14" strokeWidth={2.4} />
                    Agregar
                  </button>
                </div>
                <div role="radiogroup" aria-label="Color del proyecto" className="tbp-swatches" onKeyDown={handleColorKeys}>
                  <span className="tbp-swatches-label" aria-hidden="true">Color</span>
                  {palette.map((item, index) => {
                    const checked = sameColor(item.color, projectColor)
                    return (
                      <button
                        key={item.color}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        aria-label={item.name}
                        tabIndex={checked || (!anyColorChecked && index === 0) ? 0 : -1}
                        className={`tbp-swatch${checked ? ' is-checked' : ''}`}
                        style={{ background: item.color, '--tbp-swatch': item.color } as CSSProperties}
                        onClick={() => setProjectColor(item.color)}
                      />
                    )
                  })}
                </div>
                {projectDuplicate ? <span className="tbp-warning tbp-pop" role="status">Ya existe un proyecto con ese nombre.</span> : null}
                {projectError ? <span className="tbp-error" role="alert">{projectError}</span> : null}
              </div>
              {board.projects.length > 0 ? (
                <ul className="tbp-list" aria-label="Proyectos del tablero">
                  {board.projects.map((project) => (
                    <li key={project.name} className="tbp-row">
                      <span
                        className="tbp-project-tile tbp-pop"
                        style={{ color: project.color, background: `color-mix(in srgb, ${project.color} 14%, transparent)` } as CSSProperties}
                        aria-hidden="true"
                      >
                        <Icon path={FOLDER_PATH} size={16} />
                      </span>
                      <span className="tbp-row-text">
                        <span className="tbp-row-name">{project.name}</span>
                        <span className="tbp-row-sub">{project.taskCount === 1 ? '1 tarea' : `${project.taskCount} tareas`}</span>
                      </span>
                      <button
                        type="button"
                        className="tbp-delete tbp-reveal"
                        aria-label={`Eliminar el proyecto ${project.name}`}
                        disabled={removingProject !== null}
                        aria-busy={removingProject === project.name}
                        onClick={() => void removeProject(project.name)}
                      >
                        <Icon path={TRASH_PATH} size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tbp-empty">Todavía no hay proyectos en este tablero.</p>
              )}
              <span className="tbp-hint">Al eliminar un proyecto, sus tareas quedan sin proyecto.</span>
            </>
          )}
        </div>
      </aside>
    </>
  )
}
