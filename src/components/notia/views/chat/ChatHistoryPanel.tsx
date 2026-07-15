import { memo } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus, Settings2, Sparkles } from 'lucide-react'
import { NotiaButton } from '../../../common/NotiaButton'
import type { ChatHistoryState } from './ChatWorkspaceViewTypes'

interface ChatHistoryPanelProps extends ChatHistoryState {
  library: import('../../../../types/notia').NotiaLibrary | null
  selectedChatFilePath: string | null
  setSelectedChatFilePath: (filePath: string | null) => void
  setIsCreateChatModalOpen: (value: boolean) => void
  setCreateChatErrorMessage: (value: string | null) => void
  setIsChatToolsModalOpen: (value: boolean) => void
  setChatContextMenuState: (value: {
    chatId: string
    filePath: string
    title: string
    top: number
    left: number
  } | null) => void
}

function ChatHistoryPanelComponent({
  library,
  selectedChatFilePath,
  setSelectedChatFilePath,
  setIsCreateChatModalOpen,
  setCreateChatErrorMessage,
  setIsChatToolsModalOpen,
  setChatContextMenuState,
  isHistoryPanelOpen,
  setIsHistoryPanelOpen,
  resolvedPreviousChats,
  virtualChatHistoryItems,
  chatHistoryTotalSize,
  chatHistoryListRef,
}: ChatHistoryPanelProps) {
  return (
    <aside
      className={`notia-chat-history-panel ${
        isHistoryPanelOpen ? 'notia-chat-history-panel--open' : 'notia-chat-history-panel--closed'
      }`}
      data-notia-prevent-menu-close
    >
      <div className="notia-chat-history-header" data-notia-prevent-menu-close>
        <NotiaButton
          variant="secondary"
          className="notia-chat-history-toggle"
          aria-label={isHistoryPanelOpen ? 'Ocultar panel de chats' : 'Mostrar panel de chats'}
          title={isHistoryPanelOpen ? 'Ocultar panel de chats' : 'Mostrar panel de chats'}
          onClick={() => {
            setIsHistoryPanelOpen((current) => !current)
          }}
        >
          {isHistoryPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </NotiaButton>
        {isHistoryPanelOpen ? (
          <div className="notia-chat-history-actions">
            <NotiaButton
              variant="primary"
              className="notia-chat-new-conversation"
              onClick={() => {
                setCreateChatErrorMessage(null)
                setIsCreateChatModalOpen(true)
              }}
              disabled={!library}
            >
              <Plus size={16} />
              Nuevo chat
            </NotiaButton>
            <NotiaButton
              size="icon"
              variant="secondary"
              className="notia-chat-tools-button"
              title="Herramientas del chat"
              aria-label="Abrir herramientas del chat"
              onClick={() => {
                setIsChatToolsModalOpen(true)
              }}
              disabled={!library}
            >
              <Settings2 size={16} />
            </NotiaButton>
          </div>
        ) : null}
      </div>

      {isHistoryPanelOpen ? (
        <>
          <div className="notia-chat-history-copy">
            <strong>Chats previos</strong>
            <span>
              {resolvedPreviousChats.length > 0
                ? `${resolvedPreviousChats.length} chat${resolvedPreviousChats.length === 1 ? '' : 's'} creado${resolvedPreviousChats.length === 1 ? '' : 's'}`
                : 'Todavia no hay chats creados.'}
            </span>
          </div>
          <div ref={chatHistoryListRef} className="notia-chat-history-list" aria-label="Chats previos">
            {resolvedPreviousChats.length > 0 ? (
              <div style={{ height: `${chatHistoryTotalSize}px`, position: 'relative' }}>
                {virtualChatHistoryItems.map((virtualItem) => {
                  const chat = resolvedPreviousChats[virtualItem.index]
                  if (!chat) {
                    return null
                  }

                  return (
                    <div
                      key={chat.id}
                      style={{
                        position: 'absolute',
                        top: `${virtualItem.start}px`,
                        left: 0,
                        right: 0,
                        height: `${virtualItem.size}px`,
                      }}
                    >
                      <button
                        type="button"
                        className={`notia-chat-history-item ${
                          selectedChatFilePath === chat.filePath ? 'notia-chat-history-item--active' : ''
                        }`}
                        title={chat.filePath}
                        onClick={() => {
                          setSelectedChatFilePath(chat.filePath)
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          const panelWidth = 184
                          const nextLeft = Math.min(
                            Math.max(12, event.clientX),
                            window.innerWidth - panelWidth - 12,
                          )

                          setChatContextMenuState({
                            chatId: chat.id,
                            filePath: chat.filePath,
                            title: chat.title,
                            top: event.clientY,
                            left: nextLeft,
                          })
                        }}
                      >
                        <span>{chat.title}</span>
                        <small>{chat.filePath}</small>
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="notia-chat-history-empty">No hay archivos de chat en `chat/chats`.</div>
            )}
          </div>
        </>
      ) : null}
    </aside>
  )
}

function ChatHistoryPanelHeaderCompactComponent({
  title,
  description,
  compactRecentChats,
  selectedChatFilePath,
  setSelectedChatFilePath,
}: {
  title: string
  description: string
  compactRecentChats: Array<{ id: string; title: string; filePath: string }>
  selectedChatFilePath: string | null
  setSelectedChatFilePath: (filePath: string | null) => void
}) {
  return (
    <header className="notia-chat-header notia-chat-header--compact">
      <div className="notia-chat-header-copy notia-chat-header-copy--compact">
        <span className="notia-chat-title-subtle">{title}</span>
        <p>{description}</p>
      </div>
      {compactRecentChats.length > 0 ? (
        <div className="notia-chat-compact-recent" aria-label="Chats recientes">
          {compactRecentChats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              className={`notia-chat-compact-recent-item ${
                selectedChatFilePath === chat.filePath ? 'notia-chat-compact-recent-item--active' : ''
              }`}
              onClick={() => {
                setSelectedChatFilePath(chat.filePath)
              }}
              title={chat.title}
            >
              {chat.title}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  )
}

export function ChatHeaderComponent({
  title,
  activeChatTitle,
  description,
  suggestions,
  setDraft,
}: {
  title: string
  activeChatTitle: string | undefined
  description: string
  suggestions: string[]
  setDraft: (value: string) => void
}) {
  return (
    <header className="notia-chat-header">
      <div className="notia-chat-header-copy">
        <span className="notia-chat-kicker">
          <Sparkles size={14} />
          Workspace AI
        </span>
        <h2>{activeChatTitle ?? title}</h2>
        <p>{description}</p>
      </div>
      {suggestions.length > 0 ? (
        <div className="notia-chat-suggestions" aria-label="Sugerencias de inicio">
          {suggestions.map((suggestion) => (
            <NotiaButton
              key={suggestion}
              variant="secondary"
              className="notia-chat-suggestion"
              onClick={() => {
                setDraft(suggestion)
              }}
            >
              {suggestion}
            </NotiaButton>
          ))}
        </div>
      ) : null}
    </header>
  )
}

export const ChatHistoryPanel = memo(ChatHistoryPanelComponent)
export const ChatHistoryPanelHeaderCompact = memo(ChatHistoryPanelHeaderCompactComponent)
ChatHistoryPanel.displayName = 'ChatHistoryPanel'
ChatHistoryPanelHeaderCompact.displayName = 'ChatHistoryPanelHeaderCompact'
