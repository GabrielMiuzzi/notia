/* The composer's draft gains the dictated text on a new line. */

const joinDraft = (base: string, addition: string): string => {
  const normalizedAddition = addition.trim()
  if (!normalizedAddition) return base
  if (!base) return normalizedAddition
  return `${base}${/\s$/.test(base) ? '' : '\n'}${normalizedAddition}`
}

export function mergeVoiceTextIntoDraft(baseDraft: string, voiceText: string): string {
  return joinDraft(baseDraft, voiceText)
}
