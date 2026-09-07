import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPluginListener, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { streamAiChatReply } from './aiRuntime'

vi.mock('@tauri-apps/api/core', () => ({ addPluginListener: vi.fn(), invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../../utils/platform/getRuntimeDevice', () => ({ getRuntimeDevice: () => 'Windows' }))

const preferences = {
  ollamaUrl: 'https://ollama.example.test',
  apiKey: '',
  selectedModel: 'qwen3:test',
  thinkingEnabled: true,
  thinkingLevel: 'medium' as const,
}

describe('published AI stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      __NOTIA_PUBLISHED_TASK_MANAGER__: true,
      location: { pathname: '/app' },
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('consume thinking, deltas y done desde NDJSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response([
      JSON.stringify({ type: 'thinking', delta: 'Analizando' }),
      JSON.stringify({ type: 'delta', delta: 'Hola' }),
      JSON.stringify({ type: 'done', answer: 'Hola' }),
    ].join('\n')))
    const thinking: string[] = []
    const deltas: string[] = []

    await expect(streamAiChatReply(preferences, {
      prompt: 'saludá',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    }, {
      onThinkingDelta: (delta) => thinking.push(delta),
      onMessageDelta: (delta) => deltas.push(delta),
    })).resolves.toBe('Hola')

    expect(thinking).toEqual(['Analizando'])
    expect(deltas).toEqual(['Hola'])
    expect(fetch).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    expect(addPluginListener).not.toHaveBeenCalled()
    expect(listen).not.toHaveBeenCalled()
  })

  it('reconecta una sola vez si la conexión falla antes del primer evento', async () => {
    const failedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('conexion cerrada'))
      },
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(failedBody))
      .mockResolvedValueOnce(new Response(`${JSON.stringify({ type: 'done', answer: 'Recuperado' })}\n`))

    await expect(streamAiChatReply(preferences, {
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    })).resolves.toBe('Recuperado')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('no reconecta después de haber publicado un delta parcial', async () => {
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode(`${JSON.stringify({ type: 'delta', delta: 'Parcial' })}\n`) })
        .mockRejectedValueOnce(new Error('conexion cerrada')),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    }
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
      text: async () => '',
    } as unknown as Response)
    const deltas: string[] = []

    const result = streamAiChatReply(preferences, {
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    }, { onMessageDelta: (delta) => deltas.push(delta) })
    await expect(result).rejects.toThrow('conexion cerrada')
    expect(deltas).toEqual(['Parcial'])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('cancela una lectura pendiente y libera el reader', async () => {
    let cancelCalled = false
    const pendingBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalled = true
      },
    })
    const controller = new AbortController()
    vi.mocked(fetch).mockResolvedValue(new Response(pendingBody))
    const handle = streamAiChatReply(preferences, {
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: [],
      selectedContextMode: 'direct',
    }, { abortSignal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()

    await expect(handle).rejects.toThrow('Se cancelo la respuesta de la IA')
    expect(cancelCalled).toBe(true)
  })
})
