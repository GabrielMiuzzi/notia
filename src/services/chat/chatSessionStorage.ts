import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { mutateLibraryEntry } from '../libraries/libraryRuntime'
import { joinLibraryPath } from '../libraries/libraryPathMapping'

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

export async function createChatDraftFile(
  library: NotiaLibrary,
  config: CreateChatFileInput,
): Promise<{ filePath: string }> {
  const { logicalPath } = await invoke<{ logicalPath: string }>('backend_create_chat', {
    payload: { libraryId: library.id, localStamp: localStamp(new Date()), ...config },
  })
  return { filePath: joinLibraryPath(library.path, logicalPath) }
}

export async function deleteChatDraftFile(filePath: string, library: NotiaLibrary): Promise<void> {
  const result = await mutateLibraryEntry(library, { action: 'delete', targetPath: filePath })

  if (!result.ok) {
    throw new Error(result.error ?? 'No se pudo eliminar el archivo del chat.')
  }
}
