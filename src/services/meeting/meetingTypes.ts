/** Contracts of the Meeting commands. The backend owns the record. */

export type MeetingStatus = 'live' | 'processing' | 'completed'

export interface MeetingLine {
  id: string
  startMs: number
  endMs: number
  text: string
  question: boolean
}

export interface MeetingSpeaker {
  id: string
  name: string
  initials: string
  talkMs: number
  sharePercent: number
  colorIndex: number
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

export interface MeetingContextOptions {
  folders: MeetingContextFolder[]
  contexts: MeetingContextOption[]
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
  turns: MeetingTurn[]
  totalTurns: number
  notes: string
  marks: MeetingMark[]
  answers: MeetingAnswer[]
  liveAnswers: boolean
  aiNotes: MeetingAiNotes
  insights: MeetingInsights
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
