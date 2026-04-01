import type { AiPreferences } from '../preferences/aiSettingsStorage'
import { generateAiLongTermMemories } from '../ai/aiRuntime'
import { appendLongTermMemories, type StoredChatMessage } from './chatDocumentStorage'
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
  const extractedMemories = await generateAiLongTermMemories(input.aiPreferences, {
    prompt: input.prompt,
    assistantReply: input.assistantReply,
    previousMessages: input.previousMessages,
    existingLongTermMemories: input.existingLongTermMemories,
  })

  if (extractedMemories.length === 0) {
    return
  }

  await appendLongTermMemories(input.library, extractedMemories)
}

export function scheduleLongTermMemoriesForTurn(
  input: PersistLongTermMemoriesForTurnInput,
): void {
  void persistLongTermMemoriesForTurn(input).catch((error) => {
    console.warn('[notia] could not persist long term memories', error)
  })
}
