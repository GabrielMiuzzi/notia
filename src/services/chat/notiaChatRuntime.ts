import {
  runNativeToolAgent,
  type AiImageAttachment,
  type AiNativeToolCall,
  type AiNativeToolDefinition,
  type CancelableAiReplyHandle,
} from '../ai/aiRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { StoredChatMessage } from './chatDocumentStorage'
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
  prompt: string
  previousMessages: StoredChatMessage[]
  agent: NotiaChatAgent
  image?: AiImageAttachment | null
  longTermMemories?: string[]
  toolCallTimeoutMs?: number
  streamFinalResponse?: boolean
  maxRounds?: number
  diagnosticModule?: string
}

export interface NotiaChatReplyOptions {
  abortSignal?: AbortSignal
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentRoundStart?: (round: number) => void
}

function buildSystemPrompt(agent: NotiaChatAgent, longTermMemories: string[]): string {
  if (longTermMemories.length === 0) return agent.systemPrompt
  return `${agent.systemPrompt}\n\nMemorias de largo plazo relevantes:\n${longTermMemories.map((memory) => `- ${memory}`).join('\n')}`
}

export function runNotiaChatReply(
  preferences: AiPreferences,
  input: NotiaChatReplyInput,
  options: NotiaChatReplyOptions = {},
): Promise<string> {
  return runNativeToolAgent(preferences, {
    systemPrompt: buildSystemPrompt(input.agent, input.longTermMemories ?? []),
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
