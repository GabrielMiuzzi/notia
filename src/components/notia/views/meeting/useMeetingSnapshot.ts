import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getMeetingSnapshot,
  listenMeetingAnswer,
  listenMeetingChanged,
  listenMeetingLine,
} from '../../../../services/meeting/meetingService'
import type { MeetingFilter, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

/**
 * A snapshot read while lines kept arriving may miss the newest ones; the
 * lines are only ever appended, so those already shown stay after it.
 */
export function keepNewerLines(current: MeetingSnapshot | null, next: MeetingSnapshot | null): MeetingSnapshot | null {
  if (!current || !next || current.id !== next.id) return next
  const known = new Set(next.lines.map((line) => line.id))
  const newer = current.lines.filter((line) => !known.has(line.id))
  return newer.length > 0 ? { ...next, lines: [...next.lines, ...newer] } : next
}

/**
 * Snapshot of the current meeting, read again whenever the backend says it
 * changed or the filter changes. Each new line arrives alone and is appended,
 * so a long meeting is not read again line after line. Live answers update
 * their text in place while they stream.
 */
export function useMeetingSnapshot(filter: MeetingFilter) {
  const [snapshot, setSnapshot] = useState<MeetingSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const filterRef = useRef(filter)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    const request = ++requestRef.current
    try {
      const next = await getMeetingSnapshot(filterRef.current)
      if (request !== requestRef.current) return
      setSnapshot((current) => keepNewerLines(current, next))
      setError(null)
    } catch (refreshError) {
      if (request !== requestRef.current) return
      setError(refreshError instanceof Error ? refreshError.message : 'No se pudo leer la reunión.')
    }
  }, [])

  useEffect(() => {
    filterRef.current = filter
    void refresh()
  }, [filter, refresh])

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    void Promise.all([
      listenMeetingChanged(() => { void refresh() }),
      listenMeetingLine(({ meetingId, line, durationMs }) => {
        setSnapshot((current) => current && current.id === meetingId && !current.lines.some((known) => known.id === line.id)
          ? { ...current, lines: [...current.lines, line], durationMs }
          : current)
      }),
      listenMeetingAnswer(({ meetingId, answerId, text }) => {
        setSnapshot((current) => current && current.id === meetingId
          ? {
            ...current,
            answers: current.answers.map((answer) => answer.id === answerId ? { ...answer, text } : answer),
          }
          : current)
      }),
    ]).then((listeners) => {
      if (disposed) listeners.forEach((unlisten) => unlisten())
      else unlisteners.push(...listeners)
    }).catch(() => {
      if (!disposed) setError('No se pudieron escuchar los cambios de la reunión.')
    })
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [refresh])

  return { snapshot, error, refresh }
}
