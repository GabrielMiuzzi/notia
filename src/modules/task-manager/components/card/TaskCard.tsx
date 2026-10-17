import { memo, type DragEvent as ReactDragEvent } from 'react'
import type { Board, TaskItem } from '../../types/taskManagerTypes'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskCard.css'
import { useFlash, useNow } from './cardHooks'
import { Icon } from './icons'
import { SubtasksPanel } from './SubtasksPanel'
import { isBlocked, isRunning, plainTextPreview, subtaskProgress } from './taskDisplay'
import { useTaskActions } from './taskInteractions'
import { CommentButton, PeopleField, PriorityChip, ProjectField, RunControls, StatusChip, SubtaskToggle, TaskTitle, TimeField } from './TaskParts'
import type { PopKind } from './taskViewTypes'

export interface TaskCardProps {
  task: TaskItem
  board: Board
  subtasks: TaskItem[]
  showDescriptions: boolean
  /** Popover open on this card. */
  pop: PopKind | null
  /** Fixed menu open from this card: ⋯ (or a submenu) or the priority picker. */
  menu: 'menu' | 'prio' | null
  renaming: boolean
  expanded: boolean
  leaving: boolean
  dragging: boolean
  /** Changes each time the card must flash and come into view. */
  flashSignal: string | null
  /** A title sent with «Renombrar», shown until the backend answers. */
  pendingTitle: string | null
  entryDelayMs: number
  coarse: boolean
  onDragStart: (event: ReactDragEvent<HTMLElement>, path: string) => void
  onDragEnd: () => void
}

/** A task of the board: priority, state, project, title and time, description, subtasks and actions. */
export const TaskCard = memo(function TaskCard({
  task,
  board,
  subtasks,
  showDescriptions,
  pop,
  menu,
  renaming,
  expanded,
  leaving,
  dragging,
  flashSignal,
  pendingTitle,
  entryDelayMs,
  coarse,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const actions = useTaskActions()
  const now = useNow(isRunning(task))
  const { ref, flashing } = useFlash<HTMLElement>(flashSignal)
  const { done, total } = subtaskProgress(task, subtasks)
  const title = pendingTitle ?? task.title
  const description = showDescriptions ? plainTextPreview(task.preview) : ''
  const locked = Boolean(pop || menu || renaming || expanded)
  const classes = [
    'tm-card',
    pop ? 'is-raised' : '',
    flashing ? 'is-flash' : '',
    leaving ? 'is-leaving' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      ref={ref}
      className={classes}
      data-task-path={task.filePath}
      data-drag-path={task.filePath}
      draggable={!locked && !coarse && !leaving}
      onDragStart={(event) => onDragStart(event, task.filePath)}
      onDragEnd={onDragEnd}
      aria-label={title}
      style={{ animationDelay: `${entryDelayMs}ms` }}
    >
      <div className="tm-card-chips">
        <PriorityChip task={task} variant="card" expanded={menu === 'prio'} />
        <StatusChip task={task} now={now} variant="card" />
        <span className="tm-grow" />
        <button
          type="button"
          className={`tm-icon-btn tm-card-kebab tm-reveal${menu ? ' is-forced' : ''}`}
          aria-label="Opciones de la tarea"
          aria-haspopup="menu"
          aria-expanded={menu === 'menu'}
          onClick={(event) => actions.toggleMenu(task, 'menu', event.currentTarget, 'end')}
        >
          <Icon name="kebab" size={14} />
        </button>
      </div>
      <ProjectField task={task} board={board} open={pop === 'project'} variant="card" />
      <div className="tm-card-title-row">
        <TaskTitle task={task} title={title} renaming={renaming} coarse={coarse} variant="card" />
        <TimeField task={task} open={pop === 'time'} variant="card" now={now} delayMs={entryDelayMs} />
      </div>
      {/* A double click on the detail opens the ticket, as on the title; the menu has «Editar nota». */}
      {description ? (
        <p className="tm-card-desc tm-clamp2" onDoubleClick={() => actions.editSource(task)}>{description}</p>
      ) : null}
      {isBlocked(task) && task.blockNote ? (
        <div className="tm-block-box" onDoubleClick={() => actions.editSource(task)}>
          <Icon name="alert" size={13} strokeWidth={2.2} />
          <span>{task.blockNote}</span>
        </div>
      ) : null}
      {expanded ? (
        <SubtasksPanel parent={task} subtasks={subtasks} done={done} total={total} variant="card" parentTitle={title} />
      ) : null}
      <div className="tm-card-footer">
        <PeopleField task={task} board={board} open={pop === 'people'} variant="card" />
        <SubtaskToggle task={task} done={done} total={total} expanded={expanded} variant="card" />
        <span className="tm-card-actions">
          <CommentButton task={task} variant="card" reveal={false} />
          <RunControls task={task} variant="card" />
        </span>
      </div>
    </article>
  )
})
