import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isLikelyMutatingAgentTool, runNativeToolAgent, type AiNativeToolCall } from './aiRuntime'

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
