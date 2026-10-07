/** Contracts of the Meeting commands. The backend owns the record. */

export type MeetingStatus = 'live' | 'processing' | 'completed'

export interface MeetingLine {
  id: string
  startMs: number
  endMs: number
  text: string
  question: boolean
  /** Who the call (Teams, through the NotIA extension) says was speaking. */
  speaker?: string
}

export interface MeetingSpeaker {
  id: string
  name: string
  initials: string
  talkMs: number
  sharePercent: number
  colorIndex: number
  turnCount: number
  longestTurnMs: number
  averageTurnMs: number
}

/** A turn of a known speaker on the «Tiempo de habla» timeline. */
export interface MeetingTalkSpan {
  speakerId: string
  startMs: number
  endMs: number
}

export interface MeetingTurn {
  id: string
  speakerId?: string
  startMs: number
  endMs: number
  text: string
}

export interface MeetingMark {
  id: string
  atMs: number
  label: string
}

export type MeetingAnswerStatus = 'generating' | 'ready' | 'failed'

export interface MeetingAnswer {
  id: string
  question: string
  askedAtMs: number
  text: string
  status: MeetingAnswerStatus
  error?: string
  pinned: boolean
}

export interface MeetingTask {
  id: string
  title: string
  detail: string
  sent: boolean
}

export interface MeetingInsights {
  summary?: string
  keyPoints: string[]
  tasks: MeetingTask[]
  corrected: boolean
}

/** A meeting saved as a note, as «Reuniones anteriores» lists it. */
export interface MeetingHistoryItem {
  id: string
  title: string
  /** `HOY`, `AYER`, `ESTA SEMANA` or the month, on the first meeting of each group. */
  group?: string
  /** `10:15` today and yesterday, `Lun` this week, else `28 sep`. */
  timeLabel: string
  durationMs: number
  speakerCount: number
  pendingTasks: number
  /** The folder or the context its AI consulted. */
  context?: { label: string; color?: string }
}

/** The AI review that runs on its own once the speakers are separated. */
export interface MeetingReview {
  /** The step running now: cleaning up the transcript, then naming the speakers. */
  stage?: 'cleanup' | 'names'
  cleaned: boolean
  /** Speakers the review named from the conversation. */
  named: number
  error?: string
}

/** Question asked in the meeting and the minute it was asked. */
export interface MeetingQuestion {
  question: string
  atMs: number
}

export type MeetingFileKind = 'audio' | 'video'

/** The audio or video file a meeting was transcribed from. */
export interface MeetingSourceFile {
  name: string
  kind: MeetingFileKind
}

/** A file uploaded and read by the backend, ready to transcribe. */
export interface MeetingMediaFile extends MeetingSourceFile {
  mediaId: string
  byteLength: number
  durationMs: number
  /** Waveform heights between 0 and 1. */
  peaks: number[]
}

/** A topic of the Notas IA, the newest first. */
export interface MeetingNoteTopic {
  title: string
  atMs: number
  items: string[]
  /** Being discussed now (the last one, while recording). */
  current: boolean
}

export interface MeetingNoteTask {
  id: string
  text: string
  owner: string
  /** `H1` for «Hablante 1»; empty without an owner. */
  ownerInitials: string
  due: string
  sent: boolean
}

/** The notes the agent rewrites while the meeting goes on. */
export interface MeetingAiNotes {
  enabled: boolean
  running: boolean
  error?: string
  /** When the next automatic pass runs (ms since the epoch), while recording. */
  nextPassAt?: number
  objective: string
  decisions: string[]
  openQuestions: string[]
  topics: MeetingNoteTopic[]
  tasks: MeetingNoteTask[]
}

/** The part of the library the meeting's AI consults. */
export interface MeetingAiContext {
  libraryId: string
  /** A folder, subfolders included; the whole library when `null`. */
  folder: string | null
  /** With the whole library, the allowed contexts (`sin-contexto` for the notes without one). */
  contexts: string[] | null
}

export interface MeetingContextFolder {
  path: string
  noteCount: number
}

export interface MeetingContextOption {
  tag: string
  label: string
  color?: string
  /** Sensitive: off until the person turns it on. */
  locked: boolean
  selectedByDefault: boolean
}

/** What the person chose in «Contexto para la IA», saved by the backend for the library. */
export interface MeetingContextChoice {
  wholeLibrary: boolean
  /** The folder used without the whole library; `null` is «Ninguna». */
  folder: string | null
  /** The contexts allowed with the whole library. */
  contexts: string[]
}

export interface MeetingContextOptions {
  folders: MeetingContextFolder[]
  contexts: MeetingContextOption[]
  /** The saved choice, against the library as it is now, or the default. */
  choice: MeetingContextChoice
}

export interface MeetingSnapshot {
  id: string
  status: MeetingStatus
  title: string
  dateLabel: string
  durationMs: number
  sources: { microphone: boolean; system: boolean }
  /** Present when the meeting was transcribed from a file. */
  sourceFile?: MeetingSourceFile
  lines: MeetingLine[]
  speakers: MeetingSpeaker[]
  /** Who spoke when over the whole meeting; the filter does not apply. */
  talkTimeline: MeetingTalkSpan[]
  turns: MeetingTurn[]
  totalTurns: number
  notes: string
  marks: MeetingMark[]
  answers: MeetingAnswer[]
  liveAnswers: boolean
  aiNotes: MeetingAiNotes
  insights: MeetingInsights
  review: MeetingReview
  savedNotePath?: string
  suggestedQuestions: MeetingQuestion[]
  contextText: string
}

export interface MeetingFilter {
  query: string
  speakerId: string | null
}

export interface MeetingInsightsRequest {
  summary: boolean
  keyPoints: boolean
  tasks: boolean
  correct: boolean
}

export type MeetingExportFormat = 'pdf' | 'docx'
