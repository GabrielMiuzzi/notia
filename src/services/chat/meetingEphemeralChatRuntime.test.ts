import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMeetingEphemeralChatReply } from './meetingEphemeralChatRuntime'

const mocks = vi.hoisted(() => ({
  runGlobalAiChat: vi.fn(),
}))

vi.mock('./notiaChatRuntime', () => ({
  runGlobalAiChat: mocks.runGlobalAiChat,
  runNotiaChatReply: vi.fn(),
  createAppAiRequest: vi.fn((input: Record<string, unknown>) => ({ ...input, version: 1, source: { channel: 'app', appSurface: input.appSurface } })),
}))
vi.mock('../ai/agentPromptRuntime', () => ({
  loadSelectedAgentPromptFileName: vi.fn(async () => 'default.md'),
}))
vi.mock('../ai/workspaceAiSnapshotRuntime', () => ({
  buildWorkspaceAiSnapshot: vi.fn(() => ({ snapshotVersion: 1 })),
}))

// Meeting runs in the Rust runtime with channel `meeting`, no memory and no
// writes; the client only sends the transcript with the question.
describe('meetingEphemeralChatRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runGlobalAiChat.mockResolvedValue('respuesta')
  })

  it('pasa Meeting por la fachada común como sesión efímera', async () => {
    const library = { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never
    const controller = new AbortController()
    const onAgentProgress = vi.fn()
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
      onAgentProgress,
    })

    expect(answer).toBe('respuesta')
    expect(mocks.runGlobalAiChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agent: expect.objectContaining({ libraryId: 'library-1', promptName: 'default.md' }),
        previousMessages: [],
      }),
      expect.objectContaining({ abortSignal: controller.signal, onAgentProgress }),
    )
  })
})
