import { callBackend, subscribeBackend, type Unsubscribe } from '../transport'
import { resolveAiPreferencesForTransport, type AiPreferences } from '../preferences/aiSettingsStorage'
import type {
  MeetingExportFormat,
  MeetingFilter,
  MeetingInsightsRequest,
  MeetingLine,
  MeetingMark,
  MeetingSnapshot,
} from './meetingTypes'

/**
 * Client of the Meeting commands. The backend keeps the recording, derives
 * turns, speakers, the note and the AI prompts; this module only sends what
 * the person did and reads the snapshot back.
 */

const CHANGED_EVENT = 'meeting://changed'
const ANSWER_EVENT = 'meeting://answer'
const LINE_EVENT = 'meeting://line'

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

/** Provider preferences with the session credential, as the backend needs them. */
export const meetingAiSettings = (preferences: AiPreferences) => resolveAiPreferencesForTransport(preferences)

/** The current meeting with its turns filtered, or `null` without one. */
export function getMeetingSnapshot(filter: MeetingFilter): Promise<MeetingSnapshot | null> {
  return call<MeetingSnapshot | null>('meeting_snapshot', {
    filter: { query: filter.query, speakerId: filter.speakerId },
  }, 'No se pudo leer la reunión.')
}

/** The transcript and notes as the chat reads them, built by the backend when asked. */
export const getMeetingContext = (meetingId: string) =>
  call<string>('meeting_context', { meetingId }, 'No se pudo leer la transcripción de la reunión.')

export const discardMeeting = (meetingId: string) =>
  call<void>('meeting_discard', { meetingId }, 'No se pudo empezar una nueva grabación.')

export const addMeetingMark = (meetingId: string) =>
  call<MeetingMark>('meeting_add_mark', { meetingId }, 'No se pudo marcar el momento.')

export const removeMeetingMark = (meetingId: string, markId: string) =>
  call<void>('meeting_remove_mark', { meetingId, markId }, 'No se pudo quitar el momento.')

export const setMeetingNotes = (meetingId: string, notes: string) =>
  call<void>('meeting_set_notes', { meetingId, notes }, 'No se pudieron guardar las notas.')

export const setMeetingLiveAnswers = (meetingId: string, enabled: boolean, preferences: AiPreferences) =>
  call<void>('meeting_set_live_answers', {
    meetingId,
    enabled,
    settings: meetingAiSettings(preferences),
  }, 'No se pudieron cambiar las respuestas en vivo.')

export const regenerateMeetingAnswer = (meetingId: string, answerId: string, shorter: boolean, preferences: AiPreferences) =>
  call<void>('meeting_regenerate_answer', {
    meetingId,
    answerId,
    shorter,
    settings: meetingAiSettings(preferences),
  }, 'No se pudo generar la respuesta.')

export const pinMeetingAnswer = (meetingId: string, answerId: string, pinned: boolean) =>
  call<void>('meeting_pin_answer', { meetingId, answerId, pinned }, 'No se pudo fijar la respuesta.')

export const renameMeetingSpeaker = (meetingId: string, speakerId: string, name: string) =>
  call<void>('meeting_rename_speaker', { meetingId, speakerId, name }, 'No se pudo renombrar al hablante.')

export const mergeMeetingSpeakers = (meetingId: string, sourceId: string, targetId: string) =>
  call<void>('meeting_merge_speakers', { meetingId, sourceId, targetId }, 'No se pudieron unir los hablantes.')

export const generateMeetingInsights = (meetingId: string, request: MeetingInsightsRequest, preferences: AiPreferences) =>
  call<void>('meeting_generate_insights', {
    meetingId,
    request,
    settings: meetingAiSettings(preferences),
  }, 'No se pudo pasar la reunión por IA.')

export const saveMeetingNote = (meetingId: string, libraryId: string, folder: string) =>
  call<{ path: string }>('meeting_save_note', { meetingId, libraryId, folder }, 'No se pudo guardar la nota.')

export const exportMeeting = (meetingId: string, libraryId: string, folder: string, format: MeetingExportFormat) =>
  call<{ path: string; notePath: string }>('meeting_export', { meetingId, libraryId, folder, format }, 'No se pudo exportar la reunión.')

export const listMeetingTaskBoards = (libraryId: string) =>
  call<string[]>('meeting_task_boards', { libraryId }, 'No se pudieron leer los tableros.')

export const sendMeetingTasks = (meetingId: string, libraryId: string, board: string, taskIds: string[]) =>
  call<{ created: number }>('meeting_send_tasks', { meetingId, libraryId, board, taskIds }, 'No se pudieron crear las tareas.')

/** Something of the meeting changed; read the snapshot again. */
export const listenMeetingChanged = (callback: (meetingId: string) => void): Promise<Unsubscribe> =>
  subscribeBackend<{ meetingId?: unknown }>(CHANGED_EVENT, (payload) => {
    if (typeof payload?.meetingId === 'string') callback(payload.meetingId)
  })

function readMeetingLine(value: unknown): MeetingLine | null {
  if (!value || typeof value !== 'object') return null
  const line = value as Record<string, unknown>
  return typeof line.id === 'string'
    && typeof line.startMs === 'number'
    && typeof line.endMs === 'number'
    && typeof line.text === 'string'
    && typeof line.question === 'boolean'
    ? { id: line.id, startMs: line.startMs, endMs: line.endMs, text: line.text, question: line.question }
    : null
}

/** A line the recording just confirmed; the rest of the meeting did not change. */
export const listenMeetingLine = (
  callback: (event: { meetingId: string; line: MeetingLine; durationMs: number }) => void,
): Promise<Unsubscribe> =>
  subscribeBackend<{ meetingId?: unknown; line?: unknown; durationMs?: unknown }>(LINE_EVENT, (payload) => {
    const line = readMeetingLine(payload?.line)
    if (line && typeof payload?.meetingId === 'string' && typeof payload.durationMs === 'number') {
      callback({ meetingId: payload.meetingId, line, durationMs: payload.durationMs })
    }
  })

/** Text of a live answer while it is being generated. */
export const listenMeetingAnswer = (
  callback: (event: { meetingId: string; answerId: string; text: string }) => void,
): Promise<Unsubscribe> =>
  subscribeBackend<{ meetingId?: unknown; answerId?: unknown; text?: unknown }>(ANSWER_EVENT, (payload) => {
    if (typeof payload?.meetingId === 'string' && typeof payload.answerId === 'string' && typeof payload.text === 'string') {
      callback({ meetingId: payload.meetingId, answerId: payload.answerId, text: payload.text })
    }
  })
