import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadLibraryFileOptions: vi.fn(),
  loadInlineFileAttachments: vi.fn(),
  loadAgentPrompt: vi.fn(),
  loadAgentRules: vi.fn(),
  searchOllamaWeb: vi.fn(),
  writeTextFile: vi.fn(),
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

  it('limits Task Manager searches to the active board and excludes archived tickets by default', async () => {
    const taskPaths = [
      'C:/vault/task-mannager/equipo/activo.md',
      'C:/vault/task-mannager/finished/completada.md',
      'C:/vault/task-mannager/otro/otro.md',
    ]
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
      taskManagerScopeKey: 'task-manager:panel:equipo',
      library: { id: 'library-1', name: 'Vault', path: 'C:/vault' } as never,
      aiPreferences: {
        ollamaUrl: 'https://ollama.com', apiKey: '', selectedModel: 'qwen3',
        thinkingEnabled: false, thinkingLevel: 'medium',
      },
      scopePaths: taskPaths,
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
        requestConfirmation: vi.fn().mockResolvedValue(true),
      })

      await expect(agent.executeTool({
        function: { name: 'search_web', arguments: { query: 'novedades de Rust', maxResults: 5 } },
      }, new AbortController().signal)).resolves.toMatchObject({
        ok: true,
        searchedQuery: 'novedades de Rust',
        results: [expect.objectContaining({ verificationScore: 0 })],
      })

      expect(mocks.searchOllamaWeb).toHaveBeenCalledWith(
        expect.objectContaining({ ollamaUrl: 'https://ollama.com' }),
        expect.objectContaining({ query: 'novedades de Rust', queryIsSanitized: true }),
        expect.anything(),
      )
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
