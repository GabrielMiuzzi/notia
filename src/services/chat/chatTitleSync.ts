import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'
import { resolveLibraryDocumentLogicalPath } from '../libraries/libraryDocumentRuntime'
import { notiaLog } from '../runtime/notiaLogger'

interface ScheduleAiChatTitleInput {
  library: NotiaLibrary
  filePath: string
  prompt: string
}

/** The backend names the chat from its first message and saves the title. */
export function scheduleAiChatTitle(
  input: ScheduleAiChatTitleInput,
  options: { onPersisted?: (title: string) => void } = {},
): void {
  const logicalPath = resolveLibraryDocumentLogicalPath(input.library.path, input.filePath)
  if (!logicalPath) return
  void invoke<string | null>('backend_title_chat', {
    payload: { libraryId: input.library.id, logicalPath, prompt: input.prompt },
  })
    .then((title) => {
      if (title) options.onPersisted?.(title)
    })
    .catch((error: unknown) => {
      notiaLog('chat-title', 'could not persist ai chat title', {
        error: error instanceof Error ? error.message : String(error),
      }, 'error')
    })
}
