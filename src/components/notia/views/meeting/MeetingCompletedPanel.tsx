import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, Combine, Copy, Pencil, RotateCw, Search, Sparkles, X } from 'lucide-react'
import { formatClock, formatDuration, generateLabel, speakerColorClass, timelineTicks } from './meetingDisplay'
import { MeetingAskPanel } from './MeetingAskPanel'
import { MeetingAiNotesBody } from './MeetingAiNotesPanel'
import { MeetingReviewNotice } from './MeetingReviewNotice'
import {
  useMeetingFinishedNotes,
  useMeetingInsights,
  useMeetingSearch,
  useMeetingSpeakerEdit,
  useTranscriptJump,
  type MeetingFinishedNotes,
} from './useMeetingCompleted'
import { listMeetingTaskBoards, sendMeetingTasks } from '../../../../services/meeting/meetingService'
import type {
  MeetingFilter,
  MeetingInsightsRequest,
  MeetingSnapshot,
  MeetingSpeaker,
} from '../../../../services/meeting/meetingTypes'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../../types/notia'

/*
 * Finished stage of Meeting (canvas «Notia · Meeting», board 4
 * «Transcripción finalizada»): who spoke and how much, the transcript, and
 * an aside with the meeting notes or the AI tools.
 */

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

type FinishedTab = 'notes' | 'ai'

interface MeetingCompletedPanelProps {
  snapshot: MeetingSnapshot
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
  aiPreferences: AiPreferences
  library: NotiaLibrary | null
}

export function MeetingCompletedPanel({ snapshot, filter, onFilterChange, aiPreferences, library }: MeetingCompletedPanelProps) {
  const [tab, setTab] = useState<FinishedTab>('notes')
  const speakersById = useMemo(
    () => new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker])),
    [snapshot.speakers],
  )
  const notes = useMeetingFinishedNotes(snapshot.id, aiPreferences)
  const jump = useTranscriptJump(snapshot.turns, filter, onFilterChange)
  return (
    <div className="notia-meeting-finished">
      <MeetingReviewNotice review={snapshot.review} />
      <MeetingTalkTime snapshot={snapshot} />
      <div className="notia-meeting-columns">
        <TranscriptCard
          snapshot={snapshot}
          speakersById={speakersById}
          filter={filter}
          onFilterChange={onFilterChange}
          highlightId={jump.highlightId}
        />
        <aside className="notia-meeting-aside notia-meeting-aside--assistant" aria-label="Trabajar con la reunión">
          <FinishedTabs selected={tab} onSelect={setTab} />
          <div className="notia-meeting-assistant-panel" role="tabpanel" id={`meeting-finished-panel-${tab}`} aria-labelledby={`meeting-finished-tab-${tab}`}>
            {tab === 'notes' ? (
              <section className="notia-meeting-card notia-meeting-finished-notes" aria-labelledby="meeting-finished-notes-title">
                <header className="notia-meeting-finished-notes-head">
                  <div>
                    <h2 id="meeting-finished-notes-title">Notas de la reunión</h2>
                    <span>Generadas por la IA · se guardan con la nota</span>
                  </div>
                  <MeetingNotesTools snapshot={snapshot} notes={notes} />
                </header>
                <MeetingFinishedNotesBody snapshot={snapshot} notes={notes} library={library} onShowMoment={jump.showMoment} />
              </section>
            ) : (
              <div className="notia-meeting-finished-ai">
                <InsightsCard meetingId={snapshot.id} aiPreferences={aiPreferences} reviewing={Boolean(snapshot.review.stage)} />
                <InsightsResults snapshot={snapshot} library={library} />
                <MeetingAskPanel
                  key={snapshot.id}
                  transcript={snapshot.contextText}
                  suggestions={snapshot.suggestedQuestions}
                  aiPreferences={aiPreferences}
                  library={library}
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

export const NO_SPEAKERS_TEXT = 'Esta reunión quedó sin separar por hablante. La transcripción conserva el minuto de cada frase.'
const NO_NOTES_TEXT = 'Todavía no hay notas de esta reunión. Tocá «Regenerar» y Munin las arma con la transcripción.'

function FinishedTabs({ selected, onSelect }: { selected: FinishedTab; onSelect: (tab: FinishedTab) => void }) {
  const tabs: Array<{ id: FinishedTab; label: string }> = [
    { id: 'notes', label: 'Notas de la reunión' },
    { id: 'ai', label: 'Preguntar a la IA' },
  ]
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = selected === 'notes' ? 'ai' : 'notes'
    onSelect(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Panel de la reunión" className="notia-meeting-assistant-tabs" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          id={`meeting-finished-tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`meeting-finished-panel-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
        >
          {tab.id === 'ai' ? <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" /> : null}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

interface NotesToolsProps {
  snapshot: MeetingSnapshot
  notes: MeetingFinishedNotes
}

/** «Copiar notas» and «Regenerar», the same on both layouts. */
export function MeetingNotesTools({ snapshot, notes }: NotesToolsProps) {
  const running = snapshot.aiNotes.running
  return (
    <div className="notia-meeting-notes-tools">
      <button
        type="button"
        className="notia-meeting-icon-button notia-meeting-outline-icon"
        aria-label={notes.copied ? 'Notas copiadas' : 'Copiar notas'}
        title={notes.copied ? 'Notas copiadas' : 'Copiar notas'}
        onClick={() => void notes.copy()}
      >
        {notes.copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <button type="button" className="notia-meeting-outline-button" disabled={running} onClick={() => void notes.regenerate()}>
        <RotateCw size={13} aria-hidden="true" className={running ? 'notia-meeting-spinning' : undefined} />
        {running ? 'Generando…' : 'Regenerar'}
      </button>
    </div>
  )
}

interface FinishedNotesBodyProps {
  snapshot: MeetingSnapshot
  notes: MeetingFinishedNotes
  library: NotiaLibrary | null
  onShowMoment: (atMs: number) => void
}

/** The Notas IA of the finished meeting, with its errors. */
export function MeetingFinishedNotesBody({ snapshot, notes, library, onShowMoment }: FinishedNotesBodyProps) {
  const agentError = snapshot.aiNotes.running ? undefined : snapshot.aiNotes.error
  return (
    <div className="notia-meeting-finished-notes-body">
      {snapshot.aiNotes.running ? (
        <p className="notia-meeting-finished-notes-status" role="status">
          <span className="notia-meeting-ai-agent-spinner" aria-hidden="true" />El agente está escribiendo las notas…
        </p>
      ) : null}
      {agentError ? <p className="notia-meeting-error-text" role="alert">{agentError}</p> : null}
      {notes.error ? <p className="notia-meeting-error-text" role="alert">{notes.error}</p> : null}
      <MeetingAiNotesBody
        snapshot={snapshot}
        actions={{ libraryId: library?.id ?? null, onRemoveMark: notes.removeMark, onError: notes.setError }}
        onShowMoment={onShowMoment}
        showJumps={false}
        emptyText={NO_NOTES_TEXT}
      />
    </div>
  )
}

/** Speaker spans laid on the length of the meeting. */
export function MeetingTalkTimeline({ snapshot, compact = false }: { snapshot: MeetingSnapshot; compact?: boolean }) {
  const duration = Math.max(1, snapshot.durationMs, ...snapshot.talkTimeline.map((span) => span.endMs))
  const colors = new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker]))
  return (
    <div
      className={compact ? 'notia-meeting-timeline notia-meeting-timeline--compact' : 'notia-meeting-timeline'}
      role="img"
      aria-label="Línea de tiempo de quién habló en cada momento"
    >
      {snapshot.talkTimeline.map((span) => {
        const speaker = colors.get(span.speakerId)
        return (
          <span
            key={`${span.speakerId}-${span.startMs}`}
            className={speaker ? speakerColorClass(speaker.colorIndex) : undefined}
            title={`${speaker?.name ?? ''} · ${formatClock(span.startMs)} – ${formatClock(span.endMs)}`}
            style={{ left: `${(span.startMs / duration) * 100}%`, width: `${((span.endMs - span.startMs) / duration) * 100}%` }}
          />
        )
      })}
    </div>
  )
}

/** «Tiempo de habla»: the timeline, each speaker's time and turns, renaming and joining them. */
function MeetingTalkTime({ snapshot }: { snapshot: MeetingSnapshot }) {
  const { editingId, draft, setDraft, error, setError, startEditing, stopEditing, saveName, merge: mergeSpeakers } = useMeetingSpeakerEdit(snapshot.id)
  const [merging, setMerging] = useState(false)
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const speakers = snapshot.speakers

  if (speakers.length === 0) {
    return (
      <div className="notia-meeting-card notia-meeting-no-speakers" role="note">
        {NO_SPEAKERS_TEXT}
      </div>
    )
  }

  const openMerge = () => {
    setMerging(true)
    setMergeSource(speakers[speakers.length - 1]?.id ?? '')
    setMergeTarget(speakers[0]?.id ?? '')
    setError(null)
  }

  const merge = async (event: FormEvent) => {
    event.preventDefault()
    if (await mergeSpeakers(mergeSource, mergeTarget)) setMerging(false)
  }

  return (
    <section className="notia-meeting-card notia-meeting-talk" aria-labelledby="meeting-talk-title">
      <div className="notia-meeting-talk-head">
        <h2 id="meeting-talk-title">Tiempo de habla</h2>
        <span>{`${formatDuration(snapshot.durationMs)} en total · ${speakers.length} ${speakers.length === 1 ? 'hablante' : 'hablantes'}`}</span>
        <button type="button" className="notia-meeting-merge-button" onClick={openMerge} disabled={speakers.length < 2 || merging}>
          <Combine size={13} aria-hidden="true" /> Unir hablantes
        </button>
      </div>
      <div className="notia-meeting-talk-timeline">
        <MeetingTalkTimeline snapshot={snapshot} />
        <div className="notia-meeting-talk-ticks notia-meeting-mono" aria-hidden="true">
          {timelineTicks(snapshot.durationMs).map((tick, index) => <span key={index}>{tick}</span>)}
        </div>
      </div>
      <div className="notia-meeting-talk-speakers">
        {speakers.map((speaker) => (
          <div key={speaker.id} className={`notia-meeting-talk-speaker ${speakerColorClass(speaker.colorIndex)}`}>
            <span className="notia-meeting-avatar" aria-hidden="true">{speaker.initials}</span>
            <div className="notia-meeting-talk-who">
              {editingId === speaker.id ? (
                <form className="notia-meeting-rename" onSubmit={(event) => void saveName(event)}>
                  <input
                    value={draft}
                    autoFocus
                    maxLength={60}
                    aria-label={`Nombre de ${speaker.name}`}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Escape') stopEditing() }}
                  />
                  <button type="submit" className="notia-meeting-icon-button" aria-label="Guardar nombre"><Check size={15} aria-hidden="true" /></button>
                  <button type="button" className="notia-meeting-icon-button" aria-label="Cancelar" onClick={stopEditing}><X size={15} aria-hidden="true" /></button>
                </form>
              ) : (
                <div className="notia-meeting-speaker-name">
                  <strong>{speaker.name}</strong>
                  <button type="button" className="notia-meeting-icon-button" aria-label={`Renombrar ${speaker.name}`} onClick={() => startEditing(speaker)}>
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                </div>
              )}
              <span>{`${speaker.turnCount} ${speaker.turnCount === 1 ? 'intervención' : 'intervenciones'}`}</span>
            </div>
            <div className="notia-meeting-talk-share">
              <strong className="notia-meeting-mono">{formatDuration(speaker.talkMs)}</strong>
              <span className="notia-meeting-mono">{speaker.sharePercent}%</span>
            </div>
            <div className="notia-meeting-talk-extra">
              <span>Más larga <strong className="notia-meeting-mono">{formatDuration(speaker.longestTurnMs)}</strong></span>
              <span>Promedio <strong className="notia-meeting-mono">{formatDuration(speaker.averageTurnMs)}</strong></span>
            </div>
          </div>
        ))}
      </div>
      {merging ? (
        <form className="notia-meeting-merge-form" onSubmit={(event) => void merge(event)}>
          <label>
            <span>Unir</span>
            <select value={mergeSource} onChange={(event) => setMergeSource(event.target.value)}>
              {speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
            </select>
          </label>
          <label>
            <span>con</span>
            <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
              {speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
            </select>
          </label>
          <p>Las intervenciones del primero pasan al segundo, que conserva su nombre.</p>
          <div className="notia-meeting-form-actions">
            <button type="button" className="notia-meeting-ghost-button" onClick={() => setMerging(false)}>Cancelar</button>
            <button type="submit" className="notia-meeting-primary-button" disabled={!mergeSource || mergeSource === mergeTarget}>Unir</button>
          </div>
        </form>
      ) : null}
      {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
    </section>
  )
}

interface TranscriptCardProps {
  snapshot: MeetingSnapshot
  speakersById: Map<string, MeetingSpeaker>
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
  highlightId: string | null
}

interface MeetingSpeakerFilterProps {
  speakers: MeetingSpeaker[]
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
}

/** Everyone, or the turns of one speaker. */
export function MeetingSpeakerFilter({ speakers, filter, onFilterChange }: MeetingSpeakerFilterProps) {
  if (speakers.length === 0) return null
  return (
    <div className="notia-meeting-filter" role="group" aria-label="Filtrar por hablante">
      <button
        type="button"
        aria-pressed={filter.speakerId === null}
        onClick={() => onFilterChange({ ...filter, speakerId: null })}
      >
        Todos
      </button>
      {speakers.map((speaker) => (
        <button
          key={speaker.id}
          type="button"
          className={speakerColorClass(speaker.colorIndex)}
          aria-pressed={filter.speakerId === speaker.id}
          onClick={() => onFilterChange({ ...filter, speakerId: speaker.id })}
        >
          <span className="notia-meeting-dot" aria-hidden="true" />{speaker.name}
        </button>
      ))}
    </div>
  )
}

function TranscriptCard({ snapshot, speakersById, filter, onFilterChange, highlightId }: TranscriptCardProps) {
  const [query, setQuery] = useMeetingSearch(filter, onFilterChange)

  return (
    <section className="notia-meeting-card notia-meeting-transcript-card" aria-label="Transcripción por hablante">
      <div className="notia-meeting-transcript-toolbar">
        <label className="notia-meeting-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Buscar en la transcripción"
            aria-label="Buscar en la transcripción"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <MeetingSpeakerFilter speakers={snapshot.speakers} filter={filter} onFilterChange={onFilterChange} />
      </div>
      <MeetingTurns snapshot={snapshot} speakersById={speakersById} highlightId={highlightId} />
    </section>
  )
}

interface MeetingTurnsProps {
  snapshot: MeetingSnapshot
  speakersById: Map<string, MeetingSpeaker>
  /** The turn a jump just showed. */
  highlightId?: string | null
}

/** The turns of the finished meeting, each with its speaker and minute. */
export function MeetingTurns({ snapshot, speakersById, highlightId = null }: MeetingTurnsProps) {
  return (
    <div className="notia-meeting-turns">
      {snapshot.turns.length === 0 ? (
        <p className="notia-meeting-empty-text">
          {snapshot.totalTurns === 0 ? 'No se reconoció texto en la grabación.' : 'Ninguna intervención coincide con la búsqueda.'}
        </p>
      ) : snapshot.turns.map((turn) => {
        const speaker = turn.speakerId ? speakersById.get(turn.speakerId) : undefined
        return (
          <article
            key={turn.id}
            id={`meeting-turn-${turn.id}`}
            className={`notia-meeting-turn ${speaker ? speakerColorClass(speaker.colorIndex) : ''}`}
            data-highlight={highlightId === turn.id ? 'true' : undefined}
          >
            {speaker ? <span className="notia-meeting-avatar notia-meeting-avatar--small" aria-hidden="true">{speaker.initials}</span> : null}
            <div>
              <div className="notia-meeting-turn-meta">
                {speaker ? <strong>{speaker.name}</strong> : null}
                <time>{formatClock(turn.startMs)}</time>
              </div>
              <p>{turn.text}</p>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export const INSIGHT_OPTIONS: Array<{ key: keyof MeetingInsightsRequest; label: string; hint?: string }> = [
  { key: 'summary', label: 'Resumen' },
  { key: 'keyPoints', label: 'Puntos clave' },
  { key: 'tasks', label: 'Tareas', hint: '→ Task Manager' },
  { key: 'correct', label: 'Corregir la transcripción', hint: 'errores de dictado' },
]

function InsightsCard({ meetingId, aiPreferences, reviewing }: { meetingId: string; aiPreferences: AiPreferences; reviewing: boolean }) {
  const { request, choose, isGenerating, error, nothingChosen, generate } = useMeetingInsights(meetingId, aiPreferences)

  return (
    <section className="notia-meeting-card notia-meeting-insights" aria-labelledby="meeting-insights-title">
      <header className="notia-meeting-answers-head">
        <span className="notia-meeting-ai-badge" aria-hidden="true"><Sparkles size={15} /></span>
        <h2 id="meeting-insights-title">Pasar por IA</h2>
      </header>
      <p>Elegí qué generar. El resultado se agrega a la nota de la reunión.</p>
      <div className="notia-meeting-insight-options">
        {INSIGHT_OPTIONS.map((option) => (
          <label key={option.key}>
            <input
              type="checkbox"
              checked={request[option.key]}
              disabled={isGenerating}
              onChange={(event) => choose(option.key, event.target.checked)}
            />
            <span>{option.label}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </label>
        ))}
      </div>
      <button type="button" className="notia-meeting-primary-button notia-meeting-wide-button" onClick={() => void generate()} disabled={isGenerating || nothingChosen || reviewing}>
        {generateLabel(isGenerating, reviewing)}
      </button>
      {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
    </section>
  )
}

export function InsightsResults({ snapshot, library }: { snapshot: MeetingSnapshot; library: NotiaLibrary | null }) {
  const { summary, keyPoints, tasks, corrected } = snapshot.insights
  const [selected, setSelected] = useState<string[]>([])
  const [boards, setBoards] = useState<string[] | null>(null)
  const [board, setBoard] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingTasks = tasks.filter((task) => !task.sent)
  const libraryId = library?.id ?? null
  const hasPendingTasks = pendingTasks.length > 0

  useEffect(() => {
    if (!hasPendingTasks || !libraryId) return
    let current = true
    void listMeetingTaskBoards(libraryId).then((names) => {
      if (!current) return
      setBoards(names)
      setBoard((value) => value || names[0] || '')
    }).catch((loadError) => {
      if (current) setError(errorText(loadError, 'No se pudieron leer los tableros.'))
    })
    return () => { current = false }
  }, [hasPendingTasks, libraryId])

  if (!summary && keyPoints.length === 0 && tasks.length === 0 && !corrected) return null

  const toggleTask = (taskId: string, checked: boolean) => {
    setSelected((current) => checked ? [...current, taskId] : current.filter((id) => id !== taskId))
  }

  const send = async () => {
    if (!libraryId) return
    setIsSending(true)
    setError(null)
    setMessage(null)
    try {
      const result = await sendMeetingTasks(snapshot.id, libraryId, board, selected)
      setMessage(`${result.created === 1 ? 'Se creó 1 tarea' : `Se crearon ${result.created} tareas`} en ${board}.`)
      setSelected([])
    } catch (sendError) {
      setError(errorText(sendError, 'No se pudieron crear las tareas.'))
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section className="notia-meeting-card notia-meeting-results" aria-label="Resultado de la IA">
      {corrected ? <p className="notia-meeting-results-note"><Check size={13} aria-hidden="true" /> Transcripción corregida con IA</p> : null}
      {summary ? (
        <div>
          <h3>Resumen</h3>
          <p>{summary}</p>
        </div>
      ) : null}
      {keyPoints.length > 0 ? (
        <div>
          <h3>Puntos clave</h3>
          <ul>{keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>
        </div>
      ) : null}
      {tasks.length > 0 ? (
        <div>
          <h3>Tareas</h3>
          <ul className="notia-meeting-task-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={task.sent || selected.includes(task.id)}
                    disabled={task.sent || isSending}
                    onChange={(event) => toggleTask(task.id, event.target.checked)}
                  />
                  <span>
                    <strong>{task.title}</strong>
                    {task.detail ? <small>{task.detail}</small> : null}
                  </span>
                  {task.sent ? <em>Enviada</em> : null}
                </label>
              </li>
            ))}
          </ul>
          {pendingTasks.length > 0 ? (
            library ? (
              <div className="notia-meeting-task-send">
                <label>
                  <span>Tablero</span>
                  <select value={board} onChange={(event) => setBoard(event.target.value)} disabled={!boards || boards.length === 0}>
                    {!boards ? <option value="">Cargando tableros…</option>
                      : boards.length === 0 ? <option value="">No hay tableros</option>
                        : boards.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="notia-meeting-secondary-button"
                  onClick={() => void send()}
                  disabled={isSending || selected.length === 0 || !board}
                >
                  {isSending ? 'Enviando…' : 'Enviar al Task Manager'}
                </button>
              </div>
            ) : <p className="notia-meeting-empty-text">Abrí una biblioteca para enviar las tareas al Task Manager.</p>
          ) : null}
          {message ? <p className="notia-meeting-success-text" role="status">{message}</p> : null}
          {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
