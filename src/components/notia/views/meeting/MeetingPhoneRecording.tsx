import { useEffect, useRef, useState } from 'react'
import { Flag, Pause, Play, Square, X } from 'lucide-react'
import { NotiaModalShell } from '../../NotiaModalShell'
import { MeetingLevelBars } from './MeetingLevelBars'
import { MeetingAiNotesSheet, MeetingPhoneAiNotes, type MeetingAiNotesActions } from './MeetingAiNotesPanel'
import {
  FOLLOW_THRESHOLD_PX,
  LiveLines,
  MeetingAnswerActions,
  MeetingAssistantTabs,
  MeetingMarks,
  MeetingPreviousAnswers,
  NotesCard,
  type MeetingAssistantTab,
} from './MeetingRecordingPanel'
import { formatClock, lineAtMoment } from './meetingDisplay'
import type { SpeechLevelHistory } from './useSpeechLevels'
import type { MeetingAnswer, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

/*
 * Recording stage of Meeting in the space of a phone (canvas «Notia ·
 * Meeting», boards M2 «Grabando» and Mobile · Grabando): the levels, the
 * transcript following the newest line, the live assistant (Notas IA and
 * the live answers) and the controls at the bottom. Lines may arrive late
 * and in bursts (Android has no live preview), so the transcript only
 * follows them while the person is at its end.
 */

const WAVE_BARS = 70
const WAVE_HIGHLIGHT = 11
const WAVE_HEIGHT = 24
const NO_ANSWERS: MeetingAnswer[] = []

/** What the ⋮ menu of the recording opens. */
export type MeetingPhoneSheet = 'notes' | 'marks' | 'ai-notes'

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
  notesActions: MeetingAiNotesActions
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
  notesActions,
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

      <PhoneAssistant
        snapshot={snapshot}
        onToggleLiveAnswers={onToggleLiveAnswers}
        onRegenerate={onRegenerateAnswer}
        onPin={onPinAnswer}
        notesActions={notesActions}
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

      {sheet === 'ai-notes' && snapshot ? (
        <MeetingAiNotesSheet
          snapshot={snapshot}
          actions={notesActions}
          canAddNote={canMark || isPaused}
          onShowMoment={showMoment}
          onClose={onCloseSheet}
        />
      ) : sheet === 'notes' || sheet === 'marks' ? (
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

interface PhoneAssistantProps {
  snapshot: MeetingSnapshot | null
  onToggleLiveAnswers: (enabled: boolean) => void
  onRegenerate: (answerId: string, shorter: boolean) => void
  onPin: (answerId: string, pinned: boolean) => void
  notesActions: MeetingAiNotesActions
}

/** «Asistente en vivo»: Notas IA or the live answers, with the switch of the tab shown. */
function PhoneAssistant({ snapshot, onToggleLiveAnswers, onRegenerate, onPin, notesActions }: PhoneAssistantProps) {
  const [tab, setTab] = useState<MeetingAssistantTab>('notes')
  const enabled = tab === 'notes' ? snapshot?.aiNotes.enabled ?? false : snapshot?.liveAnswers ?? false
  const toggle = () => (tab === 'notes' ? notesActions.onToggleAiNotes(!enabled) : onToggleLiveAnswers(!enabled))

  return (
    <section className="notia-meeting-phone-answers" data-enabled={enabled ? 'true' : 'false'} aria-label="Asistente en vivo">
      <span className="notia-meeting-phone-handle" aria-hidden="true" />
      <div className="notia-meeting-phone-answers-head">
        <MeetingAssistantTabs snapshot={snapshot} selected={tab} onSelect={setTab} phone />
        <button
          type="button"
          role="switch"
          className="notia-meeting-phone-switch"
          aria-checked={enabled}
          aria-label={tab === 'notes' ? 'Notas IA' : 'Respuestas en vivo'}
          disabled={!snapshot}
          onClick={toggle}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div
        className="notia-meeting-phone-answers-box"
        role="tabpanel"
        id={`meeting-assistant-panel-${tab}`}
        aria-labelledby={`meeting-assistant-tab-${tab}`}
      >
        {tab === 'notes' ? (
          snapshot ? <MeetingPhoneAiNotes snapshot={snapshot} onCallAgent={notesActions.onCallNotesAgent} /> : null
        ) : (
          <PhoneLiveAnswers snapshot={snapshot} onRegenerate={onRegenerate} onPin={onPin} />
        )}
      </div>
    </section>
  )
}

interface PhoneLiveAnswersProps {
  snapshot: MeetingSnapshot | null
  onRegenerate: (answerId: string, shorter: boolean) => void
  onPin: (answerId: string, pinned: boolean) => void
}

function PhoneLiveAnswers({ snapshot, onRegenerate, onPin }: PhoneLiveAnswersProps) {
  const enabled = snapshot?.liveAnswers ?? false
  const answers = snapshot?.answers ?? []
  const current = answers[answers.length - 1]
  const previous = answers.slice(0, -1).reverse()

  if (!enabled) {
    return <p className="notia-meeting-phone-answers-empty">Activalo y, cuando alguien haga una pregunta, la respuesta aparece acá.</p>
  }
  if (!current) {
    return <p className="notia-meeting-phone-answers-empty">Cuando alguien haga una pregunta, la respuesta sugerida aparece acá.</p>
  }
  return (
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
  )
}
