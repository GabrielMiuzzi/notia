import * as canonicalRuntime from './notiaChatRuntime'
import type { NotiaChatAgent, NotiaChatReplyOptions } from './notiaChatRuntime'
import { createChatScopedAgent, type ChatAgentRuntimeOptions } from './chatScopedAgentRuntime'
import { GLOBAL_AI_REQUEST_VERSION, isGlobalAiChatRequest, type AiAppSurface, type GlobalAiChatRequest } from '../../types/ai/globalAiContract'
import type { AiImageAttachment } from '../ai/aiRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { StoredChatMessage } from './chatDocumentStorage'
import type { AgentIntentContext } from '../../engines/ai/agentIntentEngine'

export interface GlobalAiChatReplyInput {
  request: GlobalAiChatRequest
  agent: NotiaChatAgent
  previousMessages: StoredChatMessage[]
  image?: AiImageAttachment | null
  longTermMemories?: string[]
  toolCallTimeoutMs?: number
  streamFinalResponse?: boolean
  maxRounds?: number
  diagnosticModule?: string
  intentContext?: AgentIntentContext
}

/** Agent construction is kept behind the global AI boundary for all adapters. */
export function createGlobalAiAgent(options: ChatAgentRuntimeOptions): ReturnType<typeof createChatScopedAgent> {
  return createChatScopedAgent(options)
}

export function createAppAiRequest(input: Omit<GlobalAiChatRequest, 'version' | 'source'> & {
  source?: never
  appSurface: AiAppSurface
}): GlobalAiChatRequest {
  if (Object.prototype.hasOwnProperty.call(canonicalRuntime, 'createAppAiRequest')) {
    return canonicalRuntime.createAppAiRequest(input)
  }
  return {
    ...input,
    source: { channel: 'app', appSurface: input.appSurface },
    version: GLOBAL_AI_REQUEST_VERSION,
  } as GlobalAiChatRequest
}

/** Compatibility facade retained for adapters that mock this module; validation and execution remain in notiaChatRuntime. */
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
  if (Object.prototype.hasOwnProperty.call(canonicalRuntime, 'runGlobalAiChat')) {
    return canonicalRuntime.runGlobalAiChat(preferences, input, options)
  }
  return canonicalRuntime.runNotiaChatReply(preferences, {
    requestId: input.request.requestId,
    globalRequest: input.request,
    prompt: input.request.prompt,
    agent: input.agent,
    previousMessages: input.previousMessages,
    image: input.image,
    longTermMemories: input.longTermMemories,
    toolCallTimeoutMs: input.toolCallTimeoutMs,
    streamFinalResponse: input.streamFinalResponse,
    maxRounds: input.maxRounds,
    diagnosticModule: input.diagnosticModule,
    intentContext: input.intentContext,
  }, options)
}
