import { callBackend } from '../transport'
import type { NotiaLibrary } from '../../types/notia'
import { mutateLibraryEntry } from '../libraries/libraryRuntime'
import type { StoredChatDocument } from './chatDocumentStorage'

export interface CreateChatFileInput {
  longTermMemoryEnabled: boolean
  contextMemoryEnabled: boolean
  contextMemoryMessageCount: number
}

/** Local time of the device, which names the chat file. */
function localStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-')
}

/** Context files of the composer, for a chat created to send a message. */
export interface CreateChatContext {
  scopeKey: string | null
  files: string[]
  mode: 'direct' | 'index'
  keepChatContext: boolean
}

export async function createChatDraftFile(
  library: NotiaLibrary,
  config: CreateChatFileInput,
  context?: CreateChatContext,
): Promise<{ filePath: string; document: StoredChatDocument }> {
  const { path, document } = await callBackend<{ path: string; document: StoredChatDocument }>('backend_create_chat', {
    payload: { libraryId: library.id, localStamp: localStamp(new Date()), ...config, context },
  })
  return { filePath: path, document }
}

export async function deleteChatDraftFile(filePath: string, library: NotiaLibrary): Promise<void> {
  const result = await mutateLibraryEntry(library, { action: 'delete', targetPath: filePath })

  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo eliminar el archivo del chat.')
  }
}
