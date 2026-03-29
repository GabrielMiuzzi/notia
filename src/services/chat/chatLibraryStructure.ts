import type { NotiaLibrary } from '../../types/notia'
import { pathExists } from '../files/filesystemEngine'
import { createLibraryEntry } from '../libraries/libraryRuntime'

const CHAT_ROOT_DIRECTORY_NAME = 'chat'
const CHAT_HISTORY_DIRECTORY_NAME = 'chats'
const LONG_TERM_MEMORY_FILE_NAME = 'LongTermMemory.md'

export function joinChatPath(basePath: string, childName: string): string {
  const separator = basePath.includes('\\') ? '\\' : '/'
  if (basePath.endsWith('/') || basePath.endsWith('\\')) {
    return `${basePath}${childName}`
  }
  return `${basePath}${separator}${childName}`
}

export function resolveChatRootDirectoryPath(libraryPath: string): string {
  return joinChatPath(libraryPath, CHAT_ROOT_DIRECTORY_NAME)
}

export function resolveChatHistoryDirectoryPath(libraryPath: string): string {
  return joinChatPath(resolveChatRootDirectoryPath(libraryPath), CHAT_HISTORY_DIRECTORY_NAME)
}

export function resolveLongTermMemoryFilePath(libraryPath: string): string {
  return joinChatPath(resolveChatRootDirectoryPath(libraryPath), LONG_TERM_MEMORY_FILE_NAME)
}

async function ensureFolder(parentDirectoryPath: string, folderName: string, library: NotiaLibrary): Promise<void> {
  const targetDirectoryPath = joinChatPath(parentDirectoryPath, folderName)
  if (await pathExists(targetDirectoryPath)) {
    return
  }

  const result = await createLibraryEntry(parentDirectoryPath, folderName, 'folder', {
    androidDirectoryUri: library.androidTreeUri,
  })
  if (!result.ok) {
    throw new Error(result.error ?? `No se pudo crear la carpeta ${folderName}.`)
  }
}

async function ensureMarkdownFile(parentDirectoryPath: string, fileName: string, library: NotiaLibrary): Promise<void> {
  const targetFilePath = joinChatPath(parentDirectoryPath, fileName)
  if (await pathExists(targetFilePath)) {
    return
  }

  const result = await createLibraryEntry(parentDirectoryPath, fileName, 'note', {
    androidDirectoryUri: library.androidTreeUri,
  })
  if (!result.ok) {
    throw new Error(result.error ?? `No se pudo crear el archivo ${fileName}.`)
  }
}

export async function ensureChatLibraryStructure(library: NotiaLibrary): Promise<void> {
  const chatDirectoryPath = resolveChatRootDirectoryPath(library.path)

  await ensureFolder(library.path, CHAT_ROOT_DIRECTORY_NAME, library)
  await ensureMarkdownFile(chatDirectoryPath, LONG_TERM_MEMORY_FILE_NAME, library)
  await ensureFolder(chatDirectoryPath, CHAT_HISTORY_DIRECTORY_NAME, library)
}
