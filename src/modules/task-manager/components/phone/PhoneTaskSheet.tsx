import type { TaskItem, TaskPriority } from '../../types/taskManagerTypes'
import { useNow } from '../card/cardHooks'
import { isBlocked, isPending, isRunning, liveDedicatedHours, PRIORITY_OPTIONS, priorityLabel, priorityTone, summarizeTime, formatHourNumber } from '../card/taskDisplay'
import type { MoveTarget } from '../card/taskViewTypes'
import { PhoneSheet, PhoneSheetTitle } from './PhoneSheet'
import { PauseIcon, PhoneIcon, PlayIcon, type PhoneIconName } from './phoneIcons'

export type PhoneTaskSheetView = 'task' | 'prio' | 'move'

interface PhoneTaskSheetProps {
  task: TaskItem
  view: PhoneTaskSheetView
  /** The sheet opened on this view from the task's options: «Volver» goes back. */
  fromTask: boolean
  columnColor: string
  /** Columns of the board for «Mover a»; empty hides the row. */
  targets: MoveTarget[]
  onView: (view: PhoneTaskSheetView) => void
  onClose: () => void
  onStart: () => void
  onPause: () => void
  onUnblock: () => void
  onFinish: () => void
  onPriority: (priority: TaskPriority) => void
  onMove: (group: string) => void
  onOpenDetail: () => void
  onDuplicate: () => void
  onCancel: () => void
  onDelete: () => void
}

function RowIcon({ name }: { name: PhoneIconName }) {
  return <PhoneIcon name={name} size={18} className="tmp-row-icon" />
}

function Chevron() {
  return <PhoneIcon name="chevronRight" size={14} strokeWidth={2.4} className="tmp-row-chevron" />
}

/** Options, priority and «Mover a» of a task (sheets of «Mobile · Tablero»). */
export function PhoneTaskSheet(props: PhoneTaskSheetProps) {
  const { task, view, fromTask, onView, onClose } = props
  const label = view === 'task' ? 'Opciones de la tarea' : view === 'prio' ? 'Prioridad' : 'Mover a'
  return (
    <PhoneSheet label={label} onClose={onClose}>
      {view === 'task' ? <TaskOptions {...props} /> : null}
      {view === 'prio' ? (
        <>
          <PhoneSheetTitle title="Prioridad" onBack={fromTask ? () => onView('task') : undefined} />
          <PriorityChoices current={task.priority} onPick={props.onPriority} />
        </>
      ) : null}
      {view === 'move' ? (
        <>
          <PhoneSheetTitle title="Mover a" onBack={() => onView('task')} />
          <div className="tmp-group" role="radiogroup" aria-label="Columnas">
            {props.targets.map((target) => {
              const current = target.name === task.group
              return (
                <button
                  key={target.key}
                  type="button"
                  role="radio"
                  aria-checked={current}
                  className={`tmp-row${current ? ' is-current' : ''}`}
                  onClick={() => props.onMove(target.name)}
                >
                  <span className="tmp-square" style={{ background: target.color }} />
                  <span className="tmp-row-label">{target.name}</span>
                  <span className="tmp-row-value">{target.count}</span>
                  {current ? <PhoneIcon name="check" size={17} strokeWidth={2.6} className="tmp-tick" /> : null}
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </PhoneSheet>
  )
}

/** The priorities as large radio rows, also for the detail screen. */
export function PriorityChoices({ current, onPick }: { current: TaskPriority | ''; onPick: (priority: TaskPriority) => void }) {
  return (
    <div className="tmp-prio-list" role="radiogroup" aria-label="Prioridad">
      {PRIORITY_OPTIONS.map((option) => {
        const checked = option.name === current
        return (
          <button
            key={option.name}
            type="button"
            role="radio"
            aria-checked={checked}
            className={`tmp-prio-option tmp-prio--${option.tone}${checked ? ' is-current' : ''}`}
            onClick={() => onPick(option.name)}
          >
            <span className="tmp-prio-option-dot" />
            <span className="tmp-row-text">
              <span className="tmp-prio-option-name">{option.name}</span>
              <span className="tmp-row-sub">{option.description}</span>
            </span>
            {checked ? <PhoneIcon name="check" size={18} strokeWidth={2.6} className="tmp-tick" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function TaskOptions({
  task,
  columnColor,
  targets,
  onView,
  onStart,
  onPause,
  onUnblock,
  onFinish,
  onOpenDetail,
  onDuplicate,
  onCancel,
  onDelete,
}: PhoneTaskSheetProps) {
  const running = isRunning(task)
  const now = useNow(running)
  const time = summarizeTime(liveDedicatedHours(task, now), task.estimatedHours)
  const people = task.people?.map((person) => person.name.split(' ')[0]) ?? task.assignees ?? []
  const tone = priorityTone(task.priority)
  return (
    <>
      <div className="tmp-sheet-head">
        <span className="tmp-sheet-kicker">
          <span className="tmp-dot" style={{ background: columnColor }} />
          {task.group || 'Sin grupo'}
          {task.project ? <span>· {task.project}</span> : null}
        </span>
        <span className="tmp-sheet-heading">{task.title}</span>
      </div>
      <div className="tmp-sheet-pair">
        {isPending(task) ? (
          <>
            <button type="button" className="tmp-btn tmp-btn--primary" onClick={onStart}><PlayIcon size={15} />Iniciar</button>
            <button type="button" className="tmp-btn tmp-btn--outline" onClick={onFinish}><PhoneIcon name="check" size={15} strokeWidth={2.6} />Finalizar</button>
          </>
        ) : null}
        {running ? (
          <>
            <button type="button" className="tmp-btn tmp-btn--outline" onClick={onPause}><PauseIcon size={13} />Pausar</button>
            <button type="button" className="tmp-btn tmp-btn--primary" onClick={onFinish}><PhoneIcon name="check" size={15} strokeWidth={2.6} />Finalizar</button>
          </>
        ) : null}
        {isBlocked(task) ? (
          <button type="button" className="tmp-btn tmp-btn--outline tmp-btn--wide" onClick={onUnblock}><PhoneIcon name="unlock" size={15} strokeWidth={2.2} />Desbloquear</button>
        ) : null}
      </div>
      <div className="tmp-group">
        <button type="button" className="tmp-row" onClick={() => onView('prio')}>
          <RowIcon name="flag" />
          <span className="tmp-row-label">Prioridad</span>
          <span className={`tmp-prio tmp-prio--${tone} tmp-prio--static`}><span className="tmp-prio-dot" />{priorityLabel(task.priority)}</span>
          <Chevron />
        </button>
        {targets.length ? (
          <button type="button" className="tmp-row" onClick={() => onView('move')}>
            <RowIcon name="arrowRight" />
            <span className="tmp-row-label">Mover a</span>
            <span className="tmp-row-value">{task.group || 'Sin grupo'}</span>
            <Chevron />
          </button>
        ) : null}
        <button type="button" className="tmp-row" onClick={onOpenDetail}>
          <RowIcon name="personAdd" />
          <span className="tmp-row-label">Personas</span>
          <span className="tmp-row-value">{people.length ? people.join(', ') : 'Sin asignar'}</span>
          <Chevron />
        </button>
        <button type="button" className="tmp-row" onClick={onOpenDetail}>
          <RowIcon name="folder" />
          <span className="tmp-row-label">Proyecto</span>
          <span className="tmp-row-value">{task.project || 'Sin proyecto'}</span>
          <Chevron />
        </button>
        <button type="button" className="tmp-row" onClick={onOpenDetail}>
          <RowIcon name="clock" />
          <span className="tmp-row-label">Tiempo</span>
          <span className="tmp-row-value tmp-tabular">
            {time.hasEstimate ? `${formatHourNumber(time.spent)} / ${formatHourNumber(time.estimate)} h` : `${formatHourNumber(time.spent)} h · sin estimar`}
          </span>
          <Chevron />
        </button>
        <button type="button" className="tmp-row tmp-row--accent" onClick={onOpenDetail}>
          <PhoneIcon name="external" size={18} className="tmp-row-icon" />
          <span className="tmp-row-label">Abrir detalle completo</span>
        </button>
      </div>
      <div className="tmp-group tmp-group--gap">
        <button type="button" className="tmp-row tmp-row--compact" onClick={onDuplicate}>
          <RowIcon name="copy" />
          <span className="tmp-row-label">Duplicar</span>
        </button>
        <button type="button" className="tmp-row tmp-row--compact" onClick={onCancel}>
          <RowIcon name="cancel" />
          <span className="tmp-row-label">Desestimar</span>
          <span className="tmp-row-value">a Canceladas</span>
        </button>
        <button type="button" className="tmp-row tmp-row--compact tmp-row--danger" onClick={onDelete}>
          <PhoneIcon name="trash" size={18} className="tmp-row-icon" />
          <span className="tmp-row-label">Eliminar</span>
        </button>
      </div>
    </>
  )
}
