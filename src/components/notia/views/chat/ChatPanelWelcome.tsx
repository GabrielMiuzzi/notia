import { ArrowRight } from 'lucide-react'
import type { ChatStarter } from './ChatWorkspaceViewTypes'

interface ChatPanelWelcomeProps {
  /** The agent that answers; `null` when the view has none to choose. */
  agent: { name: string; description: string } | null
  starters: ChatStarter[]
  isDisabled: boolean
  onSendStarter: (prompt: string) => void
}

/** A side chat without messages: who answers and a few questions to start with. */
export function ChatPanelWelcome({ agent, starters, isDisabled, onSendStarter }: ChatPanelWelcomeProps) {
  const description = agent?.description
    ? `${agent.description.charAt(0).toLowerCase()}${agent.description.slice(1)}`
    : ''
  return (
    <section className="notia-chat-panel-welcome" aria-label="Nuevo chat">
      <div className="notia-chat-panel-welcome-copy">
        <h3>¿En qué te ayudo?</h3>
        {agent ? (
          <p>
            Hablás con <strong>{agent.name}</strong>{description ? `: ${description}` : '.'}
          </p>
        ) : null}
        <p>Preguntá sobre tus notas, tickets o agenda. Lo que tenés abierto se suma como contexto.</p>
      </div>
      {starters.length > 0 ? (
        <div className="notia-chat-panel-starters">
          {starters.map((starter) => (
            <button
              key={starter.title}
              type="button"
              className="notia-chat-panel-starter"
              title={starter.description}
              disabled={isDisabled}
              onClick={() => onSendStarter(starter.prompt)}
            >
              <span>{starter.title}</span>
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
