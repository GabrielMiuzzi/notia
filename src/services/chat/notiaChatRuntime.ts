import {
  runNativeToolAgent,
  type AiImageAttachment,
  type AiNativeToolCall,
  type AiNativeToolDefinition,
  type CancelableAiReplyHandle,
} from '../ai/aiRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { StoredChatMessage } from './chatDocumentStorage'
import type { AgentProgressEvent } from '../../types/ai/agentContracts'
import { createGlobalAiRequest, isGlobalAiChatRequest, type AiAppSurface, type GlobalAiChatRequest } from '../../types/ai/globalAiContract'
import { buildAgentIntentGuidance, classifyAgentIntent, isLocalFinanceRequest, type AgentIntentContext } from '../../engines/ai/agentIntentEngine'
import { classifyWebSearchNeed } from '../ai/webSearchRuntime'
import {
  CHAT_AGENT_MAX_ROUNDS,
  CHAT_AGENT_SINGLE_CALL_TOOL_NAMES,
} from './chatScopedAgentRuntime'

export interface NotiaChatAgent {
  libraryId?: string
  actor?: { libraryUserId: string; displayName?: string }
  systemPrompt: string
  tools: AiNativeToolDefinition[]
  executeTool: (call: AiNativeToolCall, signal: AbortSignal) => Promise<unknown>
  resolveToolResultAnswer?: (call: AiNativeToolCall, result: unknown) => string | null
  validateFinalAnswer?: (answer: string) => string | null
}

export interface NotiaChatReplyInput {
  requestId?: string
  globalRequest?: GlobalAiChatRequest
  prompt: string
  previousMessages: StoredChatMessage[]
  agent: NotiaChatAgent
  image?: AiImageAttachment | null
  longTermMemories?: string[]
  toolCallTimeoutMs?: number
  streamFinalResponse?: boolean
  maxRounds?: number
  diagnosticModule?: string
  intentContext?: AgentIntentContext
}

export interface NotiaChatReplyOptions {
  abortSignal?: AbortSignal
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentRoundStart?: (round: number) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
}

export interface GlobalAiChatReplyInput extends Omit<NotiaChatReplyInput, 'requestId' | 'prompt'> {
  request: GlobalAiChatRequest
}

/**
 * Single public execution facade for app, publication and Telegram adapters.
 * Transport-specific code supplies callbacks and an already-built agent; it
 * cannot alter identity, channel, library or the request id during a turn.
 */
export function runGlobalAiChat(
  preferences: AiPreferences,
  input: GlobalAiChatReplyInput,
  options: NotiaChatReplyOptions = {},
): Promise<string> {
  if (!isGlobalAiChatRequest(input.request)) {
    return Promise.reject(new Error('La solicitud global de IA es inválida o está incompleta.'))
  }
  if (input.agent.libraryId && input.agent.libraryId !== input.request.libraryId) {
    return Promise.reject(new Error('La solicitud global de IA no pertenece a la biblioteca activa.'))
  }
  return runNotiaChatReply(preferences, {
    ...input,
    requestId: input.request.requestId,
    prompt: input.request.prompt,
    globalRequest: input.request,
  }, options)
}

export function createAppAiRequest(input: Omit<GlobalAiChatRequest, 'version' | 'source'> & {
  source?: never
  appSurface: AiAppSurface
}): GlobalAiChatRequest {
  return createGlobalAiRequest({
    ...input,
    source: { channel: 'app', appSurface: input.appSurface },
  })
}

function buildSystemPrompt(
  agent: NotiaChatAgent,
  longTermMemories: string[],
  prompt: string,
  intentContext?: AgentIntentContext,
): string {
  const sections = [agent.systemPrompt]
  const intentAnalysis = classifyAgentIntent(prompt, intentContext)
  if (longTermMemories.length > 0) {
    sections.push(`Memorias de largo plazo relevantes:\n${longTermMemories.map((memory) => `- ${memory}`).join('\n')}`)
  }
  if (intentContext) {
    sections.push(buildAgentIntentGuidance(intentAnalysis))
  }
  const webSearchNeed = classifyWebSearchNeed(prompt)
  const hasWebSearchTool = agent.tools.some((tool) => tool.function.name === 'search_web')
  const hasFinanceTools = agent.tools.some((tool) => tool.function.name.startsWith('get_finance_') || tool.function.name.startsWith('list_finance_'))
  const localFinanceRequest = hasFinanceTools && isLocalFinanceRequest(prompt)
  if (localFinanceRequest) {
    sections.push(
      'Enrutamiento financiero local: esta consulta pide datos cargados en Finanzas. Usa primero la herramienta financiera tipada más específica y responde con sus resultados; no uses search_web ni inventes datos públicos. Para "últimos sueldos", "sueldos cargados" o "recibos de sueldo", llama directamente a list_finance_salaries y no repitas lecturas una vez que devuelve datos. Si el pedido compara salarios con inflación, conserva esa lectura como evidencia intermedia y llama también a get_finance_inflation_indices antes de redactar la comparación.',
    )
  }
  if (localFinanceRequest) {
    if (intentAnalysis.reasons.includes('budget-feasibility-analysis')) {
      const hasDashboardTool = agent.tools.some((tool) => tool.function.name === 'get_finance_dashboard')
      const hasDollarQuotesTool = agent.tools.some((tool) => tool.function.name === 'get_finance_dollar_quotes')
      sections.push([
        'Análisis de factibilidad presupuestaria: una lista de sueldos es evidencia intermedia, no la respuesta final. Conserva esos ingresos y continúa con los datos necesarios para evaluar el escenario solicitado; no cierres después de listarlos.',
        hasDashboardTool ? 'Consulta get_finance_dashboard para conocer los gastos, compromisos y saldos locales relevantes antes de concluir.' : '',
        hasDollarQuotesTool ? 'Si el objetivo está expresado en USD y hace falta convertirlo, consulta get_finance_dollar_quotes, informa la fecha y separa el tipo de cambio de cualquier inferencia.' : '',
        'Distingue importes registrados, objetivos indicados por el usuario y estimaciones; si faltan datos críticos, explica qué falta en vez de afirmar que el alquiler es viable o inviable.',
      ].filter(Boolean).join(' '))
    }
  }
  if (hasWebSearchTool && !localFinanceRequest && (webSearchNeed === 'explicit' || webSearchNeed === 'freshness')) {
    sections.push(
      webSearchNeed === 'explicit'
        ? 'El usuario pidió consultar fuentes públicas. Evalúa search_web; redacta una consulta pública desde ese pedido y deja que la sanitización bloquee cualquier dato privado.'
        : 'El pedido parece depender de información cambiante. Evalúa search_web antes de afirmar datos actuales, siempre con una consulta pública y sanitizada.',
    )
  }
  return sections.join('\n\n')
}

export function runNotiaChatReply(
  preferences: AiPreferences,
  input: NotiaChatReplyInput,
  options: NotiaChatReplyOptions = {},
): Promise<string> {
  const hasWebSearchTool = input.agent.tools.some((tool) => tool.function.name === 'search_web')
  const hasFinanceTools = input.agent.tools.some((tool) => tool.function.name.startsWith('get_finance_') || tool.function.name.startsWith('list_finance_'))
  const localFinanceRequest = hasFinanceTools && isLocalFinanceRequest(input.prompt)
  const intentAnalysis = classifyAgentIntent(input.prompt, input.intentContext)
  return runNativeToolAgent(preferences, {
    requestId: input.requestId,
    globalRequest: input.globalRequest,
    systemPrompt: buildSystemPrompt(input.agent, input.longTermMemories ?? [], input.prompt, input.intentContext),
    prompt: input.prompt,
    image: input.image,
    previousMessages: input.previousMessages,
    tools: input.agent.tools,
    executeTool: input.agent.executeTool,
    requiredToolNames: hasWebSearchTool && !localFinanceRequest && (classifyWebSearchNeed(input.prompt) === 'explicit' || classifyWebSearchNeed(input.prompt) === 'freshness')
      ? ['search_web']
      : undefined,
    resolveToolResultAnswer: input.agent.resolveToolResultAnswer,
    validateFinalAnswer: input.agent.validateFinalAnswer,
    isCompoundRequest: intentAnalysis.isCompound,
    maxRounds: input.maxRounds ?? CHAT_AGENT_MAX_ROUNDS,
    singleCallToolNames: [...CHAT_AGENT_SINGLE_CALL_TOOL_NAMES],
    toolCallTimeoutMs: input.toolCallTimeoutMs,
    streamFinalResponse: input.streamFinalResponse,
    diagnosticModule: input.diagnosticModule,
  }, options)
}

export function startNotiaChatReply(
  preferences: AiPreferences,
  input: NotiaChatReplyInput,
  options: Omit<NotiaChatReplyOptions, 'abortSignal'> = {},
): CancelableAiReplyHandle {
  const controller = new AbortController()
  return {
    abort: () => controller.abort(),
    promise: runNotiaChatReply(preferences, input, { ...options, abortSignal: controller.signal }),
  }
}

export function startGlobalAiChat(
  preferences: AiPreferences,
  input: GlobalAiChatReplyInput,
  options: Omit<NotiaChatReplyOptions, 'abortSignal'> = {},
): CancelableAiReplyHandle {
  const controller = new AbortController()
  return {
    abort: () => controller.abort(),
    promise: runGlobalAiChat(preferences, input, { ...options, abortSignal: controller.signal }),
  }
}
