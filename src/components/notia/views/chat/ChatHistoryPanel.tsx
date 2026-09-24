import { memo } from 'react'
import { BookOpen, MoreHorizontal, PanelLeftClose, Plus, Search } from 'lucide-react'
import type { ChatContextMenuState, ChatHistoryState } from './ChatWorkspaceViewTypes'
import { CHAT_HISTORY_DOCKED_QUERY } from './useChatState'

const CHAT_CONTEXT_MENU_WIDTH = 184

interface ChatHistoryPanelProps extends ChatHistoryState {
  library: import('../../../../types/notia').NotiaLibrary | null
  selectedChatFilePath: string | null
  setSelectedChatFilePath: (filePath: string | null) => void
  onCreateChat: () => void
  setChatContextMenuState: (value: ChatContextMenuState | null) => void
}

function isHistoryDocked(): boolean {
  return window.matchMedia(CHAT_HISTORY_DOCKED_QUERY).matches
}

function ChatHistoryPanelComponent({
  library,
  selectedChatFilePath,
  setSelectedChatFilePath,
  onCreateChat,
  setChatContextMenuState,
  isHistoryPanelOpen,
  setIsHistoryPanelOpen,
  resolvedPreviousChats,
  filteredPreviousChats,
  chatHistoryQuery,
  setChatHistoryQuery,
  virtualChatHistoryItems,
  chatHistoryTotalSize,
  chatHistoryListRef,
}: ChatHistoryPanelProps) {
  if (!isHistoryPanelOpen) {
    return null
  }

  const openChatMenu = (chat: { id: string; filePath: string; title: string }, top: number, left: number) => {
    setChatContextMenuState({
      chatId: chat.id,
      filePath: chat.filePath,
      title: chat.title,
      top,
      left: Math.min(Math.max(12, left), window.innerWidth - CHAT_CONTEXT_MENU_WIDTH - 12),
    })
  }

  return (
    <>
      <button
        type="button"
        className="notia-chat-history-backdrop"
        aria-label="Cerrar historial de chats"
        onClick={() => setIsHistoryPanelOpen(false)}
      />
      <aside className="notia-chat-history-panel" aria-label="Historial de chats" data-notia-prevent-menu-close>
        <div className="notia-chat-history-header">
          <span className="notia-chat-history-title">Chats</span>
          <button
            type="button"
            className="notia-chat-icon-button"
            aria-label="Ocultar historial de chats"
            title="Ocultar historial de chats"
            onClick={() => setIsHistoryPanelOpen(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <button
          type="button"
          className="notia-chat-new-conversation"
          onClick={onCreateChat}
          disabled={!library}
        >
          <Plus size={16} />
          <span>Nuevo chat</span>
        </button>

        <label className="notia-chat-history-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={chatHistoryQuery}
            placeholder="Buscar chats"
            aria-label="Buscar chats"
            onChange={(event) => setChatHistoryQuery(event.target.value)}
          />
        </label>

        <span className="notia-chat-section-label">
          {resolvedPreviousChats.length > 0
            ? `${resolvedPreviousChats.length} chat${resolvedPreviousChats.length === 1 ? '' : 's'}`
            : 'Sin chats'}
        </span>

        <div ref={chatHistoryListRef} className="notia-chat-history-list" aria-label="Chats previos">
          {filteredPreviousChats.length > 0 ? (
            <div style={{ height: `${chatHistoryTotalSize}px`, position: 'relative' }}>
              {virtualChatHistoryItems.map((virtualItem) => {
                const chat = filteredPreviousChats[virtualItem.index]
                if (!chat) {
                  return null
                }
                const isActive = selectedChatFilePath === chat.filePath

                return (
                  <div
                    key={chat.id}
                    className={`notia-chat-history-row${isActive ? ' notia-chat-history-row--active' : ''}`}
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
                      className="notia-chat-history-item"
                      aria-current={isActive ? 'true' : undefined}
                      title={chat.filePath}
                      onClick={() => {
                        setSelectedChatFilePath(chat.filePath)
                        if (!isHistoryDocked()) setIsHistoryPanelOpen(false)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openChatMenu(chat, event.clientY, event.clientX)
                      }}
                    >
                      <span>{chat.title}</span>
                      <small>{chat.filePath}</small>
                    </button>
                    <button
                      type="button"
                      className="notia-chat-history-item-more"
                      aria-label={`Opciones de ${chat.title}`}
                      title="Opciones del chat"
                      onClick={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect()
                        openChatMenu(chat, bounds.bottom + 4, bounds.right - CHAT_CONTEXT_MENU_WIDTH)
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="notia-chat-history-empty">
              {resolvedPreviousChats.length > 0
                ? 'Ningún chat coincide con la búsqueda.'
                : 'No hay archivos de chat en chat/chats.'}
            </div>
          )}
        </div>

        {library ? (
          <div className="notia-chat-history-library">
            <span className="notia-chat-history-library-icon" aria-hidden="true">
              <BookOpen size={15} />
            </span>
            <span className="notia-chat-history-library-copy">
              <strong>{library.name}</strong>
              <small>Chats en chat/chats</small>
            </span>
          </div>
        ) : null}
      </aside>
    </>
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

export const ChatHistoryPanel = memo(ChatHistoryPanelComponent)
export const ChatHistoryPanelHeaderCompact = memo(ChatHistoryPanelHeaderCompactComponent)
ChatHistoryPanel.displayName = 'ChatHistoryPanel'
ChatHistoryPanelHeaderCompact.displayName = 'ChatHistoryPanelHeaderCompact'
