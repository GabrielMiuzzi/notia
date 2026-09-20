import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadLibraryFileOptions: vi.fn(),
  loadInlineFileAttachments: vi.fn(),
  loadAgentPrompt: vi.fn(),
  loadAgentRules: vi.fn(),
  searchOllamaWeb: vi.fn(),
  writeTextFile: vi.fn(),
  runFinanceAudit: vi.fn(),
  listFinanceAuditProposals: vi.fn(),
  getFinanceDashboard: vi.fn(),
  listAllFinanceTransactions: vi.fn(),
  listFinanceServices: vi.fn(),
  listFinanceServiceOccurrences: vi.fn(),
  saveFinanceServiceOccurrence: vi.fn(),
  saveFinanceSavingsExchange: vi.fn(),
  saveFinanceAuditProposal: vi.fn(),
}))

vi.mock('./chatAttachmentRuntime', () => ({
  loadLibraryFileOptions: mocks.loadLibraryFileOptions,
  loadInlineFileAttachments: mocks.loadInlineFileAttachments,
}))
vi.mock('../ai/agentPromptRuntime', async () => {
  const actual = await vi.importActual<typeof import('../ai/agentPromptRuntime')>('../ai/agentPromptRuntime')
  return {
    ...actual,
    loadAgentPrompt: mocks.loadAgentPrompt,
    loadAgentRules: mocks.loadAgentRules,
  }
})
vi.mock('../ai/webSearchRuntime', async () => {
  const actual = await vi.importActual<typeof import('../ai/webSearchRuntime')>('../ai/webSearchRuntime')
  return {
    ...actual,
    searchOllamaWeb: mocks.searchOllamaWeb,
  }
})
vi.mock('../files/filesystemEngine', () => ({
  writeTextFile: mocks.writeTextFile,
}))
vi.mock('../../modules/finance/services/financeService', () => ({
  runFinanceAudit: mocks.runFinanceAudit,
  listFinanceAuditProposals: mocks.listFinanceAuditProposals,
  getFinanceDashboard: mocks.getFinanceDashboard,
  listAllFinanceTransactions: mocks.listAllFinanceTransactions,
  listFinanceServices: mocks.listFinanceServices,
  listFinanceServiceOccurrences: mocks.listFinanceServiceOccurrences,
  saveFinanceServiceOccurrence: mocks.saveFinanceServiceOccurrence,
  saveFinanceSavingsExchange: mocks.saveFinanceSavingsExchange,
  saveFinanceAuditProposal: mocks.saveFinanceAuditProposal,
}))

import { buildChatAgentTools, createChatScopedAgent } from './chatScopedAgentRuntime'

describe('chatScopedAgentRuntime metadata search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadAgentPrompt.mockResolvedValue('prompt')
    mocks.loadAgentRules.mockResolvedValue('rules')
    mocks.loadLibraryFileOptions.mockResolvedValue([
      { path: 'C:/vault/proyecto.md', name: 'proyecto.md', relativePath: 'proyecto.md' },
      { path: 'C:/vault/notas/reunion.txt', name: 'reunion.txt', relativePath: 'notas/reunion.txt' },
      { path: 'C:/vault/archivo.md', name: 'archivo.md', relativePath: 'archivo.md' },
    ])
    mocks.loadInlineFileAttachments.mockImplementation(async (_library, paths) => paths.map((path: string) => ({
      path,
      name: path.split('/').pop(),
      content: path.endsWith('proyecto.md')
        ? '---\ntags: [producto, interno]\ntipo: guia\n---\nContenido privado.'
        : path.endsWith('reunion.txt')
          ? 'Notas de la reunion'
          : '---\ntags: [personal]\n---\nArchivo.',
    })))
    mocks.searchOllamaWeb.mockResolvedValue({
      searchedQuery: 'novedades de Rust',
      consistency: 'consistent',
      results: [{
        rank: 1,
        title: 'Rust release notes',
        url: 'https://www.rust-lang.org/',
        snippet: 'Public release notes.',
        sourceName: 'rust-lang.org',
        publishedAt: null,
        verification: 'unverified',
        verificationScore: 0,
      }],
    })
    mocks.writeTextFile.mockResolvedValue({ ok: true })
  })

  it('filters by tags/type and returns metadata without document bodies', async () => {
    const agent = await createChatScopedAgent({
      scope: 'library',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: [],
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })

    const result = await agent.executeTool({
      function: {
        name: 'search_library_documents',
        arguments: { query: 'producto', tags: ['interno'], type: 'markdown' },
      },
    }, new AbortController().signal) as { matches: Array<{ candidates: Array<{ title: string; metadata: { tags: string[]; type: string } }> }> }

    expect(result.matches[0]?.candidates).toEqual([
      expect.objectContaining({
        title: 'proyecto.md',
        metadata: { tags: ['producto', 'interno'], type: 'markdown', frontmatterKeys: ['tags', 'tipo'] },
      }),
    ])
    expect(JSON.stringify(result)).not.toContain('Contenido privado')
  })

  it('does not apply finance response validation to universal library requests by default', async () => {
    const createAgent = (validateFinanceResponses?: boolean) => createChatScopedAgent({
      scope: 'library',
      enableFinanceTools: true,
      ...(validateFinanceResponses === undefined ? {} : { validateFinanceResponses }),
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: [],
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })
    const answer = 'Listo. Registré el gasto de $5000.'

    const universalAgent = await createAgent(false)
    expect(universalAgent.validateFinalAnswer(answer)).toBeNull()

    const financeAgent = await createAgent(true)
    expect(financeAgent.validateFinalAnswer(answer)).toContain('No afirmes ni prometas')
  })

  it('limits Task Manager searches to the active board and excludes archived tickets by default', async () => {
    const taskPaths = [
      'C:/vault/task-mannager/equipo/activo.md',
      'C:/vault/task-mannager/finished/completada.md',
      'C:/vault/task-mannager/otro/otro.md',
    ]
    mocks.loadLibraryFileOptions.mockResolvedValue(taskPaths.map((path) => ({
      path,
      name: path.split('/').pop() ?? path,
      relativePath: path.replace('C:/vault/', ''),
    })))
    mocks.loadInlineFileAttachments.mockImplementation(async (_library, paths: string[]) => paths.map((path) => ({
      path,
      name: path.split('/').pop() ?? path,
      content: path.endsWith('/activo.md')
        ? '---\ntarea: Activa\ntablero: equipo\nestado: Pendiente\n---\nTrabajo de X'
        : path.endsWith('/completada.md')
          ? '---\ntarea: Completada\ntablero: equipo\nestado: Finalizada\n---\nTrabajo de X archivado'
          : '---\ntarea: Otro\ntablero: otro\nestado: Pendiente\n---\nTrabajo de X en otro tablero',
    })))

    const agent = await createChatScopedAgent({
      scope: 'task-manager',
      publishedScope: true,
      publishedBoardNames: ['equipo'],
      taskManagerScopeKey: 'task-manager:panel:equipo',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      // A fake client path must not narrow or widen the host-derived ticket universe.
      scopePaths: ['C:/vault/task-mannager/equipo/fake.md'],
      persistencePolicy: 'published-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })

    const result = await agent.executeTool({
      function: { name: 'search_task_context', arguments: { query: 'Trabajo de X' } },
    }, new AbortController().signal) as { tickets: Array<{ path: string }> }

    expect(result.tickets.map((ticket) => ticket.path)).toEqual(['C:/vault/task-mannager/equipo/activo.md'])

    const archivedResult = await agent.executeTool({
      function: { name: 'search_task_tickets', arguments: { states: ['Finalizada'], includeArchived: true } },
    }, new AbortController().signal) as { matches: Array<{ candidates: Array<{ logicalPath: string }> }> }

    expect(archivedResult.matches[0]?.candidates.map((candidate) => candidate.logicalPath)).toEqual(['task-mannager/finished/completada.md'])
  })

  it('keeps dirty active selection and authorization boundaries in workspace context', async () => {
    const agent = await createChatScopedAgent({
      scope: 'document',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: ['C:/vault/proyecto.md'],
      activeDocumentPath: 'C:/vault/proyecto.md',
      activeMarkdownSource: '# Borrador local',
      workspaceSnapshot: {
        snapshotVersion: 1,
        view: 'documents',
        scope: 'document',
        library: { id: 'library-1', name: 'Vault', path: 'C:/vault' },
        activeDocument: {
          path: 'C:/vault/proyecto.md', name: 'proyecto.md', kind: 'markdown',
          source: '# Borrador local', revision: 7, dirty: true,
        },
        activeDocumentRevision: 7,
        activeDocumentDirty: true,
        selection: { documentPath: 'C:/vault/proyecto.md', from: 0, to: 4, selectedText: '# Bor', blocks: [] },
        openTabs: [{ path: 'C:/vault/privado.md', name: 'privado.md', kind: 'markdown' }],
        capabilities: { canEdit: true },
      } as never,
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })

    const context = await agent.executeTool({
      function: { name: 'get_workspace_context', arguments: {} },
    }, new AbortController().signal) as { activeDocumentDirty: boolean; activeDocumentRevision: number; selection: { selectedText: string }; openTabs: Array<{ path: string }> }

    expect(context).toMatchObject({
      activeDocumentDirty: true,
      activeDocumentRevision: 7,
      selection: { selectedText: '# Bor' },
    })
    expect(context.openTabs).toEqual([{ path: 'C:/vault/privado.md', name: 'privado.md', kind: 'markdown' }])
  })

  it('rejects a mutation whose tool differs from the approved plan step', async () => {
    const agent = await createChatScopedAgent({
      scope: 'library',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: [],
      initialExecutionPlan: [{ id: 'step-1', label: 'Crear nota', status: 'pending', plannedToolName: 'create_library_note' }],
      initialExecutionPlanApproved: true,
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })

    await expect(agent.executeTool({
      function: { name: 'replace_library_document', arguments: { planStepId: 'step-1', documentId: 'doc-1', content: 'nuevo' } },
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: 'planned-tool-mismatch' })
  })

  it.each(['library', 'document', 'graph', 'task-manager'] as const)(
    'routes public web search through the common tool contract from %s',
    async (scope) => {
      const requestConfirmation = vi.fn().mockResolvedValue(true)
      const agent = await createChatScopedAgent({
        scope,
        library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
        aiPreferences: {
          ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
          thinkingEnabled: false, thinkingLevel: 'medium',
        },
        scopePaths: scope === 'document' ? ['C:/vault/proyecto.md'] : [],
        activeDocumentPath: scope === 'document' ? 'C:/vault/proyecto.md' : null,
        persistencePolicy: 'ephemeral-no-memory',
        requestClarification: vi.fn(),
         requestConfirmation,
      })

      await expect(agent.executeTool({
         function: { name: 'search_web', arguments: { query: 'novedades de Rust', maxResults: 5, domains: ['rust-lang.org'], freshness: 'week' } },
      }, new AbortController().signal)).resolves.toMatchObject({
        ok: true,
        searchedQuery: 'novedades de Rust',
        results: [expect.objectContaining({ verificationScore: 0 })],
      })

       expect(mocks.searchOllamaWeb).toHaveBeenCalledWith(
        expect.objectContaining({ ollamaUrl: 'https://ollama.com' }),
         expect.objectContaining({ query: 'novedades de Rust', queryIsSanitized: true, domains: ['rust-lang.org'], freshness: 'week' }),
         expect.anything(),
       )
       expect(requestConfirmation).not.toHaveBeenCalled()
      expect(JSON.stringify(mocks.searchOllamaWeb.mock.calls.at(-1))).not.toContain('Contenido privado')
    },
  )

  it('blocks a private web query at the common agent boundary before confirmation or provider access', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    const agent = await createChatScopedAgent({
      scope: 'document',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: ['C:/vault/proyecto.md'],
      activeDocumentPath: 'C:/vault/proyecto.md',
      activeMarkdownSource: 'Contenido privado del documento.',
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation,
    })

    await expect(agent.executeTool({
      function: {
        name: 'search_web',
        arguments: { query: 'lee mi documento privado API key=secret y busca novedades' },
      },
    }, new AbortController().signal)).resolves.toMatchObject({ ok: false, code: 'web-search-blocked' })

    expect(requestConfirmation).not.toHaveBeenCalled()
    expect(mocks.searchOllamaWeb).not.toHaveBeenCalled()
  })

  it('does not expose public web search to finance or published Task Manager sessions', () => {
    expect(buildChatAgentTools('finance').map((tool) => tool.function.name)).not.toContain('search_web')
    expect(buildChatAgentTools('task-manager', true).map((tool) => tool.function.name)).not.toContain('search_web')
  })

  it('rejects direct calls outside the finance scope catalog', async () => {
    const agent = await createChatScopedAgent({
      scope: 'finance',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [],
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })

    await expect(agent.executeTool({ function: { name: 'search_web', arguments: { query: 'publico' } } }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: 'scope-tool-required' })
    await expect(agent.executeTool({ function: { name: 'search_library_context', arguments: { query: 'privado' } } }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: 'scope-tool-required' })
  })

  it('projects a read-only catalog without mutation or plan tools', async () => {
    const agent = await createChatScopedAgent({
      scope: 'library',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [],
      persistencePolicy: 'ephemeral-no-memory',
      readOnly: true,
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn(),
    })
    const names = agent.tools.map((tool) => tool.function.name)
    expect(names).toContain('read_library_documents')
    expect(names).not.toContain('create_library_note')
    expect(names).not.toContain('set_agent_execution_plan')
  })

  it('keeps Telegram finance mutations to one confirmation and links a unique local card payment', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    const service = { id: 'service-movistar', name: 'Movistar', categoryId: 'cat', currency: 'ARS', expectedAmount: '82997', dueDay: 10, defaultAccountId: null, provider: null, modality: 'fixed', active: true }
    const transaction = { id: 'transaction-card', transactionType: 'expense', amount: '82997.00', currency: 'ARS', effectiveDate: '2026-08-19', accountId: 'card', categoryId: 'cat', description: 'MOVI STAR52928097 09/26', source: 'app', status: 'confirmed', serviceId: null }
    mocks.listFinanceServices.mockResolvedValue([service])
    mocks.listAllFinanceTransactions.mockResolvedValue([transaction])
    mocks.saveFinanceServiceOccurrence.mockResolvedValue({
      id: 'occurrence-september', serviceId: service.id, period: '2026-09', expectedAmount: '82997', paidAmount: '82997',
      effectiveDate: transaction.effectiveDate, status: 'current', transactionId: transaction.id, artifactId: null,
      sourceReference: null, rawSource: null, actorLibraryUserId: 'user-owner', source: 'telegram',
    })
    mocks.runFinanceAudit.mockResolvedValue({ run: { id: 'run-1', period: '2026-09', status: 'completed' }, proposals: [] })
    mocks.listFinanceAuditProposals.mockResolvedValue([])

    const agent = await createChatScopedAgent({
      scope: 'library', enableFinanceTools: true, responseFormat: 'telegram-html',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [], persistencePolicy: 'ephemeral-no-memory', requestClarification: vi.fn(), requestConfirmation,
    })

    expect(agent.tools.map((tool) => tool.function.name)).not.toContain('set_agent_execution_plan')
    expect(agent.systemPrompt).toContain('Nunca envíes dos solicitudes de confirmación consecutivas')
    await expect(agent.executeTool({ function: { name: 'create_finance_service_occurrence', arguments: {
      serviceId: service.id, period: '2026-09', expectedAmount: '82997', paidAmount: '82997',
    } } }, new AbortController().signal)).resolves.toMatchObject({ ok: true, changed: true, transactionId: transaction.id })
    expect(requestConfirmation).toHaveBeenCalledOnce()
    await expect(agent.executeTool({ function: { name: 'create_finance_category', arguments: { name: 'Servicios', kind: 'expense' } } }, new AbortController().signal))
      .resolves.toMatchObject({ ok: false, error: 'single-finance-mutation-per-turn' })
  })

  it('recovers a committed occurrence when native storage reports an equivalent amount format', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    const service = { id: 'service-movistar', name: 'Movistar', categoryId: 'cat', currency: 'ARS', expectedAmount: '82997', dueDay: 10, defaultAccountId: null, provider: null, modality: 'fixed', active: true }
    const transaction = { id: 'transaction-card', transactionType: 'expense', amount: '82997.00', currency: 'ARS', effectiveDate: '2026-08-19', accountId: 'card', categoryId: 'cat', description: 'MOVISTAR ARGENTINA 82997', source: 'credit_card_statement', status: 'confirmed', serviceId: null }
    mocks.listFinanceServices.mockResolvedValue([service])
    mocks.listAllFinanceTransactions.mockResolvedValue([transaction])
    mocks.saveFinanceServiceOccurrence.mockRejectedValue(new Error('post-commit synchronization failed'))
    mocks.listFinanceServiceOccurrences.mockResolvedValue([{
      id: 'occurrence-september', serviceId: service.id, period: '2026-09', expectedAmount: '82997.00', paidAmount: '82997.00',
      effectiveDate: transaction.effectiveDate, status: 'current', transactionId: transaction.id, artifactId: null,
      sourceReference: null, rawSource: null, actorLibraryUserId: 'user-owner', source: 'telegram',
    }])

    const agent = await createChatScopedAgent({
      scope: 'library', enableFinanceTools: true, responseFormat: 'telegram-html',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [], persistencePolicy: 'ephemeral-no-memory', requestClarification: vi.fn(), requestConfirmation,
    })

    await expect(agent.executeTool({ function: { name: 'create_finance_service_occurrence', arguments: {
      serviceId: service.id, period: '2026-09', expectedAmount: '82997', paidAmount: '82997',
    } } }, new AbortController().signal)).resolves.toMatchObject({ ok: true, changed: true, recoveredAfterStorageError: true })
  })

  it('requires an unambiguous reserve and account before confirming a Telegram savings exchange', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    mocks.getFinanceDashboard.mockResolvedValue({
      accounts: [{ id: 'account-ars', name: 'Digital', currency: 'ARS', active: true }],
      savings: [
        { id: 'reserve-1', name: 'Ahorro', currency: 'USD', active: true },
        { id: 'reserve-2', name: 'Ahorro', currency: 'USD', active: true },
      ],
    })

    const agent = await createChatScopedAgent({
      scope: 'finance', enableFinanceTools: true, responseFormat: 'telegram-html',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [], persistencePolicy: 'ephemeral-no-memory', requestClarification: vi.fn(), requestConfirmation,
    })

    await expect(agent.executeTool({ function: { name: 'create_finance_savings_exchange', arguments: {
      reserve: 'Ahorro', sourceAccount: 'Digital', sourceAmount: '10000', sourceCurrency: 'ARS', savingsAmount: '10', savingsCurrency: 'USD',
    } } }, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: 'finance-savings-reserve-ambiguous', requiresClarification: true })
    expect(requestConfirmation).not.toHaveBeenCalled()
    expect(mocks.saveFinanceSavingsExchange).not.toHaveBeenCalled()
  })

  it('confirms a resolved Telegram savings exchange once and reports the persisted result', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    const saved = {
      movement: { id: 'movement-1', reserveId: 'reserve-1', amount: '10', currency: 'USD' },
      transaction: { id: 'transaction-1', transactionType: 'expense', amount: '10000', currency: 'ARS' },
    }
    mocks.getFinanceDashboard.mockResolvedValue({
      accounts: [{ id: 'account-ars', name: 'Digital', currency: 'ARS', active: true }],
      savings: [{ id: 'reserve-1', name: 'Ahorro', currency: 'USD', active: true }],
    })
    mocks.saveFinanceSavingsExchange.mockResolvedValue(saved)

    const agent = await createChatScopedAgent({
      scope: 'finance', enableFinanceTools: true, responseFormat: 'telegram-html',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [], persistencePolicy: 'ephemeral-no-memory', requestClarification: vi.fn(), requestConfirmation,
    })

    await expect(agent.executeTool({ function: { name: 'create_finance_savings_exchange', arguments: {
      reserve: 'Ahorro', sourceAccount: 'Digital', sourceAmount: '10000', sourceCurrency: 'ARS', savingsAmount: '10', savingsCurrency: 'USD',
    } } }, new AbortController().signal)).resolves.toMatchObject({ ok: true, changed: true, movement: saved.movement, transaction: saved.transaction })
    expect(requestConfirmation).toHaveBeenCalledOnce()
    expect(mocks.saveFinanceSavingsExchange).toHaveBeenCalledOnce()
  })

  it('delegates monthly audit generation to the native runtime and returns native reconciliation proposals', async () => {
    const nativeProposal = { id: 'proposal-1', auditRunId: 'run-1', proposalType: 'service-card-reconciliation', period: '2026-09', status: 'pending' }
    mocks.runFinanceAudit.mockResolvedValue({ run: { id: 'run-1', period: '2026-09', status: 'completed' }, proposals: [nativeProposal] })
    mocks.listFinanceAuditProposals.mockResolvedValue([nativeProposal])
    const agent = await createChatScopedAgent({
      scope: 'finance',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: { ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: false, thinkingLevel: 'medium' },
      scopePaths: [],
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(false),
    })

    await expect(agent.executeTool({ function: { name: 'audit_finance_month', arguments: { period: '2026-09' } } }, new AbortController().signal)).resolves.toMatchObject({
      period: '2026-09', run: { period: '2026-09' }, proposals: [{ proposalType: 'service-card-reconciliation' }],
    })
    expect(mocks.runFinanceAudit).toHaveBeenCalledWith(expect.anything(), '2026-09', expect.stringContaining('audit:2026-09:'), undefined, expect.anything())
  })

  it('executes a selected document edit through preview, confirmation and native write', async () => {
    const source = '# Titulo\n\nTexto original'
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    const onActiveMarkdownDocumentChanged = vi.fn()
    const agent = await createChatScopedAgent({
      scope: 'document',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: ['C:/vault/proyecto.md'],
      activeDocumentPath: 'C:/vault/proyecto.md',
      activeMarkdownSource: source,
      markdownSelection: {
        documentPath: 'C:/vault/proyecto.md',
        from: 0,
        to: source.length,
        selectedText: source,
        blocks: [{ index: 1, type: 'paragraph', text: 'Texto original', from: 10, to: source.length }],
      },
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation,
      onActiveMarkdownDocumentChanged,
    })

    const preview = await agent.executeTool({
      function: {
        name: 'propose_document_edit',
        arguments: { operationId: 'op-selection', mode: 'replace', replacement: 'Texto mejorado' },
      },
    }, new AbortController().signal) as { ok: boolean; pending?: boolean; operationId?: string }
    expect(preview).toMatchObject({ ok: true, pending: true, operationId: 'op-selection' })
    expect(requestConfirmation).not.toHaveBeenCalled()

    await expect(agent.executeTool({
      function: { name: 'apply_document_edit', arguments: { operationId: 'op-selection' } },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      changed: true,
      operationId: 'op-selection',
    })
    expect(requestConfirmation).toHaveBeenCalledOnce()
    expect(mocks.writeTextFile).toHaveBeenCalledWith('C:/vault/proyecto.md', '# Titulo\n\nTexto mejorado', expect.anything())
    expect(onActiveMarkdownDocumentChanged).toHaveBeenCalledWith('C:/vault/proyecto.md', '# Titulo\n\nTexto mejorado')
  })

  it('uses the current active source instead of a stale workspace snapshot revision', async () => {
    const source = '# Titulo\n\nTexto original'
    const requestConfirmation = vi.fn().mockResolvedValue(true)
    const agent = await createChatScopedAgent({
      scope: 'document',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: ['C:/vault/proyecto.md'],
      activeDocumentPath: 'C:/vault/proyecto.md',
      activeMarkdownSource: source,
      getActiveMarkdownSource: () => source,
      workspaceSnapshot: { activeDocumentRevision: 123 } as never,
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation,
    })

    await expect(agent.executeTool({
      function: {
        name: 'insert_active_markdown_document',
        arguments: { content: 'Teoría de las imágenes' },
      },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      changed: true,
    })
    expect(requestConfirmation).toHaveBeenCalledOnce()
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      'C:/vault/proyecto.md',
      '# Titulo\n\nTexto original\n\nTeoría de las imágenes',
      expect.anything(),
    )
  })

  it('asks for an explicit target when a document request has no selection or has an ambiguous target', async () => {
    const makeAgent = (source: string, markdownSelection: null | { documentPath: string; from: number; to: number; selectedText: string; blocks: [] } = null) => createChatScopedAgent({
      scope: 'document',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: ['C:/vault/proyecto.md'],
      activeDocumentPath: 'C:/vault/proyecto.md',
      activeMarkdownSource: source,
      markdownSelection,
      persistencePolicy: 'ephemeral-no-memory',
      requestClarification: vi.fn(),
      requestConfirmation: vi.fn().mockResolvedValue(true),
    })

    const withoutSelection = await makeAgent('# Titulo\n\nTexto')
    await expect(withoutSelection.executeTool({
      function: { name: 'replace_active_markdown_document', arguments: { replacement: 'Nuevo texto' } },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: 'markdown-selection-required',
    })

    const ambiguous = await makeAgent('# Seccion\n\nUno\n\n# Seccion\n\nDos')
    await expect(ambiguous.executeTool({
      function: {
        name: 'propose_document_edit',
        arguments: { mode: 'replace', targetText: 'Seccion', replacement: 'Nueva seccion' },
      },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: 'target-ambiguous',
    })
    expect(mocks.writeTextFile).not.toHaveBeenCalled()
  })
})
