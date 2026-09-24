import { useEffect, useState } from 'react'
import type { NotiaFileNode } from '../../../types/notia'
import { listChats, type ChatListItem } from '../../../services/chat/chatDocumentStorage'

interface UseRightPanelChatFilesParams {
  libraryId: string | undefined
  activeWorkspaceView: string
  isRightChatPanelOpen: boolean
  /** The explorer tree; a new tree means the chat folder may have changed. */
  treeNodes: NotiaFileNode[]
}

const NO_CHATS: ChatListItem[] = []

/**
 * Chats of the library while a chat view is open. The backend lists them,
 * newest first, with their titles.
 */
export function useRightPanelChatFiles({
  libraryId,
  activeWorkspaceView,
  isRightChatPanelOpen,
  treeNodes,
}: UseRightPanelChatFilesParams): ChatListItem[] {
  const [chats, setChats] = useState<{ libraryId: string; items: ChatListItem[] } | null>(null)
  const enabled = Boolean(libraryId) && (activeWorkspaceView === 'chat' || isRightChatPanelOpen)

  useEffect(() => {
    if (!libraryId || !enabled) return
    let current = true
    void listChats(libraryId)
      .then((items) => { if (current) setChats({ libraryId, items }) })
      .catch(() => { if (current) setChats({ libraryId, items: NO_CHATS }) })
    return () => { current = false }
  }, [enabled, libraryId, treeNodes])

  return enabled && chats && chats.libraryId === libraryId ? chats.items : NO_CHATS
}
