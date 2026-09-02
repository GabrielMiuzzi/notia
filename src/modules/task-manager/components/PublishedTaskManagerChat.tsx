import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Bot, Send, User2, X } from 'lucide-react'
import { NotiaButton } from '../../../components/common/NotiaButton'
import { ChatMarkdownMessage } from '../../../components/notia/views/chat/ChatMarkdownMessage'
import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import type { TaskExecutionStep } from '../../../services/chat/chatScopedAgentRuntime'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import { runPublishedTaskManagerChatReply } from '../services/publishedTaskManagerChatRuntime'

interface PublishedTaskManagerChatProps {
  aiPreferences: AiPreferences
  library: NotiaLibrary
  scopePaths: string[]
}

export function PublishedTaskManagerChat({ aiPreferences, library, scopePaths }: PublishedTaskManagerChatProps) {
  const [messages, setMessages] = useState<StoredChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [streamingMessage, setStreamingMessage] = useState('')
  const [thinkingMessage, setThinkingMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [executionPlan, setExecutionPlan] = useState<TaskExecutionStep[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLElement | null>(null)

  useEffect(() => () => abortControllerRef.current?.abort(), [])
  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [isSubmitting, messages, streamingMessage, thinkingMessage])

  const submitQuestion = async () => {
    const prompt = draft.trim()
    if (!prompt || isSubmitting || scopePaths.length === 0) return
    const previousMessages = messages
    const controller = new AbortController()
    abortControllerRef.current = controller
    setMessages((current) => [...current, { role: 'user', content: prompt }])
    setDraft('')
    setError(null)
    setStreamingMessage('')
    setThinkingMessage('')
    setExecutionPlan([])
    setIsSubmitting(true)
    try {
      const answer = await runPublishedTaskManagerChatReply({
        aiPreferences,
        library,
        scopePaths,
        prompt,
        previousMessages,
        signal: controller.signal,
        onExecutionPlanChange: setExecutionPlan,
        onMessageDelta: (delta) => setStreamingMessage((current) => current + delta),
        onThinkingDelta: (delta) => setThinkingMessage((current) => current + delta),
      })
      setMessages((current) => [...current, { role: 'assistant', content: answer }])
    } catch (submitError) {
      if (!controller.signal.aborted) {
        setError(submitError instanceof Error ? submitError.message : 'No se pudo consultar el agente de IA.')
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setIsSubmitting(false)
      setStreamingMessage('')
      setThinkingMessage('')
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

  return (
    <main className="notia-main notia-chat-view notia-published-chat">
      <section className="notia-chat-shell">
        <div className="notia-chat-layout">
          <section className="notia-chat-main">
            <header className="notia-meeting-chat-header">
              <div><strong>Chat de IA</strong><span>Contexto limitado a los tableros publicados.</span></div>
              <span className="notia-meeting-chat-ephemeral">Efimero · no se guarda</span>
            </header>
            <section ref={threadRef} className="notia-chat-thread" aria-live="polite">
              {messages.length === 0 && !isSubmitting ? (
                <div className="notia-chat-empty">
                  <Bot size={18} />
                  <strong>Agente de Task Manager</strong>
                  <p>Puede consultar y modificar solamente los tickets de los tableros publicados.</p>
                </div>
              ) : null}
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`notia-chat-message notia-chat-message--${message.role}`}>
                  <div className="notia-chat-message-avatar" aria-hidden="true">{message.role === 'assistant' ? <Bot size={16} /> : <User2 size={16} />}</div>
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
                    {thinkingMessage ? <div className="notia-published-chat-thinking-text">{thinkingMessage}</div> : null}
                    {streamingMessage ? <ChatMarkdownMessage source={streamingMessage} /> : <div className="notia-chat-thinking" role="status" aria-label="Pensando"><span /><span /><span /></div>}
                  </div>
                </article>
              ) : null}
            </section>
            {executionPlan.length > 0 ? (
              <ol className="notia-published-chat-plan" aria-label="Plan de ejecucion">
                {executionPlan.map((step) => <li key={step.id} data-status={step.status}>{step.label}</li>)}
              </ol>
            ) : null}
            {error ? <div className="notia-meeting-chat-error" role="alert">{error}</div> : null}
            <form className="notia-chat-composer" onSubmit={handleSubmit}>
              <div className="notia-chat-context-indicator"><Bot size={16} /><span>{scopePaths.length} tickets autorizados</span></div>
              <div className="notia-chat-composer-field"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} disabled={isSubmitting || scopePaths.length === 0} placeholder="Preguntale al agente sobre los tableros publicados…" aria-label="Mensaje para el agente de Task Manager" /></div>
              <div className="notia-chat-composer-footer">
                <span>Enter para enviar · Shift+Enter para nueva linea</span>
                <div className="notia-chat-composer-actions">
                  {isSubmitting ? <NotiaButton type="button" variant="ghost" size="icon" onClick={() => abortControllerRef.current?.abort()} aria-label="Cancelar respuesta"><X size={18} /></NotiaButton> : null}
                  <NotiaButton type="submit" variant="primary" size="icon" disabled={isSubmitting || !draft.trim() || scopePaths.length === 0} aria-label="Enviar mensaje"><Send size={18} /></NotiaButton>
                </div>
              </div>
            </form>
          </section>
        </div>
      </section>
    </main>
  )
}
