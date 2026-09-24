import { callBackend } from '../transport'
import type { NotiaLibrary } from '../../types/notia'

export type ChatFileContextMode = 'direct' | 'index'

export interface ChatLibraryFileOption {
  path: string
  name: string
  relativePath: string
}

export interface ChatInlineFileAttachment {
  path: string
  name: string
  content: string
  revision?: string
}

function baseName(pathValue: string): string {
  return pathValue.split(/[\\/]/).filter(Boolean).pop() ?? pathValue
}

export function buildAttachmentDisplayName(pathValue: string, options: ChatLibraryFileOption[] = []): string {
  const matchingOption = options.find((option) => option.path === pathValue)
  return matchingOption?.name ?? baseName(pathValue)
}

/** Files of the library from the backend inventory, sorted by path. */
export function loadLibraryFileOptions(library: NotiaLibrary): Promise<ChatLibraryFileOption[]> {
  return callBackend<ChatLibraryFileOption[]>('library_list_files', { payload: { libraryId: library.id } })
}

export function filterLibraryFileOptions(
  options: ChatLibraryFileOption[],
  query: string,
): ChatLibraryFileOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return options.slice(0, 60)
  }

  return options
    .filter((option) => (
      option.name.toLowerCase().includes(normalizedQuery)
      || option.relativePath.toLowerCase().includes(normalizedQuery)
    ))
    .slice(0, 60)
}
