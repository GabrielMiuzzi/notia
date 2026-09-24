import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import { startChatTurn } from '../../../services/chat/aiChatRuntime'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import type { AgentProgressEvent } from '../../../types/ai/agentContracts'

interface PublishedTaskManagerChatInput {
  aiPreferences: AiPreferences
  library: NotiaLibrary
  /** Library user of the person asking from the published boards. */
  libraryUserId: string
  prompt: string
  previousMessages: StoredChatMessage[]
  signal: AbortSignal
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
}

/**
 * Answers a question of a published Task Manager on the host. The backend
 * runs it on the published channel, restricted to the published boards and
 * without memory; the agent's questions are answered on the host.
 */
export async function runPublishedTaskManagerHostChatReply(input: PublishedTaskManagerChatInput): Promise<string> {
  const turn = startChatTurn({
    libraryId: input.library.id,
    mode: 'published',
    preferences: input.aiPreferences,
    message: input.prompt,
    libraryUserId: input.libraryUserId,
    chat: { kind: 'transient', messages: input.previousMessages },
  }, {
    onMessageDelta: input.onMessageDelta,
    onThinkingDelta: input.onThinkingDelta,
    onAgentProgress: input.onAgentProgress,
    requestClarification: async (question, signal, choices) => {
      if (signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError')
      const suffix = choices?.length ? `\n\nOpciones:\n${choices.map((choice) => `- ${choice}`).join('\n')}` : ''
      return window.prompt(`${question}${suffix}`)?.trim() ?? ''
    },
    requestConfirmation: async (question, signal) => !signal.aborted && window.confirm(question),
    requestExecutionPlanApproval: async (steps, signal) => ({
      approved: !signal.aborted && window.confirm(
        `Aprobar este plan de ejecucion:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
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
