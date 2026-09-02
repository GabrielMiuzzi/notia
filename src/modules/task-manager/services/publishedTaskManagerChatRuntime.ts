import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import { createChatScopedAgent, type TaskExecutionStep } from '../../../services/chat/chatScopedAgentRuntime'
import { runNotiaChatReply } from '../../../services/chat/notiaChatRuntime'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'

interface PublishedTaskManagerChatInput {
  aiPreferences: AiPreferences
  library: NotiaLibrary
  scopePaths: string[]
  prompt: string
  previousMessages: StoredChatMessage[]
  signal: AbortSignal
  onExecutionPlanChange?: (steps: TaskExecutionStep[]) => void
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
}

export async function runPublishedTaskManagerChatReply(input: PublishedTaskManagerChatInput): Promise<string> {
  const agent = await createChatScopedAgent({
    scope: 'task-manager',
    publishedScope: true,
    aiPreferences: input.aiPreferences,
    library: input.library,
    scopePaths: input.scopePaths,
    taskManagerScopeKey: 'task-manager:published-boards',
    requestClarification: async (question, signal, choices) => {
      if (signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError')
      const suffix = choices?.length ? `\n\nOpciones:\n${choices.map((choice) => `- ${choice}`).join('\n')}` : ''
      return window.prompt(`${question}${suffix}`)?.trim() ?? ''
    },
    requestConfirmation: async (question, signal) => !signal.aborted && window.confirm(question),
    onExecutionPlanChange: input.onExecutionPlanChange,
    requestExecutionPlanApproval: async (steps, signal) => ({
      approved: !signal.aborted && window.confirm(
        `Aprobar este plan de ejecucion:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
      ),
    }),
  })

  return runNotiaChatReply(input.aiPreferences, {
    agent,
    prompt: input.prompt,
    previousMessages: input.previousMessages,
    streamFinalResponse: true,
    diagnosticModule: 'published-task-manager-chat',
  }, {
    abortSignal: input.signal,
    onMessageDelta: input.onMessageDelta,
    onThinkingDelta: input.onThinkingDelta,
  })
}
