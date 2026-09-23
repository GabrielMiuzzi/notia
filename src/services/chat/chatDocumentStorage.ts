import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { fromStoredLibraryPath, toStoredLibraryPath } from '../libraries/libraryPathMapping'
import { resolveLibraryDocumentLogicalPath } from '../libraries/libraryDocumentRuntime'

/*
 * Chat history files are read, written and parsed by the Rust backend
 * (`chat_history.rs`, `backend-core::chat_history`). The client only maps
 * the selected context files between visible and stored paths.
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

function chatLogicalPath(library: NotiaLibrary, filePath: string): string {
  const logicalPath = resolveLibraryDocumentLogicalPath(library.path, filePath)
  if (!logicalPath) throw new Error('El chat no pertenece a la biblioteca activa.')
  return logicalPath
}

function toRuntimeChatDocument(document: StoredChatDocument, library: NotiaLibrary): StoredChatDocument {
  return {
    ...document,
    selectedContextFiles: document.selectedContextFiles
      .map((pathValue) => fromStoredLibraryPath(library.path, pathValue))
      .filter(Boolean),
  }
}

function toPersistedChatDocument(document: StoredChatDocument, library: NotiaLibrary): StoredChatDocument {
  return {
    ...document,
    selectedContextFiles: document.selectedContextFiles
      .map((pathValue) => toStoredLibraryPath(library.path, pathValue))
      .filter(Boolean),
  }
}

function chatPayload(filePath: string, document: StoredChatDocument, library: NotiaLibrary) {
  return {
    payload: {
      libraryId: library.id,
      logicalPath: chatLogicalPath(library, filePath),
      document: toPersistedChatDocument(document, library),
    },
  }
}

/** Raster images attached to a chat document, capped by the backend. */
export function loadChatImageAttachmentPreviews(source: string): Promise<ChatImageAttachmentPreview[]> {
  return invoke<ChatImageAttachmentPreview[]>('backend_chat_image_previews', { payload: { source } })
}

export async function loadChatDocument(
  filePath: string,
  fallbackTitle: string,
  library: NotiaLibrary,
): Promise<StoredChatDocument> {
  const document = await invoke<StoredChatDocument>('backend_load_chat', {
    payload: { libraryId: library.id, logicalPath: chatLogicalPath(library, filePath), fallbackTitle },
  })
  return toRuntimeChatDocument(document, library)
}

export async function saveChatDocument(
  filePath: string,
  document: StoredChatDocument,
  library: NotiaLibrary,
): Promise<void> {
  await invoke('backend_save_chat', chatPayload(filePath, document, library))
}

/** Appends the last turn; the backend rewrites the file when it cannot. */
export function appendChatMessages(
  filePath: string,
  document: StoredChatDocument,
  library: NotiaLibrary,
): Promise<{ appended: boolean }> {
  return invoke<{ appended: boolean }>('backend_append_chat', chatPayload(filePath, document, library))
}
