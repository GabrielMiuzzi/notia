import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Combine, Pencil, Search, Sparkles, X } from 'lucide-react'
import { formatClock, speakerColorClass } from './meetingDisplay'
import { MeetingAskPanel } from './MeetingAskPanel'
import {
  generateMeetingInsights,
  listMeetingTaskBoards,
  mergeMeetingSpeakers,
  renameMeetingSpeaker,
  sendMeetingTasks,
} from '../../../../services/meeting/meetingService'
import type {
  MeetingFilter,
  MeetingInsightsRequest,
  MeetingSnapshot,
  MeetingSpeaker,
} from '../../../../services/meeting/meetingTypes'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../../types/notia'

const SEARCH_DELAY_MS = 250

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

interface MeetingCompletedPanelProps {
  snapshot: MeetingSnapshot
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
  aiPreferences: AiPreferences
  library: NotiaLibrary | null
}

export function MeetingCompletedPanel({ snapshot, filter, onFilterChange, aiPreferences, library }: MeetingCompletedPanelProps) {
  const speakersById = useMemo(
    () => new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker])),
    [snapshot.speakers],
  )
  return (
    <div className="notia-meeting-finished">
      <SpeakersRow snapshot={snapshot} />
      <div className="notia-meeting-columns">
        <TranscriptCard snapshot={snapshot} speakersById={speakersById} filter={filter} onFilterChange={onFilterChange} />
        <aside className="notia-meeting-aside" aria-label="Trabajar con la reunión">
          <InsightsCard meetingId={snapshot.id} aiPreferences={aiPreferences} />
          <InsightsResults snapshot={snapshot} library={library} />
          <MeetingAskPanel
            key={snapshot.id}
            transcript={snapshot.contextText}
            suggestions={snapshot.suggestedQuestions}
            aiPreferences={aiPreferences}
            library={library}
          />
        </aside>
      </div>
    </div>
  )
}

function SpeakersRow({ snapshot }: { snapshot: MeetingSnapshot }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeSource, setMergeSource] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const speakers = snapshot.speakers

  if (speakers.length === 0) {
    return (
      <div className="notia-meeting-card notia-meeting-no-speakers" role="note">
        Esta reunión quedó sin separar por hablante. La transcripción conserva el minuto de cada frase.
      </div>
    )
  }

  const startEditing = (speaker: MeetingSpeaker) => {
    setEditingId(speaker.id)
    setDraft(speaker.name)
    setError(null)
  }

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingId) return
    try {
      await renameMeetingSpeaker(snapshot.id, editingId, draft)
      setEditingId(null)
    } catch (renameError) {
      setError(errorText(renameError, 'No se pudo renombrar al hablante.'))
    }
  }

  const openMerge = () => {
    setMerging(true)
    setMergeSource(speakers[speakers.length - 1]?.id ?? '')
    setMergeTarget(speakers[0]?.id ?? '')
    setError(null)
  }

  const merge = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await mergeMeetingSpeakers(snapshot.id, mergeSource, mergeTarget)
      setMerging(false)
    } catch (mergeError) {
      setError(errorText(mergeError, 'No se pudieron unir los hablantes.'))
    }
  }

  return (
    <div className="notia-meeting-speakers-block">
      <div className="notia-meeting-speakers">
        {speakers.map((speaker) => (
          <div key={speaker.id} className={`notia-meeting-card notia-meeting-speaker ${speakerColorClass(speaker.colorIndex)}`}>
            <span className="notia-meeting-avatar" aria-hidden="true">{speaker.initials}</span>
            <div className="notia-meeting-speaker-body">
              {editingId === speaker.id ? (
                <form className="notia-meeting-rename" onSubmit={(event) => void saveName(event)}>
                  <input
                    value={draft}
                    autoFocus
                    maxLength={60}
                    aria-label={`Nombre de ${speaker.name}`}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null) }}
                  />
                  <button type="submit" className="notia-meeting-icon-button" aria-label="Guardar nombre"><Check size={15} aria-hidden="true" /></button>
                  <button type="button" className="notia-meeting-icon-button" aria-label="Cancelar" onClick={() => setEditingId(null)}><X size={15} aria-hidden="true" /></button>
                </form>
              ) : (
                <div className="notia-meeting-speaker-name">
                  <strong>{speaker.name}</strong>
                  <button type="button" className="notia-meeting-icon-button" aria-label={`Renombrar ${speaker.name}`} onClick={() => startEditing(speaker)}>
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <span className="notia-meeting-mono">{speaker.sharePercent}% · {formatClock(speaker.talkMs)}</span>
                </div>
              )}
              <div className="notia-meeting-share" aria-hidden="true"><div style={{ width: `${speaker.sharePercent}%` }} /></div>
            </div>
          </div>
        ))}
        <button type="button" className="notia-meeting-merge-button" onClick={openMerge} disabled={speakers.length < 2 || merging}>
          <Combine size={14} aria-hidden="true" /> Unir hablantes
        </button>
      </div>
      {merging ? (
        <form className="notia-meeting-card notia-meeting-merge-form" onSubmit={(event) => void merge(event)}>
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
    </div>
  )
}

interface TranscriptCardProps {
  snapshot: MeetingSnapshot
  speakersById: Map<string, MeetingSpeaker>
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
}

function TranscriptCard({ snapshot, speakersById, filter, onFilterChange }: TranscriptCardProps) {
  const [query, setQuery] = useState(filter.query)

  useEffect(() => {
    if (query === filter.query) return
    const timer = window.setTimeout(() => onFilterChange({ ...filter, query }), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [filter, onFilterChange, query])

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
        {snapshot.speakers.length > 0 ? (
          <div className="notia-meeting-filter" role="group" aria-label="Filtrar por hablante">
            <button
              type="button"
              aria-pressed={filter.speakerId === null}
              onClick={() => onFilterChange({ ...filter, speakerId: null })}
            >
              Todos
            </button>
            {snapshot.speakers.map((speaker) => (
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
        ) : null}
      </div>
      <div className="notia-meeting-turns">
        {snapshot.turns.length === 0 ? (
          <p className="notia-meeting-empty-text">
            {snapshot.totalTurns === 0 ? 'No se reconoció texto en la grabación.' : 'Ninguna intervención coincide con la búsqueda.'}
          </p>
        ) : snapshot.turns.map((turn) => {
          const speaker = turn.speakerId ? speakersById.get(turn.speakerId) : undefined
          return (
            <article key={turn.id} className={`notia-meeting-turn ${speaker ? speakerColorClass(speaker.colorIndex) : ''}`}>
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
    </section>
  )
}

const INSIGHT_OPTIONS: Array<{ key: keyof MeetingInsightsRequest; label: string; hint?: string }> = [
  { key: 'summary', label: 'Resumen' },
  { key: 'keyPoints', label: 'Puntos clave' },
  { key: 'tasks', label: 'Tareas', hint: '→ Task Manager' },
  { key: 'correct', label: 'Corregir la transcripción', hint: 'errores de dictado' },
]

function InsightsCard({ meetingId, aiPreferences }: { meetingId: string; aiPreferences: AiPreferences }) {
  const [request, setRequest] = useState<MeetingInsightsRequest>({ summary: true, keyPoints: true, tasks: false, correct: false })
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nothingChosen = !Object.values(request).some(Boolean)

  const generate = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      await generateMeetingInsights(meetingId, request, aiPreferences)
    } catch (generateError) {
      setError(errorText(generateError, 'No se pudo pasar la reunión por IA.'))
    } finally {
      setIsGenerating(false)
    }
  }

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
              onChange={(event) => setRequest((current) => ({ ...current, [option.key]: event.target.checked }))}
            />
            <span>{option.label}</span>
            {option.hint ? <small>{option.hint}</small> : null}
          </label>
        ))}
      </div>
      <button type="button" className="notia-meeting-primary-button notia-meeting-wide-button" onClick={() => void generate()} disabled={isGenerating || nothingChosen}>
        {isGenerating ? 'Generando…' : 'Generar'}
      </button>
      {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
    </section>
  )
}

function InsightsResults({ snapshot, library }: { snapshot: MeetingSnapshot; library: NotiaLibrary | null }) {
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
