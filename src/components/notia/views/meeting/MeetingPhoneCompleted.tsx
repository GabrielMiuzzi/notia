import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, FileText, Mic, NotebookText, Pencil, Search, Sparkles, X } from 'lucide-react'
import { MeetingAskConversation, MeetingAskForm } from './MeetingAskPanel'
import { InsightsResults, MeetingSpeakerFilter, MeetingTurns, NO_SPEAKERS_TEXT } from './MeetingCompletedPanel'
import { MeetingReviewNotice } from './MeetingReviewNotice'
import { formatClock, generateLabel, speakerColorClass } from './meetingDisplay'
import { useMeetingAsk, type MeetingAsk } from './useMeetingAsk'
import { useMeetingInsights, useMeetingSearch, useMeetingSpeakerEdit } from './useMeetingCompleted'
import type { MeetingFilter, MeetingInsightsRequest, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../../types/notia'

/*
 * Finished stage of Meeting in the space of a phone (canvas «Notia ·
 * Meeting», board M4 «Finalizada»): the speakers on top, the transcript or
 * the AI in two tabs, and the tab's action at the bottom.
 */

type PhoneTab = 'transcript' | 'ai'

const TABS: PhoneTab[] = ['transcript', 'ai']

const INSIGHT_OPTIONS: Array<{ key: keyof MeetingInsightsRequest; label: string; hint?: string }> = [
  { key: 'summary', label: 'Resumen' },
  { key: 'keyPoints', label: 'Puntos clave' },
  { key: 'tasks', label: 'Tareas', hint: '→ Task Manager' },
  { key: 'correct', label: 'Corregir transcripción' },
]

interface MeetingPhoneCompletedProps {
  snapshot: MeetingSnapshot
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
  aiPreferences: AiPreferences
  library: NotiaLibrary | null
  /** The search of the bar is open. */
  searchOpen: boolean
  onCloseSearch: () => void
  /** An action of the meeting is running; the others wait. */
  isBusy: boolean
  isSaving: boolean
  onNewRecording: () => void
  onSaveNote: () => void
  onOpenNote: () => void
}

export function MeetingPhoneCompleted({
  snapshot,
  filter,
  onFilterChange,
  aiPreferences,
  library,
  searchOpen,
  onCloseSearch,
  isBusy,
  isSaving,
  onNewRecording,
  onSaveNote,
  onOpenNote,
}: MeetingPhoneCompletedProps) {
  const [tab, setTab] = useState<PhoneTab>('transcript')
  // Both live here so a change of tab keeps the chosen options and the conversation.
  const insights = useMeetingInsights(snapshot.id, aiPreferences)
  const conversation = useMeetingAsk({ transcript: snapshot.contextText, aiPreferences, library })
  const speakersById = useMemo(
    () => new Map(snapshot.speakers.map((speaker) => [speaker.id, speaker])),
    [snapshot.speakers],
  )
  const speakerCount = snapshot.speakers.length

  // Searching looks in the transcript.
  useEffect(() => {
    if (searchOpen) setTab('transcript')
  }, [searchOpen])

  const handleTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'transcript' ? 'ai' : 'transcript'
    setTab(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }

  return (
    <div className="notia-meeting-phone-stage">
      <div className="notia-meeting-phone-summary">
        {searchOpen ? <PhoneSearch snapshot={snapshot} filter={filter} onFilterChange={onFilterChange} onClose={onCloseSearch} /> : null}
        <span className="notia-meeting-phone-pill notia-meeting-phone-pill--done" role="status">
          <Check size={12} strokeWidth={2.4} aria-hidden="true" />Finalizada
          <span className="notia-meeting-pill-detail">
            {' '}· {formatClock(snapshot.durationMs)}{speakerCount > 0 ? ` · ${speakerCount} ${speakerCount === 1 ? 'hablante' : 'hablantes'}` : ''}
          </span>
        </span>
        <MeetingReviewNotice review={snapshot.review} />
        <PhoneSpeakers snapshot={snapshot} />
        <div className="notia-meeting-phone-view-tabs" role="tablist" aria-label="Vista" onKeyDown={handleTabsKeyDown}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`meeting-phone-tab-${id}`}
              data-tab={id}
              aria-selected={tab === id}
              aria-controls="meeting-phone-view"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {id === 'ai' ? <><Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />IA</> : 'Transcripción'}
            </button>
          ))}
        </div>
      </div>

      <div className="notia-meeting-phone-content" id="meeting-phone-view" role="tabpanel" aria-labelledby={`meeting-phone-tab-${tab}`}>
        {tab === 'transcript'
          ? <MeetingTurns snapshot={snapshot} speakersById={speakersById} />
          : <PhoneAi snapshot={snapshot} library={library} insights={insights} conversation={conversation} />}
      </div>

      {tab === 'transcript' ? (
        <div className="notia-meeting-phone-foot notia-meeting-phone-note-bar">
          <button type="button" className="notia-meeting-phone-square" aria-label="Nueva grabación" onClick={onNewRecording} disabled={isBusy}>
            <Mic size={18} aria-hidden="true" />
          </button>
          {snapshot.savedNotePath ? (
            <button type="button" className="notia-meeting-phone-square" aria-label="Abrir nota" onClick={onOpenNote}>
              <NotebookText size={18} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="notia-meeting-phone-primary"
            onClick={onSaveNote}
            disabled={!library || isBusy}
            title={library ? undefined : 'Abrí una biblioteca para guardar la reunión'}
          >
            <FileText size={16} aria-hidden="true" />
            {isSaving ? 'Guardando…' : snapshot.savedNotePath ? 'Actualizar nota' : 'Guardar como nota'}
          </button>
        </div>
      ) : (
        <div className="notia-meeting-phone-foot notia-meeting-phone-ask-bar">
          <MeetingAskForm conversation={conversation} />
        </div>
      )}
    </div>
  )
}

interface PhoneSearchProps {
  snapshot: MeetingSnapshot
  filter: MeetingFilter
  onFilterChange: (filter: MeetingFilter) => void
  onClose: () => void
}

function PhoneSearch({ snapshot, filter, onFilterChange, onClose }: PhoneSearchProps) {
  const [query, setQuery] = useMeetingSearch(filter, onFilterChange)
  return (
    <div className="notia-meeting-phone-search">
      <div className="notia-meeting-phone-search-row">
        <label className="notia-meeting-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            autoFocus
            placeholder="Buscar en la transcripción"
            aria-label="Buscar en la transcripción"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" className="notia-meeting-icon-button" aria-label="Cerrar la búsqueda" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <MeetingSpeakerFilter speakers={snapshot.speakers} filter={filter} onFilterChange={onFilterChange} />
    </div>
  )
}

function PhoneSpeakers({ snapshot }: { snapshot: MeetingSnapshot }) {
  const edit = useMeetingSpeakerEdit(snapshot.id)
  const [mergeTarget, setMergeTarget] = useState('')
  const speakers = snapshot.speakers

  if (speakers.length === 0) return <p className="notia-meeting-phone-no-speakers" role="note">{NO_SPEAKERS_TEXT}</p>

  const editing = speakers.find((speaker) => speaker.id === edit.editingId)
  const others = editing ? speakers.filter((speaker) => speaker.id !== editing.id) : []

  const merge = async (event: FormEvent) => {
    event.preventDefault()
    if (editing && await edit.merge(editing.id, mergeTarget)) edit.stopEditing()
  }

  return (
    <>
      <div className="notia-meeting-phone-speakers">
        {speakers.map((speaker) => (
          <button
            key={speaker.id}
            type="button"
            className={`notia-meeting-phone-speaker ${speakerColorClass(speaker.colorIndex)}`}
            aria-label={`Editar ${speaker.name}`}
            aria-expanded={edit.editingId === speaker.id}
            onClick={() => {
              if (edit.editingId === speaker.id) {
                edit.stopEditing()
                return
              }
              edit.startEditing(speaker)
              setMergeTarget(speakers.find((other) => other.id !== speaker.id)?.id ?? '')
            }}
          >
            <span className="notia-meeting-avatar" aria-hidden="true">{speaker.initials}</span>
            <span className="notia-meeting-phone-speaker-body">
              <span className="notia-meeting-phone-speaker-name">
                <span>{speaker.name}</span>
                <Pencil size={11} aria-hidden="true" />
              </span>
              <span className="notia-meeting-phone-share" aria-hidden="true"><span style={{ width: `${speaker.sharePercent}%` }} /></span>
              <span className="notia-meeting-mono">{speaker.sharePercent}% · {formatClock(speaker.talkMs)}</span>
            </span>
          </button>
        ))}
      </div>
      {editing ? (
        <div className="notia-meeting-phone-card notia-meeting-phone-speaker-edit">
          <form onSubmit={(event) => void edit.saveName(event)}>
            <label>
              <span>Nombre</span>
              <input
                value={edit.draft}
                autoFocus
                maxLength={60}
                aria-label={`Nombre de ${editing.name}`}
                onChange={(event) => edit.setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') edit.stopEditing() }}
              />
            </label>
            <div className="notia-meeting-form-actions">
              <button type="button" className="notia-meeting-ghost-button" onClick={edit.stopEditing}>Cancelar</button>
              <button type="submit" className="notia-meeting-primary-button" disabled={!edit.draft.trim()}>Guardar</button>
            </div>
          </form>
          {others.length > 0 ? (
            <form onSubmit={(event) => void merge(event)}>
              <label>
                <span>Unir {editing.name} con</span>
                <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
                  {others.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
                </select>
              </label>
              <p>Sus intervenciones pasan a quien elijas, que conserva su nombre.</p>
              <button type="submit" className="notia-meeting-secondary-button" disabled={!mergeTarget}>Unir hablantes</button>
            </form>
          ) : null}
        </div>
      ) : null}
      {edit.error ? <p className="notia-meeting-error-text" role="alert">{edit.error}</p> : null}
    </>
  )
}

interface PhoneAiProps {
  snapshot: MeetingSnapshot
  library: NotiaLibrary | null
  insights: ReturnType<typeof useMeetingInsights>
  conversation: MeetingAsk
}

function PhoneAi({ snapshot, library, insights, conversation }: PhoneAiProps) {
  const { request, choose, isGenerating, error, nothingChosen, generate } = insights
  const reviewing = Boolean(snapshot.review.stage)
  return (
    <div className="notia-meeting-phone-ai">
      <section className="notia-meeting-phone-ai-section" aria-labelledby="meeting-phone-insights-title">
        <h2 id="meeting-phone-insights-title">Pasar por IA</h2>
        <div className="notia-meeting-phone-checks">
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
        <button type="button" className="notia-meeting-phone-generate" onClick={() => void generate()} disabled={isGenerating || nothingChosen || reviewing}>
          {generateLabel(isGenerating, reviewing)}
        </button>
        {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
      </section>
      <InsightsResults snapshot={snapshot} library={library} />
      <section className="notia-meeting-phone-ai-section" aria-labelledby="meeting-phone-ask-title">
        <h2 id="meeting-phone-ask-title">Preguntale a la reunión</h2>
        <MeetingAskConversation conversation={conversation} suggestions={snapshot.suggestedQuestions} />
      </section>
    </div>
  )
}
