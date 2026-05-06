import type { NotiaLibrary } from '../../types/notia'
import { readLibraryTree, readLibraryDirectory, createLibraryEntry } from '../libraries/libraryRuntime'
import { getRuntimeDevice } from '../../utils/platform/getRuntimeDevice'

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
  nodes: Array<{ name: string; type: string; hasChildren?: boolean; children?: Array<{ name: string; type: string }> }>,
  directoryName: string,
): { exists: boolean; children: Array<{ name: string; type: string }> | null } {
  const match = nodes.find((node) => node.type === 'folder' && node.name === directoryName)
  if (!match) {
    return { exists: false, children: null }
  }
  // If the folder exists but children haven't been loaded yet (lazy loading),
  // report it as existing with null children (we'll need to load them separately).
  return { exists: true, children: match.children ?? null }
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
  // Optimisation: on Android, use readLibraryDirectory (shallow, ls-style)
  // instead of readLibraryTree (full recursive traversal) to check if the
  // chat directory exists in the root-level nodes. This avoids the expensive
  // full tree traversal on large libraries.
  const isAndroid = getRuntimeDevice() === 'Android'

  try {
    const treeNodes = isAndroid
      ? await readLibraryDirectory(library.path, {
          androidDirectoryUri: library.androidTreeUri,
        })
      : await readLibraryTree(library.path, {
          androidDirectoryUri: library.androidTreeUri,
        })

    const chatResult = findDirectoryInTree(treeNodes, CHAT_ROOT_DIRECTORY_NAME)
    if (chatResult.exists) {
      // chat/ exists — but children may not be loaded (lazy loading on Android).
      // If children are null (not loaded), load them with a directory read.
      let chatChildren = chatResult.children
      if (!chatChildren && isAndroid) {
        try {
          const chatDirNodes = await readLibraryDirectory(
            resolveChatRootDirectoryPath(library.path),
            { androidDirectoryUri: library.androidTreeUri },
          )
          chatChildren = chatDirNodes
        } catch {
          // Fall through to create-if-missing path
        }
      }

      if (chatChildren) {
        const hasLongTermMemory = chatChildren.some(
          (n) => n.type === 'file' && n.name === LONG_TERM_MEMORY_FILE_NAME,
        )
        const hasChatsDir = chatChildren.some(
          (n) => n.type === 'folder' && n.name === CHAT_HISTORY_DIRECTORY_NAME,
        )

        const chatDirectoryPath = resolveChatRootDirectoryPath(library.path)
        // Create missing children in parallel since they're independent
        const pendingCreations: Promise<void>[] = []
        if (!hasLongTermMemory) {
          pendingCreations.push(ensureMarkdownFile(chatDirectoryPath, LONG_TERM_MEMORY_FILE_NAME, library))
        }
        if (!hasChatsDir) {
          pendingCreations.push(ensureFolder(chatDirectoryPath, CHAT_HISTORY_DIRECTORY_NAME, library))
        }
        if (pendingCreations.length > 0) {
          await Promise.allSettled(pendingCreations)
        }
      }
      return
    }
  } catch {
    // If tree reading fails, fall through to the create-if-missing path below.
  }

  // chat/ does not exist — create the full structure.
  // First create chat/ folder, then create the two children in parallel.
  await ensureFolder(library.path, CHAT_ROOT_DIRECTORY_NAME, library)
  const chatDirectoryPath = resolveChatRootDirectoryPath(library.path)
  await Promise.allSettled([
    ensureMarkdownFile(chatDirectoryPath, LONG_TERM_MEMORY_FILE_NAME, library),
    ensureFolder(chatDirectoryPath, CHAT_HISTORY_DIRECTORY_NAME, library),
  ])
}
