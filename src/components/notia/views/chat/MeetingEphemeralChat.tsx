import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { Bot, Send, User2, X } from 'lucide-react'
import { NotiaButton } from '../../../common/NotiaButton'
import { chatAboutMeetingTranscript } from '../../../../services/ai/aiRuntime'
import type { StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'
import {
  getMeetingTranscriptContext,
  subscribeMeetingTranscriptContext,
} from '../../../../services/meeting/meetingTranscriptContext'
import type { AiPreferences } from '../../../../services/preferences/aiSettingsStorage'
import { ChatMarkdownMessage } from './ChatMarkdownMessage'

interface MeetingEphemeralChatProps {
  aiPreferences: AiPreferences
}

export function MeetingEphemeralChat({ aiPreferences }: MeetingEphemeralChatProps) {
  const transcript = useSyncExternalStore(
    subscribeMeetingTranscriptContext,
    getMeetingTranscriptContext,
    getMeetingTranscriptContext,
  )
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [streamingMessage, setStreamingMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLElement | null>(null)

  useEffect(() => () => abortControllerRef.current?.abort(), [])
  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [messages, streamingMessage])

  const submitQuestion = async () => {
    const question = draft.trim()
    if (!question || isSubmitting) return
    if (!transcript.trim()) {
      setError('Todavía no hay una transcripción de Meeting para consultar.')
      return
    }

    const previousMessages = messages
    const userMessage: StoredChatMessage = { role: 'user', content: question }
    const controller = new AbortController()
    abortControllerRef.current = controller
    setMessages((current) => [...current, userMessage])
    setDraft('')
    setStreamingMessage('')
    setError(null)
    setIsSubmitting(true)

    try {
      const answer = await chatAboutMeetingTranscript(
        aiPreferences,
        transcript,
        question,
        previousMessages,
        {
          abortSignal: controller.signal,
          onMessageDelta: (delta) => setStreamingMessage((current) => current + delta),
        },
      )
      setMessages((current) => [...current, { role: 'assistant', content: answer }])
    } catch (submitError) {
      if (!controller.signal.aborted) {
        setError(submitError instanceof Error ? submitError.message : 'No se pudo consultar la transcripción.')
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setStreamingMessage('')
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitQuestion()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitQuestion()
    }
  }

  const cancelReply = () => abortControllerRef.current?.abort()

  return (
    <main className="notia-main notia-chat-view">
      <section className="notia-chat-shell">
        <div className="notia-chat-layout">
          <section className="notia-chat-main">
            <header className="notia-meeting-chat-header">
              <div>
                <strong>Chat de Meeting</strong>
                <span>Usa la transcripción actual como contexto.</span>
              </div>
              <span className="notia-meeting-chat-ephemeral">Efímero · no se guarda</span>
            </header>

            <section ref={threadRef} className="notia-chat-thread" aria-live="polite">
              {messages.length === 0 && !isSubmitting ? (
                <div className="notia-chat-empty">
                  <Bot size={18} />
                  <strong>{transcript.trim() ? 'Preguntá sobre la reunión' : 'Esperando una transcripción'}</strong>
                  <p>{transcript.trim()
                    ? 'Podés pedir un resumen, acuerdos, tareas o detalles mencionados durante el Meeting.'
                    : 'Iniciá una grabación o escribí una transcripción para habilitar este chat.'}</p>
                </div>
              ) : null}
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`notia-chat-message notia-chat-message--${message.role}`}>
                  <div className="notia-chat-message-avatar" aria-hidden="true">
                    {message.role === 'assistant' ? <Bot size={16} /> : <User2 size={16} />}
                  </div>
                  <div className="notia-chat-message-bubble">
                    <span className="notia-chat-message-role">{message.role === 'assistant' ? 'Asistente' : 'Vos'}</span>
                    <ChatMarkdownMessage source={message.content} />
                  </div>
                </article>
              ))}
              {isSubmitting ? (
                <article className="notia-chat-message notia-chat-message--assistant">
                  <div className="notia-chat-message-avatar" aria-hidden="true"><Bot size={16} /></div>
                  <div className="notia-chat-message-bubble">
                    <span className="notia-chat-message-role">Asistente</span>
                    {streamingMessage ? <ChatMarkdownMessage source={streamingMessage} /> : (
                      <div className="notia-chat-thinking" role="status" aria-label="Pensando"><span /><span /><span /></div>
                    )}
                  </div>
                </article>
              ) : null}
            </section>

            {error ? <div className="notia-meeting-chat-error" role="alert">{error}</div> : null}
            <form className="notia-chat-composer" onSubmit={handleSubmit}>
              <div className="notia-chat-context-indicator">
                <Bot size={16} />
                <span>{transcript.trim()
                  ? `Transcripción de Meeting disponible · ${transcript.trim().length.toLocaleString()} caracteres`
                  : 'Sin transcripción disponible'}</span>
              </div>
              <div className="notia-chat-composer-field">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSubmitting || !transcript.trim()}
                  placeholder="Preguntá algo sobre la transcripción…"
                  aria-label="Pregunta sobre la transcripción de Meeting"
                />
              </div>
              <div className="notia-chat-composer-footer">
                <span>Enter para enviar · Shift+Enter para nueva línea</span>
                <div className="notia-chat-composer-actions">
                  {isSubmitting ? (
                    <NotiaButton type="button" variant="ghost" size="icon" onClick={cancelReply} aria-label="Cancelar respuesta">
                      <X size={18} />
                    </NotiaButton>
                  ) : null}
                  <NotiaButton type="submit" variant="primary" size="icon" disabled={isSubmitting || !draft.trim() || !transcript.trim()} aria-label="Enviar pregunta">
                    <Send size={18} />
                  </NotiaButton>
                </div>
              </div>
            </form>
          </section>
        </div>
      </section>
    </main>
  )
}
