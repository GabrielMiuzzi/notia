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
import { buildAgentIntentGuidance, classifyAgentIntent, type AgentIntentContext } from '../../engines/ai/agentIntentEngine'
import { classifyWebSearchNeed } from '../ai/webSearchRuntime'
import {
  CHAT_AGENT_MAX_ROUNDS,
  CHAT_AGENT_SINGLE_CALL_TOOL_NAMES,
} from './chatScopedAgentRuntime'

export interface NotiaChatAgent {
  systemPrompt: string
  tools: AiNativeToolDefinition[]
  executeTool: (call: AiNativeToolCall, signal: AbortSignal) => Promise<unknown>
  resolveToolResultAnswer?: (call: AiNativeToolCall, result: unknown) => string | null
  validateFinalAnswer?: (answer: string) => string | null
}

export interface NotiaChatReplyInput {
  requestId?: string
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

function buildSystemPrompt(
  agent: NotiaChatAgent,
  longTermMemories: string[],
  prompt: string,
  intentContext?: AgentIntentContext,
): string {
  const sections = [agent.systemPrompt]
  if (longTermMemories.length > 0) {
    sections.push(`Memorias de largo plazo relevantes:\n${longTermMemories.map((memory) => `- ${memory}`).join('\n')}`)
  }
  if (intentContext) {
    const analysis = classifyAgentIntent(prompt, intentContext)
    sections.push(buildAgentIntentGuidance(analysis))
  }
  const webSearchNeed = classifyWebSearchNeed(prompt)
  if (webSearchNeed === 'explicit' || webSearchNeed === 'freshness') {
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
  return runNativeToolAgent(preferences, {
    requestId: input.requestId,
    systemPrompt: buildSystemPrompt(input.agent, input.longTermMemories ?? [], input.prompt, input.intentContext),
    prompt: input.prompt,
    image: input.image,
    previousMessages: input.previousMessages,
    tools: input.agent.tools,
    executeTool: input.agent.executeTool,
    resolveToolResultAnswer: input.agent.resolveToolResultAnswer,
    validateFinalAnswer: input.agent.validateFinalAnswer,
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
