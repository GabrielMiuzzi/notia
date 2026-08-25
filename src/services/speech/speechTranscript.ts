import type { DiarizedTranscript } from './speechTypes'

const joinDraft = (base: string, addition: string): string => {
  const normalizedAddition = addition.trim()
  if (!normalizedAddition) return base
  if (!base) return normalizedAddition
  return `${base}${/\s$/.test(base) ? '' : '\n'}${normalizedAddition}`
}

export function formatDiarizedTranscript(transcript: DiarizedTranscript): string {
  if (transcript.speakerCount <= 1) return transcript.text.trim()

  const speakerLabels = new Map<string, string>()
  const blocks: Array<{ speaker: string | null; text: string }> = []
  for (const segment of transcript.segments) {
    const text = segment.text.trim()
    if (!text) continue
    let speakerLabel: string | null = null
    if (segment.speakerId) {
      const existing = speakerLabels.get(segment.speakerId)
      speakerLabel = existing ?? `Hablante ${speakerLabels.size + 1}`
      speakerLabels.set(segment.speakerId, speakerLabel)
    }
    const previous = blocks.at(-1)
    if (previous && previous.speaker === speakerLabel) {
      previous.text = `${previous.text} ${text}`
    } else {
      blocks.push({ speaker: speakerLabel, text })
    }
  }

  return blocks
    .map(({ speaker, text }) => speaker ? `${speaker}: ${text}` : text)
    .join('\n\n')
    .trim() || transcript.text.trim()
}

export function mergeVoiceTextIntoDraft(baseDraft: string, voiceText: string): string {
  return joinDraft(baseDraft, voiceText)
}
