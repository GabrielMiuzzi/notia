import { useEffect, useRef, useState } from 'react'
import { runMeetingEphemeralChatReply } from '../../../../services/chat/meetingEphemeralChatRuntime'
import { describeAiFeedbackError } from '../../../../services/ai/aiFeedbackRuntime'
import type { StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../../types/notia'

export interface MeetingAskInput {
  /** Transcript with the minute of each turn, composed by the backend. */
  transcript: string
  aiPreferences: AiPreferences
  library: NotiaLibrary | null
}

/** A conversation about the finished meeting; it is not saved. */
export function useMeetingAsk({ transcript, aiPreferences, library }: MeetingAskInput) {
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const ask = async (question: string) => {
    const prompt = question.trim()
    if (!prompt || isAsking) return
    if (!library) {
      setError('Abrí una biblioteca para preguntarle a la reunión.')
      return
    }
    const previousMessages = messages
    const controller = new AbortController()
    controllerRef.current = controller
    setMessages((current) => [...current, { role: 'user', content: prompt }])
    setDraft('')
    setStreaming('')
    setError(null)
    setIsAsking(true)
    try {
      const answer = await runMeetingEphemeralChatReply({
        aiPreferences,
        library,
        transcript,
        prompt,
        previousMessages,
        signal: controller.signal,
        onMessageDelta: (delta) => setStreaming((current) => current + delta),
      })
      setMessages((current) => [...current, { role: 'assistant', content: answer }])
    } catch (askError) {
      setError(controller.signal.aborted
        ? 'Consulta cancelada.'
        : describeAiFeedbackError(askError, 'No se pudo consultar la reunión.'))
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setStreaming('')
      setIsAsking(false)
    }
  }

  const cancel = () => controllerRef.current?.abort()
  return { messages, draft, setDraft, streaming, isAsking, error, ask, cancel }
}

export type MeetingAsk = ReturnType<typeof useMeetingAsk>
