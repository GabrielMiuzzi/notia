import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearMeetingTranscriptContext,
  getMeetingTranscriptContext,
  setMeetingTranscriptContext,
  subscribeMeetingTranscriptContext,
} from './meetingTranscriptContext'

describe('meetingTranscriptContext', () => {
  afterEach(clearMeetingTranscriptContext)

  it('publica la reunion consultable solo en memoria y notifica sus cambios', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeMeetingTranscriptContext(listener)

    setMeetingTranscriptContext('meeting-1', true)
    const context = getMeetingTranscriptContext()
    expect(context).toEqual({ meetingId: 'meeting-1', available: true })
    // Same values: the same object and no notification.
    setMeetingTranscriptContext('meeting-1', true)
    expect(getMeetingTranscriptContext()).toBe(context)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    clearMeetingTranscriptContext()
    expect(getMeetingTranscriptContext()).toEqual({ meetingId: null, available: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
