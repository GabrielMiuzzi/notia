import { memo } from 'react'
import type { TaskItem } from '../../types/taskManagerTypes'
import { useFlash, useNow } from '../card/cardHooks'
import { formatElapsed, isBlocked, isPending, isRunning, liveDedicatedHours, plainTextPreview, priorityLabel, priorityTone, summarizeTime } from '../card/taskDisplay'
import { KebabIcon, PauseIcon, PhoneIcon, PlayIcon } from './phoneIcons'
import { PersonStack, TimeRing } from './phoneParts'

export interface PhoneCardProps {
  task: TaskItem
  done: number
  total: number
  showDescription: boolean
  leaving: boolean
  flashSignal: string | null
  entryDelayMs: number
  onOpenPriority: (task: TaskItem) => void
  onOpenMenu: (task: TaskItem) => void
  onOpenDetail: (task: TaskItem) => void
  onStart: (task: TaskItem) => void
  onPause: (task: TaskItem) => void
  onFinish: (task: TaskItem) => void
}

function peopleLabel(names: string[]): string {
  if (names.length === 1) return names[0].split(' ')[0]
  return names.length > 3 ? `+${names.length - 3}` : ''
}

/** A task of the phone's Tablero (canvas «Mobile · Tablero»). */
export const PhoneCard = memo(function PhoneCard({
  task,
  done,
  total,
  showDescription,
  leaving,
  flashSignal,
  entryDelayMs,
  onOpenPriority,
  onOpenMenu,
  onOpenDetail,
  onStart,
  onPause,
  onFinish,
}: PhoneCardProps) {
  const running = isRunning(task)
  const now = useNow(running)
  const { ref, flashing } = useFlash<HTMLElement>(flashSignal)
  const time = summarizeTime(liveDedicatedHours(task, now), task.estimatedHours)
  const description = showDescription ? plainTextPreview(task.preview) : ''
  const people = task.people ?? []
  const tone = priorityTone(task.priority)
  const classes = ['tmp-card', flashing ? 'is-flash' : '', leaving ? 'is-leaving' : ''].filter(Boolean).join(' ')

  return (
    <article ref={ref} className={classes} data-task-path={task.filePath} aria-label={task.title} style={{ animationDelay: `${entryDelayMs}ms` }}>
      <div className="tmp-card-top">
        <button
          type="button"
          className={`tmp-prio tmp-prio--${tone}`}
          aria-label={`Prioridad ${priorityLabel(task.priority)}. Cambiar`}
          onClick={() => onOpenPriority(task)}
        >
          <span className="tmp-prio-dot" />
          {priorityLabel(task.priority)}
        </button>
        {running ? (
          <span className="tmp-chip tmp-chip--run tmp-pop">
            <span className="tmp-pulse-dot" />
            {formatElapsed(task, now) || 'En progreso'}
          </span>
        ) : null}
        {isBlocked(task) ? (
          <span className="tmp-chip tmp-chip--blocked tmp-pop">
            <PhoneIcon name="lock" size={11} strokeWidth={2.6} />
            Bloqueada
          </span>
        ) : null}
        <span className="tmp-grow" />
        <TimeRing time={time} size={32} />
        <button type="button" className="tmp-icon-btn tmp-card-kebab" aria-label={`Opciones de ${task.title}`} onClick={() => onOpenMenu(task)}>
          <KebabIcon />
        </button>
      </div>
      {task.project ? (
        <span className="tmp-card-project" style={{ ['--tmp-project' as string]: task.projectColor ?? undefined }}>
          <PhoneIcon name="folder" size={12} strokeWidth={2.2} className="tmp-project-icon" />
          {task.project}
        </span>
      ) : null}
      <button type="button" className="tmp-card-title tmp-clamp2" onClick={() => onOpenDetail(task)}>{task.title}</button>
      {description ? <p className="tmp-card-desc tmp-clamp2">{description}</p> : null}
      {isBlocked(task) && task.blockNote ? (
        <div className="tmp-block-note">
          <PhoneIcon name="alert" size={13} strokeWidth={2.2} />
          <span>{task.blockNote}</span>
        </div>
      ) : null}
      <div className="tmp-card-foot">
        {people.length ? (
          <span className="tmp-card-people">
            <PersonStack people={people} size={24} />
            {peopleLabel(people.map((person) => person.name))}
          </span>
        ) : null}
        {total > 0 ? (
          <span className={`tmp-card-subs${done === total ? ' is-done' : ''}`}>
            <PhoneIcon name="tasks" size={13} />
            {done}/{total}
          </span>
        ) : null}
        <span className="tmp-grow" />
        {isPending(task) ? (
          <button type="button" className="tmp-run-btn" onClick={() => onStart(task)}>
            <PlayIcon />
            Iniciar
          </button>
        ) : null}
        {running ? (
          <>
            <button type="button" className="tmp-run-btn tmp-run-btn--icon tmp-pop" aria-label="Pausar" onClick={() => onPause(task)}>
              <PauseIcon />
            </button>
            <button type="button" className="tmp-run-btn tmp-run-btn--primary tmp-pop" onClick={() => onFinish(task)}>
              <PhoneIcon name="check" size={13} strokeWidth={2.8} />
              Finalizar
            </button>
          </>
        ) : null}
      </div>
    </article>
  )
})
