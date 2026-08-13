import { describe, expect, it, vi } from 'vitest'
import {
  appendChatMessages,
  parseChatDocument,
  serializeChatDocument,
  type StoredChatDocument,
} from './chatDocumentStorage'
import type { NotiaLibrary } from '../../types/notia'
import * as libraryDocumentRuntime from '../libraries/libraryDocumentRuntime'

const MOCK_LIBRARY: NotiaLibrary = {
  id: 'lib-1',
  name: 'Test Library',
  path: '/test-library',
}

function buildMockDocument(): StoredChatDocument {
  return {
    title: 'Chat temporal 2026-01-01',
    longTermMemoryEnabled: true,
    contextMemoryEnabled: true,
    contextMemoryMessageCount: 10,
    contextScopeKey: null,
    selectedContextMode: 'direct',
    selectedContextFiles: [],
    messages: [],
  }
}

describe('appendChatMessages', () => {
  it('falls back to full rewrite when the file cannot be read', async () => {
    let writtenContent = ''
    vi.spyOn(libraryDocumentRuntime, 'readLibraryFileContent').mockResolvedValue({
      ok: false,
      content: '',
      error: 'No se pudo leer el archivo.',
    })
    vi.spyOn(libraryDocumentRuntime, 'writeLibraryFileContent').mockImplementation(async (_path, content) => {
      writtenContent = content
      return { ok: true }
    })

    const result = await appendChatMessages(
      '/test-library/.notia/chat/chats/Chat.md',
      {
        ...buildMockDocument(),
        messages: [
          { role: 'user', content: 'Hola' },
          { role: 'assistant', content: 'Hola, ¿en que puedo ayudarte?' },
        ],
      },
      MOCK_LIBRARY,
    )

    expect(result.appended).toBe(false)
    expect(writtenContent).toContain('# Chat temporal 2026-01-01')
    expect(writtenContent).toContain('<!-- NOTIA_CHAT_MESSAGE role:user -->')

    vi.restoreAllMocks()
  })

  it('appends messages to a valid existing file', async () => {
    const initialContent = serializeChatDocument({
      ...buildMockDocument(),
      title: 'Mi chat',
      messages: [{ role: 'user', content: 'Hola' }],
    })

    let writtenContent = ''
    vi.spyOn(libraryDocumentRuntime, 'readLibraryFileContent').mockResolvedValue({
      ok: true,
      content: initialContent,
    })
    vi.spyOn(libraryDocumentRuntime, 'writeLibraryFileContent').mockImplementation(async (_path, content) => {
      writtenContent = content
      return { ok: true }
    })

    const result = await appendChatMessages(
      '/test-library/.notia/chat/chats/Chat.md',
      {
        ...buildMockDocument(),
        title: 'Mi chat',
        messages: [
          { role: 'user', content: 'Hola' },
          { role: 'assistant', content: 'Respuesta' },
        ],
      },
      MOCK_LIBRARY,
    )

    expect(result.appended).toBe(true)
    expect(writtenContent).toContain('# Mi chat')
    expect(writtenContent).toContain('<!-- NOTIA_CHAT_MESSAGE role:user -->')
    expect(writtenContent).toContain('<!-- NOTIA_CHAT_MESSAGE role:assistant -->')
    expect(writtenContent).toContain('Respuesta')

    const parsed = parseChatDocument(writtenContent, 'Fallback')
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[1].content).toBe('Respuesta')

    vi.restoreAllMocks()
  })

  it('serializes and parses a document with appended messages consistently', () => {
    const document: StoredChatDocument = {
      ...buildMockDocument(),
      title: 'Mi chat',
      messages: [
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: 'Hola, ¿en que puedo ayudarte?' },
      ],
    }

    const serialized = serializeChatDocument(document)
    const parsed = parseChatDocument(serialized, 'Fallback')

    expect(parsed.title).toBe(document.title)
    expect(parsed.messages).toEqual(document.messages)
  })

  it('builds append content with correct markers', () => {
    const document: StoredChatDocument = {
      ...buildMockDocument(),
      title: 'Mi chat',
      messages: [
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: 'Respuesta' },
      ],
    }

    const serialized = serializeChatDocument(document)
    expect(serialized).toContain('<!-- NOTIA_CHAT_MESSAGE role:user -->')
    expect(serialized).toContain('<!-- NOTIA_CHAT_MESSAGE role:assistant -->')
    expect(serialized).toContain('# Mi chat')
  })
})
