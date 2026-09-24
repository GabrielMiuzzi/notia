import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startChatTurn: vi.fn(),
}))

vi.mock('../../../services/chat/aiChatRuntime', () => ({
  startChatTurn: mocks.startChatTurn,
}))

import { runPublishedTaskManagerHostChatReply } from './publishedTaskManagerChatRuntime'

// The published scope (boards, tools, no memory) is enforced by the Rust
// runtime from the turn mode; the client only sends the question.
describe('runPublishedTaskManagerHostChatReply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a published turn for the asking library user', async () => {
    mocks.startChatTurn.mockReturnValue({
      requestId: 'request-1',
      abort: vi.fn(),
      promise: Promise.resolve({ answer: 'respuesta', dataChanged: false }),
    })
    const onAgentProgress = vi.fn()
    await expect(runPublishedTaskManagerHostChatReply({
      aiPreferences: {
        ollamaUrl: 'https://127.0.0.1:1', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: true, thinkingLevel: 'medium' as const,
      },
      library: { id: 'published', name: 'Publicada', path: 'C:/Vault' },
      libraryUserId: 'user-ana',
      prompt: 'Move el ticket',
      previousMessages: [{ role: 'user', content: 'Hola' }],
      signal: new AbortController().signal,
      onAgentProgress,
    })).resolves.toBe('respuesta')

    expect(mocks.startChatTurn).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'published',
      mode: 'published',
      message: 'Move el ticket',
      libraryUserId: 'user-ana',
      chat: { kind: 'transient', messages: [{ role: 'user', content: 'Hola' }] },
    }), expect.objectContaining({ onAgentProgress }))
  })
})
