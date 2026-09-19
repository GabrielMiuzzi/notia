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

  it('forwards request correlation and continuity context through the common facade', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('seguimos')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: true, thinkingLevel: 'medium' as const,
    }
    const agent = { systemPrompt: 'Prompt', tools: [], executeTool: vi.fn() }

    await runNotiaChatReply(preferences, {
      requestId: 'request-1',
      agent,
      prompt: 'Hacelo mas corto',
      previousMessages: [{ role: 'assistant', content: 'Respuesta anterior' }],
      intentContext: { hasConversationHistory: true, hasActiveDocument: true },
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      requestId: 'request-1',
      systemPrompt: expect.stringContaining('objetivo'),
    }), {})
  })

  it('requires public web search for fresh information and source follow-ups', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('respuesta con fuente')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: false, thinkingLevel: 'medium' as const,
    }
    const agent = {
      systemPrompt: 'Prompt',
      tools: [{ type: 'function' as const, function: { name: 'search_web', description: 'Busca', parameters: {} } }],
      executeTool: vi.fn(),
    }

    await runNotiaChatReply(preferences, {
      agent,
      prompt: '¿Me darías las fuentes?',
      previousMessages: [{ role: 'assistant', content: 'Encontré noticias recientes.' }],
      streamFinalResponse: false,
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      requiredToolNames: ['search_web'],
    }), {})
  })

  it('does not require web search for a local finance audit when the scope has no web tool', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('auditoría local')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: false, thinkingLevel: 'medium' as const,
    }
    const agent = {
      systemPrompt: 'Finanzas locales',
      tools: [{ type: 'function' as const, function: { name: 'audit_finance_month', description: 'Audita', parameters: {} } }],
      executeTool: vi.fn(),
    }

    await runNotiaChatReply(preferences, {
      agent,
      prompt: 'Auditar el resumen local del período 2026-09',
      previousMessages: [],
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      requiredToolNames: undefined,
      systemPrompt: 'Finanzas locales',
    }), {})
  })

  it('does not route loaded salaries to web search when finance tools coexist with the library tools', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('Sueldos cargados en Finanzas')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: false, thinkingLevel: 'medium' as const,
    }
    const agent = {
      systemPrompt: 'Asistente universal',
      tools: [
        { type: 'function' as const, function: { name: 'search_web', description: 'Busca', parameters: {} } },
        { type: 'function' as const, function: { name: 'list_finance_salaries', description: 'Lee sueldos', parameters: {} } },
      ],
      executeTool: vi.fn(),
    }

    await runNotiaChatReply(preferences, {
      agent,
      prompt: 'Mis últimos sueldos de los cargados en Finanzas',
      previousMessages: [],
      streamFinalResponse: false,
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      requiredToolNames: undefined,
      systemPrompt: expect.stringContaining('no uses search_web'),
    }), {})
  })

  it('marks salary versus inflation as a compound local-finance analysis', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('comparación')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: false, thinkingLevel: 'medium' as const,
    }
    const agent = {
      systemPrompt: 'Finanzas',
      tools: [
        { type: 'function' as const, function: { name: 'list_finance_salaries', description: 'Lee', parameters: {} } },
        { type: 'function' as const, function: { name: 'get_finance_inflation_indices', description: 'IPC', parameters: {} } },
      ],
      executeTool: vi.fn(),
    }

    await runNotiaChatReply(preferences, {
      agent,
      prompt: '¿Le estoy ganando a la inflación con mis salarios?',
      previousMessages: [],
      streamFinalResponse: false,
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      isCompoundRequest: true,
      systemPrompt: expect.stringContaining('get_finance_inflation_indices'),
    }), {})
  })

  it('keeps a budget scenario open after reading salaries', async () => {
    vi.mocked(runNativeToolAgent).mockResolvedValue('análisis de presupuesto')
    const preferences = {
      ollamaUrl: 'http://localhost:11434', apiKey: '', selectedModel: 'modelo',
      thinkingEnabled: false, thinkingLevel: 'medium' as const,
    }
    const agent = {
      systemPrompt: 'Finanzas',
      tools: [
        { type: 'function' as const, function: { name: 'list_finance_salaries', description: 'Lee', parameters: {} } },
        { type: 'function' as const, function: { name: 'get_finance_dashboard', description: 'Dashboard', parameters: {} } },
        { type: 'function' as const, function: { name: 'get_finance_dollar_quotes', description: 'Cotizaciones', parameters: {} } },
      ],
      executeTool: vi.fn(),
    }

    await runNotiaChatReply(preferences, {
      agent,
      prompt: '¿Es factible alquilar pagando 1.000.000 y ahorrar además 1000 dólares por mes con mi sueldo?',
      previousMessages: [],
      streamFinalResponse: false,
    })

    expect(runNativeToolAgent).toHaveBeenCalledWith(preferences, expect.objectContaining({
      isCompoundRequest: true,
      systemPrompt: expect.stringContaining('get_finance_dashboard'),
    }), {})
  })
})
