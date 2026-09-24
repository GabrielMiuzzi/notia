import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { ChatMarkdownMessage } from '../chat/ChatMarkdownMessage'
import { formatClock } from './meetingDisplay'
import { runMeetingEphemeralChatReply } from '../../../../services/chat/meetingEphemeralChatRuntime'
import { describeAiFeedbackError } from '../../../../services/ai/aiFeedbackRuntime'
import type { StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'
import type { MeetingQuestion } from '../../../../services/meeting/meetingTypes'
import type { NotiaLibrary } from '../../../../types/notia'

interface MeetingAskPanelProps {
  /** Transcript with the minute of each turn, composed by the backend. */
  transcript: string
  /** Questions asked in the meeting, with their minute. */
  suggestions: MeetingQuestion[]
  aiPreferences: AiPreferences
  library: NotiaLibrary | null
}

/** Questions about the finished meeting; the conversation is not saved. */
export function MeetingAskPanel({ transcript, suggestions, aiPreferences, library }: MeetingAskPanelProps) {
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])
  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [messages, streaming])

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void ask(draft)
  }

  return (
    <section className="notia-meeting-card notia-meeting-ask" aria-labelledby="meeting-ask-title">
      <h2 id="meeting-ask-title">Preguntale a la reunión</h2>
      <p>Respuestas con el minuto exacto donde se dijo.</p>
      {suggestions.length > 0 && messages.length === 0 ? (
        <ul className="notia-meeting-suggestions" aria-label="Preguntas de la reunión">
          {suggestions.map((suggestion) => (
            <li key={suggestion.question}>
              <button
                type="button"
                className="notia-meeting-suggestion"
                disabled={isAsking}
                onClick={() => void ask(suggestion.question)}
              >
                <time>{formatClock(suggestion.atMs)}</time>
                <span>{suggestion.question}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {messages.length > 0 || isAsking ? (
        <div ref={threadRef} className="notia-meeting-ask-thread" aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={`notia-meeting-ask-message notia-meeting-ask-message--${message.role}`}>
              {message.role === 'assistant' ? <ChatMarkdownMessage source={message.content} /> : <p>{message.content}</p>}
            </div>
          ))}
          {isAsking ? (
            <div className="notia-meeting-ask-message notia-meeting-ask-message--assistant">
              {streaming ? <ChatMarkdownMessage source={streaming} /> : (
                <div className="notia-chat-thinking" role="status" aria-label="Pensando"><span /><span /><span /></div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="notia-meeting-error-text" role="alert">{error}</p> : null}
      <form className="notia-meeting-ask-form" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escribí una pregunta…"
          aria-label="Preguntar sobre la reunión"
          disabled={isAsking}
        />
        {isAsking ? (
          <button type="button" className="notia-meeting-icon-button" aria-label="Cancelar consulta" onClick={() => controllerRef.current?.abort()}>
            <X size={15} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="notia-meeting-icon-button notia-meeting-send" aria-label="Enviar pregunta" disabled={!draft.trim()}>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        )}
      </form>
    </section>
  )
}
