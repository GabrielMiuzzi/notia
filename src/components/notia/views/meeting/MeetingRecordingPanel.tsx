import { memo, useEffect, useRef, useState } from 'react'
import { ArrowDown, ChevronDown, MessageSquare, Mic, MonitorSpeaker, Sparkles, X } from 'lucide-react'
import { MeetingLevelBars } from './MeetingLevelBars'
import { formatClock } from './meetingDisplay'
import type { SpeechLevelHistory } from './useSpeechLevels'
import type { MeetingAnswer, MeetingLine, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

const LANE_BARS = 90
const LANE_HIGHLIGHT = 12
const FOLLOW_THRESHOLD_PX = 80
const NOTES_SAVE_DELAY_MS = 600

interface MeetingRecordingPanelProps {
  snapshot: MeetingSnapshot | null
  partialText: string
  levels: SpeechLevelHistory
  onToggleLiveAnswers: (enabled: boolean) => void
  onRegenerateAnswer: (answerId: string, shorter: boolean) => void
  onPinAnswer: (answerId: string, pinned: boolean) => void
  onSaveNotes: (notes: string) => void
  onRemoveMark: (markId: string) => void
}

const NO_ANSWERS: MeetingAnswer[] = []

/**
 * Confirmed lines of a recording. They change only when a line arrives or an
 * answer updates, so the levels and the preview do not render them again:
 * a long meeting has thousands.
 */
const LiveLines = memo(function LiveLines({ lines, answers }: { lines: MeetingLine[]; answers: MeetingAnswer[] }) {
  return lines.map((line) => {
    const answer = line.question ? answers.find((candidate) => candidate.askedAtMs === line.startMs) : undefined
    return (
      <div key={line.id} id={`meeting-line-${line.id}`} className="notia-meeting-live-line">
        <time>{formatClock(line.startMs)}</time>
        <div>
          <p>{line.text}</p>
          {answer ? (
            <span className="notia-meeting-question-chip">
              <Sparkles size={11} aria-hidden="true" />
              Pregunta detectada · {answer.status === 'generating' ? 'respondiendo' : answer.status === 'ready' ? 'respondida' : 'sin respuesta'}
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
  onSaveNotes,
  onRemoveMark,
}: MeetingRecordingPanelProps) {
  const [follow, setFollow] = useState(true)
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
    const line = [...lines].reverse().find((candidate) => candidate.startMs <= atMs) ?? lines[0]
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

        <aside className="notia-meeting-aside" aria-label="Asistencia durante la reunión">
          <LiveAnswersCard
            snapshot={snapshot}
            onToggle={onToggleLiveAnswers}
            onRegenerate={onRegenerateAnswer}
            onPin={onPinAnswer}
          />
          <NotesCard
            key={snapshot?.id ?? 'no-meeting'}
            enabled={Boolean(snapshot)}
            initialNotes={snapshot?.notes ?? ''}
            onSave={onSaveNotes}
          />
          <section className="notia-meeting-card notia-meeting-marks" aria-labelledby="meeting-marks-title">
            <header>
              <h2 id="meeting-marks-title">Momentos marcados</h2>
              <span>{snapshot?.marks.length ?? 0}</span>
            </header>
            {snapshot?.marks.length ? (
              <ul>
                {snapshot.marks.map((mark) => (
                  <li key={mark.id}>
                    <button type="button" className="notia-meeting-mark" onClick={() => showMoment(mark.atMs)}>
                      <time>{formatClock(mark.atMs)}</time>
                      <span>{mark.label}</span>
                    </button>
                    <button
                      type="button"
                      className="notia-meeting-icon-button"
                      aria-label={`Quitar el momento ${formatClock(mark.atMs)}`}
                      onClick={() => onRemoveMark(mark.id)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="notia-meeting-empty-text">Usá «Marcar momento» para volver después a una parte de la reunión.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

interface LiveAnswersCardProps {
  snapshot: MeetingSnapshot | null
  onToggle: (enabled: boolean) => void
  onRegenerate: (answerId: string, shorter: boolean) => void
  onPin: (answerId: string, pinned: boolean) => void
}

function LiveAnswersCard({ snapshot, onToggle, onRegenerate, onPin }: LiveAnswersCardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const enabled = snapshot?.liveAnswers ?? false
  const answers = snapshot?.answers ?? []
  const current = answers[answers.length - 1]
  const previous = answers.slice(0, -1).reverse()

  const copy = (answer: MeetingAnswer) => {
    void navigator.clipboard?.writeText(answer.text).then(() => {
      setCopiedId(answer.id)
      window.setTimeout(() => setCopiedId((id) => id === answer.id ? null : id), 1_500)
    }).catch(() => undefined)
  }

  const renderActions = (answer: MeetingAnswer) => (
    <div className="notia-meeting-answer-actions">
      <button type="button" onClick={() => copy(answer)} disabled={!answer.text}>
        {copiedId === answer.id ? 'Copiada' : 'Copiar'}
      </button>
      <button type="button" onClick={() => onRegenerate(answer.id, answer.status === 'ready')} disabled={answer.status === 'generating'}>
        {answer.status === 'failed' ? 'Reintentar' : 'Más corta'}
      </button>
      <button type="button" aria-pressed={answer.pinned} onClick={() => onPin(answer.id, !answer.pinned)} disabled={!answer.text}>
        {answer.pinned ? 'Fijada' : 'Fijar a la nota'}
      </button>
    </div>
  )

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
              {renderActions(current)}
            </div>
            {previous.length > 0 ? (
              <div className="notia-meeting-answers-previous">
                <div className="notia-meeting-answer-label">Anteriores</div>
                {previous.map((answer) => (
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
                        {renderActions(answer)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
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
function NotesCard({ enabled, initialNotes, onSave }: NotesCardProps) {
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
