import { useEffect, useRef, type FormEvent } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { ChatMarkdownMessage } from '../chat/ChatMarkdownMessage'
import { formatClock } from './meetingDisplay'
import { useMeetingAsk, type MeetingAsk, type MeetingAskInput } from './useMeetingAsk'
import type { MeetingQuestion } from '../../../../services/meeting/meetingTypes'

interface MeetingAskConversationProps {
  conversation: MeetingAsk
  /** Questions asked in the meeting, with their minute. */
  suggestions: MeetingQuestion[]
}

/** The meeting's own questions to start with, then the answers. */
export function MeetingAskConversation({ conversation, suggestions }: MeetingAskConversationProps) {
  const { messages, streaming, isAsking, error, ask } = conversation
  const threadRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [messages, streaming])

  return (
    <>
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
    </>
  )
}

/** Where the person writes a question, or cancels the one being answered. */
export function MeetingAskForm({ conversation }: { conversation: MeetingAsk }) {
  const { draft, setDraft, isAsking, ask, cancel } = conversation
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void ask(draft)
  }
  return (
    <form className="notia-meeting-ask-form" onSubmit={handleSubmit}>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Escribí una pregunta…"
        aria-label="Preguntar sobre la reunión"
        disabled={isAsking}
      />
      {isAsking ? (
        <button type="button" className="notia-meeting-icon-button" aria-label="Cancelar consulta" onClick={cancel}>
          <X size={15} aria-hidden="true" />
        </button>
      ) : (
        <button type="submit" className="notia-meeting-icon-button notia-meeting-send" aria-label="Enviar pregunta" disabled={!draft.trim()}>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}
    </form>
  )
}

interface MeetingAskPanelProps extends MeetingAskInput {
  /** Questions asked in the meeting, with their minute. */
  suggestions: MeetingQuestion[]
}

/** Questions about the finished meeting; the conversation is not saved. */
export function MeetingAskPanel({ transcript, suggestions, aiPreferences, library }: MeetingAskPanelProps) {
  const conversation = useMeetingAsk({ transcript, aiPreferences, library })
  return (
    <section className="notia-meeting-card notia-meeting-ask" aria-labelledby="meeting-ask-title">
      <h2 id="meeting-ask-title">Preguntale a la reunión</h2>
      <p>Respuestas con el minuto exacto donde se dijo.</p>
      <MeetingAskConversation conversation={conversation} suggestions={suggestions} />
      <MeetingAskForm conversation={conversation} />
    </section>
  )
}
