import { useCallback, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { AGENDA_TODAY_REQUEST, useAgendaView } from '../hooks/useAgendaView'
import type { AgendaEvent, AgendaMutation, AgendaNote, AgendaPriority, AgendaSlotInput } from '../types/agendaTypes'
import { AgendaActionBar } from './AgendaActionBar'
import { AgendaMonthCalendar } from './AgendaMonthCalendar'
import { AgendaNotesCard } from './AgendaNotesCard'
import { AgendaUpcomingCard } from './AgendaUpcomingCard'
import { AgendaWeekGrid, type SlotMode } from './AgendaWeekGrid'
import '../styles/agenda.css'

const NO_SLOTS: ReadonlySet<string> = new Set()

function slotInput(key: string): AgendaSlotInput {
  const [date, minute] = key.split('|')
  return { date, minute: Number(minute) }
}

export function AgendaDashboardView({ library }: { library: NotiaLibrary }) {
  const { view, status, loadError, isMutating, navigate, reload, mutate } = useAgendaView(library)
  const [selectedSlots, setSelectedSlots] = useState<ReadonlySet<string>>(NO_SLOTS)
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [revealEventId, setRevealEventId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [chosenPriority, setChosenPriority] = useState<AgendaPriority | null>(null)
  const [weekError, setWeekError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const handleSlotChange = useCallback((key: string, mode: SlotMode) => {
    setSelectedSlots((current) => {
      if (current.has(key) === (mode === 'add')) return current
      const next = new Set(current)
      if (mode === 'add') next.add(key)
      else next.delete(key)
      return next
    })
    setActiveEventId(null)
    setWeekError(null)
  }, [])

  const handlePickEvent = useCallback((eventId: string) => {
    setSelectedSlots(NO_SLOTS)
    setActiveEventId(eventId)
    setWeekError(null)
  }, [])

  const handleRevealed = useCallback(() => setRevealEventId(null), [])

  const runMutation = async (mutation: AgendaMutation, onError: (message: string) => void): Promise<boolean> => {
    try {
      const outcome = await mutate(mutation)
      setAnnouncement(outcome.summary)
      return true
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
      return false
    }
  }

  if (!view) {
    if (status === 'loading') {
      return <main className="notia-main agenda-view" role="status" aria-live="polite"><p className="agenda-status">Cargando tu agenda…</p></main>
    }
    return (
      <main className="notia-main agenda-view">
        <div className="agenda-card agenda-load-error" role="alert">
          <p>{loadError ?? 'No se pudo cargar la agenda.'}</p>
          <button type="button" className="agenda-primary" onClick={() => void reload()}><RotateCcw size={16} aria-hidden="true" /> Reintentar</button>
        </div>
      </main>
    )
  }

  const priority = chosenPriority ?? view.defaultPriority
  const activeEvent = view.week.events.find((event) => event.id === activeEventId)
    ?? view.upcoming.events.find((event) => event.id === activeEventId)
    ?? null

  const schedule = async () => {
    if (selectedSlots.size === 0 || isMutating) return
    const saved = await runMutation(
      { type: 'scheduleEvents', slots: [...selectedSlots].map(slotInput), title: draftTitle, priority },
      setWeekError,
    )
    if (saved) {
      setSelectedSlots(NO_SLOTS)
      setDraftTitle('')
    }
  }

  const deleteActive = async () => {
    if (!activeEvent) return
    if (await runMutation({ type: 'deleteEvent', id: activeEvent.id }, setWeekError)) setActiveEventId(null)
  }

  const pickUpcoming = (event: AgendaEvent) => {
    navigate({ selectedDate: event.date, month: null })
    handlePickEvent(event.id)
    setRevealEventId(event.id)
  }

  const addNote = (text: string) => {
    setNotesError(null)
    return runMutation({ type: 'addNote', text }, setNotesError)
  }

  const toggleNote = (note: AgendaNote) => {
    setNotesError(null)
    void runMutation({ type: 'setNoteDone', id: note.id, done: !note.done }, setNotesError)
  }

  const deleteNote = (note: AgendaNote) => {
    setNotesError(null)
    void runMutation({ type: 'deleteNote', id: note.id }, setNotesError)
  }

  return (
    <main className="notia-main agenda-view">
      <div className="agenda-wrap">
        <header className="agenda-header">
          <div>
            <p className="agenda-eyebrow">{view.todayLabel}</p>
            <h1>Mi agenda</h1>
          </div>
          <p className="agenda-summary">{view.summaryLabel}</p>
        </header>
        <p className="agenda-visually-hidden" role="status" aria-live="polite">{announcement}</p>

        {loadError ? (
          <div className="agenda-banner" role="alert">
            <span>{loadError}</span>
            <button type="button" className="agenda-ghost" onClick={() => void reload()}>Reintentar</button>
          </div>
        ) : null}

        <AgendaMonthCalendar
          month={view.month}
          onPickDate={(date) => navigate({ selectedDate: date, month: null })}
          onShowMonth={(month) => navigate({ selectedDate: view.selectedDate, month })}
          onToday={() => navigate(AGENDA_TODAY_REQUEST)}
        />

        <section className="agenda-card" aria-labelledby="agenda-week-title">
          <div className="agenda-card__head">
            <div>
              <h2 id="agenda-week-title">Semana</h2>
              <p className="agenda-card__sub">{view.week.label}</p>
            </div>
            <div className="agenda-card__actions">
              <button type="button" className="agenda-round" aria-label="Semana anterior" onClick={() => navigate({ selectedDate: view.week.prevDate, month: null })}>
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
              <button type="button" className="agenda-round" aria-label="Semana siguiente" onClick={() => navigate({ selectedDate: view.week.nextDate, month: null })}>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <AgendaActionBar
            selectionCount={selectedSlots.size}
            slotMinutes={view.slotMinutes}
            draftTitle={draftTitle}
            priority={priority}
            priorities={view.priorities}
            activeEvent={activeEvent}
            disabled={isMutating}
            error={weekError}
            onDraftTitle={setDraftTitle}
            onPriority={setChosenPriority}
            onSchedule={() => void schedule()}
            onClearSelection={() => { setSelectedSlots(NO_SLOTS); setDraftTitle(''); setWeekError(null) }}
            onDeleteActive={() => void deleteActive()}
            onCloseActive={() => { setActiveEventId(null); setWeekError(null) }}
          />
          <AgendaWeekGrid
            week={view.week}
            timeSlots={view.timeSlots}
            slotMinutes={view.slotMinutes}
            selectedSlots={selectedSlots}
            activeEventId={activeEvent?.id ?? null}
            revealEventId={revealEventId}
            onRevealed={handleRevealed}
            onSlotChange={handleSlotChange}
            onPickEvent={handlePickEvent}
          />
        </section>

        <div className="agenda-bottom">
          <AgendaNotesCard
            notes={view.notes.items}
            pendingLabel={view.notes.pendingLabel}
            disabled={isMutating}
            error={notesError}
            onAdd={addNote}
            onToggle={toggleNote}
            onDelete={deleteNote}
          />
          <AgendaUpcomingCard events={view.upcoming.events} label={view.upcoming.label} onPick={pickUpcoming} />
        </div>
      </div>
    </main>
  )
}
