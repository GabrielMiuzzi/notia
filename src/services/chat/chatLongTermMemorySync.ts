import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { generateAiLongTermMemories, organizeAiAgentKnowledge } from '../ai/aiRuntime'
import type { StoredChatMessage } from './chatDocumentStorage'
import { loadAgentIaRules, loadAgentMemories, writeAgentIaRules, writeAgentMemories } from '../ai/agentPromptRuntime'

export function scheduleAgentKnowledgeOrganization(
  library: NotiaLibrary,
  aiPreferences: AiPreferences,
): void {
  void Promise.all([loadAgentIaRules(library), loadAgentMemories(library)])
    .then(([rules, memories]) => organizeAiAgentKnowledge(aiPreferences, { rules, memories }))
    .then(async (organized) => {
      await Promise.all([
        writeAgentIaRules(library, organized.rules),
        writeAgentMemories(library, organized.memories),
      ])
    })
    .catch((error) => console.warn('[notia] could not reorganize agent knowledge in background', error))
}
import type { NotiaLibrary } from '../../types/notia'

interface PersistLongTermMemoriesForTurnInput {
  library: NotiaLibrary
  aiPreferences: AiPreferences
  prompt: string
  assistantReply: string
  previousMessages: StoredChatMessage[]
  existingLongTermMemories: string[]
}

export async function persistLongTermMemoriesForTurn(
  input: PersistLongTermMemoriesForTurnInput,
): Promise<void> {
  const current = await loadAgentMemories(input.library)
  const extractedMemories = await generateAiLongTermMemories(input.aiPreferences, {
    prompt: input.prompt,
    assistantReply: input.assistantReply,
    previousMessages: input.previousMessages,
    existingLongTermMemories: [...current, ...input.existingLongTermMemories],
  })

  if (extractedMemories.length === 0) {
    return
  }

  await writeAgentMemories(input.library, [...current, ...extractedMemories])

  scheduleAgentKnowledgeOrganization(input.library, input.aiPreferences)
}

export function scheduleLongTermMemoriesForTurn(
  input: PersistLongTermMemoriesForTurnInput,
): void {
  void persistLongTermMemoriesForTurn(input).catch((error) => {
    console.warn('[notia] could not persist long term memories', error)
  })
}
