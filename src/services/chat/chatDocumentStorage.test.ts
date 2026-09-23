import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { appendChatMessages, loadChatDocument, type StoredChatDocument } from './chatDocumentStorage'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const library: NotiaLibrary = { id: 'library-1', name: 'Test', path: '/library' }

const document: StoredChatDocument = {
  title: 'Chat',
  longTermMemoryEnabled: true,
  contextMemoryEnabled: true,
  contextMemoryMessageCount: 10,
  contextScopeKey: null,
  selectedContextMode: 'direct',
  selectedContextFiles: ['/library/notas/a.md'],
  messages: [{ role: 'user', content: 'Hola' }],
}

// The chat format (parse, serialize, append and image previews) is covered in
// Rust (`backend-core::chat_history`).
describe('chat document client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('sends logical paths and stored context files to the backend', async () => {
    vi.mocked(invoke).mockResolvedValue({ appended: true })
    await expect(appendChatMessages('/library/chat/chats/Chat-1.md', document, library)).resolves.toEqual({ appended: true })
    expect(invoke).toHaveBeenCalledWith('backend_append_chat', {
      payload: {
        libraryId: 'library-1',
        logicalPath: 'chat/chats/Chat-1.md',
        document: { ...document, selectedContextFiles: ['notas/a.md'] },
      },
    })
  })

  it('maps stored context files back to visible paths', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...document, selectedContextFiles: ['notas/a.md'] })
    const loaded = await loadChatDocument('/library/chat/chats/Chat-1.md', 'Chat', library)
    expect(loaded.selectedContextFiles).toEqual(['/library/notas/a.md'])
  })
})
