import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createChatScopedAgent: vi.fn(),
  runNotiaChatReply: vi.fn(),
}))

vi.mock('../../../services/chat/chatScopedAgentRuntime', () => ({
  createChatScopedAgent: mocks.createChatScopedAgent,
}))
vi.mock('../../../services/chat/notiaChatRuntime', () => ({
  runNotiaChatReply: mocks.runNotiaChatReply,
}))

import { runPublishedTaskManagerChatReply } from './publishedTaskManagerChatRuntime'

describe('runPublishedTaskManagerChatReply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the common Notia runtime with a strict published-board scope', async () => {
    const agent = { systemPrompt: 'prompt', tools: [], executeTool: vi.fn() }
    mocks.createChatScopedAgent.mockResolvedValue(agent)
    mocks.runNotiaChatReply.mockResolvedValue('respuesta')
    const signal = new AbortController().signal
    const aiPreferences = {
      ollamaUrl: 'https://127.0.0.1:1', apiKey: '', selectedModel: 'qwen3',
      thinkingEnabled: true, thinkingLevel: 'medium' as const,
    }

    await expect(runPublishedTaskManagerChatReply({
      aiPreferences,
      library: { id: 'published', name: 'Publicada', path: 'C:/Vault' },
      scopePaths: ['C:/Vault/task-mannager/equipo/a.md'],
      prompt: 'Move el ticket',
      previousMessages: [],
      signal,
    })).resolves.toBe('respuesta')

    expect(mocks.createChatScopedAgent).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'task-manager',
      publishedScope: true,
      scopePaths: ['C:/Vault/task-mannager/equipo/a.md'],
    }))
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(aiPreferences, expect.objectContaining({
      agent,
      prompt: 'Move el ticket',
      streamFinalResponse: true,
    }), expect.objectContaining({ abortSignal: signal }))
  })
})
