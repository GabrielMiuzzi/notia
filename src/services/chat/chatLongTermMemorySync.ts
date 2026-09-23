import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import type { StoredChatMessage } from './chatDocumentStorage'
import { notiaLog } from '../runtime/notiaLogger'

interface LearnFromTurnInput {
  library: NotiaLibrary
  prompt: string
  assistantReply: string
  previousMessages: StoredChatMessage[]
}

/**
 * The backend extracts durable facts from the turn, stores the new ones and
 * reorganizes rules and memories (`agent_knowledge.rs`).
 */
export function scheduleLongTermMemoriesForTurn(input: LearnFromTurnInput): void {
  void invoke<number>('backend_learn_from_turn', {
    payload: {
      libraryId: input.library.id,
      prompt: input.prompt,
      assistantReply: input.assistantReply,
      previousMessages: input.previousMessages.map((message) => ({ role: message.role, content: message.content })),
    },
  }).catch((error: unknown) => {
    notiaLog('chat-memory', 'could not persist long term memories', {
      error: error instanceof Error ? error.message : String(error),
    }, 'error')
  })
}
