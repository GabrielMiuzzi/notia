import { memo, useLayoutEffect, useRef } from 'react'
import { Bot, User2 } from 'lucide-react'
import { ChatMarkdownMessage } from './ChatMarkdownMessage'
import type { StoredChatMessage } from '../../../../services/chat/chatDocumentStorage'

interface ChatThreadProps {
  messages: StoredChatMessage[]
  isSubmitting: boolean
  isChatLoading: boolean
  isCheckingAiHealth: boolean
  aiAvailabilityMessage: string | null
  selectedChatFilePath: string | null
  showHistoryPanel: boolean
  streamingThinking: string
  streamingAssistantMessage: string
  threadRef: React.RefObject<HTMLDivElement | null>
  onOpenAiSettings?: () => void
}

function ChatThreadComponent({
  messages,
  isSubmitting,
  isChatLoading,
  isCheckingAiHealth,
  aiAvailabilityMessage,
  selectedChatFilePath,
  showHistoryPanel,
  streamingThinking,
  streamingAssistantMessage,
  threadRef,
  onOpenAiSettings,
}: ChatThreadProps) {
  const hasMessages = messages.length > 0
  const thinkingContentRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const container = thinkingContentRef.current
    if (!container || !streamingThinking) {
      return
    }
    container.scrollTop = container.scrollHeight
  }, [streamingThinking])

  return (
    <section
      ref={threadRef}
      className="notia-chat-thread"
      aria-live="polite"
    >
      {isCheckingAiHealth ? (
        <div className="notia-chat-empty">
          <strong>Verificando IA...</strong>
          <p>Esperá un momento antes de abrir el chat.</p>
        </div>
      ) : aiAvailabilityMessage ? (
        <div className="notia-chat-empty">
          <Bot size={18} />
          <strong>La IA no está disponible</strong>
          <p>{aiAvailabilityMessage}</p>
          {onOpenAiSettings ? (
            <button
              type="button"
              className="notia-chat-empty-action"
              onClick={onOpenAiSettings}
            >
              Configurar IA
            </button>
          ) : null}
        </div>
      ) : hasMessages ? (
        <>
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}-${message.content.length}`}
              className={`notia-chat-message notia-chat-message--${message.role}`}
            >
              <div className="notia-chat-message-avatar" aria-hidden="true">
                {message.role === 'assistant' ? <Bot size={16} /> : <User2 size={16} />}
              </div>
              <div className="notia-chat-message-bubble">
                <span className="notia-chat-message-role">
                  {message.role === 'assistant' ? 'Asistente' : 'Vos'}
                </span>
                <ChatMarkdownMessage source={message.content} />
              </div>
            </article>
          ))}
          {isSubmitting ? (
            <>
              <article className="notia-chat-message notia-chat-message--assistant">
                <div className="notia-chat-message-avatar" aria-hidden="true">
                  <Bot size={16} />
                </div>
                <div className="notia-chat-message-bubble notia-chat-message-bubble--thinking">
                  <span className="notia-chat-message-role">Thinking</span>
                  {streamingThinking.trim() ? (
                    <div
                      ref={thinkingContentRef}
                      className="notia-chat-thinking-content"
                      aria-live="polite"
                    >
                      <ChatMarkdownMessage source={streamingThinking} />
                    </div>
                  ) : (
                    <div className="notia-chat-thinking" role="status" aria-label="Pensando">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              </article>
              {streamingAssistantMessage.trim() ? (
                <article className="notia-chat-message notia-chat-message--assistant">
                  <div className="notia-chat-message-avatar" aria-hidden="true">
                    <Bot size={16} />
                  </div>
                  <div className="notia-chat-message-bubble">
                    <span className="notia-chat-message-role">Asistente</span>
                    <ChatMarkdownMessage source={streamingAssistantMessage} />
                  </div>
                </article>
              ) : null}
            </>
          ) : null}
        </>
      ) : isChatLoading ? (
        <div className="notia-chat-empty">
          <strong>Cargando chat...</strong>
        </div>
      ) : (
        <div className="notia-chat-empty">
          <Bot size={18} />
          <strong>{selectedChatFilePath ? 'Empeza una conversacion' : 'Selecciona o crea un chat'}</strong>
          <p>
            {selectedChatFilePath
              ? 'Usa una sugerencia o escribi abajo para iniciar el chat con la IA.'
              : showHistoryPanel
                ? 'Escribí abajo para crear un chat automático o elegí uno existente para continuar.'
                : 'Escribí abajo y el panel lateral crea un chat automático con la configuración rápida.'}
          </p>
        </div>
      )}
    </section>
  )
}

export const ChatThread = memo(ChatThreadComponent)
ChatThread.displayName = 'ChatThread'
