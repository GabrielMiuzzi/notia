import { invoke } from '@tauri-apps/api/core'
import type { NotiaLibrary } from '../../types/notia'

/** Creates the chat folders and marks chat files as confidential (backend, once per session). */
export async function ensureChatLibraryStructure(library: NotiaLibrary): Promise<void> {
  await invoke('backend_ensure_chat_structure', { payload: { libraryId: library.id } })
}
