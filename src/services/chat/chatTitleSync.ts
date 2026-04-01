import { generateAiChatTitle } from '../ai/aiRuntime'
import type { AiPreferences } from '../preferences/aiSettingsStorage'
import type { NotiaLibrary } from '../../types/notia'
import { saveChatDocument, type StoredChatDocument } from './chatDocumentStorage'

interface PersistAiChatTitleInput {
  library: NotiaLibrary
  aiPreferences: AiPreferences
  filePath: string
  document: StoredChatDocument
  prompt: string
}

export async function persistAiChatTitle(
  input: PersistAiChatTitleInput,
): Promise<string | null> {
  const generatedTitle = (await generateAiChatTitle(input.aiPreferences, {
    prompt: input.prompt,
  })).trim()

  if (!generatedTitle || generatedTitle === input.document.title) {
    return null
  }

  await saveChatDocument(input.filePath, {
    ...input.document,
    title: generatedTitle,
  }, input.library)

  return generatedTitle
}

export function scheduleAiChatTitle(
  input: PersistAiChatTitleInput,
  options: {
    onPersisted?: (title: string) => void
  } = {},
): void {
  void persistAiChatTitle(input)
    .then((title) => {
      if (title) {
        options.onPersisted?.(title)
      }
    })
    .catch((error) => {
      console.warn('[notia] could not persist ai chat title', error)
    })
}
