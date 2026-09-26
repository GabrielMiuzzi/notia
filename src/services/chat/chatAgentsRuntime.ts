import { callBackend } from '../transport'
import type { StoredChatDocument } from './chatDocumentStorage'

/*
 * Agents and dynamics of a chat. The backend lists the files under
 * `.agent/promps` and `.agent/dynamics` with their names and descriptions,
 * validates and saves each chat's settings and runs the agents' rounds.
 */

/** Most agents a chat can add; the backend enforces it. */
export const MAX_CHAT_AGENTS = 6

export interface ChatAgentOption {
  fileName: string
  name: string
  description: string
  /** Letters of the agent's avatar; empty for a dynamic. */
  initials: string
  /** The file can be read and is not empty. */
  valid: boolean
}

export interface ChatAgentCatalog {
  dynamics: ChatAgentOption[]
  agents: ChatAgentOption[]
}

/** Settings of a chat the context panel changes. */
export interface ChatSettings {
  toolsEnabled: boolean
  writeEnabled: boolean
  permanentContext: string
  dynamic: string | null
  agents: string[]
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  toolsEnabled: true,
  writeEnabled: true,
  permanentContext: '',
  dynamic: null,
  agents: [],
}

export const EMPTY_CHAT_AGENT_CATALOG: ChatAgentCatalog = { dynamics: [], agents: [] }

export function chatSettingsOf(document: StoredChatDocument): ChatSettings {
  return {
    toolsEnabled: document.toolsEnabled,
    writeEnabled: document.writeEnabled,
    permanentContext: document.permanentContext,
    dynamic: document.dynamic,
    agents: document.agents,
  }
}

export function loadChatAgentCatalog(libraryId: string): Promise<ChatAgentCatalog> {
  return callBackend<ChatAgentCatalog>('chat_agents_catalog', { payload: { libraryId } })
}

/** Saves the settings of an existing chat; returns the chat as saved. */
export function saveChatSettings(libraryId: string, filePath: string, settings: ChatSettings): Promise<StoredChatDocument> {
  return callBackend<StoredChatDocument>('backend_set_chat_settings', {
    payload: { libraryId, logicalPath: filePath, settings },
  })
}
