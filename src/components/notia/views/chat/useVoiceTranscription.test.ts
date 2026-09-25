import { describe, expect, it } from 'vitest'
import { hasNewRecognizedSpeech, stabilizePartialTranscript } from './useVoiceTranscription'

describe('hasNewRecognizedSpeech', () => {
  it('does not postpone silence detection for repeated partial events', () => {
    expect(hasNewRecognizedSpeech('hola mundo', 'hola mundo')).toBe(false)
    expect(hasNewRecognizedSpeech('hola', 'hola mundo')).toBe(true)
    expect(hasNewRecognizedSpeech('', '   ')).toBe(false)
  })
})

describe('stabilizePartialTranscript', () => {
  it('keeps visible text when an interim hypothesis regresses', () => {
    expect(stabilizePartialTranscript('hola mundo', 'hola')).toBe('hola mundo')
  })

  it('clears the preview when nothing is being spoken', () => {
    // A Meeting confirms its lines without changing `confirmedText`.
    expect(stabilizePartialTranscript('hola mundo', '')).toBe('')
    expect(stabilizePartialTranscript('hola mundo', '   ')).toBe('')
  })

  it('allows a partial hypothesis to grow without flickering backwards', () => {
    expect(stabilizePartialTranscript('hola', 'hola mundo')).toBe('hola mundo')
    expect(stabilizePartialTranscript('hola mundo', 'ola mundo nuevo')).toBe('ola mundo nuevo')
  })
})
