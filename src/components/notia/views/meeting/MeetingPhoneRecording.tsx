import { useEffect, useRef, useState } from 'react'
import { Flag, Pause, Play, Sparkles, Square, X } from 'lucide-react'
import { NotiaModalShell } from '../../NotiaModalShell'
import { MeetingLevelBars } from './MeetingLevelBars'
import {
  FOLLOW_THRESHOLD_PX,
  LiveLines,
  MeetingAnswerActions,
  MeetingMarks,
  MeetingPreviousAnswers,
  NotesCard,
} from './MeetingRecordingPanel'
import { formatClock, lineAtMoment } from './meetingDisplay'
import type { SpeechLevelHistory } from './useSpeechLevels'
import type { MeetingAnswer, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

/*
 * Recording stage of Meeting in the space of a phone (canvas «Notia ·
 * Meeting», board M2 «Grabando»): the levels, the transcript following the
 * newest line, the live answers as a sheet and the controls at the bottom.
 * Lines may arrive late and in bursts (Android has no live preview), so the
 * transcript only follows them while the person is at its end.
 */

const WAVE_BARS = 70
const WAVE_HIGHLIGHT = 11
const WAVE_HEIGHT = 24
const NO_ANSWERS: MeetingAnswer[] = []

/** What the ⋮ menu of the recording opens. */
export type MeetingPhoneSheet = 'notes' | 'marks'

interface MeetingPhoneRecordingProps {
  snapshot: MeetingSnapshot | null
  partialText: string
  levels: SpeechLevelHistory
  isPaused: boolean
  canMark: boolean
  onMark: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onToggleLiveAnswers: (enabled: boolean) => void
  onRegenerateAnswer: (answerId: string, shorter: boolean) => void
  onPinAnswer: (answerId: string, pinned: boolean) => void
  onSaveNotes: (notes: string) => void
  onRemoveMark: (markId: string) => void
  sheet: MeetingPhoneSheet | null
  onCloseSheet: () => void
}

export function MeetingPhoneRecording({
  snapshot,
  partialText,
  levels,
  isPaused,
  canMark,
  onMark,
  onPause,
  onResume,
  onStop,
  onToggleLiveAnswers,
  onRegenerateAnswer,
  onPinAnswer,
  onSaveNotes,
  onRemoveMark,
  sheet,
  onCloseSheet,
}: MeetingPhoneRecordingProps) {
  const [follow, setFollow] = useState(true)
  const scrollRef = useRef<HTMLElement | null>(null)
  const lines = snapshot?.lines ?? []
  const sources = snapshot?.sources ?? { microphone: true, system: false }

  useEffect(() => {
    const container = scrollRef.current
    if (follow && container) container.scrollTop = container.scrollHeight
  }, [follow, lines.length, partialText])

  // Without a «Seguir en vivo» button, being at the end is what follows.
  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const atEnd = container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_THRESHOLD_PX
    if (atEnd !== follow) setFollow(atEnd)
  }

  const showMoment = (atMs: number) => {
    const line = lineAtMoment(lines, atMs)
    onCloseSheet()
    if (!line) return
    setFollow(false)
    document.getElementById(`meeting-line-${line.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="notia-meeting-phone-stage">
      {sources.microphone ? <PhoneWave source="microphone" levels={levels.microphone} /> : null}
      {sources.system ? <PhoneWave source="system" levels={levels.system} /> : null}

      <section ref={scrollRef} className="notia-meeting-phone-live" aria-label="Transcripción en vivo" aria-live="polite" onScroll={handleScroll}>
        {lines.length === 0 && !partialText ? (
          <p className="notia-meeting-empty-text notia-meeting-phone-live-empty">Las frases aparecen acá a medida que se reconocen.</p>
        ) : null}
        <LiveLines lines={lines} answers={snapshot?.liveAnswers ? snapshot.answers : NO_ANSWERS} />
        {partialText ? (
          <div className="notia-meeting-live-line notia-meeting-live-line--partial">
            {/* The utterance being heard starts after the last confirmed one. */}
            <time>{formatClock(lines[lines.length - 1]?.endMs ?? 0)} · en vivo</time>
            <div><p>{partialText}<span className="notia-meeting-caret" aria-hidden="true" /></p></div>
          </div>
        ) : null}
      </section>

      <PhoneLiveAnswers
        snapshot={snapshot}
        onToggle={onToggleLiveAnswers}
        onRegenerate={onRegenerateAnswer}
        onPin={onPinAnswer}
      />

      <div className="notia-meeting-phone-controls">
        <button type="button" className="notia-meeting-phone-control" onClick={onMark} disabled={!canMark}>
          <span aria-hidden="true"><Flag size={17} /></span>Marcar
        </button>
        <button type="button" className="notia-meeting-phone-control notia-meeting-phone-control--main" onClick={onStop}>
          <span aria-hidden="true"><Square size={16} fill="currentColor" strokeWidth={0} /></span>Finalizar
        </button>
        {isPaused ? (
          <button type="button" className="notia-meeting-phone-control" onClick={onResume}>
            <span aria-hidden="true"><Play size={16} fill="currentColor" strokeWidth={0} /></span>Reanudar
          </button>
        ) : (
          <button type="button" className="notia-meeting-phone-control" onClick={onPause}>
            <span aria-hidden="true"><Pause size={16} fill="currentColor" strokeWidth={0} /></span>Pausar
          </button>
        )}
      </div>

      {sheet ? (
        <NotiaModalShell open onClose={onCloseSheet} size="md" panelClassName="notia-meeting-phone-sheet">
          <div className="notia-meeting-phone-sheet-top">
            <span className="notia-meeting-phone-handle" aria-hidden="true" />
            <button type="button" className="notia-meeting-icon-button" aria-label="Cerrar" onClick={onCloseSheet}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {sheet === 'notes' ? (
            <NotesCard
              key={snapshot?.id ?? 'no-meeting'}
              enabled={Boolean(snapshot)}
              initialNotes={snapshot?.notes ?? ''}
              onSave={onSaveNotes}
            />
          ) : (
            <MeetingMarks marks={snapshot?.marks ?? []} onShow={showMoment} onRemove={onRemoveMark} markButtonLabel="Marcar" />
          )}
        </NotiaModalShell>
      ) : null}
    </div>
  )
}

function PhoneWave({ source, levels }: { source: 'microphone' | 'system'; levels: number[] }) {
  return (
    <div className="notia-meeting-phone-wave" data-source={source}>
      <MeetingLevelBars levels={levels} count={WAVE_BARS} highlight={WAVE_HIGHLIGHT} maxHeight={WAVE_HEIGHT} />
    </div>
  )
}

interface PhoneLiveAnswersProps {
  snapshot: MeetingSnapshot | null
  onToggle: (enabled: boolean) => void
  onRegenerate: (answerId: string, shorter: boolean) => void
  onPin: (answerId: string, pinned: boolean) => void
}

function PhoneLiveAnswers({ snapshot, onToggle, onRegenerate, onPin }: PhoneLiveAnswersProps) {
  const enabled = snapshot?.liveAnswers ?? false
  const answers = snapshot?.answers ?? []
  const current = answers[answers.length - 1]
  const previous = answers.slice(0, -1).reverse()

  return (
    <section className="notia-meeting-phone-answers" data-enabled={enabled ? 'true' : 'false'} aria-labelledby="meeting-phone-answers-title">
      <span className="notia-meeting-phone-handle" aria-hidden="true" />
      <div className="notia-meeting-phone-answers-head">
        <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
        <h2 id="meeting-phone-answers-title">Respuestas en vivo</h2>
        <button
          type="button"
          role="switch"
          className="notia-meeting-phone-switch"
          aria-checked={enabled}
          aria-labelledby="meeting-phone-answers-title"
          disabled={!snapshot}
          onClick={() => onToggle(!enabled)}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div className="notia-meeting-phone-answers-box">
        {!enabled ? (
          <p className="notia-meeting-phone-answers-empty">Activalo y, cuando alguien haga una pregunta, la respuesta aparece acá.</p>
        ) : !current ? (
          <p className="notia-meeting-phone-answers-empty">Cuando alguien haga una pregunta, la respuesta sugerida aparece acá.</p>
        ) : (
          <>
            <div className="notia-meeting-phone-answer">
              <div className="notia-meeting-answer-label notia-meeting-answer-label--accent">
                Pregunta · <time>{formatClock(current.askedAtMs)}</time>
              </div>
              <p className="notia-meeting-answer-question">{current.question}</p>
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
