import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runGlobalAiChat: vi.fn(),
}))

vi.mock('../../../services/chat/notiaChatRuntime', () => ({
  runGlobalAiChat: mocks.runGlobalAiChat,
  createAppAiRequest: vi.fn(),
}))

import { runPublishedTaskManagerHostChatReply } from './publishedTaskManagerChatRuntime'

// The published scope (boards, tools, no memory) is enforced by the Rust
// runtime from the request context; the client only sends the request.
describe('runPublishedTaskManagerChatReply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends a published-board request without memory through the backend facade', async () => {
    mocks.runGlobalAiChat.mockResolvedValue('respuesta')
    const signal = new AbortController().signal
    const onAgentProgress = vi.fn()
    const aiPreferences = {
      ollamaUrl: 'https://127.0.0.1:1', apiKey: '', selectedModel: 'qwen3',
      thinkingEnabled: true, thinkingLevel: 'medium' as const,
    }
    await expect(runPublishedTaskManagerHostChatReply({
      aiPreferences,
      library: { id: 'published', name: 'Publicada', path: 'C:/Vault' },
      taskManagerScopeKey: 'task-manager:panel:equipo',
      scopePaths: ['C:/Vault/task-mannager/equipo/a.md'],
      publishedBoardNames: ['equipo'],
      prompt: 'Move el ticket',
      previousMessages: [],
      signal,
      onAgentProgress,
    })).resolves.toBe('respuesta')

    expect(mocks.runGlobalAiChat).toHaveBeenCalledWith(aiPreferences, expect.objectContaining({
      agent: expect.objectContaining({ libraryId: 'published' }),
      request: expect.objectContaining({
        prompt: 'Move el ticket',
        requestedScope: 'published-task-manager',
        persistencePolicy: 'published-no-memory',
      }),
    }), expect.objectContaining({ abortSignal: signal, onAgentProgress }))
  })
})
