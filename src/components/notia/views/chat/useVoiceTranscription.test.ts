import { describe, expect, it } from 'vitest'
import { hasNewRecognizedSpeech } from './useVoiceTranscription'

describe('hasNewRecognizedSpeech', () => {
  it('does not postpone silence detection for repeated partial events', () => {
    expect(hasNewRecognizedSpeech('hola mundo', 'hola mundo')).toBe(false)
    expect(hasNewRecognizedSpeech('hola', 'hola mundo')).toBe(true)
    expect(hasNewRecognizedSpeech('', '   ')).toBe(false)
  })
})
