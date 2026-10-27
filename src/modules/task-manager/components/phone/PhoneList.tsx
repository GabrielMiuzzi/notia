import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Group, TaskItem } from '../../types/taskManagerTypes'
import { matchesQuickFilter, type QuickFilter } from '../../utils/taskFilters'
import { useNow } from '../card/cardHooks'
import { buildBoardModel, formatElapsed, formatHourNumber, isBlocked, isRunning, liveDedicatedHours, priorityLabel, priorityTone, subtaskProgress, summarizeTime } from '../card/taskDisplay'
import { useTaskInteractions, type TaskUiState } from '../card/taskInteractions'
import type { TaskBoardActions } from '../card/taskViewTypes'
import { PhoneIcon } from './phoneIcons'
import { PersonStack, TimeRing } from './phoneParts'

export interface PhoneListProps extends TaskBoardActions {
  groups: Group[]
  /** Tasks after the search. */
  tasks: TaskItem[]
  allTasks: TaskItem[]
  searching: boolean
  /** The viewer's name on the board, for «Mías». */
  me: string | null
  flashTaskId: string | null
  renderHeader: (filters: ReactNode) => ReactNode
  onCreateTask: () => void
  onOpenDetail: (taskPath: string) => void
}

const FILTERS: Array<{ id: QuickFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'mine', label: 'Mías' },
  { id: 'progress', label: 'En progreso' },
  { id: 'urgent', label: 'Urgentes y altas' },
]
const NO_SUBTASKS: TaskItem[] = []

function flashSignalFor(task: TaskItem, ui: TaskUiState, flashTaskId: string | null): string | null {
  if (ui.flash?.path === task.filePath) return `local-${ui.flash.seq}`
  if (flashTaskId && (task.id === flashTaskId || task.filePath === flashTaskId)) return `shell-${flashTaskId}`
  return null
}

/** Hours still to do in some rows: estimate minus dedicated, never below zero. */
function remainingHours(rows: TaskItem[]): number {
  return rows.reduce((sum, task) => sum + Math.max(0, task.estimatedHours - Math.max(0, task.dedicatedHours)), 0)
}

/** «Mobile · Lista»: the columns as collapsible groups of rows. */
export function PhoneList({
  groups,
  tasks,
  allTasks,
  searching,
  me,
  flashTaskId,
  renderHeader,
  onCreateTask,
  onOpenDetail,
  onIntent,
  onOpenTask,
  onEditSource,
  onComment,
  onOpenPeoplePanel,
}: PhoneListProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [filter, setFilter] = useState<QuickFilter>('all')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const model = useMemo(() => buildBoardModel(groups, tasks, allTasks, null), [allTasks, groups, tasks])
  const { ui, actions } = useTaskInteractions({
    rootRef,
    snapshot: tasks,
    onIntent,
    onOpenTask,
    onEditSource,
    onComment,
    onOpenPeoplePanel,
    onMovedTo: () => undefined,
  })

  const roots = model.columns.flatMap((column) => column.allRoots)
  const filterChips = (
    <div className="tmp-chips" role="group" aria-label="Filtro rápido">
      {FILTERS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={filter === item.id}
          className={`tmp-filter-chip${filter === item.id ? ' is-on' : ''}`}
          onClick={() => setFilter(item.id)}
        >
          {item.label}
          <span className="tmp-filter-count">{roots.filter((task) => matchesQuickFilter(task, item.id, me)).length}</span>
        </button>
      ))}
    </div>
  )
  const filtered = filter !== 'all' || searching

  return (
    <div ref={rootRef} className="tmp-screen">
      {renderHeader(filterChips)}
      <main className="tmp-main tmp-main--list">
        {model.columns.map((column, position) => {
          const rows = column.tasks.filter((task) => matchesQuickFilter(task, filter, me))
          const isOpen = open[column.key] ?? (filtered ? rows.length > 0 : column.count > 0)
          const hours = remainingHours(rows)
          return (
            <section
              key={column.key}
              className="tmp-list-group"
              aria-label={column.name}
              style={{ '--tm-col': column.color || undefined, animationDelay: `${position * 50}ms` } as CSSProperties}
            >
              <div className="tmp-stripe" />
              <button
                type="button"
                className="tmp-list-head"
                aria-expanded={isOpen}
                onClick={() => setOpen((current) => ({ ...current, [column.key]: !isOpen }))}
              >
                <PhoneIcon name="chevronRight" size={15} strokeWidth={2.4} className={`tmp-list-chevron${isOpen ? ' is-open' : ''}`} />
                <span className="tmp-list-name">{column.name}</span>
                <span className="tmp-count">{filtered ? `${rows.length} de ${column.count}` : column.count}</span>
                <span className="tmp-grow" />
                {hours > 0 ? <span className="tmp-list-hours">{formatHourNumber(hours)} h restantes</span> : null}
              </button>
              {isOpen ? (
                <div className="tmp-list-rows">
                  {rows.map((task, index) => (
                    <PhoneListRow
                      key={task.filePath}
                      task={task}
                      subtasks={model.subtasksByParent.get(task.filePath) ?? NO_SUBTASKS}
                      leaving={ui.leaving.has(task.filePath)}
                      flash={flashSignalFor(task, ui, flashTaskId) !== null}
                      delayMs={index * 40}
                      onFinish={() => actions.leave(task, 'finish')}
                      onOpen={() => onOpenDetail(task.filePath)}
                    />
                  ))}
                  {rows.length === 0 ? (
                    <div className="tmp-list-empty">{filtered ? 'Nada coincide con el filtro' : 'Sin tareas'}</div>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </main>
      <button type="button" className="tmp-fab" aria-label="Nueva tarea" onClick={onCreateTask}>
        <PhoneIcon name="plus" size={24} strokeWidth={2.6} />
      </button>
    </div>
  )
}

interface PhoneListRowProps {
  task: TaskItem
  subtasks: TaskItem[]
  leaving: boolean
  flash: boolean
  delayMs: number
  onFinish: () => void
  onOpen: () => void
}

function PhoneListRow({ task, subtasks, leaving, flash, delayMs, onFinish, onOpen }: PhoneListRowProps) {
  const running = isRunning(task)
  const blocked = isBlocked(task)
  const now = useNow(running)
  const time = summarizeTime(liveDedicatedHours(task, now), task.estimatedHours)
  const { done, total } = subtaskProgress(task, subtasks)
  const tone = priorityTone(task.priority)
  const people = task.people ?? []
  const classes = ['tmp-list-row', leaving ? 'is-done' : '', flash ? 'is-flash' : ''].filter(Boolean).join(' ')
  return (
    <div className={classes} data-task-path={task.filePath} style={{ animationDelay: `${delayMs}ms` }}>
      <button
        type="button"
        className={`tmp-check${running ? ' is-running' : ''}${blocked ? ' is-blocked' : ''}`}
        aria-label={`Finalizar ${task.title}`}
        onClick={onFinish}
      >
        {leaving ? <PhoneIcon name="check" size={14} strokeWidth={3.4} className="tmp-check-mark" /> : null}
        {!leaving && running ? <span className="tmp-pulse-dot" /> : null}
        {!leaving && blocked ? <PhoneIcon name="lock" size={12} strokeWidth={2.6} /> : null}
      </button>
      <span className="tmp-list-body">
        <button type="button" className="tmp-list-title tmp-clamp2" onClick={onOpen}>{task.title}</button>
        <span className="tmp-list-meta">
          <span className={`tmp-list-prio tmp-prio--${tone}`}><span className="tmp-prio-dot" />{priorityLabel(task.priority)}</span>
          {running ? <span className="tmp-list-elapsed">{formatElapsed(task, now)}</span> : null}
          {task.project ? (
            <span className="tmp-list-project"><span className="tmp-square tmp-square--sm" style={{ background: task.projectColor ?? 'var(--tm-muted)' }} />{task.project}</span>
          ) : null}
          {total > 0 ? <span className="tmp-tabular">☰ {done}/{total}</span> : null}
          {people.length ? <PersonStack people={people} size={20} /> : null}
        </span>
      </span>
      <TimeRing time={time} size={26} label={false} />
    </div>
  )
}
