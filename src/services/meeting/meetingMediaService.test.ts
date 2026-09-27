// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callBackend = vi.hoisted(() => vi.fn())
vi.mock('../transport', () => ({ callBackend }))

const { startMeetingFileSession, uploadMeetingMedia } = await import('./meetingMediaService')

const media = { mediaId: 'm1', name: 'reunion.mp3', kind: 'audio', byteLength: 5, durationMs: 1_000, peaks: [] }

describe('uploadMeetingMedia', () => {
  beforeEach(() => {
    callBackend.mockReset()
    callBackend.mockImplementation(async (command: string) => {
      if (command === 'meeting_media_begin') return { mediaId: 'm1' }
      if (command === 'meeting_media_finish') return media
      return {}
    })
  })

  it('sends the file in order and returns it once its audio was read', async () => {
    const progress: number[] = []
    const onReading = vi.fn()
    const result = await uploadMeetingMedia(new File(['hola!'], 'reunion.mp3', { type: 'audio/mpeg' }), {
      onProgress: (fraction) => progress.push(fraction),
      onReading,
    })
    expect(result).toEqual(media)
    expect(callBackend.mock.calls.map(([command]) => command)).toEqual(['meeting_media_begin', 'meeting_media_chunk', 'meeting_media_finish'])
    expect(callBackend.mock.calls[0][1]).toEqual({ payload: { name: 'reunion.mp3', byteLength: 5 } })
    expect(callBackend.mock.calls[1][1]).toEqual({ payload: { mediaId: 'm1', offset: 0, data: btoa('hola!') } })
    expect(progress).toEqual([1])
    expect(onReading).toHaveBeenCalledOnce()
  })

  it('drops the upload when it is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(uploadMeetingMedia(new File(['x'], 'reunion.mp3'), { signal: controller.signal })).rejects.toThrow()
    expect(callBackend.mock.calls.map(([command]) => command)).toEqual(['meeting_media_begin', 'meeting_media_discard'])
  })

  it('starts the transcription with speaker separation', async () => {
    callBackend.mockResolvedValueOnce({ sessionId: 's1' })
    await expect(startMeetingFileSession({ mediaId: 'm1', language: 'es', expectedSpeakers: 3 })).resolves.toBe('s1')
    expect(callBackend).toHaveBeenCalledWith('meeting_start_file_session', {
      payload: { mediaId: 'm1', language: 'es', diarizationEnabled: true, expectedSpeakers: 3 },
    })
  })
})
