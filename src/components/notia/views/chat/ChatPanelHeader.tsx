import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, History, MessageSquarePlus, PenLine, Pin, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { ChatListItem } from '../../../../services/chat/chatDocumentStorage'
import { ChatAgentAvatar } from './ChatAgentPanel'
import { HISTORY_GROUP_LABELS, HISTORY_GROUP_ORDER } from './chatContextText'
import { useChatHistoryList } from './useChatHistoryList'
import { useDismissablePopover } from './useDismissablePopover'

/** An agent the side chat can answer with: a prompt file of `.agent/promps`. */
export interface ChatPanelAgent {
  fileName: string
  name: string
  description: string
  initials: string
  colorIndex: number
}

/** How a chat's agent looks in the history. */
export interface ChatPanelAgentLook {
  name: string
  initials: string
  colorIndex: number
}

interface ChatPanelHeaderProps {
  /** Empty: the view has no agent to choose and the header shows «Asistente». */
  agents: ChatPanelAgent[]
  selectedAgentFileName: string
  isAgentChangeDisabled: boolean
  onSelectAgent: (fileName: string) => void
  /** Title of the open chat; `null` for a new one. */
  chatTitle: string | null
  library: NotiaLibrary | null
  selectedChatFilePath: string | null
  /** The agent a chat answered with last (`null`: Notia). */
  agentLookOf: (agent: string | null) => ChatPanelAgentLook
  onPickChat: (chat: ChatListItem) => void
  onNewChat: () => void
  /** Asks and deletes; resolves when it is done or declined. */
  onDeleteChat: (chat: ChatListItem) => Promise<void>
  onClose?: () => void
}

function AgentMenu({
  agents,
  selected,
  disabled,
  onSelect,
}: {
  agents: ChatPanelAgent[]
  selected: ChatPanelAgent
  disabled: boolean
  onSelect: (fileName: string) => void
}) {
  const { open, setOpen, containerRef, onKeyDown } = useDismissablePopover<HTMLDivElement>()
  const listId = useId()
  return (
    <div className="notia-chat-panel-agent" ref={containerRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={`notia-chat-panel-agent-button${open ? ' is-open' : ''}`}
        aria-label={`Agente: ${selected.name}. Elegir agente`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <ChatAgentAvatar look={selected} size="small" />
        <span className="notia-chat-panel-agent-name">{selected.name}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div id={listId} className="notia-chat-panel-popover" role="listbox" aria-label="Agentes">
          <p className="notia-chat-panel-popover-title">Agente</p>
          {agents.map((agent) => {
            const isSelected = agent.fileName === selected.fileName
            return (
              <button
                key={agent.fileName}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`notia-chat-panel-agent-option${isSelected ? ' is-selected' : ''}`}
                onClick={() => {
                  setOpen(false)
                  if (!isSelected) onSelect(agent.fileName)
                }}
              >
                <ChatAgentAvatar look={agent} />
                <span className="notia-chat-panel-agent-option-text">
                  <span>{agent.name}</span>
                  {agent.description ? <span>{agent.description}</span> : null}
                </span>
                {isSelected ? <Check size={15} aria-hidden="true" /> : null}
              </button>
            )
          })}
          <p className="notia-chat-panel-popover-note">Los agentes son los archivos de .agent/promps.</p>
        </div>
      ) : null}
    </div>
  )
}

function HistoryRow({
  item,
  look,
  isCurrent,
  onOpen,
  onTogglePin,
  onRename,
  onDelete,
}: {
  item: ChatListItem
  look: ChatPanelAgentLook
  isCurrent: boolean
  onOpen: () => void
  onTogglePin: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isRenaming = draft !== null
  useEffect(() => {
    if (isRenaming) inputRef.current?.select()
  }, [isRenaming])
  const finishRename = () => {
    const title = draft?.trim() ?? ''
    setDraft(null)
    if (title && title !== item.title) onRename(title)
  }
  return (
    <div className={`notia-chat-history-row${isCurrent ? ' is-current' : ''}`}>
      {draft !== null ? (
        <input
          ref={inputRef}
          className="notia-chat-history-rename"
          aria-label={`Nuevo nombre de «${item.title}»`}
          value={draft}
          maxLength={300}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              finishRename()
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              setDraft(null)
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="notia-chat-history-open"
          aria-current={isCurrent ? 'true' : undefined}
          onClick={onOpen}
        >
          <ChatAgentAvatar look={look} />
          <span className="notia-chat-history-text">
            <span className="notia-chat-history-title">{item.title}</span>
            <span className="notia-chat-history-meta">{look.name}</span>
          </span>
        </button>
      )}
      {isCurrent && draft === null ? <span className="notia-chat-history-current">Actual</span> : null}
      {draft === null ? (
        <div className="notia-chat-history-actions">
          <button
            type="button"
            className={`notia-chat-history-action${item.pinned ? ' is-pinned' : ''}`}
            aria-label={item.pinned ? `Desfijar «${item.title}»` : `Fijar «${item.title}»`}
            title={item.pinned ? 'Desfijar' : 'Fijar'}
            aria-pressed={item.pinned}
            onClick={onTogglePin}
          >
            <Pin size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="notia-chat-history-action"
            aria-label={`Renombrar «${item.title}»`}
            title="Renombrar"
            onClick={() => setDraft(item.title)}
          >
            <PenLine size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="notia-chat-history-action notia-chat-history-action--danger"
            aria-label={`Eliminar «${item.title}»`}
            title="Eliminar conversación"
            onClick={onDelete}
          >
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function HistoryMenu({
  library,
  selectedChatFilePath,
  agentLookOf,
  onPickChat,
  onNewChat,
  onDeleteChat,
}: Pick<ChatPanelHeaderProps, 'library' | 'selectedChatFilePath' | 'agentLookOf' | 'onPickChat' | 'onNewChat' | 'onDeleteChat'>) {
  const { open, setOpen, containerRef, onKeyDown } = useDismissablePopover<HTMLDivElement>()
  const [query, setQuery] = useState('')
  const dialogId = useId()
  const history = useChatHistoryList(library, open)
  const normalizedQuery = query.trim().toLowerCase()
  const visible = (history.items ?? []).filter((item) => !normalizedQuery || item.title.toLowerCase().includes(normalizedQuery))
  const groups = HISTORY_GROUP_ORDER
    .map((group) => ({ group, items: visible.filter((item) => (item.group ?? 'earlier') === group) }))
    .filter((entry) => entry.items.length > 0)
  const toggle = (next: boolean) => {
    setOpen(next)
    setQuery('')
  }

  // Ctrl+H opens the history and Ctrl+N starts a chat while the side chat has the focus.
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      const panel = containerRef.current?.closest('.notia-chat-main')
      if (!panel || !(event.target instanceof Node) || !panel.contains(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'h') {
        event.preventDefault()
        setOpen((current) => !current)
        setQuery('')
      } else if (key === 'n') {
        event.preventDefault()
        setOpen(false)
        onNewChat()
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [containerRef, onNewChat, setOpen])

  return (
    <div className="notia-chat-panel-history" ref={containerRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        className={`notia-chat-panel-action${open ? ' is-open' : ''}`}
        aria-label="Historial de chats"
        title="Historial (Ctrl H)"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => toggle(!open)}
      >
        <History size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div id={dialogId} className="notia-chat-panel-popover notia-chat-panel-popover--history" role="dialog" aria-label="Historial de chats">
          <div className="notia-chat-panel-popover-head">
            <span>Historial</span>
            <kbd className="notia-chat-kbd">Ctrl H</kbd>
          </div>
          <label className="notia-chat-history-search">
            <Search size={14} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="search"
              placeholder="Buscar conversaciones"
              aria-label="Buscar conversaciones"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="notia-chat-history-list">
            {history.error ? <p className="notia-chat-history-empty" role="alert">{history.error}</p> : null}
            {history.items === null && !history.error ? <p className="notia-chat-history-empty">Cargando…</p> : null}
            {groups.map(({ group, items }) => (
              <div key={group} role="group" aria-label={HISTORY_GROUP_LABELS[group]}>
                <p className="notia-chat-history-group">{HISTORY_GROUP_LABELS[group]}</p>
                {items.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    look={agentLookOf(item.agent)}
                    isCurrent={item.filePath === selectedChatFilePath}
                    onOpen={() => {
                      toggle(false)
                      onPickChat(item)
                    }}
                    onTogglePin={() => void history.togglePin(item)}
                    onRename={(title) => void history.rename(item, title)}
                    onDelete={() => {
                      void onDeleteChat(item).then(() => history.refresh())
                    }}
                  />
                ))}
              </div>
            ))}
            {history.items !== null && groups.length === 0 ? (
              <p className="notia-chat-history-empty">
                {normalizedQuery ? 'Sin conversaciones que coincidan' : 'Todavía no hay conversaciones'}
              </p>
            ) : null}
          </div>
          <div className="notia-chat-panel-popover-foot">
            <button
              type="button"
              className="notia-chat-panel-popover-link"
              onClick={() => {
                toggle(false)
                onNewChat()
              }}
            >
              <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>Nuevo chat</span>
              <kbd className="notia-chat-kbd">Ctrl N</kbd>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Header of the side chat: the agent that answers, the chat's title, history, new chat and close. */
export function ChatPanelHeader({
  agents,
  selectedAgentFileName,
  isAgentChangeDisabled,
  onSelectAgent,
  chatTitle,
  library,
  selectedChatFilePath,
  agentLookOf,
  onPickChat,
  onNewChat,
  onDeleteChat,
  onClose,
}: ChatPanelHeaderProps) {
  const selected = agents.find((agent) => agent.fileName === selectedAgentFileName) ?? agents[0]
  return (
    <header className="notia-chat-panel-header">
      <div className="notia-chat-panel-heading">
        {selected ? (
          <AgentMenu agents={agents} selected={selected} disabled={isAgentChangeDisabled} onSelect={onSelectAgent} />
        ) : (
          <span className="notia-chat-panel-assistant">
            <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
            Asistente
          </span>
        )}
        {chatTitle ? <span className="notia-chat-panel-chat-title" title={chatTitle}>· {chatTitle}</span> : null}
      </div>
      <HistoryMenu
        library={library}
        selectedChatFilePath={selectedChatFilePath}
        agentLookOf={agentLookOf}
        onPickChat={onPickChat}
        onNewChat={onNewChat}
        onDeleteChat={onDeleteChat}
      />
      <button type="button" className="notia-chat-panel-action" aria-label="Nuevo chat" title="Nuevo chat" onClick={onNewChat}>
        <MessageSquarePlus size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {onClose ? (
        <button type="button" className="notia-chat-panel-action" aria-label="Cerrar asistente" title="Cerrar" onClick={onClose}>
          <X size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
    </header>
  )
}
