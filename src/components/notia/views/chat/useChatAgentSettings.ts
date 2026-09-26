import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NotiaLibrary } from '../../../../types/notia'
import type { StoredChatDocument } from '../../../../services/chat/chatDocumentStorage'
import {
  chatSettingsOf,
  DEFAULT_CHAT_SETTINGS,
  EMPTY_CHAT_AGENT_CATALOG,
  loadChatAgentCatalog,
  saveChatSettings,
  type ChatAgentCatalog,
  type ChatSettings,
} from '../../../../services/chat/chatAgentsRuntime'

/** How an agent looks in the conversation. */
export interface ChatAgentLook {
  name: string
  initials: string
  /** Position of its color in the palette of agents. */
  colorIndex: number
}

const AGENT_COLOR_COUNT = 6

interface UseChatAgentSettingsInput {
  library: NotiaLibrary | null
  selectedChatFilePath: string | null
  activeChatDocument: StoredChatDocument | null
  setActiveChatDocument: React.Dispatch<React.SetStateAction<StoredChatDocument | null>>
}

function withSettings(document: StoredChatDocument, settings: ChatSettings): StoredChatDocument {
  return { ...document, ...settings }
}

/**
 * Permissions, permanent context, dynamic and agents of the chat in the
 * view. A new chat keeps them here until it is created; an existing chat
 * saves each change through the backend, which validates it.
 */
export function useChatAgentSettings({
  library,
  selectedChatFilePath,
  activeChatDocument,
  setActiveChatDocument,
}: UseChatAgentSettingsInput) {
  const [catalog, setCatalog] = useState<ChatAgentCatalog>(EMPTY_CHAT_AGENT_CATALOG)
  const [newChatSettings, setNewChatSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  useEffect(() => {
    if (!library) {
      setCatalog(EMPTY_CHAT_AGENT_CATALOG)
      return undefined
    }
    let current = true
    // Agents and dynamics are library files the person may edit meanwhile.
    const refresh = () => {
      void loadChatAgentCatalog(library.id)
        .then((next) => { if (current) setCatalog(next) })
        .catch(() => { if (current) setCatalog(EMPTY_CHAT_AGENT_CATALOG) })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      current = false
      window.removeEventListener('focus', refresh)
    }
  }, [library])

  const existingChat = Boolean(selectedChatFilePath && activeChatDocument)
  const settings = existingChat && activeChatDocument ? chatSettingsOf(activeChatDocument) : newChatSettings

  const updateSettings = useCallback(async (next: ChatSettings) => {
    setSettingsError(null)
    if (!selectedChatFilePath || !library || !activeChatDocument) {
      setNewChatSettings(next)
      return
    }
    const previous = chatSettingsOf(activeChatDocument)
    setActiveChatDocument((current) => (current ? withSettings(current, next) : current))
    try {
      const saved = await saveChatSettings(library.id, selectedChatFilePath, next)
      // Only the settings: the messages on screen may be ahead of the file.
      setActiveChatDocument((current) => (current ? withSettings(current, chatSettingsOf(saved)) : current))
    } catch (error) {
      setActiveChatDocument((current) => (current ? withSettings(current, previous) : current))
      setSettingsError(error instanceof Error && error.message ? error.message : 'No se pudo guardar la configuración del chat.')
    }
  }, [activeChatDocument, library, selectedChatFilePath, setActiveChatDocument])

  const agentLooks = useMemo(() => {
    const looks: Record<string, ChatAgentLook> = {}
    catalog.agents.forEach((agent, index) => {
      const position = settings.agents.indexOf(agent.fileName)
      looks[agent.fileName] = {
        name: agent.name,
        initials: agent.initials,
        colorIndex: (position >= 0 ? position : index) % AGENT_COLOR_COUNT,
      }
    })
    return looks
  }, [catalog.agents, settings.agents])

  return {
    catalog,
    settings,
    /** Settings a chat created by the next send takes. */
    newChatSettings,
    updateSettings,
    agentLooks,
    settingsError,
    dismissSettingsError: () => setSettingsError(null),
  }
}
