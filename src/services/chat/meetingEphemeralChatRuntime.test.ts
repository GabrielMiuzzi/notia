import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMeetingEphemeralChatReply } from './meetingEphemeralChatRuntime'

const mocks = vi.hoisted(() => ({
  startChatTurn: vi.fn(),
}))

vi.mock('./aiChatRuntime', () => ({
  startChatTurn: mocks.startChatTurn,
}))
vi.mock('../ai/agentPromptRuntime', () => ({
  loadSelectedAgentPromptFileName: vi.fn(async () => 'default.md'),
}))

// Meeting runs in the Rust runtime with channel `meeting`, no memory and no
// writes; the client only sends the transcript with the question.
describe('meetingEphemeralChatRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startChatTurn.mockReturnValue({
      requestId: 'request-1',
      abort: vi.fn(),
      promise: Promise.resolve({ answer: 'respuesta', dataChanged: false }),
    })
  })

  it('sends the question with the transcript as a Meeting turn', async () => {
    const library = { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never
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
      signal: new AbortController().signal,
      onAgentProgress,
    })

    expect(answer).toBe('respuesta')
    expect(mocks.startChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'library-1',
        mode: 'meeting',
        message: '¿Qué se acordó?',
        context: 'Se acordó revisar el documento.',
        promptName: 'default.md',
        chat: { kind: 'transient', messages: [] },
      }),
      expect.objectContaining({ onAgentProgress }),
    )
  })

  it('cancels the turn when the question is aborted', async () => {
    const abort = vi.fn()
    mocks.startChatTurn.mockReturnValue({ requestId: 'request-2', abort, promise: Promise.resolve({ answer: '', dataChanged: false }) })
    const controller = new AbortController()
    controller.abort()
    await runMeetingEphemeralChatReply({
      aiPreferences: { ollamaUrl: '', apiKey: '', selectedModel: '', thinkingEnabled: false, thinkingLevel: 'medium' },
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      transcript: '',
      prompt: 'Hola',
      previousMessages: [],
      signal: controller.signal,
    })
    expect(abort).toHaveBeenCalled()
  })
})
