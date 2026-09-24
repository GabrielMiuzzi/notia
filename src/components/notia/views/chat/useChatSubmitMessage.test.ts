import { beforeEach, describe, expect, it, vi } from 'vitest'

const reactMocks = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}))

const mocks = vi.hoisted(() => ({
  createChatDraftFile: vi.fn(),
  checkAiHealth: vi.fn(),
  startChatTurn: vi.fn(),
  subscribeChatTitles: vi.fn(),
  startPerformanceMeasurement: vi.fn(),
  buildAutoCreateChatPayload: vi.fn(),
  normalizeChatTitle: vi.fn(),
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: (effect: () => (() => void) | void) => {
      const cleanup = effect()
      if (cleanup) reactMocks.cleanups.push(cleanup)
    },
  }
})
vi.mock('../../../../services/chat/chatSessionStorage', () => ({
  createChatDraftFile: mocks.createChatDraftFile,
}))
vi.mock('../../../../services/ai/aiRuntime', () => ({
  checkAiHealth: mocks.checkAiHealth,
}))
vi.mock('../../../../services/chat/aiChatRuntime', () => ({
  startChatTurn: mocks.startChatTurn,
  subscribeChatTitles: mocks.subscribeChatTitles,
}))
vi.mock('../../../../services/runtime/performanceBaseline', () => ({
  startPerformanceMeasurement: mocks.startPerformanceMeasurement,
}))
vi.mock('./useChatState', () => ({
  buildAutoCreateChatPayload: mocks.buildAutoCreateChatPayload,
  normalizeChatTitle: mocks.normalizeChatTitle,
}))

import { useChatSubmitMessage } from './useChatSubmitMessage'

describe('useChatSubmitMessage lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reactMocks.cleanups = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() },
    })
    mocks.checkAiHealth.mockResolvedValue({ ok: true, message: '' })
    mocks.subscribeChatTitles.mockResolvedValue(() => undefined)
    mocks.startPerformanceMeasurement.mockReturnValue({
      success: vi.fn(),
      error: vi.fn(),
      cancel: vi.fn(),
    })
  })

  it('cancels the turn and ignores a late answer after the chat surface unmounts', async () => {
    let resolveReply!: (outcome: { answer: string; dataChanged: boolean }) => void
    const abort = vi.fn()
    mocks.startChatTurn.mockReturnValue({
      requestId: 'request-1',
      abort,
      promise: new Promise((resolve) => { resolveReply = resolve }),
    })

    const library = { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never
    const activeChatDocument = {
      title: 'Chat',
      longTermMemoryEnabled: false,
      contextMemoryEnabled: true,
      contextMemoryMessageCount: 10,
      contextScopeKey: null,
      selectedContextMode: 'direct' as const,
      selectedContextFiles: [],
      messages: [],
    }
    const setState = vi.fn()
    const { submitMessage } = useChatSubmitMessage({
      agentCorpusPaths: [],
      agentScope: 'document',
      agentPromptFileName: 'default.md',
      requestAgentClarification: vi.fn(),
      requestAgentConfirmation: vi.fn(),
      onAgentExecutionPlanChange: vi.fn(),
      requestAgentExecutionPlanApproval: vi.fn(),
      library,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      activeChatDocument,
      selectedChatFilePath: 'C:/vault/chat.md',
      effectiveSelectedContextPaths: [],
      effectiveSelectedContextMode: 'direct',
      selectedLibraryFilePaths: [],
      selectedLibraryFileOptions: [],
      selectedImageAttachments: [],
      selectedFileContextMode: 'direct',
      showHistoryPanel: true,
      preferredContextScopeKey: null,
      persistTransientContext: false,
      hasTransientContext: false,
      activeMarkdownSource: '# Borrador',
      workspaceSnapshot: null,
    }, {
      draft: '',
      setDraft: setState,
      isSubmitting: false,
      setStreamingThinking: setState,
      setStreamingAssistantMessage: setState,
      setOptimisticThreadMessages: setState,
      setSelectedChatFilePath: setState,
      setActiveChatDocument: setState,
      setChatTitleOverrides: setState,
      setSelectedImageAttachments: setState,
      setSelectedLibraryFilePaths: setState,
      setSelectedLibraryFileOptions: setState,
      setSelectedFileContextMode: setState,
      setPendingAutoCreatedChatFilePath: setState,
      setIsAttachmentMenuOpen: setState,
      setDialogMessage: setState,
      setIsSubmitting: setState,
    })

    const submitPromise = submitMessage('Mejorá la selección')
    await vi.waitFor(() => expect(mocks.startChatTurn).toHaveBeenCalled())
    const callsBeforeAnswer = setState.mock.calls.length
    reactMocks.cleanups[0]?.()
    expect(abort).toHaveBeenCalledOnce()
    resolveReply({ answer: 'respuesta tardía', dataChanged: false })
    await submitPromise

    expect(setState.mock.calls.length).toBe(callsBeforeAnswer)
  })

  it('sends the saved chat and the message; the backend picks the history', async () => {
    const attachment = {
      name: 'teoria.png',
      mimeType: 'image/png',
      base64: 'base64-fixture',
      kind: 'image' as const,
    }
    const activeChatDocument = {
      title: 'Chat',
      longTermMemoryEnabled: false,
      contextMemoryEnabled: true,
      contextMemoryMessageCount: 10,
      contextScopeKey: null,
      selectedContextMode: 'direct' as const,
      selectedContextFiles: [],
      messages: [
        { role: 'user' as const, content: 'Analiza esta teoria.', attachments: [attachment] },
        { role: 'assistant' as const, content: 'Voy a revisarla.' },
      ],
    }
    const setState = vi.fn()
    mocks.startChatTurn.mockReturnValue({
      requestId: 'request-2',
      abort: vi.fn(),
      promise: Promise.resolve({ answer: 'Listo.', dataChanged: false }),
    })

    const { submitMessage } = useChatSubmitMessage({
      agentCorpusPaths: [],
      agentScope: 'document',
      agentPromptFileName: 'default.md',
      requestAgentClarification: vi.fn(),
      requestAgentConfirmation: vi.fn(),
      onAgentExecutionPlanChange: vi.fn(),
      requestAgentExecutionPlanApproval: vi.fn(),
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      activeChatDocument,
      selectedChatFilePath: 'C:/vault/chat.md',
      effectiveSelectedContextPaths: [],
      effectiveSelectedContextMode: 'direct',
      selectedLibraryFilePaths: [],
      selectedLibraryFileOptions: [],
      selectedImageAttachments: [],
      selectedFileContextMode: 'direct',
      showHistoryPanel: true,
      preferredContextScopeKey: null,
      persistTransientContext: false,
      hasTransientContext: false,
      activeMarkdownSource: '# Borrador',
      workspaceSnapshot: null,
    }, {
      draft: '',
      setDraft: setState,
      isSubmitting: false,
      setStreamingThinking: setState,
      setStreamingAssistantMessage: setState,
      setOptimisticThreadMessages: setState,
      setSelectedChatFilePath: setState,
      setActiveChatDocument: setState,
      setChatTitleOverrides: setState,
      setSelectedImageAttachments: setState,
      setSelectedLibraryFilePaths: setState,
      setSelectedLibraryFileOptions: setState,
      setSelectedFileContextMode: setState,
      setPendingAutoCreatedChatFilePath: setState,
      setIsAttachmentMenuOpen: setState,
      setDialogMessage: setState,
      setIsSubmitting: setState,
    })

    await submitMessage('Hacelo')

    // The backend reads the chat and attaches the files of its history.
    expect(mocks.startChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'chat',
        message: 'Hacelo',
        scope: 'document',
        chat: { kind: 'saved', path: 'C:/vault/chat.md' },
      }),
      expect.anything(),
    )
  })
})
