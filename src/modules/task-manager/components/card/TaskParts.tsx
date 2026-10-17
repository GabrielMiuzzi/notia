import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Board, TaskItem } from '../../types/taskManagerTypes'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import { PeoplePopover } from './PeoplePopover'
import { ProjectPopover } from './ProjectPopover'
import {
  formatElapsed,
  isBlocked,
  isPending,
  isRunning,
  liveDedicatedHours,
  priorityLabel,
  priorityTone,
  summarizeTime,
} from './taskDisplay'
import { useTaskActions } from './taskInteractions'
import { TimePopover } from './TimePopover'
import { TimeRing } from './TimeRing'

/*
 * Pieces a card and a list row share. Each one renders what the backend
 * sent and turns a tap into an intent or into an open popover.
 */

type Variant = 'card' | 'list'

/** Waits this long after a mouse click to tell it from a double click. */
const OPEN_DELAY_MS = 220

export function PriorityChip({ task, variant, expanded }: { task: TaskItem; variant: Variant; expanded: boolean }) {
  const actions = useTaskActions()
  const [bump, setBump] = useState(0)
  const previous = useRef(task.priority)
  useEffect(() => {
    if (previous.current === task.priority) return
    previous.current = task.priority
    setBump((count) => count + 1)
  }, [task.priority])
  const label = priorityLabel(task.priority)
  const bumpClass = bump ? (bump % 2 ? ' tm-chip-a' : ' tm-chip-b') : ''
  return (
    <button
      type="button"
      className={`tm-prio-chip tm-prio-btn tm-prio-chip--${variant}${bumpClass}`}
      data-tone={priorityTone(task.priority)}
      aria-label={`Prioridad ${label}. Cambiar`}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(event) => actions.toggleMenu(task, 'prio', event.currentTarget, 'start')}
    >
      <span className="tm-prio-dot" />
      {label}
      <Icon name="chevronDown" size={9} strokeWidth={3} className="tm-pchev" />
    </button>
  )
}

/** «En progreso · m:ss» with its pulse, «Bloqueada» with a lock, and «Pendiente» in the list. */
export function StatusChip({ task, now, variant }: { task: TaskItem; now: number; variant: Variant }) {
  if (isRunning(task)) {
    const elapsed = formatElapsed(task, now)
    return (
      <span className={`tm-status tm-status--${variant} is-running tm-pop-in`}>
        <span className="tm-dot-pulse" />
        En progreso{elapsed ? ` · ${elapsed}` : ''}
      </span>
    )
  }
  if (isBlocked(task)) {
    return (
      <span className={`tm-status tm-status--${variant} is-blocked tm-pop-in`}>
        <Icon name="lock" size={11} strokeWidth={2.4} />
        Bloqueada
      </span>
    )
  }
  if (variant === 'list') {
    return (
      <span className="tm-status tm-status--list is-pending tm-pop-in">
        <span className="tm-status-dot" />
        Pendiente
      </span>
    )
  }
  return null
}

export function ProjectField({ task, board, open, variant }: { task: TaskItem; board: Board; open: boolean; variant: Variant }) {
  const actions = useTaskActions()
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const project = task.project ?? ''
  const label = project || 'Agregar proyecto'
  const color = task.projectColor ?? board.projects.find((candidate) => candidate.name === project)?.color ?? null
  return (
    <div className={`tm-field tm-field-project tm-field-project--${variant}`}>
      <button
        ref={anchorRef}
        type="button"
        className={`tm-trigger tm-project-trigger tm-project-trigger--${variant}${open ? ' is-open' : ''}`}
        aria-label={`Proyecto: ${label}. Cambiar`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => actions.togglePop(task, 'project')}
      >
        {variant === 'card' ? (
          <span className={`tm-project-icon${color ? '' : ' is-empty'}`} style={color ? ({ '--tm-dot': color } as CSSProperties) : undefined}>
            <Icon name="folder" size={12} />
          </span>
        ) : (
          <span className={`tm-dot tm-dot--8${color ? '' : ' is-empty'}`} style={color ? ({ '--tm-dot': color } as CSSProperties) : undefined} />
        )}
        <span className={`tm-ellipsis${project ? '' : ' tm-italic'}`}>{label}</span>
        <Icon name="chevronDown" size={11} strokeWidth={2.4} className="tm-chev" />
      </button>
      {open ? <ProjectPopover task={task} board={board} anchorRef={anchorRef} offset={variant === 'card' ? 6 : 8} /> : null}
    </div>
  )
}

export function PeopleField({ task, board, open, variant }: { task: TaskItem; board: Board; open: boolean; variant: Variant }) {
  const actions = useTaskActions()
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const people = task.people?.length
    ? task.people
    : (task.assignees ?? []).map((name) => {
      const member = board.members.find((candidate) => candidate.name === name)
      return { name, initials: member?.initials ?? name.slice(0, 2).toUpperCase(), color: member?.color ?? 'var(--tm-muted)', isMe: Boolean(member?.isMe) }
    })
  const names = people.map((person) => person.name)
  const label = people.length === 1 ? people[0].name.split(' ')[0] : people.length > 3 ? `+${people.length - 3}` : ''
  return (
    <div className={`tm-field tm-field-people tm-field-people--${variant}`}>
      <button
        ref={anchorRef}
        type="button"
        className={`tm-trigger tm-people-trigger tm-people-trigger--${variant}${open ? ' is-open' : ''}`}
        aria-label={names.length ? `Asignadas: ${names.join(', ')}. Cambiar` : 'Asignar personas'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => actions.togglePop(task, 'people')}
      >
        {people.length ? (
          <>
            <span className="tm-person-stack">
              {people.slice(0, 3).map((person) => (
                <Avatar key={person.name} initials={person.initials} color={person.color} name={person.name} size={variant === 'card' ? 'sm' : 'md'} />
              ))}
            </span>
            {label ? <span className="tm-people-label">{label}</span> : null}
          </>
        ) : (
          <>
            <span className={`tm-person-empty tm-person--${variant === 'card' ? 'sm' : 'md'}`} aria-hidden="true">
              <Icon name="personPlus" size={12} strokeWidth={2.2} />
            </span>
            <span>Asignar</span>
          </>
        )}
      </button>
      {open ? <PeoplePopover task={task} board={board} anchorRef={anchorRef} offset={variant === 'card' ? 3 : 4} /> : null}
    </div>
  )
}

export function TimeField({ task, open, variant, now, delayMs }: { task: TaskItem; open: boolean; variant: Variant; now: number; delayMs: number }) {
  const actions = useTaskActions()
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const summary = summarizeTime(liveDedicatedHours(task, now), task.estimatedHours)
  return (
    <div className={`tm-field tm-field-time tm-field-time--${variant}`}>
      <button
        ref={anchorRef}
        type="button"
        className={`tm-trigger tm-time-trigger tm-time-trigger--${variant}${open ? ' is-open' : ''}`}
        aria-label={summary.aria}
        title={variant === 'card' ? summary.aria : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => actions.togglePop(task, 'time')}
      >
        <TimeRing summary={summary} delayMs={delayMs} />
        {variant === 'list' ? (
          <span className="tm-time-short">
            <strong>{summary.spentShort}</strong>
            <span className="tm-muted"> / {summary.estimateShort}</span>
          </span>
        ) : null}
      </button>
      {open ? <TimePopover task={task} anchorRef={anchorRef} side={variant === 'card' ? 'right' : 'left'} offset={6} /> : null}
    </div>
  )
}

/** «Iniciar», or «Pausar» and «Finalizar»; a blocked task shows neither. */
export function RunControls({ task, variant }: { task: TaskItem; variant: Variant }) {
  const actions = useTaskActions()
  if (isRunning(task)) {
    return (
      <>
        <button
          type="button"
          className={`tm-icon-btn tm-icon-btn--bordered tm-run-btn tm-run-btn--${variant} tm-pop-in`}
          aria-label="Pausar"
          title="Pausar"
          onClick={() => void actions.send({ kind: 'pause-task', taskPath: task.filePath }, task.filePath)}
        >
          <Icon name="pauseBars" size={12} />
        </button>
        <button type="button" className={`tm-btn-primary tm-run-finish tm-run-finish--${variant} tm-pop-in`} onClick={() => actions.leave(task, 'finish')}>
          <Icon name="check" size={13} strokeWidth={2.6} />
          Finalizar
        </button>
      </>
    )
  }
  if (isPending(task)) {
    return (
      <button
        type="button"
        className={`tm-start-btn tm-start-btn--${variant}`}
        onClick={() => void actions.send({ kind: 'start-task', taskPath: task.filePath }, task.filePath)}
      >
        <Icon name="play" size={13} />
        Iniciar
      </button>
    )
  }
  return null
}

export function CommentButton({ task, variant, reveal }: { task: TaskItem; variant: Variant; reveal: boolean }) {
  const actions = useTaskActions()
  return (
    <button
      type="button"
      className={`tm-icon-btn tm-icon-btn--bordered tm-comment-btn tm-comment-btn--${variant}${reveal ? ' tm-reveal' : ''}`}
      aria-label="Agregar comentario"
      title="Agregar comentario"
      onClick={() => actions.comment(task)}
    >
      <Icon name="comment" size={14} />
    </button>
  )
}

export function SubtaskToggle({ task, done, total, expanded, variant }: { task: TaskItem; done: number; total: number; expanded: boolean; variant: Variant }) {
  const actions = useTaskActions()
  const label = total ? `Subtareas: ${done} de ${total} completas` : 'Agregar subtareas'
  const complete = total > 0 && done === total
  return (
    <button
      type="button"
      className={`tm-trigger tm-subs-toggle tm-subs-toggle--${variant}${expanded ? ' is-open' : ''}${complete ? ' is-complete' : ''}${!total && !expanded ? ' tm-reveal' : ''}`}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={() => actions.toggleExpanded(task)}
    >
      {variant === 'list' ? <Icon name="chevronRight" size={11} strokeWidth={2.6} className="tm-chev-rot" /> : null}
      <Icon name="checklist" size={variant === 'card' ? 13 : 12} />
      {total ? <span>{done}/{total}</span> : null}
    </button>
  )
}

function RenameInput({ task, initial, variant }: { task: TaskItem; initial: string; variant: Variant }) {
  const actions = useTaskActions()
  const [value, setValue] = useState(initial)
  const doneRef = useRef(false)
  const finish = (save: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    if (save) actions.rename(task, value)
    else actions.cancelRename()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      finish(false)
    }
  }
  return (
    <input
      className={`tm-rename tm-rename--${variant} tm-pop-in`}
      autoFocus
      aria-label="Nuevo título"
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => finish(true)}
    />
  )
}

/**
 * The title opens the ticket; a double click opens its Markdown in the
 * editor dialog. With a mouse the open waits a moment to tell both apart; a
 * tap or a key opens at once and the editor is in the menu («Editar nota»).
 * Hovering shows the whole title, which the card may clamp.
 */
export function TaskTitle({ task, title, renaming, coarse, variant }: { task: TaskItem; title: string; renaming: boolean; coarse: boolean; variant: Variant }) {
  const actions = useTaskActions()
  const timerRef = useRef<number | null>(null)
  const pointerRef = useRef('')
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const wasRenaming = useRef(renaming)

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  // Back from the rename field, the focus returns to the title.
  useEffect(() => {
    const before = wasRenaming.current
    wasRenaming.current = renaming
    if (before && !renaming && (!document.activeElement || document.activeElement === document.body)) {
      buttonRef.current?.focus()
    }
  }, [renaming])

  if (renaming) return <RenameInput task={task} initial={title} variant={variant} />

  const cancelPendingOpen = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const Tag = variant === 'card' ? 'h3' : 'span'
  return (
    <Tag className={`tm-title tm-title--${variant}`}>
      <button
        ref={buttonRef}
        type="button"
        data-drag-ok
        className="tm-title-btn"
        title={title}
        onPointerDown={(event) => {
          pointerRef.current = event.pointerType
        }}
        onMouseDown={(event) => {
          if (event.detail > 1) event.preventDefault()
        }}
        onClick={(event) => {
          const immediate = event.detail === 0 || coarse || pointerRef.current === 'touch' || pointerRef.current === 'pen'
          if (immediate) {
            cancelPendingOpen()
            actions.openTask(task)
            return
          }
          if (timerRef.current !== null) return
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            actions.openTask(task)
          }, OPEN_DELAY_MS)
        }}
        onDoubleClick={() => {
          if (coarse) return
          cancelPendingOpen()
          actions.editSource(task)
        }}
      >
        <span className={variant === 'card' ? 'tm-clamp2' : 'tm-ellipsis'}>{title}</span>
      </button>
    </Tag>
  )
}
