import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { runNativeToolAgent, type AiNativeToolCall } from './aiRuntime'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../../utils/platform/getRuntimeDevice', () => ({ getRuntimeDevice: () => 'Windows' }))

const preferences = { ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'qwen3:test', thinkingEnabled: false, thinkingLevel: 'medium' as const }
const readCall: AiNativeToolCall = { function: { name: 'read_active_markdown_document', arguments: {} } }
const insertCall: AiNativeToolCall = { function: { name: 'insert_active_markdown_document', arguments: { content: '```xgraph\nboard.create("point", [1, 2]);\n```', targetText: 'Triángulo' } } }
const tools = [readCall, insertCall].map((call) => ({ type: 'function' as const, function: { name: call.function.name, description: 'test', parameters: {} } }))

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
})
