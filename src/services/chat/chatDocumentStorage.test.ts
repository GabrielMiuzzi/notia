import { callBackend } from '../transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotiaLibrary } from '../../types/notia'
import { loadChatDocument, saveChatDocument, type StoredChatDocument } from './chatDocumentStorage'

vi.mock('../transport', () => ({ callBackend: vi.fn() }))

const library: NotiaLibrary = { id: 'library-1', name: 'Test', path: '/library' }

const document: StoredChatDocument = {
  title: 'Chat',
  agentMemoryEnabled: true,
  contextMemoryEnabled: true,
  contextMemoryMessageCount: 10,
  contextScopeKey: null,
  selectedContextMode: 'direct',
  selectedContextFiles: ['/library/notas/a.md'],
  selectedContextFolders: [],
  libraryRagEnabled: true,
  messages: [{ role: 'user', content: 'Hola' }],
}

// The chat format and the stored form of the context files are covered in
// Rust (`backend-core::chat_history`, `chat_history.rs`).
describe('chat document client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sends the chat as the interface shows it', async () => {
    vi.mocked(callBackend).mockResolvedValue(undefined)
    await saveChatDocument('/library/chat/chats/Chat-1.md', document, library)
    expect(callBackend).toHaveBeenCalledWith('backend_save_chat', {
      payload: { libraryId: 'library-1', logicalPath: '/library/chat/chats/Chat-1.md', document },
    })
  })

  it('returns the chat the backend reads', async () => {
    vi.mocked(callBackend).mockResolvedValue(document)
    await expect(loadChatDocument('/library/chat/chats/Chat-1.md', 'Chat', library)).resolves.toEqual(document)
  })
})
