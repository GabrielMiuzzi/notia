import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from 'react'
import type { Board, TaskItem } from '../../types/taskManagerTypes'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskCard.css'
import '../../styles/taskList.css'
import { useCoarsePointer, useFlash, useNow } from '../card/cardHooks'
import { Icon } from '../card/icons'
import { SubtasksPanel } from '../card/SubtasksPanel'
import { buildBoardModel, isBlocked, isRunning, placementOrder, plainTextPreview, subtaskProgress, type BoardColumnModel, type PendingPlacement } from '../card/taskDisplay'
import { TaskActionsContext, useTaskActions, useTaskInteractions, type TaskUiState } from '../card/taskInteractions'
import { TaskMenuLayer } from '../card/TaskMenuLayer'
import { CommentButton, PeopleField, PriorityChip, ProjectField, RunControls, StatusChip, SubtaskToggle, TaskTitle, TimeField } from '../card/TaskParts'
import type { MoveTarget, PopKind, TaskViewDataProps } from '../card/taskViewTypes'
import { useTaskDrag, type DropTarget } from '../card/useTaskDrag'

export type { TaskBoardActions } from '../card/taskViewTypes'

/** Same data as the board; its collapsed groups are its own. */
export type TaskListViewProps = TaskViewDataProps

const ENTRY_WINDOW_MS = 1200
const NO_SUBTASKS: TaskItem[] = []
const HEADERS = ['', 'Tarea', 'Proyecto', 'Personas', 'Estado', 'Tiempo', 'Prioridad', 'Acciones']

interface TaskListRowProps {
  task: TaskItem
  board: Board
  subtasks: TaskItem[]
  showDescriptions: boolean
  pop: PopKind | null
  menu: 'menu' | 'prio' | null
  renaming: boolean
  expanded: boolean
  leaving: boolean
  dragging: boolean
  flashSignal: string | null
  pendingTitle: string | null
  entryDelayMs: number
  coarse: boolean
  onDragStart: (event: ReactDragEvent<HTMLElement>, path: string) => void
  onDragEnd: () => void
}

function flashSignalFor(task: TaskItem, ui: TaskUiState, flashTaskId: string | null): string | null {
  if (ui.flash?.path === task.filePath) return `local-${ui.flash.seq}`
  if (flashTaskId && (task.id === flashTaskId || task.filePath === flashTaskId)) return `shell-${flashTaskId}`
  return null
}

/** A task as a row: the same actions as the card, and its subtasks nested below. */
const TaskListRow = memo(function TaskListRow({
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
}: TaskListRowProps) {
  const actions = useTaskActions()
  const now = useNow(isRunning(task))
  const { ref, flashing } = useFlash<HTMLDivElement>(flashSignal)
  const { done, total } = subtaskProgress(task, subtasks)
  const title = pendingTitle ?? task.title
  const blockNote = isBlocked(task) ? task.blockNote ?? '' : ''
  const description = !blockNote && showDescriptions ? plainTextPreview(task.preview) : ''
  const locked = Boolean(pop || menu || renaming || expanded)
  const classes = [
    'tm-lrow',
    pop ? 'is-raised' : '',
    flashing ? 'is-flash' : '',
    leaving ? 'is-leaving' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <div
        ref={ref}
        className={classes}
        data-task-path={task.filePath}
        data-drag-path={task.filePath}
        draggable={!locked && !coarse && !leaving}
        onDragStart={(event) => onDragStart(event, task.filePath)}
        onDragEnd={onDragEnd}
        style={{ animationDelay: `${entryDelayMs}ms` }}
      >
        <span className="tm-grip tm-reveal" aria-hidden="true">
          <Icon name="grip" size={14} />
        </span>
        <span className="tm-lcell-title">
          <span className="tm-lcell-title-line">
            <TaskTitle task={task} title={title} renaming={renaming} coarse={coarse} variant="list" />
            <SubtaskToggle task={task} done={done} total={total} expanded={expanded} variant="list" />
          </span>
          {blockNote ? (
            <span className="tm-lblock" onDoubleClick={() => actions.editSource(task)}>
              <Icon name="alert" size={12} strokeWidth={2.2} />
              <span className="tm-ellipsis">{blockNote}</span>
            </span>
          ) : description ? (
            <span className="tm-ldesc tm-ellipsis" onDoubleClick={() => actions.editSource(task)}>{description}</span>
          ) : null}
        </span>
        <ProjectField task={task} board={board} open={pop === 'project'} variant="list" />
        <PeopleField task={task} board={board} open={pop === 'people'} variant="list" />
        <span className="tm-lcell">
          <StatusChip task={task} now={now} variant="list" />
        </span>
        <TimeField task={task} open={pop === 'time'} variant="list" now={now} delayMs={entryDelayMs} />
        <span className="tm-lcell">
          <PriorityChip task={task} variant="list" expanded={menu === 'prio'} />
        </span>
        <span className="tm-lactions">
          <button
            type="button"
            className={`tm-icon-btn tm-icon-btn--bordered tm-lkebab tm-reveal${menu ? ' is-forced' : ''}`}
            aria-label="Opciones de la tarea"
            aria-haspopup="menu"
            aria-expanded={menu === 'menu'}
            onClick={(event) => actions.toggleMenu(task, 'menu', event.currentTarget, 'end')}
          >
            <Icon name="kebab" size={14} />
          </button>
          <CommentButton task={task} variant="list" reveal />
          <RunControls task={task} variant="list" />
        </span>
      </div>
      {expanded && !leaving ? (
        <SubtasksPanel parent={task} subtasks={subtasks} done={done} total={total} variant="list" parentTitle={title} />
      ) : null}
    </>
  )
})

/** Lista: one foldable group per column, a row per task with the card's actions. */
export function TaskListView({
  board,
  groups,
  tasks,
  allTasks,
  searchActive,
  showDescriptions,
  collapsed,
  onToggleCollapsed,
  flashTaskId,
  onCreateTask,
  onIntent,
  onOpenTask,
  onEditSource,
  onComment,
  onOpenPeoplePanel,
}: TaskListViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const coarse = useCoarsePointer()
  const [pending, setPending] = useState<PendingPlacement | null>(null)
  const [entering, setEntering] = useState(true)
  const model = useMemo(() => buildBoardModel(groups, tasks, allTasks, pending), [allTasks, groups, pending, tasks])

  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), ENTRY_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const isOpen = (column: BoardColumnModel) => !(collapsed[column.name] ?? column.count === 0)

  const { ui, actions, noteDragEnd } = useTaskInteractions({
    rootRef,
    snapshot: tasks,
    onIntent,
    onOpenTask,
    onEditSource,
    onComment,
    onOpenPeoplePanel,
    onMovedTo: (groupName) => {
      if (collapsed[groupName] ?? model.columns.find((column) => column.name === groupName)?.count === 0) {
        onToggleCollapsed(groupName, false)
      }
    },
  })


  const {
    draggingPath,
    target: dropTarget,
    touchDragging,
    ghostLabel,
    attachGhost,
    onCardDragStart,
    onCardDragEnd,
    columnHandlers,
    rootHandlers,
  } = useTaskDrag({
    rootRef,
    scrollRef,
    canDrag: (path) => (
      ui.pop?.path !== path && ui.menu?.path !== path && ui.renaming !== path && !ui.expanded.has(path) && !ui.leaving.has(path)
    ),
    labelOf: (path) => model.taskByPath.get(path)?.title ?? '',
    onGestureEnd: noteDragEnd,
    onDrop: (path: string, target: DropTarget) => {
      const column = model.columns.find((candidate) => candidate.key === target.column)
      if (!column) return
      const wasClosed = !isOpen(column)
      if (wasClosed) onToggleCollapsed(column.name, false)
      const order = placementOrder(column, path, wasClosed ? Number.MAX_SAFE_INTEGER : target.index)
      if (!order) return
      const placement: PendingPlacement = { taskPath: path, column: column.key, orderedPaths: order }
      setPending(placement)
      void actions.send({ kind: 'place-task', taskPath: path, orderedPaths: order, group: column.groupName, parentTaskName: '' }).then((ok) => {
        setPending((current) => (current === placement ? null : current))
        if (ok) actions.flashTask(path)
      })
    },
  })


  const targets = useMemo<MoveTarget[]>(
    () => model.columns.flatMap((column) => (column.group ? [{ key: column.key, name: column.name, color: column.color, count: column.count }] : [])),
    [model.columns],
  )
  const draggedColumn = draggingPath ? model.columnOfTask.get(draggingPath) ?? null : null

  return (
    <TaskActionsContext.Provider value={actions}>
      <div
        ref={rootRef}
        className={`tm-list${coarse ? ' tm-coarse' : ''}${touchDragging ? ' is-touch-dragging' : ''}`}
        {...rootHandlers}
      >
        <div ref={scrollRef} className="tm-list-scroll tm-scroll" data-tm-scroll>
          <div className="tm-list-inner">
            <div className="tm-lhead" aria-hidden="true">
              {HEADERS.map((label, index) => <span key={index}>{label}</span>)}
            </div>
            {model.columns.map((column, columnIndex) => {
              const open = isOpen(column)
              const isDropTarget = dropTarget?.column === column.key && draggedColumn !== column.key
              const delay = entering ? `${columnIndex * 50}ms` : '0ms'
              const draggedIndex = draggingPath ? column.tasks.findIndex((task) => task.filePath === draggingPath) : -1
              const slotIndex = dropTarget?.column === column.key && dropTarget.index !== draggedIndex ? dropTarget.index : null
              let otherIndex = 0
              return (
                <section
                  key={column.key}
                  className={`tm-lgroup${isDropTarget ? ' is-drop' : ''}${column.group ? '' : ' is-ungrouped'}`}
                  data-drop-group={column.key}
                  data-accent={column.group?.kind ?? 'none'}
                  aria-label={column.name}
                  style={{ '--tm-col': column.color || undefined, animationDelay: delay } as CSSProperties}
                  {...columnHandlers}
                >
                  <div className="tm-lgroup-stripe">
                    <div className="tm-stripe" style={{ animationDelay: delay }} />
                  </div>
                  <div className="tm-lgroup-head">
                    <button
                      type="button"
                      className={`tm-icon-btn tm-col-btn tm-lgroup-toggle${open ? ' is-open' : ''}`}
                      aria-label={`${open ? 'Plegar' : 'Expandir'} ${column.name}`}
                      aria-expanded={open}
                      onClick={() => onToggleCollapsed(column.name, open)}
                    >
                      <Icon name="chevronRight" size={14} strokeWidth={2.2} className="tm-chev-rot" />
                    </button>
                    <span className="tm-dot tm-lgroup-dot" />
                    <h2 className="tm-col-title" title={column.group?.hint}>{column.name}</h2>
                    <span className="tm-count-pill">{column.count}</span>
                    <span className="tm-grow" />
                    {column.group ? (
                      <button
                        type="button"
                        className="tm-lgroup-add"
                        aria-label={`Agregar tarea en ${column.name}`}
                        onClick={() => {
                          if (!open) onToggleCollapsed(column.name, false)
                          onCreateTask(column.name)
                        }}
                      >
                        <Icon name="plus" size={14} />
                        Agregar
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="tm-lgroup-body">
                      {column.tasks.map((task, taskIndex) => {
                        const path = task.filePath
                        const isDragged = path === draggingPath
                        const slotBefore = !isDragged && slotIndex === otherIndex
                        if (!isDragged) otherIndex += 1
                        const menuView = ui.menu?.path === path ? (ui.menu.view === 'prio' ? 'prio' : 'menu') : null
                        return (
                          <Fragment key={path}>
                            {slotBefore ? <div className="tm-lslot" aria-hidden="true" /> : null}
                            <TaskListRow
                              task={task}
                              board={board}
                              subtasks={model.subtasksByParent.get(path) ?? NO_SUBTASKS}
                              showDescriptions={showDescriptions}
                              pop={ui.pop?.path === path ? ui.pop.kind : null}
                              menu={menuView}
                              renaming={ui.renaming === path}
                              expanded={ui.expanded.has(path)}
                              leaving={ui.leaving.has(path)}
                              dragging={isDragged}
                              flashSignal={flashSignalFor(task, ui, flashTaskId)}
                              pendingTitle={ui.titles.get(path) ?? null}
                              entryDelayMs={entering ? columnIndex * 50 + 90 + taskIndex * 35 : 0}
                              coarse={coarse}
                              onDragStart={onCardDragStart}
                              onDragEnd={onCardDragEnd}
                            />
                          </Fragment>
                        )
                      })}
                      {slotIndex !== null && slotIndex >= otherIndex ? <div className="tm-lslot" aria-hidden="true" /> : null}
                      {column.tasks.length === 0 ? (
                        <div className="tm-lempty tm-pop-in">{searchActive ? 'Sin coincidencias' : 'Soltá una tarea acá'}</div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        </div>
        <TaskMenuLayer ui={ui} model={model} targets={targets} />
        {ghostLabel ? (
          <div ref={attachGhost} className="tm-drag-ghost" aria-hidden="true">
            <span>{ghostLabel}</span>
          </div>
        ) : null}
      </div>
    </TaskActionsContext.Provider>
  )
}
