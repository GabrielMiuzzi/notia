let currentTranscript = ''
const listeners = new Set<() => void>()

function emitChange(): void {
  listeners.forEach((listener) => listener())
}

export function getMeetingTranscriptContext(): string {
  return currentTranscript
}

export function setMeetingTranscriptContext(transcript: string): void {
  if (currentTranscript === transcript) return
  currentTranscript = transcript
  emitChange()
}

export function clearMeetingTranscriptContext(): void {
  setMeetingTranscriptContext('')
}

export function subscribeMeetingTranscriptContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
