import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Clock, FileText, Flag, Plus, Sparkles, X } from 'lucide-react'
import { NotiaModalShell } from '../../NotiaModalShell'
import { listMeetingTaskBoards, sendMeetingTasks } from '../../../../services/meeting/meetingService'
import type { MeetingAiNotes, MeetingMark, MeetingNoteTask, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'
import { formatClock } from './meetingDisplay'

/*
 * Notas IA of a recording (canvas «Notia · Meeting», boards Grabando and
 * Mobile · Grabando): the notes the agent rewrites every few minutes, the
 * person's marks and own notes, and the follow-up tasks. The backend runs
 * the agent; this shows its notes and sends what the person does.
 */

const OFF_TEXT = 'Activá Notas IA y Munin arma el resumen: decisiones, preguntas abiertas, notas por tema y tareas de seguimiento.'
const PHONE_OFF_TEXT = 'Activalo y Munin arma el resumen: decisiones, preguntas, notas por tema y tareas.'
const EMPTY_TEXT = 'Las notas aparecen cuando el agente las toma. Podés llamarlo cuando quieras.'

/** `0:42` until `at` (ms since the epoch), updated every second; `null` without one. */
function useCountdown(at: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [at])
  if (at === undefined) return null
  const seconds = Math.max(0, Math.ceil((at - now) / 1_000))
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
}

/** What a notes panel needs to act on the meeting. */
export interface MeetingAiNotesActions {
  onToggleAiNotes: (enabled: boolean) => void
  onCallNotesAgent: () => void
  /** A note of the person's own, kept as a mark of this minute. */
  onAddOwnNote: (text: string) => Promise<boolean>
  onRemoveMark: (markId: string) => void
  onError: (message: string) => void
  /** The library the tasks go to; `null` without one open. */
  libraryId: string | null
}

interface AgentStatusProps {
  notes: MeetingAiNotes
  onCall: () => void
  /** The phone shows the status as a line of text. */
  compact?: boolean
}

/** When the agent takes notes next, or that it is taking them, and «Llamar agente». */
function AgentStatus({ notes, onCall, compact = false }: AgentStatusProps) {
  const countdown = useCountdown(notes.running ? undefined : notes.nextPassAt)
  return (
    <>
      <div className={compact ? 'notia-meeting-ai-agent notia-meeting-ai-agent--compact' : 'notia-meeting-ai-agent'} data-running={notes.running ? 'true' : undefined}>
        {compact ? null : notes.running
          ? <span className="notia-meeting-ai-agent-spinner" aria-hidden="true" />
          : <Clock size={14} aria-hidden="true" />}
        {/* The countdown changes every second: it is not announced. */}
        <span className="notia-meeting-ai-agent-text">
          {notes.running ? 'El agente está tomando notas…'
            : countdown ? <>Próxima actualización en <strong className="notia-meeting-mono">{countdown}</strong></>
              : 'Actualizá las notas cuando quieras.'}
        </span>
        <button type="button" className="notia-meeting-ai-agent-button" aria-disabled={notes.running} onClick={() => !notes.running && onCall()}>
          <Sparkles size={13} aria-hidden="true" />{notes.running ? 'Llamando…' : 'Llamar agente'}
        </button>
      </div>
      {notes.error && !notes.running ? <p className="notia-meeting-error-text" role="alert">{notes.error}</p> : null}
    </>
  )
}

interface NotesSectionProps {
  id: string
  title: string
  tone: string
  children: ReactNode
  divided?: boolean
}

function NotesSection({ id, title, tone, children, divided = false }: NotesSectionProps) {
  return (
    <section id={id} className="notia-meeting-ai-section" data-tone={tone} data-divided={divided ? 'true' : undefined} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}><span aria-hidden="true" />{title}</h3>
      {children}
    </section>
  )
}

interface TaskCardProps {
  task: MeetingNoteTask
  sending: boolean
  boards: string[] | null
  menuOpen: boolean
  onSend: (task: MeetingNoteTask, board?: string) => void
  onCloseMenu: () => void
}

function TaskCard({ task, sending, boards, menuOpen, onSend, onCloseMenu }: TaskCardProps) {
  return (
    <div className="notia-meeting-ai-task" data-sent={task.sent ? 'true' : undefined}>
      <span className="notia-meeting-ai-task-box" aria-hidden="true">{task.sent ? <Check size={11} strokeWidth={3} /> : null}</span>
      <div className="notia-meeting-ai-task-body">
        <span>{task.text}</span>
        <div className="notia-meeting-ai-task-meta">
          {task.owner ? (
            <span className="notia-meeting-ai-owner"><span aria-hidden="true">{task.ownerInitials}</span>{task.owner}</span>
          ) : null}
          <span className="notia-meeting-ai-due" data-empty={task.due ? undefined : 'true'}>{task.due || 'Sin fecha'}</span>
          {task.sent ? (
            <span className="notia-meeting-ai-sent">En Task Manager</span>
          ) : (
            <div className="notia-meeting-menu notia-meeting-ai-send">
              <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} disabled={sending} onClick={() => onSend(task)}>
                {sending ? 'Enviando…' : 'Al Task Manager'}
              </button>
              {menuOpen && boards ? (
                <div className="notia-meeting-menu-list" role="menu" aria-label="Tablero del Task Manager">
                  {boards.map((board) => (
                    <button key={board} type="button" role="menuitem" onClick={() => onSend(task, board)}>{board}</button>
                  ))}
                  <button type="button" role="menuitem" onClick={onCloseMenu}>Cancelar</button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface NotesBodyProps {
  snapshot: MeetingSnapshot
  actions: MeetingAiNotesActions
  onShowMoment: (atMs: number) => void
}

/** The notes themselves: objective, decisions, questions, marks, topics and tasks. */
export function MeetingAiNotesBody({ snapshot, actions, onShowMoment }: NotesBodyProps) {
  const notes = snapshot.aiNotes
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [boards, setBoards] = useState<string[] | null>(null)
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const sections = [
    { id: 'meeting-notes-decisions', label: 'Decisiones', tone: 'decisions', count: notes.decisions.length },
    { id: 'meeting-notes-questions', label: 'Preguntas', tone: 'questions', count: notes.openQuestions.length },
    { id: 'meeting-notes-marks', label: 'Marcas', tone: 'marks', count: snapshot.marks.length },
    { id: 'meeting-notes-topics', label: 'Notas', tone: 'topics', count: notes.topics.length },
    { id: 'meeting-notes-tasks', label: 'Tareas', tone: 'tasks', count: notes.tasks.length },
  ]
  const empty = !notes.objective && sections.every((section) => section.count === 0)

  const jump = (id: string) => {
    const target = document.getElementById(id)
    const container = scrollRef.current
    if (target && container) container.scrollTo({ top: target.offsetTop - container.offsetTop, behavior: 'smooth' })
  }

  const send = async (task: MeetingNoteTask, board?: string) => {
    if (!actions.libraryId) {
      actions.onError('Abrí una biblioteca para enviar tareas al Task Manager.')
      return
    }
    const libraryId = actions.libraryId
    let choice = board
    if (!choice) {
      let names = boards
      if (!names) {
        try {
          names = await listMeetingTaskBoards(libraryId)
          setBoards(names)
        } catch (error) {
          actions.onError(error instanceof Error ? error.message : 'No se pudieron leer los tableros.')
          return
        }
      }
      if (names.length === 0) {
        actions.onError('No hay tableros en el Task Manager de esta biblioteca.')
        return
      }
      if (names.length > 1) {
        setMenuTaskId((current) => (current === task.id ? null : task.id))
        return
      }
      choice = names[0]
    }
    setMenuTaskId(null)
    setSendingId(task.id)
    try {
      await sendMeetingTasks(snapshot.id, libraryId, choice, [task.id])
    } catch (error) {
      actions.onError(error instanceof Error ? error.message : 'No se pudo crear la tarea.')
    } finally {
      setSendingId(null)
    }
  }

  return (
    <>
      <nav className="notia-meeting-ai-jumps" aria-label="Secciones de las notas">
        {sections.map((section) => (
          <button key={section.id} type="button" data-tone={section.tone} disabled={section.count === 0} onClick={() => jump(section.id)}>
            <span aria-hidden="true" />{section.label} <small>{section.count}</small>
          </button>
        ))}
      </nav>
      <div ref={scrollRef} className="notia-meeting-ai-scroll">
        {empty ? <p className="notia-meeting-empty-text">{EMPTY_TEXT}</p> : null}
        {notes.objective ? (
          <div className="notia-meeting-ai-objective">
            <span>Objetivo</span>
            <p>{notes.objective}</p>
          </div>
        ) : null}
        {notes.decisions.length ? (
          <NotesSection id="meeting-notes-decisions" title="Decisiones" tone="decisions">
            <ul>{notes.decisions.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </NotesSection>
        ) : null}
        {notes.openQuestions.length ? (
          <NotesSection id="meeting-notes-questions" title="Preguntas abiertas" tone="questions">
            <ul>{notes.openQuestions.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </NotesSection>
        ) : null}
        {snapshot.marks.length ? (
          <NotesSection id="meeting-notes-marks" title="Tus marcas" tone="marks">
            <ul className="notia-meeting-ai-marks">
              {snapshot.marks.map((mark: MeetingMark) => (
                <li key={mark.id}>
                  <button type="button" onClick={() => onShowMoment(mark.atMs)}>
                    <time>{formatClock(mark.atMs)}</time> · {mark.label}
                  </button>
                  <button
                    type="button"
                    className="notia-meeting-icon-button"
                    aria-label={`Quitar la marca ${formatClock(mark.atMs)}`}
                    onClick={() => actions.onRemoveMark(mark.id)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </NotesSection>
        ) : null}
        {notes.topics.length ? (
          <NotesSection id="meeting-notes-topics" title="Notas de la reunión" tone="topics" divided>
            {notes.topics.map((topic, index) => (
              <div key={`${topic.atMs}-${index}`} className="notia-meeting-ai-topic">
                <div className="notia-meeting-ai-topic-head">
                  <strong>{topic.title}</strong>
                  <time>{formatClock(topic.atMs)}</time>
                  {topic.current ? <span className="notia-meeting-ai-live">En curso</span> : null}
                </div>
                {topic.items.length ? <ul>{topic.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul> : null}
              </div>
            ))}
          </NotesSection>
        ) : null}
        {notes.tasks.length ? (
          <NotesSection id="meeting-notes-tasks" title="Tareas de seguimiento" tone="tasks" divided>
            {notes.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                sending={sendingId === task.id}
                boards={boards}
                menuOpen={menuTaskId === task.id}
                onSend={(chosen, board) => void send(chosen, board)}
                onCloseMenu={() => setMenuTaskId(null)}
              />
            ))}
          </NotesSection>
        ) : null}
      </div>
    </>
  )
}

/** «Agregar una nota propia…»: the person's note, kept as a mark of this minute. */
function OwnNoteInput({ disabled, onAdd }: { disabled: boolean; onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    if (await onAdd(value)) setText('')
    setBusy(false)
  }
  return (
    <form className="notia-meeting-ai-own" onSubmit={(event) => void submit(event)}>
      <input
        value={text}
        placeholder="Agregar una nota propia…"
        aria-label="Agregar una nota propia"
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" aria-label="Agregar nota" disabled={disabled || busy || !text.trim()}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </form>
  )
}

interface MeetingAiNotesPanelProps {
  snapshot: MeetingSnapshot | null
  actions: MeetingAiNotesActions
  canAddNote: boolean
  onShowMoment: (atMs: number) => void
}

/** The Notas IA tab of the desktop aside. */
export function MeetingAiNotesPanel({ snapshot, actions, canAddNote, onShowMoment }: MeetingAiNotesPanelProps) {
  const notes = snapshot?.aiNotes
  const enabled = notes?.enabled ?? false
  return (
    <section className="notia-meeting-card notia-meeting-ai-notes" data-enabled={enabled ? 'true' : 'false'} aria-labelledby="meeting-ai-notes-title">
      <header className="notia-meeting-answers-head">
        <span className="notia-meeting-ai-badge" aria-hidden="true"><FileText size={15} /></span>
        <div>
          <h2 id="meeting-ai-notes-title">Notas IA</h2>
          <span>Un resumen que se arma mientras hablan</span>
        </div>
        <button
          type="button"
          role="switch"
          className="notia-meeting-switch"
          aria-checked={enabled}
          aria-labelledby="meeting-ai-notes-title"
          disabled={!snapshot}
          onClick={() => actions.onToggleAiNotes(!enabled)}
        >
          <span aria-hidden="true" />
        </button>
      </header>
      {snapshot && notes && enabled ? (
        <>
          <AgentStatus notes={notes} onCall={actions.onCallNotesAgent} />
          <MeetingAiNotesBody snapshot={snapshot} actions={actions} onShowMoment={onShowMoment} />
        </>
      ) : (
        <p className="notia-meeting-ai-off">{OFF_TEXT}</p>
      )}
      <OwnNoteInput disabled={!canAddNote} onAdd={actions.onAddOwnNote} />
    </section>
  )
}

/** The Notas IA tab of the phone's assistant: the topic under way and the latest of each kind. */
export function MeetingPhoneAiNotes({ snapshot, onCallAgent }: { snapshot: MeetingSnapshot; onCallAgent: () => void }) {
  const notes = snapshot.aiNotes
  if (!notes.enabled) return <p className="notia-meeting-phone-answers-empty">{PHONE_OFF_TEXT}</p>
  const topic = notes.topics[0]
  const rows = [
    { label: 'Decisiones', tone: 'decisions', text: notes.decisions.at(-1) },
    { label: 'Preguntas', tone: 'questions', text: notes.openQuestions.at(-1) },
    { label: 'Notas', tone: 'topics', text: topic?.items.at(-1) },
    { label: 'Tareas', tone: 'tasks', text: notes.tasks.filter((task) => !task.sent).at(-1)?.text },
  ].filter((row): row is { label: string; tone: string; text: string } => Boolean(row.text))
  return (
    <div className="notia-meeting-phone-ai-notes">
      {topic ? (
        <div className="notia-meeting-phone-ai-topic">
          <strong>{topic.title}</strong>
          {topic.current ? <span className="notia-meeting-ai-live">En curso</span> : null}
        </div>
      ) : null}
      {rows.length ? rows.map((row) => (
        <div key={row.label} className="notia-meeting-phone-ai-row" data-tone={row.tone}>
          <span>{row.label}</span>
          <p>{row.text}</p>
        </div>
      )) : <p className="notia-meeting-empty-text">{EMPTY_TEXT}</p>}
      <AgentStatus notes={notes} onCall={onCallAgent} compact />
    </div>
  )
}

interface MeetingAiNotesSheetProps {
  snapshot: MeetingSnapshot
  actions: MeetingAiNotesActions
  canAddNote: boolean
  onShowMoment: (atMs: number) => void
  onClose: () => void
}

/** Every note, opened from the phone's ⋮ menu. */
export function MeetingAiNotesSheet({ snapshot, actions, canAddNote, onShowMoment, onClose }: MeetingAiNotesSheetProps) {
  return (
    <NotiaModalShell open onClose={onClose} size="md" panelClassName="notia-meeting-phone-sheet notia-meeting-ai-notes-sheet">
      <div className="notia-meeting-phone-sheet-top">
        <span className="notia-meeting-phone-handle" aria-hidden="true" />
        <button type="button" className="notia-meeting-icon-button" aria-label="Cerrar" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <MeetingAiNotesPanel snapshot={snapshot} actions={actions} canAddNote={canAddNote} onShowMoment={onShowMoment} />
    </NotiaModalShell>
  )
}

interface MeetingMarkComposerProps {
  /** The minute the mark stays at. */
  atMs: number
  onSave: (label: string) => void
  onCancel: () => void
  /** The phone shows it as a bottom sheet. */
  phone?: boolean
}

/** «Nueva marca»: what the person wants to remember of this minute. */
export function MeetingMarkComposer({ atMs, onSave, onCancel, phone = false }: MeetingMarkComposerProps) {
  const [label, setLabel] = useState('')
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSave(label)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }
  const minute = (
    <span className="notia-meeting-ai-mark-minute"><Flag size={12} aria-hidden="true" />{formatClock(atMs)}</span>
  )
  const field = (
    <textarea
      id="meeting-mark-text"
      autoFocus
      value={label}
      placeholder={phone ? '¿Qué querés recordar de este momento?' : 'Ej.: buena respuesta sobre proveedores, repreguntar después…'}
      onChange={(event) => setLabel(event.target.value)}
      onKeyDown={handleKeyDown}
    />
  )
  if (phone) {
    return (
      <NotiaModalShell open onClose={onCancel} size="md" panelClassName="notia-meeting-phone-sheet notia-meeting-ai-mark-sheet">
        <span className="notia-meeting-phone-handle notia-meeting-ai-sheet-handle" aria-hidden="true" />
        <div className="notia-meeting-ai-mark-head">
          {minute}
          <label htmlFor="meeting-mark-text">Nueva marca</label>
        </div>
        {field}
        <div className="notia-meeting-ai-mark-actions">
          <button type="button" className="notia-meeting-ai-sheet-cancel" onClick={onCancel}>Cancelar</button>
          <button type="button" className="notia-meeting-phone-primary" onClick={() => onSave(label)}>Guardar marca</button>
        </div>
        <p className="notia-meeting-ai-mark-hint">La grabación sigue mientras escribís.</p>
      </NotiaModalShell>
    )
  }
  return (
    <div id="meeting-mark-popover" className="notia-meeting-ai-mark-popover" role="dialog" aria-label="Nueva marca">
      <div className="notia-meeting-ai-mark-head">
        {minute}
        <span>La marca queda en este minuto</span>
      </div>
      <label htmlFor="meeting-mark-text">¿Qué querés recordar?</label>
      {field}
      <div className="notia-meeting-ai-mark-actions">
        <span>Enter para guardar · Esc para cerrar</span>
        <button type="button" className="notia-meeting-ghost-button" onClick={onCancel}>Cancelar</button>
        <button type="button" className="notia-meeting-primary-button" onClick={() => onSave(label)}>Guardar marca</button>
      </div>
    </div>
  )
}
