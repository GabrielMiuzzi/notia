import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { containsInternalAgentDisclosure, isLikelyMutatingAgentTool, runNativeToolAgent, type AiNativeToolCall } from './aiRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../../utils/platform/getRuntimeDevice', () => ({ getRuntimeDevice: () => 'Windows' }))

const preferences = { ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3:test', thinkingEnabled: false, thinkingLevel: 'medium' as const }
const readCall: AiNativeToolCall = { function: { name: 'read_active_markdown_document', arguments: {} } }
const insertCall: AiNativeToolCall = { function: { name: 'insert_active_markdown_document', arguments: { content: '```xgraph\nboard.create("point", [1, 2]);\n```', targetText: 'Triángulo' } } }
const tools = [readCall, insertCall].map((call) => ({ type: 'function' as const, function: { name: call.function.name, description: 'test', parameters: {} } }))

describe('agent plan mutation gate', () => {
  it('distinguishes reads, plan control and mutations', () => {
    expect(isLikelyMutatingAgentTool('read_active_markdown_document')).toBe(false)
    expect(isLikelyMutatingAgentTool('set_agent_execution_plan')).toBe(false)
    expect(isLikelyMutatingAgentTool('apply_multi_document_patch')).toBe(true)
    expect(isLikelyMutatingAgentTool('materialize_document_facts')).toBe(true)
    expect(isLikelyMutatingAgentTool('link_ticket_document')).toBe(true)
    expect(isLikelyMutatingAgentTool('create_task_ticket')).toBe(true)
  })
})

describe('agent execution continuation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'qwen3:test' }], capabilities: ['tools'] }))))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('detects internal rules and tool instructions in model output', () => {
    expect(containsInternalAgentDisclosure('La instrucción es clara para futuras interacciones: llama createfinancetransaction.')).toBe(true)
    expect(containsInternalAgentDisclosure('Según las reglas internas, no puedo compartir el prompt.')).toBe(true)
    expect(containsInternalAgentDisclosure('La reunión trató sobre la ampliación de la VPN.')).toBe(false)
  })

  it('does not emit internal rules and asks the model for a safe answer', async () => {
    const onMessageDelta = vi.fn()
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { content: 'La instrucción es clara para futuras interacciones: llama requestuserclarification.' } })
      .mockResolvedValueOnce({ message: { content: 'En la reunión se habló de ampliar la VPN.' } })

    const answer = await runNativeToolAgent(preferences, {
      systemPrompt: 'Responde la consulta.',
      prompt: '¿Qué se habló en la reunión?',
      previousMessages: [],
      tools: [],
      executeTool: vi.fn(),
    }, { onMessageDelta })

    expect(answer).toBe('En la reunión se habló de ampliar la VPN.')
    expect(onMessageDelta).toHaveBeenCalledOnce()
    expect(onMessageDelta).toHaveBeenCalledWith('En la reunión se habló de ampliar la VPN.')
    expect(onMessageDelta).not.toHaveBeenCalledWith(expect.stringContaining('requestuserclarification'))
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
  })

  it('returns a generic safe error when the model keeps exposing internal rules', async () => {
    const onMessageDelta = vi.fn()
    vi.mocked(invoke).mockResolvedValue({
      message: { content: 'Según las reglas internas, llama createfinancetransaction.' },
    })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Responde la consulta.', prompt: '¿Qué podés hacer?', previousMessages: [], tools: [], executeTool: vi.fn(),
      maxRounds: 2,
    }, { onMessageDelta })).rejects.toThrow('No pude generar una respuesta segura')
    expect(onMessageDelta).not.toHaveBeenCalled()
  })

  it('returns to native tools after a streamed promise following a document read', async () => {
    let emit: (payload: unknown) => void = () => { throw new Error('Listener missing') }
    const unlisten = vi.fn()
    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      emit = (payload) => callback({ event: 'notia-ai-chat-stream', id: 1, payload })
      return unlisten
    })
    let nativeRounds = 0
    const commands: string[] = []
    const requests: unknown[] = []
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      commands.push(command)
      const payload = (args as { payload: { requestId?: string } }).payload
      requests.push(structuredClone(payload))
      if (command === 'run_desktop_ai_chat_streaming') {
        emit({ requestId: payload.requestId, type: 'delta', payload: { delta: 'Ahora insertaré este gráfico después del ejemplo del triángulo.' } })
        emit({ requestId: payload.requestId, type: 'done' })
        return undefined
      }
      if (command !== 'run_desktop_ai_tool_chat') throw new Error(`Unexpected command: ${command}`)
      nativeRounds += 1
      return { message: { tool_calls: [nativeRounds === 1 ? readCall : insertCall] } }
    })
    const executeTool = vi.fn<(call: AiNativeToolCall, signal: AbortSignal) => Promise<unknown>>(async () => ({ ok: true }))
    const answer = await runNativeToolAgent(preferences, {
      systemPrompt: 'Edita la nota con herramientas.', prompt: 'Insertá gráficos JSXGraph.', previousMessages: [], tools,
      executeTool, resolveToolResultAnswer: (call) => call.function.name === insertCall.function.name ? 'Listo. Gráfico insertado.' : null,
    })
    expect(answer).toBe('Listo. Gráfico insertado.')
    expect(executeTool.mock.calls.map(([call]) => call)).toEqual([readCall, insertCall])
    expect(commands).toEqual(['run_desktop_ai_tool_chat', 'run_desktop_ai_chat_streaming', 'run_desktop_ai_tool_chat'])
    expect(requests[2]).toMatchObject({ tools, messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('No termines con una promesa') })]) })
    expect(unlisten).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recovers a transient empty native response after a tool round', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
      .mockResolvedValueOnce({ message: { content: '' } })
      .mockResolvedValueOnce({ message: { content: 'La memoria quedó actualizada.' } })

    const answer = await runNativeToolAgent(preferences, {
      systemPrompt: 'Responde la consulta.',
      prompt: 'Guardá esta información en memoria.',
      previousMessages: [],
      tools,
      streamFinalResponse: false,
      executeTool: vi.fn().mockResolvedValue({ ok: true, changed: true }),
    })

    expect(answer).toBe('La memoria quedó actualizada.')
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(3)
  })

  it('does not execute an identical tool call repeatedly in one assistant turn', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
      .mockResolvedValueOnce({ message: { content: 'El documento contiene los datos solicitados.' } })
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: 'contenido autorizado' })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Responde con la lectura.', prompt: 'Lee el documento.', previousMessages: [], tools,
      streamFinalResponse: false,
      executeTool,
    })).resolves.toBe('El documento contiene los datos solicitados.')

    expect(executeTool).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('reuses the successful result of an identical read call', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
      .mockResolvedValueOnce({ message: { content: 'Usé la lectura anterior.' } })
    const executeTool = vi.fn().mockResolvedValue({ ok: true, data: 'evidencia verificable' })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Responde con la lectura.', prompt: 'Lee el documento.', previousMessages: [], tools,
      streamFinalResponse: false,
      executeTool,
    })).resolves.toBe('Usé la lectura anterior.')

    expect(executeTool).toHaveBeenCalledOnce()
    expect((vi.mocked(invoke).mock.calls[1]?.[1] as { payload?: { messages?: Array<{ role?: string; content?: string }> } }).payload?.messages)
      .toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', content: expect.stringContaining('evidencia verificable') })]))
  })

  it('retries an explicitly retryable failure once, without replaying an applied mutation', async () => {
    const retryableCall: AiNativeToolCall = {
      function: { name: 'read_active_markdown_document', arguments: { revision: 1 } },
    }
    const retryableTools = [retryableCall].map((call) => ({ type: 'function' as const, function: { name: call.function.name, description: 'test', parameters: {} } }))
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [retryableCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [retryableCall] } })
      .mockResolvedValueOnce({ message: { content: 'Lectura recuperada.' } })
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'temporarily-unavailable', retryable: true })
      .mockResolvedValueOnce({ ok: true, data: 'recuperada' })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Responde.', prompt: 'Lee el documento.', previousMessages: [], tools: retryableTools,
      streamFinalResponse: false,
      executeTool,
    })).resolves.toBe('Lectura recuperada.')

    expect(executeTool).toHaveBeenCalledTimes(2)
  })

  it('continues after a terminal read callback when the request is compound', async () => {
    const followUpRead: AiNativeToolCall = {
      function: { name: 'get_finance_inflation_indices', arguments: { period: '2026-01' } },
    }
    const compoundTools = [readCall, followUpRead].map((call) => ({ type: 'function' as const, function: { name: call.function.name, description: 'test', parameters: {} } }))
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [followUpRead] } })
      .mockResolvedValueOnce({ message: { content: 'Comparación completada con ambas lecturas.' } })
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: 'salarios' })
      .mockResolvedValueOnce({ ok: true, data: 'ipc' })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Analiza el pedido compuesto.', prompt: 'Compará salarios e inflación.', previousMessages: [], tools: compoundTools,
      streamFinalResponse: false,
      isCompoundRequest: true,
      executeTool,
      resolveToolResultAnswer: (call) => call.function.name === readCall.function.name ? 'Lectura salarial disponible.' : null,
    })).resolves.toBe('Comparación completada con ambas lecturas.')

    expect(executeTool.mock.calls.map(([call]) => call.function.name)).toEqual([
      readCall.function.name,
      followUpRead.function.name,
    ])
  })

  it('keeps a salary read intermediate and continues with inflation data', async () => {
    const salaryCall: AiNativeToolCall = {
      function: { name: 'list_finance_salaries', arguments: {} },
    }
    const inflationCall: AiNativeToolCall = {
      function: { name: 'get_finance_inflation_indices', arguments: {} },
    }
    const financeTools = [salaryCall, inflationCall].map((call) => ({
      type: 'function' as const,
      function: { name: call.function.name, description: 'test', parameters: {} },
    }))
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [salaryCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [inflationCall] } })
      .mockResolvedValueOnce({ message: { content: 'Comparación salarial contra IPC.' } })
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ salaries: [{ salary: { period: '2026-08', paymentDate: '2026-08-31' } }] })
      .mockResolvedValueOnce({ source: 'ArgentinaDatos', monthly: [], annual: [] })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Analiza salarios e inflación.',
      prompt: '¿Le estoy ganando a la inflación?',
      previousMessages: [],
      tools: financeTools,
      streamFinalResponse: false,
      isCompoundRequest: true,
      executeTool,
      resolveToolResultAnswer: (call) => call.function.name === salaryCall.function.name ? 'Sueldos disponibles.' : null,
    })).resolves.toBe('Comparación salarial contra IPC.')

    expect(executeTool.mock.calls.map(([call]) => call.function.name)).toEqual([
      salaryCall.function.name,
      inflationCall.function.name,
    ])
  })

  it('stops with an actionable error after two unsuccessful corrections', async () => {
    vi.mocked(invoke).mockResolvedValue({ message: { content: 'Voy a insertar el gráfico.' } })
    const executeTool = vi.fn()
    const onMessageDelta = vi.fn()
    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Edita la nota.', prompt: 'Insertá el gráfico.', previousMessages: [], tools, executeTool,
    }, { onMessageDelta })).rejects.toThrow('El modelo anunció acciones pero no logró ejecutarlas')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(executeTool).not.toHaveBeenCalled()
    expect(onMessageDelta).not.toHaveBeenCalled()
  })

  it('does not retry a mutation rejected by the user', async () => {
    vi.mocked(invoke).mockResolvedValue({ message: { tool_calls: [insertCall] } })
    const executeTool = vi.fn(async () => ({ ok: true, changed: false, declined: true }))
    const answer = await runNativeToolAgent(preferences, {
      systemPrompt: 'Edita la nota.', prompt: 'Insertá el gráfico.', previousMessages: [], tools, executeTool,
      resolveToolResultAnswer: () => 'No hice cambios porque cancelaste la operación.',
    })
    expect(answer).toContain('cancelaste')
    expect(executeTool).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('does not retry an applied mutation when the model repeats it', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [insertCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [insertCall] } })
      .mockResolvedValueOnce({ message: { content: 'La operación ya fue aplicada.' } })
    const executeTool = vi.fn().mockResolvedValue({ ok: true, changed: true })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Edita la nota.', prompt: 'Insertá el gráfico.', previousMessages: [], tools: [tools[1]],
      streamFinalResponse: false,
      executeTool,
    })).resolves.toBe('La operación ya fue aplicada.')

    expect(executeTool).toHaveBeenCalledOnce()
  })

  it('stops without retrying when cancellation occurs during tool execution', async () => {
    const controller = new AbortController()
    vi.mocked(invoke).mockResolvedValueOnce({ message: { tool_calls: [readCall] } })
    const executeTool = vi.fn(async (_call: AiNativeToolCall, signal: AbortSignal) => {
      controller.abort()
      expect(signal.aborted).toBe(true)
      throw new Error('cancelled')
    })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Lee.', prompt: 'Lee el documento.', previousMessages: [], tools,
      executeTool,
    }, { abortSignal: controller.signal })).rejects.toThrow('cancelled')
    expect(executeTool).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('continues from an audit preview to the confirmed application', async () => {
    const previewCall: AiNativeToolCall = {
      function: { name: 'preview_finance_audit_proposal', arguments: { proposalId: 'proposal-1' } },
    }
    const applyCall: AiNativeToolCall = {
      function: {
        name: 'apply_finance_audit_proposal',
        arguments: { proposalId: 'proposal-1', proposalType: 'service-card-reconciliation', expectedDataFingerprint: 'fingerprint-1', decision: 'accepted' },
      },
    }
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [previewCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [applyCall] } })
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: true, proposal: { proposalType: 'service-card-reconciliation', period: '2026-09' }, expectedDataFingerprint: 'fingerprint-1' })
      .mockResolvedValueOnce({ ok: true, changed: true, decision: 'accepted', proposalType: 'service-card-reconciliation', period: '2026-09' })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Resuelve auditorías locales.', prompt: 'Sí, hacelo.', previousMessages: [], streamFinalResponse: false,
      tools: [previewCall, applyCall].map((call) => ({ type: 'function' as const, function: { name: call.function.name, description: 'test', parameters: {} } })),
      executeTool,
      resolveToolResultAnswer: (call, result) => call.function.name === 'apply_finance_audit_proposal'
        ? `Listo: ${(result as { decision: string }).decision}.`
        : null,
    })).resolves.toBe('Listo: accepted.')

    expect(executeTool.mock.calls.map(([call]) => call)).toEqual([previewCall, applyCall])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not fall back to the desktop tool transport from a published session', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      location: { pathname: '/published' },
    })
    vi.mocked(invoke).mockResolvedValue({ message: { tool_calls: [readCall] } })
    vi.mocked(fetch).mockRejectedValue(new Error('published stream unavailable'))

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Consulta el tablero publicado.',
      prompt: 'Lee el tablero.',
      previousMessages: [],
      tools: [tools[0]],
      executeTool: vi.fn(async () => ({ ok: true, data: 'contexto' })),
    })).rejects.toThrow('published stream unavailable')
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('run_desktop_ai_tool_chat', expect.anything())
  })

  it('emits operational progress without exposing model thinking', async () => {
    vi.mocked(invoke).mockResolvedValue({ message: { content: 'Respuesta final.' } })
    const progressEvents: Array<{ type: string; requestId?: string }> = []

    const answer = await runNativeToolAgent(preferences, {
      requestId: 'telegram-request-1',
      systemPrompt: 'Responde la consulta.', prompt: '¿Qué podés hacer?', previousMessages: [], tools: [], executeTool: vi.fn(),
    }, {
      onAgentProgress: (event) => progressEvents.push({ type: event.type, requestId: event.requestId }),
    })

    expect(answer).toBe('Respuesta final.')
    expect(progressEvents.map((event) => event.type)).toEqual(expect.arrayContaining([
      'phase-changed',
      'round-started',
      'completed',
    ]))
    expect(progressEvents.every((event) => event.requestId === 'telegram-request-1')).toBe(true)
  })

  it('does not accept a fresh-information answer before a successful web search', async () => {
    const searchCall: AiNativeToolCall = {
      function: { name: 'search_web', arguments: { query: 'noticias públicas de Argentina' } },
    }
    const searchTool = {
      type: 'function' as const,
      function: { name: 'search_web', description: 'Busca fuentes públicas.', parameters: {} },
    }
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { content: 'Encontré las últimas noticias.' } })
      .mockResolvedValueOnce({ message: { tool_calls: [searchCall] } })
      .mockResolvedValueOnce({ message: { content: 'Fuente: https://inventada.example/noticia' } })
      .mockResolvedValueOnce({ message: { content: 'Fuente: https://example.com/noticia' } })
    const executeTool = vi.fn(async () => ({
      ok: true,
      searchedQuery: 'noticias públicas de Argentina',
      consistency: 'insufficient',
      results: [{ url: 'https://example.com/noticia' }],
    }))

    const answer = await runNativeToolAgent(preferences, {
      systemPrompt: 'Responde con evidencia.',
      prompt: 'Dame las últimas noticias financieras.',
      previousMessages: [],
      tools: [searchTool],
      requiredToolNames: ['search_web'],
      executeTool,
      streamFinalResponse: false,
    })

    expect(answer).toContain('https://example.com/noticia')
    expect(executeTool).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledTimes(4)
    expect((vi.mocked(invoke).mock.calls[1]?.[1] as { payload?: { messages?: Array<{ content?: string }> } }).payload?.messages)
      .toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('todavía no fue verificada') })]))
    expect((vi.mocked(invoke).mock.calls[3]?.[1] as { payload?: { messages?: Array<{ content?: string }> } }).payload?.messages)
      .toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('URLs devueltas por search_web') })]))
  })

  it('does not present a web answer after the search provider fails', async () => {
    const searchCall: AiNativeToolCall = { function: { name: 'search_web', arguments: { query: 'noticias públicas' } } }
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [searchCall] } })
      .mockResolvedValueOnce({ message: { content: 'Encontré noticias verificadas.' } })
    const executeTool = vi.fn(async () => ({ ok: false, error: 'provider-unavailable' }))

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Responde con evidencia.',
      prompt: 'Dame las últimas noticias.',
      previousMessages: [],
      tools: [{ type: 'function', function: { name: 'search_web', description: 'Busca', parameters: {} } }],
      requiredToolNames: ['search_web'],
      executeTool,
      streamFinalResponse: false,
    })).rejects.toThrow('No pude verificar la información en la web')
    expect(executeTool).toHaveBeenCalledOnce()
  })

  it('runs multiple public searches and reuses a normalized duplicate without network', async () => {
    const calls: AiNativeToolCall[] = [
      { function: { name: 'search_web', arguments: { query: '%52ust   release notes', maxResults: 5, freshness: 'week', domains: ['b.example', 'A.example'] } } },
      { function: { name: 'search_web', arguments: { query: 'rust release notes', maxResults: 5, freshness: 'week', domains: ['a.example', 'B.EXAMPLE'] } } },
      { function: { name: 'search_web', arguments: { query: 'TypeScript release notes', maxResults: 5, freshness: 'week', domains: [] } } },
    ]
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: calls } })
      .mockResolvedValueOnce({ message: { content: 'Fuentes: https://a.example/rust y https://a.example/typescript' } })
    const executeTool = vi.fn(async (call: AiNativeToolCall) => ({
      ok: true,
      searchedQuery: String(call.function.arguments.query),
      results: [{ url: `https://a.example/${String(call.function.arguments.query).includes('TypeScript') ? 'typescript' : 'rust'}` }],
    }))

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Responde con evidencia.', prompt: 'Investiga las novedades.', previousMessages: [],
      tools: [{ type: 'function', function: { name: 'search_web', description: 'Busca', parameters: {} } }],
      executeTool, streamFinalResponse: false,
    })).resolves.toContain('https://a.example/rust')

    expect(executeTool).toHaveBeenCalledTimes(2)
  })

  it('counts failed, cancelled and empty searches toward the six-search limit', async () => {
    const calls = Array.from({ length: 7 }, (_, index) => ({
      function: { name: 'search_web', arguments: { query: `consulta pública ${index + 1}` } },
    }))
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: calls.slice(0, 3) } })
      .mockResolvedValueOnce({ message: { tool_calls: calls.slice(3) } })
      .mockResolvedValueOnce({ message: { content: 'La investigación quedó incompleta.' } })
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'provider-unavailable', retryable: true })
      .mockResolvedValueOnce({ ok: false, error: 'cancelled', retryable: false })
      .mockResolvedValueOnce({ ok: true, searchedQuery: 'consulta pública 3', results: [] })
      .mockResolvedValueOnce({ ok: true, searchedQuery: 'consulta pública 4', results: [] })
      .mockResolvedValueOnce({ ok: true, searchedQuery: 'consulta pública 5', results: [] })
      .mockResolvedValueOnce({ ok: true, searchedQuery: 'consulta pública 6', results: [] })

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Investiga sin inventar.', prompt: 'Hacé una investigación amplia.', previousMessages: [],
      tools: [{ type: 'function', function: { name: 'search_web', description: 'Busca', parameters: {} } }],
      executeTool, streamFinalResponse: false,
    })).resolves.toBe('La investigación quedó incompleta.')

    expect(executeTool).toHaveBeenCalledTimes(6)
    const secondRoundMessages = (vi.mocked(invoke).mock.calls[1]?.[1] as { payload?: { messages?: Array<{ content?: string }> } }).payload?.messages ?? []
    expect(secondRoundMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('web-search-limit-reached') }),
    ]))
  })

  it('emits a plan and step lifecycle without exposing model thinking', async () => {
    const planCall: AiNativeToolCall = {
      function: { name: 'set_task_execution_plan', arguments: { steps: ['Leer', 'Aplicar'] } },
    }
    const mutationCall: AiNativeToolCall = {
      function: { name: 'replace_active_markdown_document', arguments: { planStepId: 'step-1' } },
    }
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [planCall] } })
      .mockResolvedValueOnce({ message: { tool_calls: [mutationCall] } })
    const events: string[] = []
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: true, approved: true, steps: [
        { id: 'step-1', label: 'Leer', status: 'pending' },
        { id: 'step-2', label: 'Aplicar', status: 'pending' },
      ] })
      .mockResolvedValueOnce({ ok: true, changed: true })

    await runNativeToolAgent(preferences, {
      systemPrompt: 'Ejecuta el plan.', prompt: 'Hacelo.', previousMessages: [],
      tools: [
        { type: 'function', function: { name: planCall.function.name, description: 'plan', parameters: {} } },
        { type: 'function', function: { name: mutationCall.function.name, description: 'mutate', parameters: {} } },
      ],
      executeTool,
      resolveToolResultAnswer: (call) => call.function.name === mutationCall.function.name ? 'Listo.' : null,
    }, { onAgentProgress: (event) => events.push(event.type) })

    expect(events).toEqual(expect.arrayContaining(['plan-created', 'step-started', 'step-completed']))
  })

  it('treats the general plan aliases as plan controls for feedback and gating', async () => {
    const planCall: AiNativeToolCall = {
      function: { name: 'create_agent_plan', arguments: { steps: ['Leer', 'Aplicar'] } },
    }
    vi.mocked(invoke)
      .mockResolvedValueOnce({ message: { tool_calls: [planCall] } })
      .mockResolvedValueOnce({ message: { content: 'Plan aprobado.' } })
    const events: string[] = []

    await expect(runNativeToolAgent(preferences, {
      systemPrompt: 'Planea la tarea.', prompt: 'Hacelo.', previousMessages: [],
      streamFinalResponse: false,
      tools: [{ type: 'function', function: { name: 'create_agent_plan', description: 'plan', parameters: {} } }],
      executeTool: vi.fn(async () => ({ ok: true, approved: true, steps: [
        { id: 'step-1', label: 'Leer', status: 'pending' },
        { id: 'step-2', label: 'Aplicar', status: 'pending' },
      ] })),
    }, { onAgentProgress: (event) => events.push(event.type) })).resolves.toBe('Plan aprobado.')

    expect(events).toContain('plan-created')
  })
})
