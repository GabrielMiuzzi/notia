import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runNativeToolAgent } from '../ai/aiRuntime'
import { runNotiaChatReply } from './notiaChatRuntime'
import {
  CHAT_AGENT_MAX_ROUNDS,
  CHAT_AGENT_SINGLE_CALL_TOOL_NAMES,
} from './chatScopedAgentRuntime'

vi.mock('../ai/aiRuntime', () => ({
  runNativeToolAgent: vi.fn(),
}))

describe('notiaChatRuntime', () => {
  beforeEach(() => vi.mocked(runNativeToolAgent).mockReset())

  it('aplica el mismo contrato de native tool calling a cualquier canal', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('respuesta')
    const executeTool = vi.fn()
    const resolveToolResultAnswer = vi.fn()
    const preferences = {
      ollamaUrl: 'http://localhost:11434',
      apiKey: '',
      selectedModel: 'modelo',
      thinkingEnabled: true,
      thinkingLevel: 'medium' as const,
    }
    const agent = {
      systemPrompt: 'Prompt compartido',
      tools: [{ type: 'function' as const, function: { name: 'buscar', description: 'Busca', parameters: {} } }],
      executeTool,
      resolveToolResultAnswer,
    }

    await expect(runNotiaChatReply(preferences, {
      agent,
      prompt: 'consulta',
      previousMessages: [],
      longTermMemories: ['memoria'],
    })).resolves.toBe('respuesta')

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      systemPrompt: 'Prompt compartido\n\nMemorias de largo plazo relevantes:\n- memoria',
      prompt: 'consulta',
      previousMessages: [],
      tools: agent.tools,
      executeTool,
      resolveToolResultAnswer,
      maxRounds: CHAT_AGENT_MAX_ROUNDS,
      singleCallToolNames: [...CHAT_AGENT_SINGLE_CALL_TOOL_NAMES],
    }), {})
  })

  it('forwards channel-specific diagnostics and a defensive round limit', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('ticket cargado')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: false, thinkingLevel: 'medium' as const,
    }
    const agent = { systemPrompt: 'Prompt', tools: [], executeTool: vi.fn() }

    await runNotiaChatReply(preferences, {
      agent,
      prompt: 'ticket',
      previousMessages: [],
      maxRounds: 12,
      diagnosticModule: 'telegram-ai',
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      maxRounds: 12,
      diagnosticModule: 'telegram-ai',
    }), {})
  })
})
