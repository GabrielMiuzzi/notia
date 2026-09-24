import { useState } from 'react'
import { X } from 'lucide-react'
import type { AgendaNote } from '../types/agendaTypes'

interface AgendaNotesCardProps {
  notes: AgendaNote[]
  pendingLabel: string
  disabled: boolean
  error: string | null
  /** Resuelve `true` cuando Rust guardó la nota. */
  onAdd: (text: string) => Promise<boolean>
  onToggle: (note: AgendaNote) => void
  onDelete: (note: AgendaNote) => void
}

export function AgendaNotesCard({ notes, pendingLabel, disabled, error, onAdd, onToggle, onDelete }: AgendaNotesCardProps) {
  const [draft, setDraft] = useState('')

  const submit = async () => {
    if (await onAdd(draft)) setDraft('')
  }

  return (
    <section className="agenda-card" aria-labelledby="agenda-notes-title">
      <div className="agenda-card__head agenda-card__head--baseline">
        <h2 id="agenda-notes-title">Anotador rápido</h2>
        <span className="agenda-card__meta">{pendingLabel}</span>
      </div>
      <form className="agenda-note-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label htmlFor="agenda-quick-note" className="agenda-visually-hidden">Nueva tarea del día</label>
        <input
          id="agenda-quick-note"
          className="agenda-input"
          type="text"
          placeholder="Anotá una tarea para hoy…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="agenda-primary" disabled={disabled || !draft.trim()}>Agregar</button>
      </form>
      {error ? <p className="agenda-error" role="alert">{error}</p> : null}
      {notes.length === 0 ? (
        <p className="agenda-empty">Todavía no anotaste nada para hoy.</p>
      ) : (
        <ul className="agenda-notes">
          {notes.map((note) => (
            <li key={note.id} className="agenda-note">
              <input
                type="checkbox"
                id={`agenda-note-${note.id}`}
                checked={note.done}
                disabled={disabled}
                onChange={() => onToggle(note)}
              />
              <label htmlFor={`agenda-note-${note.id}`} data-done={note.done}>{note.text}</label>
              <button
                type="button"
                className="agenda-icon-button"
                aria-label={`Borrar «${note.text}»`}
                disabled={disabled}
                onClick={() => onDelete(note)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
