import { useEffect, useState, type FormEvent } from 'react'
import {
  generateMeetingInsights,
  mergeMeetingSpeakers,
  renameMeetingSpeaker,
} from '../../../../services/meeting/meetingService'
import type { MeetingFilter, MeetingInsightsRequest, MeetingSpeaker } from '../../../../services/meeting/meetingTypes'
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

  useEffect(() => {
    if (query === filter.query) return
    const timer = window.setTimeout(() => onFilterChange({ ...filter, query }), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [filter, onFilterChange, query])

  return [query, setQuery] as const
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
