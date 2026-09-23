import { useState, type FormEvent } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import type { RoutineMutation, RoutineSummary } from '../types/routineTypes'

interface RoutineManagerSectionProps {
  routines: RoutineSummary[]
  disabled: boolean
  onMutate: (mutation: RoutineMutation) => Promise<unknown>
  onError: (message: string) => void
}

function RoutinePill({ routine, disabled, onMutate, onError }: Omit<RoutineManagerSectionProps, 'routines'> & { routine: RoutineSummary }) {
  const [draft, setDraft] = useState<string | null>(null)

  const commitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    if (draft === null) return
    try {
      await onMutate({ type: 'saveRoutine', id: routine.id, name: draft })
      setDraft(null)
    } catch (reason) {
      onError((reason as Error).message)
    }
  }

  const remove = async () => {
    try {
      await onMutate({ type: 'deleteRoutine', id: routine.id })
    } catch (reason) {
      onError((reason as Error).message)
    }
  }

  return (
    <li className="routine-pill" data-accent={routine.accent}>
      {draft === null ? (
        <>
          <span className="routine-pill__name">{routine.name}</span>
          <span className="routine-pill__count">{routine.taskCount}</span>
          <button type="button" className="routine-icon-button" onClick={() => setDraft(routine.name)} disabled={disabled} aria-label={`Renombrar ${routine.name}`}>
            <Pencil size={14} />
          </button>
        </>
      ) : (
        <form className="routine-pill__rename" onSubmit={(event) => void commitRename(event)}>
          <input
            className="routine-pill__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setDraft(null) }}
            maxLength={30}
            aria-label={`Nuevo nombre para ${routine.name}`}
            autoFocus
          />
          <button type="submit" className="routine-icon-button" disabled={disabled} aria-label="Guardar nombre"><Check size={14} /></button>
          <button type="button" className="routine-icon-button" onClick={() => setDraft(null)} aria-label="Cancelar renombrado"><X size={14} /></button>
        </form>
      )}
      {draft === null ? (
        <button
          type="button"
          className="routine-icon-button"
          onClick={() => void remove()}
          disabled={disabled || routine.deleteBlockedReason !== null}
          aria-label={`Eliminar ${routine.name}`}
          title={routine.deleteBlockedReason ?? 'Eliminar rutina'}
        >
          <X size={14} />
        </button>
      ) : null}
    </li>
  )
}

export function RoutineManagerSection({ routines, disabled, onMutate, onError }: RoutineManagerSectionProps) {
  const [name, setName] = useState('')

  const create = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await onMutate({ type: 'saveRoutine', id: null, name })
      setName('')
    } catch (reason) {
      onError((reason as Error).message)
    }
  }

  return (
    <>
      <ul className="routine-manager" aria-label="Rutinas">
        {routines.map((routine) => (
          <RoutinePill key={routine.id} routine={routine} disabled={disabled} onMutate={onMutate} onError={onError} />
        ))}
      </ul>
      <form className="routine-add-row" onSubmit={(event) => void create(event)}>
        <input
          className="routine-field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nombre de una nueva rutina"
          maxLength={30}
          aria-label="Nombre de una nueva rutina"
        />
        <button type="submit" className="routine-button routine-button--secondary" disabled={disabled || !name.trim()}>Crear rutina</button>
      </form>
    </>
  )
}
