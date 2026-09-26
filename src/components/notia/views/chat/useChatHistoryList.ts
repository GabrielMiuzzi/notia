import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotiaLibrary } from '../../../../types/notia'
import {
  listChatHistory,
  renameChat,
  setChatPinned,
  type ChatListItem,
} from '../../../../services/chat/chatDocumentStorage'

/**
 * The chat history of the side panel, read from the backend (which groups
 * and orders it) each time the list opens, and its pin and rename actions.
 */
export function useChatHistoryList(library: NotiaLibrary | null, isOpen: boolean) {
  const [items, setItems] = useState<ChatListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!library) {
      setItems([])
      return
    }
    const request = ++requestRef.current
    try {
      const next = await listChatHistory(library.id)
      if (request === requestRef.current) {
        setItems(next)
        setError(null)
      }
    } catch (reason) {
      if (request === requestRef.current) {
        setError(reason instanceof Error && reason.message ? reason.message : 'No se pudo leer el historial.')
      }
    }
  }, [library])

  useEffect(() => {
    if (!isOpen) return
    // Chats change from other views meanwhile; the list is read on opening.
    void refresh()
  }, [isOpen, refresh])

  const run = useCallback(async (action: () => Promise<unknown>, failure: string) => {
    try {
      await action()
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : failure)
    }
    await refresh()
  }, [refresh])

  const togglePin = useCallback((item: ChatListItem) => {
    if (!library) return Promise.resolve()
    return run(() => setChatPinned(library.id, item.filePath, !item.pinned), 'No se pudo fijar el chat.')
  }, [library, run])

  const rename = useCallback((item: ChatListItem, title: string) => {
    if (!library) return Promise.resolve()
    return run(() => renameChat(library.id, item.filePath, title), 'No se pudo renombrar el chat.')
  }, [library, run])

  return { items, error, refresh, togglePin, rename }
}
