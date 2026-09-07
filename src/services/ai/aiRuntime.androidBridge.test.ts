import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPluginListener, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  checkAiHealth,
  invalidateAiHealthCache,
  listAiModels,
  startCancelableAiChatReply,
} from './aiRuntime'

vi.mock('@tauri-apps/api/core', () => ({
  addPluginListener: vi.fn(),
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../../utils/platform/getRuntimeDevice', () => ({ getRuntimeDevice: () => 'Android' }))

const preferences = {
  ollamaUrl: 'https://ollama.example.test',
  apiKey: 'secret-key-that-must-stay-in-the-payload-boundary',
  selectedModel: 'qwen3:test',
  thinkingEnabled: true,
  thinkingLevel: 'medium' as const,
}

type StreamCallback = (event: { payload: unknown }) => void

describe('Android AI bridge contract fake', () => {
  let emitEvent: StreamCallback
  let unlisten: () => void
  let unregister: () => Promise<void>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {})
    invalidateAiHealthCache()
    unlisten = vi.fn<() => void>()
    unregister = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    emitEvent = () => undefined

    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      emitEvent = callback as StreamCallback
      return unlisten
    })
    vi.mocked(addPluginListener).mockResolvedValue({
      plugin: 'AiBridgePlugin',
      event: 'stream',
      channelId: 1,
      unregister,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('cubre health y lista de modelos sin sacar la credencial del payload nativo', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ok: true, message: 'Ollama disponible', defaultModel: 'qwen3:test' })
      .mockResolvedValueOnce({ models: ['qwen3:test', 'llama3.2'] })

    await expect(checkAiHealth(preferences)).resolves.toEqual({
      ok: true,
      message: 'Ollama disponible',
      defaultModel: 'qwen3:test',
    })
    await expect(listAiModels(preferences)).resolves.toEqual([
      expect.objectContaining({ name: 'llama3.2' }),
      expect.objectContaining({ name: 'qwen3:test' }),
    ])

    const calls = vi.mocked(invoke).mock.calls
    expect(calls[0]?.[0]).toBe('check_android_ai_health')
    expect(calls[0]?.[1]).toEqual({ payload: expect.objectContaining({ apiKey: preferences.apiKey }) })
  })

  it('transporta thinking, deltas y done, y limpia ambos listeners', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'run_android_ai_chat_streaming') {
        const requestId = ((args as { payload?: { requestId?: string } })?.payload?.requestId ?? '')
        emitEvent({ payload: { requestId, type: 'thinking', payload: { delta: 'Analizando' } } })
        emitEvent({ payload: { requestId, type: 'delta', payload: { delta: 'Respuesta' } } })
        emitEvent({ payload: { requestId, type: 'done', payload: { answer: 'Respuesta' } } })
      }
      return undefined
    })

    const thinking: string[] = []
    const deltas: string[] = []
    const handle = startCancelableAiChatReply(preferences, {
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    }, {
      onThinkingDelta: (delta) => thinking.push(delta),
      onMessageDelta: (delta) => deltas.push(delta),
    })

    await expect(handle.promise).resolves.toBe('Respuesta')
    expect(thinking).toEqual(['Analizando'])
    expect(deltas).toEqual(['Respuesta'])
    expect(unlisten).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('propaga error del plugin y no deja listeners vivos', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'run_android_ai_chat_streaming') {
        const requestId = ((args as { payload?: { requestId?: string } })?.payload?.requestId ?? '')
        emitEvent({ payload: { requestId, type: 'error', payload: { message: 'Proveedor no disponible' } } })
      }
      return undefined
    })

    const handle = startCancelableAiChatReply(preferences, {
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    })

    await expect(handle.promise).rejects.toThrow('Proveedor no disponible')
    expect(unlisten).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('cancela el transporte nativo por requestId y descarta eventos tardios', async () => {
    let streamingResolve: (() => void) | undefined
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'run_android_ai_chat_streaming') {
        await new Promise<void>((resolve) => { streamingResolve = resolve })
      }
      return undefined
    })

    const handle = startCancelableAiChatReply(preferences, {
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    })
    await Promise.resolve()
    handle.abort()

    await expect(handle.promise).rejects.toThrow('Se cancelo la respuesta de la IA')
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'cancel_android_ai_chat_streaming')).toBe(true)
    streamingResolve?.()
    expect(unlisten).toHaveBeenCalledOnce()
    expect(unregister).toHaveBeenCalledOnce()
  })
})
