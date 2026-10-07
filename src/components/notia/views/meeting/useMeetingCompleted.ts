import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  callMeetingNotesAgent,
  generateMeetingInsights,
  getMeetingNotesText,
  mergeMeetingSpeakers,
  removeMeetingMark,
  renameMeetingSpeaker,
} from '../../../../services/meeting/meetingService'
import type { MeetingFilter, MeetingInsightsRequest, MeetingSpeaker, MeetingTurn } from '../../../../services/meeting/meetingTypes'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'

/* State of the finished meeting's tools, the same for both layouts. */

const SEARCH_DELAY_MS = 250

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Renaming a speaker and joining two. */
export function useMeetingSpeakerEdit(meetingId: string) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const startEditing = (speaker: MeetingSpeaker) => {
    setEditingId(speaker.id)
    setDraft(speaker.name)
    setError(null)
  }
  const stopEditing = () => setEditingId(null)

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingId) return
    try {
      await renameMeetingSpeaker(meetingId, editingId, draft)
      setEditingId(null)
    } catch (renameError) {
      setError(errorText(renameError, 'No se pudo renombrar al hablante.'))
    }
  }

  /** Resolves whether the speakers were joined. */
  const merge = async (sourceId: string, targetId: string) => {
    try {
      await mergeMeetingSpeakers(meetingId, sourceId, targetId)
      return true
    } catch (mergeError) {
      setError(errorText(mergeError, 'No se pudieron unir los hablantes.'))
      return false
    }
  }

  return { editingId, draft, setDraft, error, setError, startEditing, stopEditing, saveName, merge }
}

/** The search text, sent to the filter a moment after the person stops typing. */
export function useMeetingSearch(filter: MeetingFilter, onFilterChange: (filter: MeetingFilter) => void) {
  const [query, setQuery] = useState(filter.query)
  const appliedRef = useRef(filter.query)

  // A jump to a moment clears the search from outside: the box follows it.
  useEffect(() => {
    if (appliedRef.current && !filter.query) setQuery('')
    appliedRef.current = filter.query
  }, [filter.query])

  useEffect(() => {
    if (query === filter.query) return
    const timer = window.setTimeout(() => onFilterChange({ ...filter, query }), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [filter, onFilterChange, query])

  return [query, setQuery] as const
}

const COPIED_MS = 2_000
const HIGHLIGHT_MS = 2_000

/** «Notas de la reunión» of a finished meeting: regenerate, copy and remove a mark. */
export function useMeetingFinishedNotes(meetingId: string, aiPreferences: AiPreferences) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const regenerate = async () => {
    setError(null)
    try {
      await callMeetingNotesAgent(meetingId, aiPreferences)
    } catch (regenerateError) {
      setError(errorText(regenerateError, 'No se pudieron regenerar las notas.'))
    }
  }

  const copy = async () => {
    setError(null)
    try {
      await navigator.clipboard.writeText(await getMeetingNotesText(meetingId))
      setCopied(true)
    } catch (copyError) {
      setError(errorText(copyError, 'No se pudieron copiar las notas.'))
    }
  }

  const removeMark = (markId: string) => {
    void removeMeetingMark(meetingId, markId).catch((removeError) => setError(errorText(removeError, 'No se pudo quitar el momento.')))
  }

  return { error, setError, copied, regenerate, copy, removeMark }
}

export type MeetingFinishedNotes = ReturnType<typeof useMeetingFinishedNotes>

/**
 * Shows the turn said at a minute of the transcript, clearing the search
 * first when it hides it; the turn stays highlighted a moment.
 */
export function useTranscriptJump(turns: MeetingTurn[], filter: MeetingFilter, onFilterChange: (filter: MeetingFilter) => void) {
  const [pendingMs, setPendingMs] = useState<number | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const filtered = Boolean(filter.query || filter.speakerId)

  useEffect(() => {
    if (pendingMs === null || filtered) return
    setPendingMs(null)
    const turn = [...turns].reverse().find((candidate) => candidate.startMs <= pendingMs) ?? turns[0]
    if (!turn) return
    document.getElementById(`meeting-turn-${turn.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightId(turn.id)
  }, [filtered, pendingMs, turns])

  useEffect(() => {
    if (!highlightId) return
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => window.clearTimeout(timer)
  }, [highlightId])

  const showMoment = (atMs: number) => {
    if (filtered) onFilterChange({ query: '', speakerId: null })
    setPendingMs(atMs)
  }

  return { showMoment, highlightId }
}

/** What to ask the AI about the meeting, and the request itself. */
export function useMeetingInsights(meetingId: string, aiPreferences: AiPreferences) {
  const [request, setRequest] = useState<MeetingInsightsRequest>({ summary: true, keyPoints: true, tasks: false, correct: false })
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nothingChosen = !Object.values(request).some(Boolean)

  const choose = (key: keyof MeetingInsightsRequest, chosen: boolean) => setRequest((current) => ({ ...current, [key]: chosen }))

  const generate = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      await generateMeetingInsights(meetingId, request, aiPreferences)
    } catch (generateError) {
      setError(errorText(generateError, 'No se pudo pasar la reunión por IA.'))
    } finally {
      setIsGenerating(false)
    }
  }

  return { request, choose, isGenerating, error, nothingChosen, generate }
}
