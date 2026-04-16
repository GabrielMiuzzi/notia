import type { NotiaLibrary } from '../../types/notia'
import { readLibraryTree, createLibraryEntry } from '../libraries/libraryRuntime'

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

/**
 * Check if the chat directory exists by looking at the library tree.
 * This is much faster than individual `pathExists` calls on Android SAF
 * because it reuses the already-fetched tree and avoids extra cache refreshes.
 */
function findDirectoryInTree(
  nodes: Array<{ name: string; type: string; children?: Array<{ name: string; type: string }> }>,
  directoryName: string,
): Array<{ name: string; type: string; children?: Array<{ name: string; type: string }> }> | null {
  const match = nodes.find((node) => node.type === 'folder' && node.name === directoryName)
  return match?.children ?? null
}

async function ensureFolder(parentDirectoryPath: string, folderName: string, library: NotiaLibrary): Promise<void> {
  const targetDirectoryPath = joinChatPath(parentDirectoryPath, folderName)
  // Try creating directly. If it already exists, the backend will return
  // an "already exists" error which we can safely ignore on Android SAF
  // (the Rust layer handles this gracefully via map_already_exists_error).
  const result = await createLibraryEntry(parentDirectoryPath, folderName, 'folder', {
    androidDirectoryUri: library.androidTreeUri,
  })
  // We don't throw on failure because the directory may already exist.
  // The "already exists" case is expected and benign.
  void targetDirectoryPath
  void result
}

async function ensureMarkdownFile(parentDirectoryPath: string, fileName: string, library: NotiaLibrary): Promise<void> {
  const result = await createLibraryEntry(parentDirectoryPath, fileName, 'note', {
    androidDirectoryUri: library.androidTreeUri,
  })
  // Same as ensureFolder — "already exists" is benign.
  void result
}

export async function ensureChatLibraryStructure(library: NotiaLibrary): Promise<void> {
  // Optimisation: read the library tree ONCE and check whether the chat
  // directories already exist in the cached tree. This avoids 3+ separate
  // `pathExists` calls on Android SAF that each trigger a full tree cache
  // refresh.
  try {
    const treeNodes = await readLibraryTree(library.path, {
      androidDirectoryUri: library.androidTreeUri,
    })

    const chatChildren = findDirectoryInTree(treeNodes, CHAT_ROOT_DIRECTORY_NAME)
    if (chatChildren !== null) {
      // chat/ exists — check for expected children before creating.
      const hasLongTermMemory = chatChildren.some(
        (n) => n.type === 'file' && n.name === LONG_TERM_MEMORY_FILE_NAME,
      )
      const hasChatsDir = chatChildren.some(
        (n) => n.type === 'folder' && n.name === CHAT_HISTORY_DIRECTORY_NAME,
      )

      const chatDirectoryPath = resolveChatRootDirectoryPath(library.path)
      if (!hasLongTermMemory) {
        await ensureMarkdownFile(chatDirectoryPath, LONG_TERM_MEMORY_FILE_NAME, library)
      }
      if (!hasChatsDir) {
        await ensureFolder(chatDirectoryPath, CHAT_HISTORY_DIRECTORY_NAME, library)
      }
      return
    }
  } catch {
    // If tree reading fails, fall through to the create-if-missing path below.
  }

  // chat/ does not exist — create the full structure.
  await ensureFolder(library.path, CHAT_ROOT_DIRECTORY_NAME, library)
  const chatDirectoryPath = resolveChatRootDirectoryPath(library.path)
  await ensureMarkdownFile(chatDirectoryPath, LONG_TERM_MEMORY_FILE_NAME, library)
  await ensureFolder(chatDirectoryPath, CHAT_HISTORY_DIRECTORY_NAME, library)
}
