import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { GripVertical, Pause, Pencil, Play, X } from 'lucide-react'
import type { RoutineMutation, RoutineSummary, RoutineTask } from '../types/routineTypes'

const DAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

interface RoutineTaskSectionProps {
  routines: RoutineSummary[]
  tasks: RoutineTask[]
  categories: string[]
  disabled: boolean
  onMutate: (mutation: RoutineMutation) => Promise<unknown>
  onError: (message: string) => void
  onTaskDeleted: (task: RoutineTask) => void
}

interface TaskDraft {
  id: string | null
  name: string
  routineId: string
  category: string
  customDays: boolean
  days: number[]
  notes: string
}

function emptyDraft(routineId: string): TaskDraft {
  return { id: null, name: '', routineId, category: '', customDays: false, days: [], notes: '' }
}

function draftFromTask(task: RoutineTask): TaskDraft {
  return {
    id: task.id,
    name: task.name,
    routineId: task.routineId,
    category: task.category,
    customDays: !task.allDays,
    days: task.allDays ? [] : task.days,
    notes: task.notes,
  }
}

function moveId(ids: string[], id: string, offset: number): string[] {
  const from = ids.indexOf(id)
  const to = from + offset
  if (from < 0 || to < 0 || to >= ids.length) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

function RoutineTaskForm({ routines, categories, disabled, onMutate, editing, onDone }: {
  routines: RoutineSummary[]
  categories: string[]
  disabled: boolean
  onMutate: RoutineTaskSectionProps['onMutate']
  editing: RoutineTask | null
  onDone: () => void
}) {
  const fallbackRoutineId = routines[0]?.id ?? ''
  const [draft, setDraft] = useState<TaskDraft>(() => editing ? draftFromTask(editing) : emptyDraft(fallbackRoutineId))
  const [formError, setFormError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const editingId = editing?.id ?? null

  useEffect(() => {
    setDraft(editing ? draftFromTask(editing) : emptyDraft(fallbackRoutineId))
    setFormError('')
    if (editing) nameRef.current?.focus()
    // Reset only when another task is edited, not on every dashboard refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  useEffect(() => {
    if (!routines.some((routine) => routine.id === draft.routineId)) {
      setDraft((current) => ({ ...current, routineId: fallbackRoutineId }))
    }
  }, [routines, draft.routineId, fallbackRoutineId])

  const toggleDay = (day: number) => {
    setDraft((current) => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter((value) => value !== day) : [...current.days, day],
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await onMutate({
        type: 'saveTask',
        id: draft.id,
        routineId: draft.routineId,
        name: draft.name,
        category: draft.category,
        days: draft.customDays ? draft.days : null,
        notes: draft.notes,
      })
      setDraft(emptyDraft(draft.routineId))
      setFormError('')
      onDone()
    } catch (reason) {
      setFormError((reason as Error).message)
    }
  }

  const cancel = () => {
    setDraft(emptyDraft(draft.routineId))
    setFormError('')
    onDone()
  }

  return (
    <form className="routine-task-form" onSubmit={(event) => void submit(event)} aria-label={editing ? 'Editar tarea' : 'Nueva tarea'}>
      <input
        ref={nameRef}
        className="routine-field"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        placeholder="Ej: Tomar agua, revisar mail, estirar..."
        maxLength={60}
        aria-label="Nombre de la tarea"
      />
      <div className="routine-form-grid">
        <label className="routine-form-field">
          <span>Rutina</span>
          <select className="routine-field" value={draft.routineId} onChange={(event) => setDraft({ ...draft, routineId: event.target.value })}>
            {routines.map((routine) => <option key={routine.id} value={routine.id}>{routine.name}</option>)}
          </select>
        </label>
        <label className="routine-form-field">
          <span>Categoría (rueda de la vida)</span>
          <select className="routine-field" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
            <option value="" disabled>Elegí una categoría</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
      </div>
      <div className="routine-form-grid">
        <fieldset className="routine-form-field routine-days">
          <legend>¿Qué días aplica?</legend>
          <div className="routine-segmented" role="radiogroup" aria-label="Días">
            <button type="button" role="radio" aria-checked={!draft.customDays} onClick={() => setDraft({ ...draft, customDays: false })}>Todos los días</button>
            <button type="button" role="radio" aria-checked={draft.customDays} onClick={() => setDraft({ ...draft, customDays: true })}>Días particulares</button>
          </div>
          {draft.customDays ? (
            <div className="routine-day-picker">
              {DAY_SHORT.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  className="routine-day-chip"
                  aria-pressed={draft.days.includes(day)}
                  aria-label={DAY_NAMES[day]}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </fieldset>
        <label className="routine-form-field">
          <span>Nota (opcional)</span>
          <input
            className="routine-field"
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            placeholder="Ej: 20 min, después de cenar"
            maxLength={80}
          />
        </label>
      </div>
      <p className="routine-form-error" role="alert">{formError}</p>
      <div className="routine-form-actions">
        <button type="submit" className="routine-button routine-button--primary" disabled={disabled}>
          {editing ? 'Guardar cambios' : 'Añadir'}
        </button>
        {editing ? <button type="button" className="routine-button routine-button--secondary" onClick={cancel}>Cancelar edición</button> : null}
      </div>
    </form>
  )
}

function RoutineTaskGroup({ routine, tasks, disabled, onMutate, onError, onEdit, onTaskDeleted }: {
  routine: RoutineSummary
  tasks: RoutineTask[]
  disabled: boolean
  onMutate: RoutineTaskSectionProps['onMutate']
  onError: RoutineTaskSectionProps['onError']
  onEdit: (task: RoutineTask) => void
  onTaskDeleted: RoutineTaskSectionProps['onTaskDeleted']
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const serverOrder = tasks.map((task) => task.id)
  const visibleOrder = (dragOrder ?? serverOrder).filter((id) => byId.has(id))

  const reorder = async (orderedTaskIds: string[]) => {
    if (orderedTaskIds.join('\n') === serverOrder.join('\n')) return
    try {
      await onMutate({ type: 'reorderTasks', routineId: routine.id, orderedTaskIds })
    } catch (reason) {
      onError((reason as Error).message)
    }
  }

  const updateDragOrder = (order: string[] | null) => {
    dragOrderRef.current = order
    setDragOrder(order)
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>, taskId: string) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingId(taskId)
    updateDragOrder(serverOrder)
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = dragOrderRef.current
    if (!draggingId || !current || !listRef.current) return
    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-task-id]'))
      .filter((row) => row.dataset.taskId !== draggingId)
    const before = rows.find((row) => {
      const rect = row.getBoundingClientRect()
      return event.clientY < rect.top + rect.height / 2
    })
    const next = current.filter((id) => id !== draggingId)
    const index = before ? next.indexOf(before.dataset.taskId ?? '') : next.length
    next.splice(index < 0 ? next.length : index, 0, draggingId)
    if (next.join('\n') !== current.join('\n')) updateDragOrder(next)
  }

  const endDrag = async (commit: boolean) => {
    const order = dragOrderRef.current
    setDraggingId(null)
    if (commit && order) await reorder(order)
    updateDragOrder(null)
  }

  const handleKeyboardMove = (event: KeyboardEvent<HTMLButtonElement>, taskId: string) => {
    const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
    if (!offset || disabled) return
    event.preventDefault()
    void reorder(moveId(serverOrder, taskId, offset))
  }

  const run = async (mutation: RoutineMutation, after?: () => void) => {
    try {
      await onMutate(mutation)
      after?.()
    } catch (reason) {
      onError((reason as Error).message)
    }
  }

  return (
    <section className="routine-group" aria-label={`Tareas de ${routine.name}`}>
      <h3 className="routine-group__title" data-accent={routine.accent}>{routine.name}</h3>
      <ul className="routine-task-list" ref={listRef}>
        {visibleOrder.map((id) => {
          const task = byId.get(id)
          if (!task) return null
          return (
            <li key={task.id} className={`routine-task${task.paused ? ' routine-task--paused' : ''}${draggingId === task.id ? ' routine-task--dragging' : ''}`} data-task-id={task.id}>
              <button
                type="button"
                className="routine-drag-handle"
                aria-label={`Reordenar ${task.name}: arrastrá o usá las flechas arriba y abajo`}
                aria-disabled={disabled}
                onPointerDown={(event) => startDrag(event, task.id)}
                onPointerMove={moveDrag}
                onPointerUp={() => void endDrag(true)}
                onPointerCancel={() => void endDrag(false)}
                onKeyDown={(event) => handleKeyboardMove(event, task.id)}
              >
                <GripVertical size={16} />
              </button>
              <span className="routine-dot" data-color={task.color} aria-hidden="true" />
              <div className="routine-task__text">
                <span className="routine-task__name">
                  {task.name}
                  {task.paused ? <span className="routine-task__tag">Pausada</span> : null}
                </span>
                <span className="routine-task__meta">{[task.category || 'Sin categoría', task.daysLabel, task.notes].filter(Boolean).join(' · ')}</span>
              </div>
              <button
                type="button"
                className="routine-icon-button"
                disabled={disabled}
                onClick={() => void run({ type: 'setTaskStatus', id: task.id, status: task.paused ? 'active' : 'paused' })}
                aria-label={task.paused ? `Reanudar ${task.name}` : `Pausar ${task.name}`}
                title={task.paused ? 'Reanudar' : 'Pausar (sale de los checklists, no pierde historial)'}
              >
                {task.paused ? <Play size={14} /> : <Pause size={14} />}
              </button>
              <button type="button" className="routine-icon-button" disabled={disabled} onClick={() => onEdit(task)} aria-label={`Editar ${task.name}`} title="Editar tarea">
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="routine-icon-button"
                disabled={disabled}
                onClick={() => void run({ type: 'deleteTask', id: task.id }, () => onTaskDeleted(task))}
                aria-label={`Eliminar ${task.name}`}
                title="Eliminar tarea"
              >
                <X size={14} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function RoutineTaskSection({ routines, tasks, categories, disabled, onMutate, onError, onTaskDeleted }: RoutineTaskSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = tasks.find((task) => task.id === editingId) ?? null

  return (
    <>
      <RoutineTaskForm
        routines={routines}
        categories={categories}
        disabled={disabled}
        onMutate={onMutate}
        editing={editing}
        onDone={() => setEditingId(null)}
      />
      {tasks.length === 0 ? <p className="routine-empty">Todavía no agregaste tareas a la rutina.</p> : null}
      {routines.map((routine) => {
        const group = tasks.filter((task) => task.routineId === routine.id)
        return group.length > 0 ? (
          <RoutineTaskGroup
            key={routine.id}
            routine={routine}
            tasks={group}
            disabled={disabled}
            onMutate={onMutate}
            onError={onError}
            onEdit={(task) => setEditingId(task.id)}
            onTaskDeleted={(task) => {
              if (task.id === editingId) setEditingId(null)
              onTaskDeleted(task)
            }}
          />
        ) : null
      })}
    </>
  )
}
