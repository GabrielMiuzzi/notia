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

export interface MeetingSnapshot {
  id: string
  status: MeetingStatus
  title: string
  dateLabel: string
  durationMs: number
  sources: { microphone: boolean; system: boolean }
  lines: MeetingLine[]
  speakers: MeetingSpeaker[]
  turns: MeetingTurn[]
  totalTurns: number
  notes: string
  marks: MeetingMark[]
  answers: MeetingAnswer[]
  liveAnswers: boolean
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
