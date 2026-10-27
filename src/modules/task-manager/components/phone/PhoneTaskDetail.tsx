import { useEffect, useMemo, useRef, useState } from 'react'
import { readTaskDetail, type TaskBoardIntent, type TaskDetail, type TaskManagerBackendContext } from '../../services/taskManagerService'
import type { Board, TaskItem, TaskPriority } from '../../types/taskManagerTypes'
import { useNow } from '../card/cardHooks'
import {
  formatElapsed,
  formatHourNumber,
  isBlocked,
  isPending,
  isRunning,
  liveDedicatedHours,
  plainTextPreview,
  priorityLabel,
  priorityTone,
  stepHours,
  summarizeTime,
} from '../card/taskDisplay'
import type { MoveTarget } from '../card/taskViewTypes'
import { PhoneSheet, PhoneSheetTitle } from './PhoneSheet'
import { PriorityChoices } from './PhoneTaskSheet'
import { KebabIcon, PauseIcon, PhoneIcon, PlayIcon, type PhoneIconName } from './phoneIcons'

export interface PhoneTaskDetailProps {
  /** The task as the board sends it; null once it left the open tasks. */
  task: TaskItem | null
  subtasks: TaskItem[]
  board: Board
  columnColor: string
  targets: MoveTarget[]
  context: TaskManagerBackendContext | null
  /** Changes with every board the backend sends: the comments are read again. */
  generation: number
  onIntent: (intent: TaskBoardIntent) => Promise<unknown>
  onBack: () => void
  onOpenNote: (task: TaskItem) => void
  onUndo: () => void
}

type Sheet = 'prio' | 'menu' | 'move' | 'project' | 'people' | null
type Ending = 'finish' | 'cancel' | 'delete'

const QUICK_ESTIMATES = [1, 2, 4, 8, 16]
const ENDING_LABEL: Record<Ending, string> = {
  finish: 'Finalizada · en Completadas',
  cancel: 'Desestimada · en Canceladas',
  delete: 'Tarea eliminada',
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** «Mobile · Detalle de tarea»: everything of one task on one screen. */
export function PhoneTaskDetail({
  task: liveTask,
  subtasks,
  board,
  columnColor,
  targets,
  context,
  generation,
  onIntent,
  onBack,
  onOpenNote,
  onUndo,
}: PhoneTaskDetailProps) {
  // The last task seen: a finished task still shows while its banner offers «Deshacer».
  const [lastTask, setLastTask] = useState<TaskItem | null>(liveTask)
  if (liveTask && liveTask !== lastTask) setLastTask(liveTask)
  const task = liveTask ?? lastTask
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [newSubtask, setNewSubtask] = useState('')
  const [newComment, setNewComment] = useState('')
  const [pickerQuery, setPickerQuery] = useState('')
  const [ending, setEnding] = useState<Ending | null>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const running = task ? isRunning(task) : false
  const now = useNow(running)
  const path = task?.filePath ?? ''

  useEffect(() => {
    if (!context || !path) return undefined
    let active = true
    readTaskDetail(context, path)
      .then((value) => { if (active) setDetail(value) })
      .catch(() => { if (active) setDetail((current) => current ?? { description: '', comments: [] }) })
    return () => { active = false }
  }, [context, generation, path])

  // Back from a finished task when its undo window is over and the board no longer has it.
  useEffect(() => {
    if (liveTask) setEnding(null)
  }, [liveTask])

  const description = useMemo(
    () => (detail?.description ?? '').split(/\n\s*\n/).map(plainTextPreview).filter(Boolean),
    [detail?.description],
  )

  if (!task) {
    return (
      <div className="tmp-screen tmp-detail">
        <header className="tmp-detail-head">
          <button type="button" className="tmp-back" onClick={onBack}><PhoneIcon name="chevronLeft" size={20} strokeWidth={2.2} />Volver</button>
        </header>
        <div className="tmp-empty"><strong>La tarea ya no está en el tablero</strong></div>
      </div>
    )
  }

  const send = (intent: TaskBoardIntent) => void onIntent(intent).catch(() => undefined)
  const end = (kind: Ending) => {
    setSheet(null)
    setEnding(kind)
    send({ kind: kind === 'finish' ? 'finish-task' : kind === 'cancel' ? 'cancel-task' : 'delete-task', taskPath: path })
  }
  const time = summarizeTime(liveDedicatedHours(task, now), task.estimatedHours)
  const tone = priorityTone(task.priority)
  const people = task.people ?? []
  const assigned = task.assignees ?? people.map((person) => person.name)
  const projectColor = task.project ? task.projectColor ?? 'var(--tm-muted)' : null
  const doneSubtasks = subtasks.filter((subtask) => subtask.state === 'Finalizada').length
  const ringRadius = 43
  const ringLength = 2 * Math.PI * ringRadius
  const ringOffset = time.hasEstimate ? ringLength * (1 - Math.min(1, time.ratio)) : ringLength
  const timeStatus = !time.hasEstimate
    ? 'Sin estimación'
    : time.over ? `+${formatHourNumber(time.spent - time.estimate)} h excedido` : `Faltan ${formatHourNumber(time.estimate - time.spent)} h`

  const setTime = (field: 'estimatedHours' | 'dedicatedHours', value: number) => {
    send({ kind: 'set-task-time', taskPath: path, [field]: value })
  }
  const saveTitle = () => {
    const title = (editing ?? '').trim().replace(/\s+/g, ' ')
    setEditing(null)
    if (title && title !== task.title) send({ kind: 'rename-task', taskPath: path, title })
  }
  const addSubtask = () => {
    const title = newSubtask.trim()
    if (!title) return
    setNewSubtask('')
    send({ kind: 'add-subtask', taskPath: path, title })
  }
  const sendComment = () => {
    const comment = newComment.trim()
    if (!comment) return
    setNewComment('')
    void onIntent({ kind: 'add-comment', taskPath: path, comment })
      .then(() => context && readTaskDetail(context, path).then(setDetail))
      .catch(() => setNewComment(comment))
  }
  const closeSheet = () => {
    setSheet(null)
    setPickerQuery('')
  }
  const query = fold(pickerQuery)
  const projects = board.projects.filter((project) => !query || fold(project.name).includes(query))
  const canCreateProject = sheet === 'project' && query.length > 0 && !board.projects.some((project) => fold(project.name) === query)
  const members = board.members.filter((member) => !query || fold(member.name).includes(query))

  const menu: Array<{ label: string; icon: PhoneIconName; hint?: string; danger?: boolean; run: () => void }> = [
    ...(targets.length ? [{ label: 'Mover a otra columna', icon: 'arrowRight' as const, hint: task.group || 'Sin grupo', run: () => setSheet('move') }] : []),
    { label: 'Abrir nota', icon: 'note', run: () => { closeSheet(); onOpenNote(task) } },
    { label: 'Duplicar', icon: 'copy', run: () => { closeSheet(); send({ kind: 'duplicate-task', taskPath: path }) } },
    { label: 'Desestimar', icon: 'cancel', hint: 'a Canceladas', run: () => end('cancel') },
    { label: 'Eliminar', icon: 'trash', danger: true, run: () => end('delete') },
  ]

  return (
    <div className="tmp-screen tmp-detail">
      <header className="tmp-detail-head">
        <button type="button" className="tmp-back" onClick={onBack}>
          <PhoneIcon name="chevronLeft" size={20} strokeWidth={2.2} />
          <span className="tmp-dot" style={{ background: columnColor }} />
          {task.group || 'Sin grupo'}
        </button>
        <span className="tmp-grow" />
        <button
          type="button"
          className="tmp-icon-btn tmp-header-btn"
          aria-label="Agregar comentario"
          onClick={() => {
            commentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            commentRef.current?.focus({ preventScroll: true })
          }}
        >
          <PhoneIcon name="comment" size={19} />
        </button>
        <button type="button" className="tmp-icon-btn tmp-header-btn" aria-label="Opciones de la tarea" onClick={() => setSheet('menu')}>
          <KebabIcon size={19} />
        </button>
      </header>

      <main className="tmp-main tmp-main--detail">
        <div className="tmp-detail-intro tmp-sec">
          <div className="tmp-detail-chips">
            <button type="button" className={`tmp-prio tmp-prio--${tone} tmp-prio--lg`} aria-label={`Prioridad ${priorityLabel(task.priority)}. Cambiar`} onClick={() => setSheet('prio')}>
              <span className="tmp-prio-dot" />
              {priorityLabel(task.priority)}
              <PhoneIcon name="chevronDown" size={11} strokeWidth={3} />
            </button>
            {running ? <span className="tmp-chip tmp-chip--run tmp-chip--lg tmp-pop"><span className="tmp-pulse-dot" />En progreso · {formatElapsed(task, now)}</span> : null}
            {isPending(task) ? <span className="tmp-chip tmp-chip--idle tmp-chip--lg tmp-pop"><span className="tmp-dot tmp-dot--muted" />Pendiente</span> : null}
            {isBlocked(task) ? <span className="tmp-chip tmp-chip--blocked tmp-chip--lg tmp-pop"><PhoneIcon name="lock" size={12} strokeWidth={2.6} />Bloqueada</span> : null}
          </div>
          {editing === null ? (
            <div className="tmp-detail-title-row">
              <h1 className="tmp-detail-title">{task.title}</h1>
              <button type="button" className="tmp-icon-btn tmp-detail-rename" aria-label="Renombrar" onClick={() => setEditing(task.title)}>
                <PhoneIcon name="pencil" size={17} />
              </button>
            </div>
          ) : (
            <div className="tmp-detail-edit tmp-pop">
              <textarea
                // The person tapped «Renombrar».
                autoFocus
                aria-label="Título"
                rows={2}
                value={editing}
                onChange={(event) => setEditing(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); saveTitle() }
                  if (event.key === 'Escape') setEditing(null)
                }}
              />
              <div className="tmp-detail-edit-actions">
                <button type="button" className="tmp-btn tmp-btn--outline tmp-btn--sm" onClick={() => setEditing(null)}>Cancelar</button>
                <button type="button" className="tmp-btn tmp-btn--primary tmp-btn--sm" onClick={saveTitle}>Guardar</button>
              </div>
            </div>
          )}
          <button
            type="button"
            className={`tmp-detail-project${task.project ? '' : ' is-empty'}`}
            style={projectColor ? { ['--tmp-project' as string]: projectColor } : undefined}
            onClick={() => setSheet('project')}
          >
            <PhoneIcon name="folder" size={16} className="tmp-project-icon" />
            <span>{task.project || 'Agregar proyecto'}</span>
            <PhoneIcon name="chevronDown" size={13} strokeWidth={2.4} className="tmp-muted" />
          </button>
          {description.map((paragraph, index) => <p key={index} className="tmp-detail-desc">{paragraph}</p>)}
        </div>

        <section className="tmp-panel tmp-sec" aria-labelledby="tmp-time-title" style={{ animationDelay: '80ms' }}>
          <div className="tmp-time-top">
            <span className={`tmp-time-ring${time.over ? ' is-over' : ''}`}>
              <svg aria-hidden="true" width="96" height="96" viewBox="0 0 96 96">
                <circle className={`tmp-ring-track${time.hasEstimate ? '' : ' is-dashed'}`} cx="48" cy="48" r={ringRadius} strokeWidth="8" />
                <circle className="tmp-ring-fill" cx="48" cy="48" r={ringRadius} strokeWidth="8" strokeDasharray={ringLength.toFixed(1)} strokeDashoffset={ringOffset.toFixed(1)} style={{ opacity: time.ringVisible ? 1 : 0 }} />
              </svg>
              <span className="tmp-time-ring-text">{time.hasEstimate ? `${time.percentText}%` : '–'}</span>
            </span>
            <div className="tmp-time-text">
              <h2 id="tmp-time-title" className="tmp-kicker">Tiempo</h2>
              <span className="tmp-tabular"><span className="tmp-time-spent">{time.spentLabel}</span><span className="tmp-muted"> de {time.estimateLabel}</span></span>
              <span className={`tmp-time-status${time.over ? ' is-over' : time.hasEstimate ? ' is-ok' : ' is-none'}`}>{timeStatus}</span>
            </div>
          </div>
          <Stepper label="Estimado" value={time.hasEstimate ? time.estimateShort : '—'} onDec={() => setTime('estimatedHours', stepHours(task.estimatedHours, -0.5))} onInc={() => setTime('estimatedHours', stepHours(task.estimatedHours, 0.5))} />
          <Stepper label="Dedicado" value={time.spentLabel} onDec={() => setTime('dedicatedHours', stepHours(time.spent, -0.25))} onInc={() => setTime('dedicatedHours', stepHours(time.spent, 0.25))} />
          <div className="tmp-quick">
            <span className="tmp-muted">Estimar</span>
            {QUICK_ESTIMATES.map((hours) => (
              <button key={hours} type="button" className={`tmp-quick-chip${task.estimatedHours === hours ? ' is-on' : ''}`} onClick={() => setTime('estimatedHours', hours)}>{hours} h</button>
            ))}
          </div>
        </section>

        <section className="tmp-panel tmp-sec" aria-labelledby="tmp-people-title" style={{ animationDelay: '140ms' }}>
          <div className="tmp-panel-head">
            <h2 id="tmp-people-title" className="tmp-panel-title">Personas</h2>
            <button type="button" className="tmp-btn tmp-btn--outline tmp-btn--sm tmp-accent-text" onClick={() => setSheet('people')}>
              <PhoneIcon name="personAdd" size={14} strokeWidth={2.2} />
              Asignar
            </button>
          </div>
          <div className="tmp-person-chips">
            {people.map((person) => (
              <span key={person.name} className="tmp-person-chip tmp-pop">
                <span className="tmp-avatar" style={{ width: 30, height: 30, ['--tmp-person' as string]: person.color }}>{person.initials}</span>
                <span>{person.name}</span>
                <button
                  type="button"
                  className="tmp-icon-btn tmp-person-remove"
                  aria-label={`Quitar a ${person.name}`}
                  onClick={() => send({ kind: 'set-task-people', taskPath: path, people: assigned.filter((name) => fold(name) !== fold(person.name)) })}
                >
                  <PhoneIcon name="close" size={12} strokeWidth={2.6} />
                </button>
              </span>
            ))}
            {people.length === 0 ? <span className="tmp-muted">Nadie asignado todavía.</span> : null}
          </div>
        </section>

        <section className="tmp-panel tmp-panel--subs tmp-sec" aria-labelledby="tmp-subs-title" style={{ animationDelay: '200ms' }}>
          <div className="tmp-subs-head">
            <h2 id="tmp-subs-title" className="tmp-panel-title">Subtareas</h2>
            <span className="tmp-subs-bar"><span style={{ width: `${subtasks.length ? (doneSubtasks / subtasks.length) * 100 : 0}%` }} /></span>
            <span className={`tmp-subs-count${subtasks.length && doneSubtasks === subtasks.length ? ' is-done' : ''}`}>{doneSubtasks}/{subtasks.length}</span>
          </div>
          {subtasks.map((subtask) => {
            const done = subtask.state === 'Finalizada'
            return (
              <div key={subtask.filePath} className="tmp-sub-row">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={subtask.title}
                  className={`tmp-sub-box${done ? ' is-done' : ''}`}
                  onClick={() => send({ kind: 'toggle-subtask', taskPath: subtask.filePath })}
                >
                  {done ? <PhoneIcon name="check" size={14} strokeWidth={3.6} /> : null}
                </button>
                <span className={`tmp-sub-title${done ? ' is-done' : ''}`}>{subtask.title}</span>
                <button type="button" className="tmp-icon-btn tmp-sub-remove" aria-label={`Eliminar subtarea ${subtask.title}`} onClick={() => send({ kind: 'delete-task', taskPath: subtask.filePath })}>
                  <PhoneIcon name="close" size={13} strokeWidth={2.6} />
                </button>
              </div>
            )
          })}
          <label className="tmp-sub-add">
            <PhoneIcon name="plus" size={15} strokeWidth={2.4} />
            <input
              aria-label="Agregar subtarea"
              placeholder="Agregar subtarea"
              value={newSubtask}
              onChange={(event) => setNewSubtask(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSubtask() } }}
            />
            {newSubtask.trim() ? <button type="button" className="tmp-btn tmp-btn--primary tmp-btn--xs tmp-pop" onClick={addSubtask}>Agregar</button> : null}
          </label>
        </section>

        <section className="tmp-panel tmp-sec" aria-labelledby="tmp-comments-title" style={{ animationDelay: '260ms' }}>
          <h2 id="tmp-comments-title" className="tmp-panel-title">Comentarios <span className="tmp-muted tmp-small">{detail?.comments.length ?? 0}</span></h2>
          {detail?.comments.map((comment) => (
            <div key={comment.commentId} className="tmp-comment">
              <span className="tmp-avatar" style={{ width: 32, height: 32, ['--tmp-person' as string]: comment.color ?? 'var(--tm-muted)' }}>{comment.initials}</span>
              <span className="tmp-comment-bubble">
                <span className="tmp-comment-meta"><strong>{comment.author}</strong> · {comment.when}</span>
                <span className="tmp-comment-text">{comment.text}</span>
              </span>
            </div>
          ))}
          <div className="tmp-composer">
            <textarea
              ref={commentRef}
              aria-label="Nuevo comentario"
              placeholder="Escribí un comentario…"
              rows={2}
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
            />
            <button type="button" className={`tmp-send${newComment.trim() ? ' is-ready' : ''}`} aria-label="Enviar comentario" onClick={sendComment}>
              <PhoneIcon name="send" size={17} strokeWidth={2.2} />
            </button>
          </div>
        </section>
      </main>

      <div className="tmp-detail-bar">
        {ending ? (
          <div className="tmp-ended tmp-pop">
            <PhoneIcon name="check" size={18} strokeWidth={2.6} />
            <span className="tmp-grow">{ENDING_LABEL[ending]}</span>
            <button type="button" className="tmp-ended-undo" onClick={() => { setEnding(null); onUndo() }}>Deshacer</button>
          </div>
        ) : null}
        {!ending && isPending(task) ? (
          <button type="button" className="tmp-btn tmp-btn--primary tmp-btn--bar" onClick={() => send({ kind: 'start-task', taskPath: path })}><PlayIcon size={16} />Iniciar</button>
        ) : null}
        {!ending && running ? (
          <>
            <button type="button" className="tmp-btn tmp-btn--outline tmp-btn--bar tmp-btn--fixed" onClick={() => send({ kind: 'pause-task', taskPath: path })}><PauseIcon size={14} />Pausar</button>
            <button type="button" className="tmp-btn tmp-btn--primary tmp-btn--bar" onClick={() => end('finish')}><PhoneIcon name="check" size={17} strokeWidth={2.6} />Finalizar</button>
          </>
        ) : null}
        {!ending && isBlocked(task) ? (
          <button type="button" className="tmp-btn tmp-btn--outline tmp-btn--bar" onClick={() => send({ kind: 'unblock-task', taskPath: path })}><PhoneIcon name="unlock" size={16} strokeWidth={2.2} />Desbloquear</button>
        ) : null}
      </div>

      {sheet === 'prio' ? (
        <PhoneSheet label="Prioridad" onClose={closeSheet}>
          <PhoneSheetTitle title="Prioridad" />
          <PriorityChoices current={task.priority} onPick={(priority: TaskPriority) => { closeSheet(); send({ kind: 'change-priority', taskPath: path, priority }) }} />
        </PhoneSheet>
      ) : null}
      {sheet === 'menu' ? (
        <PhoneSheet label="Opciones de la tarea" onClose={closeSheet}>
          <PhoneSheetTitle title="Opciones" />
          <div className="tmp-group">
            {menu.map((item) => (
              <button key={item.label} type="button" className={`tmp-row${item.danger ? ' tmp-row--danger' : ''}`} onClick={item.run}>
                <PhoneIcon name={item.icon} size={18} className="tmp-row-icon" />
                <span className="tmp-row-label">{item.label}</span>
                {item.hint ? <span className="tmp-row-value">{item.hint}</span> : null}
              </button>
            ))}
          </div>
        </PhoneSheet>
      ) : null}
      {sheet === 'move' ? (
        <PhoneSheet label="Mover a" onClose={closeSheet}>
          <PhoneSheetTitle title="Mover a" onBack={() => setSheet('menu')} />
          <div className="tmp-group" role="radiogroup" aria-label="Columnas">
            {targets.map((target) => {
              const current = target.name === task.group
              return (
                <button
                  key={target.key}
                  type="button"
                  role="radio"
                  aria-checked={current}
                  className={`tmp-row${current ? ' is-current' : ''}`}
                  onClick={() => { closeSheet(); if (!current) send({ kind: 'move-task', taskPath: path, group: target.name }) }}
                >
                  <span className="tmp-square" style={{ background: target.color }} />
                  <span className="tmp-row-label">{target.name}</span>
                  <span className="tmp-row-value">{target.count}</span>
                  {current ? <PhoneIcon name="check" size={17} strokeWidth={2.6} className="tmp-tick" /> : null}
                </button>
              )
            })}
          </div>
        </PhoneSheet>
      ) : null}
      {sheet === 'project' || sheet === 'people' ? (
        <PhoneSheet label={sheet === 'project' ? 'Elegir proyecto' : 'Asignar personas'} onClose={closeSheet}>
          <PhoneSheetTitle title={sheet === 'project' ? 'Proyecto' : 'Asignar personas'} />
          <label className="tmp-search tmp-search--sheet">
            <PhoneIcon name="search" size={16} />
            <input
              aria-label={sheet === 'project' ? 'Buscar o crear proyecto' : 'Buscar persona'}
              placeholder={sheet === 'project' ? 'Buscar o crear proyecto' : 'Buscar persona'}
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreateProject) {
                  event.preventDefault()
                  const name = pickerQuery.trim()
                  closeSheet()
                  void onIntent({ kind: 'add-board-project', board: board.name, name, color: board.nextProjectColor })
                    .then(() => onIntent({ kind: 'set-task-project', taskPath: path, project: name }))
                    .catch(() => undefined)
                }
              }}
            />
          </label>
          <div className="tmp-group tmp-group--scroll">
            {sheet === 'project' ? (
              <>
                {(!query || fold('Sin proyecto').includes(query)) ? (
                  <button type="button" className={`tmp-row${task.project ? '' : ' is-current'}`} aria-pressed={!task.project} onClick={() => { closeSheet(); send({ kind: 'set-task-project', taskPath: path, project: '' }) }}>
                    <span className="tmp-square tmp-square--empty" />
                    <span className="tmp-row-label tmp-muted">Sin proyecto</span>
                    {!task.project ? <PhoneIcon name="check" size={18} strokeWidth={2.6} className="tmp-tick" /> : null}
                  </button>
                ) : null}
                {projects.map((project) => {
                  const current = fold(project.name) === fold(task.project ?? '')
                  return (
                    <button key={project.name} type="button" className={`tmp-row${current ? ' is-current' : ''}`} aria-pressed={current} onClick={() => { closeSheet(); send({ kind: 'set-task-project', taskPath: path, project: project.name }) }}>
                      <span className="tmp-square" style={{ background: project.color }} />
                      <span className="tmp-row-label">{project.name}</span>
                      {current ? <PhoneIcon name="check" size={18} strokeWidth={2.6} className="tmp-tick" /> : null}
                    </button>
                  )
                })}
                {canCreateProject ? (
                  <button
                    type="button"
                    className="tmp-row tmp-row--accent tmp-pop"
                    onClick={() => {
                      const name = pickerQuery.trim()
                      closeSheet()
                      void onIntent({ kind: 'add-board-project', board: board.name, name, color: board.nextProjectColor })
                        .then(() => onIntent({ kind: 'set-task-project', taskPath: path, project: name }))
                        .catch(() => undefined)
                    }}
                  >
                    <PhoneIcon name="plus" size={16} strokeWidth={2.4} className="tmp-row-icon" />
                    <span className="tmp-row-label">Crear proyecto “{pickerQuery.trim()}”</span>
                  </button>
                ) : null}
              </>
            ) : (
              members.map((member) => {
                const selected = assigned.some((name) => fold(name) === fold(member.name))
                return (
                  <button
                    key={member.name}
                    type="button"
                    className="tmp-row"
                    aria-pressed={selected}
                    onClick={() => send({
                      kind: 'set-task-people',
                      taskPath: path,
                      people: selected ? assigned.filter((name) => fold(name) !== fold(member.name)) : [...assigned, member.name],
                    })}
                  >
                    <span className={`tmp-sub-box tmp-sub-box--sm${selected ? ' is-done' : ''}`}>{selected ? <PhoneIcon name="check" size={12} strokeWidth={3.6} /> : null}</span>
                    <span className="tmp-avatar" style={{ width: 30, height: 30, ['--tmp-person' as string]: member.color }}>{member.initials}</span>
                    <span className="tmp-row-label">{member.name}{member.isMe ? ' (vos)' : ''}</span>
                  </button>
                )
              })
            )}
          </div>
          {sheet === 'people' ? (
            <button type="button" className="tmp-btn tmp-btn--primary tmp-btn--wide tmp-btn--done" onClick={closeSheet}>
              Listo · {assigned.length === 1 ? '1 persona' : `${assigned.length} personas`}
            </button>
          ) : null}
        </PhoneSheet>
      ) : null}
    </div>
  )
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="tmp-stepper">
      <span className="tmp-stepper-label">{label}</span>
      <button type="button" className="tmp-step-btn" aria-label={`Restar a ${label}`} onClick={onDec}><PhoneIcon name="minus" size={14} strokeWidth={2.6} /></button>
      <span className="tmp-stepper-value">{value}</span>
      <button type="button" className="tmp-step-btn" aria-label={`Sumar a ${label}`} onClick={onInc}><PhoneIcon name="plus" size={14} strokeWidth={2.6} /></button>
    </div>
  )
}
