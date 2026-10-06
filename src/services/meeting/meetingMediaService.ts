import { callBackend } from '../transport'
import type { MeetingMediaFile } from './meetingTypes'

/**
 * Client of the Meeting file commands. A picked or dropped file has no path
 * in the WebView, so it goes to the backend in ordered chunks; the backend
 * keeps the copy, reads its audio, decides whether it can be transcribed
 * and transcribes it in a speech session.
 */

/** Bytes per chunk before Base64. */
const CHUNK_BYTES = 4 * 1024 * 1024

/** What the file picker offers; the backend checks the format again. */
export const MEETING_MEDIA_ACCEPT = '.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.mp4,.mov,.m4v,.mkv,.webm,audio/*,video/*'

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

async function call<T>(command: string, payload: Record<string, unknown>, fallback: string): Promise<T> {
  try {
    return await callBackend<T>(command, { payload })
  } catch (error) {
    throw new Error(errorMessage(error, fallback))
  }
}

function readChunkAsBase64(chunk: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(chunk)
  })
}

export interface MeetingMediaUploadOptions {
  signal?: AbortSignal
  /** Share of the file sent, from 0 to 1. */
  onProgress?: (fraction: number) => void
  /** The whole file arrived and the backend is reading its audio. */
  onReading?: () => void
}

const abortError = () => new DOMException('Se canceló la carga del archivo.', 'AbortError')

/** Sends `file` to the backend and returns it once its audio was read. */
export async function uploadMeetingMedia(file: File, options: MeetingMediaUploadOptions = {}): Promise<MeetingMediaFile> {
  const { signal, onProgress, onReading } = options
  const { mediaId } = await call<{ mediaId: string }>(
    'meeting_media_begin',
    { name: file.name, byteLength: file.size },
    'No se pudo empezar a cargar el archivo.',
  )
  try {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      if (signal?.aborted) throw abortError()
      const data = await readChunkAsBase64(file.slice(offset, offset + CHUNK_BYTES))
      await call('meeting_media_chunk', { mediaId, offset, data }, 'No se pudo cargar el archivo.')
      onProgress?.(Math.min(1, (offset + CHUNK_BYTES) / file.size))
    }
    if (signal?.aborted) throw abortError()
    onReading?.()
    return await call<MeetingMediaFile>('meeting_media_finish', { mediaId }, 'No se pudo leer el archivo.')
  } catch (error) {
    void discardMeetingMedia(mediaId).catch(() => undefined)
    throw error
  }
}

/** Drops an uploaded file that will not be transcribed. */
export function discardMeetingMedia(mediaId: string): Promise<void> {
  return call('meeting_media_discard', { mediaId }, 'No se pudo quitar el archivo.')
}

export interface StartMeetingFileInput {
  mediaId: string
  language: string
  expectedSpeakers: number | null
  /** The AI that reviews the transcript once it is finished; `null` without one. */
  settings: unknown
}

/** Transcribes an uploaded file as a meeting; returns its session id, which is also the meeting's. */
export async function startMeetingFileSession(input: StartMeetingFileInput): Promise<string> {
  const { sessionId } = await call<{ sessionId: string }>(
    'meeting_start_file_session',
    {
      mediaId: input.mediaId,
      language: input.language,
      diarizationEnabled: true,
      expectedSpeakers: input.expectedSpeakers,
      settings: input.settings,
    },
    'No se pudo empezar a transcribir el archivo.',
  )
  return sessionId
}
