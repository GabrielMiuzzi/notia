import { ChevronDown, ChevronRight, Menu, MessageCirclePlus, Settings2, Sparkles, Waypoints } from 'lucide-react'
import type { ChatAgentLook } from './useChatAgentSettings'
import type { ChatStarter } from './ChatWorkspaceViewTypes'
import { StarterIcon } from './ChatWorkspacePanels'

/*
 * Phone layout of the Chat IA view (canvas «Notia · Chat IA rediseño»,
 * mobile boards): header, agents bar and the empty conversation. The view
 * passes what the backend already decided; these components only draw it.
 */

/** The agent's initials on its solid color, as the phone boards draw them. */
export function ChatPhoneAvatar({ look, size }: { look: Pick<ChatAgentLook, 'initials' | 'colorIndex'>; size: 'stack' | 'row' | 'option' }) {
  return (
    <span
      className={`notia-chat-agent-avatar notia-chat-agent-avatar--c${look.colorIndex} notia-chat-phone-avatar notia-chat-phone-avatar--${size}`}
      aria-hidden="true"
    >
      {look.initials}
    </span>
  )
}

export function ChatPhoneHeader({
  title,
  modelLabel,
  isAiAvailable,
  agentCount,
  onOpenHistory,
  onOpenModelSettings,
  onOpenContext,
  onNewChat,
}: {
  title: string
  modelLabel: string
  isAiAvailable: boolean
  /** Agents of the chat; the context button shows how many. */
  agentCount: number
  onOpenHistory: () => void
  onOpenModelSettings: () => void
  onOpenContext: () => void
  onNewChat: () => void
}) {
  return (
    <header className="notia-chat-phone-header">
      <button type="button" className="notia-chat-phone-icon" aria-label="Abrir historial de chats" onClick={onOpenHistory}>
        <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div className="notia-chat-phone-heading">
        <h1 className="notia-chat-phone-title">{title}</h1>
        <button
          type="button"
          className="notia-chat-phone-model"
          aria-label={`Modelo: ${modelLabel}. Abrir configuración de IA`}
          onClick={onOpenModelSettings}
        >
          <span className={`notia-chat-model-dot${isAiAvailable ? ' notia-chat-model-dot--ready' : ''}`} aria-hidden="true" />
          <span className="notia-chat-phone-model-name">{modelLabel}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <span className="notia-chat-phone-badge-anchor">
        <button
          type="button"
          className="notia-chat-phone-icon"
          aria-label={agentCount > 0
            ? `Abrir contexto del chat (${agentCount} ${agentCount === 1 ? 'agente' : 'agentes'})`
            : 'Abrir contexto del chat'}
          onClick={onOpenContext}
        >
          <Settings2 size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {agentCount > 0 ? <span className="notia-chat-phone-badge" aria-hidden="true">{agentCount}</span> : null}
      </span>
      <button type="button" className="notia-chat-phone-icon" aria-label="Nuevo chat" onClick={onNewChat}>
        <MessageCirclePlus size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </header>
  )
}

/** The chat's dynamic and agents under the header; opens the agent list. */
export function ChatPhoneAgentsBar({
  dynamicName,
  agents,
  onOpen,
}: {
  dynamicName: string
  agents: ChatAgentLook[]
  onOpen: () => void
}) {
  const count = `${agents.length} ${agents.length === 1 ? 'agente' : 'agentes'}`
  return (
    <button
      type="button"
      className="notia-chat-phone-agents-bar"
      aria-label={`${dynamicName} · ${count}. Elegir agentes`}
      onClick={onOpen}
    >
      <Waypoints size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="notia-chat-phone-agents-bar-name">{dynamicName}</span>
      <span className="notia-chat-phone-agents-bar-count">· {count}</span>
      <span className="notia-chat-phone-agents-bar-stack">
        {agents.map((look, index) => <ChatPhoneAvatar key={`${look.initials}-${index}`} look={look} size="stack" />)}
      </span>
      <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

/** The empty conversation: greeting and starters right above the composer. */
export function ChatPhoneWelcome({
  libraryName,
  starters,
  onSelectStarter,
}: {
  libraryName: string | null
  starters: ChatStarter[]
  onSelectStarter: (prompt: string) => void
}) {
  return (
    <div className="notia-chat-phone-welcome">
      <div className="notia-chat-phone-hero">
        <span className="notia-chat-phone-hero-mark" aria-hidden="true">
          <Sparkles size={24} strokeWidth={1.75} />
        </span>
        <h2>¿En qué trabajamos hoy?</h2>
        <p>
          {libraryName
            ? `Preguntá sobre la librería ${libraryName} y tus tareas.`
            : 'Elegí una librería activa para empezar a conversar.'}
        </p>
      </div>
      {starters.length > 0 ? (
        <div className="notia-chat-phone-starters" role="group" aria-label="Sugerencias de inicio">
          {starters.map((starter, index) => (
            <button
              key={starter.prompt}
              type="button"
              className="notia-chat-phone-starter"
              onClick={() => onSelectStarter(starter.prompt)}
            >
              <span className="notia-chat-phone-starter-icon" aria-hidden="true">
                <StarterIcon index={index} size={17} strokeWidth={1.75} />
              </span>
              <span className="notia-chat-phone-starter-text">
                <strong>{starter.title}</strong>
                <span>{starter.description}</span>
              </span>
              <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
