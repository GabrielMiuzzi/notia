import { useId, useState, type FormEvent } from 'react'
import { PenLine, X } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { HomeCard, HomeNotes } from '../../../../services/home/homeTypes'
import type { AgendaMutation } from '../../../../modules/agenda/types/agendaTypes'
import { agendaErrorMessage, applyAgendaMutation } from '../../../../modules/agenda/services/agendaService'
import { HomeCardShell } from './HomeCardShell'
import { countLabel } from './homeDisplay'

const TODAY_VIEW = { selectedDate: null, month: null }

interface HomeNotesCardProps {
  card: HomeCard<HomeNotes>
  library: NotiaLibrary
  /** Reads the dashboard again after a note changed. */
  onChanged: () => Promise<void>
}

/** The Agenda's notepad: what to do today, checked off or removed here. */
export function HomeNotesCard({ card, library, onChanged }: HomeNotesCardProps) {
  const notes = card.data
  const baseId = useId()
  const [draft, setDraft] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = async (mutation: AgendaMutation, onDone?: () => void) => {
    if (isBusy) return
    setIsBusy(true)
    setError(null)
    try {
      await applyAgendaMutation(library, mutation, TODAY_VIEW)
      onDone?.()
      await onChanged()
    } catch (reason) {
      setError(agendaErrorMessage(reason))
    } finally {
      setIsBusy(false)
    }
  }

  const addNote = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (text) void mutate({ type: 'addNote', text }, () => setDraft(''))
  }

  return (
    <HomeCardShell
      id="home-notes-title"
      title="Anotador rápido"
      icon={<PenLine size={15} strokeWidth={1.75} />}
      className="home-card--notes"
      error={card.error}
      action={notes ? <span className="home-card__sub">{countLabel(notes.pending, 'pendiente', 'pendientes')}</span> : undefined}
    >
      {notes ? (
        <>
          <form className="home-note-form" onSubmit={addNote}>
            <label htmlFor={`${baseId}-draft`} className="home-sr">Nueva tarea del día</label>
            <input
              id={`${baseId}-draft`}
              className="home-field"
              type="text"
              placeholder="Anotá algo para hoy…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="home-button home-button--primary home-note-form__add" disabled={isBusy}>Agregar</button>
          </form>
          {error ? <p className="home-card__error" role="alert">{error}</p> : null}
          <div className="home-scroll home-checklist">
            {notes.items.length === 0 ? <p className="home-empty">Todavía no anotaste nada para hoy.</p> : null}
            {notes.items.map((note, index) => {
              const inputId = `${baseId}-note-${index}`
              return (
                <div key={note.id} className="home-check-row">
                  <input
                    type="checkbox"
                    id={inputId}
                    checked={note.done}
                    disabled={isBusy}
                    onChange={() => void mutate({ type: 'setNoteDone', id: note.id, done: !note.done })}
                  />
                  <label htmlFor={inputId} className={note.done ? 'is-done' : undefined}>{note.text}</label>
                  <button
                    type="button"
                    className="home-icon-button"
                    aria-label={`Borrar «${note.text}»`}
                    disabled={isBusy}
                    onClick={() => void mutate({ type: 'deleteNote', id: note.id })}
                  >
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </HomeCardShell>
  )
}
