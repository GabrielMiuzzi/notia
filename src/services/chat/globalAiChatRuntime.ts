import * as canonicalRuntime from './notiaChatRuntime'
import type { GlobalAiChatReplyInput, NotiaChatAgent, NotiaChatReplyOptions } from './notiaChatRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { AiActor, AiAppSurface, GlobalAiChatRequest } from '../../types/ai/globalAiContract'
import type { NotiaLibrary } from '../../types/notia'

export type { GlobalAiChatReplyInput } from './notiaChatRuntime'

export interface GlobalAiAgentOptions {
  library: NotiaLibrary
  actor?: AiActor
  promptFileName?: string
  undoOperationId?: string
  requestClarification?: NotiaChatAgent['requestClarification']
  requestConfirmation?: NotiaChatAgent['requestConfirmation']
  requestExecutionPlanApproval?: NotiaChatAgent['requestExecutionPlanApproval']
}

/** UI adapter for a backend chat run; the Rust runtime owns tools and permissions. */
export function createGlobalAiAgent(options: GlobalAiAgentOptions): NotiaChatAgent {
  return {
    libraryId: options.library.id,
    actor: options.actor,
    promptName: options.promptFileName,
    undoOperationId: options.undoOperationId,
    requestClarification: options.requestClarification,
    requestConfirmation: options.requestConfirmation,
    requestExecutionPlanApproval: options.requestExecutionPlanApproval,
  }
}

export function createAppAiRequest(input: Omit<GlobalAiChatRequest, 'version' | 'source'> & {
  source?: never
  appSurface: AiAppSurface
}): GlobalAiChatRequest {
  return canonicalRuntime.createAppAiRequest(input)
}

export function runGlobalAiChat(
  preferences: AiPreferences,
  input: GlobalAiChatReplyInput,
  options: NotiaChatReplyOptions = {},
): Promise<string> {
  return canonicalRuntime.runGlobalAiChat(preferences, input, options)
}
