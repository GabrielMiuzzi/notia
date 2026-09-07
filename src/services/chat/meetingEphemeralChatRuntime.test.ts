import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMeetingEphemeralChatReply } from './meetingEphemeralChatRuntime'

const mocks = vi.hoisted(() => ({
  loadLibraryFileOptions: vi.fn(),
  createChatScopedAgent: vi.fn(),
  runNotiaChatReply: vi.fn(),
}))

vi.mock('./chatAttachmentRuntime', () => ({
  loadLibraryFileOptions: mocks.loadLibraryFileOptions,
}))
vi.mock('./chatScopedAgentRuntime', () => ({
  createChatScopedAgent: mocks.createChatScopedAgent,
}))
vi.mock('./notiaChatRuntime', () => ({
  runNotiaChatReply: mocks.runNotiaChatReply,
}))
vi.mock('../ai/agentPromptRuntime', () => ({
  loadSelectedAgentPromptFileName: vi.fn(() => 'default.md'),
}))
vi.mock('../ai/workspaceAiSnapshotRuntime', () => ({
  buildWorkspaceAiSnapshot: vi.fn(() => ({ snapshotVersion: 1 })),
}))

describe('meetingEphemeralChatRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadLibraryFileOptions.mockResolvedValue([
      { path: 'C:/vault/meeting.md', name: 'meeting.md', relativePath: 'meeting.md' },
    ])
    mocks.createChatScopedAgent.mockResolvedValue({ systemPrompt: 'meeting', tools: [], executeTool: vi.fn() })
    mocks.runNotiaChatReply.mockResolvedValue('respuesta')
  })

  it('pasa Meeting por la fachada común como sesión efímera y de solo lectura', async () => {
    const library = { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never
    const controller = new AbortController()
    const answer = await runMeetingEphemeralChatReply({
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434',
        apiKey: '',
        selectedModel: 'qwen3:test',
        thinkingEnabled: false,
        thinkingLevel: 'medium',
      },
      library,
      transcript: 'Se acordó revisar el documento.',
      prompt: '¿Qué se acordó?',
      previousMessages: [],
      signal: controller.signal,
    })

    expect(answer).toBe('respuesta')
    expect(mocks.createChatScopedAgent).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'library',
      persistencePolicy: 'ephemeral-no-memory',
      readOnly: true,
      scopePaths: ['C:/vault/meeting.md'],
    }))
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agent: expect.anything(),
        prompt: expect.stringContaining('Se acordó revisar el documento.'),
        previousMessages: [],
      }),
      expect.objectContaining({ abortSignal: controller.signal }),
    )
  })
})
