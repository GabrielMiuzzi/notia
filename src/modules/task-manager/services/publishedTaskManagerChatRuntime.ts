import type { StoredChatMessage } from '../../../services/chat/chatDocumentStorage'
import type { TaskExecutionStep } from '../../../services/chat/chatAgentTypes'
import { createGlobalAiAgent, runGlobalAiChat } from '../../../services/chat/globalAiChatRuntime'
import { createGlobalAiRequest, type AiActor } from '../../../types/ai/globalAiContract'
import { buildWorkspaceAiSnapshot } from '../../../services/ai/workspaceAiSnapshotRuntime'
import type { AiPreferences } from '../../../services/preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../../types/notia'
import type { AgentProgressEvent } from '../../../types/ai/agentContracts'

interface PublishedTaskManagerChatInput {
  aiPreferences: AiPreferences
  library: NotiaLibrary
  taskManagerScopeKey?: string | null
  scopePaths: string[]
  prompt: string
  previousMessages: StoredChatMessage[]
  signal: AbortSignal
  onExecutionPlanChange?: (steps: TaskExecutionStep[]) => void
  onMessageDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
  actor?: AiActor
  publishedBoardNames?: readonly string[]
}

export async function runPublishedTaskManagerHostChatReply(input: PublishedTaskManagerChatInput): Promise<string> {
  const agent = createGlobalAiAgent({
    library: input.library,
    actor: input.actor,
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

  const workspaceSnapshot = buildWorkspaceAiSnapshot({
    view: 'task-manager',
    scope: 'published',
    library: input.library,
    activeDocument: null,
    openTabs: [],
  })
  const replyInput = {
    agent,
    previousMessages: input.previousMessages,
  }
  return runGlobalAiChat(input.aiPreferences, {
    request: createGlobalAiRequest({
      libraryId: input.library.id,
      requestId: crypto.randomUUID(),
      actor: agent.actor ?? input.actor ?? { libraryUserId: 'user-owner' },
      source: { channel: 'public-url' },
      workspaceSnapshot,
      requestedScope: 'published-task-manager',
      persistencePolicy: 'published-no-memory',
      prompt: input.prompt,
    }),
    ...replyInput,
  }, {
    abortSignal: input.signal,
    onMessageDelta: input.onMessageDelta,
    onThinkingDelta: input.onThinkingDelta,
    onAgentProgress: input.onAgentProgress,
  })
}
