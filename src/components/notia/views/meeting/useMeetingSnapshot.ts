import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getMeetingSnapshot,
  listenMeetingAnswer,
  listenMeetingChanged,
} from '../../../../services/meeting/meetingService'
import type { MeetingFilter, MeetingSnapshot } from '../../../../services/meeting/meetingTypes'

/**
 * Snapshot of the current meeting, read again whenever the backend says it
 * changed or the filter changes. Live answers update their text in place
 * while they stream.
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
      setSnapshot(next)
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
