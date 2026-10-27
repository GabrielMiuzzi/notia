import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Group, TaskItem } from '../../types/taskManagerTypes'
import { buildBoardModel, subtaskProgress, type BoardColumnModel } from '../card/taskDisplay'
import { useTaskInteractions, type TaskUiState } from '../card/taskInteractions'
import type { MoveTarget, TaskBoardActions } from '../card/taskViewTypes'
import { PhoneCard } from './PhoneCard'
import { PhoneTaskSheet, type PhoneTaskSheetView } from './PhoneTaskSheet'
import { PhoneIcon } from './phoneIcons'

export interface PhoneBoardProps extends TaskBoardActions {
  groups: Group[]
  /** Tasks after the search. */
  tasks: TaskItem[]
  allTasks: TaskItem[]
  searching: boolean
  flashTaskId: string | null
  /** The header (board, search, views) with the column chips inside. */
  renderHeader: (chips: ReactNode) => ReactNode
  onCreateTask: (groupName: string) => void
  onOpenDetail: (taskPath: string) => void
}

/** A horizontal swipe longer than this changes the column. */
const SWIPE_MIN_PX = 60
const SWIPE_MAX_DRIFT_PX = 50
const NO_SUBTASKS: TaskItem[] = []

function flashSignalFor(task: TaskItem, ui: TaskUiState, flashTaskId: string | null): string | null {
  if (ui.flash?.path === task.filePath) return `local-${ui.flash.seq}`
  if (flashTaskId && (task.id === flashTaskId || task.filePath === flashTaskId)) return `shell-${flashTaskId}`
  return null
}

/** Column the board opens on: the current sprint, else the first with tasks. */
function initialColumn(columns: BoardColumnModel[]): number {
  const sprint = columns.findIndex((column) => column.group?.kind === 'current-sprint')
  if (sprint >= 0) return sprint
  return Math.max(0, columns.findIndex((column) => column.count > 0))
}

/** «Mobile · Tablero»: one column at a time, chips and swipes to change it. */
export function PhoneBoard({
  groups,
  tasks,
  allTasks,
  searching,
  flashTaskId,
  renderHeader,
  onCreateTask,
  onOpenDetail,
  onIntent,
  onOpenTask,
  onEditSource,
  onComment,
  onOpenPeoplePanel,
}: PhoneBoardProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const model = useMemo(() => buildBoardModel(groups, tasks, allTasks, null), [allTasks, groups, tasks])
  const columns = model.columns
  const [columnIndex, setColumnIndex] = useState(() => initialColumn(columns))
  const [slide, setSlide] = useState<{ direction: 'left' | 'right'; seq: number } | null>(null)
  const [sheet, setSheet] = useState<{ path: string; view: PhoneTaskSheetView; fromTask: boolean } | null>(null)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const [entering, setEntering] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), 1200)
    return () => window.clearTimeout(timer)
  }, [])

  const { ui, actions } = useTaskInteractions({
    rootRef,
    snapshot: tasks,
    onIntent,
    onOpenTask,
    onEditSource,
    onComment,
    onOpenPeoplePanel,
    onMovedTo: (groupName) => {
      const target = columns.findIndex((column) => column.groupName === groupName)
      if (target >= 0) goTo(target)
    },
  })

  const index = Math.min(columnIndex, Math.max(0, columns.length - 1))
  const column = columns[index] ?? null

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(columns.length - 1, next))
    if (clamped === index) return
    setSlide((current) => ({ direction: clamped > index ? 'left' : 'right', seq: (current?.seq ?? 0) + 1 }))
    setColumnIndex(clamped)
  }

  const targets = useMemo<MoveTarget[]>(
    () => columns.flatMap((item) => (item.group ? [{ key: item.key, name: item.name, color: item.color, count: item.count }] : [])),
    [columns],
  )
  const sheetTask = sheet ? model.taskByPath.get(sheet.path) ?? null : null
  const closeSheet = () => setSheet(null)
  const run = (intent: Parameters<typeof actions.send>[0]) => {
    closeSheet()
    void actions.send(intent, intent && 'taskPath' in intent ? intent.taskPath : undefined)
  }

  const onPointerDown = (event: ReactPointerEvent) => {
    swipeRef.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: ReactPointerEvent) => {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MAX_DRIFT_PX) goTo(index + (dx < 0 ? 1 : -1))
  }

  const chips = (
    <div className="tmp-chips" role="tablist" aria-label="Columnas">
      {columns.map((item, position) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={position === index}
          className={`tmp-col-chip${position === index ? ' is-on' : ''}`}
          onClick={() => goTo(position)}
        >
          <span className="tmp-dot" style={{ background: item.color || 'var(--tm-slate)' }} />
          {item.name}
          <span className="tmp-col-chip-count">{item.count}</span>
        </button>
      ))}
    </div>
  )

  const addLabel = column?.group ? column.name : groups[0]?.name ?? ''
  const addHere = () => {
    if (addLabel) onCreateTask(column?.group ? column.groupName : addLabel)
  }

  return (
    <div ref={rootRef} className="tmp-screen">
      {renderHeader(chips)}
      <main className="tmp-main tmp-main--board" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipeRef.current = null }}>
        {column ? (
          <section
            key={`${column.key}-${slide?.seq ?? 0}`}
            className={`tmp-column${slide ? ` is-in-${slide.direction}` : ''}`}
            aria-label={column.name}
            style={{ '--tm-col': column.color || undefined } as CSSProperties}
          >
            <div className="tmp-stripe" />
            <div className="tmp-column-head">
              <button type="button" className="tmp-icon-btn tmp-column-nav" aria-label="Columna anterior" disabled={index === 0} onClick={() => goTo(index - 1)}>
                <PhoneIcon name="chevronLeft" size={15} strokeWidth={2.4} />
              </button>
              <h1 className="tmp-column-title">{column.name}</h1>
              <span className="tmp-count">{column.count}</span>
              <span className="tmp-grow" />
              <span className="tmp-column-pos">{index + 1} / {columns.length}</span>
              <button type="button" className="tmp-icon-btn tmp-column-nav" aria-label="Columna siguiente" disabled={index >= columns.length - 1} onClick={() => goTo(index + 1)}>
                <PhoneIcon name="chevronRight" size={15} strokeWidth={2.4} />
              </button>
            </div>
            <div className="tmp-column-body">
              {column.tasks.map((task, position) => {
                const { done, total } = subtaskProgress(task, model.subtasksByParent.get(task.filePath) ?? NO_SUBTASKS)
                return (
                  <PhoneCard
                    key={task.filePath}
                    task={task}
                    done={done}
                    total={total}
                    showDescription
                    leaving={ui.leaving.has(task.filePath)}
                    flashSignal={flashSignalFor(task, ui, flashTaskId)}
                    entryDelayMs={entering ? 120 + position * 70 : 0}
                    onOpenPriority={(item) => setSheet({ path: item.filePath, view: 'prio', fromTask: false })}
                    onOpenMenu={(item) => setSheet({ path: item.filePath, view: 'task', fromTask: false })}
                    onOpenDetail={(item) => onOpenDetail(item.filePath)}
                    onStart={(item) => void actions.send({ kind: 'start-task', taskPath: item.filePath }, item.filePath)}
                    onPause={(item) => void actions.send({ kind: 'pause-task', taskPath: item.filePath }, item.filePath)}
                    onFinish={(item) => actions.leave(item, 'finish')}
                  />
                )
              })}
              {column.tasks.length === 0 ? (
                <div className="tmp-empty tmp-pop">
                  <strong>{searching ? 'Sin coincidencias' : `Sin tareas en ${column.name}`}</strong>
                  <span>{searching ? 'Probá con otra palabra' : 'Usá «Mover a» desde otra tarea o agregá una nueva'}</span>
                </div>
              ) : null}
              {addLabel ? (
                <button type="button" className="tmp-add-row" onClick={addHere}>
                  <PhoneIcon name="plus" size={15} strokeWidth={2.2} />
                  Agregar en {addLabel}
                </button>
              ) : null}
            </div>
          </section>
        ) : (
          <div className="tmp-empty"><strong>Este tablero no tiene columnas</strong></div>
        )}
        {columns.length > 1 ? <p className="tmp-hint">Deslizá de costado para cambiar de columna</p> : null}
      </main>
      {addLabel ? (
        <button type="button" className="tmp-fab" aria-label={`Nueva tarea en ${addLabel}`} onClick={addHere}>
          <PhoneIcon name="plus" size={24} strokeWidth={2.6} />
        </button>
      ) : null}
      {sheet && sheetTask ? (
        <PhoneTaskSheet
          task={sheetTask}
          view={sheet.view}
          fromTask={sheet.fromTask}
          columnColor={columns.find((item) => item.groupName === sheetTask.group)?.color ?? 'var(--tm-slate)'}
          targets={targets}
          onView={(view) => setSheet({ path: sheetTask.filePath, view, fromTask: view !== 'task' || sheet.fromTask })}
          onClose={closeSheet}
          onStart={() => run({ kind: 'start-task', taskPath: sheetTask.filePath })}
          onPause={() => run({ kind: 'pause-task', taskPath: sheetTask.filePath })}
          onUnblock={() => run({ kind: 'unblock-task', taskPath: sheetTask.filePath })}
          onFinish={() => { closeSheet(); actions.leave(sheetTask, 'finish') }}
          onPriority={(priority) => {
            closeSheet()
            void actions.send({ kind: 'change-priority', taskPath: sheetTask.filePath, priority }, sheetTask.filePath).then((ok) => {
              if (ok) actions.flashTask(sheetTask.filePath)
            })
          }}
          onMove={(group) => { closeSheet(); actions.moveTo(sheetTask, group) }}
          onOpenDetail={() => { closeSheet(); onOpenDetail(sheetTask.filePath) }}
          onDuplicate={() => run({ kind: 'duplicate-task', taskPath: sheetTask.filePath })}
          onCancel={() => { closeSheet(); actions.leave(sheetTask, 'cancel') }}
          onDelete={() => { closeSheet(); actions.leave(sheetTask, 'delete') }}
        />
      ) : null}
    </div>
  )
}
