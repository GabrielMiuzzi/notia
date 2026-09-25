/**
 * Meeting whose transcript the side chat consults. The chat reads the text
 * from the backend when a question is sent, so the transcript does not travel
 * to the interface with every new line.
 */
export interface MeetingTranscriptContext {
  meetingId: string | null
  /** The meeting has lines, turns or notes to consult. */
  available: boolean
}

const EMPTY: MeetingTranscriptContext = { meetingId: null, available: false }
let current = EMPTY
const listeners = new Set<() => void>()

function emitChange(): void {
  listeners.forEach((listener) => listener())
}

export function getMeetingTranscriptContext(): MeetingTranscriptContext {
  return current
}

export function setMeetingTranscriptContext(meetingId: string | null, available: boolean): void {
  const next = meetingId ? { meetingId, available } : EMPTY
  if (current.meetingId === next.meetingId && current.available === next.available) return
  current = next
  emitChange()
}

export function clearMeetingTranscriptContext(): void {
  setMeetingTranscriptContext(null, false)
}

export function subscribeMeetingTranscriptContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
