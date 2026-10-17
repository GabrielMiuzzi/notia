import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Group, TaskItem } from '../../types/taskManagerTypes'
import '../../styles/taskManagerTokens.css'
import '../../styles/taskCard.css'
import '../../styles/taskBoard.css'
import { useCoarsePointer } from '../card/cardHooks'
import { FixedMenu } from '../card/FixedMenu'
import { Icon } from '../card/icons'
import { TaskCard } from '../card/TaskCard'
import { buildBoardModel, placementOrder, type BoardColumnModel, type PendingPlacement } from '../card/taskDisplay'
import { TaskActionsContext, useTaskInteractions, type TaskUiState } from '../card/taskInteractions'
import { TaskMenuLayer } from '../card/TaskMenuLayer'
import type { MenuAnchor, MoveTarget, TaskViewDataProps } from '../card/taskViewTypes'
import { useTaskDrag, type DropTarget } from '../card/useTaskDrag'

export type { TaskBoardActions } from '../card/taskViewTypes'

export interface TaskKanbanViewProps extends TaskViewDataProps {
  onCreateGroup: () => void
  onEditGroup: (group: Group) => void
  onDeleteGroup: (group: Group) => void
}

interface ColumnMenuState {
  key: string
  anchor: MenuAnchor
  trigger: HTMLElement
}

/** Entry animations play while the view appears, not on every reload. */
const ENTRY_WINDOW_MS = 1200
const NO_SUBTASKS: TaskItem[] = []

function flashSignalFor(task: TaskItem, ui: TaskUiState, flashTaskId: string | null): string | null {
  if (ui.flash?.path === task.filePath) return `local-${ui.flash.seq}`
  if (flashTaskId && (task.id === flashTaskId || task.filePath === flashTaskId)) return `shell-${flashTaskId}`
  return null
}

/** Tablero: one row of 288 px columns with drag and drop between and inside them. */
export function TaskKanbanView({
  board,
  groups,
  tasks,
  allTasks,
  searchActive,
  showDescriptions,
  collapsed,
  onToggleCollapsed,
  flashTaskId,
  canEdit,
  onCreateTask,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  onIntent,
  onOpenTask,
  onEditSource,
  onComment,
  onOpenPeoplePanel,
}: TaskKanbanViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const coarse = useCoarsePointer()
  const [pending, setPending] = useState<PendingPlacement | null>(null)
  const [entering, setEntering] = useState(true)
  const [columnMenu, setColumnMenu] = useState<ColumnMenuState | null>(null)
  const model = useMemo(() => buildBoardModel(groups, tasks, allTasks, pending), [allTasks, groups, pending, tasks])

  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), ENTRY_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const isCollapsed = (column: BoardColumnModel) => collapsed[column.name] ?? column.count === 0

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
      const wasCollapsed = isCollapsed(column)
      if (wasCollapsed) onToggleCollapsed(column.name, false)
      const order = placementOrder(column, path, wasCollapsed ? Number.MAX_SAFE_INTEGER : target.index)
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
  const menuColumn = columnMenu ? model.columns.find((column) => column.key === columnMenu.key) ?? null : null
  const menuGroupIndex = menuColumn?.group ? groups.findIndex((group) => group.name === menuColumn.name) : -1

  const closeColumnMenu = (restoreFocus: boolean) => {
    const trigger = columnMenu?.trigger
    setColumnMenu(null)
    if (restoreFocus && trigger?.isConnected) trigger.focus()
  }

  const toggleColumnMenu = (column: BoardColumnModel, trigger: HTMLElement) => {
    if (columnMenu?.key === column.key) {
      setColumnMenu(null)
      return
    }
    const rect = trigger.getBoundingClientRect()
    actions.closeMenu(false)
    setColumnMenu({ key: column.key, trigger, anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } })
  }

  const runColumnAction = (action: () => void) => {
    closeColumnMenu(true)
    action()
  }

  return (
    <TaskActionsContext.Provider value={actions}>
      <div
        ref={rootRef}
        className={`tm-kanban${coarse ? ' tm-coarse' : ''}${touchDragging ? ' is-touch-dragging' : ''}`}
        {...rootHandlers}
      >
        <div ref={scrollRef} className="tm-board-scroll tm-scroll" data-tm-scroll>
          {model.columns.map((column, columnIndex) => {
            const style = {
              '--tm-col': column.color || undefined,
              animationDelay: entering ? `${columnIndex * 70}ms` : '0ms',
            } as CSSProperties
            const isDropTarget = dropTarget?.column === column.key && draggedColumn !== column.key
            const dropClass = isDropTarget ? ' is-drop' : ''
            const ungroupedClass = column.group ? '' : ' is-ungrouped'
            if (isCollapsed(column)) {
              return (
                <section
                  key={column.key}
                  className={`tm-col is-collapsed${dropClass}${ungroupedClass}`}
                  data-drop-group={column.key}
                  data-accent={column.group?.kind ?? 'none'}
                  aria-label={`${column.name}, plegada`}
                  style={style}
                  {...columnHandlers}
                >
                  <div className="tm-stripe" style={{ animationDelay: style.animationDelay }} />
                  <button
                    type="button"
                    className="tm-icon-btn tm-col-btn"
                    aria-label={`Expandir ${column.name}`}
                    onClick={() => onToggleCollapsed(column.name, false)}
                  >
                    <Icon name="chevronsRight" size={14} />
                  </button>
                  <span className="tm-col-vertical" title={column.group?.hint}>{column.name}</span>
                  <span className="tm-count-pill is-muted">{column.count}</span>
                </section>
              )
            }
            const draggedIndex = draggingPath ? column.tasks.findIndex((task) => task.filePath === draggingPath) : -1
            const slotIndex = dropTarget?.column === column.key && dropTarget.index !== draggedIndex ? dropTarget.index : null
            let otherIndex = 0
            return (
              <section
                key={column.key}
                className={`tm-col${dropClass}${ungroupedClass}`}
                data-drop-group={column.key}
                data-accent={column.group?.kind ?? 'none'}
                aria-label={column.name}
                style={style}
                {...columnHandlers}
              >
                <div className="tm-col-head-wrap">
                  <div className="tm-stripe" style={{ animationDelay: style.animationDelay }} />
                  <div className="tm-col-head">
                    <h2 className="tm-col-title" title={column.group?.hint}>{column.name}</h2>
                    <span className="tm-count-pill">{column.count}</span>
                    <span className="tm-grow" />
                    {column.group ? (
                      <button
                        type="button"
                        className="tm-icon-btn tm-col-btn"
                        aria-label={`Agregar tarea en ${column.name}`}
                        onClick={() => onCreateTask(column.name)}
                      >
                        <Icon name="plus" size={15} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="tm-icon-btn tm-col-btn"
                      aria-label={`Plegar ${column.name}`}
                      onClick={() => onToggleCollapsed(column.name, true)}
                    >
                      <Icon name="chevronsLeft" size={14} />
                    </button>
                    {column.group && canEdit ? (
                      <button
                        type="button"
                        className="tm-icon-btn tm-col-btn"
                        aria-label={`Opciones de ${column.name}`}
                        aria-haspopup="menu"
                        aria-expanded={columnMenu?.key === column.key}
                        onClick={(event) => toggleColumnMenu(column, event.currentTarget)}
                      >
                        <Icon name="kebab" size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="tm-col-body">
                  {column.tasks.map((task, taskIndex) => {
                    const path = task.filePath
                    const isDragged = path === draggingPath
                    const slotBefore = !isDragged && slotIndex === otherIndex
                    if (!isDragged) otherIndex += 1
                    const menuView = ui.menu?.path === path ? (ui.menu.view === 'prio' ? 'prio' : 'menu') : null
                    return (
                      <Fragment key={path}>
                        {slotBefore ? <div className="tm-drop-slot" aria-hidden="true" /> : null}
                        <TaskCard
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
                          entryDelayMs={entering ? columnIndex * 70 + 160 + taskIndex * 60 : 0}
                          coarse={coarse}
                          onDragStart={onCardDragStart}
                          onDragEnd={onCardDragEnd}
                        />
                      </Fragment>
                    )
                  })}
                  {slotIndex !== null && slotIndex >= otherIndex ? <div className="tm-drop-slot" aria-hidden="true" /> : null}
                  {column.tasks.length === 0 ? (
                    <div className="tm-col-empty tm-pop-in">{searchActive ? 'Sin coincidencias' : 'Soltá una tarea acá'}</div>
                  ) : null}
                  {column.group ? (
                    <button type="button" className="tm-col-add" onClick={() => onCreateTask(column.name)}>
                      <Icon name="plus" size={14} />
                      Agregar tarea
                    </button>
                  ) : null}
                </div>
              </section>
            )
          })}
          {canEdit ? (
            <button type="button" className="tm-col-new" onClick={onCreateGroup}>
              <Icon name="plus" size={15} />
              Nueva columna
            </button>
          ) : null}
        </div>
        <TaskMenuLayer ui={ui} model={model} targets={targets} />
        {columnMenu && menuColumn?.group ? (
          <FixedMenu
            anchor={columnMenu.anchor}
            align="end"
            width={232}
            estimatedHeight={200}
            role="menu"
            ariaLabel={`Opciones de ${menuColumn.name}`}
            trigger={columnMenu.trigger}
            focusKey={columnMenu.key}
            onClose={closeColumnMenu}
          >
            <button type="button" role="menuitem" className="tm-mi" onClick={() => runColumnAction(() => onEditGroup(menuColumn.group!))}>
              <Icon name="pencil" size={15} className="tm-mi-icon" />
              <span className="tm-grow">Editar columna</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="tm-mi"
              disabled={menuGroupIndex <= 0}
              onClick={() => runColumnAction(() => void actions.send({ kind: 'move-group', board: board.name, name: menuColumn.name, direction: 'left' }))}
            >
              <Icon name="arrowLeft" size={15} className="tm-mi-icon" />
              <span className="tm-grow">Mover a la izquierda</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="tm-mi"
              disabled={menuGroupIndex < 0 || menuGroupIndex >= groups.length - 1}
              onClick={() => runColumnAction(() => void actions.send({ kind: 'move-group', board: board.name, name: menuColumn.name, direction: 'right' }))}
            >
              <Icon name="arrowRight" size={15} className="tm-mi-icon" />
              <span className="tm-grow">Mover a la derecha</span>
            </button>
            <span className="tm-fmenu-sep" role="separator" />
            <button type="button" role="menuitem" className="tm-mi is-coral" onClick={() => runColumnAction(() => onDeleteGroup(menuColumn.group!))}>
              <Icon name="trash" size={15} className="tm-mi-icon" />
              <span className="tm-grow">Eliminar columna</span>
            </button>
          </FixedMenu>
        ) : null}
        {ghostLabel ? (
          <div ref={attachGhost} className="tm-drag-ghost" aria-hidden="true">
            <span>{ghostLabel}</span>
          </div>
        ) : null}
      </div>
    </TaskActionsContext.Provider>
  )
}
