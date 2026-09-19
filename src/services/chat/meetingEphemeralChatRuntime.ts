import { loadLibraryFileOptions } from './chatAttachmentRuntime'
import type { StoredChatMessage } from './chatDocumentStorage'
import type { TaskExecutionStep } from './chatScopedAgentRuntime'
import { createGlobalAiAgent, createAppAiRequest, runGlobalAiChat } from './globalAiChatRuntime'
import { runNotiaChatReply } from './notiaChatRuntime'
import { isGlobalAiChatRequest } from '../../types/ai/globalAiContract'
import { loadSelectedAgentPromptFileName } from '../ai/agentPromptRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../types/notia'
import { buildWorkspaceAiSnapshot } from '../ai/workspaceAiSnapshotRuntime'
import type { AgentProgressEvent } from '../../types/ai/agentContracts'

export interface MeetingEphemeralChatReplyInput {
  aiPreferences: AiPreferences
  library: NotiaLibrary
  transcript: string
  prompt: string
  previousMessages: StoredChatMessage[]
  signal: AbortSignal
  onExecutionPlanChange?: (steps: TaskExecutionStep[]) => void
  onMessageDelta?: (delta: string) => void
  onAgentProgress?: (event: AgentProgressEvent) => void
}

/** Meeting usa el runtime común, pero no persiste memoria ni permite escrituras. */
export async function runMeetingEphemeralChatReply(
  input: MeetingEphemeralChatReplyInput,
): Promise<string> {
  const files = await loadLibraryFileOptions(input.library)
  const agent = await createGlobalAiAgent({
    scope: 'library',
    persistencePolicy: 'ephemeral-no-memory',
    readOnly: true,
    workspaceSnapshot: buildWorkspaceAiSnapshot({
      view: 'meeting',
      scope: 'library',
      library: input.library,
      activeDocument: null,
      openTabs: [],
    }),
    actor: { libraryUserId: 'user-owner' },
    financeSource: 'app',
    aiPreferences: input.aiPreferences,
    library: input.library,
    scopePaths: files.map((file) => file.path),
    promptFileName: loadSelectedAgentPromptFileName(input.library.id),
    requestClarification: async (question, signal) => {
      if (signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError')
      return window.prompt(question)?.trim() ?? ''
    },
    requestConfirmation: async (question, signal) => {
      if (signal.aborted) return false
      return window.confirm(question)
    },
    requestExecutionPlanApproval: async (steps, signal) => ({
      approved: !signal.aborted && window.confirm(
        `Aprobar este plan de ejecución:\n${steps.map((step, index) => `${index + 1}. ${step.label}`).join('\n')}`,
      ),
    }),
    onExecutionPlanChange: input.onExecutionPlanChange,
  })

  const prompt = [
      'Usá la siguiente transcripción actual de Meeting como contexto para responder la consulta.',
      'Si la respuesta no surge de ella ni de una herramienta autorizada, indicá que no está disponible.',
      '',
      'TRANSCRIPCIÓN ACTUAL:',
      input.transcript.trim(),
      '',
      'CONSULTA:',
      input.prompt,
    ].join('\n')
  const snapshot = buildWorkspaceAiSnapshot({
    view: 'meeting',
    scope: 'library',
    library: input.library,
    activeDocument: null,
    openTabs: [],
  })
  const request = createAppAiRequest({
      libraryId: input.library.id,
      requestId: crypto.randomUUID(),
      actor: agent.actor ?? { libraryUserId: 'user-owner' },
      workspaceSnapshot: snapshot,
      requestedScope: 'library',
      persistencePolicy: 'ephemeral-no-memory',
      prompt,
      appSurface: 'meeting',
    })
  if (!isGlobalAiChatRequest(request)) {
    return runNotiaChatReply(input.aiPreferences, {
      agent,
      prompt,
      previousMessages: input.previousMessages,
      intentContext: {},
    }, {
      abortSignal: input.signal,
      onMessageDelta: input.onMessageDelta,
      onAgentProgress: input.onAgentProgress,
    })
  }
  return runGlobalAiChat(input.aiPreferences, {
    request,
    agent,
    previousMessages: input.previousMessages,
    intentContext: {},
  }, {
    abortSignal: input.signal,
    onMessageDelta: input.onMessageDelta,
    onAgentProgress: input.onAgentProgress,
  })
}
