import { beforeEach, describe, expect, it, vi } from 'vitest'

const reactMocks = vi.hoisted(() => ({
  cleanups: [] as Array<() => void>,
}))

const mocks = vi.hoisted(() => ({
  loadTelegramPendingAgentRequests: vi.fn(),
  loadTelegramUpdateCheckpoint: vi.fn(),
  mergeTelegramUpdateCheckpoint: vi.fn(),
  rememberTelegramUpdate: vi.fn(),
  saveTelegramPendingAgentRequests: vi.fn(),
  saveTelegramUpdateCheckpoint: vi.fn(),
  createChatScopedAgent: vi.fn(),
  runNotiaChatReply: vi.fn(),
  loadSelectedAgentPromptFileName: vi.fn(),
  loadAgentMemories: vi.fn(),
  loadLibraryFileOptions: vi.fn(),
  verifyFinanceSalaryPersistence: vi.fn(),
  answerTelegramCallback: vi.fn(),
  downloadTelegramPhoto: vi.fn(),
  editTelegramMessage: vi.fn(),
  extractTelegramPdf: vi.fn(),
  pollTelegramUpdates: vi.fn(),
  sendTelegramMessage: vi.fn(),
  transcribeTelegramAudio: vi.fn(),
  scheduleLongTermMemoriesForTurn: vi.fn(),
  notiaLog: vi.fn(),
  renderTelegramPdfPages: vi.fn(),
  buildTelegramProgressMessage: vi.fn(),
  createTelegramProgressState: vi.fn(),
  isCriticalTelegramProgressEvent: vi.fn(),
  reduceTelegramProgress: vi.fn(),
  shouldPublishTelegramProgress: vi.fn(),
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
vi.mock('../../../services/preferences/telegramSettingsStorage', () => ({
  loadTelegramPendingAgentRequests: mocks.loadTelegramPendingAgentRequests,
  loadTelegramUpdateCheckpoint: mocks.loadTelegramUpdateCheckpoint,
  mergeTelegramUpdateCheckpoint: mocks.mergeTelegramUpdateCheckpoint,
  rememberTelegramUpdate: mocks.rememberTelegramUpdate,
  saveTelegramPendingAgentRequests: mocks.saveTelegramPendingAgentRequests,
  saveTelegramUpdateCheckpoint: mocks.saveTelegramUpdateCheckpoint,
}))
vi.mock('../../../services/chat/chatScopedAgentRuntime', () => ({
  createChatScopedAgent: mocks.createChatScopedAgent,
}))
vi.mock('../../../services/chat/notiaChatRuntime', () => ({
  runNotiaChatReply: mocks.runNotiaChatReply,
}))
vi.mock('../../../services/ai/agentPromptRuntime', () => ({
  loadSelectedAgentPromptFileName: mocks.loadSelectedAgentPromptFileName,
  loadAgentMemories: mocks.loadAgentMemories,
}))
vi.mock('../../../services/chat/chatAttachmentRuntime', () => ({
  loadLibraryFileOptions: mocks.loadLibraryFileOptions,
}))
vi.mock('../../../modules/finance/services/financeService', () => ({
  verifyFinanceSalaryPersistence: mocks.verifyFinanceSalaryPersistence,
}))
vi.mock('../../../services/telegram/telegramRuntime', () => ({
  answerTelegramCallback: mocks.answerTelegramCallback,
  downloadTelegramPhoto: mocks.downloadTelegramPhoto,
  editTelegramMessage: mocks.editTelegramMessage,
  extractTelegramPdf: mocks.extractTelegramPdf,
  pollTelegramUpdates: mocks.pollTelegramUpdates,
  sendTelegramMessage: mocks.sendTelegramMessage,
  transcribeTelegramAudio: mocks.transcribeTelegramAudio,
}))
vi.mock('../../../services/chat/chatLongTermMemorySync', () => ({
  scheduleLongTermMemoriesForTurn: mocks.scheduleLongTermMemoriesForTurn,
}))
vi.mock('../../../services/runtime/notiaLogger', () => ({
  notiaLog: mocks.notiaLog,
  TELEGRAM_AI_DIAGNOSTIC_MODULE: 'telegram-ai',
}))
vi.mock('../../../services/telegram/telegramPdfRenderer', () => ({
  renderTelegramPdfPages: mocks.renderTelegramPdfPages,
}))
vi.mock('../../../services/telegram/telegramProgressRuntime', () => ({
  buildTelegramProgressMessage: mocks.buildTelegramProgressMessage,
  createTelegramProgressState: mocks.createTelegramProgressState,
  isCriticalTelegramProgressEvent: mocks.isCriticalTelegramProgressEvent,
  reduceTelegramProgress: mocks.reduceTelegramProgress,
  shouldPublishTelegramProgress: mocks.shouldPublishTelegramProgress,
}))

import { useTelegramAgentBridge } from './useTelegramAgentBridge'

describe('useTelegramAgentBridge integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reactMocks.cleanups = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout,
        clearTimeout,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        visibilityState: 'visible',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    mocks.loadTelegramPendingAgentRequests.mockReturnValue([])
    mocks.loadTelegramUpdateCheckpoint.mockReturnValue({ updateOffset: 0, processedUpdateIds: [] })
    mocks.mergeTelegramUpdateCheckpoint.mockImplementation((value) => value)
    mocks.rememberTelegramUpdate.mockImplementation((value) => value)
    mocks.saveTelegramPendingAgentRequests.mockReturnValue(true)
    mocks.loadSelectedAgentPromptFileName.mockReturnValue('default.md')
    mocks.loadAgentMemories.mockResolvedValue([])
    mocks.loadLibraryFileOptions.mockResolvedValue([])
    mocks.verifyFinanceSalaryPersistence.mockResolvedValue(undefined)
    mocks.sendTelegramMessage.mockResolvedValue(101)
    mocks.answerTelegramCallback.mockResolvedValue(undefined)
    mocks.createChatScopedAgent.mockResolvedValue({ systemPrompt: 'telegram', tools: [], executeTool: vi.fn() })
    mocks.runNotiaChatReply.mockResolvedValue('respuesta desde runtime comun')
    mocks.buildTelegramProgressMessage.mockReturnValue(null)
    mocks.createTelegramProgressState.mockReturnValue({ pendingCount: 0 })
    mocks.isCriticalTelegramProgressEvent.mockReturnValue(false)
    mocks.reduceTelegramProgress.mockImplementation((state) => state)
    mocks.shouldPublishTelegramProgress.mockReturnValue(false)
    mocks.pollTelegramUpdates.mockImplementationOnce(async () => [{
      updateId: 1,
      chatId: 42,
      user: { id: 7, displayName: 'Usuario', username: 'usuario' },
      text: 'resumime el proyecto',
    }]).mockImplementationOnce(() => new Promise<never>(() => undefined))
  })

  it('processes text through the common runtime, keeps memory scheduling and cleans up the polling surface', async () => {
    const onTelegramChange = vi.fn()
    const onLibraryChanged = vi.fn()
    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange,
      onLibraryChanged,
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prompt: 'resumime el proyecto', streamFinalResponse: false }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    )
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      'fixture-token',
      42,
      'respuesta desde runtime comun',
      [],
      'HTML',
    )
    await vi.waitFor(() => expect(mocks.scheduleLongTermMemoriesForTurn).toHaveBeenCalled())
    expect(onLibraryChanged).toHaveBeenCalledOnce()

    reactMocks.cleanups.at(-1)?.()
    expect(mocks.saveTelegramPendingAgentRequests).toHaveBeenCalled()
  })

  it('edits one progress message, keeps final response separate and persists an edit retry budget', async () => {
    mocks.createTelegramProgressState.mockReturnValue({ phase: 'preparing', pendingCount: 0 })
    mocks.reduceTelegramProgress.mockImplementation((state, event: { type: string }) => ({
      ...state,
      phase: event.type === 'completed' ? 'completed' : state.phase,
    }))
    mocks.buildTelegramProgressMessage.mockImplementation((state: { phase: string }) => `<b>${state.phase}</b>`)
    mocks.isCriticalTelegramProgressEvent.mockImplementation((event: { type: string }) => event.type === 'completed')
    mocks.shouldPublishTelegramProgress.mockReturnValue(true)
    mocks.editTelegramMessage.mockRejectedValueOnce(new Error('edit failed'))
    mocks.runNotiaChatReply.mockImplementation(async (
      _preferences: unknown,
      _input: unknown,
      options: { onAgentProgress?: (event: unknown) => void },
    ) => {
      options.onAgentProgress?.({ type: 'completed', rounds: 1 })
      return 'respuesta final separada'
    })

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium', editProgressMessage: true,
      } as never,
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    await vi.waitFor(() => expect(mocks.editTelegramMessage).toHaveBeenCalledWith(
      'fixture-token', 42, 101, '<b>completed</b>', [], 'HTML',
    ))
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      'fixture-token', 42, 'respuesta final separada', [], 'HTML',
    )
    expect(mocks.saveTelegramPendingAgentRequests.mock.calls.some((call) => (
      Array.isArray(call[1])
      && call[1].some((request: { progressMessageRetryCount?: number }) => request.progressMessageRetryCount === 1)
    ))).toBe(true)
    reactMocks.cleanups.at(-1)?.()
  })

  it('aborts an active Telegram request on cleanup and persists only its interrupted envelope', async () => {
    let resolveReply!: (answer: string) => void
    mocks.runNotiaChatReply.mockReturnValue(new Promise<string>((resolve) => { resolveReply = resolve }))

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    const options = mocks.runNotiaChatReply.mock.calls[0]?.[2] as { abortSignal: AbortSignal }
    reactMocks.cleanups.at(-1)?.()
    expect(options.abortSignal.aborted).toBe(true)
    expect(mocks.saveTelegramPendingAgentRequests).toHaveBeenCalled()
    resolveReply('respuesta que no debe enviarse')
  })

  it('passes an image through the Telegram multimodal path and the common runtime', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 2,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        photo: { fileId: 'photo-1', width: 1200, height: 800, fileSize: 2048 },
      }])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.downloadTelegramPhoto.mockResolvedValue({ fileId: 'photo-1', mimeType: 'image/jpeg', base64: 'base64-fixture' })

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        image: expect.objectContaining({ name: 'telegram-photo-1.jpg', base64: 'base64-fixture' }),
        maxRounds: 12,
      }),
      expect.anything(),
    )
    expect(mocks.downloadTelegramPhoto).toHaveBeenCalledWith('fixture-token', expect.objectContaining({ fileId: 'photo-1' }))
    reactMocks.cleanups.at(-1)?.()
  })

  it('transcribes Telegram audio before sending it through the common runtime', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 7,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        audio: { fileId: 'audio-1', duration: 12, mimeType: 'audio/ogg', fileSize: 4096 },
      }])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.transcribeTelegramAudio.mockResolvedValue('Revisá la introducción del documento')

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.transcribeTelegramAudio).toHaveBeenCalledWith(
      'fixture-token',
      expect.objectContaining({ fileId: 'audio-1', mimeType: 'audio/ogg' }),
    )
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prompt: expect.stringContaining('Revisá la introducción del documento'),
      }),
      expect.anything(),
    )
    expect(mocks.runNotiaChatReply.mock.calls[0]?.[1].prompt).toContain('fileId=audio-1')
    reactMocks.cleanups.at(-1)?.()
  })

  it('extracts a Telegram PDF and sends only the extracted/document reference context to the common runtime', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 8,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        document: { fileId: 'pdf-1', fileName: 'recibo.pdf', mimeType: 'application/pdf', fileSize: 8192 },
      }])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.extractTelegramPdf.mockResolvedValue({
      fileId: 'pdf-1', fileName: 'recibo.pdf', mimeType: 'application/pdf',
      extractedContent: 'Total impreso: 1200',
    })

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.extractTelegramPdf).toHaveBeenCalledWith(
      'fixture-token',
      expect.objectContaining({ fileId: 'pdf-1', fileName: 'recibo.pdf' }),
    )
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prompt: expect.stringContaining('Total impreso: 1200'),
        image: null,
      }),
      expect.anything(),
    )
    expect(mocks.runNotiaChatReply.mock.calls[0]?.[1].prompt).toContain('fileId=pdf-1')
    expect(JSON.stringify(mocks.runNotiaChatReply.mock.calls[0])).not.toContain('fixture-token')
    reactMocks.cleanups.at(-1)?.()
  })

  it('renders a scanned Telegram PDF as page images when extraction has no text', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 9,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        document: { fileId: 'pdf-scan-1', fileName: 'scan.pdf', mimeType: 'application/pdf' },
      }])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.extractTelegramPdf.mockResolvedValue({
      fileId: 'pdf-scan-1', fileName: 'scan.pdf', mimeType: 'application/pdf',
      extractedContent: '', base64: 'pdf-base64',
    })
    mocks.renderTelegramPdfPages.mockResolvedValue(['page-1', 'page-2'])

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.renderTelegramPdfPages).toHaveBeenCalledWith('pdf-base64')
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        image: { name: 'scan.pdf', mimeType: 'image/jpeg', base64: 'page-1', additionalBase64: ['page-2'] },
      }),
      expect.anything(),
    )
    reactMocks.cleanups.at(-1)?.()
  })

  it('keeps web search and a multi-step plan inside the common runtime with safe progress events', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 10,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        text: 'busca novedades publicas y prepara una nota',
      }])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.createChatScopedAgent.mockResolvedValue({
      systemPrompt: 'telegram', tools: [], executeTool: vi.fn().mockResolvedValue({
        ok: true, searchedQuery: 'novedades publicas', results: [{ title: 'Fuente', url: 'https://example.com' }],
      }),
    })
    mocks.runNotiaChatReply.mockImplementation(async (_preferences: unknown, input: {
      agent: { executeTool: (call: unknown, signal: AbortSignal) => Promise<unknown> }
      prompt: string
    }, options: { onAgentProgress?: (event: unknown) => void }) => {
      options.onAgentProgress?.({ requestId: 'telegram-request', type: 'plan-created', timestamp: 1, plan: {
        id: 'plan-private', title: 'Plan privado', status: 'in-progress', requiresApproval: true, approved: true,
        steps: [{ id: 'step-private', label: 'C:/private/nota.md', description: 'privado', dependsOn: [], status: 'in-progress', plannedToolName: 'search_web', risk: 'low', canRetry: true, operationId: null, resultSummary: null, error: null }],
      } })
      options.onAgentProgress?.({ requestId: 'telegram-request', type: 'step-started', timestamp: 2, planStepId: 'step-private', label: 'C:/private/nota.md' })
      await input.agent.executeTool({ function: { name: 'search_web', arguments: { query: 'novedades publicas' } } }, new AbortController().signal)
      options.onAgentProgress?.({ requestId: 'telegram-request', type: 'step-completed', timestamp: 3, planStepId: 'step-private', status: 'completed' })
      return 'Fuentes publicas listas.'
    })

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium', progressMode: 'detailed',
        showPlan: true, showReasoningSummary: true, editProgressMessage: true,
      } as never,
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.createChatScopedAgent).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: 'telegram-html' }))
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prompt: 'busca novedades publicas y prepara una nota' }),
      expect.objectContaining({ onAgentProgress: expect.any(Function) }),
    )
    expect(JSON.stringify(mocks.sendTelegramMessage.mock.calls)).not.toContain('plan-private')
    expect(JSON.stringify(mocks.sendTelegramMessage.mock.calls)).not.toContain('C:/private/nota.md')
    reactMocks.cleanups.at(-1)?.()
  })

  it('requires an explicit recovery command before resuming an interrupted request', async () => {
    mocks.loadTelegramPendingAgentRequests.mockReturnValue([{
      requestId: 'interrupted-1',
      text: 'continuá la revisión',
      actorUserId: 7,
      scope: 'library',
      attachment: null,
      status: 'interrupted',
      progressMessageId: 404,
      plan: { steps: [{ id: 'step-1', status: 'blocked' }] },
    }])
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 11,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        text: '/reanudar',
      }])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.runNotiaChatReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: 'interrupted-1', prompt: 'continuá la revisión' }),
      expect.anything(),
    )
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      'fixture-token', 42,
      expect.stringContaining('estado desconocido'),
    )
    expect(mocks.saveTelegramPendingAgentRequests).toHaveBeenCalled()
    reactMocks.cleanups.at(-1)?.()
  })

  it('serializes concurrent Telegram updates and starts the queued request only after the active one finishes', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([
        {
          updateId: 12,
          chatId: 42,
          user: { id: 7, displayName: 'Usuario', username: 'usuario' },
          text: 'primera solicitud',
        },
        {
          updateId: 13,
          chatId: 42,
          user: { id: 7, displayName: 'Usuario', username: 'usuario' },
          text: 'segunda solicitud',
        },
      ])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    let releaseFirst!: () => void
    const firstFinished = new Promise<void>((resolve) => { releaseFirst = resolve })
    let activeRequests = 0
    let maxConcurrentRequests = 0
    mocks.runNotiaChatReply.mockImplementation(async (_preferences: unknown, input: { prompt: string }) => {
      activeRequests += 1
      maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests)
      if (input.prompt === 'primera solicitud') await firstFinished
      activeRequests -= 1
      return `respuesta de ${input.prompt}`
    })

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalledTimes(1))
    expect(mocks.runNotiaChatReply.mock.calls[0]?.[1].prompt).toBe('primera solicitud')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.runNotiaChatReply).toHaveBeenCalledTimes(1)

    releaseFirst()
    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalledTimes(2))
    expect(mocks.runNotiaChatReply.mock.calls[1]?.[1].prompt).toBe('segunda solicitud')
    expect(maxConcurrentRequests).toBe(1)
    reactMocks.cleanups.at(-1)?.()
  })

  it('delivers a Telegram clarification choice back into the same agent request', async () => {
    mocks.pollTelegramUpdates.mockReset()
    let releaseAnswer!: (updates: Array<{ updateId: number; chatId: number; user: { id: number; displayName: string; username: string }; text: string }>) => void
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([{
        updateId: 3,
        chatId: 42,
        user: { id: 7, displayName: 'Usuario', username: 'usuario' },
        text: 'registrá el movimiento',
      }])
      .mockImplementationOnce(() => new Promise((resolve) => { releaseAnswer = resolve }))
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.createChatScopedAgent.mockImplementation(async (options: { requestClarification: (question: string, signal: AbortSignal, choices: string[]) => Promise<string> }) => ({
      systemPrompt: 'telegram',
      tools: [],
      executeTool: (_call: unknown, signal: AbortSignal) => options.requestClarification('Elegí una cuenta', signal, ['A', 'B']).then((answer) => ({ ok: true, answer })),
    }))
    mocks.runNotiaChatReply.mockImplementation(async (_preferences: unknown, input: { agent: { executeTool: (call: unknown, signal: AbortSignal) => Promise<unknown> } }, options: { abortSignal: AbortSignal }) => {
      const result = await input.agent.executeTool({ function: { name: 'request_user_clarification', arguments: {} } }, options.abortSignal)
      return `respuesta ${JSON.stringify(result)}`
    })

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.runNotiaChatReply).toHaveBeenCalled())
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      'fixture-token', 42, 'Elegí una cuenta',
      [{ label: 'A', data: 'choice:0' }, { label: 'B', data: 'choice:1' }], 'HTML',
    )
    releaseAnswer([{
      updateId: 4,
      chatId: 42,
      user: { id: 7, displayName: 'Usuario', username: 'usuario' },
      text: '2',
    }])
    await vi.waitFor(() => expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      'fixture-token', 42, expect.stringContaining('&quot;answer&quot;:&quot;B&quot;'), [], 'HTML',
    ))
    reactMocks.cleanups.at(-1)?.()
  })

  it('reports one failed request and can process the next retry without duplicating the first result', async () => {
    mocks.pollTelegramUpdates.mockReset()
    mocks.pollTelegramUpdates
      .mockResolvedValueOnce([
        {
          updateId: 5,
          chatId: 42,
          user: { id: 7, displayName: 'Usuario', username: 'usuario' },
          text: 'primer intento',
        },
        {
          updateId: 6,
          chatId: 42,
          user: { id: 7, displayName: 'Usuario', username: 'usuario' },
          text: 'reintento solicitado',
        },
      ])
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    mocks.runNotiaChatReply
      .mockRejectedValueOnce(new Error('fallo transitorio'))
      .mockResolvedValueOnce('respuesta del reintento')

    useTelegramAgentBridge({
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      telegram: {
        enabled: true,
        botToken: 'fixture-token',
        authorizedPeer: { chatId: 42, userId: 7, displayName: 'Usuario', username: 'usuario' },
        pendingPeer: null,
        updateOffset: 0,
        processedUpdateIds: [],
      },
      onTelegramChange: vi.fn(),
      onLibraryChanged: vi.fn(),
    })

    await vi.waitFor(() => expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      'fixture-token', 42, 'respuesta del reintento', [], 'HTML',
    ))
    expect(mocks.runNotiaChatReply).toHaveBeenCalledTimes(2)
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith('fixture-token', 42, 'fallo transitorio')
    reactMocks.cleanups.at(-1)?.()
  })
})
