import { useEffect, useRef, useState } from 'react'
import { listMeetingHistory, openSavedMeeting } from '../../../../services/meeting/meetingService'
import type { MeetingHistoryItem } from '../../../../services/meeting/meetingTypes'

const SEARCH_DELAY_MS = 250

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * «Reuniones anteriores» of the library: the list the backend reads, again
 * a moment after the search changes, and opening one of them.
 */
export function useMeetingHistory(libraryId: string | null, enabled: boolean) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<MeetingHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!libraryId || !enabled) {
      setItems(null)
      return
    }
    const request = ++requestRef.current
    const timer = window.setTimeout(() => {
      void listMeetingHistory(libraryId, query).then((next) => {
        if (request !== requestRef.current) return
        setItems(next)
        setError(null)
      }).catch((listError) => {
        if (request !== requestRef.current) return
        setError(errorText(listError, 'No se pudieron leer las reuniones anteriores.'))
      })
    }, query ? SEARCH_DELAY_MS : 0)
    return () => window.clearTimeout(timer)
  }, [enabled, libraryId, query])

  const open = async (meetingId: string) => {
    if (!libraryId || openingId) return false
    setOpeningId(meetingId)
    setError(null)
    try {
      await openSavedMeeting(libraryId, meetingId)
      return true
    } catch (openError) {
      setError(errorText(openError, 'No se pudo abrir la reunión.'))
      return false
    } finally {
      setOpeningId(null)
    }
  }

  return { query, setQuery, items, error, openingId, open }
}

export type MeetingHistory = ReturnType<typeof useMeetingHistory>
