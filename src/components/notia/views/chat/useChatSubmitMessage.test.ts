import { beforeEach, describe, expect, it, vi } from 'vitest'

const reactMocks = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}))

const mocks = vi.hoisted(() => ({
  appendChatMessages: vi.fn(),
  loadChatDocument: vi.fn(),
  saveChatDocument: vi.fn(),
  buildChatMemoryWindow: vi.fn(),
  resolvePersistedChatTitle: vi.fn(),
  createChatDraftFile: vi.fn(),
  scheduleLongTermMemoriesForTurn: vi.fn(),
  scheduleAiChatTitle: vi.fn(),
  checkAiHealth: vi.fn(),
  startNotiaChatReply: vi.fn(),
  createChatScopedAgent: vi.fn(),
  loadAgentMemories: vi.fn(),
  startPerformanceMeasurement: vi.fn(),
  buildAutoCreateChatPayload: vi.fn(),
  normalizeChatTitle: vi.fn(),
  buildChatAttachmentPrompt: vi.fn(),
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
vi.mock('../../../../services/chat/chatDocumentStorage', () => ({
  appendChatMessages: mocks.appendChatMessages,
  loadChatDocument: mocks.loadChatDocument,
  saveChatDocument: mocks.saveChatDocument,
}))
vi.mock('../../../../services/chat/chatConversationRuntime', () => ({
  buildChatMemoryWindow: mocks.buildChatMemoryWindow,
  resolvePersistedChatTitle: mocks.resolvePersistedChatTitle,
}))
vi.mock('../../../../services/chat/chatSessionStorage', () => ({
  createChatDraftFile: mocks.createChatDraftFile,
}))
vi.mock('../../../../services/chat/chatLongTermMemorySync', () => ({
  scheduleLongTermMemoriesForTurn: mocks.scheduleLongTermMemoriesForTurn,
}))
vi.mock('../../../../services/chat/chatTitleSync', () => ({
  scheduleAiChatTitle: mocks.scheduleAiChatTitle,
}))
vi.mock('../../../../services/ai/aiRuntime', () => ({
  checkAiHealth: mocks.checkAiHealth,
}))
vi.mock('../../../../services/chat/notiaChatRuntime', () => ({
  startNotiaChatReply: mocks.startNotiaChatReply,
}))
vi.mock('../../../../services/chat/chatScopedAgentRuntime', () => ({
  createChatScopedAgent: mocks.createChatScopedAgent,
}))
vi.mock('../../../../services/ai/agentPromptRuntime', () => ({
  loadAgentMemories: mocks.loadAgentMemories,
}))
vi.mock('../../../../services/runtime/performanceBaseline', () => ({
  startPerformanceMeasurement: mocks.startPerformanceMeasurement,
}))
vi.mock('./useChatState', () => ({
  buildAutoCreateChatPayload: mocks.buildAutoCreateChatPayload,
  normalizeChatTitle: mocks.normalizeChatTitle,
}))
vi.mock('./chatImageAttachment', () => ({
  buildChatAttachmentPrompt: mocks.buildChatAttachmentPrompt,
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
    mocks.buildChatMemoryWindow.mockReturnValue([])
    mocks.resolvePersistedChatTitle.mockReturnValue('Chat')
    mocks.buildChatAttachmentPrompt.mockImplementation((value: string) => value)
    mocks.startPerformanceMeasurement.mockReturnValue({
      success: vi.fn(),
      error: vi.fn(),
      cancel: vi.fn(),
    })
    mocks.createChatScopedAgent.mockResolvedValue({ systemPrompt: 'prompt', tools: [], executeTool: vi.fn() })
    mocks.appendChatMessages.mockResolvedValue({ appended: true })
  })

  it('does not persist a late AI answer after the chat surface unmounts', async () => {
    let resolveReply!: (answer: string) => void
    const abort = vi.fn()
    mocks.startNotiaChatReply.mockReturnValue({
      abort,
      promise: new Promise<string>((resolve) => { resolveReply = resolve }),
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
      agentExecutionPlan: [],
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
      selectedImageAttachment: null,
      selectedFileContextMode: 'direct',
      showHistoryPanel: true,
      preferredContextScopeKey: null,
      persistTransientContext: false,
      hasTransientContext: false,
      markdownSelection: null,
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
      setSelectedImageAttachment: setState,
      setSelectedLibraryFilePaths: setState,
      setSelectedLibraryFileOptions: setState,
      setSelectedFileContextMode: setState,
      setPendingAutoCreatedChatFilePath: setState,
      setIsAttachmentMenuOpen: setState,
      setDialogMessage: setState,
      setIsSubmitting: setState,
    })

    const submitPromise = submitMessage('Mejorá la selección')
    await vi.waitFor(() => expect(mocks.startNotiaChatReply).toHaveBeenCalled())
    reactMocks.cleanups[0]?.()
    expect(abort).toHaveBeenCalledOnce()
    resolveReply('respuesta tardía')
    await submitPromise

    expect(mocks.appendChatMessages).not.toHaveBeenCalled()
    expect(mocks.saveChatDocument).not.toHaveBeenCalled()
    expect(mocks.scheduleAiChatTitle).not.toHaveBeenCalled()
    expect(mocks.scheduleLongTermMemoriesForTurn).not.toHaveBeenCalled()
  })
})
