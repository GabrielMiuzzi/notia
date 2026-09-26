import { callBackend } from '../transport'
import type { NotiaLibrary } from '../../types/notia'

/*
 * Chat history files are read, written and parsed by the Rust backend
 * (`chat_history.rs`, `backend-core::chat_history`), which also stores the
 * selected context files relative to the library.
 */

export interface StoredChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: StoredChatAttachment[]
  /** Agent that wrote an assistant message (its prompt file); absent for Notia. */
  agent?: string
}

export interface StoredChatAttachment {
  name: string
  mimeType: string
  base64: string
  additionalBase64?: string[]
  kind: 'image' | 'pdf' | 'text'
  extractedText?: string
  textContent?: string
  pageCount?: number
}

export interface ChatImageAttachmentPreview {
  name: string
  mimeType: string
  base64: string
  pageNumber?: number
}

export interface StoredChatDocument {
  title: string
  /** Whether the chat uses the agent memory (`memory.md`); chosen when it is created. */
  agentMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
  contextScopeKey: string | null
  selectedContextMode: 'direct' | 'index'
  selectedContextFiles: string[]
  /** Folders whose files, subfolders included, the chat uses as context. */
  selectedContextFolders: string[]
  /** Whether the agent may search the whole library. */
  libraryRagEnabled: boolean
  /** The agents may use tools. */
  toolsEnabled: boolean
  /** The agents may use tools that write; off keeps only reading tools. */
  writeEnabled: boolean
  /** Instructions every turn keeps. */
  permanentContext: string
  /** Dynamic under `.agent/dynamics` that guides the agents. */
  dynamic: string | null
  /** Agents (prompt files) that answer instead of Notia. */
  agents: string[]
  /** Kept at the top of the chat history. */
  pinned?: boolean
  messages: StoredChatMessage[]
}

function chatPayload(filePath: string, document: StoredChatDocument, library: NotiaLibrary) {
  return { payload: { libraryId: library.id, logicalPath: filePath, document } }
}

/** Raster images attached to a chat document, capped by the backend. */
export function loadChatImageAttachmentPreviews(source: string): Promise<ChatImageAttachmentPreview[]> {
  return callBackend<ChatImageAttachmentPreview[]>('backend_chat_image_previews', { payload: { source } })
}

export async function loadChatDocument(
  filePath: string,
  fallbackTitle: string,
  library: NotiaLibrary,
): Promise<StoredChatDocument> {
  return callBackend<StoredChatDocument>('backend_load_chat', {
    payload: { libraryId: library.id, logicalPath: filePath, fallbackTitle },
  })
}

export async function saveChatDocument(
  filePath: string,
  document: StoredChatDocument,
  library: NotiaLibrary,
): Promise<void> {
  await callBackend('backend_save_chat', chatPayload(filePath, document, library))
}

/** Group of the chat history, by the day of the chat's last activity. */
export type ChatHistoryGroup = 'pinned' | 'today' | 'yesterday' | 'thisWeek' | 'earlier'

export interface ChatListItem {
  /** Logical path, stable across platforms. */
  id: string
  /** Path of the chat as the explorer shows it. */
  filePath: string
  title: string
  /** Only when the list was asked with the device's clock. */
  group?: ChatHistoryGroup
  pinned: boolean
  /** Prompt file that answered last; `null` for Notia (`default.md`). */
  agent: string | null
}

/** Context a view asks its chat to keep. */
export interface ChatViewContext {
  scopeKey: string | null
  mode: 'direct' | 'index' | null
  files: string[]
}

/** Chats of the library, newest first, with their titles. */
export function listChats(libraryId: string): Promise<ChatListItem[]> {
  return callBackend<ChatListItem[]>('backend_list_chats', { payload: { libraryId } })
}

/** Chats grouped by the person's local day of last activity, pinned first. */
export function listChatHistory(libraryId: string, now: Date = new Date()): Promise<ChatListItem[]> {
  const clock = { nowMs: now.getTime(), utcOffsetMinutes: -now.getTimezoneOffset() }
  return callBackend<ChatListItem[]>('backend_list_chats', { payload: { libraryId, clock } })
}

export function setChatPinned(libraryId: string, filePath: string, pinned: boolean): Promise<void> {
  return callBackend<void>('backend_set_chat_pinned', { payload: { libraryId, logicalPath: filePath, pinned } })
}

export function renameChat(libraryId: string, filePath: string, title: string): Promise<StoredChatDocument> {
  return callBackend<StoredChatDocument>('backend_rename_chat', { payload: { libraryId, logicalPath: filePath, title } })
}

/** The chat that best fits a view's context (the open one wins a tie). */
export function matchChat(libraryId: string, context: ChatViewContext, selected: string | null): Promise<string | null> {
  return callBackend<string | null>('backend_match_chat', {
    payload: { libraryId, scopeKey: context.scopeKey, mode: context.mode, files: context.files, selected },
  })
}

/** Gives a chat the context of the view it is open in; returns the chat. */
export function setChatViewContext(libraryId: string, filePath: string, context: ChatViewContext): Promise<StoredChatDocument> {
  return callBackend<StoredChatDocument>('backend_set_chat_context', {
    payload: { libraryId, logicalPath: filePath, scopeKey: context.scopeKey, mode: context.mode, files: context.files },
  })
}
