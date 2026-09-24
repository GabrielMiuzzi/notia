import { useId } from 'react'
import type { AgendaEvent, AgendaPriority, AgendaPriorityOption } from '../types/agendaTypes'

interface AgendaActionBarProps {
  selectionCount: number
  slotMinutes: number
  draftTitle: string
  priority: AgendaPriority
  priorities: AgendaPriorityOption[]
  activeEvent: AgendaEvent | null
  disabled: boolean
  error: string | null
  onDraftTitle: (title: string) => void
  onPriority: (priority: AgendaPriority) => void
  onSchedule: () => void
  onClearSelection: () => void
  onDeleteActive: () => void
  onCloseActive: () => void
}

function selectionLabel(count: number, slotMinutes: number): string {
  const minutes = count * slotMinutes
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const duration = hours > 0 ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${minutes} min`
  return `${count} ${count === 1 ? 'bloque' : 'bloques'} · ${duration}`
}

export function AgendaActionBar({
  selectionCount,
  slotMinutes,
  draftTitle,
  priority,
  priorities,
  activeEvent,
  disabled,
  error,
  onDraftTitle,
  onPriority,
  onSchedule,
  onClearSelection,
  onDeleteActive,
  onCloseActive,
}: AgendaActionBarProps) {
  const inputId = useId()
  const priorityLabelId = useId()

  return (
    <div className="agenda-bar-wrap">
      <div className="agenda-bar">
        {selectionCount > 0 ? (
          <form className="agenda-bar__group" onSubmit={(event) => { event.preventDefault(); onSchedule() }}>
            <span className="agenda-bar__count">{selectionLabel(selectionCount, slotMinutes)}</span>
            <label htmlFor={inputId} className="agenda-visually-hidden">Nombre de la tarea</label>
            <input
              id={inputId}
              className="agenda-input agenda-input--in-bar"
              type="text"
              placeholder="Nombre de la tarea"
              value={draftTitle}
              onChange={(event) => onDraftTitle(event.target.value)}
            />
            <div className="agenda-priority" role="radiogroup" aria-labelledby={priorityLabelId}>
              <span id={priorityLabelId} className="agenda-priority__label">Prioridad</span>
              {priorities.map((option) => (
                <label key={option.key} className="agenda-swatch" data-priority={option.key} title={option.label}>
                  <input
                    type="radio"
                    name={priorityLabelId}
                    value={option.key}
                    checked={priority === option.key}
                    onChange={() => onPriority(option.key)}
                  />
                  <span className="agenda-swatch__dot" aria-hidden="true" />
                  <span className="agenda-visually-hidden">{option.label}</span>
                </label>
              ))}
            </div>
            <div className="agenda-bar__buttons">
              <button type="submit" className="agenda-primary" disabled={disabled}>Agendar</button>
              <button type="button" className="agenda-ghost" onClick={onClearSelection}>Cancelar</button>
            </div>
          </form>
        ) : activeEvent ? (
          <div className="agenda-bar__group">
            <span className="agenda-chip" data-priority={activeEvent.priority}>{activeEvent.priorityLabel}</span>
            <span className="agenda-bar__title">{activeEvent.title}</span>
            <span className="agenda-bar__when">{activeEvent.whenLabel}</span>
            <div className="agenda-bar__buttons">
              <button type="button" className="agenda-danger" disabled={disabled} onClick={onDeleteActive}>Eliminar tarea</button>
              <button type="button" className="agenda-ghost" onClick={onCloseActive}>Cerrar</button>
            </div>
          </div>
        ) : (
          <p className="agenda-hint">
            <span className="agenda-hint--pointer">Hacé clic o arrastrá sobre los bloques de 15 minutos para agendar una tarea.</span>
            <span className="agenda-hint--touch">Tocá los bloques de 15 minutos, o mantené presionado y deslizá, para agendar una tarea.</span>
          </p>
        )}
      </div>
      {error ? <p className="agenda-error" role="alert">{error}</p> : null}
    </div>
  )
}
