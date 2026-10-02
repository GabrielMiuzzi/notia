import { useState } from 'react'
import { BookOpen, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { ChatListItem } from '../../../../services/chat/chatDocumentStorage'
import { HISTORY_GROUP_LABELS, HISTORY_GROUP_ORDER } from './chatContextText'
import { closeOnEscape, usePhoneSurfaceFocus } from './chatPhoneSurface'
import { useChatHistoryList } from './useChatHistoryList'

/**
 * History drawer of the Chat IA phone layout. The backend groups the chats
 * by day of last activity and gives each one its preview line.
 */
export function ChatPhoneHistoryDrawer({
  library,
  selectedChatFilePath,
  hiddenChatPaths,
  onPickChat,
  onNewChat,
  onOpenChatOptions,
  onClose,
}: {
  library: NotiaLibrary | null
  selectedChatFilePath: string | null
  /** Chats deleted in this session, gone before the list is read again. */
  hiddenChatPaths: string[]
  onPickChat: (chat: ChatListItem) => void
  onNewChat: () => void
  /** Opens the chat's options (delete) under the button that asked for them. */
  onOpenChatOptions: (chat: ChatListItem, anchor: DOMRect) => void
  onClose: () => void
}) {
  const drawerRef = usePhoneSurfaceFocus<HTMLElement>()
  const [query, setQuery] = useState('')
  const history = useChatHistoryList(library, true)
  const normalizedQuery = query.trim().toLowerCase()
  const visible = (history.items ?? []).filter((item) => !hiddenChatPaths.includes(item.filePath)
    && (!normalizedQuery || item.title.toLowerCase().includes(normalizedQuery)))
  const groups = HISTORY_GROUP_ORDER
    .map((group) => ({ group, items: visible.filter((item) => (item.group ?? 'earlier') === group) }))
    .filter((entry) => entry.items.length > 0)

  return (
    <div className="notia-chat-phone-layer" onKeyDown={closeOnEscape(onClose)}>
      <div className="notia-chat-phone-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        ref={drawerRef}
        className="notia-chat-phone-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Historial de chats"
        tabIndex={-1}
      >
        <div className="notia-chat-phone-drawer-head">
          <h2>Chats</h2>
          <button type="button" className="notia-chat-phone-icon notia-chat-phone-icon--muted" aria-label="Cerrar historial" onClick={onClose}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="notia-chat-phone-new" onClick={onNewChat} disabled={!library}>
          <Plus size={17} strokeWidth={2.2} aria-hidden="true" />
          Nuevo chat
        </button>
        <label className="notia-chat-phone-search">
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar chats"
            placeholder="Buscar chats"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="notia-chat-phone-drawer-list">
          {history.error ? <p className="notia-chat-phone-hint" role="alert">{history.error}</p> : null}
          {history.items === null && !history.error ? <p className="notia-chat-phone-hint">Cargando…</p> : null}
          {groups.map(({ group, items }) => (
            <div key={group} className="notia-chat-phone-drawer-group" role="group" aria-label={HISTORY_GROUP_LABELS[group]}>
              <span className="notia-chat-section-label">{HISTORY_GROUP_LABELS[group]}</span>
              {items.map((item) => {
                const isCurrent = item.filePath === selectedChatFilePath
                return (
                  <div key={item.id} className={`notia-chat-phone-chat${isCurrent ? ' is-current' : ''}`}>
                    <button
                      type="button"
                      className="notia-chat-phone-chat-open"
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => onPickChat(item)}
                    >
                      <span className="notia-chat-phone-chat-title">{item.title}</span>
                      {item.preview ? <span className="notia-chat-phone-chat-preview">{item.preview}</span> : null}
                    </button>
                    <button
                      type="button"
                      className="notia-chat-phone-chat-more"
                      aria-label={`Opciones de ${item.title}`}
                      onClick={(event) => onOpenChatOptions(item, event.currentTarget.getBoundingClientRect())}
                    >
                      <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
          {history.items !== null && groups.length === 0 ? (
            <p className="notia-chat-phone-hint">
              {normalizedQuery ? 'Ningún chat coincide con la búsqueda.' : 'No hay archivos de chat en chat/chats.'}
            </p>
          ) : null}
        </div>
        {library ? (
          <div className="notia-chat-phone-drawer-library">
            <span className="notia-chat-phone-drawer-library-icon" aria-hidden="true">
              <BookOpen size={18} strokeWidth={1.75} />
            </span>
            <span className="notia-chat-phone-drawer-library-copy">
              <strong>{library.name}</strong>
              <small>Chats en chat/chats</small>
            </span>
          </div>
        ) : null}
      </aside>
    </div>
  )
}
