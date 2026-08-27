import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearMeetingTranscriptContext,
  getMeetingTranscriptContext,
  setMeetingTranscriptContext,
  subscribeMeetingTranscriptContext,
} from './meetingTranscriptContext'

describe('meetingTranscriptContext', () => {
  afterEach(clearMeetingTranscriptContext)

  it('publica la transcripcion solo en memoria y notifica sus cambios', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMeetingTranscriptContext(listener)

    setMeetingTranscriptContext('Hablante 1: Hola')

    expect(getMeetingTranscriptContext()).toBe('Hablante 1: Hola')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    clearMeetingTranscriptContext()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
