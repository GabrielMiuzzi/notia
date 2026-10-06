import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ChevronDown, MessageSquare, Mic, MonitorSpeaker, Sparkles, X } from 'lucide-react'
import { MeetingLevelBars } from './MeetingLevelBars'
import { MeetingAiNotesPanel, type MeetingAiNotesActions } from './MeetingAiNotesPanel'
import { formatClock, lineAtMoment } from './meetingDisplay'
import type { SpeechLevelHistory } from './useSpeechLevels'
import type { MeetingAnswer, MeetingLine, MeetingMark, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

const LANE_BARS = 90
const LANE_HIGHLIGHT = 12
/** Distance from the end of the transcript within which it keeps following new lines. */
export const FOLLOW_THRESHOLD_PX = 80
const NOTES_SAVE_DELAY_MS = 600

/** The tabs of the live assistant: Notas IA and the live answers. */
export type MeetingAssistantTab = 'notes' | 'answers'

interface MeetingRecordingPanelProps {
  snapshot: MeetingSnapshot | null
  partialText: string
  levels: SpeechLevelHistory
  onToggleLiveAnswers: (enabled: boolean) => void
  onRegenerateAnswer: (answerId: string, shorter: boolean) => void
  onPinAnswer: (answerId: string, pinned: boolean) => void
  notesActions: MeetingAiNotesActions
  canAddNote: boolean
}

interface AssistantTabsProps {
  snapshot: MeetingSnapshot | null
  selected: MeetingAssistantTab
  onSelect: (tab: MeetingAssistantTab) => void
  /** The phone names the answers tab «Respuestas». */
  phone?: boolean
}

/** Notas IA, with how many topics it has, and the live answers, with a dot while they are on. */
export function MeetingAssistantTabs({ snapshot, selected, onSelect, phone = false }: AssistantTabsProps) {
  const topics = snapshot?.aiNotes.enabled ? snapshot.aiNotes.topics.length : 0
  const tabs: Array<{ id: MeetingAssistantTab; label: string }> = [
    { id: 'notes', label: 'Notas IA' },
    { id: 'answers', label: phone ? 'Respuestas' : 'Respuestas en vivo' },
  ]
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = selected === 'notes' ? 'answers' : 'notes'
    onSelect(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Asistente en vivo" className="notia-meeting-assistant-tabs" onKeyDown={handleKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          id={`meeting-assistant-tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`meeting-assistant-panel-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.id === 'notes' && topics > 0 ? <span className="notia-meeting-assistant-count">{topics}</span> : null}
          {tab.id === 'answers' && snapshot?.liveAnswers && !phone ? (
            <><span className="notia-meeting-assistant-dot" aria-hidden="true" /><span className="notia-meeting-sr">activas</span></>
          ) : null}
        </button>
      ))}
    </div>
  )
}

const NO_ANSWERS: MeetingAnswer[] = []

/**
 * Confirmed lines of a recording. They change only when a line arrives or an
 * answer updates, so the levels and the preview do not render them again:
 * a long meeting has thousands.
 */
export const LiveLines = memo(function LiveLines({ lines, answers }: { lines: MeetingLine[]; answers: MeetingAnswer[] }) {
  return lines.map((line) => {
    const answer = line.question ? answers.find((candidate) => candidate.askedAtMs === line.startMs) : undefined
    return (
      <div key={line.id} id={`meeting-line-${line.id}`} className="notia-meeting-live-line">
        <time>{formatClock(line.startMs)}</time>
        <div>
          {line.speaker ? <span className="notia-meeting-live-speaker">{line.speaker}</span> : null}
          <p>{line.text}</p>
          {answer ? (
            <span className="notia-meeting-question-chip">
              <Sparkles size={11} aria-hidden="true" />
              Pregunta detectada
              <span className="notia-meeting-question-status">
                {' '}· {answer.status === 'generating' ? 'respondiendo' : answer.status === 'ready' ? 'respondida' : 'sin respuesta'}
              </span>
            </span>
          ) : null}
        </div>
      </div>
    )
  })
})

export function MeetingRecordingPanel({
  snapshot,
  partialText,
  levels,
  onToggleLiveAnswers,
  onRegenerateAnswer,
  onPinAnswer,
  notesActions,
  canAddNote,
}: MeetingRecordingPanelProps) {
  const [follow, setFollow] = useState(true)
  const [tab, setTab] = useState<MeetingAssistantTab>('notes')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lines = snapshot?.lines ?? []
  const sources = snapshot?.sources ?? { microphone: true, system: false }

  useEffect(() => {
    const container = scrollRef.current
    if (follow && container) container.scrollTop = container.scrollHeight
  }, [follow, lines.length, partialText])

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distance > FOLLOW_THRESHOLD_PX && follow) setFollow(false)
  }

  const showMoment = (atMs: number) => {
    const line = lineAtMoment(lines, atMs)
    if (!line) return
    setFollow(false)
    document.getElementById(`meeting-line-${line.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="notia-meeting-live">
      <div className="notia-meeting-lanes">
        {sources.microphone ? (
          <div className="notia-meeting-lane notia-meeting-lane--microphone">
            <Mic size={15} aria-hidden="true" />
            <span>Micrófono</span>
            <MeetingLevelBars levels={levels.microphone} count={LANE_BARS} highlight={LANE_HIGHLIGHT} maxHeight={28} />
          </div>
        ) : null}
        {sources.system ? (
          <div className="notia-meeting-lane notia-meeting-lane--system">
            <MonitorSpeaker size={15} aria-hidden="true" />
            <span>Sistema</span>
            <MeetingLevelBars levels={levels.system} count={LANE_BARS} highlight={LANE_HIGHLIGHT} maxHeight={28} />
          </div>
        ) : null}
      </div>

      <div className="notia-meeting-columns">
        <section className="notia-meeting-card notia-meeting-transcript-card" aria-labelledby="meeting-live-title">
          <header className="notia-meeting-card-header">
            <div>
              <h2 id="meeting-live-title">Transcripción en vivo</h2>
              <span>Los hablantes se separan al finalizar</span>
            </div>
            <button
              type="button"
              className="notia-meeting-chip-button"
              aria-pressed={follow}
              onClick={() => setFollow((current) => !current)}
            >
              <ArrowDown size={13} aria-hidden="true" /> Seguir en vivo
            </button>
          </header>
          <div ref={scrollRef} className="notia-meeting-live-lines" onScroll={handleScroll} aria-live="polite">
            {lines.length === 0 && !partialText ? (
              <p className="notia-meeting-empty-text">La transcripción aparece acá mientras hablan…</p>
            ) : null}
            <LiveLines lines={lines} answers={snapshot?.liveAnswers ? snapshot.answers : NO_ANSWERS} />
            {partialText ? (
              <div className="notia-meeting-live-line notia-meeting-live-line--partial">
                {/* The utterance being heard starts after the last confirmed one. */}
                <time>{formatClock(lines[lines.length - 1]?.endMs ?? 0)}</time>
                <p>{partialText}<span className="notia-meeting-caret" aria-hidden="true" /></p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="notia-meeting-aside notia-meeting-aside--assistant" aria-label="Asistente en vivo">
          <MeetingAssistantTabs snapshot={snapshot} selected={tab} onSelect={setTab} />
          <div
            className="notia-meeting-assistant-panel"
            role="tabpanel"
            id={`meeting-assistant-panel-${tab}`}
            aria-labelledby={`meeting-assistant-tab-${tab}`}
          >
            {tab === 'notes' ? (
              <MeetingAiNotesPanel snapshot={snapshot} actions={notesActions} canAddNote={canAddNote} onShowMoment={showMoment} />
            ) : (
              <LiveAnswersCard
                snapshot={snapshot}
                onToggle={onToggleLiveAnswers}
                onRegenerate={onRegenerateAnswer}
                onPin={onPinAnswer}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

interface MeetingMarksProps {
  marks: MeetingMark[]
  onShow: (atMs: number) => void
  onRemove: (markId: string) => void
  /** Name of the button that marks a moment, as the layout shows it. */
  markButtonLabel?: string
}

/** Marked moments: each one goes back to its part of the transcript. */
export function MeetingMarks({ marks, onShow, onRemove, markButtonLabel = 'Marcar momento' }: MeetingMarksProps) {
  return (
    <section className="notia-meeting-card notia-meeting-marks" aria-labelledby="meeting-marks-title">
      <header>
        <h2 id="meeting-marks-title">Momentos marcados</h2>
        <span>{marks.length}</span>
      </header>
      {marks.length ? (
        <ul>
          {marks.map((mark) => (
            <li key={mark.id}>
              <button type="button" className="notia-meeting-mark" onClick={() => onShow(mark.atMs)}>
                <time>{formatClock(mark.atMs)}</time>
                <span>{mark.label}</span>
              </button>
              <button
                type="button"
                className="notia-meeting-icon-button"
                aria-label={`Quitar el momento ${formatClock(mark.atMs)}`}
                onClick={() => onRemove(mark.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notia-meeting-empty-text">Usá «{markButtonLabel}» para volver después a una parte de la reunión.</p>
      )}
    </section>
  )
}

interface LiveAnswersCardProps {
  snapshot: MeetingSnapshot | null
  onToggle: (enabled: boolean) => void
  onRegenerate: (answerId: string, shorter: boolean) => void
  onPin: (answerId: string, pinned: boolean) => void
}

interface AnswerActionsProps {
  answer: MeetingAnswer
  onRegenerate: (answerId: string, shorter: boolean) => void
  onPin: (answerId: string, pinned: boolean) => void
}

/** Copy, shorten or retry, and pin an answer to the meeting's note. */
export function MeetingAnswerActions({ answer, onRegenerate, onPin }: AnswerActionsProps) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(answer.text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }).catch(() => undefined)
  }
  return (
    <div className="notia-meeting-answer-actions">
      <button type="button" onClick={copy} disabled={!answer.text}>
        {copied ? 'Copiada' : 'Copiar'}
      </button>
      <button type="button" onClick={() => onRegenerate(answer.id, answer.status === 'ready')} disabled={answer.status === 'generating'}>
        {answer.status === 'failed' ? 'Reintentar' : 'Más corta'}
      </button>
      <button type="button" aria-pressed={answer.pinned} onClick={() => onPin(answer.id, !answer.pinned)} disabled={!answer.text}>
        {answer.pinned ? 'Fijada' : 'Fijar a la nota'}
      </button>
    </div>
  )
}

interface PreviousAnswersProps extends Omit<AnswerActionsProps, 'answer'> {
  /** Answers before the current one, newest first. */
  answers: MeetingAnswer[]
}

/** Earlier answers, each one opened on demand. */
export function MeetingPreviousAnswers({ answers, onRegenerate, onPin }: PreviousAnswersProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (answers.length === 0) return null
  return (
    <div className="notia-meeting-answers-previous">
      <div className="notia-meeting-answer-label">Anteriores</div>
      {answers.map((answer) => (
        <div key={answer.id} className="notia-meeting-previous-answer">
          <button
            type="button"
            aria-expanded={expandedId === answer.id}
            onClick={() => setExpandedId((id) => id === answer.id ? null : answer.id)}
          >
            <time>{formatClock(answer.askedAtMs)}</time>
            <span>{answer.question}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {expandedId === answer.id ? (
            <div>
              <p className="notia-meeting-answer-text">{answer.status === 'failed' ? answer.error : answer.text}</p>
              <MeetingAnswerActions answer={answer} onRegenerate={onRegenerate} onPin={onPin} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function LiveAnswersCard({ snapshot, onToggle, onRegenerate, onPin }: LiveAnswersCardProps) {
  const enabled = snapshot?.liveAnswers ?? false
  const answers = snapshot?.answers ?? []
  const current = answers[answers.length - 1]
  const previous = answers.slice(0, -1).reverse()

  return (
    <section className="notia-meeting-card notia-meeting-answers" data-enabled={enabled ? 'true' : 'false'} aria-labelledby="meeting-answers-title">
      <header className="notia-meeting-answers-head">
        <span className="notia-meeting-ai-badge" aria-hidden="true"><Sparkles size={15} /></span>
        <div>
          <h2 id="meeting-answers-title">Respuestas en vivo</h2>
          <span>Responde las preguntas que detecta</span>
        </div>
        <button
          type="button"
          role="switch"
          className="notia-meeting-switch"
          aria-checked={enabled}
          aria-labelledby="meeting-answers-title"
          disabled={!snapshot}
          onClick={() => onToggle(!enabled)}
        >
          <span aria-hidden="true" />
        </button>
      </header>
      <div className="notia-meeting-answers-body">
        {!enabled ? (
          <div className="notia-meeting-answers-empty">
            <MessageSquare size={22} aria-hidden="true" />
            <p>Activá Respuestas en vivo y, cuando alguien haga una pregunta, la respuesta aparece acá.</p>
          </div>
        ) : !current ? (
          <div className="notia-meeting-answers-empty">
            <MessageSquare size={22} aria-hidden="true" />
            <p>Cuando alguien haga una pregunta, la respuesta sugerida aparece acá.</p>
          </div>
        ) : (
          <>
            <div className="notia-meeting-answer-current">
              <div className="notia-meeting-answer-label notia-meeting-answer-label--accent">
                Pregunta detectada <time>{formatClock(current.askedAtMs)}</time>
              </div>
              <p className="notia-meeting-answer-question">{current.question}</p>
              <div className="notia-meeting-divider" />
              <div className="notia-meeting-answer-label">
                Respuesta
                {current.status === 'generating' ? <span className="notia-meeting-generating">generando</span> : null}
              </div>
              {current.status === 'failed' ? (
                <p className="notia-meeting-error-text" role="alert">{current.error ?? 'No se pudo generar la respuesta.'}</p>
              ) : (
                <p className="notia-meeting-answer-text" aria-live="polite">
                  {current.text}
                  {current.status === 'generating' ? <span className="notia-meeting-caret" aria-hidden="true" /> : null}
                </p>
              )}
              <MeetingAnswerActions key={current.id} answer={current} onRegenerate={onRegenerate} onPin={onPin} />
            </div>
            <MeetingPreviousAnswers answers={previous} onRegenerate={onRegenerate} onPin={onPin} />
          </>
        )}
      </div>
    </section>
  )
}

interface NotesCardProps {
  enabled: boolean
  initialNotes: string
  onSave: (notes: string) => void
}

/**
 * Quick notes saved to the meeting a moment after the person stops typing.
 * Keyed by meeting, so another meeting starts from its own notes.
 */
export function NotesCard({ enabled, initialNotes, onSave }: NotesCardProps) {
  const [notes, setNotes] = useState(initialNotes)
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef<string | null>(null)
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (pendingRef.current !== null) onSaveRef.current(pendingRef.current)
  }, [])

  const handleChange = (value: string) => {
    setNotes(value)
    pendingRef.current = value
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      pendingRef.current = null
      onSaveRef.current(value)
    }, NOTES_SAVE_DELAY_MS)
  }

  return (
    <section className="notia-meeting-card notia-meeting-notes">
      <label htmlFor="meeting-quick-notes">Notas rápidas</label>
      <textarea
        id="meeting-quick-notes"
        value={notes}
        disabled={!enabled}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="Anotá algo… se guarda junto a la transcripción"
      />
    </section>
  )
}
