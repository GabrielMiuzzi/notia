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
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
  contextScopeKey: string | null
  selectedContextMode: 'direct' | 'index'
  selectedContextFiles: string[]
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

export interface ChatListItem {
  /** Logical path, stable across platforms. */
  id: string
  /** Path of the chat as the explorer shows it. */
  filePath: string
  title: string
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
