import type { StoredChatMessage } from './chatDocumentStorage'
import { startChatTurn } from './aiChatRuntime'
import { loadSelectedAgentPromptFileName } from '../ai/agentPromptRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../types/notia'
import type { AgentProgressEvent } from '../../types/ai/agentContracts'

export interface MeetingEphemeralChatReplyInput {
  aiPreferences: AiPreferences
  library: NotiaLibrary
  transcript: string
  prompt: string
  previousMessages: StoredChatMessage[]
  signal: AbortSignal
  onMessageDelta?: (delta: string) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
}

/**
 * Asks about the live Meeting transcript. The backend composes the question
 * with the transcript and runs it without memory; the agent's questions are
 * answered with the native dialogs.
 */
export async function runMeetingEphemeralChatReply(
  input: MeetingEphemeralChatReplyInput,
): Promise<string> {
  const turn = startChatTurn({
    libraryId: input.library.id,
    mode: 'meeting',
    preferences: input.aiPreferences,
    message: input.prompt,
    context: input.transcript,
    promptName: await loadSelectedAgentPromptFileName(input.library.id),
    chat: { kind: 'transient', messages: input.previousMessages },
  }, {
    onMessageDelta: input.onMessageDelta,
    onAgentProgress: input.onAgentProgress,
    requestClarification: async (question, signal) => {
      if (signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError')
      return window.prompt(question)?.trim() ?? ''
    },
    requestConfirmation: async (question, signal) => !signal.aborted && window.confirm(question),
    requestExecutionPlanApproval: async (steps, signal) => ({
      approved: !signal.aborted && window.confirm(
        `Aprobar este plan de ejecución:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
      ),
    }),
  })
  if (input.signal.aborted) turn.abort()
  input.signal.addEventListener('abort', turn.abort, { once: true })
  try {
    return (await turn.promise).answer
  } finally {
    input.signal.removeEventListener('abort', turn.abort)
  }
}
